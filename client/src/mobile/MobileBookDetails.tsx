import { useEffect, useState } from 'react';
import { useLocation, useNavigate, useParams } from 'react-router-dom';
import { isAxiosError } from 'axios';
import { io } from 'socket.io-client';
import {
  ArrowLeft, BookOpen, CheckCircle2, ChevronDown, ChevronUp,
  Database, Download, Loader2, MoreVertical, Pause,
  Pencil, Play, RefreshCw, Search, Trash2, Undo,
} from 'lucide-react';
import api from '../api/axios';
import { getApiBaseUrl, getSocketBaseUrl } from '../api/backend';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import { useTasks } from '../context/TaskContext';
import { useToast } from '../context/ToastContext';
import BookMetadataModal from '../components/BookMetadataModal';
import ConfirmDialog from '../components/ConfirmDialog';

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
  folderPath: string;
  audioFiles: AudioFile[];
  chapters: Chapter[];
}

type MergeProgress = {
  bookId: string;
  status: 'starting' | 'running' | 'completed' | 'failed';
  progress: number;
  stage: string;
  detail?: string;
};

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const MobileBookDetails = () => {
  const { bookId } = useParams<{ bookId: string }>();
  const navigate = useNavigate();
  const location = useLocation();
  const { user } = useAuth();
  const { playBook, currentBook, isPlaying, togglePlay } = usePlayer();
  const { upsertTask, removeTask } = useTasks();
  const { showToast } = useToast();

  const [book, setBook] = useState<Book | null>(null);
  const [savedTime, setSavedTime] = useState(0);
  const [loading, setLoading] = useState(true);
  const [downloading, setDownloading] = useState(false);
  const [isCached, setIsCached] = useState(false);
  const [descExpanded, setDescExpanded] = useState(false);
  const [detailsCollapsed, setDetailsCollapsed] = useState(false);
  const [chaptersCollapsed, setChaptersCollapsed] = useState(false);
  const [tracksCollapsed, setTracksCollapsed] = useState(true);
  const [showToolsSheet, setShowToolsSheet] = useState(false);
  const [showMetadataModal, setShowMetadataModal] = useState(false);
  const [metadataInitialTab, setMetadataInitialTab] = useState<'edit' | 'fetch'>('edit');
  const [confirmAction, setConfirmAction] = useState<null | 'merge' | 'undo' | 'rescan' | 'cleanup' | 'delete'>(null);
  const [merging, setMerging] = useState(false);
  const [mergeProgress, setMergeProgress] = useState<MergeProgress | null>(null);
  const [hasBackup, setHasBackup] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const isAdmin = user?.role === 'ADMIN';

  const backTarget = (
    typeof location.state === 'object' &&
    location.state !== null &&
    'from' in location.state &&
    typeof (location.state as Record<string, unknown>).from === 'string'
  ) ? (location.state as { from: string }).from : '/';

  const fetchBookDetails = async () => {
    if (!bookId) return;
    try {
      const [bookRes, progressRes, backupRes] = await Promise.all([
        api.get(`/library/${bookId}`),
        api.get(`/progress/${bookId}`).catch(() => ({ data: { currentTime: 0 } })),
        api.get(`/admin/books/${bookId}/has-backup`).catch(() => ({ data: { hasBackup: false } })),
      ]);
      setBook({ ...bookRes.data, chapters: bookRes.data.chapters ?? [] });
      setSavedTime(progressRes.data.currentTime || 0);
      setHasBackup(backupRes.data.hasBackup);
    } catch {
      // ignore
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchBookDetails(); }, [bookId]);

  useEffect(() => {
    const socket = io(getSocketBaseUrl(), { withCredentials: true });
    socket.on('mergeProgress', (data: MergeProgress) => {
      if (data.bookId !== bookId) return;
      setMergeProgress(data);
      if (data.status === 'completed') {
        setMerging(false);
        void fetchBookDetails();
        setTimeout(() => setMergeProgress(p => p?.bookId === data.bookId && p.status === 'completed' ? null : p), 4000);
      }
      if (data.status === 'failed') setMerging(false);
    });
    return () => { socket.disconnect(); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bookId]);

  const checkCache = async () => {
    if (!book) return;
    try {
      const cache = await caches.open('audio-cache');
      for (const file of book.audioFiles) {
        if (!await cache.match(`${getApiBaseUrl()}/stream/file/${file.id}`)) {
          setIsCached(false);
          return;
        }
      }
      setIsCached(true);
    } catch { /* ignore */ }
  };

  useEffect(() => { if (book) void checkCache(); }, [book]);

  const handlePlay = () => {
    if (!book) return;
    if (currentBook?.id === book.id) { togglePlay(); return; }
    playBook(book, savedTime);
  };

  const handlePlayTrack = (index: number) => {
    if (!book) return;
    let start = 0;
    for (let i = 0; i < index; i++) start += book.audioFiles[i].duration;
    playBook(book, start);
  };

  const handleDownload = async () => {
    if (!book) return;
    const taskId = `download-${book.id}`;
    const startedAt = new Date().toISOString();
    setDownloading(true);
    try {
      const cache = await caches.open('audio-cache');
      const total = book.audioFiles.length;
      upsertTask({ id: taskId, type: 'download', status: 'running', title: `Downloading: ${book.title}`, progress: 0, detail: `0/${total} files`, startedAt, updatedAt: startedAt, bookId: book.id });
      for (let i = 0; i < total; i++) {
        const url = `${getApiBaseUrl()}/stream/file/${book.audioFiles[i].id}`;
        if (!await cache.match(url)) await cache.add(url);
        upsertTask({ id: taskId, type: 'download', status: 'running', title: `Downloading: ${book.title}`, progress: Math.round(((i + 1) / total) * 100), detail: `${i + 1}/${total} files`, startedAt, updatedAt: new Date().toISOString(), bookId: book.id });
      }
      setIsCached(true);
      removeTask(taskId);
      showToast({ title: 'Download complete', description: 'Available offline on this device.', tone: 'success' });
    } catch {
      removeTask(taskId);
      showToast({ title: 'Download failed', description: 'Could not cache for offline playback.', tone: 'error' });
    } finally {
      setDownloading(false);
    }
  };

  const handleMergeToM4B = async () => {
    if (!book) return;
    setMerging(true);
    setMergeProgress({ bookId: book.id, status: 'starting', progress: 2, stage: 'Preparing…' });
    setShowToolsSheet(false);
    setConfirmAction(null);
    try {
      await api.post(`/admin/books/${book.id}/merge-m4b`);
      await fetchBookDetails();
      showToast({ title: 'Merge complete', description: 'Files combined into a single M4B.', tone: 'success' });
    } catch (error) {
      const msg = isAxiosError<{ error?: string }>(error) ? error.response?.data?.error : 'Unknown error';
      setMergeProgress({ bookId: book.id, status: 'failed', progress: 100, stage: 'Failed', detail: msg });
      showToast({ title: 'Merge failed', description: msg, tone: 'error' });
    } finally { setMerging(false); }
  };

  const handleUndoMerge = async () => {
    if (!book) return;
    setMerging(true);
    setConfirmAction(null);
    try {
      await api.post(`/admin/books/${book.id}/undo-merge`);
      showToast({ title: 'Merge undone', description: 'Original files restored.', tone: 'success' });
      await fetchBookDetails();
    } catch {
      showToast({ title: 'Undo failed', description: 'Check server logs.', tone: 'error' });
    } finally { setMerging(false); }
  };

  const handleRescan = async () => {
    if (!book) return;
    setMerging(true);
    setConfirmAction(null);
    try {
      await api.post(`/admin/books/${book.id}/rescan`);
      showToast({ title: 'Rescan complete', tone: 'success' });
      await fetchBookDetails();
    } catch {
      showToast({ title: 'Rescan failed', tone: 'error' });
    } finally { setMerging(false); }
  };

  const handleCleanupBackup = async () => {
    if (!book) return;
    setConfirmAction(null);
    try {
      await api.post(`/admin/books/${book.id}/cleanup-backup`);
      showToast({ title: 'Cleanup complete', tone: 'success' });
      await fetchBookDetails();
    } catch {
      showToast({ title: 'Cleanup failed', tone: 'error' });
    }
  };

  const handleDeleteBook = async () => {
    if (!book) return;
    setIsDeleting(true);
    try {
      await api.delete(`/admin/books/${book.id}`, { data: { deleteFiles } });
      showToast({ title: 'Title removed', tone: 'success' });
      navigate(backTarget);
    } catch {
      showToast({ title: 'Delete failed', tone: 'error' });
    } finally { setIsDeleting(false); }
  };

  if (loading) {
    return (
      <div style={{ display: 'flex', justifyContent: 'center', alignItems: 'center', height: '60vh' }}>
        <div className="app-loading-spinner" />
      </div>
    );
  }

  if (!book) {
    return (
      <div className="mobile-empty">
        <BookOpen size={40} className="mobile-empty-icon" />
        <h3>Book not found</h3>
        <button className="btn btn-secondary" onClick={() => navigate('/')}>Back to Library</button>
      </div>
    );
  }

  const isCurrentPlaying = currentBook?.id === book.id && isPlaying;
  const canMergeM4B = book.audioFiles.length > 1 || (book.audioFiles.length === 1 && !book.audioFiles[0].filename.toLowerCase().endsWith('.m4b'));
  const descText = book.description?.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() ?? '';
  const descPreview = descText.slice(0, 280);

  return (
    <div className="mobile-book-details">
      {/* Full-width cover with floating topbar */}
      <div className="mobile-details-hero">
        {book.coverPath ? (
          <div className="mobile-details-cover-section">
            <img src={book.coverPath} alt={book.title} />
          </div>
        ) : (
          <div className="mobile-details-cover-placeholder">
            <div className="mobile-details-cover-placeholder-inner">
              <BookOpen size={48} />
              <span>No Cover</span>
            </div>
          </div>
        )}

        <div className="mobile-details-topbar">
          <button
            className="mobile-details-back-btn"
            onClick={() => navigate(backTarget)}
            aria-label="Back to library"
          >
            <ArrowLeft size={18} />
            <span>Library</span>
          </button>
          {isAdmin && (
            <button
              className="mobile-details-tools-btn"
              onClick={() => setShowToolsSheet(true)}
              aria-label="Book tools"
              aria-haspopup="dialog"
              aria-expanded={showToolsSheet}
            >
              <MoreVertical size={18} />
            </button>
          )}
        </div>
      </div>

      {/* Book info */}
      <div className="mobile-details-body">
        {book.series && (
          <button
            className="mobile-details-series-badge"
            onClick={() => navigate(`/?seriesId=${book.series!.id}&seriesName=${encodeURIComponent(book.series!.name)}`)}
          >
            {book.series.name}{book.sequence != null && ` · Book ${book.sequence}`}
          </button>
        )}

        <h1 className="mobile-details-title">{book.title}</h1>
        {book.subtitle && <p className="mobile-details-subtitle">{book.subtitle}</p>}

        <button
          className="mobile-details-author-btn"
          onClick={() => navigate(`/?search=${encodeURIComponent(book.author.name)}`)}
        >
          {book.author.name}
        </button>

        {/* Progress bar */}
        {savedTime > 0 && book.duration > 0 && (
          <div className="mobile-details-progress">
            <div className="mobile-details-progress-bar">
              <div
                className="mobile-details-progress-fill"
                style={{ width: `${Math.min(100, (savedTime / book.duration) * 100)}%` }}
              />
            </div>
            <div className="mobile-details-progress-labels">
              <span>{Math.round((savedTime / book.duration) * 100)}% complete</span>
              <span>{formatDuration(Math.max(0, book.duration - savedTime))} left</span>
            </div>
          </div>
        )}

        {/* Merge progress */}
        {mergeProgress && (
          <div className="mobile-merge-progress">
            <div className="mobile-merge-progress-head">
              <span>{mergeProgress.stage}</span>
              <span>{mergeProgress.progress}%</span>
            </div>
            <div style={{ height: 4, background: 'var(--border-strong)', borderRadius: 2, overflow: 'hidden' }}>
              <div style={{ height: '100%', background: mergeProgress.status === 'failed' ? '#f87171' : 'var(--primary)', width: `${mergeProgress.progress}%` }} />
            </div>
            {mergeProgress.detail && (
              <p style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: 6 }}>{mergeProgress.detail}</p>
            )}
          </div>
        )}

        {/* Action buttons */}
        <div className="mobile-details-actions">
          <button className="mobile-details-play-btn" onClick={handlePlay}>
            {isCurrentPlaying ? (
              <><Pause size={20} fill="white" /> Pause</>
            ) : (
              <><Play size={20} fill="white" style={{ marginLeft: 2 }} />{savedTime > 0 ? 'Resume' : 'Play'}</>
            )}
          </button>
          <button
            className={`mobile-details-download-btn${isCached ? ' cached' : ''}`}
            onClick={handleDownload}
            disabled={downloading || isCached}
            title={isCached ? 'Available offline' : 'Download for offline'}
          >
            {downloading ? <Loader2 size={18} className="animate-spin" /> : isCached ? <CheckCircle2 size={18} /> : <Download size={18} />}
          </button>
        </div>

        {/* Details — collapsible */}
        <div className="mobile-details-section">
          <div
            className="mobile-details-track-header"
            onClick={() => setDetailsCollapsed(v => !v)}
          >
            <div className="mobile-details-section-title" style={{ marginBottom: 0 }}>Details</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              {detailsCollapsed ? <ChevronDown size={16} color="var(--text-muted)" /> : <ChevronUp size={16} color="var(--text-muted)" />}
            </div>
          </div>
          {!detailsCollapsed && (
            <div className="mobile-details-meta" style={{ marginTop: 12, marginBottom: 0 }}>
              {book.narrator && (
                <div className="mobile-details-meta-item">
                  <div className="mobile-details-meta-label">Narrator</div>
                  <div className="mobile-details-meta-value">{book.narrator}</div>
                </div>
              )}
              {book.year && (
                <div className="mobile-details-meta-item">
                  <div className="mobile-details-meta-label">Year</div>
                  <div className="mobile-details-meta-value">{book.year}</div>
                </div>
              )}
              {book.genres && (
                <div className="mobile-details-meta-item">
                  <div className="mobile-details-meta-label">Genre</div>
                  <div className="mobile-details-meta-value">{book.genres}</div>
                </div>
              )}
              <div className="mobile-details-meta-item">
                <div className="mobile-details-meta-label">Duration</div>
                <div className="mobile-details-meta-value">{formatDuration(book.duration)}</div>
              </div>
              {book.language && (
                <div className="mobile-details-meta-item">
                  <div className="mobile-details-meta-label">Language</div>
                  <div className="mobile-details-meta-value">{book.language.toUpperCase()}</div>
                </div>
              )}
              {book.publisher && (
                <div className="mobile-details-meta-item">
                  <div className="mobile-details-meta-label">Publisher</div>
                  <div className="mobile-details-meta-value">{book.publisher}</div>
                </div>
              )}
            </div>
          )}
        </div>

        {/* Description */}
        {descText && (
          <div className="mobile-details-section">
            <div className="mobile-details-section-title">About this book</div>
            <p className="mobile-details-desc">
              {descExpanded ? descText : descPreview}
              {!descExpanded && descText.length > 280 && '…'}
            </p>
            {descText.length > 280 && (
              <button className="mobile-details-desc-toggle" onClick={() => setDescExpanded(v => !v)}>
                {descExpanded ? 'Show less' : 'Read more'}
              </button>
            )}
          </div>
        )}

        {/* Chapters */}
        {book.chapters.length > 0 && (
          <div className="mobile-details-section">
            <div
              className="mobile-details-track-header"
              onClick={() => setChaptersCollapsed(v => !v)}
            >
              <div className="mobile-details-section-title" style={{ marginBottom: 0 }}>Chapters</div>
              <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                <span className="mobile-details-track-count">{book.chapters.length}</span>
                {chaptersCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
              </div>
            </div>
            {!chaptersCollapsed && (
              <div className="mobile-details-track-list" style={{ marginTop: 10 }}>
                {book.chapters.map(ch => (
                  <div key={ch.id} className="mobile-details-track-row" onClick={() => playBook(book, ch.start)}>
                    <Play size={12} fill="currentColor" color="var(--primary-light)" style={{ flexShrink: 0 }} />
                    <span className="mobile-details-track-name">{ch.title}</span>
                    <span className="mobile-details-track-duration">{formatDuration(ch.start)}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {/* Tracks */}
        <div className="mobile-details-section">
          <div
            className="mobile-details-track-header"
            onClick={() => setTracksCollapsed(v => !v)}
          >
            <div className="mobile-details-section-title" style={{ marginBottom: 0 }}>Tracks</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <span className="mobile-details-track-count">{book.audioFiles.length} files</span>
              {tracksCollapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
            </div>
          </div>
          {!tracksCollapsed && (
            <div className="mobile-details-track-list" style={{ marginTop: 10 }}>
              {book.audioFiles.map((file, idx) => (
                <div key={file.id} className="mobile-details-track-row" onClick={() => handlePlayTrack(idx)}>
                  <span className="mobile-details-track-num">{idx + 1}</span>
                  <span className="mobile-details-track-name">{file.title || file.filename}</span>
                  <span className="mobile-details-track-duration">{formatDuration(file.duration)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Admin tools bottom sheet */}
      {showToolsSheet && (
        <>
          <div className="mobile-filter-backdrop" onClick={() => setShowToolsSheet(false)} />
          <div className="mobile-tools-sheet">
            <div className="mobile-tools-sheet-handle">
              <div className="mobile-filter-sheet-handle-bar" />
            </div>
            <div className="mobile-tools-sheet-title">Book Tools</div>
            <button className="mobile-tools-sheet-item" onClick={() => { setMetadataInitialTab('edit'); setShowToolsSheet(false); setShowMetadataModal(true); }}>
              <Pencil size={18} color="var(--text-muted)" /> Edit Metadata
            </button>
            <button className="mobile-tools-sheet-item" onClick={() => { setMetadataInitialTab('fetch'); setShowToolsSheet(false); setShowMetadataModal(true); }}>
              <Search size={18} color="var(--text-muted)" /> Match Metadata
            </button>
            <button className="mobile-tools-sheet-item" onClick={() => { setShowToolsSheet(false); setConfirmAction('rescan'); }} disabled={merging}>
              <RefreshCw size={18} color="var(--text-muted)" className={merging ? 'animate-spin' : ''} /> Refresh Metadata
            </button>
            {canMergeM4B && (
              <button className="mobile-tools-sheet-item" onClick={() => { setShowToolsSheet(false); setConfirmAction('merge'); }} disabled={merging}>
                <Database size={18} color="var(--text-muted)" /> {book.audioFiles.length === 1 ? 'Convert to M4B' : 'Merge to M4B'}
              </button>
            )}
            {hasBackup && (
              <button className="mobile-tools-sheet-item" onClick={() => { setShowToolsSheet(false); setConfirmAction('undo'); }} disabled={merging}>
                <Undo size={18} color="var(--text-muted)" /> Undo Merge
              </button>
            )}
            {hasBackup && (
              <button className="mobile-tools-sheet-item" onClick={() => { setShowToolsSheet(false); setConfirmAction('cleanup'); }}>
                <Trash2 size={18} color="var(--text-muted)" /> Cleanup Backups
              </button>
            )}
            <div className="mobile-tools-sheet-divider" />
            <button className="mobile-tools-sheet-item danger" onClick={() => { setShowToolsSheet(false); setDeleteFiles(false); setConfirmAction('delete'); }}>
              <Trash2 size={18} /> Remove Title
            </button>
          </div>
        </>
      )}

      {showMetadataModal && (
        <BookMetadataModal
          book={book}
          onClose={() => setShowMetadataModal(false)}
          onApplied={() => fetchBookDetails()}
          initialTab={metadataInitialTab}
        />
      )}

      <ConfirmDialog
        open={confirmAction === 'rescan'}
        title="Refresh Metadata"
        message={`Rescan the folder for "${book.title}" and update the database. Progress is preserved.`}
        confirmLabel="Rescan"
        busy={merging}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleRescan()}
      />
      <ConfirmDialog
        open={confirmAction === 'merge'}
        title={book.audioFiles.length === 1 ? 'Convert to M4B' : 'Merge to M4B'}
        message={book.audioFiles.length === 1 ? 'Convert the audio file to a single .m4b. The original will be backed up.' : 'Merge all audio files into a single .m4b. Originals will be backed up.'}
        confirmLabel={book.audioFiles.length === 1 ? 'Convert' : 'Merge'}
        busy={merging}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleMergeToM4B()}
      />
      <ConfirmDialog
        open={confirmAction === 'undo'}
        title="Undo Merge"
        message="Restore the original files and delete the merged M4B."
        confirmLabel="Restore Files"
        tone="danger"
        busy={merging}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleUndoMerge()}
      />
      <ConfirmDialog
        open={confirmAction === 'cleanup'}
        title="Cleanup Backups"
        message="Permanently delete the .merged-backup folder. The merge cannot be undone after this."
        confirmLabel="Delete Backup"
        tone="danger"
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleCleanupBackup()}
      />
      {confirmAction === 'delete' && (
        <div className="modal-overlay">
          <div className="modal-content metadata-modal">
            <div className="modal-header">
              <h2 className="modal-title">Remove Title</h2>
              <button className="btn-close" onClick={() => setConfirmAction(null)}>×</button>
            </div>
            <div className="modal-body">
              <p className="mb-4">Remove <strong>{book.title}</strong> from your library?</p>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px', background: 'var(--surface)', borderRadius: 10, cursor: 'pointer' }}>
                <input type="checkbox" checked={deleteFiles} onChange={e => setDeleteFiles(e.target.checked)} />
                <div>
                  <div style={{ fontWeight: 600, color: '#f87171' }}>Also delete physical files</div>
                  <div style={{ fontSize: '0.78rem', color: 'var(--text-muted)' }}>Permanently removes audio files from disk.</div>
                </div>
              </label>
            </div>
            <div className="modal-footer">
              <button className="btn btn-secondary" onClick={() => setConfirmAction(null)}>Cancel</button>
              <button
                className={`btn ${deleteFiles ? 'btn-danger' : 'btn-primary'}`}
                disabled={isDeleting}
                onClick={() => void handleDeleteBook()}
              >
                {isDeleting ? 'Removing…' : deleteFiles ? 'Delete & Remove' : 'Remove'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

export default MobileBookDetails;
