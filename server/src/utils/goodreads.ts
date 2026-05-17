import { AudibleMatchCandidate } from "./audible";

type GoodreadsSearchResult = {
  id: string;
  title: string;
  author: string | null;
  url: string;
  imageUrl: string | null;
};

type GoodreadsBookDetails = {
  title: string | null;
  author: string | null;
  description: string | null;
  publisher: string | null;
  year: string | null;
  genres: string | null;
  isbn: string | null;
  releaseDate: string | null;
  imageUrl: string | null;
};

const GOODREADS_BASE_URL = "https://www.goodreads.com";

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

const absolutizeUrl = (url: string) => {
  const decoded = decodeHtml(url);
  if (decoded.startsWith("http")) return decoded;
  return `${GOODREADS_BASE_URL}${decoded.startsWith("/") ? "" : "/"}${decoded}`;
};

const normalizeForCompare = (value: string | null | undefined) =>
  normalizeWhitespace(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();

const splitTokens = (value: string | null | undefined) =>
  new Set(normalizeForCompare(value).split(" ").filter(Boolean));

const similarity = (left: string | null | undefined, right: string | null | undefined) => {
  const leftTokens = splitTokens(left);
  const rightTokens = splitTokens(right);
  if (leftTokens.size === 0 || rightTokens.size === 0) return 0;

  let overlap = 0;
  for (const token of leftTokens) {
    if (rightTokens.has(token)) overlap += 1;
  }

  return overlap / Math.max(leftTokens.size, rightTokens.size);
};

const fetchHtml = async (url: string) => {
  const response = await fetch(url, {
    headers: {
      "user-agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36",
      accept: "text/html,application/xhtml+xml",
      "accept-language": "en-US,en;q=0.9",
    },
    redirect: "follow",
  });

  if (!response.ok) {
    throw new Error(`Goodreads request failed with status ${response.status}`);
  }

  return response.text();
};

const metaContent = (html: string, name: string) => {
  const escapedName = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const regex = new RegExp(
    `<meta[^>]+(?:property|name)=["']${escapedName}["'][^>]+content=(["'])([\\s\\S]*?)\\1[^>]*>`,
    "i",
  );
  return stripHtml(regex.exec(html)?.[2] ?? null);
};

const firstString = (...values: unknown[]) => {
  for (const value of values) {
    if (typeof value === "string" && value.trim()) return normalizeWhitespace(value);
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
      // Goodreads pages still expose enough HTML metadata for a usable candidate.
    }
  }

  return objects;
};

const findJsonLdBook = (html: string) =>
  parseJsonLdObjects(html).find((item) => {
    const type = item["@type"];
    const types = Array.isArray(type) ? type : [type];
    return types.some((entry) => typeof entry === "string" && /book/i.test(entry));
  });

const parseYear = (value: string | null | undefined) => value?.match(/\b(\d{4})\b/)?.[1] ?? null;

const parseIsbn = (...values: Array<string | null | undefined>) => {
  for (const value of values) {
    const match = value?.match(/\b(?:97[89][-\s]?)?\d[\d-\s]{8,16}[\dX]\b/i);
    if (match) return match[0].replace(/[-\s]/g, "").toUpperCase();
  }
  return null;
};

const parseSearchResults = (html: string): GoodreadsSearchResult[] => {
  const rows = html.match(/<tr[\s\S]*?<\/tr>/gi) ?? [];
  const results: GoodreadsSearchResult[] = [];
  const seen = new Set<string>();

  for (const row of rows) {
    const titleMatch = row.match(/<a[^>]+class=["'][^"']*bookTitle[^"']*["'][^>]+href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!titleMatch) continue;

    const title = stripHtml(titleMatch[2]);
    if (!title) continue;

    const url = absolutizeUrl(titleMatch[1]);
    const id = decodeHtml(titleMatch[1]).match(/\/book\/show\/([^?#"']+)/i)?.[1]?.replace(/[^a-z0-9_.-]/gi, "_") || title;
    if (seen.has(id)) continue;

    const author = stripHtml(
      row.match(/<a[^>]+class=["'][^"']*authorName[^"']*["'][^>]*>([\s\S]*?)<\/a>/i)?.[1] ?? null,
    );
    const imageUrl = row.match(/<img[^>]+class=["'][^"']*bookCover[^"']*["'][^>]+src=["']([^"']+)["']/i)?.[1] ??
      row.match(/<img[^>]+src=["']([^"']+)["'][^>]+class=["'][^"']*bookCover[^"']*["']/i)?.[1] ??
      null;

    seen.add(id);
    results.push({
      id,
      title,
      author,
      url,
      imageUrl: imageUrl ? absolutizeUrl(imageUrl) : null,
    });
  }

  return results.slice(0, 8);
};

const parseBookDetails = (html: string): GoodreadsBookDetails => {
  const jsonLd = findJsonLdBook(html);
  const description =
    stripHtml(firstString(jsonLd?.description)) ||
    metaContent(html, "og:description") ||
    metaContent(html, "description");
  const releaseDate = firstString(jsonLd?.datePublished) || null;
  const genres = firstString(jsonLd?.genre);
  const publisher = firstString(jsonLd?.publisher);
  const title = firstString(jsonLd?.name) || metaContent(html, "og:title");
  const author = firstString(jsonLd?.author);
  const imageUrl = firstString(jsonLd?.image) || metaContent(html, "og:image");
  const pageText = stripHtml(html) || "";

  return {
    title,
    author,
    description,
    publisher,
    year: parseYear(releaseDate),
    genres,
    isbn: parseIsbn(firstString(jsonLd?.isbn), pageText),
    releaseDate,
    imageUrl,
  };
};

const scoreCandidate = (query: string, author: string | null | undefined, result: GoodreadsSearchResult) => {
  const titleScore = similarity(query, result.title);
  const authorScore = author && result.author ? similarity(author, result.author) : 0;
  const score = titleScore * 0.65 + authorScore * 0.2 + 0.1;
  return Math.min(0.8, Math.max(0.15, score));
};

export const searchGoodreads = async (
  query: string,
  authorOverride?: string | null,
): Promise<AudibleMatchCandidate[]> => {
  try {
    const searchTerms = [query, authorOverride].filter(Boolean).join(" ").trim();
    if (!searchTerms) return [];

    const searchUrl = `${GOODREADS_BASE_URL}/search?q=${encodeURIComponent(searchTerms)}&search_type=books`;
    const searchHtml = await fetchHtml(searchUrl);
    const searchResults = parseSearchResults(searchHtml);

    const settled = await Promise.allSettled(
      searchResults.map(async (result) => {
        let details: GoodreadsBookDetails = {
          title: null,
          author: null,
          description: null,
          publisher: null,
          year: null,
          genres: null,
          isbn: null,
          releaseDate: null,
          imageUrl: null,
        };

        try {
          details = parseBookDetails(await fetchHtml(result.url));
        } catch {
          // A search result without a detail page is still useful for manual matching.
        }

        const confidence = scoreCandidate(query, authorOverride, result);

        return {
          id: `goodreads_${result.id}`,
          audibleUrl: result.url,
          confidence,
          confidenceLabel: "Goodreads",
          metadata: {
            title: details.title || result.title,
            subtitle: null,
            author: details.author || result.author,
            narrator: null,
            description: details.description,
            publisher: details.publisher,
            year: details.year,
            genres: details.genres,
            tags: details.genres,
            language: null,
            isbn: details.isbn,
            asin: null,
            abridged: null,
            seriesName: null,
            seriesSequence: null,
            durationSeconds: null,
            releaseDate: details.releaseDate,
            imageUrl: details.imageUrl || result.imageUrl,
            audibleUrl: result.url,
          },
        } satisfies AudibleMatchCandidate;
      }),
    );

    return settled
      .flatMap((result) => (result.status === "fulfilled" ? [result.value] : []))
      .sort((left, right) => right.confidence - left.confidence);
  } catch (error) {
    console.error("Goodreads search error:", error);
    return [];
  }
};
