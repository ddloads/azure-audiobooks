import path from "path";

const normalizeWhitespace = (value: string | null | undefined) =>
  (value ?? "").replace(/\s+/g, " ").trim();

const normalizeComparableTitle = (value: string | null | undefined) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[\u2018\u2019\u02bc']/g, "")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const stripLeadingBookMarker = (value: string) =>
  value
    .replace(/^\((?:book|block|ebook|audiobook)\s*\d+\)\s*/i, "")
    .replace(/^\((?:book|block|ebook|audiobook)\)\s*/i, "")
    .replace(/^(?:book|block|ebook|audiobook)\s*\d+\s*[:\-)\]]\s*/i, "")
    .replace(/^(?:book|block|ebook|audiobook)\s*\d+\s+/i, "")
    .replace(/^(?:book|block|ebook|audiobook)\s*[:\-]\s*/i, "");

const stripTrackPrefix = (value: string) =>
  value
    .replace(/^(?:0\d{1,2}|[1-9]\d?)\s*[-:.]\s*/i, "")
    .replace(/^(?:0\d{1,2}|[1-9]\d?)\s+of\s+\d{1,3}\s*/i, "")
    .replace(/^0\d{1,2}\s+/i, "")
    .replace(/^(?:cd|disc|track|part|chapter)\s*\d+\s*[-:.]?\s*/i, "");

const hasLooseNumericPrefix = (value: string) =>
  /^(?:0\d{1,2}|[1-9]\d?)\s+[a-z(]/i.test(normalizeWhitespace(value));

const isLikelyTrackTitle = (value: string) => {
  const normalized = normalizeComparableTitle(value);
  if (!normalized) return false;

  return (
    /^(?:0\d{1,2}|[1-9]\d?)\s*[-:.]/.test(normalizeWhitespace(value)) ||
    /^(?:0\d{1,2}|[1-9]\d?)\s+of\s+\d{1,3}\b/i.test(normalizeWhitespace(value)) ||
    /^0\d{1,2}\s+/.test(normalizeWhitespace(value)) ||
    /^(?:prologue|intro|introduction|foreword|preface|chapter \d+|epilogue)\b/.test(normalized)
  );
};

export const deriveTitleFromFolderName = (folderNameOrPath: string) => {
  const folderName = path.basename(folderNameOrPath);
  const normalizedFolderName = normalizeWhitespace(folderName.replace(/[_]+/g, " "));

  if (normalizedFolderName.includes(" - ")) {
    const parts = normalizedFolderName.split(" - ");
    if (parts.length > 1) {
      return normalizeWhitespace(parts.slice(1).join(" - "));
    }
  }

  return normalizedFolderName;
};

export const cleanupBookTitle = (
  rawTitle: string | null | undefined,
  options?: { folderNameOrPath?: string | null },
) => {
  const folderTitle = options?.folderNameOrPath
    ? deriveTitleFromFolderName(options.folderNameOrPath)
    : "";
  const baseTitle = normalizeWhitespace(rawTitle);

  if (!baseTitle) {
    return folderTitle || "";
  }

  const withoutBookMarker = normalizeWhitespace(stripLeadingBookMarker(baseTitle));
  const strippedTitle = normalizeWhitespace(stripTrackPrefix(withoutBookMarker));
  const baseComparable = normalizeComparableTitle(baseTitle);

  if (!folderTitle) {
    return strippedTitle || withoutBookMarker || baseTitle;
  }

  const strippedComparable = normalizeComparableTitle(strippedTitle);
  const folderComparable = normalizeComparableTitle(folderTitle);

  if (isLikelyTrackTitle(baseTitle)) {
    return folderTitle;
  }

  if (hasLooseNumericPrefix(baseTitle) && baseComparable !== folderComparable) {
    return folderTitle;
  }

  if (withoutBookMarker !== baseTitle || strippedTitle !== withoutBookMarker) {
    if (!strippedComparable || strippedComparable === folderComparable) {
      return folderTitle;
    }
  }

  return strippedTitle || folderTitle;
};
