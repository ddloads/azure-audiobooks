import { Request, Response } from "express";
import fs from "fs";
import fsp from "fs/promises";
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

// 32 KB chunks keep the first data event small enough to flush over the wire
// quickly on slow storage. ExoPlayer's HTTP timeout starts ticking as soon as
// the response headers are sent, so the first read needs to complete fast.
const STREAM_HIGH_WATER_MARK = 32 * 1024;

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

    let stat;
    try {
      stat = await fsp.stat(filePath);
    } catch (err: any) {
      if (err?.code === "ENOENT") {
        console.warn(`Stream 404: Physical file not found at path: ${filePath}`);
        res.status(404).json({ error: "File not found on disk" });
        return;
      }
      throw err;
    }

    const fileSize = stat.size;
    const range = req.headers.range;
    const contentType = getAudioContentType(audioFile.filename || filePath);
    const contentDisposition = `inline; filename*=UTF-8''${encodeHeaderFilename(audioFile.filename)}`;

    const startStream = (start: number, end: number, status: 200 | 206) => {
      const chunksize = end - start + 1;
      const head: Record<string, string | number> = {
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": contentType,
        "Content-Disposition": contentDisposition,
      };
      if (status === 206) {
        head["Content-Range"] = `bytes ${start}-${end}/${fileSize}`;
      }
      res.writeHead(status, head);

      const file = fs.createReadStream(filePath, {
        start,
        end,
        highWaterMark: STREAM_HIGH_WATER_MARK,
      });

      // Surface stream errors instead of letting the connection hang open.
      file.on("error", (err) => {
        console.error(`Stream read error for ${filePath}:`, err);
        if (!res.headersSent) {
          res.status(500).end();
        } else {
          res.destroy(err);
        }
      });
      // If the client disconnects, abort the file read so we don't keep
      // pulling bytes off slow storage for a dead socket.
      res.on("close", () => {
        if (!file.destroyed) file.destroy();
      });

      file.pipe(res);
    };

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
      startStream(start, end, 206);
    } else {
      startStream(0, fileSize - 1, 200);
    }
  } catch (error) {
    console.error("Stream error:", error);
    if (!res.headersSent) {
      res.status(500).json({ error: "Streaming failed" });
    } else {
      res.destroy();
    }
  }
};
