import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import type { SilenceCheckProgressPayload } from "../workers/silenceCheckWorker";
import { getAllowedOrigins, isOriginAllowed } from "../utils/securityConfig";

let io: Server;
export type WriteTagsProgressPayload = {
  id: string;
  bookId: string;
  bookTitle: string | null;
  status: "pending" | "running" | "completed" | "failed";
  totalFiles: number;
  processedFiles: number;
  currentFile: string | null;
  currentFileStartedAt: string | null;
  lastCompletedFile: string | null;
  lastCompletedAt: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  message: string | null;
  stallTimeoutMs: number;
};
let latestActiveSilenceCheckTask:
  | ({ startedAt: string; updatedAt: string } & SilenceCheckProgressPayload)
  | null = null;

let latestActiveScanTask:
  | ({
      startedAt: string;
      updatedAt: string;
    } & Parameters<typeof emitScanProgress>[0])
  | null = null;
const activeMergeTasks = new Map<
  string,
  ({
    startedAt: string;
    updatedAt: string;
  } & Parameters<typeof emitMergeProgress>[0])
>();
const activeWriteTagsTasks = new Map<string, WriteTagsProgressPayload>();

export const initSocket = (server: HttpServer) => {
  const allowedOrigins = getAllowedOrigins();
  io = new Server(server, {
    cors: {
      origin(origin, callback) {
        if (isOriginAllowed(origin, allowedOrigins)) {
          callback(null, true);
          return;
        }
        callback(new Error(`Socket.IO CORS blocked for origin: ${origin}`));
      },
      credentials: true,
    },
  });

  io.on("connection", (socket) => {
    console.log("Client connected to socket");
    
    socket.on("disconnect", () => {
      console.log("Client disconnected from socket");
    });
  });

  return io;
};

export const getIO = () => {
  if (!io) {
    throw new Error("Socket.io not initialized!");
  }
  return io;
};

export const emitScanProgress = (data: {
  libraryId?: string;
  status: "starting" | "scanning" | "completed" | "failed";
  progress: number;
  currentFolder?: string;
  totalFolders?: number;
  scannedFolders?: number;
}) => {
  if (data.status === "starting" || data.status === "scanning") {
    latestActiveScanTask = {
      ...data,
      startedAt:
        data.status === "starting" || !latestActiveScanTask
          ? new Date().toISOString()
          : latestActiveScanTask.startedAt,
      updatedAt: new Date().toISOString(),
    };
  } else {
    latestActiveScanTask = null;
  }

  if (io) {
    io.emit("scanProgress", data);
  }
};

export const emitMergeProgress = (data: {
  bookId: string;
  status: "starting" | "running" | "completed" | "failed";
  progress: number;
  stage: string;
  detail?: string;
}) => {
  if (data.status === "starting" || data.status === "running") {
    const existing = activeMergeTasks.get(data.bookId);
    activeMergeTasks.set(data.bookId, {
      ...data,
      startedAt: existing?.startedAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    });
  } else {
    activeMergeTasks.delete(data.bookId);
  }

  if (io) {
    io.emit("mergeProgress", data);
  }
};

export const emitWriteTagsProgress = (data: WriteTagsProgressPayload) => {
  if (data.status === "pending" || data.status === "running") {
    activeWriteTagsTasks.set(data.id, { ...data });
  } else {
    activeWriteTagsTasks.delete(data.id);
  }

  if (io) {
    io.emit("writeTagsProgress", data);
  }
};

export const emitSilenceCheckProgress = (data: SilenceCheckProgressPayload) => {
  if (data.status === "starting" || data.status === "checking") {
    latestActiveSilenceCheckTask = {
      ...data,
      startedAt:
        data.status === "starting" || !latestActiveSilenceCheckTask
          ? new Date().toISOString()
          : latestActiveSilenceCheckTask.startedAt,
      updatedAt: new Date().toISOString(),
    };
  } else {
    latestActiveSilenceCheckTask = null;
  }

  if (io) {
    io.emit("silenceCheckProgress", data);
  }
};

export const getActiveSilenceCheckTask = () =>
  latestActiveSilenceCheckTask ? { ...latestActiveSilenceCheckTask } : null;

export const getActiveScanTask = () =>
  latestActiveScanTask ? { ...latestActiveScanTask } : null;

export const getActiveMergeTasks = () =>
  Array.from(activeMergeTasks.values()).map((task) => ({ ...task }));

export const getActiveWriteTagsTasks = () =>
  Array.from(activeWriteTagsTasks.values()).map((task) => ({ ...task }));
