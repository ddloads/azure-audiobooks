export const coverUrl = (coverPath: string | null | undefined, width: number): string | undefined => {
  if (!coverPath) return undefined;
  if (!coverPath.startsWith("/api/library/cover/")) return coverPath;

  const separator = coverPath.includes("?") ? "&" : "?";
  return `${coverPath}${separator}w=${width}`;
};
