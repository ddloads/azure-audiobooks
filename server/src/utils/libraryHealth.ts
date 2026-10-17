import fs from "fs";
import fsp from "fs/promises";
import path from "path";
import prisma from "../lib/prisma";
import { normalizeSourcePath } from "./libraryConfig";

// Guards against a library share that has silently disappeared. When an NFS
// or SMB mount drops, the mount point is still an (empty) directory, so the
// server would otherwise treat every book as deleted. Nothing that removes
// books may run unless the library's source folders look healthy.
//
// Optional sentinel: create an empty file named `.azure-library` (or
// LIBRARY_SENTINEL_FILE) in a source's root folder. When it is present the
// first time the source is seen, it becomes required: the source then counts
// as healthy only while that file can be read. This catches mounts that are
// replaced by a different, non-empty directory.

export const LIBRARY_SENTINEL_FILE = process.env.LIBRARY_SENTINEL_FILE || ".azure-library";
const REQUIRE_SENTINEL = process.env.REQUIRE_LIBRARY_SENTINEL === "true";

// Removing more books than this in one pass needs ALLOW_MASS_BOOK_REMOVAL=true.
const MASS_REMOVAL_MIN = Number(process.env.MASS_REMOVAL_MIN_BOOKS || 25);
const MASS_REMOVAL_RATIO = Number(process.env.MASS_REMOVAL_MAX_RATIO || 0.2);
const ALLOW_MASS_REMOVAL = process.env.ALLOW_MASS_BOOK_REMOVAL === "true";

export interface SourceHealth {
  path: string;
  ok: boolean;
  reason?: string;
}

const sentinelSeen = new Set<string>();

/** Synchronous check used inside scans (which are already synchronous). */
export const checkSourceRootSync = (sourcePath: string): SourceHealth => {
  const root = normalizeSourcePath(sourcePath);
  try {
    if (!fs.statSync(root).isDirectory()) return { path: root, ok: false, reason: "not a directory" };
    const entries = fs.readdirSync(root);
    if (entries.length === 0) return { path: root, ok: false, reason: "folder is empty (share not mounted?)" };
    const hasSentinel = entries.includes(LIBRARY_SENTINEL_FILE);
    if (hasSentinel) sentinelSeen.add(root);
    if (!hasSentinel && (REQUIRE_SENTINEL || sentinelSeen.has(root))) {
      return { path: root, ok: false, reason: `${LIBRARY_SENTINEL_FILE} is missing (share not mounted?)` };
    }
    return { path: root, ok: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? String(error);
    return { path: root, ok: false, reason: `unreadable (${code})` };
  }
};

const warned = new Map<string, number>();
const warnOnce = (key: string, message: string) => {
  const now = Date.now();
  if (now - (warned.get(key) ?? 0) < 5 * 60_000) return;
  warned.set(key, now);
  console.error(message);
};

/**
 * True when every enabled source of the library is healthy. Logs why not.
 */
export const librarySourcesHealthy = async (libraryId: string, action: string): Promise<boolean> => {
  const sources = await prisma.librarySource.findMany({
    where: { libraryId, isEnabled: true },
    select: { path: true },
  });
  const unhealthy = sources.map((source) => checkSourceRootSync(source.path)).filter((health) => !health.ok);
  if (unhealthy.length === 0) return true;
  warnOnce(
    `${libraryId}:${action}`,
    `[library-guard] Skipped ${action}: ${unhealthy.map((h) => `${h.path} — ${h.reason}`).join("; ")}. ` +
      "No books were removed. Check the library share mount (docs/homelab-storage-setup.md).",
  );
  return false;
};

/**
 * Refuses to delete a large share of a library in one go — the signature of a
 * partially mounted or wrong share rather than real deletions.
 */
export const allowBulkRemoval = (libraryId: string, missing: number, existing: number): boolean => {
  if (ALLOW_MASS_REMOVAL || missing < MASS_REMOVAL_MIN) return true;
  if (existing > 0 && missing / existing <= MASS_REMOVAL_RATIO) return true;
  warnOnce(
    `${libraryId}:mass`,
    `[library-guard] Refused to remove ${missing} of ${existing} books from library ${libraryId} in one scan. ` +
      "If those books really were deleted, set ALLOW_MASS_BOOK_REMOVAL=true for one scan.",
  );
  return false;
};

/* ── Health endpoint ──────────────────────────────────────────────────────
   Checks run asynchronously with a timeout so a hung NFS mount can't block
   the health route, and only one check runs at a time (a `hard` NFS mount
   can pin a libuv thread until the server answers). */

const CHECK_TIMEOUT_MS = 5000;
const CACHE_MS = 15_000;
let cached: { at: number; sources: SourceHealth[] } | null = null;
let inflight: Promise<SourceHealth[]> | null = null;

const withTimeout = <T>(promise: Promise<T>, ms: number) =>
  Promise.race([
    promise,
    new Promise<never>((_, reject) => setTimeout(() => reject(Object.assign(new Error("timeout"), { code: "ETIMEDOUT" })), ms)),
  ]);

const checkSourceRoot = async (sourcePath: string): Promise<SourceHealth> => {
  const root = normalizeSourcePath(sourcePath);
  try {
    const entries = await withTimeout(fsp.readdir(root), CHECK_TIMEOUT_MS);
    if (entries.length === 0) return { path: root, ok: false, reason: "folder is empty (share not mounted?)" };
    const hasSentinel = entries.includes(LIBRARY_SENTINEL_FILE);
    if (hasSentinel) {
      sentinelSeen.add(root);
      await withTimeout(fsp.access(path.join(root, LIBRARY_SENTINEL_FILE)), CHECK_TIMEOUT_MS);
    } else if (REQUIRE_SENTINEL || sentinelSeen.has(root)) {
      return { path: root, ok: false, reason: `${LIBRARY_SENTINEL_FILE} is missing (share not mounted?)` };
    }
    return { path: root, ok: true };
  } catch (error) {
    const code = (error as NodeJS.ErrnoException)?.code ?? String(error);
    return { path: root, ok: false, reason: `unreadable (${code})` };
  }
};

export const getLibraryStorageHealth = async (): Promise<SourceHealth[]> => {
  if (cached && Date.now() - cached.at < CACHE_MS) return cached.sources;
  if (!inflight) {
    inflight = (async () => {
      const sources = await prisma.librarySource.findMany({
        where: { isEnabled: true, library: { isActive: true } },
        select: { path: true },
      });
      const results = await Promise.all(sources.map((source) => checkSourceRoot(source.path)));
      cached = { at: Date.now(), sources: results };
      return results;
    })().finally(() => {
      inflight = null;
    });
  }
  return inflight;
};
