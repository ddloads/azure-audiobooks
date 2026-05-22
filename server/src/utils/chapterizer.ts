import path from "path";
import ffmpeg from "./ffmpeg";
import { cleanupBookTitle } from "./titleCleanup";
import { preparePathForTool } from "./libraryConfig";

export type ChapterInputAudioFile = {
  filename: string;
  title: string | null;
  path: string;
  duration: number;
  index: number;
};

export type GeneratedChapter = {
  title: string;
  start: number;
  end: number;
};

const MIN_CHAPTER_SECONDS = 5 * 60;
const TARGET_CHAPTER_SECONDS = 18 * 60;
const MAX_CHAPTER_SECONDS = 30 * 60;
const MIN_SILENCE_SECONDS = 1.25;
const SILENCE_THRESHOLD = "-38dB";

const clampTime = (value: number, min: number, max: number) =>
  Math.min(max, Math.max(min, value));

const roundTime = (value: number) => Math.round(value * 1000) / 1000;

const isMeaningfulTitle = (value: string | null | undefined) => {
  if (!value) return false;
  const normalized = value.trim().toLowerCase();
  if (!normalized) return false;
  if (/^(track|audio|file|chapter)?\s*\d+$/i.test(normalized)) return false;
  return normalized.length >= 3;
};

const titleFromAudioFile = (audioFile: ChapterInputAudioFile, chapterNumber: number) => {
  if (isMeaningfulTitle(audioFile.title)) {
    return cleanupBookTitle(audioFile.title || "", { folderNameOrPath: audioFile.filename });
  }

  const baseName = path.parse(audioFile.filename).name
    .replace(/^[\s._-]*\d+[\s._-]*/g, "")
    .replace(/[_-]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (isMeaningfulTitle(baseName)) {
    return cleanupBookTitle(baseName, { folderNameOrPath: audioFile.filename });
  }

  return `Chapter ${chapterNumber}`;
};

const normalizeChapters = (chapters: GeneratedChapter[], totalDuration: number) =>
  chapters
    .map((chapter, index) => ({
      title: chapter.title || `Chapter ${index + 1}`,
      start: roundTime(clampTime(chapter.start, 0, totalDuration)),
      end: roundTime(clampTime(chapter.end, 0, totalDuration)),
    }))
    .filter((chapter) => chapter.end - chapter.start >= 1)
    .map((chapter, index) => ({
      ...chapter,
      title: chapter.title || `Chapter ${index + 1}`,
    }));

const createSingleChapter = (totalDuration: number): GeneratedChapter[] =>
  totalDuration > 0 ? [{ title: "Chapter 1", start: 0, end: totalDuration }] : [];

const chapterizeByAudioFiles = (
  audioFiles: ChapterInputAudioFile[],
  totalDuration: number,
): GeneratedChapter[] => {
  if (audioFiles.length <= 1) return [];

  const chapters: GeneratedChapter[] = [];
  let groupStart = 0;
  let groupDuration = 0;
  let groupFirstFile: ChapterInputAudioFile | null = null;

  const closeGroup = (end: number) => {
    if (!groupFirstFile) return;
    const chapterNumber = chapters.length + 1;
    chapters.push({
      title: titleFromAudioFile(groupFirstFile, chapterNumber),
      start: groupStart,
      end,
    });
    groupStart = end;
    groupDuration = 0;
    groupFirstFile = null;
  };

  for (let index = 0; index < audioFiles.length; index++) {
    const audioFile = audioFiles[index];
    if (audioFile.duration <= 0) continue;
    if (!groupFirstFile) groupFirstFile = audioFile;
    groupDuration += audioFile.duration;

    const nextDuration = audioFiles[index + 1]?.duration ?? 0;
    const shouldClose =
      groupDuration >= TARGET_CHAPTER_SECONDS ||
      groupDuration + nextDuration > MAX_CHAPTER_SECONDS ||
      audioFile.duration >= MIN_CHAPTER_SECONDS;

    if (shouldClose) {
      closeGroup(groupStart + groupDuration);
    }
  }

  if (groupFirstFile) {
    closeGroup(totalDuration);
  }

  const last = chapters.at(-1);
  const previous = chapters.at(-2);
  if (last && previous && last.end - last.start < MIN_CHAPTER_SECONDS) {
    previous.end = last.end;
    chapters.pop();
  }

  return normalizeChapters(chapters, totalDuration);
};

type SilenceWindow = {
  start: number;
  end: number;
};

const detectSilences = (audioPath: string, duration: number) =>
  new Promise<SilenceWindow[]>((resolve) => {
    if (process.env.AUTO_CHAPTERIZE_SILENCE === "0") {
      resolve([]);
      return;
    }

    let stderr = "";
    const timeoutMs = Math.min(180_000, Math.max(45_000, Math.round(duration * 35)));
    let settled = false;

    const command = ffmpeg(preparePathForTool(audioPath, true))
      .noVideo()
      .audioFilters(`silencedetect=n=${SILENCE_THRESHOLD}:d=${MIN_SILENCE_SECONDS}`)
      .format("null")
      .output("-");

    const timeout = setTimeout(() => {
      if (settled) return;
      settled = true;
      command.kill("SIGKILL");
      resolve([]);
    }, timeoutMs);

    command
      .on("stderr", (line) => {
        stderr += `${line}\n`;
      })
      .on("end", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve(parseSilenceWindows(stderr));
      })
      .on("error", () => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        resolve([]);
      })
      .run();
  });

const parseSilenceWindows = (ffmpegOutput: string): SilenceWindow[] => {
  const windows: SilenceWindow[] = [];
  let currentStart: number | null = null;

  for (const line of ffmpegOutput.split(/\r?\n/)) {
    const startMatch = line.match(/silence_start:\s*([0-9.]+)/);
    if (startMatch) {
      currentStart = Number(startMatch[1]);
      continue;
    }

    const endMatch = line.match(/silence_end:\s*([0-9.]+)/);
    if (endMatch && currentStart !== null) {
      const end = Number(endMatch[1]);
      if (Number.isFinite(currentStart) && Number.isFinite(end) && end > currentStart) {
        windows.push({ start: currentStart, end });
      }
      currentStart = null;
    }
  }

  return windows;
};

const chapterizeBySilence = async (
  audioFile: ChapterInputAudioFile,
  totalDuration: number,
): Promise<GeneratedChapter[]> => {
  if (totalDuration < TARGET_CHAPTER_SECONDS * 1.35) return [];

  const silences = (await detectSilences(audioFile.path, totalDuration))
    .map((silence) => (silence.start + silence.end) / 2)
    .filter((time) => time >= MIN_CHAPTER_SECONDS && time <= totalDuration - MIN_CHAPTER_SECONDS)
    .sort((a, b) => a - b);

  if (silences.length === 0) return [];

  const breakpoints: number[] = [0];
  let cursor = 0;

  while (totalDuration - cursor > MAX_CHAPTER_SECONDS) {
    const ideal = cursor + TARGET_CHAPTER_SECONDS;
    const min = cursor + MIN_CHAPTER_SECONDS;
    const max = Math.min(cursor + MAX_CHAPTER_SECONDS, totalDuration - MIN_CHAPTER_SECONDS);
    const candidate = silences
      .filter((time) => time > min && time < max)
      .sort((a, b) => Math.abs(a - ideal) - Math.abs(b - ideal))[0];

    if (!candidate) break;
    breakpoints.push(candidate);
    cursor = candidate;
  }

  if (breakpoints.length === 1) return [];
  breakpoints.push(totalDuration);

  return normalizeChapters(
    breakpoints.slice(0, -1).map((start, index) => ({
      title: `Chapter ${index + 1}`,
      start,
      end: breakpoints[index + 1],
    })),
    totalDuration,
  );
};

const chapterizeByDuration = (totalDuration: number): GeneratedChapter[] => {
  if (totalDuration <= 0) return [];
  if (totalDuration < TARGET_CHAPTER_SECONDS * 1.35) return createSingleChapter(totalDuration);

  const chapterCount = Math.max(2, Math.round(totalDuration / TARGET_CHAPTER_SECONDS));
  const chapterLength = totalDuration / chapterCount;

  return normalizeChapters(
    Array.from({ length: chapterCount }, (_, index) => ({
      title: `Chapter ${index + 1}`,
      start: index * chapterLength,
      end: index === chapterCount - 1 ? totalDuration : (index + 1) * chapterLength,
    })),
    totalDuration,
  );
};

export const generateSmartChapters = async (
  audioFiles: ChapterInputAudioFile[],
  totalDuration: number,
): Promise<GeneratedChapter[]> => {
  const validAudioFiles = audioFiles
    .filter((audioFile) => audioFile.duration > 0)
    .sort((a, b) => a.index - b.index);

  if (validAudioFiles.length === 0 || totalDuration <= 0) {
    return [];
  }

  const fileChapters = chapterizeByAudioFiles(validAudioFiles, totalDuration);
  if (fileChapters.length > 0) {
    return fileChapters;
  }

  if (validAudioFiles.length === 1) {
    const silenceChapters = await chapterizeBySilence(validAudioFiles[0], totalDuration);
    if (silenceChapters.length > 0) {
      return silenceChapters;
    }
  }

  return chapterizeByDuration(totalDuration);
};
