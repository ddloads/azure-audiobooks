import { isAxiosError } from "axios";
import type { AdminLogEntry } from "./types";

export const formatHours = (seconds: number) => {
  const totalHours = seconds / 3600;
  return `${totalHours.toFixed(totalHours >= 100 ? 0 : 1)}h`;
};

export const formatDate = (value: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

export const formatElapsed = (value: string | null) => {
  if (!value) return null;
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  return `${minutes}m ${seconds}s ago`;
};

export const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

export const getErrorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ error?: string }>(error)
    ? error.response?.data?.error || fallback
    : fallback;

export const formatJsonBlock = (value: unknown) => JSON.stringify(value, null, 2);

export const formatDurationMs = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

export const getStatusCodeCategory = (code: number): "2xx" | "3xx" | "4xx" | "5xx" | "other" => {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500) return "5xx";
  return "other";
};

export const buildLogCopyText = (entry: AdminLogEntry) =>
  JSON.stringify(
    {
      timestamp: entry.timestamp,
      level: entry.level,
      context: entry.context,
      message: entry.message,
      requestId: entry.requestId,
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      durationMs: entry.durationMs,
      userId: entry.userId,
      ip: entry.ip,
      data: entry.data,
      error: entry.error,
    },
    null,
    2,
  );

export const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for browsers that block the async Clipboard API.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
};

export const detectKind = (path: string): string => {
  if (path.startsWith("\\\\") || path.startsWith("//")) return "NETWORK";
  return "LOCAL";
};

export const derivedLabel = (path: string): string => {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
};
