import { AudibleMatchCandidate } from "./audible";

type GoogleBooksVolume = {
  id: string;
  volumeInfo: {
    title: string;
    subtitle?: string;
    authors?: string[];
    publisher?: string;
    publishedDate?: string;
    description?: string;
    industryIdentifiers?: Array<{ type: string; identifier: string }>;
    pageCount?: number;
    categories?: string[];
    imageLinks?: {
      thumbnail?: string;
      smallThumbnail?: string;
      small?: string;
      medium?: string;
      large?: string;
      extraLarge?: string;
    };
    language?: string;
  };
};

export const searchGoogleBooks = async (
  query: string,
  authorOverride?: string | null,
): Promise<AudibleMatchCandidate[]> => {
  try {
    const searchTerms = [query, authorOverride].filter(Boolean).join(" ").trim();
    const url = `https://www.googleapis.com/books/v1/volumes?q=${encodeURIComponent(searchTerms)}&maxResults=8`;
    
    const response = await fetch(url);
    if (!response.ok) return [];

    const data = await response.json();
    const items = (data.items || []) as GoogleBooksVolume[];

    return items.map((item) => {
      const info = item.volumeInfo;
      const isbn = info.industryIdentifiers?.find((id) => id.type === "ISBN_13" || id.type === "ISBN_10")?.identifier;
      
      // Get best image URL
      const imageUrl = info.imageLinks?.extraLarge || 
                       info.imageLinks?.large || 
                       info.imageLinks?.medium || 
                       info.imageLinks?.small || 
                       info.imageLinks?.thumbnail;

      // Map to same format as Audible for compatibility
      return {
        id: `google_${item.id}`,
        audibleUrl: `https://books.google.com/books?id=${item.id}`,
        confidence: 0.5, // Lower default confidence than Audible
        confidenceLabel: "Google Books",
        metadata: {
          title: info.title,
          subtitle: info.subtitle || null,
          author: info.authors?.join(", ") || null,
          narrator: null,
          description: info.description || null,
          publisher: info.publisher || null,
          year: info.publishedDate ? info.publishedDate.split("-")[0] : null,
          genres: info.categories?.join(", ") || null,
          tags: info.categories?.join(", ") || null,
          language: info.language || null,
          isbn: isbn || null,
          asin: null,
          abridged: null,
          seriesName: null,
          seriesSequence: null,
          durationSeconds: null,
          releaseDate: info.publishedDate || null,
          imageUrl: imageUrl || null,
          audibleUrl: null,
        },
      };
    });
  } catch (error) {
    console.error("Google Books search error:", error);
    return [];
  }
};
