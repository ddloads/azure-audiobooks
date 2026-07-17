import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import ffmpeg from "../ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import { getConfiguredLibraries, normalizeSourcePath, preparePathForTool } from "../libraryConfig";

export const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".m4b", ".aac", ".flac", ".wav", ".ogg"];
export const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
export const PROTECTED_DIRECTORY_NAMES = new Set([".azure-trash", ".merged-backup"]);
export const COVER_NAME_HINTS = ["cover", "folder", "front", "poster", "artwork", "jacket"];
export const NON_COVER_NAME_HINTS = ["back", "spine", "logo", "banner", "thumbnail", "sample", "promo"];

// Increment this when new metadata fields are added to force re-extraction on next scan
export const METADATA_VERSION = 4;

export type LibraryWithSources = Awaited<ReturnType<typeof getConfiguredLibraries>>[number];

export type DiscoveredFolder = {
  libraryId: string;
  folderName: string;
  folderPath: string;
  files: string[];
};

export type ScanProgressPayload = {
  libraryId?: string;
  status: "starting" | "scanning" | "completed" | "failed";
  progress: number;
  currentFolder?: string;
  totalFolders?: number;
  scannedFolders?: number;
};

export type ScanRunContext = {
  emitProgress?: (data: ScanProgressPayload) => void;
  shouldStop?: () => boolean;
  trigger?: string;
};

export const canonicalizeFolderPath = (input: string) => {
  const normalized = normalizeSourcePath(input);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

export const sameOrderedFilenames = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  return left.every((filename, index) => filename.toLowerCase() === right[index].toLowerCase());
};

export const isProtectedDirectory = (dirPath: string) => {
  const segments = path.normalize(dirPath).split(path.sep).filter(Boolean);
  return segments.some((segment) => PROTECTED_DIRECTORY_NAMES.has(segment));
};

export const probeImageDimensions = async (filePath: string) => {
  try {
    const metadata = await probeFile(preparePathForTool(filePath, true));
    const stream = metadata?.streams?.find((entry: any) => {
      const width = Number(entry?.width);
      const height = Number(entry?.height);
      return Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0;
    });

    if (!stream) {
      return null;
    }

    const width = Number(stream.width);
    const height = Number(stream.height);
    if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
      return null;
    }

    return { width, height };
  } catch {
    return null;
  }
};

export const looksLikeCoverImage = async (filePath: string) => {
  const dimensions = await probeImageDimensions(filePath);
  if (!dimensions) {
    return true;
  }

  const { width, height } = dimensions;
  const ratio = width / height;
  const area = width * height;

  return area >= 50_000 && ratio >= 0.65 && ratio <= 1.65;
};

export const chooseFolderCoverImage = async (folderPath: string, files: string[]) => {
  const imageFiles = files.filter((file) => IMAGE_EXTENSIONS.includes(path.extname(file).toLowerCase()));
  if (imageFiles.length === 0) {
    return null;
  }

  if (imageFiles.length === 1) {
    return imageFiles[0];
  }

  const scored = await Promise.all(
    imageFiles.map(async (file) => {
      const name = path.parse(file).name.toLowerCase();
      const fullPath = path.join(folderPath, file);
      const dimensions = await probeImageDimensions(fullPath);
      const size = fs.existsSync(fullPath) ? fs.statSync(fullPath).size : 0;

      let score = 0;
      if (COVER_NAME_HINTS.includes(name)) score += 100;
      if (COVER_NAME_HINTS.some((hint) => name.includes(hint))) score += 40;
      if (NON_COVER_NAME_HINTS.some((hint) => name.includes(hint))) score -= 80;

      if (dimensions) {
        const ratio = dimensions.width / dimensions.height;
        const area = dimensions.width * dimensions.height;
        if (ratio >= 0.75 && ratio <= 1.5) score += 40;
        else score -= 20;

        if (area >= 200_000) score += 20;
        else if (area >= 80_000) score += 10;
        else score -= 10;
      } else {
        score -= 5;
      }

      score += Math.min(20, Math.log10(Math.max(size, 1)) * 4);

      return { file, score };
    }),
  );

  scored.sort((a, b) => b.score - a.score);
  const best = scored[0];
  if (!best || best.score < 20) {
    return null;
  }

  return best.file;
};

export const probeFile = (toolPath: string): Promise<any> =>
  new Promise((resolve, reject) => {
    ffmpeg.ffprobe(toolPath, (err, metadata) => {
      if (!err && metadata) {
        resolve(metadata);
      } else {
        // Fallback for files that ffprobe might fail on (exit code 1) but still have metadata (like xHE-AAC)
        try {
          const result = spawnSync(ffprobeInstaller.path, [
            "-v",
            "quiet",
            "-print_format",
            "json",
            "-show_format",
            "-show_streams",
            toolPath,
          ]);

          if (result.stdout) {
            const manualMetadata = JSON.parse(result.stdout.toString());
            if (manualMetadata?.format?.duration != null) {
              resolve(manualMetadata);
              return;
            }
          }
        } catch (fallbackErr) {
          // Ignore fallback error
        }

        reject(err || new Error("Metadata extraction failed"));
      }
    });
  });

export const getAudioMetadata = (filePath: string): Promise<any> =>
  probeFile(preparePathForTool(filePath, true)).catch(() =>
    probeFile(preparePathForTool(filePath, false)),
  );
