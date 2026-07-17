import { Server } from "socket.io";
import { Server as HttpServer } from "http";
import type { SilenceCheckProgressPayload } from "../workers/silenceCheckWorker";
import { getAllowedOrigins, isOriginAllowed } from "../utils/securityConfig";
import prisma from "./prisma";
import { extractTokenFromHeaders, verifyAuthToken } from "../middleware/authMiddleware";

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

  io.use(async (socket, next) => {
    const authorization = socket.handshake.headers.authorization;
    const headerAuthorization = Array.isArray(authorization) ? authorization[0] : authorization;
    const authToken =
      typeof socket.handshake.auth?.token === "string" ? socket.handshake.auth.token : undefined;
    const token = authToken || extractTokenFromHeaders(headerAuthorization, socket.handshake.headers.cookie);

    if (!token) {
      next(new Error("Unauthorized"));
      return;
    }

    try {
      const decoded = verifyAuthToken(token);
      const user = await prisma.user.findUnique({
        where: { id: decoded.userId },
        select: { id: true, role: true, tokenVersion: true },
      });

      if (!user || user.tokenVersion !== decoded.tokenVersion) {
        next(new Error("Unauthorized"));
        return;
      }

      socket.data.user = {
        userId: user.id,
        role: user.role,
        tokenVersion: user.tokenVersion,
      };
      next();
    } catch {
      next(new Error("Unauthorized"));
    }
  });

  io.on("connection", (socket) => {
    if (socket.data.user?.role === "ADMIN") {
      socket.join("admins");
    }

    socket.on("disconnect", () => {
      socket.leave("admins");
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
    io.to("admins").emit("scanProgress", data);
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
    io.to("admins").emit("mergeProgress", data);
  }
};

export const emitWriteTagsProgress = (data: WriteTagsProgressPayload) => {
  if (data.status === "pending" || data.status === "running") {
    activeWriteTagsTasks.set(data.id, { ...data });
  } else {
    activeWriteTagsTasks.delete(data.id);
  }

  if (io) {
    io.to("admins").emit("writeTagsProgress", data);
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
    io.to("admins").emit("silenceCheckProgress", data);
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
