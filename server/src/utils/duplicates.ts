type DuplicateCandidate = {
  id: string;
  title: string;
  asin?: string | null;
  isbn?: string | null;
  authorId?: string | null;
  author?: {
    name?: string | null;
  } | null;
  seriesId?: string | null;
  sequence?: number | null;
};

export type DuplicateGroupMatch<T> = {
  type: "asin" | "isbn" | "title-author";
  key: string;
  books: T[];
};

const collapseWhitespace = (value: string) => value.replace(/\s+/g, " ").trim();

const stripDiacritics = (value: string) =>
  value.normalize("NFKD").replace(/[\u0300-\u036f]/g, "");

const normalizeLooseText = (value: string | null | undefined) =>
  collapseWhitespace(stripDiacritics(value ?? "").toLowerCase());

const normalizeComparableText = (value: string | null | undefined) =>
  normalizeLooseText(value)
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();

const normalizeAsin = (value: string | null | undefined) =>
  (value ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "").trim();

const normalizeIsbn = (value: string | null | undefined) =>
  (value ?? "").toUpperCase().replace(/[^0-9X]/g, "").trim();

const buildTitleVariants = (title: string | null | undefined) => {
  const raw = title ?? "";
  const exact = normalizeComparableText(raw);
  const withoutTrailingParen = normalizeComparableText(raw.replace(/\s*\([^)]{1,80}\)\s*$/, ""));
  return Array.from(new Set([exact, withoutTrailingParen].filter(Boolean)));
};

const normalizeAuthor = (book: DuplicateCandidate) =>
  normalizeComparableText(book.author?.name || book.authorId || "");

const buildGroupKey = (type: DuplicateGroupMatch<unknown>["type"], ids: string[]) =>
  `${type}:${ids.slice().sort().join("|")}`;

export const booksArePotentialDuplicates = (
  left: DuplicateCandidate,
  right: DuplicateCandidate,
) => {
  if (left.id === right.id) return false;

  const leftAsin = normalizeAsin(left.asin);
  const rightAsin = normalizeAsin(right.asin);
  if (leftAsin && leftAsin === rightAsin) return true;

  const leftIsbn = normalizeIsbn(left.isbn);
  const rightIsbn = normalizeIsbn(right.isbn);
  if (leftIsbn && leftIsbn === rightIsbn) return true;

  const leftAuthor = normalizeAuthor(left);
  const rightAuthor = normalizeAuthor(right);
  if (!leftAuthor || !rightAuthor || leftAuthor !== rightAuthor) return false;

  // Different series → different books, not duplicates
  if (left.seriesId && right.seriesId && left.seriesId !== right.seriesId) return false;

  // Same series but different sequence numbers → different volumes, not duplicates
  if (
    left.seriesId && right.seriesId &&
    left.seriesId === right.seriesId &&
    left.sequence != null && right.sequence != null &&
    left.sequence !== right.sequence
  ) return false;

  const rightTitleVariants = new Set(buildTitleVariants(right.title));
  return buildTitleVariants(left.title).some((variant) => rightTitleVariants.has(variant));
};

export const findDuplicateGroups = <T extends DuplicateCandidate>(books: T[]): DuplicateGroupMatch<T>[] => {
  const asinGroups = new Map<string, T[]>();
  const isbnGroups = new Map<string, T[]>();
  const titleAuthorGroups = new Map<string, T[]>();

  for (const book of books) {
    const asin = normalizeAsin(book.asin);
    if (asin) {
      const existing = asinGroups.get(asin) ?? [];
      existing.push(book);
      asinGroups.set(asin, existing);
    }

    const isbn = normalizeIsbn(book.isbn);
    if (isbn) {
      const existing = isbnGroups.get(isbn) ?? [];
      existing.push(book);
      isbnGroups.set(isbn, existing);
    }

    const author = normalizeAuthor(book);
    if (author) {
      for (const title of buildTitleVariants(book.title)) {
        const key = `${author}::${title}`;
        const existing = titleAuthorGroups.get(key) ?? [];
        existing.push(book);
        titleAuthorGroups.set(key, existing);
      }
    }
  }

  const seenGroups = new Set<string>();
  const results: DuplicateGroupMatch<T>[] = [];

  for (const [key, matches] of asinGroups) {
    if (matches.length < 2) continue;
    const groupKey = buildGroupKey("asin", matches.map((book) => book.id));
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    results.push({ type: "asin", key, books: matches });
  }

  for (const [key, matches] of isbnGroups) {
    if (matches.length < 2) continue;
    const groupKey = buildGroupKey("isbn", matches.map((book) => book.id));
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    results.push({ type: "isbn", key, books: matches });
  }

  for (const [key, matches] of titleAuthorGroups) {
    if (matches.length < 2) continue;
    const uniqueMatches = Array.from(new Map(matches.map((book) => [book.id, book])).values());
    if (uniqueMatches.length < 2) continue;
    const groupKey = buildGroupKey("title-author", uniqueMatches.map((book) => book.id));
    if (seenGroups.has(groupKey)) continue;
    seenGroups.add(groupKey);
    results.push({ type: "title-author", key, books: uniqueMatches });
  }

  return results.sort((left, right) => {
    if (right.books.length !== left.books.length) return right.books.length - left.books.length;
    return left.books[0]?.title.localeCompare(right.books[0]?.title ?? "") ?? 0;
  });
};

