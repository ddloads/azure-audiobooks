import prisma from "../lib/prisma";

const APPEARANCE_SETTINGS_KEY = "appearance";

export interface AppearanceSettings {
  showReviewBooks: boolean;
}

const defaultAppearanceSettings = (): AppearanceSettings => ({
  showReviewBooks: true,
});

const parseAppearanceSettings = (value: string | null | undefined): AppearanceSettings => {
  const defaults = defaultAppearanceSettings();
  if (!value) return defaults;

  try {
    const parsed = JSON.parse(value) as Partial<AppearanceSettings>;
    return {
      showReviewBooks: parsed.showReviewBooks ?? defaults.showReviewBooks,
    };
  } catch {
    return defaults;
  }
};

let appearanceCache: { value: AppearanceSettings; expiresAt: number } | null = null;

export const invalidateAppearanceCache = () => {
  appearanceCache = null;
};

export const getAppearanceSettings = async (): Promise<AppearanceSettings> => {
  const now = Date.now();
  if (appearanceCache && now < appearanceCache.expiresAt) {
    return appearanceCache.value;
  }

  const row = await prisma.appSetting.findUnique({
    where: { key: APPEARANCE_SETTINGS_KEY },
    select: { value: true },
  });

  const value = parseAppearanceSettings(row?.value);
  appearanceCache = { value, expiresAt: now + 60_000 };
  return value;
};

export const updateAppearanceSettings = async (
  settings: Partial<AppearanceSettings>,
): Promise<AppearanceSettings> => {
  const current = await getAppearanceSettings();
  const next: AppearanceSettings = {
    ...current,
    ...(typeof settings.showReviewBooks === "boolean"
      ? { showReviewBooks: settings.showReviewBooks }
      : {}),
  };

  await prisma.appSetting.upsert({
    where: { key: APPEARANCE_SETTINGS_KEY },
    create: { key: APPEARANCE_SETTINGS_KEY, value: JSON.stringify(next) },
    update: { value: JSON.stringify(next) },
  });

  invalidateAppearanceCache();
  return next;
};
