import path from "path";

const MAX_UPLOAD_FILE_SIZE_MB = 500;
export const MAX_UPLOAD_FILE_SIZE_BYTES = MAX_UPLOAD_FILE_SIZE_MB * 1024 * 1024;
export const MAX_UPLOAD_FILE_COUNT = 200;

const ALLOWED_UPLOAD_EXTENSIONS = new Set([
  ".aac",
  ".aiff",
  ".aif",
  ".flac",
  ".m4a",
  ".m4b",
  ".mp3",
  ".mp4",
  ".ogg",
  ".opus",
  ".wav",
  ".webm",
  ".jpg",
  ".jpeg",
  ".png",
  ".webp",
  ".cue",
  ".nfo",
  ".txt",
]);

const ensureInsideRoot = (rootPath: string, targetPath: string) => {
  const resolvedRoot = path.resolve(rootPath);
  const resolvedTarget = path.resolve(targetPath);
  const relative = path.relative(resolvedRoot, resolvedTarget);

  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) {
    return resolvedTarget;
  }

  throw new Error("Upload path is outside the selected library root");
};

const rejectPathLikeName = (value: string, label: string) => {
  const trimmed = value.trim();
  if (!trimmed) throw new Error(`${label} is invalid`);
  if (trimmed === "." || trimmed === "..") throw new Error(`${label} is invalid`);
  if (trimmed.includes("/") || trimmed.includes("\\")) throw new Error(`${label} is invalid`);
  if (path.isAbsolute(trimmed)) throw new Error(`${label} is invalid`);
  if (/[\u0000-\u001f\u007f]/.test(trimmed)) throw new Error(`${label} is invalid`);
  return trimmed;
};

export const sanitizeUploadFolderName = (folderName: string) =>
  rejectPathLikeName(folderName, "Folder name");

export const sanitizeUploadedFilename = (filename: string) =>
  rejectPathLikeName(filename, "Filename");

export const isAllowedUploadFilename = (filename: string) =>
  ALLOWED_UPLOAD_EXTENSIONS.has(path.extname(filename).toLowerCase());

export const resolveUploadTargetDir = (rootPath: string, folderName: string) => {
  const safeFolderName = sanitizeUploadFolderName(folderName);
  return ensureInsideRoot(rootPath, path.join(rootPath, safeFolderName));
};

export const resolveUploadedFileTarget = (
  rootPath: string,
  targetDir: string,
  originalFilename: string,
) => {
  const safeFilename = sanitizeUploadedFilename(originalFilename);
  if (!isAllowedUploadFilename(safeFilename)) {
    throw new Error("Uploaded file type is not supported");
  }

  const safeTargetDir = ensureInsideRoot(rootPath, targetDir);
  return ensureInsideRoot(rootPath, path.join(safeTargetDir, safeFilename));
};
