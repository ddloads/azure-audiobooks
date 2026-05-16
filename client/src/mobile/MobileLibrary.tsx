import { useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate, useSearchParams } from 'react-router-dom';
import { BookOpen, Boxes, Check, Headphones, LayoutGrid, LayoutList, Loader2, Search, Sparkles, SlidersHorizontal, Square, X } from 'lucide-react';
import { io } from 'socket.io-client';
import api from '../api/axios';
import { getSocketBaseUrl } from '../api/backend';
import { useAuth } from '../context/AuthContext';
import { usePlayer } from '../context/PlayerContext';
import BookMetadataModal, { type MetadataBook } from '../components/BookMetadataModal';
import MobileFilterSheet, { type MobileFilterOptions, type MobileFilters } from './MobileFilterSheet';

interface Book extends MetadataBook {
  id: string;
  title: string;
  author: { name: string };
  coverPath?: string;
  duration: number;
  series?: { id?: string; name: string } | null;
  sequence?: number | null;
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
  seriesId: 'all',
  genre: '',
  narrator: '',
  yearFrom: '',
  listeningStatus: 'all',
  cover: 'all',
  sortBy: 'newest',
});

const getFiltersFromParams = (params: URLSearchParams): MobileFilters => {
  const base = emptyFilters();
  const keys = Object.keys(base) as Array<keyof MobileFilters>;
  keys.forEach((key) => {
    const value = params.get(key);
    if (value !== null) base[key] = value;
  });
  return base;
};

const emptyFilterOptions = (): MobileFilterOptions => ({
  libraries: [],
  authors: [],
  series: [],
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
  const [searchParams, setSearchParams] = useSearchParams();
  const { user } = useAuth();
  const { playBook } = usePlayer();

  const [books, setBooks] = useState<Book[]>([]);
  const [filterOptions, setFilterOptions] = useState<MobileFilterOptions>(emptyFilterOptions);
  const [progressRecords, setProgressRecords] = useState<ProgressRecord[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const [filters, setFilters] = useState<MobileFilters>(() => getFiltersFromParams(searchParams));
  const [search, setSearch] = useState(searchParams.get('search') || '');
  const [loading, setLoading] = useState(true);
  const [isFilterOpen, setIsFilterOpen] = useState(false);
  const [visibleCount, setVisibleCount] = useState(INITIAL_COUNT);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [viewMode, setViewMode] = useState<'grid' | 'list' | 'series'>(() =>
    (localStorage.getItem('mobile-view-mode') as 'grid' | 'list' | 'series') || 'grid'
  );
  const [isSelecting, setIsSelecting] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [matchBook, setMatchBook] = useState<MetadataBook | null>(null);
  const [matchQueue, setMatchQueue] = useState<MetadataBook[]>([]);
  const [matchQueueIndex, setMatchQueueIndex] = useState(0);
  const loadMoreRef = useRef<HTMLDivElement>(null);

  const setView = (mode: 'grid' | 'list' | 'series') => {
    setViewMode(mode);
    localStorage.setItem('mobile-view-mode', mode);
  };

  useEffect(() => {
    setFilters(getFiltersFromParams(searchParams));
    setSearch(searchParams.get('search') || '');
  }, [searchParams]);

  const activeFilterCount = useMemo(() => {
    let n = 0;
    if (filters.libraryId !== 'all') n++;
    if (filters.authorId !== 'all') n++;
    if (filters.seriesId !== 'all') n++;
    if (filters.genre) n++;
    if (filters.narrator) n++;
    if (filters.yearFrom) n++;
    if (filters.listeningStatus !== 'all') n++;
    if (filters.cover !== 'all') n++;
    return n;
  }, [filters]);

  const buildParams = () => ({
    search: search.trim() || undefined,
    sortBy: filters.sortBy,
    libraryId: filters.libraryId !== 'all' ? filters.libraryId : undefined,
    authorId: filters.authorId !== 'all' ? filters.authorId : undefined,
    seriesId: filters.seriesId !== 'all' ? filters.seriesId : undefined,
    genre: filters.genre || undefined,
    narrator: filters.narrator || undefined,
    yearFrom: filters.yearFrom || undefined,
    listeningStatus: filters.listeningStatus !== 'all' ? filters.listeningStatus : undefined,
    cover: filters.cover !== 'all' ? filters.cover : undefined,
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
        series: data.series ?? [],
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
      if (data.status === 'completed' || data.status === 'failed') {
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

  const handleContinuePlay = async (record: ProgressRecord) => {
    try {
      const res = await api.get(`/library/${record.bookId}`);
      playBook(res.data, record.currentTime);
    } catch {
      // ignore
    }
  };

  const updateFilter = (key: keyof MobileFilters, value: string) => {
    const next = new URLSearchParams(searchParams);
    if (search.trim()) next.set('search', search.trim());
    if (value && value !== emptyFilters()[key]) next.set(key, value);
    else next.delete(key);
    if (key === 'authorId') next.delete('authorName');
    if (key === 'seriesId') next.delete('seriesName');
    setSearchParams(next);
  };

  const clearFilters = () => {
    setSearchParams(new URLSearchParams());
  };

  const visibleBooks = books.slice(0, visibleCount);
  const selectedBooks = useMemo(
    () => books.filter((book) => selectedBookIds.has(book.id)),
    [books, selectedBookIds],
  );
  const seriesGroups = useMemo(() => {
    const groups = new Map<string, { id?: string; name: string; books: Book[] }>();
    books.forEach((book) => {
      if (!book.series?.name) return;
      const key = book.series.id ?? book.series.name;
      const current = groups.get(key) ?? { id: book.series.id, name: book.series.name, books: [] };
      current.books.push(book);
      groups.set(key, current);
    });
    return Array.from(groups.values())
      .map((group) => ({
        ...group,
        books: group.books
          .slice()
          .sort((a, b) => (a.sequence ?? Number.MAX_SAFE_INTEGER) - (b.sequence ?? Number.MAX_SAFE_INTEGER) || a.title.localeCompare(b.title)),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [books]);

  const openSeries = (series: { id?: string; name: string }) => {
    if (!series.id) return;
    const next = new URLSearchParams(searchParams);
    next.set('seriesId', series.id);
    next.set('seriesName', series.name);
    setSearchParams(next);
    setView('grid');
  };

  const toggleBookSelection = (bookId: string) => {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      if (next.has(bookId)) next.delete(bookId);
      else next.add(bookId);
      return next;
    });
  };

  const startSelection = () => {
    setIsSelecting(true);
  };

  const cancelSelection = () => {
    setIsSelecting(false);
    setSelectedBookIds(new Set());
    setMatchQueue([]);
    setMatchQueueIndex(0);
  };

  const startMetadataQueue = () => {
    if (selectedBooks.length === 0) return;
    setMatchQueue(selectedBooks);
    setMatchQueueIndex(0);
    setMatchBook(selectedBooks[0]);
  };

  const updateQueuedBook = (updatedBook?: MetadataBook) => {
    if (!updatedBook) return matchQueue;
    const nextQueue = matchQueue.map((book) =>
      book.id === updatedBook.id ? { ...book, ...updatedBook } : book,
    );
    setMatchQueue(nextQueue);
    return nextQueue;
  };

  const closeMetadataQueue = () => {
    setMatchBook(null);
    setMatchQueue([]);
    setMatchQueueIndex(0);
  };

  const advanceMetadataQueue = async (updatedBook?: MetadataBook) => {
    const nextQueue = updateQueuedBook(updatedBook);
    const nextIndex = matchQueueIndex + 1;
    if (nextQueue.length > 0 && nextIndex < nextQueue.length) {
      setMatchQueueIndex(nextIndex);
      setMatchBook(nextQueue[nextIndex]);
      setSelectedBookIds((current) => {
        const next = new Set(current);
        next.delete(nextQueue[matchQueueIndex].id);
        return next;
      });
      return;
    }

    cancelSelection();
    closeMetadataQueue();
    await Promise.all([fetchBooks(), fetchMeta()]);
  };

  const goToMetadataQueueIndex = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= matchQueue.length) return;
    setMatchQueueIndex(nextIndex);
    setMatchBook(matchQueue[nextIndex]);
  };

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
                {viewMode === 'series'
                  ? `${seriesGroups.length} series`
                  : `${books.length} ${books.length === 1 ? 'audiobook' : 'audiobooks'}`}
                {(search || activeFilterCount > 0) && ' found'}
              </span>
              <div className="mobile-grid-actions">
                {user?.role === 'ADMIN' && viewMode !== 'series' && (
                  <button
                    className={`mobile-select-toggle${isSelecting ? ' active' : ''}`}
                    onClick={isSelecting ? cancelSelection : startSelection}
                    type="button"
                  >
                    {isSelecting ? 'Cancel' : 'Select'}
                  </button>
                )}
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
                  <button
                    className={`mobile-view-toggle-btn${viewMode === 'series' ? ' active' : ''}`}
                    onClick={() => {
                      cancelSelection();
                      setView('series');
                    }}
                    aria-label="Series view"
                  >
                    <Boxes size={14} />
                  </button>
                </div>
              </div>
            </div>
            {viewMode === 'series' ? (
              <div className="mobile-series-list">
                {seriesGroups.map(series => (
                  <button
                    key={series.id ?? series.name}
                    className="mobile-series-card"
                    onClick={() => openSeries(series)}
                  >
                    <div className="mobile-series-covers">
                      {series.books.slice(0, 3).map(book => (
                        <div key={book.id} className="mobile-series-cover">
                          {book.coverPath
                            ? <img src={book.coverPath} alt="" loading="lazy" />
                            : <BookOpen size={18} color="var(--text-subtle)" />
                          }
                        </div>
                      ))}
                    </div>
                    <div className="mobile-series-info">
                      <div className="mobile-series-title">{series.name}</div>
                      <div className="mobile-series-count">{series.books.length} {series.books.length === 1 ? 'book' : 'books'}</div>
                      <div className="mobile-series-preview">
                        {series.books.slice(0, 2).map(book => book.title).join(' / ')}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            ) : viewMode === 'grid' ? (
              <div className="mobile-book-grid">
                {visibleBooks.map(book => {
                  const progress = progressMap.get(book.id);
                  const pct = (progress && book.duration > 0)
                    ? Math.min(100, Math.round((progress / book.duration) * 100))
                    : 0;
                  const isSelected = selectedBookIds.has(book.id);
                  return (
                    <div
                      key={book.id}
                      className={`mobile-book-card${isSelecting ? ' is-selecting' : ''}${isSelected ? ' is-selected' : ''}`}
                      onClick={() => isSelecting ? toggleBookSelection(book.id) : navigate(`/book/${book.id}`)}
                    >
                      {isSelecting && (
                        <div className="mobile-book-select-indicator">
                          {isSelected ? <Check size={14} /> : <Square size={14} />}
                        </div>
                      )}
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
                  const isSelected = selectedBookIds.has(book.id);
                  return (
                    <div
                      key={book.id}
                      className={`mobile-book-list-item${isSelecting ? ' is-selecting' : ''}${isSelected ? ' is-selected' : ''}`}
                      onClick={() => isSelecting ? toggleBookSelection(book.id) : navigate(`/book/${book.id}`)}
                    >
                      {isSelecting && (
                        <div className="mobile-book-list-check">
                          {isSelected ? <Check size={14} /> : <Square size={14} />}
                        </div>
                      )}
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
            {viewMode !== 'series' && visibleCount < books.length && (
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

      {isSelecting && (
        <div className="mobile-selection-bar">
          <div>
            <strong>{selectedBookIds.size}</strong>
            <span> selected</span>
          </div>
          <button className="btn btn-secondary" type="button" onClick={cancelSelection}>
            Clear
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={selectedBookIds.size === 0}
            onClick={startMetadataQueue}
          >
            <Sparkles size={15} />
            Match
          </button>
        </div>
      )}

      {matchBook && (
        <BookMetadataModal
          key={matchBook.id}
          book={matchBook}
          onClose={() => {
            closeMetadataQueue();
          }}
          onApplied={matchQueue.length > 0 ? advanceMetadataQueue : async () => {
            await Promise.all([fetchBooks(), fetchMeta()]);
          }}
          initialTab="fetch"
          closeAfterSave={matchQueue.length === 0}
          queuePosition={
            matchQueue.length > 0
              ? { current: matchQueueIndex + 1, total: matchQueue.length }
              : undefined
          }
          onQueuePrevious={() => goToMetadataQueueIndex(matchQueueIndex - 1)}
          onQueueNext={() => goToMetadataQueueIndex(matchQueueIndex + 1)}
        />
      )}
    </div>
  );
};

export default MobileLibrary;
