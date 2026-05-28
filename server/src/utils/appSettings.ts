import prisma from "../lib/prisma";

const APPEARANCE_SETTINGS_KEY = "appearance";

export interface AppearanceSettings {
  showReviewBooks: boolean;
  shelfContinueListening: boolean;
  shelfNextInSeries: boolean;
  shelfYouMightLike: boolean;
  shelfRecentlyAdded: boolean;
}

const defaultAppearanceSettings = (): AppearanceSettings => ({
  showReviewBooks: true,
  shelfContinueListening: true,
  shelfNextInSeries: true,
  shelfYouMightLike: true,
  shelfRecentlyAdded: true,
});

const parseAppearanceSettings = (value: string | null | undefined): AppearanceSettings => {
  const defaults = defaultAppearanceSettings();
  if (!value) return defaults;

  try {
    const parsed = JSON.parse(value) as Partial<AppearanceSettings>;
    return {
      showReviewBooks:          parsed.showReviewBooks          ?? defaults.showReviewBooks,
      shelfContinueListening:   parsed.shelfContinueListening   ?? defaults.shelfContinueListening,
      shelfNextInSeries:        parsed.shelfNextInSeries        ?? defaults.shelfNextInSeries,
      shelfYouMightLike:        parsed.shelfYouMightLike        ?? defaults.shelfYouMightLike,
      shelfRecentlyAdded:       parsed.shelfRecentlyAdded       ?? defaults.shelfRecentlyAdded,
    };
  } catch {
    return defaults;
  }
};

export const getAppearanceSettings = async (): Promise<AppearanceSettings> => {
  const rows = await prisma.$queryRaw<Array<{ value: string }>>`
    SELECT "value" FROM "AppSetting" WHERE "key" = ${APPEARANCE_SETTINGS_KEY} LIMIT 1
  `;

  return parseAppearanceSettings(rows[0]?.value);
};

export const updateAppearanceSettings = async (
  settings: Partial<AppearanceSettings>,
): Promise<AppearanceSettings> => {
  const current = await getAppearanceSettings();
  const defaults = defaultAppearanceSettings();
  const next = { ...current };

  for (const k of Object.keys(defaults) as (keyof AppearanceSettings)[]) {
    if (typeof settings[k] === "boolean") {
      next[k] = settings[k] as boolean;
    }
  }

  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt")
    VALUES (${APPEARANCE_SETTINGS_KEY}, ${JSON.stringify(next)}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;

  return next;
};
