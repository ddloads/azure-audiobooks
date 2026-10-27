import { fetchExternal } from "./externalFetch";
import { AUDNEXUS_REGION } from "./audnexus";

// Finds a book's Audible ASIN with Audible's public catalog API: one JSON
// request per book (the metadata matcher scrapes up to nine pages). A result
// counts only when its runtime and author both match the files, which rules
// out other books and other editions.

const CATALOG_HOSTS: Record<string, string> = {
  us: "api.audible.com",
  ca: "api.audible.ca",
  uk: "api.audible.co.uk",
  au: "api.audible.com.au",
  fr: "api.audible.fr",
  de: "api.audible.de",
  jp: "api.audible.co.jp",
  it: "api.audible.it",
  in: "api.audible.in",
  es: "api.audible.es",
};

export type CatalogProduct = {
  asin?: string;
  title?: string;
  runtime_length_min?: number;
  authors?: Array<{ name?: string }>;
};

export type AsinLookupResult =
  | { status: "found"; asin: string; title: string }
  | { status: "no-match" | "error"; reason: string };

const normalize = (value: string) =>
  value
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

/**
 * The searchable part of a library title: drops "(Unabridged)", track
 * counters like "01/22", series suffixes after " - " or ": ", and brackets.
 */
export const cleanTitleForSearch = (title: string) =>
  title
    .replace(/\((un)?abridged\)/gi, "")
    .replace(/\s\d{1,3}\/\d{1,3}\s*$/, "")
    .split(/ - |: /)[0]
    .replace(/\(.*?\)|\[.*?\]/g, "")
    .replace(/\s+/g, " ")
    .trim();

const authorSurname = (author: string) => normalize(author).split(" ").filter(Boolean).pop() ?? "";

/** Audible minutes vs the files' seconds: within 2% or 2 minutes, whichever is larger. */
export const catalogRuntimeMatches = (runtimeMinutes: number, bookSeconds: number) =>
  bookSeconds > 0 && Math.abs(runtimeMinutes * 60 - bookSeconds) <= Math.max(120, bookSeconds * 0.02);

/** Share of the search title's words that appear in the candidate title. */
const titleOverlap = (searchTitle: string, candidateTitle: string) => {
  const wanted = normalize(searchTitle).split(" ").filter(Boolean);
  if (wanted.length === 0) return 0;
  const have = new Set(normalize(candidateTitle).split(" "));
  return wanted.filter((word) => have.has(word)).length / wanted.length;
};

/** The best product whose runtime, author and title all match, or null. */
export const pickCatalogMatch = (
  products: CatalogProduct[],
  book: { title: string; author: string; duration: number },
): CatalogProduct | null => {
  const searchTitle = cleanTitleForSearch(book.title);
  const surname = authorSurname(book.author);
  if (!surname || surname === "author") return null; // "Unknown Author" can't confirm anything

  const matches = products
    .filter(
      (product) =>
        typeof product.asin === "string" &&
        typeof product.runtime_length_min === "number" &&
        catalogRuntimeMatches(product.runtime_length_min, book.duration) &&
        (product.authors ?? []).some((author) => normalize(author.name ?? "").split(" ").includes(surname)) &&
        titleOverlap(searchTitle, product.title ?? "") >= 0.5,
    )
    .map((product) => ({
      product,
      score: titleOverlap(searchTitle, product.title ?? "") - Math.abs(product.runtime_length_min! * 60 - book.duration) / 3600,
    }))
    .sort((a, b) => b.score - a.score);

  return matches[0]?.product ?? null;
};

const searchCatalog = async (params: Record<string, string>) => {
  const query = new URLSearchParams({
    ...params,
    num_results: "10",
    products_sort_by: "Relevance",
    response_groups: "contributors,product_desc,media",
  });
  const host = CATALOG_HOSTS[AUDNEXUS_REGION] ?? CATALOG_HOSTS.us;
  const response = await fetchExternal(`https://${host}/1.0/catalog/products?${query}`, {
    headers: { accept: "application/json" },
  });
  if (!response.ok) throw new Error(`Audible catalog returned HTTP ${response.status}`);
  return ((await response.json()) as { products?: CatalogProduct[] }).products ?? [];
};

export const findAsinForBook = async (book: { title: string; author: string; duration: number }): Promise<AsinLookupResult> => {
  const title = cleanTitleForSearch(book.title);
  if (!title || book.duration <= 0) return { status: "no-match", reason: "Missing title or duration" };

  try {
    let match = pickCatalogMatch(await searchCatalog({ title, author: book.author }), book);
    // The author may be spelled differently on Audible ("Octavia E Butler"); the
    // author check above still applies to these results.
    if (!match) match = pickCatalogMatch(await searchCatalog({ title }), book);
    return match
      ? { status: "found", asin: match.asin!.toUpperCase(), title: match.title ?? title }
      : { status: "no-match", reason: "No Audible result with the same runtime and author" };
  } catch (error) {
    return { status: "error", reason: error instanceof Error ? error.message : String(error) };
  }
};
