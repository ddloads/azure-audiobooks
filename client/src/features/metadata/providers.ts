import type { MatchCandidate, MetadataProvider } from "./types";

export const metadataProviderOptions: Array<{ value: MetadataProvider; label: string }> = [
  { value: "audible", label: "Audible.com" },
  { value: "combined", label: "Audible + Google" },
  { value: "google", label: "Google Books" },
  { value: "goodreads", label: "Goodreads" },
];

export const getCandidateSourceLabel = (candidate: MatchCandidate) => {
  if (candidate.id.startsWith("google_")) return "Google Books";
  if (candidate.id.startsWith("goodreads_")) return "Goodreads";
  return "Audible";
};
