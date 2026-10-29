import { execFile, spawn } from "child_process";
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
import { applyAudibleMetadataToBook } from "./audibleDownloadMetadata";
import { getAudibleSyncSettings } from "./appSettings";

// Downloads titles from Audible, a few at a time (set on the Missing page): audible-cli fetches the
// encrypted AAXC (or AAX when AAXC is refused) into a temp folder under data/, ffmpeg decrypts it
// to M4B without re-encoding, and only the finished file (plus cover) moves to
// the library's writable folder as Author/Series/Book N - Title, where a folder scan
// imports it and Audible's metadata is applied.

const execFileAsync = promisify(execFile);
const logger = createLogger("audible-download");

const WORK_ROOT = path.join(process.cwd(), "data", "temp", "audible-downloads");
const DOWNLOAD_TIMEOUT_MS = 4 * 60 * 60 * 1000;
const CONVERT_TIMEOUT_MS = 2 * 60 * 60 * 1000;
const SCAN_POLL_MS = 3000;
const SCAN_WAIT_MS = 30 * 60 * 1000;
const BOOK_WAIT_MS = 2 * 60 * 1000;
const PROGRESS_POLL_MS = 1500;

export type DownloadTrigger = "manual" | "auto";
type DownloadJob = { itemId: string; libraryId: string; asin: string; title: string; trigger: DownloadTrigger };

export interface AudibleDownloadProgress {
  asin: string;
  title: string;
  phase: "downloading" | "converting" | "importing";
  /** 0–100, or null while it can't be worked out. */
  percent: number | null;
  bytes: number | null;
  totalBytes: number | null;
  startedAt: string;
}

const queue: DownloadJob[] = [];
/** Titles being processed right now, keyed by item id, with their progress. */
const active = new Map<string, AudibleDownloadProgress>();

/** The titles being processed (with their progress) and the titles waiting behind them, in order. */
export const getAudibleDownloadQueue = () => ({
  active: [...active.values()].map((progress) => ({ ...progress })),
  queued: queue.map(({ asin, title }) => ({ asin, title })),
});

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

/** Runs ffmpeg, reporting how far into the audio it has got (in seconds). */
const runFfmpeg = async (args: string[], onProgress: (seconds: number) => void) => {
  const child = spawn(await resolveFfmpeg(), ["-progress", "pipe:1", "-nostats", ...args], { windowsHide: true });
  let stderr = "";
  let buffered = "";
  child.stdout.on("data", (chunk: Buffer) => {
    buffered += chunk.toString();
    const lines = buffered.split("\n");
    buffered = lines.pop() ?? "";
    for (const line of lines) {
      const match = /^out_time_(?:us|ms)=(\d+)/.exec(line.trim());
      if (match) onProgress(Number(match[1]) / 1_000_000);
    }
  });
  child.stderr.on("data", (chunk: Buffer) => {
    stderr = (stderr + chunk.toString()).slice(-8000);
  });

  await new Promise<void>((resolve, reject) => {
    const timeout = setTimeout(() => child.kill(), CONVERT_TIMEOUT_MS);
    child.on("error", (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    child.on("close", (code, signal) => {
      clearTimeout(timeout);
      if (code === 0) resolve();
      else reject(Object.assign(new Error(`ffmpeg exited with ${code ?? signal}`), { stderr, killed: signal !== null }));
    });
  });
};

/** Finds the first numeric "content_size_in_bytes" anywhere in the voucher; its nesting varies. */
const findContentSize = (value: unknown): number | null => {
  if (!value || typeof value !== "object") return null;
  for (const [key, child] of Object.entries(value)) {
    if (key === "content_size_in_bytes" && Number(child) > 0) return Number(child);
    const nested = findContentSize(child);
    if (nested) return nested;
  }
  return null;
};

/** Watches the partial download grow; the voucher written first says how big the file will be. */
const watchDownloadProgress = (workDir: string, progress: AudibleDownloadProgress) => {
  let voucherRead = false;
  const timer = setInterval(() => {
    void (async () => {
      if (progress.phase !== "downloading") return;
      try {
        const files = await fsp.readdir(workDir);
        const voucher = files.find((name) => name.endsWith(".voucher"));
        if (voucher && !voucherRead) {
          voucherRead = true;
          progress.totalBytes = findContentSize(JSON.parse(await fsp.readFile(path.join(workDir, voucher), "utf-8")));
        }
        let bytes = 0;
        for (const name of files.filter((file) => /\.(tmp|aaxc|aax|mp3)$/i.test(file))) {
          bytes = Math.max(bytes, (await fsp.stat(path.join(workDir, name))).size);
        }
        progress.bytes = bytes;
        progress.percent = progress.totalBytes ? Math.min(100, (bytes / progress.totalBytes) * 100) : null;
      } catch {
        // The folder changes under us while audible-cli renames files.
      }
    })();
  }, PROGRESS_POLL_MS);
  return () => clearInterval(timer);
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

// audible-cli ends with a generic "1 job(s) failed" summary; the line that names
// the cause ("download_aaxc failed for … : LicenseDenied: …") comes earlier.
const describeError = (error: unknown) => {
  const err = error as { stdout?: string; stderr?: string; message?: string; killed?: boolean };
  if (err.killed) return "Timed out.";
  const lines = `${err.stderr ?? ""}\n${err.stdout ?? ""}`.split("\n").map((line) => line.trim()).filter(Boolean);
  const causes = lines.filter((line) => /failed for|denied|not found|no voucher|error/i.test(line) && !/job\(s\) failed/i.test(line));
  const detail = (causes.length ? causes : lines.slice(-3)).join(" ");
  return (detail || err.message || String(error)).slice(0, 800);
};

const downloadArgs = (asin: string, workDir: string, format: "--aaxc" | "--aax") => [
  "download",
  "--asin", asin,
  format,
  "--quality", "best",
  "--cover", "--cover-size", "1215",
  "--output-dir", workDir,
  "--filename-mode", "asin_ascii",
  "--no-confirm",
  "--no-progress",
  "--timeout", "0",
];

/** Tries AAXC first and falls back to AAX, which some titles still need. */
const downloadFromAudible = async (asin: string, profile: string, workDir: string, progress: AudibleDownloadProgress) => {
  try {
    await runAudible(downloadArgs(asin, workDir, "--aaxc"), profile, DOWNLOAD_TIMEOUT_MS);
    return;
  } catch (aaxcError) {
    const aaxcReason = describeError(aaxcError);
    logger.warn("AAXC download failed, trying AAX", { asin, error: aaxcReason });
    for (const name of await fsp.readdir(workDir)) await fsp.rm(path.join(workDir, name), { force: true, recursive: true });
    Object.assign(progress, { bytes: null, totalBytes: null, percent: null });
    try {
      await runAudible(downloadArgs(asin, workDir, "--aax"), profile, DOWNLOAD_TIMEOUT_MS);
    } catch (aaxError) {
      throw new Error(`AAXC: ${aaxcReason} · AAX: ${describeError(aaxError)}`);
    }
  }
};

// ─── The job ──────────────────────────────────────────────────────────────

type LoggedTitle = { profile: string; asin: string; title: string; author: string | null; coverUrl: string | null };

/** Adds an entry to the download history. History is best effort and never fails a download. */
const logDownload = (
  title: LoggedTitle,
  entry: {
    status: "done" | "failed" | "cancelled";
    trigger: DownloadTrigger;
    error?: string | null;
    libraryId?: string | null;
    folderPath?: string | null;
    bookId?: string | null;
    sizeBytes?: number | null;
    startedAt?: Date | null;
  },
) =>
  prisma.audibleDownloadLog
    .create({
      data: {
        profile: title.profile,
        asin: title.asin,
        title: title.title,
        author: title.author,
        coverUrl: title.coverUrl,
        status: entry.status,
        trigger: entry.trigger,
        error: entry.error ?? null,
        libraryId: entry.libraryId ?? null,
        folderPath: entry.folderPath ?? null,
        bookId: entry.bookId ?? null,
        sizeBytes: entry.sizeBytes != null ? BigInt(entry.sizeBytes) : null,
        startedAt: entry.startedAt ?? null,
      },
    })
    .catch((error) => logger.warn("Couldn't record download history", { asin: title.asin, error: String(error) }));

const setPhase = (progress: AudibleDownloadProgress, phase: AudibleDownloadProgress["phase"]) => {
  Object.assign(progress, { phase, percent: null, bytes: null, totalBytes: null });
};

const waitForBook = async (folderPath: string) => {
  const deadline = Date.now() + BOOK_WAIT_MS;
  while (Date.now() < deadline) {
    const book = await prisma.book.findFirst({ where: { folderPath: { equals: folderPath, mode: "insensitive" } }, select: { id: true } });
    if (book) return book;
    await new Promise((resolve) => setTimeout(resolve, SCAN_POLL_MS));
  }
  return null;
};

const processJob = async ({ itemId, libraryId, trigger }: DownloadJob) => {
  const item = await prisma.audibleLibraryItem.findUnique({ where: { id: itemId } });
  if (!item) return;

  const progress: AudibleDownloadProgress = {
    asin: item.asin,
    title: item.title,
    phase: "downloading",
    percent: null,
    bytes: null,
    totalBytes: null,
    startedAt: new Date().toISOString(),
  };
  active.set(itemId, progress);
  const startedAt = new Date();
  const workDir = path.join(WORK_ROOT, `${item.asin}-${item.id}`);
  let stopWatching: (() => void) | null = null;
  try {
    const source = await resolveWritableLibrarySource(libraryId);
    if (!source) throw new Error("The library has no writable folder.");

    await fsp.rm(workDir, { recursive: true, force: true });
    await fsp.mkdir(workDir, { recursive: true });

    await setStatus(itemId, { downloadStatus: "downloading", downloadError: null });
    stopWatching = watchDownloadProgress(workDir, progress);
    await downloadFromAudible(item.asin, item.profile, workDir, progress);
    stopWatching();

    const files = await fsp.readdir(workDir);
    const audio = files.find((name) => /\.(aaxc|aax|mp3)$/i.test(name));
    if (!audio) throw new Error("Audible didn't deliver an audio file. The title may not be downloadable from this account.");
    const cover = files.find((name) => /\.jpe?g$/i.test(name));
    const audioPath = path.join(workDir, audio);
    const extension = path.extname(audio).toLowerCase();

    await setStatus(itemId, { downloadStatus: "converting" });
    setPhase(progress, "converting");
    const outputName = `${buildBookName(item)}${extension === ".mp3" ? ".mp3" : ".m4b"}`;
    const outputPath = path.join(workDir, `converted-${outputName}`);
    if (extension === ".mp3") {
      await fsp.rename(audioPath, outputPath);
    } else {
      const decryptArgs =
        extension === ".aaxc"
          ? await readVoucherKeys(audioPath.replace(/\.aaxc$/i, ".voucher")).then(({ key, iv }) => ["-audible_key", key, "-audible_iv", iv])
          : ["-activation_bytes", await getActivationBytes(item.profile)];
      await runFfmpeg(
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
        (seconds) => {
          if (item.durationSeconds) progress.percent = Math.min(100, (seconds / item.durationSeconds) * 100);
        },
      );
    }

    await setStatus(itemId, { downloadStatus: "importing" });
    setPhase(progress, "importing");
    const segments = buildRelativeFolder(item);
    let targetDir = path.join(source.resolvedPath, ...segments);
    if (fs.existsSync(targetDir) && (await fsp.readdir(targetDir)).length > 0) {
      targetDir = `${targetDir} [${item.asin}]`;
      if (fs.existsSync(targetDir)) throw new Error(`The folder ${targetDir} already exists.`);
    }
    if (!isInside(source.resolvedPath, targetDir)) throw new Error("The book's folder would be outside the library.");

    await fsp.mkdir(targetDir, { recursive: true });
    const finalPath = path.join(targetDir, outputName);
    await moveFile(outputPath, finalPath);
    const sizeBytes = (await fsp.stat(finalPath)).size;
    if (cover) await moveFile(path.join(workDir, cover), path.join(targetDir, "cover.jpg"));

    const scan = await requestLibraryFolderScan(libraryId, targetDir, "audible-download", { dedupe: true });
    if (scan.jobId) await waitForScanJob(scan.jobId);

    // The scan only reads the file's few tags; fill in the rest from Audible.
    const book = await waitForBook(targetDir);
    if (book) {
      await applyAudibleMetadataToBook(book.id, item).catch((error) =>
        logger.warn("Applying Audible metadata failed", { asin: item.asin, error: String(error) }),
      );
    } else {
      logger.warn("Downloaded book didn't show up after the scan", { asin: item.asin, folder: targetDir });
    }

    await setStatus(itemId, { downloadStatus: "done", downloadError: null, downloadedPath: targetDir, downloadedAt: new Date() });
    await logDownload(item, { status: "done", trigger, libraryId, folderPath: targetDir, bookId: book?.id ?? null, sizeBytes, startedAt });
    logger.info("Audible title downloaded", { asin: item.asin, title: item.title, folder: targetDir });
  } catch (error) {
    const message = describeError(error);
    logger.warn("Audible download failed", { asin: item.asin, title: item.title, error: message });
    await setStatus(itemId, { downloadStatus: "failed", downloadError: message }).catch(() => undefined);
    await logDownload(item, { status: "failed", trigger, libraryId, error: message, startedAt });
  } finally {
    stopWatching?.();
    active.delete(itemId);
    await fsp.rm(workDir, { recursive: true, force: true }).catch(() => undefined);
  }
};

/** Starts queued titles until the parallel-download limit is reached; called again as each one finishes. */
const work = async () => {
  const { maxConcurrentDownloads } = await getAudibleSyncSettings().catch(() => ({ maxConcurrentDownloads: 1 }));
  while (active.size < maxConcurrentDownloads && queue.length) {
    const job = queue.shift()!;
    // Reserve the slot before the first await so overlapping calls can't overshoot the limit.
    active.set(job.itemId, {
      asin: job.asin,
      title: job.title,
      phase: "downloading",
      percent: null,
      bytes: null,
      totalBytes: null,
      startedAt: new Date().toISOString(),
    });
    void processJob(job).finally(() => {
      active.delete(job.itemId);
      void work();
    });
  }
};

/** Starts more queued titles after the parallel-download limit is raised. */
export const resumeAudibleDownloads = () => void work();

/** Queues titles for download into the library. Titles already queued or downloading are skipped. */
export const enqueueAudibleDownloads = async (
  profile: string,
  asins: string[],
  libraryId: string,
  trigger: DownloadTrigger = "manual",
) => {
  const source = await resolveWritableLibrarySource(libraryId);
  if (!source) throw new Error("That library has no writable folder. Mark one of its folders as writable first.");

  const items = await prisma.audibleLibraryItem.findMany({
    where: {
      profile,
      asin: { in: asins },
      OR: [{ downloadStatus: null }, { downloadStatus: { notIn: ACTIVE_DOWNLOAD_STATUSES } }],
    },
    select: { id: true, asin: true, title: true },
  });
  if (!items.length) return 0;

  await prisma.audibleLibraryItem.updateMany({
    where: { id: { in: items.map((item) => item.id) } },
    data: { downloadStatus: "queued", downloadError: null },
  });
  queue.push(...items.map((item) => ({ itemId: item.id, libraryId, asin: item.asin, title: item.title, trigger })));
  void work();
  return items.length;
};

/** Takes titles that haven't started yet out of the queue. */
export const cancelQueuedAudibleDownloads = async (asins: string[]) => {
  const removed: DownloadJob[] = [];
  for (let i = queue.length - 1; i >= 0; i--) {
    if (asins.includes(queue[i].asin)) removed.push(...queue.splice(i, 1));
  }
  if (removed.length) {
    await prisma.audibleLibraryItem.updateMany({
      where: { id: { in: removed.map((job) => job.itemId) }, downloadStatus: "queued" },
      data: { downloadStatus: null, downloadError: null },
    });
    const items = await prisma.audibleLibraryItem.findMany({ where: { id: { in: removed.map((job) => job.itemId) } } });
    for (const item of items) {
      const job = removed.find((entry) => entry.itemId === item.id)!;
      await logDownload(item, { status: "cancelled", trigger: job.trigger, libraryId: job.libraryId });
    }
  }
  return removed.length;
};

/** The queue lives in memory, so downloads cut short by a restart are marked failed. */
export const reapInterruptedAudibleDownloads = async () => {
  const error = "Interrupted when the server restarted. Download it again to retry.";
  const interrupted = await prisma.audibleLibraryItem.findMany({ where: { downloadStatus: { in: ACTIVE_DOWNLOAD_STATUSES } } });
  if (!interrupted.length) return 0;
  await prisma.audibleLibraryItem.updateMany({
    where: { id: { in: interrupted.map((item) => item.id) } },
    data: { downloadStatus: "failed", downloadError: error },
  });
  // Only titles that had started count as attempts; queued ones never ran.
  for (const item of interrupted.filter((entry) => entry.downloadStatus !== "queued")) {
    await logDownload(item, { status: "failed", trigger: "manual", error });
  }
  return interrupted.length;
};
