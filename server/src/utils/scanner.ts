import fs from "fs";
import path from "path";
import { spawnSync } from "child_process";
import ffmpeg from "./ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";
import prisma from "../lib/prisma";
import { extractCover } from "./processor";
import { emitScanProgress } from "../lib/socket";
import { getCoverUrl } from "./covers";
import {
  getConfiguredLibraries,
  getCoversRoot,
  normalizeSourcePath,
  preparePathForTool,
} from "./libraryConfig";

const AUDIO_EXTENSIONS = [".mp3", ".m4a", ".m4b", ".aac", ".flac", ".wav", ".ogg"];

// Increment this when new metadata fields are added to force re-extraction on next scan
const METADATA_VERSION = 3;

type LibraryWithSources = Awaited<ReturnType<typeof getConfiguredLibraries>>[number];

type DiscoveredFolder = {
  libraryId: string;
  folderName: string;
  folderPath: string;
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

const discoverBookFolders = (library: LibraryWithSources): DiscoveredFolder[] => {
  const folders: DiscoveredFolder[] = [];

  const walk = (dirPath: string) => {
    if (!fs.existsSync(dirPath) || !fs.statSync(dirPath).isDirectory()) {
      return;
    }

    let entries: fs.Dirent[] = [];
    try {
      entries = fs.readdirSync(dirPath, { withFileTypes: true });
    } catch (error) {
      console.error(`Error reading directory ${dirPath}:`, error);
      return;
    }

    let hasAudio = false;
    for (const entry of entries) {
      if (entry.isFile()) {
        const ext = path.extname(entry.name).toLowerCase();
        if (AUDIO_EXTENSIONS.includes(ext)) {
          hasAudio = true;
          break;
        }
      }
    }

    if (hasAudio) {
      folders.push({
        libraryId: library.id,
        folderName: path.basename(dirPath),
        folderPath: dirPath,
      });
    }

    for (const entry of entries) {
      if (entry.isDirectory()) {
        walk(path.join(dirPath, entry.name));
      }
    }
  };

  for (const source of library.sources) {
    const sourceRoot = normalizeSourcePath(source.path);
    walk(sourceRoot);
  }

  return folders;
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

  for (const book of existingBooks) {
    const normalizedBookPath = normalizeSourcePath(book.folderPath);
    const belongsToCurrentRoots = sourceRoots.some((root) => {
      const relative = path.relative(root, normalizedBookPath);
      return relative !== "" && !relative.startsWith("..") && !path.isAbsolute(relative);
    });

    if (!belongsToCurrentRoots || discoveredPaths.has(normalizedBookPath)) {
      continue;
    }

    await prisma.book.delete({ where: { id: book.id } });

    if (book.coverPath) {
      const coverName = book.coverPath.split("/").pop();
      if (coverName) {
        const coverPath = path.join(getCoversRoot(), coverName);
        if (fs.existsSync(coverPath)) {
          fs.rmSync(coverPath, { force: true });
        }
      }
    }
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

const upsertBookFolder = async ({ libraryId, folderName, folderPath }: DiscoveredFolder) => {
  const files = fs.readdirSync(folderPath);
  const audioFiles = files
    .filter((file) => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()))
    .sort();

  if (audioFiles.length === 0) {
    return;
  }

  const existingBook = await prisma.book.findUnique({
    where: { folderPath },
    include: { _count: { select: { audioFiles: true } } },
  });

  // Skip metadata extraction only if file count matches AND we already ran the current extractor
  const skipMetadata =
    existingBook !== null &&
    existingBook._count.audioFiles === audioFiles.length &&
    existingBook.metadataVersion >= METADATA_VERSION;

  const needsCover = !existingBook || !existingBook.coverPath;

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
    const author = await prisma.author.findUnique({ where: { id: existingBook.authorId } });
    if (author) authorName = author.name;
  }

  // Cover art resolution
  const coverBaseName = `${folderPath
    .split(path.sep)
    .pop()
    ?.replace(/[^a-z0-9]/gi, "_")
    .toLowerCase()}_${Buffer.from(folderPath).toString("hex").substring(0, 8)}`;
  let coverName = `${coverBaseName}.jpg`;
  let coverLocalPath = path.join(getCoversRoot(), coverName);
  let coverPath = existingBook?.coverPath || "";

  if (!fs.existsSync(coverLocalPath) || needsCover) {
    const imageFiles = files.filter((f) => [".jpg", ".jpeg", ".png"].includes(path.extname(f).toLowerCase()));
    const commonCoverNames = ["cover", "folder", "front", "poster"];
    const foundCover =
      imageFiles.find((f) => commonCoverNames.includes(path.parse(f).name.toLowerCase())) ||
      imageFiles[0];

    if (foundCover) {
      try {
        const coverExt = path.extname(foundCover).toLowerCase() || ".jpg";
        coverName = `${coverBaseName}${coverExt}`;
        coverLocalPath = path.join(getCoversRoot(), coverName);
        fs.copyFileSync(path.join(folderPath, foundCover), coverLocalPath);
        coverPath = getCoverUrl(coverName);
      } catch (err) {
        console.error(`Failed to copy cover image from ${folderPath}:`, err);
      }
    }

    if (!coverPath) {
      try {
        const hasEmbeddedArt =
          firstAudioMetadata?.streams?.some(
            (s: any) => s.codec_type === "video" || s.codec_type === "attachment",
          ) ?? true;

        if (hasEmbeddedArt) {
          await extractCover(firstAudioPath, coverLocalPath);
          if (fs.existsSync(coverLocalPath) && fs.statSync(coverLocalPath).size > 0) {
            coverPath = getCoverUrl(coverName);
          }
        }
      } catch {
        // Silent fail — book has no embedded art
      }
    }
  } else {
    coverPath = getCoverUrl(coverName);
  }

  const author = await prisma.author.upsert({
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
  try {
    book = await prisma.book.upsert({
      where: { folderPath },
      update: {
        title,
        libraryId,
        authorId: author.id,
        coverPath,
        ...richFields,
      },
      create: {
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
      },
    });
  } catch (error: any) {
    if (error.code === "P2002" && error.meta?.target?.includes("title")) {
      const disambiguatedTitle = `${title} (${path.basename(folderPath)})`;
      console.log(`Title collision for "${title}". Renaming to "${disambiguatedTitle}"`);

      book = await prisma.book.upsert({
        where: { folderPath },
        update: {
          title: disambiguatedTitle,
          libraryId,
          authorId: author.id,
          coverPath,
          ...richFields,
        },
        create: {
          title: disambiguatedTitle,
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
        },
      });
    } else {
      throw error;
    }
  }

  let totalDuration = 0;
  const allChapters: { title: string; start: number; end: number }[] = [];

  await prisma.audioFile.deleteMany({ where: { bookId: book.id } });
  await prisma.chapter.deleteMany({ where: { bookId: book.id } });

  for (let index = 0; index < audioFiles.length; index++) {
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

    totalDuration += duration;
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

let isScanningActive = false;

export const scanLibrary = async (libraryId?: string) => {
  if (isScanningActive) {
    console.log("Scan already in progress, skipping...");
    return;
  }
  isScanningActive = true;

  try {
    const libraries = await getConfiguredLibraries(libraryId);

    emitScanProgress({
      libraryId,
      status: "starting",
      progress: 0,
    });

    let totalDiscovered = 0;
    let processedCount = 0;

    const allDiscovered: { library: any; folders: DiscoveredFolder[] }[] = [];
    for (const library of libraries) {
      const discoveredFolders = discoverBookFolders(library);
      allDiscovered.push({ library, folders: discoveredFolders });
      totalDiscovered += discoveredFolders.length;
    }

    for (const { library, folders } of allDiscovered) {
      if (!isScanningActive) break;

      const sourceRoots = library.sources
        .map((source: any) => normalizeSourcePath(source.path))
        .filter((sourcePath: string) => fs.existsSync(sourcePath) && fs.statSync(sourcePath).isDirectory());

      const discoveredPaths = new Set(folders.map((entry) => entry.folderPath));
      await removeMissingBooks(library.id, discoveredPaths, sourceRoots);

      for (const folder of folders) {
        if (!isScanningActive) break;
        try {
          processedCount++;
          const progress = totalDiscovered > 0 ? Math.round((processedCount / totalDiscovered) * 100) : 100;

          emitScanProgress({
            libraryId: library.id,
            status: "scanning",
            progress,
            currentFolder: folder.folderName,
            totalFolders: totalDiscovered,
            scannedFolders: processedCount,
          });

          await upsertBookFolder(folder);
        } catch (error) {
          console.error(`Failed to process folder ${folder.folderPath}:`, error);
        }
      }
    }

    if (isScanningActive) {
      emitScanProgress({
        libraryId,
        status: "completed",
        progress: 100,
      });
    }

    await prisma.author.deleteMany({
      where: { books: { none: {} } },
    });

    await prisma.series.deleteMany({
      where: { books: { none: {} } },
    });
  } finally {
    isScanningActive = false;
  }
};

export const stopScanning = () => {
  isScanningActive = false;
  emitScanProgress({
    status: "failed",
    progress: 0,
  });
};
