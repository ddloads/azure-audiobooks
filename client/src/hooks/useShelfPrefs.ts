import { useState, useCallback } from "react";
import type { AppearanceSettings } from "../features/admin/types";

type ShelfKeys = Omit<AppearanceSettings, "showReviewBooks">;

const SHELF_KEYS: Array<keyof ShelfKeys> = [
  "shelfContinueListening",
  "shelfNextInSeries",
  "shelfYouMightLike",
  "shelfRecentlyAdded",
];

const storageKey = (userId: string) => `shelves.${userId}`;

const read = (userId: string): ShelfKeys => {
  try {
    const raw = localStorage.getItem(storageKey(userId));
    if (raw) return JSON.parse(raw) as ShelfKeys;
  } catch {
    // ignore
  }
  return {
    shelfContinueListening: true,
    shelfNextInSeries: true,
    shelfYouMightLike: true,
    shelfRecentlyAdded: true,
  };
};

export const applyShelfPrefs = (
  server: AppearanceSettings,
  userId: string,
): AppearanceSettings => {
  const prefs = read(userId);
  return {
    ...server,
    shelfContinueListening: server.shelfContinueListening && prefs.shelfContinueListening,
    shelfNextInSeries: server.shelfNextInSeries && prefs.shelfNextInSeries,
    shelfYouMightLike: server.shelfYouMightLike && prefs.shelfYouMightLike,
    shelfRecentlyAdded: server.shelfRecentlyAdded && prefs.shelfRecentlyAdded,
  };
};

export const useShelfPrefs = (userId: string) => {
  const [prefs, setPrefs] = useState<ShelfKeys>(() => read(userId));

  const toggle = useCallback(
    (key: keyof ShelfKeys) => {
      setPrefs((prev) => {
        const next = { ...prev, [key]: !prev[key] };
        localStorage.setItem(storageKey(userId), JSON.stringify(next));
        return next;
      });
    },
    [userId],
  );

  return { prefs, toggle, SHELF_KEYS };
};
