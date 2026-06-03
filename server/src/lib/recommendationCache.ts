type RecommendationCacheEntry = {
  expiresAt: number;
  payload: unknown;
};

const recommendationCache = new Map<string, RecommendationCacheEntry>();

const pruneExpiredRecommendationCache = (now = Date.now()) => {
  for (const [key, entry] of recommendationCache.entries()) {
    if (entry.expiresAt <= now) {
      recommendationCache.delete(key);
    }
  }
};

export const getCachedRecommendationPayload = <T>(userId: string, now = Date.now()): T | null => {
  const cached = recommendationCache.get(userId);
  if (!cached) {
    return null;
  }

  if (cached.expiresAt <= now) {
    recommendationCache.delete(userId);
    return null;
  }

  return cached.payload as T;
};

export const setCachedRecommendationPayload = (
  userId: string,
  payload: unknown,
  ttlMs: number,
  now = Date.now(),
) => {
  pruneExpiredRecommendationCache(now);
  recommendationCache.set(userId, {
    expiresAt: now + ttlMs,
    payload,
  });
};

export const invalidateRecommendationCache = (userId?: string) => {
  if (userId) {
    recommendationCache.delete(userId);
    return;
  }

  recommendationCache.clear();
};
