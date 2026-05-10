import { Request, Response } from "express";
import fs from "fs";
import prisma from "../lib/prisma";

const getSingleParam = (value: string | string[] | undefined): string | null =>
  typeof value === "string" ? value : null;

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
      res.status(404).json({ error: "File not found" });
      return;
    }

    const filePath = audioFile.path;
    if (!fs.existsSync(filePath)) {
      res.status(404).json({ error: "File not found on disk" });
      return;
    }

    const stat = fs.statSync(filePath);
    const fileSize = stat.size;
    const range = req.headers.range;

    if (range) {
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : fileSize - 1;
      const chunksize = end - start + 1;
      const file = fs.createReadStream(filePath, { start, end });
      const head = {
        "Content-Range": `bytes ${start}-${end}/${fileSize}`,
        "Accept-Ranges": "bytes",
        "Content-Length": chunksize,
        "Content-Type": "audio/mpeg", // Should ideally be dynamic based on extension
      };
      res.writeHead(206, head);
      file.pipe(res);
    } else {
      const head = {
        "Content-Length": fileSize,
        "Content-Type": "audio/mpeg",
      };
      res.writeHead(200, head);
      fs.createReadStream(filePath).pipe(res);
    }
  } catch (error) {
    console.error("Stream error:", error);
    res.status(500).json({ error: "Streaming failed" });
  }
};
