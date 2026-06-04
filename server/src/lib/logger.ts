import fs from "fs";
import path from "path";
import util from "util";
import { AsyncLocalStorage } from "async_hooks";
import pino, { type Logger as PinoLogger } from "pino";

export type LogLevel = "debug" | "info" | "warn" | "error";

export interface RequestLogContext {
  requestId: string;
  method?: string;
  path?: string;
  ip?: string;
  userId?: string;
  role?: string;
  title?: string;
}

export interface LogEntry {
  timestamp: string;
  level: LogLevel;
  context: string;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  ip?: string;
  userId?: string;
  role?: string;
  title?: string;
  statusCode?: number;
  durationMs?: number;
  tags?: string[];
  data?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

interface ListLogsOptions {
  levels?: LogLevel[];
  scope?: "all" | "metadata";
  search?: string;
  page?: number;
  limit?: number;
}

interface ListLogsResult {
  entries: LogEntry[];
  page: number;
  limit: number;
  totalMatching: number;
  totalPages: number;
  stats: Record<LogLevel, number>;
  logDirectory: string;
}

const LOG_DIR = path.join(process.cwd(), "data", "logs");
const requestContextStore = new AsyncLocalStorage<RequestLogContext>();
type LogPayload = Omit<LogEntry, "timestamp" | "level">;
type DestinationKind = "app" | "error";

type PinoDestinationState = {
  filePath: string;
  logger: PinoLogger;
};

let appDestination: PinoDestinationState | null = null;
let errorDestination: PinoDestinationState | null = null;
const originalConsole = {
  debug: console.debug.bind(console),
  info: console.info.bind(console),
  log: console.log.bind(console),
  warn: console.warn.bind(console),
  error: console.error.bind(console),
};

let consoleInstalled = false;

const SENSITIVE_KEYS = new Set([
  "password",
  "token",
  "authorization",
  "cookie",
  "set-cookie",
  "accessToken",
  "refreshToken",
]);

const ensureLogDir = () => {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
};

const ensureLogDirAsync = async () => {
  await fs.promises.mkdir(LOG_DIR, { recursive: true });
};

const getLogFilePath = (level: LogLevel) => {
  const dateKey = new Date().toISOString().slice(0, 10);
  const suffix = level === "error" ? "error" : "app";
  return path.join(LOG_DIR, `${suffix}-${dateKey}.log`);
};

const createDestinationLogger = (filePath: string): PinoLogger => {
  ensureLogDir();
  return pino(
    {
      base: null,
      level: "debug",
      timestamp: () => `,"timestamp":"${new Date().toISOString()}"`,
      formatters: {
        level: (label) => ({ level: label as LogLevel }),
      },
    },
    pino.destination({ dest: filePath, sync: false, mkdir: true }),
  );
};

const getDestinationLogger = (kind: DestinationKind): PinoLogger => {
  const filePath = getLogFilePath(kind === "error" ? "error" : "info");
  const current = kind === "error" ? errorDestination : appDestination;

  if (current?.filePath === filePath) return current.logger;

  const next = { filePath, logger: createDestinationLogger(filePath) };
  if (kind === "error") {
    errorDestination = next;
  } else {
    appDestination = next;
  }
  return next.logger;
};

const safeSerialize = (value: unknown, seen = new WeakSet<object>()): unknown => {
  if (value === null || value === undefined) return value;
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "bigint") return value.toString();
  if (Array.isArray(value)) return value.map((item) => safeSerialize(item, seen));

  if (typeof value === "object") {
    if (seen.has(value as object)) return "[Circular]";
    seen.add(value as object);

    const serialized: Record<string, unknown> = {};
    for (const [key, nestedValue] of Object.entries(value as Record<string, unknown>)) {
      serialized[key] = SENSITIVE_KEYS.has(key) ? "[Redacted]" : safeSerialize(nestedValue, seen);
    }
    return serialized;
  }

  return value;
};

const formatMessage = (args: unknown[]) =>
  args
    .map((arg) =>
      typeof arg === "string" ? arg : util.inspect(arg, { depth: 5, breakLength: Infinity }),
    )
    .join(" ");

const pickError = (args: unknown[]) => {
  for (const arg of args) {
    if (arg instanceof Error) {
      return {
        name: arg.name,
        message: arg.message,
        stack: arg.stack,
      };
    }
  }

  return undefined;
};

const appendEntry = (entry: LogEntry) => {
  const { timestamp: _timestamp, level, ...payload } = safeSerialize(entry) as LogEntry;
  const appLogger = getDestinationLogger("app");
  appLogger[level](payload as LogPayload);

  if (level === "error") {
    getDestinationLogger("error").error(payload as LogPayload);
  }
};

const writeEntry = (
  level: LogLevel,
  context: string,
  message: string,
  data?: unknown,
  error?: LogEntry["error"],
  extras?: { statusCode?: number; durationMs?: number; tags?: string[] },
) => {
  const requestContext = requestContextStore.getStore();
  const displayTitle = requestContext?.title;
  const enrichedMessage = displayTitle ? `[${displayTitle}] ${message}` : message;

  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    context,
    message: enrichedMessage,
    requestId: requestContext?.requestId,
    method: requestContext?.method,
    path: requestContext?.path,
    ip: requestContext?.ip,
    userId: requestContext?.userId,
    role: requestContext?.role,
    title: displayTitle,
    statusCode: extras?.statusCode,
    durationMs: extras?.durationMs,
    tags: extras?.tags,
    data: data === undefined ? undefined : safeSerialize(data),
    error,
  };

  appendEntry(entry);
};

export const runWithRequestContext = <T>(context: RequestLogContext, callback: () => T) =>
  requestContextStore.run(context, callback);

export const updateRequestContext = (patch: Partial<RequestLogContext>) => {
  const current = requestContextStore.getStore();
  if (current) {
    Object.assign(current, patch);
  }
};

export const createLogger = (context: string) => ({
  debug(message: string, data?: unknown) {
    writeEntry("debug", context, message, data);
  },
  info(message: string, data?: unknown) {
    writeEntry("info", context, message, data);
  },
  warn(message: string, data?: unknown) {
    writeEntry("warn", context, message, data);
  },
  error(message: string, errorOrData?: unknown, data?: unknown) {
    const error = errorOrData instanceof Error ? pickError([errorOrData]) : undefined;
    const payload = error ? data : errorOrData;
    writeEntry("error", context, message, payload, error);
  },
  http(message: string, statusCode: number, durationMs: number, data?: unknown) {
    const level: LogLevel = statusCode >= 500 ? "error" : statusCode >= 400 ? "warn" : "info";
    writeEntry(
      level,
      context,
      message,
      data === undefined ? undefined : safeSerialize(data),
      undefined,
      { statusCode, durationMs, tags: ["http"] },
    );
  },
});

export const logger = createLogger("app");

export const installConsoleLogger = () => {
  if (consoleInstalled) return;
  consoleInstalled = true;

  console.debug = (...args: unknown[]) => {
    originalConsole.debug(...args);
    writeEntry("debug", "console", formatMessage(args), safeSerialize(args), pickError(args));
  };

  console.info = (...args: unknown[]) => {
    originalConsole.info(...args);
    writeEntry("info", "console", formatMessage(args), safeSerialize(args), pickError(args));
  };

  console.log = (...args: unknown[]) => {
    originalConsole.log(...args);
    writeEntry("info", "console", formatMessage(args), safeSerialize(args), pickError(args));
  };

  console.warn = (...args: unknown[]) => {
    originalConsole.warn(...args);
    writeEntry("warn", "console", formatMessage(args), safeSerialize(args), pickError(args));
  };

  console.error = (...args: unknown[]) => {
    originalConsole.error(...args);
    writeEntry("error", "console", formatMessage(args), safeSerialize(args), pickError(args));
  };
};

export const installProcessLogger = () => {
  process.on("uncaughtException", (error) => {
    logger.error("Uncaught exception", error);
  });

  process.on("unhandledRejection", (reason) => {
    logger.error("Unhandled promise rejection", undefined, {
      reason: safeSerialize(reason),
    });
  });
};

const getLogFiles = async () => {
  await ensureLogDirAsync();
  const names = await fs.promises.readdir(LOG_DIR);
  return names
    .filter((name) => name.endsWith(".log"))
    .map((name) => path.join(LOG_DIR, name))
    .sort((a, b) => b.localeCompare(a));
};

const isMetadataRelatedLog = (entry: LogEntry) => {
  const pathValue = `${entry.path || ""} ${entry.method || ""}`.toLowerCase();
  if (
    /\/api\/admin\/books\/[^/\s]+\/(metadata|write-tags|match\/search|match\/apply)\b/.test(pathValue)
  ) {
    return true;
  }

  const text = JSON.stringify({
    context: entry.context,
    message: entry.message,
    path: entry.path,
    data: entry.data,
    error: entry.error,
  }).toLowerCase();

  const metadataPatterns = [
    /\bmetadata\b/,
    /\bwrite[- ]tags?\b/,
    /\bembed metadata\b/,
    /\baudible\b/,
    /\bgoogle books?\b/,
    /\bcover art\b/,
    /\bmatch\/search\b/,
    /\bmatch\/apply\b/,
  ];

  return metadataPatterns.some((pattern) => pattern.test(text));
};

export const listLogs = async (options: ListLogsOptions = {}): Promise<ListLogsResult> => {
  const page = Math.max(1, options.page ?? 1);
  const limit = Math.min(200, Math.max(1, options.limit ?? 100));
  const offset = (page - 1) * limit;
  const searchTerm = options.search?.trim().toLowerCase() || "";
  const activeLevels =
    options.levels && options.levels.length > 0 ? new Set<LogLevel>(options.levels) : null;
  const stats: Record<LogLevel, number> = {
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
  };

  const matchingEntries: LogEntry[] = [];
  let totalMatching = 0;

  for (const filePath of await getLogFiles()) {
    const lines = (await fs.promises.readFile(filePath, "utf8"))
      .split(/\r?\n/)
      .filter(Boolean)
      .reverse();

    for (const line of lines) {
      try {
        const parsed = JSON.parse(line) as LogEntry;
        if (!parsed?.level || !parsed?.timestamp) continue;
        stats[parsed.level] += 1;

        if (activeLevels && !activeLevels.has(parsed.level)) continue;
        if (options.scope === "metadata" && !isMetadataRelatedLog(parsed)) continue;

        if (searchTerm) {
          const haystack = JSON.stringify(parsed).toLowerCase();
          if (!haystack.includes(searchTerm)) continue;
        }

        totalMatching += 1;
        if (totalMatching <= offset) continue;
        if (matchingEntries.length >= limit) continue;
        matchingEntries.push(parsed);
      } catch {
        // Ignore malformed lines from manual edits or partial writes.
      }
    }
  }

  return {
    entries: matchingEntries,
    page,
    limit,
    totalMatching,
    totalPages: Math.max(1, Math.ceil(totalMatching / limit)),
    stats,
    logDirectory: LOG_DIR,
  };
};

export const clearLogs = async () => {
  for (const filePath of await getLogFiles()) {
    await fs.promises.rm(filePath, { force: true });
  }
};

export const getLogDirectory = () => LOG_DIR;
