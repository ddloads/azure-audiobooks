export const stripHtml = (raw: unknown): string | null => {
  if (!raw) return null;
  return (
    String(raw)
      .replace(/<[^>]+>/g, " ")
      .replace(/&amp;/g, "&")
      .replace(/&lt;/g, "<")
      .replace(/&gt;/g, ">")
      .replace(/&quot;/g, '"')
      .replace(/&#39;/g, "'")
      .replace(/&nbsp;/g, " ")
      .replace(/\s+/g, " ")
      .trim() || null
  );
};

export const parseYear = (raw: unknown): string | null => {
  const str = String(raw ?? "").trim();
  const match = str.match(/\b(\d{4})\b/);
  return match ? match[1] : null;
};

export const parseGenres = (raw: unknown): string | null => {
  if (!raw) return null;
  return String(raw).replace(/\0/g, ", ").replace(/\s*,\s*/g, ", ").trim() || null;
};

export const parseAsin = (...values: unknown[]): string | null => {
  for (const value of values) {
    const match = String(value ?? "").match(/\bASIN[:\s-]*([A-Z0-9]{10})\b/i);
    if (match) return match[1].toUpperCase();
  }
  return null;
};

export const parseIsbn = (...values: unknown[]): string | null => {
  for (const value of values) {
    const match = String(value ?? "").match(/\b(97[89]\d{10})\b/);
    if (match) return match[1];
  }
  return null;
};

export const pickDescription = (...values: unknown[]): string | null => {
  for (const value of values) {
    const cleaned = stripHtml(value);
    if (!cleaned) continue;
    if (/^(ASIN|ISBN(?:-13)?)[:\s-]*[A-Z0-9-]+$/i.test(cleaned)) continue;
    return cleaned;
  }

  return null;
};
