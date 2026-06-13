import fs from "fs";
import path from "path";
import prisma from "../../lib/prisma";
import { generateSmartChapters, type ChapterInputAudioFile } from "../chapterizer";
import { extractCover } from "../processor";
import { queueFastStart } from "../faststart";
import { getCoverUrl, findCoverInFolder } from "../covers";
import { cleanupBookTitle } from "../titleCleanup";
import { normalizeSourcePath } from "../libraryConfig";
import {
  AUDIO_EXTENSIONS,
  METADATA_VERSION,
  type DiscoveredFolder,
  type ScanRunContext,
  canonicalizeFolderPath,
  sameOrderedFilenames,
  chooseFolderCoverImage,
  getAudioMetadata,
  looksLikeCoverImage,
} from "./shared";
import { parseAsin, parseGenres, parseIsbn, parseYear, pickDescription } from "./folder-metadata";

const deleteBookFolderIfPresent = async (libraryId: string, folderPath: string) => {
  const existingBook = await prisma.book.findFirst({
    where: {
      libraryId,
      folderPath: {
        equals: folderPath,
        mode: "insensitive",
      },
    },
    select: { id: true },
  });
  if (!existingBook) return false;
  await prisma.book.delete({ where: { id: existingBook.id } });
  return true;
};

export const upsertBookFolder = async (
  folder: DiscoveredFolder,
  shouldStop: () => boolean = () => false,
  forceMetadata: boolean = false,
) => {
  if (shouldStop()) return;

  const libraryId = folder.libraryId;
  const folderPath = normalizeSourcePath(folder.folderPath);
  const folderName = folder.folderName || path.basename(folderPath);
  const files = folder.files;
  const audioFiles = files.filter((file) => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase())).sort();
  if (audioFiles.length === 0) return;

  let existingBook = await prisma.book.findFirst({
    where: {
      libraryId,
      folderPath: { equals: folderPath, mode: "insensitive" },
    },
    include: {
      author: { select: { id: true, name: true } },
      series: true,
      audioFiles: {
        select: { id: true, filename: true, title: true, path: true, duration: true, index: true },
        orderBy: { index: "asc" },
      },
      _count: { select: { audioFiles: true, chapters: true } },
    },
  });

  if (!existingBook) {
    const candidates = await prisma.book.findMany({
      where: {
        libraryId,
        audioFiles: { some: { filename: { equals: audioFiles[0], mode: "insensitive" } } },
      },
      include: {
        author: { select: { id: true, name: true } },
        series: true,
        audioFiles: {
          select: { id: true, filename: true, title: true, path: true, duration: true, index: true },
          orderBy: { index: "asc" },
        },
        _count: { select: { audioFiles: true, chapters: true } },
      },
    });
    const renamed = candidates.filter((candidate) =>
      canonicalizeFolderPath(candidate.folderPath) !== canonicalizeFolderPath(folderPath) &&
      !fs.existsSync(candidate.folderPath) &&
      sameOrderedFilenames(candidate.audioFiles.map((a) => a.filename).sort(), audioFiles),
    );
    if (renamed.length === 1) existingBook = renamed[0];
  }

  const skipMetadata = !forceMetadata && !!existingBook && existingBook._count.audioFiles === audioFiles.length && existingBook.metadataVersion >= METADATA_VERSION;
  const canReuseAudioIndex = !!existingBook && skipMetadata && existingBook.audioFiles.length === audioFiles.length && existingBook.audioFiles.every((a, i) => a.filename === audioFiles[i]);

  const firstAudioPath = path.join(folderPath, audioFiles[0]);
  let title = folderName;
  let authorName = "Unknown Author";
  let firstAudioMetadata: any = null;
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
      const tags = firstAudioMetadata?.format?.tags || {};
      if (!existingBook) {
        if (tags.title) title = tags.title;
        if (tags.artist) authorName = tags.artist;
        else if (tags.album_artist) authorName = tags.album_artist;
      } else if (existingBook.author.name === "Unknown Author") {
        if (tags.artist) authorName = tags.artist;
        else if (tags.album_artist) authorName = tags.album_artist;
      }
      narrator = tags.narrator || tags.composer || null;
      subtitle = tags.subtitle || null;
      asin = parseAsin(tags.asin, tags.comment, tags.description, tags.longdescription, tags.long_description);
      isbn = parseIsbn(tags.isbn, tags.comment, tags.description, tags.longdescription, tags.long_description);
      description = pickDescription(tags.comment, tags.description, tags.longdescription, tags.long_description, tags.lyrics);
      year = parseYear(tags.date || tags.year || tags.originaldate || "");
      publisher = tags.publisher || tags.organization || null;
      genres = parseGenres(tags.genre);
      tagsField = parseGenres(tags.keywords || tags.category);
      language = tags.language || null;
      abridged = String(tags.media_type || tags.comment || "").toLowerCase().includes("abridged");
      seriesName = tags.grouping || tags.series || tags.show || null;
      if (tags["series-part"]) seriesSequence = parseFloat(tags["series-part"]) || null;
      else if (tags.disc) seriesSequence = parseFloat(String(tags.disc).split("/")[0]) || null;
    } catch (error) {
      console.error(`Error probing ${audioFiles[0]}:`, error);
    }
  } else if (existingBook) {
    title = existingBook.title;
    authorName = existingBook.author.name;
  }

  title = cleanupBookTitle(title, { folderNameOrPath: folderName || folderPath });

  const existingCoverFile = findCoverInFolder(folderPath);
  let hasCover = existingCoverFile ? await looksLikeCoverImage(existingCoverFile) : false;
  if (!hasCover) {
    const foundCover = await chooseFolderCoverImage(folderPath, files);
    if (foundCover) {
      try {
        const coverExt = path.extname(foundCover).toLowerCase() || ".jpg";
        const coverDest = path.join(folderPath, `cover${coverExt}`);
        const sourcePath = path.join(folderPath, foundCover);
        if (path.resolve(folderPath, foundCover) !== coverDest) fs.copyFileSync(sourcePath, coverDest);
        hasCover = await looksLikeCoverImage(coverDest);
        if (!hasCover) fs.rmSync(coverDest, { force: true });
      } catch (err) {
        console.error(`Failed to copy cover image from ${folderPath}:`, err);
      }
    }
    if (!hasCover) {
      try {
        const hasEmbeddedArt = firstAudioMetadata?.streams?.some((s: any) => s.codec_type === "video" || s.codec_type === "attachment") ?? true;
        if (hasEmbeddedArt) {
          const coverDest = path.join(folderPath, "cover.jpg");
          await extractCover(firstAudioPath, coverDest);
          if (fs.existsSync(coverDest) && fs.statSync(coverDest).size > 0) {
            hasCover = await looksLikeCoverImage(coverDest);
            if (!hasCover) fs.rmSync(coverDest, { force: true });
          }
        }
      } catch {
        // ignore
      }
    }
  }

  const coverPath = hasCover && existingBook ? getCoverUrl(existingBook.id) : (existingBook?.coverPath || "");
  const author = existingBook && existingBook.author.name === authorName
    ? existingBook.author
    : await prisma.author.upsert({ where: { name: authorName }, update: {}, create: { name: authorName } });

  let seriesId: string | null = existingBook?.seriesId ?? null;
  let sequence: number | null = existingBook?.sequence ?? null;
  if (!skipMetadata && seriesName) {
    const series = await prisma.series.upsert({ where: { name: seriesName }, update: {}, create: { name: seriesName } });
    seriesId = series.id;
    if (seriesSequence !== null) sequence = seriesSequence;
  }

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
  const updateData = { ...createData };

  let book = existingBook
    ? await prisma.book.update({ where: { id: existingBook.id }, data: updateData })
    : await prisma.book.create({ data: createData });

  if (hasCover && book.coverPath !== getCoverUrl(book.id)) {
    await prisma.book.update({ where: { id: book.id }, data: { coverPath: getCoverUrl(book.id) } });
  }

  if (canReuseAudioIndex && existingBook) {
    await Promise.all(existingBook.audioFiles.map((audioFile) => {
      const nextPath = path.join(folderPath, audioFile.filename);
      if (audioFile.path === nextPath) return Promise.resolve();
      return prisma.audioFile.update({ where: { id: audioFile.id }, data: { path: nextPath } });
    }));
    if (existingBook._count.chapters === 0 && existingBook.audioFiles.length > 0) {
      const chapters = await generateSmartChapters(existingBook.audioFiles, existingBook.audioFiles.reduce((sum, a) => sum + a.duration, 0));
      if (chapters.length > 0) {
        await prisma.chapter.createMany({ data: chapters.map((chapter) => ({ ...chapter, bookId: book.id })) });
      }
    }
    return;
  }

  let totalDuration = 0;
  const allChapters: { title: string; start: number; end: number }[] = [];
  const processedAudioFiles: ChapterInputAudioFile[] = [];

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
      if (metadata.chapters && Array.isArray(metadata.chapters)) {
        for (const chap of metadata.chapters) {
          const start = parseFloat(chap.start_time);
          const end = parseFloat(chap.end_time);
          if (!isNaN(start) && !isNaN(end)) {
            allChapters.push({ title: chap.tags?.title || `Chapter ${allChapters.length + 1}`, start: start + totalDuration, end: end + totalDuration });
          }
        }
      }
    } catch (error) {
      console.error(`Error getting duration for ${filename}:`, error);
    }
    await prisma.audioFile.create({ data: { filename, path: filePath, duration, index, title: trackTitle, bookId: book.id } });
    queueFastStart(filePath);
    processedAudioFiles.push({ filename, path: filePath, duration, index, title: trackTitle });
    totalDuration += duration;
  }

  if (allChapters.length === 0) {
    allChapters.push(...(await generateSmartChapters(processedAudioFiles, totalDuration)));
  }
  if (allChapters.length > 0) {
    await prisma.chapter.createMany({ data: allChapters.map((c) => ({ ...c, bookId: book.id })) });
  }
  await prisma.book.update({ where: { id: book.id }, data: { duration: totalDuration } });
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

  emitProgress({ libraryId, status: "starting", progress: 0, currentFolder: folderName, totalFolders: 1, scannedFolders: 0 });
  if (shouldStop()) return;

  if (!fs.existsSync(folderPath) || !fs.statSync(folderPath).isDirectory()) {
    if (!isWatchFolderScan) await deleteBookFolderIfPresent(libraryId, folderPath);
    emitProgress({ libraryId, status: "completed", progress: 100, currentFolder: folderName, totalFolders: 1, scannedFolders: 1 });
    return;
  }

  const files = fs.readdirSync(folderPath);
  const audioFiles = files.filter((file) => AUDIO_EXTENSIONS.includes(path.extname(file).toLowerCase()));
  if (audioFiles.length === 0) {
    await deleteBookFolderIfPresent(libraryId, folderPath);
    emitProgress({ libraryId, status: "completed", progress: 100, currentFolder: folderName, totalFolders: 1, scannedFolders: 1 });
    return;
  }

  await upsertBookFolder({ libraryId, folderName, folderPath, files }, shouldStop);
  emitProgress({ libraryId, status: "completed", progress: 100, currentFolder: folderName, totalFolders: 1, scannedFolders: 1 });
};
