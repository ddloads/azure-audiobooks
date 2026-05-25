import { parentPort } from "worker_threads";
import { checkAudioSilence } from "../utils/silenceDetect";
import prisma from "../lib/prisma";

export type SilenceCheckProgressPayload = {
  libraryId?: string;
  status: "starting" | "checking" | "completed" | "failed";
  progress: number;
  currentFile?: string;
  totalFiles?: number;
  checkedFiles?: number;
  silentFiles?: number;
};

type RunMessage = {
  type: "run";
  jobId: string;
  libraryId?: string;
  recheckAll?: boolean;
};

type CancelMessage = {
  type: "cancel";
  jobId: string;
};

type WorkerMessage = RunMessage | CancelMessage;

if (!parentPort) {
  throw new Error("Silence check worker must be started inside a worker thread");
}

const port = parentPort;

let currentJob: {
  jobId: string;
  libraryId?: string;
  cancelled: boolean;
  abortController: AbortController;
} | null = null;

const emitProgress = (jobId: string, data: SilenceCheckProgressPayload) => {
  port.postMessage({ type: "progress", jobId, data });
};

port.on("message", async (message: WorkerMessage) => {
  if (message.type === "cancel") {
    if (currentJob?.jobId === message.jobId) {
      currentJob.cancelled = true;
      currentJob.abortController.abort();
    }
    return;
  }

  if (currentJob) {
    port.postMessage({
      type: "failed",
      jobId: message.jobId,
      error: "Silence check worker is already busy",
    });
    return;
  }

  const abortController = new AbortController();
  currentJob = {
    jobId: message.jobId,
    libraryId: message.libraryId,
    cancelled: false,
    abortController,
  };

  try {
    await runSilenceCheck(
      message.jobId,
      message.libraryId,
      message.recheckAll ?? false,
      abortController.signal,
    );

    if (currentJob.cancelled) {
      port.postMessage({ type: "cancelled", jobId: message.jobId });
    } else {
      port.postMessage({ type: "completed", jobId: message.jobId });
    }
  } catch (error) {
    port.postMessage({
      type: "failed",
      jobId: message.jobId,
      error: error instanceof Error ? error.message : String(error),
    });
  } finally {
    currentJob = null;
  }
});

async function runSilenceCheck(
  jobId: string,
  libraryId: string | undefined,
  recheckAll: boolean,
  signal: AbortSignal,
) {
  emitProgress(jobId, {
    libraryId,
    status: "starting",
    progress: 0,
  });

  const baseWhere = libraryId ? { book: { libraryId } } : {};
  // Default behavior: re-probe anything that hasn't passed yet — unchecked
  // files (isSilent IS NULL) and previously-failed files (isSilent = true).
  // Files that already passed (isSilent = false) are skipped so repeated
  // clicks don't waste time on known-good audio. recheckAll forces a full sweep.
  const targetWhere = recheckAll
    ? baseWhere
    : { ...baseWhere, OR: [{ isSilent: null }, { isSilent: true }] };

  const totalFiles = await prisma.audioFile.count({ where: targetWhere });

  await prisma.silenceCheckJob.update({
    where: { id: jobId },
    data: { totalFiles },
  });

  if (totalFiles === 0) {
    emitProgress(jobId, {
      libraryId,
      status: "completed",
      progress: 100,
      totalFiles: 0,
      checkedFiles: 0,
      silentFiles: 0,
    });
    return;
  }

  let checkedFiles = 0;
  let silentFiles = 0;
  const batchSize = 20;
  let cursor: string | undefined;

  while (!signal.aborted) {
    const batch = await prisma.audioFile.findMany({
      where: targetWhere,
      select: { id: true, path: true, filename: true },
      take: batchSize,
      ...(cursor ? { skip: 1, cursor: { id: cursor } } : {}),
      orderBy: { id: "asc" },
    });

    if (batch.length === 0) break;

    for (const file of batch) {
      if (signal.aborted) break;

      emitProgress(jobId, {
        libraryId,
        status: "checking",
        progress: Math.round((checkedFiles / totalFiles) * 100),
        currentFile: file.filename,
        totalFiles,
        checkedFiles,
        silentFiles,
      });

      const result = await checkAudioSilence(file.path, signal);

      if (signal.aborted) break;

      await prisma.audioFile.update({
        where: { id: file.id },
        data: {
          isSilent: result.error === "cancelled" ? undefined : result.isSilent,
          maxVolumeDb: result.error ? undefined : result.maxVolumeDb,
          silenceCheckedAt: result.error === "cancelled" ? undefined : new Date(),
        },
      });

      if (!result.error || result.error !== "cancelled") {
        checkedFiles++;
        if (result.isSilent) silentFiles++;
      }

      await prisma.silenceCheckJob.update({
        where: { id: jobId },
        data: { checkedFiles, silentFiles },
      });
    }

    cursor = batch[batch.length - 1].id;
    if (batch.length < batchSize) break;
  }

  if (!signal.aborted) {
    emitProgress(jobId, {
      libraryId,
      status: "completed",
      progress: 100,
      totalFiles,
      checkedFiles,
      silentFiles,
    });
  }
}

port.postMessage({ type: "ready" });
