import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import { emitScanProgress } from "./socket";
import type { ScanProgressPayload } from "../utils/scanner";

type ScanJobRequest = {
  id: string;
  libraryId?: string;
  enqueuedAt: string;
};

type WorkerCommand =
  | { type: "run"; jobId: string; libraryId?: string }
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

  return 1;
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

  private nextJobId = 0;

  constructor(private readonly size: number) {
    for (let index = 0; index < this.size; index++) {
      this.workers.push(this.attachWorker(createWorkerSlot()));
    }
  }

  enqueue(libraryId?: string) {
    const job: ScanJobRequest = {
      id: `scan-${Date.now()}-${++this.nextJobId}`,
      libraryId,
      enqueuedAt: new Date().toISOString(),
    };

    this.queue.push(job);
    const dispatched = this.dispatch();

    return {
      status: dispatched ? ("started" as const) : ("queued" as const),
      message: libraryId
        ? (dispatched ? "Library scan started" : "Library scan queued")
        : (dispatched ? "Full library scan started" : "Full library scan queued"),
      jobId: job.id,
    };
  }

  stopAll() {
    this.queue.length = 0;

    for (const slot of this.workers) {
      if (!slot.busy || !slot.currentJob) {
        continue;
      }

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
      emitScanProgress(message.data);
      return;
    }

    if (message.type === "failed") {
      emitScanProgress({
        libraryId: slot.currentJob.libraryId,
        status: "failed",
        progress: 0,
      });
      this.clearSlot(slot);
      this.dispatch();
      return;
    }

    if (message.type === "completed" || message.type === "cancelled") {
      this.clearSlot(slot);
      this.dispatch();
    }
  }

  private failCurrentJob(slot: WorkerSlot, error: unknown) {
    if (!slot.currentJob) {
      return;
    }

    console.error("Scan worker error:", error);
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
      slot.worker.postMessage({
        type: "run",
        jobId: job.id,
        libraryId: job.libraryId,
      } satisfies WorkerCommand);
      dispatched = true;
    }

    return dispatched;
  }
}

const pool = new ScanJobPool(configuredPoolSize);

export const requestLibraryScan = (libraryId?: string) => pool.enqueue(libraryId);

export const stopScanning = () => pool.stopAll();
