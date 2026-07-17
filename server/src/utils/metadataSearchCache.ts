import type { AudibleMatchCandidate } from "./audible";

const DEFAULT_TTL_MS = 5 * 60 * 1000;
const MAX_ENTRIES = 500;

type CacheEntry = {
  expiresAt: number;
  candidates: AudibleMatchCandidate[];
};

const cache = new Map<string, CacheEntry>();

const getTtlMs = () => {
  const configured = Number.parseInt(process.env.METADATA_SEARCH_CACHE_TTL_MS || "", 10);
  return Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_TTL_MS;
};

export const getMetadataSearchCache = (key: string): AudibleMatchCandidate[] | null => {
  const entry = cache.get(key);
  if (!entry) return null;

  if (entry.expiresAt <= Date.now()) {
    cache.delete(key);
    return null;
  }

  // Refresh insertion order so frequently used searches remain in the bounded cache.
  cache.delete(key);
  cache.set(key, entry);
  return entry.candidates;
};

export const setMetadataSearchCache = (key: string, candidates: AudibleMatchCandidate[]) => {
  if (cache.has(key)) cache.delete(key);
  while (cache.size >= MAX_ENTRIES) {
    const oldestKey = cache.keys().next().value;
    if (oldestKey === undefined) break;
    cache.delete(oldestKey);
  }

  cache.set(key, { expiresAt: Date.now() + getTtlMs(), candidates });
};

export const clearMetadataSearchCache = () => cache.clear();
