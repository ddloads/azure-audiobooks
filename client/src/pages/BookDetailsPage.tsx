import React, { useEffect, useState, useRef } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  BookOpen,
  Play,
  Clock,
  User,
  Mic,
  Calendar,
  Building2,
  Tag,
  Globe,
  Pencil,
  ChevronDown,
  ChevronUp,
  Download,
  CheckCircle2,
  Loader2,
  Settings,
  Database,
  Undo,
  Trash2,
  FileSearch,
  RefreshCw,
} from "lucide-react";
import api from "../api/axios";
import { usePlayer } from "../context/PlayerContext";
import { useTasks } from "../context/TaskContext";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import BookMetadataModal from "../components/BookMetadataModal";
import ConfirmDialog from "../components/ConfirmDialog";
import { getApiBaseUrl, getSocketBaseUrl } from "../api/backend";

interface AudioFile {
  id: string;
  filename: string;
  title?: string | null;
  duration: number;
  index: number;
}

interface Chapter {
  id: string;
  title: string;
  start: number;
  end: number;
}

interface Book {
  id: string;
  title: string;
  subtitle?: string | null;
  description?: string | null;
  author: { id: string; name: string };
  series?: { id: string; name: string } | null;
  sequence?: number | null;
  narrator?: string | null;
  publisher?: string | null;
  year?: string | null;
  genres?: string | null;
  language?: string | null;
  duration: number;
  coverPath?: string;
  tags?: string | null;
  isbn?: string | null;
  asin?: string | null;
  abridged?: boolean | null;
  audioFiles: AudioFile[];
  chapters: Chapter[];
}

type MergeProgress = {
  bookId: string;
  status: "starting" | "running" | "completed" | "failed";
  progress: number;
  stage: string;
  detail?: string;
};

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m ${s}s`;
};

const BookDetailsPage: React.FC = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const [book, setBook] = useState<Book | null>(null);
  const [savedTime, setSavedTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [showToolsMenu, setShowToolsMenu] = useState(false);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<MergeProgress | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [isTracksCollapsed, setIsTracksCollapsed] = useState(true);
  const [confirmAction, setConfirmAction] = useState<null | "merge" | "undo" | "rescan" | "cleanup" | "merge-duplicates" | "delete">(null);
  const [duplicates, setDuplicates] = useState<Book[]>([]);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<string[]>([]);
  const [isSearchingDuplicates, setIsSearchingDuplicates] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const { playBook, currentBook, isPlaying, togglePlay } = usePlayer();
  const { upsertTask, removeTask } = useTasks();
  const { user } = useAuth();
  const { showToast } = useToast();
  const isAdmin = user?.role === "ADMIN";
  const toolsMenuRef = useRef<HTMLDivElement>(null);
  const backTarget =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/";

  const handleBackToLibrary = () => {
    navigate(backTarget);
  };

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (toolsMenuRef.current && !toolsMenuRef.current.contains(e.target as Node)) {
        setShowToolsMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const socket = io(getSocketBaseUrl(), {
      withCredentials: true,
    });

    const handleMergeProgress = (progress: MergeProgress) => {
      if (progress.bookId !== bookId) return;
      setMergeProgress(progress);

      if (progress.status === "completed") {
        setMerging(false);
        void fetchBookDetails();
        window.setTimeout(() => {
          setMergeProgress((current) =>
            current?.bookId === progress.bookId && current.status === "completed" ? null : current,
          );
        }, 4000);
      }

      if (progress.status === "failed") {
        setMerging(false);
      }
    };

    socket.on("mergeProgress", handleMergeProgress);

    return () => {
      socket.off("mergeProgress", handleMergeProgress);
      socket.disconnect();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const handleMergeToM4B = async () => {
    if (!book) return;

    setMerging(true);
    setMergeProgress({
      bookId: book.id,
      status: "starting",
      progress: 2,
      stage: "Preparing merge",
      detail: "Waiting for the server to start the merge job",
    });
    setShowToolsMenu(false);
    setConfirmAction(null);
    try {
      const res = await api.post<{ message?: string }>(`/admin/books/${book.id}/merge-m4b`);
      await fetchBookDetails();
      showToast({
        title:
          book.audioFiles.length === 1 && !book.audioFiles[0].filename.toLowerCase().endsWith(".m4b")
            ? "Conversion complete"
            : "Merge complete",
        description:
          res.data.message ||
          (book.audioFiles.length === 1 && !book.audioFiles[0].filename.toLowerCase().endsWith(".m4b")
            ? "The audio file was converted into a single M4B file."
            : "The book files were combined into a single M4B file."),
        tone: "success",
      });
    } catch (error) {
      console.error("Merge failed", error);
      const msg = isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : "Unknown error";
      setMergeProgress({
        bookId: book.id,
        status: "failed",
        progress: 100,
        stage: "Merge failed",
        detail: msg,
      });
      showToast({
        title: "Merge failed",
        description: msg,
        tone: "error",
        durationMs: 6500,
      });
    } finally {
      setMerging(false);
    }
  };

  const handleUndoMerge = async () => {
    if (!book) return;

    setMerging(true);
    setShowToolsMenu(false);
    setConfirmAction(null);
    try {
      const res = await api.post(`/admin/books/${book.id}/undo-merge`);
      showToast({
        title: "Merge undone",
        description: res.data.message,
        tone: "success",
      });
      await fetchBookDetails();
    } catch (error) {
      console.error("Undo failed", error);
      const msg = isAxiosError<{ error?: string }>(error)
        ? error.response?.data?.error || "Check server logs."
        : "Check server logs.";
      showToast({
        title: "Undo failed",
        description: msg,
        tone: "error",
        durationMs: 6500,
      });
    } finally {
      setMerging(false);
    }
  };

  const handleRescan = async () => {
    if (!book) return;
    setMerging(true);
    setShowToolsMenu(false);
    setConfirmAction(null);
    try {
      await api.post(`/admin/books/${book.id}/rescan`);
      showToast({
        title: "Rescan complete",
        description: "The book's folder has been rescanned for changes.",
        tone: "success",
      });
      await fetchBookDetails();
    } catch (error) {
      console.error("Rescan failed", error);
      showToast({
        title: "Rescan failed",
        description: "Could not rescan the book folder.",
        tone: "error",
      });
    } finally {
      setMerging(false);
    }
  };

  const handleCleanupBackup = async () => {
    if (!book) return;
    setShowToolsMenu(false);
    setConfirmAction(null);
    try {
      await api.post(`/admin/books/${book.id}/cleanup-backup`);
      showToast({
        title: "Cleanup complete",
        description: "The merged backup folder has been deleted.",
        tone: "success",
      });
      await fetchBookDetails();
    } catch (error) {
      console.error("Cleanup failed", error);
      showToast({
        title: "Cleanup failed",
        description: "Could not delete the backup folder.",
        tone: "error",
      });
    }
  };

  const handleFindDuplicates = async () => {
    if (!book) return;
    setIsSearchingDuplicates(true);
    setShowToolsMenu(false);
    try {
      const res = await api.get<Book[]>(`/admin/books/${book.id}/duplicates`);
      setDuplicates(res.data);
      if (res.data.length > 0) {
        setConfirmAction("merge-duplicates");
      } else {
        showToast({
          title: "No duplicates found",
          description: "No other books with matching ASIN, ISBN, or Title/Author were found.",
          tone: "info",
        });
      }
    } catch (error) {
      console.error("Duplicate search failed", error);
      showToast({
        title: "Search failed",
        description: "Could not search for duplicates.",
        tone: "error",
      });
    } finally {
      setIsSearchingDuplicates(false);
    }
  };

  const handleMergeDuplicates = async () => {
    if (!book || selectedDuplicateIds.length === 0) return;
    setMerging(true);
    try {
      await api.post(`/admin/books/${book.id}/merge-with`, {
        secondaryIds: selectedDuplicateIds,
      });
      showToast({
        title: "Books merged",
        description: "Selected duplicates have been merged into this book.",
        tone: "success",
      });
      setConfirmAction(null);
      setSelectedDuplicateIds([]);
      await fetchBookDetails();
    } catch (error) {
      console.error("Merge failed", error);
      showToast({
        title: "Merge failed",
        description: "Could not merge the selected books.",
        tone: "error",
      });
    } finally {
      setMerging(false);
    }
  };

  const handleDeleteBook = async () => {
    if (!book) return;
    setIsDeleting(true);
    try {
      await api.delete(`/admin/books/${book.id}`, { data: { deleteFiles } });
      showToast({
        title: "Title removed",
        description: deleteFiles ? "The book and its files have been deleted." : "The book has been removed from your library.",
        tone: "success",
      });
      navigate(backTarget);
    } catch (error) {
      console.error("Delete failed", error);
      showToast({
        title: "Delete failed",
        description: "Could not remove the title from your library.",
        tone: "error",
      });
    } finally {
      setIsDeleting(false);
    }
  };

  const checkCache = async () => {
    if (!book) return;
    try {
      const cache = await caches.open("audio-cache");
      let allInCache = true;
      for (const file of book.audioFiles) {
        const url = `${getApiBaseUrl()}/stream/file/${file.id}`;
        const match = await cache.match(url);
        if (!match) {
          allInCache = false;
          break;
        }
      }
      setIsCached(allInCache);
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    if (book) {
      void checkCache();
    }
  }, [book]);

  const fetchBookDetails = async () => {
    if (!bookId) return;
    try {
      const [bookRes, progressRes, backupRes] = await Promise.all([
        api.get(`/library/${bookId}`),
        api.get(`/progress/${bookId}`).catch(() => ({ data: { currentTime: 0 } })),
        api.get(`/admin/books/${bookId}/has-backup`).catch(() => ({ data: { hasBackup: false } })),
      ]);
      setBook({
        ...bookRes.data,
        chapters: bookRes.data.chapters ?? [],
      });
      setSavedTime(progressRes.data.currentTime || 0);
      setHasBackup(backupRes.data.hasBackup);
    } catch (error) {
      console.error("Failed to fetch book details", error);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchBookDetails();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const handlePlayFromStart = () => {
    if (!book) return;
    if (currentBook?.id === book.id) {
      togglePlay();
      return;
    }
    playBook(book, savedTime);
  };

  const handlePlayTrack = (index: number) => {
    if (!book) return;
    let startTime = 0;
    for (let i = 0; i < index; i++) {
      startTime += book.audioFiles[i].duration;
    }
    playBook(book, startTime);
  };

  const handleDownload = async () => {
    if (!book) return;
    const taskId = `download-${book.id}`;
    const startedAt = new Date().toISOString();
    setDownloading(true);
    try {
      const cache = await caches.open("audio-cache");
      const totalFiles = book.audioFiles.length;
      upsertTask({
        id: taskId,
        type: "download",
        status: "running",
        title: `Download for Offline: ${book.title}`,
        progress: 0,
        detail: `0/${totalFiles} files cached`,
        startedAt,
        updatedAt: startedAt,
        bookId: book.id,
      });

      for (let index = 0; index < totalFiles; index++) {
        const file = book.audioFiles[index];
        const url = `${getApiBaseUrl()}/stream/file/${file.id}`;
        const match = await cache.match(url);
        if (!match) {
          await cache.add(url);
        }

        upsertTask({
          id: taskId,
          type: "download",
          status: "running",
          title: `Download for Offline: ${book.title}`,
          progress: Math.round(((index + 1) / totalFiles) * 100),
          detail: `${index + 1}/${totalFiles} files cached`,
          startedAt,
          updatedAt: new Date().toISOString(),
          bookId: book.id,
        });
      }

      setIsCached(true);
      removeTask(taskId);
      showToast({
        title: "Download complete",
        description: "This title is now available offline on this device.",
        tone: "success",
      });
    } catch (error) {
      console.error("Download failed", error);
      removeTask(taskId);
      showToast({
        title: "Download failed",
        description: "The title could not be cached for offline playback.",
        tone: "error",
      });
    } finally {
      setDownloading(false);
    }
  };

  if (loading) {
    return (
      <div className="container book-details-page loading">
        <div className="app-loading-spinner" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="container book-details-page">
        <div className="error-message">Book not found.</div>
        <button className="btn btn-secondary" onClick={handleBackToLibrary}>
          <ArrowLeft size={18} /> Back to Library
        </button>
      </div>
    );
  }

  const isCurrentPlaying = currentBook?.id === book.id && isPlaying;
  const canConvertSingleFileToM4B =
    book.audioFiles.length === 1 &&
    !book.audioFiles[0].filename.toLowerCase().endsWith(".m4b");
  const canMergeToM4B = book.audioFiles.length > 1;
  const canCreateM4B = canConvertSingleFileToM4B || canMergeToM4B;
  const m4bActionLabel = canConvertSingleFileToM4B ? "Convert to M4B" : "Merge to M4B";
  const m4bProgressLabel = canConvertSingleFileToM4B ? "Converting..." : "Merging...";

  return (
    <div className="container book-details-page">
      <header className="page-header">
        <button className="btn-back" onClick={handleBackToLibrary} aria-label="Back to Library">
          <ArrowLeft size={24} />
          <span>Library</span>
        </button>
      </header>

      <div className="book-details-container">
        <div className="book-details-header">
          <div className="book-details-cover-wrapper">
            {book.coverPath ? (
              <img src={book.coverPath} alt={book.title} className="book-details-cover-img" />
            ) : (
              <div className="book-cover-placeholder-large">
                <BookOpen size={48} />
                <span>No Cover Art</span>
              </div>
            )}
          </div>

          <div className="book-details-main-info">
            {book.series && (
              <button
                className="book-details-series-badge"
                onClick={() =>
                  navigate(
                    `/?seriesId=${book.series!.id}&seriesName=${encodeURIComponent(book.series!.name)}`,
                  )
                }
                title={`Browse ${book.series.name} series`}
              >
                {book.series.name}
                {book.sequence != null && <span> · Book {book.sequence}</span>}
              </button>
            )}
            <div className="book-details-title-row">
              <div className="book-details-title-block">
                <h1 className="book-details-title-text">{book.title}</h1>
                {book.subtitle && (
                  <p className="book-details-subtitle-text">{book.subtitle}</p>
                )}
              </div>
              {isAdmin && (
                <div className="book-details-admin-actions" ref={toolsMenuRef}>
                  <div className="book-tools-wrap">
                    <button
                      className={`btn-book-tools${showToolsMenu ? " active" : ""}`}
                      onClick={() => setShowToolsMenu(!showToolsMenu)}
                      title="Book Tools"
                    >
                      <Settings size={20} />
                    </button>
                    {showToolsMenu && (
                      <div className="book-tools-menu">
                        <div className="book-tools-header">Book Tools</div>
                        <button
                          className="book-tools-option"
                          onClick={() => {
                            setShowMetadataModal(true);
                            setShowToolsMenu(false);
                          }}
                        >
                          <Pencil size={16} />
                          <span>Edit Metadata</span>
                        </button>
                        <button
                          className="book-tools-option"
                          onClick={() => setConfirmAction("merge")}
                          disabled={merging || !canCreateM4B}
                        >
                          <Database size={16} />
                          <span>{merging ? m4bProgressLabel : m4bActionLabel}</span>
                        </button>
                        {hasBackup && (
                          <button
                            className="book-tools-option"
                            onClick={() => setConfirmAction("undo")}
                            disabled={merging}
                          >
                            <Undo size={16} />
                            <span>Undo Merge</span>
                          </button>
                        )}
                        <div className="book-tools-divider" />
                        <button
                          className="book-tools-option"
                          onClick={() => setConfirmAction("rescan")}
                          disabled={merging}
                        >
                          <RefreshCw size={16} className={merging ? "animate-spin" : ""} />
                          <span>Refresh Metadata</span>
                        </button>
                        <button
                          className="book-tools-option"
                          onClick={() => handleFindDuplicates()}
                          disabled={isSearchingDuplicates}
                        >
                          <FileSearch size={16} />
                          <span>Find Duplicates</span>
                        </button>
                        {hasBackup && (
                          <button
                            className="book-tools-option text-danger"
                            onClick={() => setConfirmAction("cleanup")}
                          >
                            <Trash2 size={16} />
                            <span>Cleanup Backups</span>
                          </button>
                        )}
                        <div className="book-tools-divider" />
                        <button
                          className="book-tools-option text-danger"
                          onClick={() => setConfirmAction("delete")}
                        >
                          <Trash2 size={16} />
                          <span>Remove Title</span>
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>

            <div className="book-details-metadata-grid">
              <div className="metadata-row">
                <User size={16} className="metadata-icon" />
                <span className="metadata-label">Author</span>
                <div className="metadata-links-container">
                  {book.author.name.split(/(?:\s*[,&]\s*|\s+and\s+)/i).map((name, i, arr) => (
                    <React.Fragment key={name}>
                      <button
                        className="metadata-link"
                        onClick={() =>
                          navigate(
                            `/?search=${encodeURIComponent(name.trim())}`,
                          )
                        }
                        title={`Browse books by ${name.trim()}`}
                      >
                        {name.trim()}
                      </button>
                      {i < arr.length - 1 && <span className="metadata-separator">, </span>}
                    </React.Fragment>
                  ))}
                </div>
              </div>

              {book.narrator && (
                <div className="metadata-row">
                  <Mic size={16} className="metadata-icon" />
                  <span className="metadata-label">Narrator</span>
                  <div className="metadata-links-container">
                    {book.narrator.split(/(?:\s*[,&;]\s*|\s+and\s+)/i).map((name, i, arr) => (
                      <React.Fragment key={name}>
                        <button
                          className="metadata-link"
                          onClick={() =>
                            navigate(`/?search=${encodeURIComponent(name.trim())}`)
                          }
                          title={`Browse books narrated by ${name.trim()}`}
                        >
                          {name.trim()}
                        </button>
                        {i < arr.length - 1 && <span className="metadata-separator">, </span>}
                      </React.Fragment>
                    ))}
                  </div>
                </div>
              )}

              {book.year && (
                <div className="metadata-row">
                  <Calendar size={16} className="metadata-icon" />
                  <span className="metadata-label">Year</span>
                  <span className="metadata-value">{book.year}</span>
                </div>
              )}

              {book.publisher && (
                <div className="metadata-row">
                  <Building2 size={16} className="metadata-icon" />
                  <span className="metadata-label">Publisher</span>
                  <span className="metadata-value">{book.publisher}</span>
                </div>
              )}

              {book.genres && (
                <div className="metadata-row">
                  <Tag size={16} className="metadata-icon" />
                  <span className="metadata-label">Genre</span>
                  <span className="metadata-value">{book.genres}</span>
                </div>
              )}

              {book.language && (
                <div className="metadata-row">
                  <Globe size={16} className="metadata-icon" />
                  <span className="metadata-label">Language</span>
                  <span className="metadata-value">{book.language.toUpperCase()}</span>
                </div>
              )}

              <div className="metadata-row">
                <Clock size={16} className="metadata-icon" />
                <span className="metadata-label">Duration</span>
                <span className="metadata-value">{formatDuration(book.duration)}</span>
              </div>
            </div>

            {savedTime > 0 && book.duration > 0 && (
              <div className="book-details-progress">
                <div className="book-details-progress-bar">
                  <div
                    className="book-details-progress-fill"
                    style={{ width: `${Math.min(100, (savedTime / book.duration) * 100)}%` }}
                  />
                </div>
                <div className="book-details-progress-labels">
                  <span>{Math.round((savedTime / book.duration) * 100)}% complete</span>
                  <span>{formatDuration(Math.max(0, book.duration - savedTime))} left</span>
                </div>
              </div>
            )}

            {mergeProgress && (
              <div className={`merge-progress-card ${mergeProgress.status === "failed" ? "failed" : ""}`}>
                <div className="merge-progress-head">
                  <strong>{mergeProgress.stage}</strong>
                  <span>{mergeProgress.progress}%</span>
                </div>
                <div className="progress-bar-container merge-progress-bar">
                  <div
                    className="progress-bar-fill"
                    style={{ width: `${mergeProgress.progress}%` }}
                  />
                </div>
                {mergeProgress.detail && (
                  <div className="merge-progress-detail">{mergeProgress.detail}</div>
                )}
              </div>
            )}

            <div className="book-details-actions">
              <button
                className={`btn ${isCurrentPlaying ? "btn-secondary" : "btn-primary"} play-action-btn`}
                onClick={handlePlayFromStart}
              >
                {isCurrentPlaying ? (
                  <>Pause</>
                ) : (
                  <>
                    <Play size={18} fill="currentColor" />
                    {savedTime > 0 ? "Resume" : "Play"}
                  </>
                )}
              </button>

              <button
                className={`btn ${isCached ? "btn-secondary" : "btn-outline"} download-action-btn`}
                onClick={handleDownload}
                disabled={downloading || isCached}
              >
                {downloading ? (
                  <>
                    <Loader2 size={18} className="animate-spin" />
                    Downloading...
                  </>
                ) : isCached ? (
                  <>
                    <CheckCircle2 size={18} />
                    Available Offline
                  </>
                ) : (
                  <>
                    <Download size={18} />
                    Download for Offline
                  </>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Description */}
        {book.description && (
          <div className="book-details-desc-section">
            <h3 className="section-subtitle">About this book</h3>
            <p className="description-text">
              {book.description.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim()}
            </p>
          </div>
        )}

        {/* Chapters */}
        {book.chapters && book.chapters.length > 0 && (
          <div className="book-details-tracks-section">
            <h3 className="section-subtitle">Chapters</h3>
            <div className="book-details-track-list">
              {book.chapters.map((chapter) => (
                <div
                  key={chapter.id}
                  className="book-details-track-row"
                  onClick={() => playBook(book, chapter.start)}
                >
                  <div className="track-row-left">
                    <div className="track-play-indicator">
                      <Play size={12} fill="currentColor" />
                    </div>
                  </div>
                  <div className="track-row-main">
                    <span className="track-filename">{chapter.title}</span>
                  </div>
                  <div className="track-row-right">
                    <span className="track-time-label">{formatDuration(chapter.start)}</span>
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* Tracks */}
        <div className="book-details-tracks-section">
          <div
            className="section-header collapsible"
            onClick={() => setIsTracksCollapsed(!isTracksCollapsed)}
          >
            <h3 className="section-subtitle">Tracks</h3>
            <div className="section-header-right">
              <span className="track-count">{book.audioFiles.length} files</span>
              {isTracksCollapsed ? <ChevronDown size={20} /> : <ChevronUp size={20} />}
            </div>
          </div>

          {!isTracksCollapsed && (
            <div className="book-details-track-list">
              {book.audioFiles.map((file, idx) => (
                <div
                  key={file.id}
                  className="book-details-track-row"
                  onClick={() => handlePlayTrack(idx)}
                >
                  <div className="track-row-left">
                    <span className="track-num">{idx + 1}</span>
                    <div className="track-play-indicator">
                      <Play size={12} fill="currentColor" />
                    </div>
                  </div>

                  <div className="track-row-main">
                    <span className="track-filename" title={file.filename}>
                      {file.title || file.filename}
                    </span>
                    {file.title && (
                      <span className="track-filename-sub" title={file.filename}>
                        {file.filename}
                      </span>
                    )}
                  </div>

                  <div className="track-row-right">
                    <span className="track-time-label">{formatDuration(file.duration)}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {showMetadataModal && book && (
        <BookMetadataModal
          book={book}
          onClose={() => setShowMetadataModal(false)}
          onApplied={() => fetchBookDetails()}
          initialTab="edit"
        />
      )}
      <ConfirmDialog
        open={confirmAction === "merge"}
        title={canConvertSingleFileToM4B ? "Convert Audio File" : "Merge Book Files"}
        message={
          canConvertSingleFileToM4B
            ? "This will convert the current audio file into a single .m4b file. The original file will be moved to a '.merged-backup' folder."
            : "This will merge all audio files into a single .m4b file. The original files will be moved to a '.merged-backup' folder."
        }
        confirmLabel={m4bActionLabel}
        busy={merging}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleMergeToM4B()}
      />
      <ConfirmDialog
        open={confirmAction === "undo"}
        title="Undo Merge"
        message="This will restore the original files and delete the merged M4B."
        confirmLabel="Restore Files"
        tone="danger"
        busy={merging}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleUndoMerge()}
      />
      <ConfirmDialog
        open={confirmAction === "rescan"}
        title="Refresh Metadata"
        message="This will rescan the book's folder for file changes and update the database. Existing progress will be preserved."
        confirmLabel="Rescan Now"
        busy={merging}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleRescan()}
      />
      <ConfirmDialog
        open={confirmAction === "cleanup"}
        title="Cleanup Backups"
        message="This will permanently delete the '.merged-backup' folder for this book. You will no longer be able to undo the merge."
        confirmLabel="Delete Backup"
        tone="danger"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleCleanupBackup()}
      />

      {/* Duplicate Merge Modal */}
      {confirmAction === "merge-duplicates" && (
        <div className="modal-overlay">
          <div className="modal-content metadata-modal">
            <div className="modal-header">
              <h2 className="modal-title">Merge Duplicates</h2>
              <button className="btn-close" onClick={() => setConfirmAction(null)}>×</button>
            </div>
            <div className="modal-body">
              <p className="mb-4">Select the books you want to merge <strong>INTO</strong> this primary record. Audio files and progress will be consolidated.</p>
              <div className="duplicate-list">
                {duplicates.map(dup => (
                  <label key={dup.id} className="duplicate-item">
                    <input
                      type="checkbox"
                      checked={selectedDuplicateIds.includes(dup.id)}
                      onChange={(e) => {
                        if (e.target.checked) {
                          setSelectedDuplicateIds([...selectedDuplicateIds, dup.id]);
                        } else {
                          setSelectedDuplicateIds(selectedDuplicateIds.filter(id => id !== dup.id));
                        }
                      }}
                    />
                    <div className="dup-info">
                      <div className="dup-title">{dup.title}</div>
                      <div className="dup-meta">
                        {(dup as any).library?.name} • {(dup as any)._count?.audioFiles} files
                      </div>
                      <div className="dup-path" title={(dup as any).folderPath}>
                        {(dup as any).folderPath}
                      </div>
                    </div>
                  </label>
                ))}
              </div>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button
                className="btn btn-primary"
                disabled={selectedDuplicateIds.length === 0 || merging}
                onClick={() => void handleMergeDuplicates()}
              >
                {merging ? "Merging..." : `Merge ${selectedDuplicateIds.length} Books`}
              </button>
            </div>
          </div>
        </div>
      )}
      {/* Delete Title Modal */}
      {confirmAction === "delete" && (
        <div className="modal-overlay">
          <div className="modal-content metadata-modal">
            <div className="modal-header">
              <h2 className="modal-title">Remove Title</h2>
              <button className="btn-close" onClick={() => setConfirmAction(null)}>×</button>
            </div>
            <div className="modal-body">
              <p className="mb-4">Are you sure you want to remove <strong>{book.title}</strong> from your library?</p>
              <label className="flex items-center gap-3 p-4 bg-danger-bg rounded-lg cursor-pointer border border-danger-border hover:bg-danger-bg-hover transition-colors">
                <input
                  type="checkbox"
                  className="w-5 h-5 accent-danger"
                  checked={deleteFiles}
                  onChange={(e) => setDeleteFiles(e.target.checked)}
                />
                <div className="flex flex-col">
                  <span className="font-bold text-danger">Delete physical files</span>
                  <span className="text-sm text-muted">This will permanently remove the audio files from disk.</span>
                </div>
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button
                className={`btn ${deleteFiles ? "btn-danger" : "btn-primary"}`}
                disabled={isDeleting}
                onClick={() => void handleDeleteBook()}
              >
                {isDeleting ? "Removing..." : deleteFiles ? "Delete Files & Remove" : "Remove from Library"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default BookDetailsPage;
