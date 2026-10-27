import { fetchExternal } from "./externalFetch";

// Audnexus (https://audnex.us) serves Audible's chapter data by ASIN. It's the
// same source Audiobookshelf uses: accurate, named chapters without decoding
// any audio.

const AUDNEXUS_BASE_URL = "https://api.audnex.us";
const AUDNEXUS_REGIONS = new Set(["us", "ca", "uk", "au", "fr", "de", "jp", "it", "in", "es"]);
const AUDNEXUS_REGION = (() => {
  const raw = (process.env.AUDNEXUS_REGION || "").toLowerCase().trim();
  return AUDNEXUS_REGIONS.has(raw) ? raw : "us";
})();

export type AudibleChapter = { title: string; start: number; end: number };

export type AudibleChapterResult =
  | { status: "ok"; chapters: AudibleChapter[] }
  | { status: "not-found" | "mismatch" | "error"; reason: string };

type AudnexusChapters = {
  runtimeLengthMs?: number;
  chapters?: Array<{ title?: string; startOffsetMs?: number; lengthMs?: number }>;
};

export const isAsin = (value: unknown): value is string =>
  typeof value === "string" && /^[A-Z0-9]{10}$/i.test(value.trim());

/**
 * Audible's runtime may differ slightly from the files (intro/outro trims),
 * but a big gap means a different edition, whose chapter times would be wrong.
 */
export const runtimeMatches = (audibleSeconds: number, bookSeconds: number) =>
  bookSeconds > 0 && Math.abs(audibleSeconds - bookSeconds) <= Math.max(60, bookSeconds * 0.015);

/** Converts an Audnexus chapters response into chapters for a book of `bookSeconds`. */
export const audnexusToChapters = (data: AudnexusChapters, bookSeconds: number): AudibleChapterResult => {
  const rawChapters = (data.chapters ?? []).filter(
    (chapter) => Number.isFinite(chapter.startOffsetMs) && Number.isFinite(chapter.lengthMs),
  );
  if (rawChapters.length === 0) return { status: "not-found", reason: "Audible has no chapters for this ASIN" };

  const runtimeSeconds = (data.runtimeLengthMs ?? 0) / 1000;
  if (!runtimeMatches(runtimeSeconds, bookSeconds)) {
    return {
      status: "mismatch",
      reason: `Audible runtime ${Math.round(runtimeSeconds)}s doesn't match the files (${Math.round(bookSeconds)}s)`,
    };
  }

  const chapters = rawChapters
    .map((chapter, index) => {
      const start = Math.min(chapter.startOffsetMs! / 1000, bookSeconds);
      const end = Math.min((chapter.startOffsetMs! + chapter.lengthMs!) / 1000, bookSeconds);
      return { title: chapter.title?.trim() || `Chapter ${index + 1}`, start, end };
    })
    .filter((chapter) => chapter.end > chapter.start);
  // The files may run a little longer than Audible's runtime; let the last chapter reach the end.
  if (chapters.length > 0) chapters[chapters.length - 1].end = bookSeconds;

  return chapters.length > 0 ? { status: "ok", chapters } : { status: "not-found", reason: "No usable chapters" };
};

export const fetchAudibleChapters = async (asin: string, bookSeconds: number): Promise<AudibleChapterResult> => {
  if (!isAsin(asin)) return { status: "not-found", reason: "Not a valid ASIN" };
  try {
    const url = `${AUDNEXUS_BASE_URL}/books/${encodeURIComponent(asin.trim().toUpperCase())}/chapters?region=${AUDNEXUS_REGION}`;
    const response = await fetchExternal(url, { headers: { accept: "application/json" } });
    if (response.status === 404) return { status: "not-found", reason: "Audible doesn't know this ASIN" };
    if (!response.ok) return { status: "error", reason: `Audnexus returned HTTP ${response.status}` };
    return audnexusToChapters((await response.json()) as AudnexusChapters, bookSeconds);
  } catch (error) {
    return { status: "error", reason: error instanceof Error ? error.message : String(error) };
  }
};
