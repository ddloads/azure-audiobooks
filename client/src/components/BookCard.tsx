import React, { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Check, Clock, User, Play, MoreVertical, Search, ExternalLink, RefreshCw, FileSearch, Trash2 } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import api from "../api/axios";

interface Book {
  id: string;
  title: string;
  subtitle?: string | null;
  asin?: string | null;
  author: { name: string };
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
  onFindDuplicates?: () => void;
  onDelete?: () => void;
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
  onFindDuplicates,
  onDelete,
  onClickOverride,
}) => {
  const { playBook } = usePlayer();
  const navigate = useNavigate();
  const location = useLocation();
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const returnTo = `${location.pathname}${location.search}`;

  const progressPct =
    progressSeconds && book.duration > 0
      ? Math.min(100, Math.round((progressSeconds / book.duration) * 100))
      : 0;

  useEffect(() => {
    if (!menuOpen) return;

    const handleClickOutside = (event: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
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

  return (
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
                setMenuOpen((current) => !current);
              }}
              aria-label={`Open actions for ${book.title}`}
            >
              <MoreVertical size={16} />
            </button>

            {menuOpen && (
              <div className="book-card-menu">
                <button
                  className="book-card-menu-item"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    navigate(`/book/${book.id}`, { state: { from: returnTo } });
                  }}
                >
                  <ExternalLink size={14} />
                  Open Details
                </button>
                <button
                  className="book-card-menu-item"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    onMatch?.();
                  }}
                >
                  <Search size={14} />
                  Fetch Metadata
                </button>
                <div className="book-card-menu-divider" />
                <button
                  className="book-card-menu-item"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    onRescan?.();
                  }}
                >
                  <RefreshCw size={14} />
                  Refresh Metadata
                </button>
                <button
                  className="book-card-menu-item"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    onFindDuplicates?.();
                  }}
                >
                  <FileSearch size={14} />
                  Find Duplicates
                </button>
                <div className="book-card-menu-divider" />
                <button
                  className="book-card-menu-item text-danger"
                  onClick={(event) => {
                    event.stopPropagation();
                    setMenuOpen(false);
                    onDelete?.();
                  }}
                >
                  <Trash2 size={14} />
                  Remove Title
                </button>
              </div>
            )}
          </div>
        )}

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

      <div className="book-meta">
        <h3 className="book-title">{book.title}</h3>
        {book.subtitle && (
          <p className="book-subtitle">{book.subtitle}</p>
        )}
        <div className="book-detail">
          <User size={12} />
          <span>{book.author.name}</span>
        </div>
        <div className="book-detail">
          <Clock size={12} />
          <span>{formatDuration(book.duration)}</span>
        </div>
      </div>
    </div>
  );
};

export default BookCard;
