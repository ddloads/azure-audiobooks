import { Request, Response } from "express";
import fs from "fs";
import path from "path";
import prisma from "../lib/prisma";

const getSingleParam = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

const getAudioContentType = (filenameOrPath: string): string => {
  switch (path.extname(filenameOrPath).toLowerCase()) {
    case ".m4a":
    case ".m4b":
    case ".mp4":
      return "audio/mp4";
    case ".aac":
      return "audio/aac";
    case ".flac":
      return "audio/flac";
    case ".ogg":
      return "audio/ogg";
    case ".opus":
      return "audio/opus";
    case ".wav":
      return "audio/wav";
    case ".mp3":
    default:
      return "audio/mpeg";
  }
};

const encodeHeaderFilename = (filename: string): string =>
  encodeURIComponent(path.basename(filename)).replace(
    /['()]/g,
    (char) => `%${char.charCodeAt(0).toString(16).toUpperCase()}`,
  );

export const streamAudio = async (req: Request, res: Response) => {
  try {
    const fileId = getSingleParam(req.params.fileId);
    if (!fileId) {
      res.status(400).json({ error: "Invalid file id" });
      return;
    }

    const audioFile = await prisma.audioFile.findUnique({
      where: { id: fileId },
    });

    if (!audioFile) {
      console.warn(`Stream 404: File record not found in database for ID ${fileId}`);
      res.status(404).json({ error: "File not found" });
      return;
    }

    const filePath = audioFile.path;
    if (!fs.existsSync(filePath)) {
      console.warn(`Stream 404: Physical file not found at path: ${filePath}`);
      res.status(404).json({ error: "File not found on disk" });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = getAudioContentType(audioFile.filename || filePath);
    const contentDisposition = `inline; filename*=UTF-8''${encodeHeaderFilename(audioFile.filename)}`;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      if (
        !Number.isFinite(start) ||
        !Number.isFinite(end) ||
        start < 0 ||
        end >= fileSize ||
        start > end
      ) {
        res.status(416).set("Content-Range", `bytes */${fileSize}`).end();
        return;
      }

      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition,
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        "Content-Length": fileSize,
        "Accept-Ranges": "bytes",
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition,
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error("Stream error:", error);
    res.status(500).json({ error: "Streaming failed" });
  }
};
