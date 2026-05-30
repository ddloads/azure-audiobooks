import { createPortal } from "react-dom";
import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import {
  BookMarked,
  BookOpen,
  Check,
  EyeOff,
  Headphones,
  Library,
  MoreVertical,
  PlayCircle,
  Sparkles,
  X,
  Zap,
} from "lucide-react";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import RecommendationShelf, { type RecommendBook } from "../components/RecommendationShelf";
import ScrollableShelf from "../components/ScrollableShelf";
import type { AppearanceSettings } from "../features/admin/types";
import { applyShelfPrefs } from "../hooks/useShelfPrefs";

interface ProgressRecord {
  bookId: string;
  currentTime: number;
  lastUpdate: string;
  book: {
    id: string;
    title: string;
    duration: number;
    coverPath?: string | null;
    author: { name: string };
  };
}

const formatTimeLeft = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
};

const greeting = () => {
  const h = new Date().getHours();
  if (h < 12) return "Good morning";
  if (h < 17) return "Good afternoon";
  return "Good evening";
};

export default function Home() {
  const { user } = useAuth();
  const { playBook } = usePlayer();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [progressRecords, setProgressRecords] = useState<ProgressRecord[]>([]);
  const [recommendations, setRecommendations] = useState<{
    nextInSeries: RecommendBook[];
    youMightLike: RecommendBook[];
    recentlyAdded: RecommendBook[];
  }>({ nextInSeries: [], youMightLike: [], recentlyAdded: [] });
  const [shelves, setShelves] = useState<AppearanceSettings>({
    showReviewBooks: true,
    shelfContinueListening: true,
    shelfNextInSeries: true,
    shelfYouMightLike: true,
    shelfRecentlyAdded: true,
  });
  const [loading, setLoading] = useState(true);
  const [newBookCount, setNewBookCount] = useState(0);
  const [newBannerDismissed, setNewBannerDismissed] = useState(false);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuTriggerRef = useRef<HTMLDivElement | null>(null);
  const menuPortalRef = useRef<HTMLDivElement | null>(null);

  async function loadHome() {
    setLoading(true);
    const lastVisit = localStorage.getItem("lastHomeVisit");
    try {
      const requests: Promise<unknown>[] = [
        api.get("/progress"),
        api.get("/recommendations"),
        api.get<AppearanceSettings>("/settings/appearance"),
      ];
      if (lastVisit) {
        requests.push(api.get<{ count: number }>(`/library/new-count?since=${encodeURIComponent(lastVisit)}`));
      }
      const results = await Promise.all(requests);
      const [progressRes, recRes, settingsRes] = results as [
        { data: ProgressRecord[] },
        { data: { nextInSeries: RecommendBook[]; youMightLike: RecommendBook[]; recentlyAdded: RecommendBook[] } },
        { data: AppearanceSettings },
        ...({ data: { count: number } })[],
      ];
      setProgressRecords(progressRes.data);
      setRecommendations(recRes.data);
      const merged = user ? applyShelfPrefs(settingsRes.data, user.id) : settingsRes.data;
      setShelves(prev => ({ ...prev, ...merged }));
      if (lastVisit && results[3]) {
        const countRes = results[3] as { data: { count: number } };
        setNewBookCount(countRes.data.count);
      }
    } catch (err) {
      console.error("Failed to load home data", err);
    } finally {
      setLoading(false);
      localStorage.setItem("lastHomeVisit", new Date().toISOString());
    }
  }

  useEffect(() => {
    void loadHome();
  }, []);

  useEffect(() => {
    if (!openMenuId) return;
    const handler = (e: MouseEvent) => {
      const inTrigger = menuTriggerRef.current?.contains(e.target as Node);
      const inMenu = menuPortalRef.current?.contains(e.target as Node);
      if (!inTrigger && !inMenu) setOpenMenuId(null);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [openMenuId]);

  const handlePlay = async (record: ProgressRecord) => {
    try {
      const bookRes = await api.get(`/library/${record.bookId}`);
      playBook(bookRes.data, record.currentTime);
    } catch (err) {
      console.error("Failed to play", err);
    }
  };

  const handleRecommendPlay = async (bookId: string) => {
    try {
      const [bookRes, progRes] = await Promise.all([
        api.get(`/library/${bookId}`),
        api.get(`/progress/${bookId}`),
      ]);
      playBook(bookRes.data, progRes.data.currentTime || 0);
    } catch (err) {
      console.error("Failed to play recommendation", err);
    }
  };

  const removeRecord = (bookId: string) =>
    setProgressRecords((prev) => prev.filter((r) => r.bookId !== bookId));

  const handleMarkFinished = async (record: ProgressRecord) => {
    try {
      await api.post(`/progress/${record.bookId}`, {
        currentTime: record.book.duration,
        isFinished: true,
      });
      removeRecord(record.bookId);
      setOpenMenuId(null);
      showToast({ title: "Marked as finished", description: `"${record.book.title}" marked as finished.`, tone: "success" });
    } catch {
      showToast({ title: "Update failed", description: "Could not update progress.", tone: "error" });
    }
  };

  const handleRemove = async (record: ProgressRecord) => {
    try {
      await api.post(`/progress/${record.bookId}`, { currentTime: 0, isFinished: false });
      removeRecord(record.bookId);
      setOpenMenuId(null);
      showToast({ title: "Removed", description: `"${record.book.title}" removed from Continue Listening.`, tone: "success" });
    } catch {
      showToast({ title: "Update failed", description: "Could not update progress.", tone: "error" });
    }
  };

  const hasContent =
    (shelves.shelfContinueListening && progressRecords.length > 0) ||
    (shelves.shelfNextInSeries && recommendations.nextInSeries.length > 0) ||
    (shelves.shelfYouMightLike && recommendations.youMightLike.length > 0) ||
    (shelves.shelfRecentlyAdded && recommendations.recentlyAdded.length > 0);

  const menuRecord = progressRecords.find((r) => r.bookId === openMenuId);

  return (
    <div className="home-page">
      {newBookCount > 0 && !newBannerDismissed && (
        <div className="home-new-banner">
          <Zap size={14} className="home-new-banner-icon" />
          <span>
            {newBookCount} new book{newBookCount !== 1 ? "s" : ""} added since your last visit
          </span>
          <button
            className="home-new-banner-browse"
            onClick={() => navigate("/library")}
          >
            Browse
          </button>
          <button
            className="home-new-banner-dismiss"
            onClick={() => setNewBannerDismissed(true)}
            aria-label="Dismiss"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div className="home-header">
        <div className="home-header-copy">
          <h1 className="home-greeting-title">
            {greeting()}{user?.username ? `, ${user.username}` : ""}
          </h1>
          <p className="home-greeting-sub">
            {loading
              ? "Loading your library…"
              : hasContent
              ? "Pick up where you left off."
              : "Start your first audiobook."}
          </p>
        </div>
        <div className="home-header-actions">
          <button className="btn btn-secondary" type="button" onClick={() => navigate("/library")}>
            <Library size={15} />
            Browse Library
          </button>
          {progressRecords[0] && (
            <button className="btn btn-primary" type="button" onClick={() => handlePlay(progressRecords[0])}>
              <PlayCircle size={15} />
              Resume
            </button>
          )}
        </div>
      </div>

      {/* Continue Listening */}
      {shelves.shelfContinueListening && progressRecords.length > 0 && (
        <section className="continue-listening-section">
          <div className="continue-listening-header">
            <Headphones size={16} className="continue-listening-icon" />
            <h2 className="continue-listening-title">Continue Listening</h2>
          </div>
          <ScrollableShelf>
            {progressRecords.map((record) => {
              const pct = Math.min(100, Math.round((record.currentTime / record.book.duration) * 100));
              const remaining = Math.max(0, record.book.duration - record.currentTime);
              return (
                <div
                  key={record.bookId}
                  className="continue-card"
                  onClick={() => handlePlay(record)}
                  title={`Resume ${record.book.title}`}
                >
                  <div className="continue-card-cover">
                    <div
                      className="book-card-menu-wrap"
                      ref={openMenuId === record.bookId ? menuTriggerRef : null}
                    >
                      <button
                        className="book-card-menu-trigger"
                        onClick={(e) => {
                          e.stopPropagation();
                          if (openMenuId === record.bookId) {
                            setOpenMenuId(null);
                          } else {
                            const rect = e.currentTarget.getBoundingClientRect();
                            setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                            setOpenMenuId(record.bookId);
                          }
                        }}
                        aria-label={`Actions for ${record.book.title}`}
                      >
                        <MoreVertical size={16} />
                      </button>
                    </div>

                    <div className="continue-card-art-frame">
                      {record.book.coverPath ? (
                        <img src={record.book.coverPath} alt={record.book.title} />
                      ) : (
                        <div className="continue-card-cover-placeholder">
                          <BookOpen size={24} />
                        </div>
                      )}
                      <div className="continue-card-play-overlay">
                        <Headphones size={18} />
                      </div>
                      <div className="continue-card-progress-bar">
                        <div className="continue-card-progress-fill" style={{ width: `${pct}%` }} />
                      </div>
                    </div>
                  </div>
                  <div className="continue-card-info">
                    <p className="continue-card-title">{record.book.title}</p>
                    <p className="continue-card-author">{record.book.author.name}</p>
                    <p className="continue-card-time">{formatTimeLeft(remaining)}</p>
                  </div>
                </div>
              );
            })}
          </ScrollableShelf>
        </section>
      )}

      {/* Recommendation shelves */}
      {shelves.shelfNextInSeries && (
        <RecommendationShelf
          title="Up Next in Series"
          icon={<BookMarked size={18} />}
          books={recommendations.nextInSeries}
          onBookClick={handleRecommendPlay}
        />
      )}

      {shelves.shelfYouMightLike && (
        <RecommendationShelf
          title="You Might Like"
          icon={<Sparkles size={18} />}
          books={recommendations.youMightLike}
          onBookClick={handleRecommendPlay}
        />
      )}

      {shelves.shelfRecentlyAdded && (
        <RecommendationShelf
          title="Recently Added"
          icon={<Zap size={18} />}
          books={recommendations.recentlyAdded}
          onBookClick={handleRecommendPlay}
        />
      )}

      {/* Empty state */}
      {!loading && !hasContent && (
        <div className="home-empty">
          <div className="home-empty-icon">
            <BookOpen size={44} />
          </div>
          <h2 className="home-empty-title">Your library is quiet</h2>
          <p className="home-empty-sub">
            Start listening to a book and your recommendations will appear here.
          </p>
          <button className="btn btn-primary home-empty-cta" onClick={() => navigate("/library")}>
            <Library size={15} />
            Browse Library
          </button>
        </div>
      )}

      {/* Continue-shelf context menu portal */}
      {openMenuId && menuPos && menuRecord &&
        createPortal(
          <div
            className="book-card-menu"
            ref={menuPortalRef}
            style={{ top: menuPos.top, right: menuPos.right }}
          >
            <button
              className="book-card-menu-item"
              onClick={(e) => { e.stopPropagation(); void handleMarkFinished(menuRecord); }}
            >
              <Check size={14} /> Mark as Finished
            </button>
            <button
              className="book-card-menu-item"
              onClick={(e) => { e.stopPropagation(); void handleRemove(menuRecord); }}
            >
              <EyeOff size={14} /> Remove from Shelf
            </button>
          </div>,
          document.body,
        )}
    </div>
  );
}
