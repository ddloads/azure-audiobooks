import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { BookOpen, Headphones, LayoutGrid, LayoutList, Loader2, RefreshCw, Search, SlidersHorizontal, X } from 'lucide-react';
import { io } from 'socket.io-client';
import api from '../api/axios';
import { getSocketBaseUrl } from '../api/backend';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import { useToast } from '../context/ToastContext';
import MobileFilterSheet, { type MobileFilterOptions, type MobileFilters } from './MobileFilterSheet';

interface Book {
  id: string;
  title: string;
  author: { name: string };
  coverPath?: string;
  duration: number;
}

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

interface ScanProgress {
  status: 'starting' | 'scanning' | 'completed' | 'failed';
  progress: number;
  currentFolder?: string;
  scannedFolders?: number;
  totalFolders?: number;
}

const emptyFilters = (): MobileFilters => ({
  libraryId: 'all',
  authorId: 'all',
  genre: '',
  narrator: '',
  yearFrom: '',
  listeningStatus: 'all',
  sortBy: 'newest',
});

const emptyFilterOptions = (): MobileFilterOptions => ({
  libraries: [],
  authors: [],
  genres: [],
  narrators: [],
  years: [],
});

const formatTimeLeft = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
};

const INITIAL_COUNT = 40;
const CHUNK_SIZE = 40;

const MobileLibrary = () => {
  const navigate = useNavigate();
  const { user } = useAuth();
  const { playBook } = usePlayer();
  const { showToast } = useToast();

  const [books, setBooks] = useState<Book[]>([]);
  const [filterOptions, setFilterOptions] = useState<MobileFilterOptions>(emptyFilterOptions);
  const [progressRecords, setProgressRecords] = useState<ProgressRecord[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const [filters, setFilters] = useState<MobileFilters>(emptyFilters);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list'>(() =>
    (localStorage.getItem('mobile-view-mode') as 'grid' | 'list') || 'grid'
  );
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const setView = (mode: 'grid' | 'list') => {
    setViewMode(mode);
    localStorage.setItem('mobile-view-mode', mode);
  };

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.libraryId !== 'all') n++;
    if (filters.authorId !== 'all') n++;
    if (filters.genre) n++;
    if (filters.narrator) n++;
    if (filters.yearFrom) n++;
    if (filters.listeningStatus !== 'all') n++;
    return n;
  }, [filters]);

  const buildParams = () => ({
    search: search.trim() || undefined,
    sortBy: filters.sortBy,
    libraryId: filters.libraryId !== 'all' ? filters.libraryId : undefined,
    authorId: filters.authorId !== 'all' ? filters.authorId : undefined,
    genre: filters.genre || undefined,
    narrator: filters.narrator || undefined,
    yearFrom: filters.yearFrom || undefined,
    listeningStatus: filters.listeningStatus !== 'all' ? filters.listeningStatus : undefined,
  });

  const fetchBooks = async () => {
    setLoading(true);
    try {
      const res = await api.get('/library', { params: buildParams() });
      setBooks(res.data);
      setVisibleCount(INITIAL_COUNT);
    } catch {
      // server error — keep current state
    } finally {
      setLoading(false);
    }
  };

  const fetchMeta = async () => {
    try {
      const res = await api.get('/library/filters');
      const data = res.data;
      setFilterOptions({
        libraries: data.libraries ?? [],
        authors: data.authors ?? [],
        genres: data.genres ?? [],
        narrators: data.narrators ?? [],
        years: data.years ?? [],
      });
    } catch {
      // ignore
    }
  };

  const fetchProgress = async () => {
    try {
      const res = await api.get('/progress');
      const records: ProgressRecord[] = res.data;
      setProgressRecords(records);
      setProgressMap(new Map(records.map(r => [r.bookId, r.currentTime])));
    } catch {
      // ignore
    }
  };

  useEffect(() => {
    void fetchMeta();
    void fetchProgress();
  }, []);

  useEffect(() => {
    const id = setTimeout(() => { void fetchBooks(); }, search ? 300 : 0);
    return () => clearTimeout(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filters, search]);

  useEffect(() => {
    const socket = io(getSocketBaseUrl(), { withCredentials: true });
    socket.on('scanProgress', (data: ScanProgress) => {
      setScanProgress(data);
      if (data.status === 'scanning' || data.status === 'starting') {
        setIsScanning(true);
      } else if (data.status === 'completed' || data.status === 'failed') {
        setIsScanning(false);
        void fetchBooks();
        void fetchMeta();
        setTimeout(() => setScanProgress(null), 4000);
      }
    });
    return () => { socket.disconnect(); };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (visibleCount >= books.length) return;
    const node = loadMoreRef.current;
    if (!node) return;
    const obs = new IntersectionObserver(
      (entries) => { if (entries[0]?.isIntersecting) setVisibleCount(c => Math.min(c + CHUNK_SIZE, books.length)); },
      { rootMargin: '300px 0px' }
    );
    obs.observe(node);
    return () => obs.disconnect();
  }, [books.length, visibleCount]);

  const handleScan = async () => {
    setIsScanning(true);
    try {
      await api.post('/library/scan');
      showToast({ title: 'Scan started', description: 'Checking libraries for new content.', tone: 'info' });
    } catch {
      setIsScanning(false);
      showToast({ title: 'Scan failed', description: 'Check server logs.', tone: 'error' });
    }
  };

  const handleContinuePlay = async (record: ProgressRecord) => {
    try {
      const res = await api.get(`/library/${record.bookId}`);
      playBook(res.data, record.currentTime);
    } catch {
      // ignore
    }
  };

  const updateFilter = (key: keyof MobileFilters, value: string) => {
    setFilters(prev => ({ ...prev, [key]: value }));
  };

  const clearFilters = () => {
    setFilters(emptyFilters());
    setSearch('');
  };

  const visibleBooks = books.slice(0, visibleCount);

  return (
    <div className="mobile-library">
      {/* Sticky search + filter bar */}
      <div className="mobile-search-area">
        <div className="mobile-search-input-wrap">
          <Search size={15} className="mobile-search-icon" />
          <input
            type="search"
            className="mobile-search-input"
            placeholder="Search books, authors…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
          {search && (
            <button className="mobile-search-clear" onClick={() => setSearch('')} aria-label="Clear">
              <X size={14} />
            </button>
          )}
        </div>

        <button
          className={`mobile-filter-btn${activeFilterCount > 0 ? ' active' : ''}`}
          onClick={() => setIsFilterOpen(true)}
        >
          <SlidersHorizontal size={14} />
          {activeFilterCount > 0
            ? <span className="mobile-filter-badge">{activeFilterCount}</span>
            : <span>Filter</span>
          }
        </button>

        {user?.role === 'ADMIN' && (
          <button
            className="mobile-filter-btn"
            onClick={handleScan}
            disabled={isScanning}
            title={isScanning ? 'Scanning…' : 'Scan library'}
          >
            <RefreshCw size={14} className={isScanning ? 'animate-spin' : ''} />
          </button>
        )}
      </div>

      {/* Scan progress banner */}
      {scanProgress && (
        <div className="mobile-scan-banner">
          <div className="mobile-scan-info-row">
            <span>
              {scanProgress.status === 'starting' && 'Starting scan…'}
              {scanProgress.status === 'scanning' && `${scanProgress.scannedFolders ?? 0} / ${scanProgress.totalFolders ?? '?'} folders`}
              {scanProgress.status === 'completed' && 'Scan complete'}
              {scanProgress.status === 'failed' && 'Scan stopped'}
            </span>
            <span>{scanProgress.progress}%</span>
          </div>
          <div className="mobile-scan-bar">
            <div className="mobile-scan-bar-fill" style={{ width: `${scanProgress.progress}%` }} />
          </div>
        </div>
      )}

      <div className="mobile-library-body">
        {/* Continue Listening */}
        {progressRecords.length > 0 && (
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

        {/* Book grid */}
        {loading ? (
          <div className="mobile-book-grid">
            {Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="mobile-skeleton-card">
                <div className="mobile-skeleton-cover" />
                <div className="mobile-skeleton-meta">
                  <div className="mobile-skeleton-line" style={{ width: '80%' }} />
                  <div className="mobile-skeleton-line" style={{ width: '55%' }} />
                </div>
              </div>
            ))}
          </div>
        ) : books.length === 0 ? (
          <div className="mobile-empty">
            <div className="mobile-empty-icon"><BookOpen size={40} /></div>
            {search || activeFilterCount > 0 ? (
              <>
                <h3>No results</h3>
                <p>Try adjusting your search or filters.</p>
                <button className="btn btn-secondary" style={{ marginTop: 8 }} onClick={clearFilters}>
                  Clear filters
                </button>
              </>
            ) : (
              <>
                <h3>Library is empty</h3>
                <p>Add audiobooks to get started.</p>
              </>
            )}
          </div>
        ) : (
          <>
            <div className="mobile-grid-header">
              <span className="mobile-grid-count">
                {books.length} {books.length === 1 ? 'audiobook' : 'audiobooks'}
                {(search || activeFilterCount > 0) && ' found'}
              </span>
              <div className="mobile-view-toggle">
                <button
                  className={`mobile-view-toggle-btn${viewMode === 'grid' ? ' active' : ''}`}
                  onClick={() => setView('grid')}
                  aria-label="Grid view"
                >
                  <LayoutGrid size={14} />
                </button>
                <button
                  className={`mobile-view-toggle-btn${viewMode === 'list' ? ' active' : ''}`}
                  onClick={() => setView('list')}
                  aria-label="List view"
                >
                  <LayoutList size={14} />
                </button>
              </div>
            </div>
            {viewMode === 'grid' ? (
              <div className="mobile-book-grid">
                {visibleBooks.map(book => {
                  const progress = progressMap.get(book.id);
                  const pct = (progress && book.duration > 0)
                    ? Math.min(100, Math.round((progress / book.duration) * 100))
                    : 0;
                  return (
                    <div
                      key={book.id}
                      className="mobile-book-card"
                      onClick={() => navigate(`/book/${book.id}`)}
                    >
                      <div className="mobile-book-cover-wrap">
                        {book.coverPath
                          ? <img src={book.coverPath} alt={book.title} loading="lazy" />
                          : <div className="mobile-book-cover-placeholder"><BookOpen size={28} /></div>
                        }
                        {pct > 0 && (
                          <div className="mobile-book-progress-bar">
                            <div className="mobile-book-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>
                      <div className="mobile-book-meta">
                        <div className="mobile-book-title">{book.title}</div>
                        <div className="mobile-book-author">{book.author.name}</div>
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="mobile-book-list">
                {visibleBooks.map(book => {
                  const progress = progressMap.get(book.id);
                  const pct = (progress && book.duration > 0)
                    ? Math.min(100, Math.round((progress / book.duration) * 100))
                    : 0;
                  return (
                    <div
                      key={book.id}
                      className="mobile-book-list-item"
                      onClick={() => navigate(`/book/${book.id}`)}
                    >
                      <div className="mobile-book-list-cover">
                        {book.coverPath
                          ? <img src={book.coverPath} alt={book.title} loading="lazy" />
                          : <BookOpen size={22} color="var(--text-subtle)" />
                        }
                      </div>
                      <div className="mobile-book-list-info">
                        <div className="mobile-book-list-title">{book.title}</div>
                        <div className="mobile-book-list-author">{book.author.name}</div>
                        {pct > 0 && (
                          <div className="mobile-book-list-progress-bar">
                            <div className="mobile-book-list-progress-fill" style={{ width: `${pct}%` }} />
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
            {visibleCount < books.length && (
              <div ref={loadMoreRef} className="mobile-load-more">
                <Loader2 size={20} className="animate-spin" color="var(--text-subtle)" />
              </div>
            )}
          </>
        )}
      </div>

      {isFilterOpen && (
        <MobileFilterSheet
          filters={filters}
          filterOptions={filterOptions}
          onFilterChange={updateFilter}
          onClear={clearFilters}
          onClose={() => setIsFilterOpen(false)}
          activeFilterCount={activeFilterCount}
        />
      )}
    </div>
  );
};

export default MobileLibrary;
