import { Response } from "express";
import { AuthRequest } from "../../middleware/authMiddleware";
import { requestSilenceCheck } from "../../lib/silenceCheckPool";
import prisma from "../../lib/prisma";
import { getSingleParam } from "./shared";

export const startSilenceCheck = async (req: AuthRequest, res: Response) => {
  try {
    const result = await requestSilenceCheck(undefined, "manual");
    res.json(result);
  } catch (error) {
    console.error("Failed to start silence check:", error);
    res.status(500).json({ error: "Failed to start silence check" });
  }
};

export const startLibrarySilenceCheck = async (req: AuthRequest, res: Response) => {
  try {
    const libraryId = getSingleParam(req.params.libraryId);
    if (!libraryId) {
      res.status(400).json({ error: "Invalid library id" });
      return;
    }

    const library = await prisma.library.findUnique({
      where: { id: libraryId },
      select: { id: true },
    });

    if (!library) {
      res.status(404).json({ error: "Library not found" });
      return;
    }

    const result = await requestSilenceCheck(libraryId, "manual");
    res.json(result);
  } catch (error) {
    console.error("Failed to start library silence check:", error);
    res.status(500).json({ error: "Failed to start silence check" });
  }
};

export const getSilenceCheckResults = async (req: AuthRequest, res: Response) => {
  try {
    const libraryId = req.query.libraryId as string | undefined;

    const where = libraryId
      ? { libraryId: libraryId as string, isSilent: true, bookId: { not: null as null } }
      : { isSilent: true, bookId: { not: null as null } };

    const silentFiles = await prisma.indexedAudioFile.findMany({
      where,
      select: {
        id: true,
        path: true,
        fileName: true,
        maxVolumeDb: true,
        silenceCheckedAt: true,
        book: {
          select: {
            id: true,
            title: true,
            author: { select: { name: true } },
          },
        },
      },
      orderBy: { silenceCheckedAt: "desc" },
      take: 200,
    });

    const totalSilent = await prisma.indexedAudioFile.count({ where });
    const totalChecked = await prisma.indexedAudioFile.count({
      where: libraryId
        ? { libraryId, silenceCheckedAt: { not: null } }
        : { silenceCheckedAt: { not: null } },
    });
    const totalFiles = await prisma.indexedAudioFile.count({
      where: libraryId
        ? { libraryId, bookId: { not: null as null } }
        : { bookId: { not: null as null } },
    });

    res.json({ totalFiles, totalChecked, totalSilent, silentFiles });
  } catch (error) {
    console.error("Failed to get silence check results:", error);
    res.status(500).json({ error: "Failed to get results" });
  }
};

export const getSilenceCheckJobStatus = async (req: AuthRequest, res: Response) => {
  try {
    const libraryId = req.query.libraryId as string | undefined;

    const latestJob = await prisma.silenceCheckJob.findFirst({
      where: libraryId ? { libraryId } : {},
      orderBy: { createdAt: "desc" },
      select: {
        id: true,
        status: true,
        totalFiles: true,
        checkedFiles: true,
        silentFiles: true,
        startedAt: true,
        finishedAt: true,
        createdAt: true,
        error: true,
      },
    });

    res.json({ job: latestJob ?? null });
  } catch (error) {
    console.error("Failed to get silence check status:", error);
    res.status(500).json({ error: "Failed to get status" });
  }
};
