import { execFile } from "child_process";
import { promisify } from "util";
import path from "path";
import fs from "fs";
import type { AudibleMatchCandidate } from "./audible";

const execFileAsync = promisify(execFile);

const CLI_TIMEOUT_MS = 30_000;
const RESPONSE_GROUPS =
  "product_desc,contributors,series,category_ladders,product_attrs,product_extended_attrs,media,relationships,rating";

// ─── Audible API response types ────────────────────────────────────────────

type AudibleApiAuthor = { asin?: string; name: string };
type AudibleApiNarrator = { name: string };
type AudibleApiSeries = { asin?: string; title: string; sequence?: string | null };
type AudibleApiCategoryLadder = {
  ladder: Array<{ id: string; name: string }>;
  root: string;
};
type AudibleApiProduct = {
  asin: string;
  title: string;
  subtitle?: string | null;
  authors?: AudibleApiAuthor[];
  narrators?: AudibleApiNarrator[];
  series?: AudibleApiSeries[];
  publisher_summary?: string | null;
  merchandising_summary?: string | null;
  publisher_name?: string | null;
  release_date?: string | null;
  language?: string | null;
  runtime_length_min?: number | null;
  category_ladders?: AudibleApiCategoryLadder[];
  product_images?: Record<string, string>;
  isbn?: string | null;
};

// ─── Config helpers ────────────────────────────────────────────────────────

export const getAudibleConfigDir = (): string => path.join(process.cwd(), "data", "audible-cli");

const getAudibleRuntimeConfigPath = (): string => path.join(getAudibleConfigDir(), "config.toml");

const ACTIVE_PROFILE_FILE = "azure_active_profile.txt";

export type AudibleCliProfile = {
  name: string;
  filePath: string;
};

const getActiveProfileFilePath = (): string => path.join(getAudibleConfigDir(), ACTIVE_PROFILE_FILE);

const ensureAudibleConfigDirExists = (): void => {
  const configDir = getAudibleConfigDir();
  if (!fs.existsSync(configDir)) {
    fs.mkdirSync(configDir, { recursive: true });
  }
};

const getLegacyAudibleConfigDirs = (): string[] => {
  const candidates = new Set<string>();
  if (process.platform === "win32") {
    if (process.env.APPDATA) candidates.add(path.join(process.env.APPDATA, "audible"));
    if (process.env.LOCALAPPDATA) candidates.add(path.join(process.env.LOCALAPPDATA, "Audible"));
  }
  return Array.from(candidates).filter((candidate) => candidate !== getAudibleConfigDir());
};

const seedProjectAudibleProfilesIfNeeded = (): void => {
  ensureAudibleConfigDirExists();
  const configDir = getAudibleConfigDir();
  const hasProfiles = fs.readdirSync(configDir).some((fileName) => fileName.endsWith(".json"));
  if (hasProfiles) return;

  for (const legacyDir of getLegacyAudibleConfigDirs()) {
    if (!fs.existsSync(legacyDir)) continue;
    const legacyProfiles = fs.readdirSync(legacyDir).filter((fileName) => fileName.endsWith(".json"));
    if (!legacyProfiles.length) continue;

    for (const fileName of legacyProfiles) {
      fs.copyFileSync(path.join(legacyDir, fileName), path.join(configDir, fileName));
    }

    const legacyActiveProfilePath = path.join(legacyDir, ACTIVE_PROFILE_FILE);
    if (fs.existsSync(legacyActiveProfilePath)) {
      fs.copyFileSync(legacyActiveProfilePath, getActiveProfileFilePath());
    }

    break;
  }
};

const getProfileCountryCode = (profilePath: string): string => {
  try {
    const parsed = JSON.parse(fs.readFileSync(profilePath, "utf-8")) as { locale_code?: string | null };
    return parsed.locale_code?.toLowerCase().trim() || "us";
  } catch {
    return "us";
  }
};

export const sanitizeAudibleProfileName = (value: string): string =>
  value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, "-")
    .replace(/-+/g, "-")
    .replace(/^[-_]+|[-_]+$/g, "");

export const listAudibleCliProfiles = (): AudibleCliProfile[] => {
  seedProjectAudibleProfilesIfNeeded();
  const configDir = getAudibleConfigDir();
  if (!fs.existsSync(configDir)) return [];

  return fs
    .readdirSync(configDir)
    .filter((fileName) => fileName.endsWith(".json"))
    .map((fileName) => ({
      name: path.basename(fileName, ".json"),
      filePath: path.join(configDir, fileName),
    }))
    .sort((a, b) => {
      const aRank = a.name.startsWith("azure_") ? 0 : a.name === "default" ? 1 : 2;
      const bRank = b.name.startsWith("azure_") ? 0 : b.name === "default" ? 1 : 2;
      return aRank - bRank || a.name.localeCompare(b.name);
    });
};

const findBestProfile = (): string | null => {
  const profiles = listAudibleCliProfiles();
  return profiles[0]?.name ?? null;
};

export const syncAudibleCliRuntimeConfig = (): void => {
  ensureAudibleConfigDirExists();
  const profiles = listAudibleCliProfiles();
  const primaryProfile = resolveAudibleProfile() ?? profiles[0]?.name ?? null;

  const lines = ["[APP]"];
  if (primaryProfile) {
    lines.push(`primary_profile = "${primaryProfile}"`);
  }

  for (const profile of profiles) {
    lines.push("");
    lines.push(`[profile.${profile.name}]`);
    lines.push(`auth_file = "${path.basename(profile.filePath)}"`);
    lines.push(`country_code = "${getProfileCountryCode(profile.filePath)}"`);
  }

  fs.writeFileSync(getAudibleRuntimeConfigPath(), `${lines.join("\n")}\n`, "utf-8");
};

export const getStoredActiveAudibleProfile = (): string | null => {
  try {
    const filePath = getActiveProfileFilePath();
    if (!fs.existsSync(filePath)) return null;
    const stored = fs.readFileSync(filePath, "utf-8").trim();
    return stored || null;
  } catch {
    return null;
  }
};

export const setStoredActiveAudibleProfile = (profileName: string): void => {
  ensureAudibleConfigDirExists();
  fs.writeFileSync(getActiveProfileFilePath(), `${profileName}\n`, "utf-8");
  syncAudibleCliRuntimeConfig();
};

export const clearStoredActiveAudibleProfile = (): void => {
  try {
    fs.rmSync(getActiveProfileFilePath(), { force: true });
    syncAudibleCliRuntimeConfig();
  } catch {
    // best effort cleanup
  }
};

export const resolveAudibleProfile = (requestedProfile?: string | null): string | null => {
  const available = new Set(listAudibleCliProfiles().map((profile) => profile.name));
  if (!available.size) return null;

  const requested = requestedProfile?.trim();
  if (requested && available.has(requested)) return requested;

  const envProfile = process.env.AUDIBLE_PROFILE?.trim();
  if (envProfile && available.has(envProfile)) return envProfile;

  const storedProfile = getStoredActiveAudibleProfile();
  if (storedProfile && available.has(storedProfile)) return storedProfile;

  return findBestProfile();
};

const getMarketplace = (): string | null => {
  const raw = process.env.AUDIBLE_MARKETPLACE?.toLowerCase().trim();
  return raw || null;
};

// ─── Exe resolution ────────────────────────────────────────────────────────

let resolvedExe: string | null = null;

const resolveAudibleExe = async (): Promise<string> => {
  if (resolvedExe) return resolvedExe;

  // Try audible from PATH first
  try {
    await execFileAsync("audible", ["--version"], { timeout: 5_000, windowsHide: true });
    resolvedExe = "audible";
    return resolvedExe;
  } catch {
    // Not in PATH — fall through
  }

  // Ask Python where its Scripts directory is so we can find the exe there
  try {
    const pythonCmd = process.platform === "win32" ? "python" : "python3";
    const { stdout } = await execFileAsync(
      pythonCmd,
      ["-c", "import sys, os; print(os.path.join(os.path.dirname(sys.executable), 'Scripts', 'audible'))"],
      { timeout: 5_000, windowsHide: true },
    );
    const candidate = stdout.trim();
    const withExt = process.platform === "win32" ? `${candidate}.exe` : candidate;
    if (candidate && fs.existsSync(withExt)) {
      resolvedExe = withExt;
      return resolvedExe;
    }
  } catch {
    // Python not available or lookup failed
  }

  resolvedExe = "audible";
  return resolvedExe;
};

// ─── CLI runner ────────────────────────────────────────────────────────────

const runAudible = async (args: string[], profileName?: string | null): Promise<string> => {
  const exe = await resolveAudibleExe();
  const profile = resolveAudibleProfile(profileName);
  syncAudibleCliRuntimeConfig();
  const fullArgs = [
    ...(profile ? ["--profile", profile] : []),
    ...args,
  ];

  const { stdout } = await execFileAsync(exe, fullArgs, {
    env: {
      ...process.env,
      AUDIBLE_CONFIG_DIR: getAudibleConfigDir(),
    },
    timeout: CLI_TIMEOUT_MS,
    maxBuffer: 10 * 1024 * 1024,
    windowsHide: true,
  });

  return stdout;
};

const buildApiArgs = (
  endpoint: string,
  params: Record<string, string> = {},
): string[] => {
  const marketplace = getMarketplace();
  const mergedParams = {
    image_sizes: "1215,900,500,300,225",
    ...params,
  };
  return [
    "api",
    ...(marketplace ? ["--country-code", marketplace] : []),
    ...Object.entries(mergedParams).flatMap(([key, value]) => ["--param", `${key}=${value}`]),
    endpoint,
  ];
};

// ─── Status ────────────────────────────────────────────────────────────────

export const isAudibleCliInstalled = async (): Promise<boolean> => {
  try {
    const exe = await resolveAudibleExe();
    await execFileAsync(exe, ["--version"], { timeout: 5_000, windowsHide: true });
    return true;
  } catch {
    return false;
  }
};

export const isAudibleCliAuthenticated = (): boolean => {
  try {
    return listAudibleCliProfiles().length > 0;
  } catch {
    return false;
  }
};

export type AudibleCliStatus = {
  installed: boolean;
  authenticated: boolean;
  configDir: string;
  marketplace: string;
  activeProfile: string | null;
  profiles: string[];
};

export const getAudibleCliStatus = async (): Promise<AudibleCliStatus> => {
  const installed = await isAudibleCliInstalled();
  const profiles = listAudibleCliProfiles().map((profile) => profile.name);
  return {
    installed,
    authenticated: installed && profiles.length > 0,
    configDir: getAudibleConfigDir(),
    marketplace: getMarketplace() ?? "us (default)",
    activeProfile: resolveAudibleProfile(),
    profiles,
  };
};

export const isAudibleCliAvailable = async (profileName?: string | null): Promise<boolean> => {
  if (!resolveAudibleProfile(profileName)) return false;
  syncAudibleCliRuntimeConfig();
  if (!fs.existsSync(getAudibleRuntimeConfigPath())) return false;
  return isAudibleCliInstalled();
};

export const deleteAudibleCliProfile = (profileName: string): boolean => {
  const profile = listAudibleCliProfiles().find((entry) => entry.name === profileName);
  if (!profile) return false;

  fs.rmSync(profile.filePath, { force: true });

  if (getStoredActiveAudibleProfile() === profileName) {
    const nextProfile = resolveAudibleProfile();
    if (nextProfile && nextProfile !== profileName) {
      setStoredActiveAudibleProfile(nextProfile);
    } else {
      clearStoredActiveAudibleProfile();
    }
  }

  syncAudibleCliRuntimeConfig();

  return true;
};

export const renameAudibleCliProfile = (
  currentName: string,
  nextName: string,
): { ok: boolean; error?: string } => {
  const currentProfile = listAudibleCliProfiles().find((entry) => entry.name === currentName);
  if (!currentProfile) {
    return { ok: false, error: "Audible profile not found" };
  }

  if (currentName === nextName) {
    return { ok: true };
  }

  const existingProfile = listAudibleCliProfiles().find((entry) => entry.name === nextName);
  if (existingProfile) {
    return { ok: false, error: "An Audible profile with that name already exists" };
  }

  const nextPath = path.join(getAudibleConfigDir(), `${nextName}.json`);
  fs.renameSync(currentProfile.filePath, nextPath);

  if (getStoredActiveAudibleProfile() === currentName) {
    setStoredActiveAudibleProfile(nextName);
  }

  syncAudibleCliRuntimeConfig();

  return { ok: true };
};

// ─── Parsing helpers ───────────────────────────────────────────────────────

const stripHtml = (s: string | null | undefined): string | null => {
  if (!s) return null;
  const stripped = s.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
  return stripped || null;
};

const cleanSubtitle = (value: string | null | undefined): string | null => {
  const subtitle = stripHtml(value);
  if (!subtitle) return null;
  if (/^failed to add items?$/i.test(subtitle)) return null;
  return subtitle;
};

const parseYear = (s: string | null | undefined): string | null =>
  s?.match(/\b(\d{4})\b/)?.[1] ?? null;

const parseSequence = (s: string | null | undefined): number | null => {
  if (!s) return null;
  const n = parseFloat(s);
  return Number.isFinite(n) ? n : null;
};

const getBestImage = (images: Record<string, string> | undefined): string | null => {
  if (!images) return null;
  for (const key of ["1215", "900", "500", "300", "225"]) {
    if (images[key]) return images[key];
  }
  return Object.values(images)[0] ?? null;
};

const extractGenres = (ladders: AudibleApiCategoryLadder[] | undefined): string | null => {
  if (!ladders?.length) return null;
  const seen = new Set<string>();
  const genres: string[] = [];
  for (const ladder of ladders) {
    for (const rung of ladder.ladder) {
      const name = rung.name.trim();
      if (name && !seen.has(name.toLowerCase())) {
        seen.add(name.toLowerCase());
        genres.push(name);
      }
    }
  }
  return genres.length ? genres.join(", ") : null;
};

const AUDIBLE_BASE = "https://www.audible.com";

const mapProduct = (product: AudibleApiProduct): AudibleMatchCandidate => {
  const author = product.authors?.map((a) => a.name).join(", ") || null;
  const narrator = product.narrators?.map((n) => n.name).join(", ") || null;
  const firstSeries = product.series?.[0];
  const genres = extractGenres(product.category_ladders);
  const duration = product.runtime_length_min != null ? product.runtime_length_min * 60 : null;

  return {
    id: product.asin,
    audibleUrl: `${AUDIBLE_BASE}/pd/${product.asin}`,
    confidence: 1.0,
    confidenceLabel: "100%",
    metadata: {
      title: product.title || null,
      subtitle: cleanSubtitle(product.subtitle),
      author,
      narrator,
      description: stripHtml(product.publisher_summary || product.merchandising_summary),
      publisher: product.publisher_name || null,
      year: parseYear(product.release_date),
      genres,
      tags: genres,
      language: product.language || null,
      isbn: product.isbn || null,
      asin: product.asin || null,
      abridged: null,
      seriesName: firstSeries?.title || null,
      seriesSequence: parseSequence(firstSeries?.sequence),
      durationSeconds: duration,
      releaseDate: product.release_date || null,
      imageUrl: getBestImage(product.product_images),
      audibleUrl: `${AUDIBLE_BASE}/pd/${product.asin}`,
    },
  };
};

// ─── API calls ─────────────────────────────────────────────────────────────

const fetchByAsin = async (
  asin: string,
  profileName?: string | null,
): Promise<AudibleMatchCandidate | null> => {
  try {
    const raw = await runAudible(
      buildApiArgs(`/1.0/catalog/products/${asin}`, {
        response_groups: RESPONSE_GROUPS,
      }),
      profileName,
    );
    const parsed = JSON.parse(raw) as { product?: AudibleApiProduct };
    return parsed.product ? mapProduct(parsed.product) : null;
  } catch {
    return null;
  }
};

const searchProducts = async (
  title: string,
  author?: string | null,
  profileName?: string | null,
): Promise<AudibleMatchCandidate[]> => {
  try {
    const params: Record<string, string> = {
      title,
      response_groups: RESPONSE_GROUPS,
      num_results: "8",
      sort_by: "Relevance",
    };
    if (author) params.author = author;

    const raw = await runAudible(buildApiArgs("/1.0/catalog/products", params), profileName);
    const parsed = JSON.parse(raw) as { products?: AudibleApiProduct[] };
    const baseProducts = parsed.products ?? [];

    // Search results can be sparse; hydrate each hit through the product endpoint
    // so description and high-resolution cover art are consistently present.
    const hydrated = await Promise.all(
      baseProducts.map(async (product) => {
        const detailed = await fetchByAsin(product.asin, profileName);
        return detailed ?? mapProduct(product);
      }),
    );

    return hydrated;
  } catch {
    return [];
  }
};

// ─── Confidence scoring ────────────────────────────────────────────────────

const normalize = (s: string | null | undefined) =>
  (s ?? "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const tokenSim = (a: string | null | undefined, b: string | null | undefined): number => {
  const ta = new Set(normalize(a).split(" ").filter(Boolean));
  const tb = new Set(normalize(b).split(" ").filter(Boolean));
  if (!ta.size || !tb.size) return 0;
  let overlap = 0;
  for (const t of ta) {
    if (tb.has(t)) overlap++;
  }
  return overlap / Math.max(ta.size, tb.size);
};

const scoreResult = (
  r: AudibleMatchCandidate,
  title: string,
  author: string | null,
  asin: string | null,
  duration: number | null,
): number => {
  if (asin && r.metadata.asin?.toUpperCase() === asin.toUpperCase()) return 1.0;
  let score = tokenSim(title, r.metadata.title) * 0.6;
  if (author && r.metadata.author) score += tokenSim(author, r.metadata.author) * 0.25;
  if (duration && r.metadata.durationSeconds) {
    const diff = Math.abs(duration - r.metadata.durationSeconds);
    score += diff <= 120 ? 0.15 : diff <= 600 ? 0.07 : 0;
  }
  return Math.min(score, 0.99);
};

// ─── Main export ───────────────────────────────────────────────────────────

export const searchAudibleCli = async (
  query: string,
  context: { title: string; author: string | null; asin: string | null; duration: number | null },
  authorOverride?: string | null,
  profileName?: string | null,
): Promise<AudibleMatchCandidate[]> => {
  const results: AudibleMatchCandidate[] = [];
  const seen = new Set<string>();

  const asinMatch = /\b([A-Z0-9]{10})\b/i.exec(query);
  if (asinMatch) {
    const direct = await fetchByAsin(asinMatch[1].toUpperCase(), profileName);
    if (direct && !seen.has(direct.id)) {
      seen.add(direct.id);
      results.push(direct);
    }
  }

  const authorParam = authorOverride ?? context.author;
  const searched = await searchProducts(query, authorParam, profileName);
  for (const r of searched) {
    if (!seen.has(r.id)) {
      seen.add(r.id);
      results.push(r);
    }
  }

  for (const r of results) {
    const score = scoreResult(r, context.title, context.author, context.asin, context.duration);
    r.confidence = score;
    r.confidenceLabel = `${Math.round(score * 100)}%`;
  }

  return results.sort((a, b) => b.confidence - a.confidence);
};
