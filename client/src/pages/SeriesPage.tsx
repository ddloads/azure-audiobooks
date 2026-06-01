import { useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { ArrowLeft, BookOpen, CheckCircle2, Play } from "lucide-react";
import api from "../api/axios";
import { usePlayer } from "../context/PlayerContext";

interface SeriesBook {
  id: string;
  title: string;
  subtitle?: string | null;
  coverPath?: string | null;
  sequence?: number | null;
  duration: number;
  author: { id: string; name: string };
  progress: { currentTime: number; isFinished: boolean } | null;
}

interface SeriesDetail {
  id: string;
  name: string;
  books: SeriesBook[];
}

const fmtPct = (book: SeriesBook) => {
  if (!book.progress) return null;
  if (book.progress.isFinished) return 100;
  if (!book.duration) return 0;
  return Math.min(99, Math.round((book.progress.currentTime / book.duration) * 100));
};

const sortSeriesBooks = (books: SeriesBook[]) =>
  books
    .slice()
    .sort((a, b) => {
      const aSequence = a.sequence ?? Number.MAX_SAFE_INTEGER;
      const bSequence = b.sequence ?? Number.MAX_SAFE_INTEGER;
      return aSequence - bSequence || a.title.localeCompare(b.title);
    });

export default function SeriesPage() {
  const { seriesId } = useParams<{ seriesId: string }>();
  const navigate = useNavigate();
  const { playBook } = usePlayer();
  const [series, setSeries] = useState<SeriesDetail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!seriesId) return;
    api.get<SeriesDetail>(`/library/series/${seriesId}`)
      .then((res) => setSeries(res.data))
      .catch(() => setSeries(null))
      .finally(() => setLoading(false));
  }, [seriesId]);

  const handlePlay = async (book: SeriesBook) => {
    try {
      const [bookRes] = await Promise.all([api.get(`/library/${book.id}`)]);
      const startTime = book.progress && !book.progress.isFinished ? book.progress.currentTime : 0;
      playBook(bookRes.data, startTime);
    } catch { /* ignore */ }
  };

  const completedCount = series?.books.filter((b) => b.progress?.isFinished).length ?? 0;
  const sortedBooks = series ? sortSeriesBooks(series.books) : [];

  return (
    <div className="series-page">
      <div className="series-header">
        <div className="admin-settings-header-left">
          <button className="admin-back-btn" onClick={() => navigate(-1)} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="admin-settings-title">
              {loading ? "Loading…" : (series?.name ?? "Series not found")}
            </h1>
            {series && (
              <p className="admin-settings-subtitle">
                {series.books.length} book{series.books.length !== 1 ? "s" : ""}
                {completedCount > 0 && ` · ${completedCount} completed`}
              </p>
            )}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="series-loading">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="series-book-skeleton">
              <div className="series-book-cover-skeleton skeleton-pulse" />
              <div className="series-book-info-skeleton">
                <div className="skeleton-line skeleton-pulse" style={{ width: "55%", height: 14 }} />
                <div className="skeleton-line skeleton-pulse" style={{ width: "35%", height: 11, marginTop: 6 }} />
              </div>
            </div>
          ))}
        </div>
      ) : !series ? (
        <div className="series-empty">Series not found.</div>
      ) : (
        <div className="series-book-list">
          {sortedBooks.map((book) => {
            const pct = fmtPct(book);
            const finished = book.progress?.isFinished ?? false;
            return (
              <div
                key={book.id}
                className={`series-book-item${finished ? " is-finished" : ""}`}
                onClick={() => navigate(`/book/${book.id}`)}
              >
                {book.sequence != null && (
                  <span className="series-book-seq">#{book.sequence}</span>
                )}
                <div className="series-book-cover">
                  {book.coverPath ? (
                    <img src={book.coverPath} alt={book.title} />
                  ) : (
                    <div className="series-book-cover-placeholder">
                      <BookOpen size={18} />
                    </div>
                  )}
                  {finished && (
                    <div className="series-book-finished-badge">
                      <CheckCircle2 size={14} />
                    </div>
                  )}
                </div>
                <div className="series-book-info">
                  <p className="series-book-title">{book.title}</p>
                  <p className="series-book-author">{book.author.name}</p>
                  {pct !== null && !finished && (
                    <div className="series-book-progress">
                      <div className="series-book-progress-bar">
                        <div className="series-book-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                      <span className="series-book-pct">{pct}%</span>
                    </div>
                  )}
                  {finished && <p className="series-book-done">Completed</p>}
                </div>
                <button
                  className="series-book-play"
                  onClick={(e) => { e.stopPropagation(); void handlePlay(book); }}
                  title={finished ? "Play again" : book.progress ? "Resume" : "Play"}
                >
                  <Play size={15} fill="currentColor" />
                </button>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
