import path from "path";
import { normalizeSourcePath } from "../../utils/libraryConfig";

export const getSingleParam = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

export const getSingleBodyValue = (value: unknown): string | null =>
  typeof value === "string" && value.trim() ? value.trim() : null;

export const getOptionalBodyValue = (value: unknown): string | undefined =>
  typeof value === "string" ? value.trim() : undefined;

export const isBoolean = (value: unknown): value is boolean => typeof value === "boolean";

export const toNullableString = (value: unknown) => {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed ? trimmed : null;
};

export const toNullableNumber = (value: unknown) => {
  if (value === null || value === undefined || value === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};

export const pathBelongsToRoot = (folderPath: string, rootPath: string) => {
  const normalizedFolder = normalizeSourcePath(folderPath);
  const normalizedRoot = normalizeSourcePath(rootPath);
  const relative = path.relative(normalizedRoot, normalizedFolder);

  return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
};
