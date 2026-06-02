import { BookOpen } from "lucide-react";
import ScrollableShelf from "./ScrollableShelf";
import { coverUrl } from "../utils/covers";

export interface RecommendBook {
  id: string;
  title: string;
  subtitle?: string | null;
  duration: number;
  coverPath?: string | null;
  sequence?: number | null;
  author: { id: string; name: string };
  series?: { id: string; name: string } | null;
}

interface RecommendationShelfProps {
  title: string;
  icon: React.ReactNode;
  books: RecommendBook[];
  onBookClick: (bookId: string, title: string) => void;
}

export default function RecommendationShelf({
  title,
  icon,
  books,
  onBookClick,
}: RecommendationShelfProps) {
  if (books.length === 0) return null;

  return (
    <section className="continue-listening-section">
      <div className="continue-listening-header">
        <span className="continue-listening-icon">{icon}</span>
        <h2 className="continue-listening-title">{title}</h2>
      </div>
      <ScrollableShelf>
        {books.map((book) => (
          <div
            key={book.id}
            className="continue-card"
            onClick={() => onBookClick(book.id, book.title)}
            title={book.title}
          >
            <div className="continue-card-cover">
              <div className="continue-card-art-frame">
                {book.coverPath ? (
                  <img src={coverUrl(book.coverPath, 240)} alt={book.title} loading="lazy" decoding="async" />
                ) : (
                  <div className="continue-card-cover-placeholder">
                    <BookOpen size={24} />
                  </div>
                )}
                <div className="continue-card-play-overlay">
                  <BookOpen size={18} />
                </div>
              </div>
            </div>
            <div className="continue-card-info">
              <p className="continue-card-title">{book.title}</p>
              <p className="continue-card-author">{book.author.name}</p>
              {book.series && (
                <p className="continue-card-time">
                  {book.series.name}
                  {book.sequence != null ? ` #${book.sequence}` : ""}
                </p>
              )}
            </div>
          </div>
        ))}
      </ScrollableShelf>
    </section>
  );
}
