import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import { emitScanProgress } from "./socket";
import prisma from "./prisma";
import type { ScanProgressPayload } from "../utils/scanner";
import { invalidateRecommendationCache } from "./recommendationCache";

type ScanJobRequest = {
  id: string;
  libraryId?: string;
  folderPath?: string;
  trigger: string;
  enqueuedAt: string;
};

type EnqueueOptions = {
  dedupe?: boolean;
  folderPath?: string;
};

type WorkerCommand =
  | { type: "run"; jobId: string; libraryId?: string; folderPath?: string; trigger: string }
  | { type: "cancel"; jobId?: string };

type WorkerResponse =
  | { type: "ready" }
  | { type: "progress"; jobId: string; data: ScanProgressPayload }
  | { type: "completed"; jobId: string }
  | { type: "failed"; jobId: string; error: string }
  | { type: "cancelled"; jobId: string };

type WorkerSlot = {
  worker: Worker;
  ready: boolean;
  busy: boolean;
  currentJob: ScanJobRequest | null;
};

const configuredPoolSize = (() => {
  const parsed = Number.parseInt(process.env.SCAN_WORKER_POOL_SIZE || "", 10);
  if (Number.isFinite(parsed) && parsed > 0) {
    return parsed;
  }

  return 2;
})();

const getWorkerScriptPath = () => {
  const workerPath = path.join(process.cwd(), "dist", "workers", "scanWorker.js");
  if (!fs.existsSync(workerPath)) {
    throw new Error(`Scan worker not found at ${workerPath}. Build the server before running scans.`);
  }

  return workerPath;
};

const createWorkerSlot = (): WorkerSlot => {
  const worker = new Worker(getWorkerScriptPath(), {
    env: process.env,
  });

  return {
    worker,
    ready: false,
    busy: false,
    currentJob: null,
  };
};

class ScanJobPool {
  private readonly workers: WorkerSlot[] = [];

  private readonly queue: ScanJobRequest[] = [];

  constructor(private readonly size: number) {
    for (let index = 0; index < this.size; index++) {
      this.workers.push(this.attachWorker(createWorkerSlot()));
    }
  }

  async enqueue(libraryId?: string, trigger = "manual", options: EnqueueOptions = {}) {
    if (options.folderPath) {
      if (await this.hasActiveFolderJob(libraryId, options.folderPath)) {
        return {
          status: "skipped" as const,
          message: "Folder scan already queued or running",
          jobId: null,
        };
      }
    } else if (options.dedupe && await this.hasActiveLibraryJob(libraryId)) {
      return {
        status: "skipped" as const,
        message: libraryId
          ? "Library scan already queued or running"
          : "Full library scan already queued or running",
        jobId: null,
      };
    }

    const persistedJob = await prisma.libraryScanJob.create({
      data: {
        libraryId,
        trigger,
        status: "queued",
      },
      select: { id: true },
    });

    const job: ScanJobRequest = {
      id: persistedJob.id,
      libraryId,
      folderPath: options.folderPath,
      trigger,
      enqueuedAt: new Date().toISOString(),
    };

    if (options.folderPath) {
      this.queue.unshift(job);
    } else {
      this.queue.push(job);
    }
    const dispatched = this.dispatch();

    return {
      status: dispatched ? ("started" as const) : ("queued" as const),
      message: options.folderPath
        ? (dispatched ? "Folder scan started" : "Folder scan queued")
        : libraryId
          ? (dispatched ? "Library scan started" : "Library scan queued")
          : (dispatched ? "Full library scan started" : "Full library scan queued"),
      jobId: job.id,
    };
  }

  async stopAll() {
    const queuedJobs = this.queue.splice(0);
    const queuedJobIds = queuedJobs.map((job) => job.id);

    if (queuedJobIds.length > 0) {
      await prisma.libraryScanJob.updateMany({
        where: { id: { in: queuedJobIds } },
        data: {
          status: "cancelled",
          finishedAt: new Date(),
        },
      });
    }

    for (const slot of this.workers) {
      if (!slot.busy || !slot.currentJob) {
        continue;
      }

      void this.updateJob(slot.currentJob.id, {
        status: "cancelling",
      });
      slot.worker.postMessage({
        type: "cancel",
        jobId: slot.currentJob.id,
      } satisfies WorkerCommand);
    }

    emitScanProgress({
      status: "failed",
      progress: 0,
    });
  }

  private attachWorker(slot: WorkerSlot): WorkerSlot {
    slot.worker.on("message", (message: WorkerResponse) => {
      this.handleWorkerMessage(slot, message);
    });

    slot.worker.on("error", (error) => {
      this.failCurrentJob(slot, error);
      this.resetSlot(slot);
    });

    slot.worker.on("exit", (code) => {
      if (code !== 0) {
        this.failCurrentJob(slot, new Error(`Scan worker exited with code ${code}`));
      }

      this.resetSlot(slot);
    });

    return slot;
  }

  private resetSlot(slot: WorkerSlot) {
    slot.ready = false;
    slot.busy = false;
    slot.currentJob = null;

    slot.worker = createWorkerSlot().worker;
    this.attachWorker(slot);
  }

  private handleWorkerMessage(slot: WorkerSlot, message: WorkerResponse) {
    if (message.type === "ready") {
      slot.ready = true;
      this.dispatch();
      return;
    }

    if (!slot.currentJob || slot.currentJob.id !== message.jobId) {
      return;
    }

    if (message.type === "progress") {
      void this.updateJobProgress(message.jobId, message.data);
      emitScanProgress(message.data);
      return;
    }

    if (message.type === "failed") {
      void this.updateJob(message.jobId, {
        status: "failed",
        error: message.error,
        finishedAt: new Date(),
      });
      emitScanProgress({
        libraryId: slot.currentJob.libraryId,
        status: "failed",
        progress: 0,
      });
      this.clearSlot(slot);
      this.dispatch();
      return;
    }

    if (message.type === "completed") {
      invalidateRecommendationCache();
      void this.updateJob(message.jobId, {
        status: "completed",
        finishedAt: new Date(),
      });
      this.clearSlot(slot);
      this.dispatch();
      return;
    }

    if (message.type === "cancelled") {
      void this.updateJob(message.jobId, {
        status: "cancelled",
        finishedAt: new Date(),
      });
      this.clearSlot(slot);
      this.dispatch();
    }
  }

  private failCurrentJob(slot: WorkerSlot, error: unknown) {
    if (!slot.currentJob) {
      return;
    }

    console.error("Scan worker error:", error);
    void this.updateJob(slot.currentJob.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
    });
    emitScanProgress({
      libraryId: slot.currentJob.libraryId,
      status: "failed",
      progress: 0,
    });
  }

  private clearSlot(slot: WorkerSlot) {
    slot.busy = false;
    slot.currentJob = null;
  }

  private dispatch() {
    let dispatched = false;

    for (const slot of this.workers) {
      if (!slot.ready || slot.busy) {
        continue;
      }

      const job = this.queue.shift();
      if (!job) {
        break;
      }

      slot.busy = true;
      slot.currentJob = job;
      void this.updateJob(job.id, {
        status: "running",
        startedAt: new Date(),
      });
      slot.worker.postMessage({
        type: "run",
        jobId: job.id,
        libraryId: job.libraryId,
        folderPath: job.folderPath,
        trigger: job.trigger,
      } satisfies WorkerCommand);
      dispatched = true;
    }

    return dispatched;
  }

  private async hasActiveLibraryJob(libraryId?: string) {
    const matchesLibrary = (job: ScanJobRequest) => job.libraryId === libraryId;
    const queuedMatch = this.queue.some(matchesLibrary);
    const runningMatch = this.workers.some((slot) => slot.currentJob && matchesLibrary(slot.currentJob));

    if (queuedMatch || runningMatch) {
      return true;
    }

    const activeJob = await prisma.libraryScanJob.findFirst({
      where: {
        libraryId: libraryId ?? null,
        status: { in: ["queued", "running", "cancelling"] },
      },
      select: { id: true },
    });

    return Boolean(activeJob);
  }

  private async hasActiveFolderJob(libraryId: string | undefined, folderPath: string) {
    const normalizedFolderPath = folderPath.toLowerCase();
    const matchesFolder = (job: ScanJobRequest) =>
      job.libraryId === libraryId &&
      job.folderPath !== undefined &&
      job.folderPath.toLowerCase() === normalizedFolderPath;

    const queuedMatch = this.queue.some(matchesFolder);
    const runningMatch = this.workers.some((slot) => slot.currentJob && matchesFolder(slot.currentJob));

    if (queuedMatch || runningMatch) {
      return true;
    }

    const activeJob = await prisma.libraryScanJob.findFirst({
      where: {
        libraryId: libraryId ?? null,
        trigger: "watch-folder",
        status: { in: ["queued", "running", "cancelling"] },
      },
      select: { id: true },
    });

    return Boolean(activeJob);
  }

  private async updateJob(jobId: string, data: {
    status?: string;
    error?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
    totalFolders?: number | null;
    scannedFolders?: number;
  }) {
    try {
      await prisma.libraryScanJob.update({
        where: { id: jobId },
        data,
      });
    } catch (error) {
      console.error(`Failed to update scan job ${jobId}:`, error);
    }
  }

  private async updateJobProgress(jobId: string, data: ScanProgressPayload) {
    const updateData: {
      status?: string;
      totalFolders?: number;
      scannedFolders?: number;
      startedAt?: Date;
      finishedAt?: Date;
    } = {};

    if (data.status === "starting") {
      updateData.status = "running";
      updateData.startedAt = new Date();
    }

    if (data.status === "scanning") {
      updateData.status = "running";
    }

    if (data.status === "completed") {
      updateData.status = "completed";
      updateData.finishedAt = new Date();
    }

    if (data.status === "failed") {
      updateData.status = "failed";
      updateData.finishedAt = new Date();
    }

    if (data.totalFolders !== undefined) {
      updateData.totalFolders = data.totalFolders;
    }

    if (data.scannedFolders !== undefined) {
      updateData.scannedFolders = data.scannedFolders;
    }

    if (Object.keys(updateData).length === 0) {
      return;
    }

    await this.updateJob(jobId, updateData);
  }
}

const pool = new ScanJobPool(configuredPoolSize);

export const requestLibraryScan = (libraryId?: string, trigger?: string, options?: EnqueueOptions) =>
  pool.enqueue(libraryId, trigger, options);

export const requestLibraryFolderScan = (
  libraryId: string,
  folderPath: string,
  trigger?: string,
  options?: EnqueueOptions,
) => pool.enqueue(libraryId, trigger, { ...options, folderPath });

// Reaps non-terminal LibraryScanJob rows left over from a previous process.
// The in-memory queue starts empty on restart, so anything still flagged
// queued/running/cancelling in the DB is necessarily orphaned and would
// otherwise block new requests via the pool's dedupe checks.
export const reapStaleScanJobs = async () => {
  try {
    const result = await prisma.libraryScanJob.updateMany({
      where: { status: { in: ["queued", "running", "cancelling"] } },
      data: { status: "failed", error: "Server restarted", finishedAt: new Date() },
    });
    return result.count;
  } catch (err) {
    console.error("Failed to reap stale scan jobs:", err);
    return 0;
  }
};

export const stopScanning = () => pool.stopAll();
