import React, { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  Check,
  CheckCircle2,
  Clock,
  FileSearch,
  FolderOpen,
  ListPlus,
  MoreVertical,
  Play,
  RefreshCw,
  Search,
  Share2,
  Trash2,
  User,
  EyeOff,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import api from "../api/axios";

interface Book {
  id: string;
  title: string;
  subtitle?: string | null;
  asin?: string | null;
  author: { name: string };
  series?: { name: string } | null;
  sequence?: number | null;
  duration: number;
  coverPath?: string;
}

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}h ${m}m`;
};

const BookCard: React.FC<{
  book: Book;
  progressSeconds?: number;
  isAdmin?: boolean;
  isSelectable?: boolean;
  isSelected?: boolean;
  selectionControlsActive?: boolean;
  onSelect?: (selected: boolean, shiftKey: boolean) => void;
  onMatch?: () => void;
  onRescan?: () => void;
  onAutoChapterize?: () => void;
  onFindDuplicates?: () => void;
  onDelete?: () => void;
  onMarkFinished?: () => void;
  onRemoveFromContinueListening?: () => void;
  onClickOverride?: () => void;
}> = ({
  book,
  progressSeconds,
  isAdmin = false,
  isSelectable = false,
  isSelected = false,
  selectionControlsActive = false,
  onSelect,
  onMatch,
  onRescan,
  onAutoChapterize,
  onFindDuplicates,
  onDelete,
  onMarkFinished,
  onRemoveFromContinueListening,
  onClickOverride,
}) => {
  const { playBook } = usePlayer();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const [menuPos, setMenuPos] = useState<{ top: number; right: number } | null>(null);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const menuPortalRef = useRef<HTMLDivElement | null>(null);
  const returnTo = `${location.pathname}${location.search}`;

  const progressPct =
    progressSeconds && book.duration > 0
      ? Math.min(100, Math.round((progressSeconds / book.duration) * 100))
      : 0;

  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      const inTrigger = menuRef.current?.contains(event.target as Node);
      const inMenu = menuPortalRef.current?.contains(event.target as Node);
      if (!inTrigger && !inMenu) setMenuOpen(false);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [menuOpen]);

  const handlePlay = async (e: React.MouseEvent) => {
    e.stopPropagation();
    try {
      const [bookRes, progressRes] = await Promise.all([
        api.get(`/library/${book.id}`),
        api.get(`/progress/${book.id}`),
      ]);
      playBook(bookRes.data, progressRes.data.currentTime || 0);
    } catch {
      try {
        const bookRes = await api.get(`/library/${book.id}`);
        playBook(bookRes.data, 0);
      } catch {
        // silent
      }
    }
  };

  const handleClick = () => {
    if (onClickOverride) {
      onClickOverride();
      return;
    }
    navigate(`/book/${book.id}`, { state: { from: returnTo } });
  };

  const handleCheckboxClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    onSelect?.(!isSelected, e.shiftKey);
  };

  const hasProgress = Boolean(progressSeconds && progressSeconds > 30);

  const handleFeaturePlaceholder = (label: string) => {
    showToast({
      title: `${label} not available`,
      description: `${label} is not wired up in the web app yet.`,
      tone: "info",
    });
  };

  const handleShare = async () => {
    const shareUrl = `${window.location.origin}/book/${book.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: book.title,
          text: `Listen to ${book.title} by ${book.author.name}`,
          url: shareUrl,
        });
      } else if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        showToast({
          title: "Link copied",
          description: `Copied a share link for "${book.title}".`,
          tone: "success",
        });
      } else {
        showToast({
          title: "Share unavailable",
          description: "This browser does not support sharing or clipboard copy.",
          tone: "error",
        });
      }
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        return;
      }
      showToast({
        title: "Share failed",
        description: "Could not share this title.",
        tone: "error",
      });
    }
  };

  return (
    <>
    <div
      className={`book-card ${isSelected ? "selected" : ""} ${selectionControlsActive ? "selection-active" : ""}`}
      onClick={handleClick}
    >
      <div className="book-cover-wrap">
        {isSelectable && (
          <div className="book-card-checkbox-wrap" onClick={handleCheckboxClick}>
            <div className={`book-card-checkbox ${isSelected ? "checked" : ""}`}>
              {isSelected && <Check size={14} />}
            </div>
          </div>
        )}

        {isAdmin && !selectionControlsActive && (
          <div className="book-card-menu-wrap" ref={menuRef}>
            <button
              className="book-card-menu-trigger"
              onClick={(event) => {
                event.stopPropagation();
                if (!menuOpen) {
                  const rect = event.currentTarget.getBoundingClientRect();
                  setMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                }
                setMenuOpen((v) => !v);
              }}
              aria-label={`Open actions for ${book.title}`}
            >
              <MoreVertical size={16} />
            </button>
          </div>
        )}

        <div className="book-card-art-frame">
          {book.coverPath ? (
            <img className="book-cover-img" src={book.coverPath} alt={book.title} loading="lazy" />
          ) : (
            <div className="book-cover-placeholder">
              <BookOpen size={28} />
            </div>
          )}

          {progressPct > 0 && (
            <div className="book-card-progress-bar">
              <div className="book-card-progress-fill" style={{ width: `${progressPct}%` }} />
            </div>
          )}

          <div className="book-play-overlay">
            <div className="book-play-btn" onClick={handlePlay}>
              <Play size={22} style={{ marginLeft: "3px" }} fill="currentColor" />
            </div>
          </div>
        </div>
      </div>

      <div className="book-meta">
        <h3 className="book-title">{book.title}</h3>
        {book.subtitle && (
          <p className="book-subtitle">{book.subtitle}</p>
        )}
        <div className="book-detail">
          <User size={12} />
          <span>{book.author.name}</span>
        </div>
        {book.series && (
          <div className="book-series-label">
            {book.series.name}{book.sequence != null ? ` #${book.sequence}` : ''}
          </div>
        )}
        <div className="book-detail">
          <Clock size={12} />
          <span>{formatDuration(book.duration)}</span>
        </div>
      </div>
    </div>

    {menuOpen && menuPos && createPortal(
      <div
        className="book-card-menu"
        ref={menuPortalRef}
        style={{ top: menuPos.top, right: menuPos.right }}
      >
        {hasProgress && (
          <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onMarkFinished?.(); }}>
            <CheckCircle2 size={14} /> Mark as Finished
          </button>
        )}
        <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); handleFeaturePlaceholder("Add to Collection"); }}>
          <BookOpen size={14} /> Add to Collection
        </button>
        <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); handleFeaturePlaceholder("Add to Playlist"); }}>
          <ListPlus size={14} /> Add to Playlist
        </button>
        <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); void handleShare(); }}>
          <Share2 size={14} /> Share
        </button>
        <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); navigate(`/book/${book.id}`, { state: { from: returnTo } }); }}>
          <FolderOpen size={14} /> Files
        </button>
        {isAdmin && (
          <>
            <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onMatch?.(); }}>
              <Search size={14} /> Match
            </button>
            <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRescan?.(); }}>
              <RefreshCw size={14} /> Re-Scan
            </button>
            <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onAutoChapterize?.(); }}>
              <ListPlus size={14} /> Auto Chapterize
            </button>
            <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onFindDuplicates?.(); }}>
              <FileSearch size={14} /> Find Duplicates
            </button>
          </>
        )}
        {hasProgress && (
          <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onRemoveFromContinueListening?.(); }}>
            <EyeOff size={14} /> Remove from Continue Listening
          </button>
        )}
        {isAdmin && (
          <>
            <div className="book-card-menu-divider" />
            <button className="book-card-menu-item text-danger" onClick={(e) => { e.stopPropagation(); setMenuOpen(false); onDelete?.(); }}>
              <Trash2 size={14} /> Delete
            </button>
          </>
        )}
      </div>,
      document.body,
    )}
    </>
  );
};

export default BookCard;
