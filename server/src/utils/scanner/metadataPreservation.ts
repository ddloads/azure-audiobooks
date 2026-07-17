const MATCHED_METADATA_TAG = /(?:^|,)\s*(?:matched|quick-matched)\s*(?:,|$)/i;

export const hasMatchedMetadata = (tags: string | null | undefined) =>
  typeof tags === "string" && MATCHED_METADATA_TAG.test(tags);
