import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookMarked, BookOpen, Headphones, Library, Sparkles, Zap } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import type { RecommendBook } from '../components/RecommendationShelf';
import type { AppearanceSettings } from '../features/admin/types';

interface ProgressRecord {
  bookId: string;
  currentTime: number;
  book: {
    id: string;
    title: string;
    duration: number;
    coverPath?: string | null;
    author: { name: string };
  };
}

interface Recommendations {
  nextInSeries: RecommendBook[];
  youMightLike: RecommendBook[];
  recentlyAdded: RecommendBook[];
}

const defaultSettings: AppearanceSettings = {
  showReviewBooks: true,
  shelfContinueListening: true,
  shelfNextInSeries: true,
  shelfYouMightLike: true,
  shelfRecentlyAdded: true,
};

const formatTimeLeft = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return 'Good morning';
  if (h < 17) return 'Good afternoon';
  return 'Good evening';
};

const MobileHome = () => {
  const { user } = useAuth();
  const { playBook } = usePlayer();
  const navigate = useNavigate();

  const [progressRecords, setProgressRecords] = useState<ProgressRecord[]>([]);
  const [recommendations, setRecommendations] = useState<Recommendations>({
    nextInSeries: [],
    youMightLike: [],
    recentlyAdded: [],
  });
  const [shelves, setShelves] = useState<AppearanceSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const load = async () => {
      try {
        const [progressRes, recRes, settingsRes] = await Promise.all([
          api.get('/progress'),
          api.get<Recommendations>('/recommendations'),
          api.get<AppearanceSettings>('/settings/appearance'),
        ]);
        setProgressRecords(progressRes.data);
        setRecommendations(recRes.data);
        setShelves({ ...defaultSettings, ...settingsRes.data });
      } catch {
        // show whatever loaded
      } finally {
        setLoading(false);
      }
    };
    void load();
  }, []);

  const handleContinuePlay = async (record: ProgressRecord) => {
    try {
      const res = await api.get(`/library/${record.bookId}`);
      playBook(res.data, record.currentTime);
    } catch { /* ignore */ }
  };

  const handleRecommendPlay = async (bookId: string) => {
    try {
      const [bookRes, progRes] = await Promise.all([
        api.get(`/library/${bookId}`),
        api.get(`/progress/${bookId}`),
      ]);
      playBook(bookRes.data, progRes.data?.currentTime || 0);
    } catch { /* ignore */ }
  };

  const hasContent =
    (shelves.shelfContinueListening && progressRecords.length > 0) ||
    (shelves.shelfNextInSeries && recommendations.nextInSeries.length > 0) ||
    (shelves.shelfYouMightLike && recommendations.youMightLike.length > 0) ||
    (shelves.shelfRecentlyAdded && recommendations.recentlyAdded.length > 0);

  return (
    <div className="mobile-home">

      {/* Greeting */}
      <section className="mobile-home-greeting">
        <span className="mobile-home-kicker">Azure Audiobooks</span>
        <h1 className="mobile-home-title">
          {greeting()}{user?.username ? `, ${user.username}` : ''}
        </h1>
        <p className="mobile-home-sub">
          {loading
            ? 'Loading your library…'
            : hasContent
            ? 'Pick up where you left off.'
            : 'Start your first audiobook.'}
        </p>
      </section>

      {/* Continue Listening */}
      {shelves.shelfContinueListening && progressRecords.length > 0 && (
        <section className="mobile-continue-section">
          <div className="mobile-continue-header">
            <Headphones size={12} />
            Continue Listening
          </div>
          <div className="mobile-continue-shelf">
            {progressRecords.map(rec => {
              const pct = rec.book.duration > 0
                ? Math.min(100, Math.round((rec.currentTime / rec.book.duration) * 100))
                : 0;
              const remaining = Math.max(0, rec.book.duration - rec.currentTime);
              return (
                <div key={rec.bookId} className="mobile-continue-card" onClick={() => handleContinuePlay(rec)}>
                  <div className="mobile-continue-art-frame">
                    {rec.book.coverPath
                      ? <img src={rec.book.coverPath} alt={rec.book.title} />
                      : <div className="mobile-continue-art-placeholder"><BookOpen size={24} /></div>
                    }
                    <div className="mobile-continue-progress-bar">
                      <div className="mobile-continue-progress-fill" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                  <div className="mobile-continue-title">{rec.book.title}</div>
                  <div className="mobile-continue-time">{formatTimeLeft(remaining)}</div>
                </div>
              );
            })}
          </div>
        </section>
      )}

      {/* Up Next in Series */}
      {shelves.shelfNextInSeries && recommendations.nextInSeries.length > 0 && (
        <section className="mobile-continue-section">
          <div className="mobile-continue-header">
            <BookMarked size={12} />
            Up Next in Series
          </div>
          <div className="mobile-continue-shelf">
            {recommendations.nextInSeries.map(book => (
              <div key={book.id} className="mobile-continue-card" onClick={() => handleRecommendPlay(book.id)}>
                <div className="mobile-continue-art-frame">
                  {book.coverPath
                    ? <img src={book.coverPath} alt={book.title} />
                    : <div className="mobile-continue-art-placeholder"><BookOpen size={24} /></div>
                  }
                </div>
                <div className="mobile-continue-title">{book.title}</div>
                <div className="mobile-continue-time">
                  {book.series?.name ?? book.author.name}
                  {book.sequence != null ? ` #${book.sequence}` : ''}
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* You Might Like */}
      {shelves.shelfYouMightLike && recommendations.youMightLike.length > 0 && (
        <section className="mobile-continue-section">
          <div className="mobile-continue-header">
            <Sparkles size={12} />
            You Might Like
          </div>
          <div className="mobile-continue-shelf">
            {recommendations.youMightLike.map(book => (
              <div key={book.id} className="mobile-continue-card" onClick={() => handleRecommendPlay(book.id)}>
                <div className="mobile-continue-art-frame">
                  {book.coverPath
                    ? <img src={book.coverPath} alt={book.title} />
                    : <div className="mobile-continue-art-placeholder"><BookOpen size={24} /></div>
                  }
                </div>
                <div className="mobile-continue-title">{book.title}</div>
                <div className="mobile-continue-time">{book.author.name}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Recently Added */}
      {shelves.shelfRecentlyAdded && recommendations.recentlyAdded.length > 0 && (
        <section className="mobile-continue-section">
          <div className="mobile-continue-header">
            <Zap size={12} />
            Recently Added
          </div>
          <div className="mobile-continue-shelf">
            {recommendations.recentlyAdded.map(book => (
              <div key={book.id} className="mobile-continue-card" onClick={() => handleRecommendPlay(book.id)}>
                <div className="mobile-continue-art-frame">
                  {book.coverPath
                    ? <img src={book.coverPath} alt={book.title} />
                    : <div className="mobile-continue-art-placeholder"><BookOpen size={24} /></div>
                  }
                </div>
                <div className="mobile-continue-title">{book.title}</div>
                <div className="mobile-continue-time">{book.author.name}</div>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Loading skeleton */}
      {loading && (
        <div className="mobile-home-skeleton">
          <div className="mobile-continue-section">
            <div className="mobile-home-skeleton-label" />
            <div className="mobile-continue-shelf">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="mobile-home-skeleton-card">
                  <div className="mobile-home-skeleton-cover" />
                  <div className="mobile-home-skeleton-line" style={{ width: '80%' }} />
                  <div className="mobile-home-skeleton-line" style={{ width: '55%' }} />
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Empty state */}
      {!loading && !hasContent && (
        <div className="mobile-empty">
          <div className="mobile-empty-icon"><BookOpen size={40} /></div>
          <h3>Your library is quiet</h3>
          <p>Start listening to a book and your recommendations will appear here.</p>
          <button className="btn btn-primary" style={{ marginTop: 12 }} onClick={() => navigate('/library')}>
            <Library size={15} />
            Browse Library
          </button>
        </div>
      )}

    </div>
  );
};

export default MobileHome;
