import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import ffmpeg from "./ffmpeg";
import { preparePathForTool } from "./libraryConfig";

// MP4 containers that benefit from a faststart remux. Other formats (mp3,
// flac, ogg, opus, wav) don't have a moov atom at all.
const FASTSTART_EXTENSIONS = new Set([".m4b", ".m4a", ".mp4"]);

const FAST_START_ENABLED = process.env.FAST_START_ENABLED !== "false";
const FAST_START_CONCURRENCY = Math.max(
  1,
  Number.parseInt(process.env.FAST_START_CONCURRENCY || "", 10) || 1,
);
const FAST_START_PROBE_BYTES = 262_144; // 256 KB is enough to land on the second atom on every file I've seen
const FAST_START_REMUX_TIMEOUT_MS =
  Number.parseInt(process.env.FAST_START_REMUX_TIMEOUT_MS || "", 10) || 30 * 60 * 1000;

const isFastStartCandidate = (filePath: string) =>
  FASTSTART_EXTENSIONS.has(path.extname(filePath).toLowerCase());

/**
 * Walks the top-level atoms in an MP4 file (just by reading 256 KB from the
 * head) and returns whether the `moov` atom appears before the `mdat` atom.
 * That's the byte order ExoPlayer / HTML5 audio need to start playing without
 * issuing a separate Range request to the tail of the file.
 *
 * Returns null when the file looks malformed or isn't a recognisable MP4 — the
 * caller should treat null as "leave the file alone".
 */
export const isFastStartMp4 = async (filePath: string): Promise<boolean | null> => {
  let handle: fsp.FileHandle | null = null;
  try {
    handle = await fsp.open(filePath, "r");
    const buffer = Buffer.alloc(FAST_START_PROBE_BYTES);
    const { bytesRead } = await handle.read(buffer, 0, FAST_START_PROBE_BYTES, 0);
    if (bytesRead < 16) return null;

    let offset = 0;
    while (offset + 8 <= bytesRead) {
      let size = buffer.readUInt32BE(offset);
      const type = buffer.toString("ascii", offset + 4, offset + 8);

      // size==1 means a 64-bit "largesize" follows the type field.
      if (size === 1) {
        if (offset + 16 > bytesRead) return null;
        const high = buffer.readUInt32BE(offset + 8);
        const low = buffer.readUInt32BE(offset + 12);
        size = high * 0x100000000 + low;
      } else if (size === 0) {
        // size==0 means "atom runs to the end of the file" — we can't continue
        // the walk meaningfully past this point, but if we got here without
        // seeing moov, the file is definitely not faststart.
        return type === "moov";
      }

      if (size < 8) return null;

      if (type === "moov") return true;
      if (type === "mdat") return false;

      offset += size;
    }

    // Ran out of probe bytes before finding either atom. Assume non-faststart
    // so we go ahead and remux; the remux is a no-op if it turns out the file
    // is already fine.
    return false;
  } catch {
    return null;
  } finally {
    if (handle) await handle.close().catch(() => {});
  }
};

/**
 * Re-mux an MP4-family file in place so the moov atom lives at the front. Uses
 * stream copy (no re-encode) so it's fast and lossless. Writes to a sibling
 * `.azure-faststart-<uniq>.tmp` first then atomically renames over the
 * original so a crash mid-remux can't leave the file in a half-written state.
 */
export const runFastStartRemux = async (filePath: string): Promise<void> => {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const ext = path.extname(filePath);
  const uniq = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const stagedPath = path.join(dir, `${base}.azure-faststart-${uniq}.tmp${ext}`);
  const backupPath = path.join(dir, `${base}.azure-faststart-${uniq}.bak`);

  await new Promise<void>((resolve, reject) => {
    let stderr = "";
    let settled = false;
    const cmd = ffmpeg(preparePathForTool(filePath, true))
      .outputOptions([
        "-c", "copy",
        "-map", "0",
        "-movflags", "+faststart",
      ])
      .output(preparePathForTool(stagedPath))
      .on("stderr", (line) => {
        stderr += line + "\n";
      })
      .on("error", (err) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        reject(new Error(`ffmpeg faststart failed for ${filePath}: ${err.message}\n${stderr}`));
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve();
      });

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      try { cmd.kill("SIGKILL"); } catch { /* ignore */ }
      reject(new Error(`ffmpeg faststart timed out after ${FAST_START_REMUX_TIMEOUT_MS}ms for ${filePath}`));
    }, FAST_START_REMUX_TIMEOUT_MS);

    cmd.run();
  });

  const pathExists = (p: string) =>
    fsp.access(p).then(() => true).catch(() => false);

  let originalMoved = false;
  try {
    await fsp.rename(filePath, backupPath);
    originalMoved = true;
    await fsp.rename(stagedPath, filePath);
    await fsp.rm(backupPath, { force: true });
  } catch (err) {
    if (await pathExists(stagedPath)) {
      await fsp.rm(stagedPath, { force: true }).catch(() => {});
    }
    if (originalMoved && (await pathExists(backupPath)) && !(await pathExists(filePath))) {
      await fsp.rename(backupPath, filePath).catch(() => {});
    }
    throw err;
  }
};

let activeRemuxes = 0;
const remuxQueue: Array<() => void> = [];
const inFlightPaths = new Set<string>();

const acquireSlot = (): Promise<void> =>
  new Promise((resolve) => {
    if (activeRemuxes < FAST_START_CONCURRENCY) {
      activeRemuxes++;
      resolve();
    } else {
      remuxQueue.push(() => {
        activeRemuxes++;
        resolve();
      });
    }
  });

const releaseSlot = () => {
  activeRemuxes--;
  const next = remuxQueue.shift();
  if (next) next();
};

/**
 * Probe the file; if it isn't already faststart, queue an in-place remux. The
 * returned promise resolves after the work is done (or skipped). Concurrency
 * is capped via `FAST_START_CONCURRENCY` so a fresh library import doesn't
 * spawn hundreds of ffmpeg processes against a NAS at once.
 */
export const ensureFastStart = async (
  filePath: string,
): Promise<"skipped" | "already-fast" | "remuxed"> => {
  if (!FAST_START_ENABLED) return "skipped";
  if (!isFastStartCandidate(filePath)) return "skipped";
  if (inFlightPaths.has(filePath)) return "skipped";

  inFlightPaths.add(filePath);
  try {
    const isFast = await isFastStartMp4(filePath);
    if (isFast === null) return "skipped";
    if (isFast) return "already-fast";

    await acquireSlot();
    try {
      console.info(`[faststart] remuxing ${filePath}`);
      const startedAt = Date.now();
      await runFastStartRemux(filePath);
      console.info(`[faststart] done ${filePath} (${Date.now() - startedAt}ms)`);
    } finally {
      releaseSlot();
    }
    return "remuxed";
  } finally {
    inFlightPaths.delete(filePath);
  }
};

/**
 * Fire-and-forget wrapper for the scanner. Logs errors instead of bubbling
 * them up because faststart is an optimisation — a failure shouldn't fail the
 * surrounding book scan.
 */
export const queueFastStart = (filePath: string): void => {
  void ensureFastStart(filePath).catch((err) => {
    console.warn(`[faststart] skipped ${filePath}: ${err?.message ?? err}`);
  });
};
