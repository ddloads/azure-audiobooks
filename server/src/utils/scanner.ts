import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import ffmpeg from "./ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import prisma from "../lib/prisma";
import { extractCover } from "./processor";
import { queueFastStart } from "./faststart";
import { generateSmartChapters, type ChapterInputAudioFile } from "./chapterizer";
import { getCoverUrl, findCoverInFolder } from "./covers";
import { cleanupBookTitle } from "./titleCleanup";
import {
  getConfiguredLibraries,
  normalizeSourcePath,
  preparePathForTool,
} from "./libraryConfig";

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".m4b", ".aac", ".flac", ".wav", ".ogg"];
const IMAGE_EXTENSIONS = [".jpg", ".jpeg", ".png", ".webp"];
const PROTECTED_DIRECTORY_NAMES = new Set([".azure-trash", ".merged-backup"]);
const COVER_NAME_HINTS = ["cover", "folder", "front", "poster", "artwork", "jacket"];
const NON_COVER_NAME_HINTS = ["back", "spine", "logo", "banner", "thumbnail", "sample", "promo"];

// Increment this when new metadata fields are added to force re-extraction on next scan
const METADATA_VERSION = 3;

type LibraryWithSources = Awaited<ReturnType<typeof getConfiguredLibraries>>[number];

type DiscoveredFolder = {
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

type ScanRunContext = {
  emitProgress?: (data: ScanProgressPayload) => void;
  shouldStop?: () => boolean;
  trigger?: string;
};

const canonicalizeFolderPath = (input: string) => {
  const normalized = normalizeSourcePath(input);
  return process.platform === "win32" ? normalized.toLowerCase() : normalized;
};

const sameOrderedFilenames = (left: string[], right: string[]) => {
  if (left.length !== right.length) return false;
  return left.every((filename, index) => filename.toLowerCase() === right[index].toLowerCase());
};

const isProtectedDirectory = (dirPath: string) => {
  const segments = path.normalize(dirPath).split(path.sep).filter(Boolean);
  return segments.some((segment) => PROTECTED_DIRECTORY_NAMES.has(segment));
};

const probeImageDimensions = async (filePath: string) => {
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

const looksLikeCoverImage = async (filePath: string) => {
  const dimensions = await probeImageDimensions(filePath);
  if (!dimensions) {
    return true;
  }

  const { width, height } = dimensions;
  const ratio = width / height;
  const area = width * height;

  return area >= 50_000 && ratio >= 0.65 && ratio <= 1.65;
};

const chooseFolderCoverImage = async (folderPath: string, files: string[]) => {
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

const probeFile = (toolPath: string): Promise<any> =>
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

const discoverBookFolders = (
  library: LibraryWithSources,
  shouldStop: () => boolean = () => false,
): DiscoveredFolder[] => {
  const foldersByPath = new Map<string, DiscoveredFolder>();

  const walk = (dirPath: string) => {
    const stack = [dirPath];

    while (stack.length > 0 && !shouldStop()) {
      const currentDir = stack.pop();
      if (!currentDir || !fs.existsSync(currentDir)) {
        continue;
      }

      if (isProtectedDirectory(currentDir)) {
        continue;
      }

      if (!fs.statSync(currentDir).isDirectory()) {
        continue;
      }

      let entries: fs.Dirent[] = [];
      try {
        entries = fs.readdirSync(currentDir, { withFileTypes: true });
      } catch (error) {
        console.error(`Error reading directory ${currentDir}:`, error);
        continue;
      }

      const files: string[] = [];
      let hasAudio = false;
      for (const entry of entries) {
        if (entry.isDirectory()) {
          if (PROTECTED_DIRECTORY_NAMES.has(entry.name)) {
            continue;
          }
          stack.push(path.join(currentDir, entry.name));
          continue;
        }

        if (!entry.isFile()) {
          continue;
        }

        files.push(entry.name);
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          hasAudio = true;
        }
      }

      if (hasAudio) {
        const normalizedFolderPath = normalizeSourcePath(currentDir);
        const canonicalFolderPath = canonicalizeFolderPath(normalizedFolderPath);
        foldersByPath.set(canonicalFolderPath, {
          libraryId: library.id,
          folderName: path.basename(normalizedFolderPath),
          folderPath: normalizedFolderPath,
          files,
        });
      }
    }
  };

  for (const source of library.sources) {
    const sourceRoot = normalizeSourcePath(source.path);
    walk(sourceRoot);
  }

  return Array.from(foldersByPath.values());
};

const removeMissingBooks = async (
  libraryId: string,
  discoveredPaths: Set<string>,
  sourceRoots: string[],
) => {
  const existingBooks = await prisma.book.findMany({
    where: { libraryId },
    select: { id: true, folderPath: true, coverPath: true },
  });

  const missingBookIds = existingBooks
    .filter((book) => {
      const normalizedBookPath = canonicalizeFolderPath(book.folderPath);
      const belongsToCurrentRoots = sourceRoots.some((root) => {
        const relative = path.relative(root, normalizedBookPath);
        return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
      });

      return belongsToCurrentRoots && !discoveredPaths.has(normalizedBookPath);
    })
    .map((book) => book.id);

  if (missingBookIds.length > 0) {
    await prisma.book.deleteMany({
      where: { id: { in: missingBookIds } },
    });
    // Cover files live in the book's folder within the library volume — don't delete them
  }
};

const stripHtml = (raw: unknown): string | null => {
  if (!raw) return null;
  return (
    String(raw)
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim() || null
  );
};

const parseYear = (raw: unknown): string | null => {
  const str = String(raw ?? "").trim();
  const match = str.match(/\b(\d{4})\b/);
  return match ? match[1] : null;
};

const parseGenres = (raw: unknown): string | null => {
  if (!raw) return null;
  // ID3 genres can be null-separated (e.g. "Audiobook\0Mystery")
  return String(raw).replace(/\0/g, ", ").replace(/\s*,\s*/g, ", ").trim() || null;
};

const parseAsin = (...values: unknown[]): string | null => {
  for (const value of values) {
    const match = String(value ?? "").match(/\bASIN[:\s-]*([A-Z0-9]{10})\b/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
};

const parseIsbn = (...values: unknown[]): string | null => {
  for (const value of values) {
    const match = String(value ?? "").match(/\b(97[89]\d{10})\b/);
    if (match) return match[1];
  }
  return null;
};

const pickDescription = (...values: unknown[]): string | null => {
  for (const value of values) {
    const cleaned = stripHtml(value);
    if (!cleaned) continue;
    if (/^(ASIN|ISBN(?:-13)?)[:\s-]*[A-Z0-9-]+$/i.test(cleaned)) continue;
    return cleaned;
  }

  return null;
};

const upsertBookFolder = async (
  folder: DiscoveredFolder,
  shouldStop: () => boolean = () => false,
  forceMetadata: boolean = false,
) => {
  if (shouldStop()) return;

  const libraryId = folder.libraryId;
  const folderPath = normalizeSourcePath(folder.folderPath);
  const folderName = folder.folderName || path.basename(folderPath);
  const files = folder.files;

  const audioFiles = files
    .filter((file) => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()))
    .sort();

  if (audioFiles.length === 0) {
    return;
  }

  let existingBook = await prisma.book.findFirst({
    where: {
      libraryId,
      folderPath: {
        equals: folderPath,
        mode: "insensitive",
      },
    },
    include: {
      author: {
        select: {
          id: true,
          name: true,
        },
      },
      audioFiles: {
        select: {
          id: true,
          filename: true,
          title: true,
          path: true,
          duration: true,
          index: true,
        },
        orderBy: {
          index: "asc",
        },
      },
      _count: { select: { audioFiles: true, chapters: true } },
    },
  });

  if (!existingBook) {
    const candidates = await prisma.book.findMany({
      where: {
        libraryId,
        audioFiles: {
          some: {
            filename: {
              equals: audioFiles[0],
              mode: "insensitive",
            },
          },
        },
      },
      include: {
        author: {
          select: {
            id: true,
            name: true,
          },
        },
        audioFiles: {
          select: {
            id: true,
            filename: true,
            title: true,
            path: true,
            duration: true,
            index: true,
          },
          orderBy: {
            index: "asc",
          },
        },
        _count: { select: { audioFiles: true, chapters: true } },
      },
    });

    const renamedCandidates = candidates.filter((candidate) => {
      if (canonicalizeFolderPath(candidate.folderPath) === canonicalizeFolderPath(folderPath)) {
        return false;
      }
      if (fs.existsSync(candidate.folderPath)) {
        return false;
      }

      return sameOrderedFilenames(
        candidate.audioFiles.map((audioFile) => audioFile.filename).sort(),
        audioFiles,
      );
    });

    if (renamedCandidates.length === 1) {
      existingBook = renamedCandidates[0];
      console.info(`[scanner] remapping renamed book folder: ${existingBook.folderPath} -> ${folderPath}`);
    }
  }

  // Skip metadata extraction only if file count matches AND we already ran the current extractor
  const skipMetadata =
    !forceMetadata &&
    existingBook !== null &&
    existingBook._count.audioFiles === audioFiles.length &&
    existingBook.metadataVersion >= METADATA_VERSION;
  const canReuseAudioIndex =
    skipMetadata &&
    (existingBook?.audioFiles.length ?? 0) === audioFiles.length &&
    (existingBook?.audioFiles.every((audioFile, index) => audioFile.filename === audioFiles[index]) ?? false);

  const firstAudioPath = path.join(folderPath, audioFiles[0]);

  let title = folderName;
  let authorName = "Unknown Author";
  let firstAudioMetadata: any = null;

  // Rich metadata fields
  let narrator: string | null = null;
  let description: string | null = null;
  let publisher: string | null = null;
  let year: string | null = null;
  let genres: string | null = null;
  let tagsField: string | null = null;
  let language: string | null = null;
  let subtitle: string | null = null;
  let isbn: string | null = null;
  let asin: string | null = null;
  let abridged = false;
  let seriesName: string | null = null;
  let seriesSequence: number | null = null;

  if (folderName.includes(" - ")) {
    const parts = folderName.split(" - ");
    authorName = parts[0].trim();
    title = parts.slice(1).join(" - ").trim();
  }

  if (!skipMetadata) {
    try {
      if (shouldStop()) return;
      firstAudioMetadata = await getAudioMetadata(firstAudioPath);
      const tags = firstAudioMetadata.format.tags || {};

      // Only override title/author for new books — updating them on a rescan
      // can collide with other existing books that already hold that title+author.
      if (!existingBook) {
        if (tags.title) title = tags.title;
        if (tags.artist) authorName = tags.artist;
        else if (tags.album_artist) authorName = tags.album_artist;
      }

      // Narrator — audiobook files commonly store this in composer
      narrator = tags.narrator || tags.composer || null;
      subtitle = tags.subtitle || null;
      asin = parseAsin(tags.asin, tags.comment, tags.description, tags.longdescription, tags.long_description);
      isbn = parseIsbn(tags.isbn, tags.comment, tags.description, tags.longdescription, tags.long_description);

      // Description — check several common tag names, strip any embedded HTML
      description = pickDescription(
        tags.comment,
        tags.description,
        tags.longdescription,
        tags.long_description,
        tags.lyrics,
      );

      year = parseYear(tags.date || tags.year || tags.originaldate || "");

      publisher = tags.publisher || tags.organization || null;

      genres = parseGenres(tags.genre);
      tagsField = parseGenres(tags.keywords || tags.category);

      // ISO 639-2 language code (e.g. "eng")
      language = tags.language || null;
      abridged = String(tags.media_type || tags.comment || "").toLowerCase().includes("abridged");

      // Series — Audible / Apple Books use the "grouping" tag
      seriesName = tags.grouping || tags.series || tags.show || null;

      // Series index — explicit tag or disc number
      if (tags["series-part"]) {
        seriesSequence = parseFloat(tags["series-part"]) || null;
      } else if (tags.disc) {
        seriesSequence = parseFloat(String(tags.disc).split("/")[0]) || null;
      }
    } catch (error) {
      console.error(`Error probing ${audioFiles[0]}:`, error);
    }
  } else if (existingBook) {
    title = existingBook.title;
    authorName = existingBook.author.name;
  }

  title = cleanupBookTitle(title, { folderNameOrPath: folderName || folderPath });

  // Cover art resolution — store directly in the book's folder (persists with the library volume)
  const existingCoverFile = findCoverInFolder(folderPath);
  let hasCover = existingCoverFile ? await looksLikeCoverImage(existingCoverFile) : false;

  if (!hasCover) {
    const foundCover = await chooseFolderCoverImage(folderPath, files);

    if (foundCover) {
      try {
        const coverExt = path.extname(foundCover).toLowerCase() || ".jpg";
        const coverDest = path.join(folderPath, `cover${coverExt}`);
        const sourcePath = path.join(folderPath, foundCover);
        if (path.resolve(folderPath, foundCover) !== coverDest) {
          fs.copyFileSync(sourcePath, coverDest);
        }
        hasCover = await looksLikeCoverImage(coverDest);
        if (!hasCover) {
          fs.rmSync(coverDest, { force: true });
        }
      } catch (err) {
        console.error(`Failed to copy cover image from ${folderPath}:`, err);
      }
    }

    if (!hasCover) {
      try {
        if (shouldStop()) return;
        const hasEmbeddedArt =
          firstAudioMetadata?.streams?.some(
            (s: any) => s.codec_type === "video" || s.codec_type === "attachment",
          ) ?? true;

        if (hasEmbeddedArt) {
          const coverDest = path.join(folderPath, "cover.jpg");
          await extractCover(firstAudioPath, coverDest);
          if (fs.existsSync(coverDest) && fs.statSync(coverDest).size > 0) {
            hasCover = await looksLikeCoverImage(coverDest);
            if (!hasCover) {
              fs.rmSync(coverDest, { force: true });
            }
          }
        }
      } catch {
        // Silent fail — book has no embedded art
      }
    }
  }

  // coverPath uses bookId; for existing books we know the id upfront
  const coverPath = hasCover && existingBook ? getCoverUrl(existingBook.id) : (existingBook?.coverPath || "");

  const author =
    existingBook && existingBook.author.name === authorName
      ? existingBook.author
      : await prisma.author.upsert({
          where: { name: authorName },
          update: {},
          create: { name: authorName },
        });

  // Resolve series record when we have a series name from tags
  let seriesId: string | null = existingBook?.seriesId ?? null;
  let sequence: number | null = existingBook?.sequence ?? null;

  if (!skipMetadata && seriesName) {
    const series = await prisma.series.upsert({
      where: { name: seriesName },
      update: {},
      create: { name: seriesName },
    });
    seriesId = series.id;
    if (seriesSequence !== null) sequence = seriesSequence;
  }

  const richFields = skipMetadata
    ? {}
      : {
        narrator,
        description,
        publisher,
        year,
        genres,
        tags: tagsField,
        language,
        subtitle,
        isbn,
        asin,
        abridged,
        seriesId,
        sequence,
        metadataVersion: METADATA_VERSION,
      };

  let book;
  const createData = {
    title,
    libraryId,
    authorId: author.id,
    folderPath,
    coverPath,
    narrator,
    description,
    publisher,
    year,
    genres,
    tags: tagsField,
    language,
    subtitle,
    isbn,
    asin,
    abridged,
    seriesId,
    sequence,
    metadataVersion: METADATA_VERSION,
  };
  const updateData = {
    title,
    libraryId,
    authorId: author.id,
    folderPath,
    coverPath,
    ...richFields,
  };

  try {
    book = existingBook
      ? await prisma.book.update({
          where: { id: existingBook.id },
          data: updateData,
        })
      : await prisma.book.create({
          data: createData,
        });
  } catch (error: any) {
    if (error.code === "P2002" && error.meta?.target?.includes("title")) {
      const disambiguatedTitle = `${title} (${path.basename(folderPath)})`;
      console.log(`Title collision for "${title}". Renaming to "${disambiguatedTitle}"`);

      book = existingBook
        ? await prisma.book.update({
            where: { id: existingBook.id },
            data: {
              ...updateData,
              title: disambiguatedTitle,
            },
          })
        : await prisma.book.create({
            data: {
              ...createData,
              title: disambiguatedTitle,
            },
          });
    } else {
      throw error;
    }
  }

  // Ensure coverPath is set to the new format (needed for newly created books)
  if (hasCover && book.coverPath !== getCoverUrl(book.id)) {
    await prisma.book.update({
      where: { id: book.id },
      data: { coverPath: getCoverUrl(book.id) },
    });
  }

  if (canReuseAudioIndex && existingBook) {
    await Promise.all(
      existingBook.audioFiles.map((audioFile) => {
        const nextPath = path.join(folderPath, audioFile.filename);
        if (audioFile.path === nextPath) {
          return Promise.resolve();
        }

        return prisma.audioFile.update({
          where: { id: audioFile.id },
          data: { path: nextPath },
        });
      }),
    );

    if (existingBook._count.chapters === 0 && existingBook.audioFiles.length > 0) {
      const generatedChapters = await generateSmartChapters(
        existingBook.audioFiles,
        existingBook.audioFiles.reduce((sum, audioFile) => sum + audioFile.duration, 0),
      );

      if (generatedChapters.length > 0) {
        await prisma.chapter.createMany({
          data: generatedChapters.map((chapter) => ({
            ...chapter,
            bookId: book.id,
          })),
        });
      }
    }
    return;
  }

  let totalDuration = 0;
  const allChapters: { title: string; start: number; end: number }[] = [];
  const processedAudioFiles: ChapterInputAudioFile[] = [];

  if (shouldStop()) return;

  await prisma.audioFile.deleteMany({ where: { bookId: book.id } });
  await prisma.chapter.deleteMany({ where: { bookId: book.id } });

  for (let index = 0; index < audioFiles.length; index++) {
    if (shouldStop()) return;

    const filename = audioFiles[index];
    const filePath = path.join(folderPath, filename);
    let duration = 0;
    let trackTitle: string | null = null;

    try {
      const metadata = await getAudioMetadata(filePath);
      const parsedDuration = parseFloat(metadata?.format?.duration);
      duration = !isNaN(parsedDuration) ? parsedDuration : 0;
      trackTitle = metadata?.format?.tags?.title || null;

      // Extract chapters if present
      if (metadata.chapters && Array.isArray(metadata.chapters)) {
        for (const chap of metadata.chapters) {
          const start = parseFloat(chap.start_time);
          const end = parseFloat(chap.end_time);
          if (!isNaN(start) && !isNaN(end)) {
            allChapters.push({
              title: chap.tags?.title || `Chapter ${allChapters.length + 1}`,
              start: start + totalDuration,
              end: end + totalDuration,
            });
          }
        }
      }
    } catch (error) {
      console.error(`Error getting duration for ${filename}:`, error);
    }

    await prisma.audioFile.create({
      data: {
        filename,
        path: filePath,
        duration,
        index,
        title: trackTitle,
        bookId: book.id,
      },
    });

    // Schedule an in-place faststart remux so the next playback can start
    // without ExoPlayer / browsers having to Range-request the tail of the
    // file to locate the moov atom. ensureFastStart is idempotent and
    // skips files that are already faststart, so it's safe to call on
    // every rescan.
    queueFastStart(filePath);

    processedAudioFiles.push({
      filename,
      path: filePath,
      duration,
      index,
      title: trackTitle,
    });

    totalDuration += duration;
  }

  if (allChapters.length === 0) {
    allChapters.push(...(await generateSmartChapters(processedAudioFiles, totalDuration)));
  }

  // Save chapters
  if (allChapters.length > 0) {
    await prisma.chapter.createMany({
      data: allChapters.map((c) => ({
        ...c,
        bookId: book.id,
      })),
    });
  }

  await prisma.book.update({
    where: { id: book.id },
    data: { duration: totalDuration },
  });
};

const deleteBookFolderIfPresent = async (libraryId: string, folderPath: string) => {
  const existingBook = await prisma.book.findFirst({
    where: {
      libraryId,
      folderPath: {
        equals: folderPath,
        mode: "insensitive",
      },
    },
    select: {
      id: true,
    },
  });

  if (!existingBook) {
    return false;
  }

  await prisma.book.delete({ where: { id: existingBook.id } });
  return true;
};

export const syncLibraryFolder = async (
  libraryId: string,
  folderPathInput: string,
  context: ScanRunContext = {},
) => {
  const emitProgress = context.emitProgress ?? (() => {});
  const shouldStop = context.shouldStop ?? (() => false);
  const isWatchFolderScan = context.trigger === "watch-folder";
  const folderPath = normalizeSourcePath(folderPathInput);
  const folderName = path.basename(folderPath);

  emitProgress({
    libraryId,
    status: "starting",
    progress: 0,
    currentFolder: folderName,
    totalFolders: 1,
    scannedFolders: 0,
  });

  if (shouldStop()) return;

  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    if (!isWatchFolderScan) {
      await deleteBookFolderIfPresent(libraryId, folderPath);
    }
    emitProgress({
      libraryId,
      status: "completed",
      progress: 100,
      currentFolder: folderName,
      totalFolders: 1,
      scannedFolders: 1,
    });
    return;
  }

  const files = fs.readdirSync(folderPath);
  const audioFiles = files.filter((file) => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()));

  if (audioFiles.length === 0) {
    await deleteBookFolderIfPresent(libraryId, folderPath);
    emitProgress({
      libraryId,
      status: "completed",
      progress: 100,
      currentFolder: folderName,
      totalFolders: 1,
      scannedFolders: 1,
    });
    return;
  }

  await upsertBookFolder(
    {
      libraryId,
      folderName,
      folderPath,
      files,
    },
    shouldStop,
  );

  emitProgress({
    libraryId,
    status: "scanning",
    progress: 100,
    currentFolder: folderName,
    totalFolders: 1,
    scannedFolders: 1,
  });

  emitProgress({
    libraryId,
    status: "completed",
    progress: 100,
    currentFolder: folderName,
    totalFolders: 1,
    scannedFolders: 1,
  });
};

export const scanLibrary = async (libraryId?: string, context: ScanRunContext = {}) => {
  const emitProgress = context.emitProgress ?? (() => {});
  const shouldStop = context.shouldStop ?? (() => false);

  const libraries = await getConfiguredLibraries(libraryId);
  if (shouldStop()) return;

  emitProgress({
    libraryId,
    status: "starting",
    progress: 0,
  });

  let totalDiscovered = 0;
  let processedCount = 0;

  const allDiscovered: { library: LibraryWithSources; folders: DiscoveredFolder[] }[] = [];
  for (const library of libraries) {
    if (shouldStop()) return;

    const discoveredFolders = discoverBookFolders(library, shouldStop);
    allDiscovered.push({ library, folders: discoveredFolders });
    totalDiscovered += discoveredFolders.length;
  }

  for (const { library, folders } of allDiscovered) {
    if (shouldStop()) return;

    const sourceRoots = library.sources
      .map((source) => canonicalizeFolderPath(source.path))
      .filter((sourcePath) => fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory());

    const discoveredPaths = new Set(folders.map((entry) => canonicalizeFolderPath(entry.folderPath)));
    await removeMissingBooks(library.id, discoveredPaths, sourceRoots);

    for (const folder of folders) {
      if (shouldStop()) return;

      try {
        processedCount++;
        const progress = totalDiscovered > 0 ? Math.round((processedCount / totalDiscovered) * 100) : 100;

        emitProgress({
          libraryId: library.id,
          status: "scanning",
          progress,
          currentFolder: folder.folderName,
          totalFolders: totalDiscovered,
          scannedFolders: processedCount,
        });

        await upsertBookFolder(folder, shouldStop);
      } catch (error) {
        console.error(`Failed to process folder ${folder.folderPath}:`, error);
      }
    }
  }

  if (shouldStop()) return;

  emitProgress({
    libraryId,
    status: "completed",
    progress: 100,
  });

  await prisma.author.deleteMany({
    where: { books: { none: {} } },
  });

  await prisma.series.deleteMany({
    where: { books: { none: {} } },
  });
};

export const rescanBook = async (bookId: string, forceMetadata: boolean = false) => {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: { libraryId: true, folderPath: true },
  });

  if (!book) {
    throw new Error("Book not found");
  }

  if (!fs.existsSync(book.folderPath)) {
    throw new Error("Folder does not exist");
  }

  const folderPath = book.folderPath;
  const files = fs.readdirSync(folderPath);

  await upsertBookFolder(
    {
      libraryId: book.libraryId,
      folderName: path.basename(folderPath),
      folderPath,
      files,
    },
    () => false,
    forceMetadata,
  );
};

export const autoChapterizeBook = async (bookId: string, replaceExisting = true) => {
  const book = await prisma.book.findUnique({
    where: { id: bookId },
    select: {
      id: true,
      title: true,
      duration: true,
      audioFiles: {
        select: {
          filename: true,
          title: true,
          path: true,
          duration: true,
          index: true,
        },
        orderBy: { index: "asc" },
      },
      _count: { select: { chapters: true } },
    },
  });

  if (!book) {
    throw new Error("Book not found");
  }

  if (!replaceExisting && book._count.chapters > 0) {
    return { created: 0, skipped: true };
  }

  const chapters = await generateSmartChapters(book.audioFiles, book.duration);
  await prisma.chapter.deleteMany({ where: { bookId: book.id } });

  if (chapters.length > 0) {
    await prisma.chapter.createMany({
      data: chapters.map((chapter) => ({
        ...chapter,
        bookId: book.id,
      })),
    });
  }

  return { created: chapters.length, skipped: false };
};

