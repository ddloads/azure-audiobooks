import { generateSmartChapters, type ChapterInputAudioFile, type GeneratedChapter } from "../chapterizer";
import { fetchAudibleChapters, isAsin } from "../audnexus";

export type ChaptersSource = "embedded" | "audible" | "generated";

/**
 * Chapters for a book that has none embedded: Audible's (by ASIN) when they
 * match the files' runtime, otherwise generated from files, pauses or even
 * spacing.
 */
export const buildChapters = async (options: {
  asin: string | null | undefined;
  audioFiles: ChapterInputAudioFile[];
  totalDuration: number;
  audible: boolean;
  silence: boolean;
}): Promise<{ chapters: GeneratedChapter[]; source: ChaptersSource }> => {
  if (options.audible && isAsin(options.asin) && options.totalDuration > 0) {
    const result = await fetchAudibleChapters(options.asin, options.totalDuration);
    if (result.status === "ok") return { chapters: result.chapters, source: "audible" };
  }

  const chapters = await generateSmartChapters(options.audioFiles, options.totalDuration, { silence: options.silence });
  return { chapters, source: "generated" };
};
