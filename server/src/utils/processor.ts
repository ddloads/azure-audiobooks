import { spawn } from "child_process";
import ffmpeg, { tonePath } from "./ffmpeg";
import path from "path";
import fs from "fs";
import { preparePathForTool } from "./libraryConfig";

type AudioStreamMetadata = {
  codec_name?: string;
  sample_rate?: string | number;
  channels?: number;
};

const findExecutableOnPath = (name: string) => {
  const pathEntries = (process.env.PATH || "").split(path.delimiter).filter(Boolean);
  const extensions = process.platform === "win32" ? ["", ".exe", ".cmd", ".bat"] : [""];

  for (const entry of pathEntries) {
    for (const extension of extensions) {
      const candidate = path.join(entry, `${name}${extension}`);
      if (fs.existsSync(candidate)) {
        return candidate;
      }
    }
  }

  return null;
};

const resolveTonePath = () => {
  const configuredPath = process.env.TONE_PATH?.trim();
  if (configuredPath) {
    return fs.existsSync(configuredPath) ? configuredPath : null;
  }

  if (fs.existsSync(tonePath)) {
    return tonePath;
  }

  return findExecutableOnPath("tone");
};

const normalizePublishingDate = (value: string | null | undefined): string | null => {
  const raw = value?.trim();
  if (!raw) return null;

  if (/^\d{4}$/.test(raw)) {
    return `${raw}-01-01`;
  }

  const yearMonth = raw.match(/^(\d{4})[-/](\d{1,2})$/);
  if (yearMonth) {
    const [, year, month] = yearMonth;
    const numericMonth = Number(month);
    if (numericMonth >= 1 && numericMonth <= 12) {
      return `${year}-${String(numericMonth).padStart(2, "0")}-01`;
    }
  }

  const fullDate = raw.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (fullDate) {
    const [, year, month, day] = fullDate;
    const numericMonth = Number(month);
    const numericDay = Number(day);
    if (numericMonth >= 1 && numericMonth <= 12 && numericDay >= 1 && numericDay <= 31) {
      return `${year}-${String(numericMonth).padStart(2, "0")}-${String(numericDay).padStart(2, "0")}`;
    }
  }

  const extractedYear = raw.match(/\b(\d{4})\b/)?.[1];
  return extractedYear ? `${extractedYear}-01-01` : null;
};

const resolveEmbedTimeoutMs = (
  audioPath: string,
  overrideTimeoutMs?: number,
) => {
  if (overrideTimeoutMs != null) {
    return Math.max(1_000, overrideTimeoutMs);
  }

  const minimumTimeoutMs = 180_000;
  const maximumTimeoutMs = 900_000;
  let timeoutMs = minimumTimeoutMs;

  if (audioPath.startsWith("\\\\")) {
    // Network shares are often noticeably slower for in-place M4B rewrites.
    timeoutMs += 120_000;
  }

  try {
    const stats = fs.statSync(audioPath);
    const halfGigabyte = 512 * 1024 * 1024;
    const extraChunks = Math.max(0, Math.ceil(stats.size / halfGigabyte) - 1);
    timeoutMs += extraChunks * 60_000;
  } catch {
    // If stat fails, fall back to the baseline timeout.
  }

  return Math.min(timeoutMs, maximumTimeoutMs);
};

const getTaggingTempRoot = () => {
  const tempRoot = path.join(process.cwd(), "data", "temp", "tagging");
  fs.mkdirSync(tempRoot, { recursive: true });
  return tempRoot;
};

const getMergeTempRoot = () => {
  const tempRoot = path.join(process.cwd(), "data", "temp", "merge");
  fs.mkdirSync(tempRoot, { recursive: true });
  return tempRoot;
};

const shouldUseLocalTempTagging = (audioPath: string) => {
  if (process.env.FORCE_LOCAL_TEMP_TAGGING === "1") {
    return true;
  }

  return audioPath.startsWith("\\\\");
};

const shouldUseLocalTempMerge = (audioFiles: string[], outputFolder: string) => {
  if (process.env.FORCE_LOCAL_TEMP_MERGE === "1") {
    return true;
  }

  return outputFolder.startsWith("\\\\") || audioFiles.some((audioPath) => audioPath.startsWith("\\\\"));
};

const runToneTag = (
  resolvedTonePath: string,
  audioPath: string,
  metadata: {
    title?: string | null;
    author?: string | null;
    subtitle?: string | null;
    narrator?: string | null;
    series?: string | null;
    seriesSequence?: number | null;
    description?: string | null;
    publisher?: string | null;
    year?: string | null;
    genres?: string | null;
    coverPath?: string | null;
  },
  options?: {
    timeoutMs?: number;
  },
) =>
  new Promise<void>((resolve, reject) => {
    const toolPath = preparePathForTool(audioPath);
    const args = ["tag", toolPath, "--assume-yes"];
    const publishingDate = normalizePublishingDate(metadata.year);

    if (metadata.title) args.push("--meta-title", metadata.title);
    if (metadata.author) {
      args.push("--meta-artist", metadata.author);
      args.push("--meta-album-artist", metadata.author);
    }
    if (metadata.subtitle) args.push("--meta-subtitle", metadata.subtitle);
    if (metadata.narrator) args.push("--meta-narrator", metadata.narrator);
    if (metadata.description) args.push("--meta-description", metadata.description);
    if (metadata.genres) args.push("--meta-genre", metadata.genres);
    if (metadata.publisher) args.push("--meta-publisher", metadata.publisher);
    if (publishingDate) args.push("--meta-publishing-date", publishingDate);
    if (metadata.series) args.push("--meta-album", metadata.series);
    if (metadata.seriesSequence != null) {
      args.push("--meta-track-number", metadata.seriesSequence.toString());
    }

    if (metadata.coverPath && fs.existsSync(metadata.coverPath)) {
      args.push("--meta-cover-file", preparePathForTool(metadata.coverPath));
    }

    if (audioPath.toLowerCase().endsWith(".m4b")) {
      args.push("--meta-itunes-media-type", "Audiobook");
    }

    const proc = spawn(resolvedTonePath, args);
    let stdOutput = "";
    let errorOutput = "";
    let settled = false;
    const timeoutMs = resolveEmbedTimeoutMs(audioPath, options?.timeoutMs);
    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      proc.kill("SIGKILL");
      reject(
        new Error(
          `Tone timed out after ${Math.round(timeoutMs / 1000)}s while writing tags to ${audioPath}`,
        ),
      );
    }, timeoutMs);

    const finalize = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      callback();
    };

    proc.stdout.on("data", (data) => {
      stdOutput += data.toString();
    });

    proc.stderr.on("data", (data) => {
      errorOutput += data.toString();
    });

    proc.on("error", (error) => {
      finalize(() => reject(error));
    });

    proc.on("close", (code) => {
      finalize(() => {
        if (code === 0) {
          resolve();
        } else {
          const output = [errorOutput.trim(), stdOutput.trim()].filter(Boolean).join("\n");
          const details = output || `command: ${resolvedTonePath} ${args.join(" ")}`;
          reject(new Error(`Tone exited with code ${code}: ${details}`));
        }
      });
    });
  });

const replaceOriginalFromTaggedTemp = async (originalPath: string, taggedTempPath: string) => {
  const destinationDir = path.dirname(originalPath);
  const baseName = path.basename(originalPath);
  const uniqueId = `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
  const stagedPath = path.join(destinationDir, `${baseName}.azure-tagging-${uniqueId}.tmp`);
  const backupPath = path.join(destinationDir, `${baseName}.azure-tagging-${uniqueId}.bak`);
  let originalMoved = false;

  const pathExists = (p: string) =>
    fs.promises.access(p).then(() => true).catch(() => false);

  try {
    await fs.promises.copyFile(taggedTempPath, stagedPath);
    await fs.promises.rename(originalPath, backupPath);
    originalMoved = true;
    await fs.promises.rename(stagedPath, originalPath);
    await fs.promises.rm(backupPath, { force: true });
  } catch (error) {
    if (await pathExists(stagedPath)) {
      await fs.promises.rm(stagedPath, { force: true });
    }

    if (originalMoved && (await pathExists(backupPath)) && !(await pathExists(originalPath))) {
      await fs.promises.rename(backupPath, originalPath);
    }

    throw error;
  }
};

const probePrimaryAudioStream = (audioPath: string): Promise<AudioStreamMetadata | null> =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(preparePathForTool(audioPath, true), (err, metadata) => {
      if (err) {
        reject(err);
        return;
      }

      const audioStream = metadata.streams?.find((stream) => stream.codec_type === "audio");
      resolve(
        audioStream
          ? {
              codec_name: audioStream.codec_name,
              sample_rate: audioStream.sample_rate,
              channels: audioStream.channels,
            }
          : null,
      );
    });
  });

const getMergeOutputOptions = async (audioFiles: string[]) => {
  const compatibleCodecs = new Set(["aac", "alac"]);
  const streams = await Promise.all(audioFiles.map((audioPath) => probePrimaryAudioStream(audioPath)));
  const validStreams = streams.filter((stream): stream is AudioStreamMetadata => stream != null);

  if (validStreams.length !== audioFiles.length) {
    throw new Error("Unable to determine audio codec for one or more files before merge.");
  }

  const [firstStream] = validStreams;
  const canStreamCopy = validStreams.every(
    (stream) =>
      stream.codec_name != null &&
      compatibleCodecs.has(stream.codec_name) &&
      stream.codec_name === firstStream.codec_name &&
      stream.sample_rate === firstStream.sample_rate &&
      stream.channels === firstStream.channels,
  );

  if (canStreamCopy) {
    return ["-map 0:a:0", "-c:a copy", "-vn", "-sn"];
  }

  return ["-map 0:a:0", "-c:a aac", "-b:a 96k", "-vn", "-sn", "-movflags +faststart"];
};

const runMergeFfmpeg = (audioFiles: string[], outputPath: string, outputOptions: string[]) =>
  new Promise<string>((resolve, reject) => {
    const listPath = path.join(path.dirname(outputPath), `concat_list_${Date.now()}.txt`);
    const listContent = audioFiles
      .map((filePath) => `file '${path.resolve(filePath).replace(/\\/g, "/")}'`)
      .join("\n");
    fs.writeFileSync(listPath, listContent);

    let ffmpegErr = "";

    ffmpeg()
      .input(listPath)
      .inputOptions(["-f concat", "-safe 0"])
      .outputOptions(outputOptions)
      .save(preparePathForTool(outputPath))
      .on("stderr", (line) => {
        ffmpegErr += line + "\n";
      })
      .on("end", () => {
        if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
        resolve(outputPath);
      })
      .on("error", (err) => {
        if (fs.existsSync(listPath)) fs.unlinkSync(listPath);
        const detailedError = new Error(`FFmpeg failed: ${err.message}\n${ffmpegErr}`);
        reject(detailedError);
      });
  });

export const mergeToM4B = async (
  audioFiles: string[],
  outputFolder: string,
  outputFileName: string,
  options?: {
    onStage?: (stage: "staging" | "merging" | "copying-output", detail: string) => void;
  },
): Promise<string> => {
  const outputOptions = await getMergeOutputOptions(audioFiles);
  const outputPath = path.join(outputFolder, outputFileName);

  if (!shouldUseLocalTempMerge(audioFiles, outputFolder)) {
    options?.onStage?.("merging", "Processing files directly in the source library");
    return runMergeFfmpeg(audioFiles, outputPath, outputOptions);
  }

  const workDir = fs.mkdtempSync(path.join(getMergeTempRoot(), "merge-"));
  const stagedInputPaths: string[] = [];
  const localOutputPath = path.join(workDir, outputFileName);

  try {
    options?.onStage?.("staging", `Copying ${audioFiles.length} source files to a local temp workspace`);
    for (const [index, audioPath] of audioFiles.entries()) {
      const stagedInputPath = path.join(
        workDir,
        `${String(index).padStart(3, "0")}-${path.basename(audioPath)}`,
      );
      fs.copyFileSync(audioPath, stagedInputPath);
      stagedInputPaths.push(stagedInputPath);
    }

    options?.onStage?.("merging", "Merging files locally before writing the final M4B back to the library");
    await runMergeFfmpeg(stagedInputPaths, localOutputPath, outputOptions);

    options?.onStage?.("copying-output", "Copying the finished M4B back to the source folder");
    fs.copyFileSync(localOutputPath, outputPath);
    return outputPath;
  } finally {
    fs.rmSync(workDir, { recursive: true, force: true });
  }
};

export const extractCover = async (audioPath: string, outputPath: string): Promise<void> => {
  const tryExtract = (inputPath: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      ffmpeg(inputPath)
        .outputOptions("-map 0:v?", "-map 0:t?")
        .output(preparePathForTool(outputPath))
        .frames(1)
        .on("end", () => resolve())
        .on("error", (err) => reject(err))
        .run();
    });
  };

  try {
    // Try with forward slashes (usually most reliable for FFmpeg on Windows/UNC)
    await tryExtract(preparePathForTool(audioPath, true));
  } catch (err) {
    try {
      // Fallback: Try with backslashes
      await tryExtract(preparePathForTool(audioPath, false));
    } catch (err2) {
      // Final fallback: try raw path as-is if it's a UNC path that might have been mangled by normalization
      if (audioPath.startsWith("\\\\")) {
         await tryExtract(audioPath);
      } else {
         throw err2;
      }
    }
  }
};

export const embedMetadata = async (
  audioPath: string,
  metadata: {
    title?: string | null;
    author?: string | null;
    subtitle?: string | null;
    narrator?: string | null;
    series?: string | null;
    seriesSequence?: number | null;
    description?: string | null;
    publisher?: string | null;
    year?: string | null;
    genres?: string | null;
    coverPath?: string | null;
  },
  options?: {
    timeoutMs?: number;
  },
): Promise<void> => {
  const resolvedTonePath = resolveTonePath();
  if (!resolvedTonePath) {
    const configuredPath = process.env.TONE_PATH?.trim();
    const installHint = configuredPath
      ? `Configured TONE_PATH does not exist: ${configuredPath}.`
      : `Set TONE_PATH, install tone on PATH, or place tone at ${tonePath}.`;

    throw new Error(
      `Tone executable not found. ${installHint}`,
    );
  }

  if (!shouldUseLocalTempTagging(audioPath)) {
    await runToneTag(resolvedTonePath, audioPath, metadata, options);
    return;
  }

  const workDir = await fs.promises.mkdtemp(path.join(getTaggingTempRoot(), "embed-"));
  const tempAudioPath = path.join(workDir, path.basename(audioPath));

  try {
    await fs.promises.copyFile(audioPath, tempAudioPath);
    await runToneTag(resolvedTonePath, tempAudioPath, metadata, options);
    await replaceOriginalFromTaggedTemp(audioPath, tempAudioPath);
  } finally {
    await fs.promises.rm(workDir, { recursive: true, force: true });
  }
};
