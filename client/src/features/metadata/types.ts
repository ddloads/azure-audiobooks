export type MetadataBook = {
  id: string;
  title: string;
  subtitle?: string | null;
  author: { name: string };
  library?: { id: string; name: string };
  narrator?: string | null;
  series?: { id?: string; name: string } | null;
  sequence?: number | null;
  description?: string | null;
  publisher?: string | null;
  year?: string | null;
  genres?: string | null;
  tags?: string | null;
  language?: string | null;
  isbn?: string | null;
  asin?: string | null;
  abridged?: boolean | null;
  duration: number;
  folderPath?: string | null;
  coverPath?: string;
};

export type CandidateMetadata = {
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

export type MatchCandidate = {
  id: string;
  audibleUrl: string;
  confidence: number;
  confidenceLabel: string;
  metadata: CandidateMetadata;
};

export type MetadataProvider = "audible" | "google" | "goodreads" | "combined";
