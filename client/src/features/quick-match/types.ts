import type { MetadataProvider } from "../metadata/types";

export type QuickMatchMode = "preview" | "apply";
export type QuickMatchBusyState = QuickMatchMode | null;

export type QuickMatchResult = {
  mode: QuickMatchMode;
  provider: MetadataProvider;
  minConfidence: number;
  ready: Array<{ bookId: string; title: string; candidateTitle: string | null; confidence: number; reason: string }>;
  applied: Array<{ bookId: string; title: string; candidateTitle: string | null; confidence: number; reason: string }>;
  skippedAlreadyMatched: Array<{ bookId: string; title: string; tags: string | null }>;
  needsReview: Array<{ bookId: string; title: string; reason: string }>;
  noResult: Array<{ bookId: string; title: string; reason: string }>;
  failed: Array<{ bookId: string; title: string; error: string }>;
};

export type QuickMatchFieldKey =
  | "title"
  | "subtitle"
  | "author"
  | "narrator"
  | "seriesName"
  | "seriesSequence"
  | "description"
  | "publisher"
  | "year"
  | "genres"
  | "tags"
  | "language"
  | "isbn"
  | "asin"
  | "abridged"
  | "imageUrl";

export type QuickMatchFields = Record<QuickMatchFieldKey, boolean>;

export const defaultQuickMatchFields = (): QuickMatchFields => ({
  title: true,
  subtitle: true,
  author: true,
  narrator: true,
  seriesName: true,
  seriesSequence: true,
  description: true,
  publisher: true,
  year: true,
  genres: true,
  tags: true,
  language: true,
  isbn: true,
  asin: true,
  abridged: true,
  imageUrl: true,
});

export const quickMatchFieldLabels: Array<{ key: QuickMatchFieldKey; label: string }> = [
  { key: "title", label: "Title" },
  { key: "subtitle", label: "Subtitle" },
  { key: "author", label: "Author" },
  { key: "narrator", label: "Narrator" },
  { key: "seriesName", label: "Series" },
  { key: "seriesSequence", label: "Series #" },
  { key: "description", label: "Description" },
  { key: "publisher", label: "Publisher" },
  { key: "year", label: "Year" },
  { key: "genres", label: "Genres" },
  { key: "tags", label: "Tags" },
  { key: "language", label: "Language" },
  { key: "isbn", label: "ISBN" },
  { key: "asin", label: "ASIN" },
  { key: "abridged", label: "Abridged" },
  { key: "imageUrl", label: "Cover" },
];
