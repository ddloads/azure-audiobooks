import { execFile } from "child_process";
import { promisify } from "util";
import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import prisma from "../lib/prisma";
import { createLogger } from "../lib/logger";
import { requestLibraryFolderScan } from "../lib/scanJobPool";
import { runAudible } from "./audibleCli";
import { ACTIVE_DOWNLOAD_STATUSES } from "./audibleLibrary";
import { resolveWritableLibrarySource } from "./libraryConfig";

// Downloads titles from Audible one at a time: audible-cli fetches the
// encrypted AAXC (or AAX) into a temp folder under data/, ffmpeg decrypts it
// to M4B without re-encoding, and only the finished file (plus cover) moves to
// the library's writable folder as Author/Series/Book N - Title, where a folder scan
// imports it.

const execFileAsync = promisify(execFile);
const logger = createLogger("audible-download");

const WORK_ROOT = path.join(process.cwd(), "data", "temp", "audible-downloads");
const DOWNLOAD_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const CONVERT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SCAN_POLL_MS = 3000;
const SCAN_WAIT_MS = 30 * 60 * 1000;

type DownloadJob = { itemId: string; libraryId: string };

const queue: DownloadJob[] = [];
let working = false;

const setStatus = (itemId: string, data: { downloadStatus: string; downloadError?: string | null; downloadedPath?: string; downloadedAt?: Date }) =>
  prisma.audibleLibraryItem.update({ where: { id: itemId }, data });

// ─── Helpers ──────────────────────────────────────────────────────────────

let resolvedFfmpeg: string | null = null;

/** The system ffmpeg when there is one (newer, and the Docker image ships it), else the bundled build. */
const resolveFfmpeg = async () => {
  if (resolvedFfmpeg) return resolvedFfmpeg;
  try {
    await execFileAsync("ffmpeg", ["-version"], { timeout: 5_000, windowsHide: true });
    resolvedFfmpeg = "ffmpeg";
  } catch {
    resolvedFfmpeg = ffmpegInstaller.path;
  }
  return resolvedFfmpeg;
};

const getActivationBytes = async (profile: string) => {
  const output = await runAudible(["activation-bytes"], profile);
  const matches = output.match(/\b[0-9a-f]{8}\b/gi);
  if (!matches?.length) throw new Error("Audible didn't return activation bytes for this account.");
  return matches[matches.length - 1];
};

const readVoucherKeys = async (voucherPath: string) => {
  const voucher = JSON.parse(await fsp.readFile(voucherPath, "utf-8")) as {
    content_license?: { license_response?: { key?: string; iv?: string } };
  };
  const { key, iv } = voucher.content_license?.license_response ?? {};
  if (!key || !iv) throw new Error("The download's voucher has no decryption key.");
  return { key, iv };
};

const safeSegment = (value: string) =>
  value
    .replace(/[<>:"/\\|?*\u0000-\u001f]/g, "")
    .replace(/\s+/g, " ")
    .trim()
    .replace(/^\.+|[. ]+$/g, "")
    .slice(0, 120)
    .trim();

type NamingItem = { title: string; author: string | null; seriesName: string | null; seriesSequence: string | null };

/** "Book 2 - Title" for a numbered book in a series, otherwise just the title. */
const buildBookName = (item: NamingItem) => {
  const title = safeSegment(item.title) || "Untitled";
  const sequence = item.seriesName ? safeSegment((item.seriesSequence ?? "").replace(/^book\s*/i, "")) : "";
  return sequence ? `Book ${sequence} - ${title}` : title;
};

/** Author/Series/Book N - Title, or Author/Title for a book that isn't in a series. */
const buildRelativeFolder = (item: NamingItem) =>
  [
    safeSegment(item.author?.split(",")[0] ?? "") || "Unknown Author",
    safeSegment(item.seriesName ?? ""),
    buildBookName(item),
  ].filter(Boolean);

const isInside = (root: string, target: string) => {
  const relative = path.relative(path.resolve(root), path.resolve(target));
  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};

const moveFile = async (source: string, target: string) => {
  try {
    await fsp.rename(source, target);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "EXDEV") throw error;
    await fsp.copyFile(source, target, fs.constants.COPYFILE_EXCL);
    await fsp.rm(source, { force: true });
  }
};

const waitForScanJob = async (jobId: string) => {
  const deadline = Date.now() + SCAN_WAIT_MS;
  while (Date.now() < deadline) {
    const job = await prisma.libraryScanJob.findUnique({ where: { id: jobId }, select: { status: true } });
    if (!job || ["completed", "failed", "cancelled"].includes(job.status)) return job?.status ?? null;
    await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_MS));
  }
  return null;
};

const describeError = (error: unknown) => {
  const err = error as { stderr?: string; message?: string; killed?: boolean };
  if (err.killed) return "Timed out.";
  const stderr = err.stderr?.trim().split("\n").filter(Boolean).slice(-3).join(" ");
  return (stderr || err.message || String(error)).slice(0, 500);
};

// ─── The job ──────────────────────────────────────────────────────────────

const processJob = async ({ itemId, libraryId }: DownloadJob) => {
  const item = await prisma.audibleLibraryItem.findUnique({ where: { id: itemId } });
  if (!item) return;

  const workDir = path.join(WORK_ROOT, item.asin);
  try {
    const source = await resolveWritableLibrarySource(libraryId);
    if (!source) throw new Error("The library has no writable folder.");

    await fsp.rm(workDir, { recursive: true, force: true });
    await fsp.mkdir(workDir, { recursive: true });

    await setStatus(itemId, { downloadStatus: "downloading", downloadError: null });
    await runAudible(
      [
        "download",
        "--asin", item.asin,
        "--aaxc",
        "--quality", "best",
        "--cover", "--cover-size", "1215",
        "--output-dir", workDir,
        "--filename-mode", "asin_ascii",
        "--no-confirm",
        "--no-progress",
        "--timeout", "0",
      ],
      item.profile,
      DOWNLOAD_TIMEOUT_MS,
    );

    const files = await fsp.readdir(workDir);
    const audio = files.find((name) => /\.(aaxc|aax|mp3)$/i.test(name));
    if (!audio) throw new Error("Audible didn't deliver an audio file. The title may not be downloadable from this account.");
    const cover = files.find((name) => /\.jpe?g$/i.test(name));
    const audioPath = path.join(workDir, audio);
    const extension = path.extname(audio).toLowerCase();

    await setStatus(itemId, { downloadStatus: "converting" });
    const outputName = `${buildBookName(item)}${extension === ".mp3" ? ".mp3" : ".m4b"}`;
    const outputPath = path.join(workDir, `converted-${outputName}`);
    if (extension === ".mp3") {
      await fsp.rename(audioPath, outputPath);
    } else {
      const decryptArgs =
        extension === ".aaxc"
          ? await readVoucherKeys(audioPath.replace(/\.aaxc$/i, ".voucher")).then(({ key, iv }) => ["-audible_key", key, "-audible_iv", iv])
          : ["-activation_bytes", await getActivationBytes(item.profile)];
      await execFileAsync(
        await resolveFfmpeg(),
        [
          "-hide_banner", "-loglevel", "error", "-y",
          ...decryptArgs,
          "-i", audioPath,
          "-map", "0:a",
          "-map_metadata", "0",
          "-map_chapters", "0",
          "-c", "copy",
          "-movflags", "+faststart",
          outputPath,
        ],
        { timeout: CONVERT_TIMEOUT_MS, maxBuffer: 16 * 1024 * 1024, windowsHide: true },
      );
    }

    await setStatus(itemId, { downloadStatus: "importing" });
    const segments = buildRelativeFolder(item);
    let targetDir = path.join(source.resolvedPath, ...segments);
    if (fs.existsSync(targetDir) && (await fsp.readdir(targetDir)).length > 0) {
      targetDir = `${targetDir} [${item.asin}]`;
      if (fs.existsSync(targetDir)) throw new Error(`The folder ${targetDir} already exists.`);
    }
    if (!isInside(source.resolvedPath, targetDir)) throw new Error("The book's folder would be outside the library.");

    await fsp.mkdir(targetDir, { recursive: true });
    await moveFile(outputPath, path.join(targetDir, outputName));
    if (cover) await moveFile(path.join(workDir, cover), path.join(targetDir, "cover.jpg"));

    const scan = await requestLibraryFolderScan(libraryId, targetDir, "audible-download", { dedupe: true });
    if (scan.jobId) await waitForScanJob(scan.jobId);

    // Files from Audible don't always carry the ASIN in a tag the scanner reads.
    await prisma.book.updateMany({
      where: { folderPath: { equals: targetDir, mode: "insensitive" }, asin: null },
      data: { asin: item.asin },
    });

    await setStatus(itemId, { downloadStatus: "done", downloadError: null, downloadedPath: targetDir, downloadedAt: new Date() });
    logger.info("Audible title downloaded", { asin: item.asin, title: item.title, folder: targetDir });
  } catch (error) {
    const message = describeError(error);
    logger.warn("Audible download failed", { asin: item.asin, title: item.title, error: message });
    await setStatus(itemId, { downloadStatus: "failed", downloadError: message }).catch(() => undefined);
  } finally {
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

const work = async () => {
  if (working) return;
  working = true;
  try {
    for (let job = queue.shift(); job; job = queue.shift()) {
      await processJob(job);
    }
  } finally {
    working = false;
  }
};

/** Queues titles for download into the library. Titles already queued or downloading are skipped. */
export const enqueueAudibleDownloads = async (profile: string, asins: string[], libraryId: string) => {
  const source = await resolveWritableLibrarySource(libraryId);
  if (!source) throw new Error("That library has no writable folder. Mark one of its folders as writable first.");

  const items = await prisma.audibleLibraryItem.findMany({
    where: {
      profile,
      asin: { in: asins },
      OR: [{ downloadStatus: null }, { downloadStatus: { notIn: ACTIVE_DOWNLOAD_STATUSES } }],
    },
    select: { id: true },
  });
  if (!items.length) return 0;

  await prisma.audibleLibraryItem.updateMany({
    where: { id: { in: items.map((item) => item.id) } },
    data: { downloadStatus: "queued", downloadError: null },
  });
  queue.push(...items.map((item) => ({ itemId: item.id, libraryId })));
  void work();
  return items.length;
};

/** The queue lives in memory, so downloads cut short by a restart are marked failed. */
export const reapInterruptedAudibleDownloads = async () => {
  const result = await prisma.audibleLibraryItem.updateMany({
    where: { downloadStatus: { in: ACTIVE_DOWNLOAD_STATUSES } },
    data: { downloadStatus: "failed", downloadError: "Interrupted when the server restarted. Download it again to retry." },
  });
  return result.count;
};
