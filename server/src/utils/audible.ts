import { fetchExternal } from "./externalFetch";

type AudibleMetadata = {
  title: string | null;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  description: string | null;
  publisher: string | null;
  year: string | null;
  genres: string | null;
  tags: string | null;
  language: string | null;
  isbn: string | null;
  asin: string | null;
  abridged: boolean | null;
  seriesName: string | null;
  seriesSequence: number | null;
  durationSeconds: number | null;
  releaseDate: string | null;
  imageUrl: string | null;
  audibleUrl: string | null;
};

export type AudibleMatchCandidate = {
  id: string;
  audibleUrl: string;
  confidence: number;
  confidenceLabel: string;
  metadata: AudibleMetadata;
};

type SearchContext = {
  title: string;
  author: string | null;
  asin: string | null;
  duration: number | null;
};

const AUDIBLE_BASE_URL = "https://www.audible.com";
const PRODUCT_LINK_PATTERN = /\/pd\/[^"'?#\s<>]+\/([A-Z0-9]{10})(?:[/?#"'&<>\s]|$)/gi;
const ASIN_PATTERN = /\b([A-Z0-9]{10})\b/i;
const ISBN_PATTERN = /\b(97[89]\d{10})\b/;
const AUDIBLE_TAGS = [
  "Action & Adventure",
  "Children's Audiobooks",
  "Comedy",
  "Contemporary",
  "Cyberpunk",
  "Dragons & Mythical Creatures",
  "Epic",
  "Fantasy",
  "Feel-Good",
  "Fiction",
  "Funny",
  "Historical",
  "Humorous",
  "Literature & Fiction",
  "LitRPG",
  "Magic",
  "Military",
  "Mythology",
  "Paranormal",
  "Romance",
  "Science Fiction & Fantasy",
  "Science Fiction",
  "Teen & Young Adult",
  "Time Travel",
  "Urban",
  "Witty",
].sort((left, right) => right.length - left.length);
const DESCRIPTION_PREFIX_PATTERNS = [
  /^check out this great listen on audible(?:\.com)?\.?\s*/i,
  /^check out this listen on audible(?:\.com)?\.?\s*/i,
];

const decodeHtml = (value: string) =>
  value
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&apos;/g, "'")
    .replace(/&nbsp;/g, " ")
    .replace(/&#(\d+);/g, (_match, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_match, code) => String.fromCharCode(parseInt(code, 16)));

const stripHtml = (value: string | null | undefined) => {
  if (!value) return null;
  const stripped = decodeHtml(value.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
  return stripped || null;
};

const normalizeWhitespace = (value: string | null | undefined) =>
  value ? value.replace(/\s+/g, " ").trim() : "";

const cleanDescription = (value: string | null | undefined) => {
  let cleaned = normalizeWhitespace(stripHtml(value) ?? value ?? "");
  for (const pattern of DESCRIPTION_PREFIX_PATTERNS) {
    cleaned = cleaned.replace(pattern, "").trim();
  }
  return cleaned || null;
};

const cleanSubtitle = (value: string | null | undefined) => {
  const subtitle = normalizeWhitespace(stripHtml(value) ?? value ?? "");
  if (!subtitle) return null;
  if (/^failed to add items?$/i.test(subtitle)) return null;
  return subtitle;
};

const normalizeForCompare = (value: string | null | undefined) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const splitTokens = (value: string | null | undefined) =>
  new Set(normalizeForCompare(value).split(" ").filter(Boolean));

const intersectCount = (a: Set<string>, b: Set<string>) => {
  let count = 0;
  for (const token of a) {
    if (b.has(token)) count += 1;
  }
  return count;
};

const similarity = (left: string | null | undefined, right: string | null | undefined) => {
  const leftTokens = splitTokens(left);
  const rightTokens = splitTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;
  const overlap = intersectCount(leftTokens, rightTokens);
  return overlap / Math.max(leftTokens.size, rightTokens.size);
};

const toSentenceCase = (value: string | null) => {
  if (!value) return null;
  return value
    .split(",")
    .map((part) => part.trim())
    .filter(Boolean)
    .join(", ");
};

const parseDurationSeconds = (value: string | null) => {
  if (!value) return null;
  const hours = /(\d+)\s*hr/.exec(value)?.[1];
  const minutes = /(\d+)\s*min/.exec(value)?.[1];
  const seconds = /(\d+)\s*sec/.exec(value)?.[1];

  const total =
    (hours ? Number(hours) * 3600 : 0) +
    (minutes ? Number(minutes) * 60 : 0) +
    (seconds ? Number(seconds) : 0);

  return total > 0 ? total : null;
};

const metaContent = (html: string, name: string) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapedName}["'][^>]+content=(["'])([\\s\\S]*?)\\1[^>]*>`,
    "i",
  );
  return stripHtml(regex.exec(html)?.[2] ?? null);
};

const headingContent = (html: string, tagName: "h1" | "h2") =>
  stripHtml(new RegExp(`<${tagName}[^>]*>([\\s\\S]*?)<\\/${tagName}>`, "i").exec(html)?.[1] ?? null);

const findLabelValue = (text: string, label: string) => {
  const escapedLabel = label.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const inlineRegex = new RegExp(`^${escapedLabel}:?\\s+(.+)$`, "i");
  const labelOnlyRegex = new RegExp(`^${escapedLabel}:?$`, "i");
  const lines = text
    .split(/\n+/)
    .map((line) => normalizeWhitespace(line))
    .filter(Boolean);

  for (let index = 0; index < lines.length; index += 1) {
    const inlineMatch = lines[index].match(inlineRegex);
    if (inlineMatch?.[1]) {
      return normalizeWhitespace(inlineMatch[1]);
    }

    if (labelOnlyRegex.test(lines[index])) {
      return normalizeWhitespace(lines[index + 1] ?? "");
    }
  }

  return "";
};

const findCopyrightLine = (text: string) => {
  const match = text.match(/[©\(]P?\)?\s*\d{4}[^\n\r]+/i);
  return normalizeWhitespace(match?.[0] ?? "");
};

const parsePublisher = (copyrightLine: string) => {
  if (!copyrightLine) return null;
  const match = copyrightLine.match(/\(P\)\d{4}\s+(.+)/i);
  if (!match) return null;
  const raw = match[1].trim();
  const parts = raw.split(/\s{2,}|(?=\b[A-Z][a-z]+(?:\s+[A-Z][a-z]+){0,2}\b\s+\b(?:Epic|Fantasy|Humorous|Witty|LitRPG|Science|Fiction|Comedy|Royalty|Feel-Good)\b)/);
  return normalizeWhitespace(parts[0] ?? raw) || null;
};

const parseTagList = (copyrightLine: string, publisher: string | null) => {
  if (!copyrightLine) return null;
  const afterPublisher = publisher
    ? copyrightLine.replace(/\(P\)\d{4}\s+/, "").replace(publisher, "").trim()
    : copyrightLine.replace(/^.*?\(P\)\d{4}\s+/, "").trim();

  const cleaned = afterPublisher.replace(/\s{2,}/g, ", ").replace(/\s+•\s+/g, ", ");
  return toSentenceCase(cleaned || null);
};

const extractAudibleTags = (text: string) => {
  const section =
    text.match(/\(P\)\s*\d{4}[\s\S]*?(?=\n\s*Series:|\n\s*Listeners also enjoyed|$)/i)?.[0] ??
    text.match(/\nCategories\s+([\s\S]*?)(?=\n\s*Whispersync|\n\s*Listeners also enjoyed|$)/i)?.[1] ??
    "";

  if (!section) return null;

  const normalizedSection = normalizeWhitespace(section);
  const tags: Array<{ value: string; index: number }> = [];

  for (const tag of AUDIBLE_TAGS) {
    const regex = new RegExp(`(^|\\s)${tag.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?=\\s|$)`, "i");
    const match = regex.exec(normalizedSection);
    if (match && !tags.some((existing) => existing.value.toLowerCase() === tag.toLowerCase())) {
      tags.push({ value: tag, index: match.index });
    }
  }

  return tags.length > 0
    ? tags
        .sort((left, right) => left.index - right.index)
        .map((tag) => tag.value)
        .join(", ")
    : null;
};

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) {
      return normalizeWhitespace(value);
    }
    if (Array.isArray(value)) {
      const joined = value
        .map((item) => {
          if (typeof item === "string") return item;
          if (item && typeof item === "object" && "name" in item) return (item as { name?: unknown }).name;
          return null;
        })
        .filter((item): item is string => typeof item === "string" && item.trim().length > 0)
        .join(", ");
      if (joined) return normalizeWhitespace(joined);
    }
    if (value && typeof value === "object" && "name" in value) {
      const name = (value as { name?: unknown }).name;
      if (typeof name === "string" && name.trim()) return normalizeWhitespace(name);
    }
  }
  return null;
};

const parseJsonLdObjects = (html: string) => {
  const objects: Array<Record<string, unknown>> = [];
  const scriptPattern = /<script[^>]+type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi;

  for (const match of html.matchAll(scriptPattern)) {
    try {
      const parsed = JSON.parse(decodeHtml(match[1].trim()));
      const values = Array.isArray(parsed) ? parsed : [parsed];
      for (const value of values) {
        if (value && typeof value === "object") {
          objects.push(value as Record<string, unknown>);
        }
      }
    } catch {
      // Audible pages remain parseable from visible labels if structured data changes.
    }
  }

  return objects;
};

const findJsonLdBook = (html: string) =>
  parseJsonLdObjects(html).find((item) => {
    const type = item["@type"];
    const types = Array.isArray(type) ? type : [type];
    return types.some((entry) => typeof entry === "string" && /book|audiobook/i.test(entry));
  });

const formatJsonLdDuration = (value: unknown) => {
  if (typeof value !== "string") return null;
  const match = value.match(/P(?:T)?(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?/i);
  if (!match) return null;
  const total = Number(match[1] ?? 0) * 3600 + Number(match[2] ?? 0) * 60 + Number(match[3] ?? 0);
  return total > 0 ? total : null;
};

const extractVisibleText = (html: string) =>
  decodeHtml(
    html
      .replace(/<script[\s\S]*?<\/script>/gi, " ")
      .replace(/<style[\s\S]*?<\/style>/gi, " ")
      .replace(/<\/(p|div|section|article|h1|h2|h3|h4|li|ul|ol|br)>/gi, "\n")
      .replace(/<[^>]+>/g, " ")
      .replace(/\r/g, "")
      .replace(/\n{3,}/g, "\n\n")
      .replace(/[ \t]+/g, " ")
      .trim(),
  );

const parseSeries = (value: string | null) => {
  if (!value) return { seriesName: null, seriesSequence: null };
  const match = value.match(/^(.*?)(?:,\s*Book\s*([0-9.]+))?$/i);
  return {
    seriesName: normalizeWhitespace(match?.[1] ?? value) || null,
    seriesSequence: match?.[2] ? Number(match[2]) : null,
  };
};

const parseYear = (value: string | null) => value?.match(/\b(\d{4})\b/)?.[1] ?? null;

const cleanImageUrl = (url: string | null) => {
  if (!url) return null;
  // Strip Amazon/Audible image modifiers to get the original/higher resolution image
  // Modifiers look like ._SL500_., ._SY88_., ._AC_UY218_., etc.
  return url.replace(/\._S[LY][0-9]+_\./, ".").replace(/\._AC_[A-Z0-9_]+_\./, ".");
};

const extractIsbn = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const match = value?.match(ISBN_PATTERN);
    if (match) return match[1];
  }
  return null;
};

const extractAsin = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const match = value?.match(/\bASIN[:\s-]*([A-Z0-9]{10})\b/i) || value?.match(ASIN_PATTERN);
    if (match) return match[1].toUpperCase();
  }
  return null;
};

const buildAudibleUrl = (rawPath: string) =>
  rawPath.startsWith("http") ? rawPath : `${AUDIBLE_BASE_URL}${rawPath}`;

const fetchPage = async (url: string) => {
  const response = await fetchExternal(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Audible request failed with status ${response.status}`);
  }

  return response.text();
};

const parseAudibleProductPage = (html: string, audibleUrl: string): AudibleMetadata => {
  const visibleText = extractVisibleText(html);
  const jsonLd = findJsonLdBook(html);
  const title = headingContent(html, "h1") || firstString(jsonLd?.name) || metaContent(html, "og:title");
  const subtitle = cleanSubtitle(headingContent(html, "h2"));
  const description = cleanDescription(
    firstString(jsonLd?.description) || metaContent(html, "og:description") || metaContent(html, "description"),
  );
  const author = findLabelValue(visibleText, "By") || firstString(jsonLd?.author);
  const narrator = findLabelValue(visibleText, "Narrated by") || firstString(jsonLd?.readBy);
  const releaseDate = findLabelValue(visibleText, "Release date") || null;
  const language =
    findLabelValue(visibleText, "Language") ||
    firstString(jsonLd?.inLanguage) ||
    null;
  const categories =
    findLabelValue(visibleText, "Categories") ||
    findLabelValue(visibleText, "Category") ||
    null;
  const seriesRaw = findLabelValue(visibleText, "Series") || null;
  const durationLabel = findLabelValue(visibleText, "Length") || null;
  const copyrightLine = findCopyrightLine(visibleText);
  const publisher = findLabelValue(visibleText, "Publisher") || firstString(jsonLd?.publisher) || parsePublisher(copyrightLine);
  const tags = extractAudibleTags(visibleText) || parseTagList(copyrightLine, publisher);
  const { seriesName, seriesSequence } = parseSeries(seriesRaw);
  const year = parseYear(releaseDate) || parseYear(firstString(jsonLd?.datePublished)) || parseYear(copyrightLine);
  const asin = extractAsin(audibleUrl, visibleText, description);
  const isbn = extractIsbn(visibleText, description);
  const abridgedText = /Abridged/i.test(visibleText) && !/Unabridged/i.test(visibleText);
  const genres =
    categories ||
    findLabelValue(visibleText, "Genre") ||
    firstString(jsonLd?.genre) ||
    tags ||
    null;

  return {
    title,
    subtitle,
    author: author || null,
    narrator: narrator || null,
    description,
    publisher,
    year,
    genres,
    tags,
    language: language || null,
    asin,
    isbn,
    abridged: abridgedText,
    seriesName,
    seriesSequence,
    durationSeconds: parseDurationSeconds(durationLabel) || formatJsonLdDuration(jsonLd?.duration),
    releaseDate,
    imageUrl: cleanImageUrl(firstString(jsonLd?.image) || metaContent(html, "og:image")),
    audibleUrl,
    };
    };


const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

const scoreCandidate = (context: SearchContext, candidate: AudibleMetadata) => {
  let score = 0;

  const titleScore = similarity(context.title, candidate.title);
  score += titleScore * 0.55;

  if (context.author && candidate.author) {
    score += similarity(context.author, candidate.author) * 0.2;
  }

  if (context.asin && candidate.asin) {
    score += normalizeForCompare(context.asin) === normalizeForCompare(candidate.asin) ? 0.9 : 0;
  }

  if (context.duration && candidate.durationSeconds) {
    const difference = Math.abs(context.duration - candidate.durationSeconds);
    if (difference <= 120) score += 0.2;
    else if (difference <= 600) score += 0.1;
  }

  if (candidate.seriesName && /book|series/i.test(candidate.seriesName)) {
    score += 0.03;
  }

  return clamp(score, 0, 1);
};

const confidenceLabel = (score: number) => `${Math.round(score * 100)}%`;

const dedupeProductUrls = (html: string) => {
  const urls = new Map<string, string>();

  for (const match of html.matchAll(PRODUCT_LINK_PATTERN)) {
    const raw = match[0];
    const asin = match[1];
    if (!asin) continue;
    const normalized = raw.startsWith("http") ? raw : buildAudibleUrl(raw);
    if (!urls.has(asin)) {
      urls.set(asin, normalized.replace(/["'>\s]+$/, ""));
    }
  }

  return Array.from(urls.values());
};

export const searchAudible = async (
  query: string,
  context: SearchContext,
  authorOverride?: string | null,
): Promise<AudibleMatchCandidate[]> => {
  const searchTerms = [query, authorOverride].filter(Boolean).join(" ").trim();
  const searchUrl = `${AUDIBLE_BASE_URL}/search?keywords=${encodeURIComponent(searchTerms)}`;
  const searchHtml = await fetchPage(searchUrl);

  const candidateUrls = dedupeProductUrls(searchHtml);
  const exactAsin = extractAsin(query);
  if (exactAsin && !candidateUrls.some((url) => url.includes(exactAsin))) {
    candidateUrls.unshift(`${AUDIBLE_BASE_URL}/pd/${exactAsin}`);
  }

  const uniqueUrls = Array.from(new Set(candidateUrls)).slice(0, 8);
  const settled = await Promise.allSettled(
    uniqueUrls.map(async (url) => {
      const html = await fetchPage(url);
      const metadata = parseAudibleProductPage(html, url);
      const confidence = scoreCandidate(context, metadata);

      return {
        id: metadata.asin || url,
        audibleUrl: url,
        confidence,
        confidenceLabel: confidenceLabel(confidence),
        metadata,
      } satisfies AudibleMatchCandidate;
    }),
  );

  return settled
    .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
    .sort((left, right) => right.confidence - left.confidence);
};
