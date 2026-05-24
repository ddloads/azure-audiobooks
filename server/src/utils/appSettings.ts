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
  const next: AppearanceSettings = {
    ...current,
    ...(typeof settings.showReviewBooks === "boolean"
      ? { showReviewBooks: settings.showReviewBooks }
      : {}),
  };

  await prisma.$executeRaw`
    INSERT INTO "AppSetting" ("key", "value", "updatedAt")
    VALUES (${APPEARANCE_SETTINGS_KEY}, ${JSON.stringify(next)}, NOW())
    ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = NOW()
  `;

  return next;
};
