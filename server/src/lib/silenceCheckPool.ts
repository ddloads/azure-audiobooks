import fs from "fs";
import path from "path";
import { Worker } from "worker_threads";
import { emitSilenceCheckProgress } from "./socket";
import prisma from "./prisma";
import type { SilenceCheckProgressPayload } from "../workers/silenceCheckWorker";

type JobRequest = {
  id: string;
  libraryId?: string;
  trigger: string;
  enqueuedAt: string;
};

type WorkerCommand =
  | { type: "run"; jobId: string; libraryId?: string }
  | { type: "cancel"; jobId: string };

type WorkerResponse =
  | { type: "ready" }
  | { type: "progress"; jobId: string; data: SilenceCheckProgressPayload }
  | { type: "completed"; jobId: string }
  | { type: "failed"; jobId: string; error: string }
  | { type: "cancelled"; jobId: string };

type WorkerSlot = {
  worker: Worker;
  ready: boolean;
  busy: boolean;
  currentJob: JobRequest | null;
};

const getWorkerPath = () => {
  const workerPath = path.join(process.cwd(), "dist", "workers", "silenceCheckWorker.js");
  if (!fs.existsSync(workerPath)) {
    throw new Error(`Silence check worker not found at ${workerPath}. Build the server first.`);
  }
  return workerPath;
};

const createSlot = (): WorkerSlot => ({
  worker: new Worker(getWorkerPath(), { env: process.env }),
  ready: false,
  busy: false,
  currentJob: null,
});

class SilenceCheckPool {
  private readonly slots: WorkerSlot[] = [];
  private readonly queue: JobRequest[] = [];

  constructor() {
    this.slots.push(this.attachWorker(createSlot()));
  }

  async enqueue(libraryId?: string, trigger = "manual") {
    if (await this.hasActiveJob(libraryId)) {
      return {
        status: "skipped" as const,
        message: "Silence check already queued or running",
        jobId: null,
      };
    }

    const persisted = await prisma.silenceCheckJob.create({
      data: { libraryId, trigger, status: "queued" },
      select: { id: true },
    });

    const job: JobRequest = {
      id: persisted.id,
      libraryId,
      trigger,
      enqueuedAt: new Date().toISOString(),
    };

    this.queue.push(job);
    const dispatched = this.dispatch();

    return {
      status: dispatched ? ("started" as const) : ("queued" as const),
      message: dispatched ? "Silence check started" : "Silence check queued",
      jobId: job.id,
    };
  }

  async stopAll() {
    const queued = this.queue.splice(0);
    if (queued.length > 0) {
      await prisma.silenceCheckJob.updateMany({
        where: { id: { in: queued.map((j) => j.id) } },
        data: { status: "cancelled", finishedAt: new Date() },
      });
    }

    for (const slot of this.slots) {
      if (!slot.busy || !slot.currentJob) continue;
      void this.updateJob(slot.currentJob.id, { status: "cancelling" });
      slot.worker.postMessage({ type: "cancel", jobId: slot.currentJob.id } satisfies WorkerCommand);
    }
  }

  private attachWorker(slot: WorkerSlot): WorkerSlot {
    slot.worker.on("message", (msg: WorkerResponse) => this.handleMessage(slot, msg));
    slot.worker.on("error", (err) => {
      this.failCurrentJob(slot, err);
      this.resetSlot(slot);
    });
    slot.worker.on("exit", (code) => {
      if (code !== 0) this.failCurrentJob(slot, new Error(`Worker exited with code ${code}`));
      this.resetSlot(slot);
    });
    return slot;
  }

  private resetSlot(slot: WorkerSlot) {
    slot.ready = false;
    slot.busy = false;
    slot.currentJob = null;
    slot.worker = new Worker(getWorkerPath(), { env: process.env });
    this.attachWorker(slot);
  }

  private handleMessage(slot: WorkerSlot, msg: WorkerResponse) {
    if (msg.type === "ready") {
      slot.ready = true;
      this.dispatch();
      return;
    }

    if (!slot.currentJob || slot.currentJob.id !== msg.jobId) return;

    if (msg.type === "progress") {
      void this.updateJobProgress(msg.jobId, msg.data);
      emitSilenceCheckProgress(msg.data);
      return;
    }

    if (msg.type === "failed") {
      void this.updateJob(msg.jobId, { status: "failed", error: msg.error, finishedAt: new Date() });
      emitSilenceCheckProgress({
        libraryId: slot.currentJob.libraryId,
        status: "failed",
        progress: 0,
      });
      this.clearSlot(slot);
      this.dispatch();
      return;
    }

    if (msg.type === "completed") {
      void this.updateJob(msg.jobId, { status: "completed", finishedAt: new Date() });
      this.clearSlot(slot);
      this.dispatch();
      return;
    }

    if (msg.type === "cancelled") {
      void this.updateJob(msg.jobId, { status: "cancelled", finishedAt: new Date() });
      this.clearSlot(slot);
      this.dispatch();
    }
  }

  private failCurrentJob(slot: WorkerSlot, error: unknown) {
    if (!slot.currentJob) return;
    console.error("Silence check worker error:", error);
    void this.updateJob(slot.currentJob.id, {
      status: "failed",
      error: error instanceof Error ? error.message : String(error),
      finishedAt: new Date(),
    });
    emitSilenceCheckProgress({ libraryId: slot.currentJob.libraryId, status: "failed", progress: 0 });
  }

  private clearSlot(slot: WorkerSlot) {
    slot.busy = false;
    slot.currentJob = null;
  }

  private dispatch() {
    let dispatched = false;
    for (const slot of this.slots) {
      if (!slot.ready || slot.busy) continue;
      const job = this.queue.shift();
      if (!job) break;
      slot.busy = true;
      slot.currentJob = job;
      void this.updateJob(job.id, { status: "running", startedAt: new Date() });
      slot.worker.postMessage({ type: "run", jobId: job.id, libraryId: job.libraryId } satisfies WorkerCommand);
      dispatched = true;
    }
    return dispatched;
  }

  private async hasActiveJob(libraryId?: string) {
    const inMemory =
      this.queue.some((j) => j.libraryId === libraryId) ||
      this.slots.some((s) => s.currentJob?.libraryId === libraryId);

    if (inMemory) return true;

    const active = await prisma.silenceCheckJob.findFirst({
      where: {
        libraryId: libraryId ?? null,
        status: { in: ["queued", "running", "cancelling"] },
      },
      select: { id: true },
    });

    return Boolean(active);
  }

  private async updateJob(jobId: string, data: {
    status?: string;
    error?: string | null;
    startedAt?: Date;
    finishedAt?: Date;
    totalFiles?: number;
    checkedFiles?: number;
    silentFiles?: number;
  }) {
    try {
      await prisma.silenceCheckJob.update({ where: { id: jobId }, data });
    } catch (err) {
      console.error(`Failed to update silence check job ${jobId}:`, err);
    }
  }

  private async updateJobProgress(jobId: string, data: SilenceCheckProgressPayload) {
    const patch: Parameters<typeof this.updateJob>[1] = {};

    if (data.status === "starting") {
      patch.status = "running";
      patch.startedAt = new Date();
    } else if (data.status === "checking") {
      patch.status = "running";
    } else if (data.status === "completed") {
      patch.status = "completed";
      patch.finishedAt = new Date();
    } else if (data.status === "failed") {
      patch.status = "failed";
      patch.finishedAt = new Date();
    }

    if (data.totalFiles !== undefined) patch.totalFiles = data.totalFiles;
    if (data.checkedFiles !== undefined) patch.checkedFiles = data.checkedFiles;
    if (data.silentFiles !== undefined) patch.silentFiles = data.silentFiles;

    if (Object.keys(patch).length > 0) await this.updateJob(jobId, patch);
  }
}

const pool = new SilenceCheckPool();

export const requestSilenceCheck = (libraryId?: string, trigger?: string) =>
  pool.enqueue(libraryId, trigger);

export const stopSilenceCheck = () => pool.stopAll();
