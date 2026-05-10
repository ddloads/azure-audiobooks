import { parentPort } from "worker_threads";
import { scanLibrary, type ScanProgressPayload } from "../utils/scanner";

type RunMessage = {
  type: "run";
  jobId: string;
  libraryId?: string;
};

type CancelMessage = {
  type: "cancel";
  jobId: string;
};

type WorkerMessage = RunMessage | CancelMessage;

if (!parentPort) {
  throw new Error("Scan worker must be started inside a worker thread");
}

const port = parentPort;

let currentJob: {
  jobId: string;
  libraryId?: string;
  cancelled: boolean;
} | null = null;

const emitProgress = (jobId: string, data: ScanProgressPayload) => {
  port.postMessage({
    type: "progress",
    jobId,
    data,
  });
};

port.on("message", async (message: WorkerMessage) => {
  if (message.type === "cancel") {
    if (currentJob?.jobId === message.jobId) {
      currentJob.cancelled = true;
    }
    return;
  }

  if (currentJob) {
    port.postMessage({
      type: "failed",
      jobId: message.jobId,
      error: "Scan worker is already busy",
    });
    return;
  }

  currentJob = {
    jobId: message.jobId,
    libraryId: message.libraryId,
    cancelled: false,
  };

  try {
    await scanLibrary(message.libraryId, {
      emitProgress: (data) => emitProgress(message.jobId, data),
      shouldStop: () => currentJob?.cancelled ?? false,
    });

    if (currentJob.cancelled) {
      port.postMessage({
        type: "cancelled",
        jobId: message.jobId,
      });
    } else {
      port.postMessage({
        type: "completed",
        jobId: message.jobId,
      });
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

port.postMessage({
  type: "ready",
});
