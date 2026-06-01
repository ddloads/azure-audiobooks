import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { isAxiosError } from "axios";
import {
  BookMarked,
  LayoutList,
  ListPlus,
  Plus,
  RefreshCw,
  BookOpen,
  FileSearch,
  Loader2,
  Trash2,
  Save,
  Sparkles,
  SlidersHorizontal,
  X,
} from "lucide-react";
import { io } from "socket.io-client";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import api from "../api/axios";
import { getSocketBaseUrl } from "../api/backend";
import BookCard from "../components/BookCard";
import BookMetadataModal from "../components/BookMetadataModal";
import UploadModal from "../components/UploadModal";
import ConfirmDialog from "../components/ConfirmDialog";
import type { MetadataBook, MetadataProvider } from "../features/metadata/types";
import SearchBox from "../components/SearchBox";
import QuickMatchModal from "../features/quick-match/QuickMatchModal";
import {
  defaultQuickMatchFields,
  type QuickMatchBusyState,
  type QuickMatchFields,
  type QuickMatchMode,
  type QuickMatchResult,
} from "../features/quick-match/types";

interface LibraryBook extends MetadataBook {
  id: string;
  title: string;
  subtitle?: string | null;
  asin?: string | null;
  duration: number;
  coverPath?: string;
  folderPath?: string;
  library: { id: string; name: string };
  author: { name: string };
  series?: { id?: string; name: string } | null;
  sequence?: number | null;
  _count?: { audioFiles?: number };
}

type DesktopViewMode = "books" | "list" | "series";

const formatTimeLeft = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m left`;
  return `${m}m left`;
};

interface LibraryOption {
  id: string;
  name: string;
  description?: string;
  _count: {
    books: number;
    sources: number;
  };
}

interface FilterOption {
  id: string;
  name: string;
  _count?: { books: number };
}

interface FilterOptions {
  libraries: LibraryOption[];
  authors: FilterOption[];
  series: FilterOption[];
  narrators: string[];
  publishers: string[];
  languages: string[];
  years: string[];
  genres: string[];
  tags: string[];
  fileTypes: string[];
}

interface ScanProgress {
  libraryId?: string;
  status: "starting" | "scanning" | "completed" | "failed";
  progress: number;
  currentFolder?: string;
  totalFolders?: number;
  scannedFolders?: number;
}

type LibraryFilters = {
  libraryId: string;
  authorId: string;
  seriesId: string;
  narrator: string;
  publisher: string;
  language: string;
  genre: string;
  tag: string;
  yearFrom: string;
  yearTo: string;
  durationMinHours: string;
  durationMaxHours: string;
  cover: string;
  hasAsin: string;
  hasIsbn: string;
  abridged: string;
  fileType: string;
  audioStatus: string;
  listeningStatus: string;
  matchStatus: string;
  duplicates: string;
};

const emptyFilters = (): LibraryFilters => ({
  libraryId: "all",
  authorId: "all",
  seriesId: "all",
  narrator: "",
  publisher: "",
  language: "",
  genre: "",
  tag: "",
  yearFrom: "",
  yearTo: "",
  durationMinHours: "",
  durationMaxHours: "",
  cover: "all",
  hasAsin: "all",
  hasIsbn: "all",
  abridged: "all",
  fileType: "all",
  audioStatus: "all",
  listeningStatus: "all",
  matchStatus: "all",
  duplicates: "all",
});

const emptyFilterOptions = (): FilterOptions => ({
  libraries: [],
  authors: [],
  series: [],
  narrators: [],
  publishers: [],
  languages: [],
  years: [],
  genres: [],
  tags: [],
  fileTypes: [],
});

const getFiltersFromParams = (params: URLSearchParams): LibraryFilters => {
  const base = emptyFilters();
  const keys = Object.keys(base) as Array<keyof LibraryFilters>;
  keys.forEach((key) => {
    const val = params.get(key);
    if (val !== null) {
      base[key] = val;
    }
  });
  return base;
};

const LIBRARY_FILTER_STORAGE_KEY = "azure.library.filters.v1";
const PERSISTED_LIBRARY_PARAM_KEYS = [...Object.keys(emptyFilters()), "search", "sortBy"] as const;

const hasPersistedLibraryParams = (params: URLSearchParams) =>
  PERSISTED_LIBRARY_PARAM_KEYS.some((key) => params.has(key));

const loadPersistedLibraryParams = () => {
  try {
    const raw = window.localStorage.getItem(LIBRARY_FILTER_STORAGE_KEY);
    if (!raw) return null;

    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const params = new URLSearchParams();
    PERSISTED_LIBRARY_PARAM_KEYS.forEach((key) => {
      const value = parsed[key];
      if (typeof value === "string" && value.length > 0) {
        params.set(key, value);
      }
    });

    return hasPersistedLibraryParams(params) ? params : null;
  } catch {
    return null;
  }
};

const savePersistedLibraryParams = (params: URLSearchParams) => {
  const values: Record<string, string> = {};
  PERSISTED_LIBRARY_PARAM_KEYS.forEach((key) => {
    const value = params.get(key);
    if (value) values[key] = value;
  });

  if (Object.keys(values).length === 0) {
    window.localStorage.removeItem(LIBRARY_FILTER_STORAGE_KEY);
    return;
  }

  window.localStorage.setItem(LIBRARY_FILTER_STORAGE_KEY, JSON.stringify(values));
};

const clearPersistedLibraryParams = () => {
  window.localStorage.removeItem(LIBRARY_FILTER_STORAGE_KEY);
};

const getErrorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ error?: string }>(error) ? error.response?.data?.error || fallback : fallback;

type WriteTagsJob = {
  id: string;
  bookId: string;
  bookTitle?: string | null;
  status: "pending" | "running" | "completed" | "failed";
  totalFiles: number;
  processedFiles: number;
  currentFile: string | null;
  currentFileStartedAt: string | null;
  lastCompletedFile: string | null;
  lastCompletedAt: string | null;
  failures: Array<{ path: string; error: string }>;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  message: string | null;
  stallTimeoutMs: number;
};

const hasTag = (value: string | null | undefined, tag: string) =>
  (value ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .includes(tag);

const INITIAL_BOOK_RENDER_COUNT = 120;
const BOOK_FETCH_PAGE_SIZE = 100;
const BOOK_FETCH_CONCURRENCY = 6;
const BOOK_RENDER_CHUNK_SIZE = 80;

const SkeletonCard = () => (
  <div className="skeleton-card">
    <div className="skeleton skeleton-cover" />
    <div className="book-meta">
      <div className="skeleton skeleton-line" style={{ width: "80%" }} />
      <div className="skeleton skeleton-line" style={{ width: "55%", marginTop: "0.375rem" }} />
      <div className="skeleton skeleton-line" style={{ width: "40%", marginTop: "0.25rem" }} />
    </div>
  </div>
);

interface LibraryProps {
  defaultViewMode?: DesktopViewMode;
}

const Library = ({ defaultViewMode = "books" }: LibraryProps) => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const returnTo = `${location.pathname}${location.search}`;

  const filterAuthorId = searchParams.get("authorId") ?? undefined;
  const filterSeriesId = searchParams.get("seriesId") ?? undefined;
  const filterNarrator = searchParams.get("narrator") ?? undefined;
  const filterAuthorName = searchParams.get("authorName") ?? undefined;
  const filterSeriesName = searchParams.get("seriesName") ?? undefined;

  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(emptyFilterOptions);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const [filters, setFilters] = useState<LibraryFilters>(() => getFiltersFromParams(searchParams));
  const isFilterPanelOpen = searchParams.get("filterPanel") === "open";
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") || "newest");
  const hasRestoredPersistedFiltersRef = useRef(false);
  const skipNextPersistRef = useRef(false);

  useEffect(() => {
    setFilters(getFiltersFromParams(searchParams));
    setSearch(searchParams.get("search") || "");
    setSortBy(searchParams.get("sortBy") || "newest");
  }, [searchParams]);

  useEffect(() => {
    if (hasRestoredPersistedFiltersRef.current) return;
    hasRestoredPersistedFiltersRef.current = true;
    if (hasPersistedLibraryParams(searchParams)) return;

    const persistedParams = loadPersistedLibraryParams();
    if (persistedParams) {
      skipNextPersistRef.current = true;
      setSearchParams(persistedParams, { replace: true });
    }
  }, [searchParams, setSearchParams]);

  useEffect(() => {
    if (skipNextPersistRef.current) {
      skipNextPersistRef.current = false;
      return;
    }
    savePersistedLibraryParams(searchParams);
  }, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [matchBook, setMatchBook] = useState<MetadataBook | null>(null);
  const [actionBook, setActionBook] = useState<LibraryBook | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | "rescan" | "cleanup" | "merge-duplicates" | "delete">(null);
  const [duplicates, setDuplicates] = useState<LibraryBook[]>([]);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<string[]>([]);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [viewMode, setViewMode] = useState<DesktopViewMode>(defaultViewMode);
  const [seriesLayout, setSeriesLayout] = useState<"grid" | "list">("grid");

  const layoutMode: "grid" | "list" =
    viewMode === "series" ? seriesLayout : viewMode === "list" ? "list" : "grid";
  const setLayoutMode = (next: "grid" | "list") => {
    if (viewMode === "series") {
      setSeriesLayout(next);
    } else {
      setViewMode(next === "list" ? "list" : "books");
    }
  };

  // React Router reuses the same Library instance for /library and /series
  // (same component type at the same outlet slot), so useState's initial
  // value only takes effect on first mount. Sync viewMode when the route
  // hands us a new defaultViewMode.
  useEffect(() => {
    setViewMode(defaultViewMode);
  }, [defaultViewMode]);

  // Top bar opens the upload modal by setting ?upload=open; consume + clear.
  useEffect(() => {
    if (searchParams.get("upload") === "open") {
      setIsUploadModalOpen(true);
      const next = new URLSearchParams(searchParams);
      next.delete("upload");
      setSearchParams(next, { replace: true });
    }
  }, [searchParams, setSearchParams]);
  const [lastSelectedBookId, setLastSelectedBookId] = useState<string | null>(null);
  const [matchQueue, setMatchQueue] = useState<MetadataBook[]>([]);
  const [matchQueueIndex, setMatchQueueIndex] = useState(0);
  const [tagWriteProgress, setTagWriteProgress] = useState<{
    current: number;
    total: number;
    percent: number;
    label: string;
  } | null>(null);
  const [batchActionMessage, setBatchActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isQuickMatchOpen, setIsQuickMatchOpen] = useState(false);
  const [quickMatchProvider, setQuickMatchProvider] = useState<MetadataProvider>("audible");
  const [quickMatchMinConfidence, setQuickMatchMinConfidence] = useState("0.90");
  const [quickMatchFields, setQuickMatchFields] = useState<QuickMatchFields>(defaultQuickMatchFields);
  const [quickMatchResult, setQuickMatchResult] = useState<QuickMatchResult | null>(null);
  const [quickMatchBusy, setQuickMatchBusy] = useState<QuickMatchBusyState>(null);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [visibleBookCount, setVisibleBookCount] = useState(INITIAL_BOOK_RENDER_COUNT);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const writeTagsJobsRef = useRef<Map<string, WriteTagsJob>>(new Map());
  const writeTagsResolversRef = useRef<Map<string, (job: WriteTagsJob) => void>>(new Map());
  const activeBatchWriteRef = useRef<{
    jobId: string;
    bookId: string;
    index: number;
    total: number;
    title: string;
  } | null>(null);
  const { currentBook, stopPlayer } = usePlayer();

  const buildBookParams = () => ({
    libraryId: filters.libraryId !== "all" ? filters.libraryId : undefined,
    search: search.trim() || undefined,
    sortBy,
    authorId: filters.authorId !== "all" ? filters.authorId : undefined,
    seriesId: filters.seriesId !== "all" ? filters.seriesId : undefined,
    narrator: filters.narrator || undefined,
    publisher: filters.publisher || undefined,
    language: filters.language || undefined,
    genre: filters.genre || undefined,
    tag: filters.tag || undefined,
    yearFrom: filters.yearFrom || undefined,
    yearTo: filters.yearTo || undefined,
    durationMin: filters.durationMinHours ? Number(filters.durationMinHours) * 3600 : undefined,
    durationMax: filters.durationMaxHours ? Number(filters.durationMaxHours) * 3600 : undefined,
    cover: filters.cover !== "all" ? filters.cover : undefined,
    hasAsin: filters.hasAsin !== "all" ? filters.hasAsin : undefined,
    hasIsbn: filters.hasIsbn !== "all" ? filters.hasIsbn : undefined,
    abridged: filters.abridged !== "all" ? filters.abridged : undefined,
    fileType: filters.fileType !== "all" ? filters.fileType : undefined,
    audioStatus: filters.audioStatus !== "all" ? filters.audioStatus : undefined,
    listeningStatus: filters.listeningStatus !== "all" ? filters.listeningStatus : undefined,
    matchStatus: filters.matchStatus !== "all" ? filters.matchStatus : undefined,
    duplicatesOnly: filters.duplicates === "true" ? true : undefined,
  });

  const activeFilterCount = useMemo(() =>
    Object.entries(filters).filter(([key, value]) => {
      if (["libraryId", "authorId", "seriesId", "cover", "hasAsin", "hasIsbn", "abridged", "fileType", "audioStatus", "listeningStatus", "matchStatus", "duplicates"].includes(key)) {
        return value !== "all";
      }
      return value.trim().length > 0;
    }).length,
    [filters]
  );

  const updateFilter = (key: keyof LibraryFilters, value: string) => {
    const newParams = new URLSearchParams(searchParams);
    if (value === "all" || value === "") {
      newParams.delete(key);
    } else {
      newParams.set(key, value);
    }
    setSearchParams(newParams);
  };

  const clearFilters = () => {
    if (search) setSearch("");
    clearPersistedLibraryParams();
    setSearchParams({});
  };

  // Books endpoint is paginated server-side — large unpaginated responses
  // get truncated mid-stream by the proxy (~80KB limit). Fetch page 0 first
  // to show content immediately, then fetch remaining pages in parallel.
  const fetchAllBooksPaginated = async (
    isCancelled: () => boolean,
    onPartialUpdate?: (books: LibraryBook[]) => void,
  ): Promise<LibraryBook[]> => {
    const params = buildBookParams();

    // Fetch first page immediately so the UI shows content fast
    const firstRes = await api.get("/library", {
      params: { ...params, limit: BOOK_FETCH_PAGE_SIZE, page: 0 },
    });
    if (isCancelled()) return [];

    const firstData = firstRes.data;
    const firstResults: LibraryBook[] = Array.isArray(firstData) ? firstData : firstData.results;
    const total: number = Array.isArray(firstData) ? firstData.length : firstData.total;

    if (onPartialUpdate) onPartialUpdate(firstResults);
    if (firstResults.length >= total) return firstResults;

    // Compute remaining page indices
    const totalPages = Math.ceil(total / BOOK_FETCH_PAGE_SIZE);
    const remainingPages = Array.from({ length: totalPages - 1 }, (_, i) => i + 1);

    // Allocate slots so results can be merged in order regardless of arrival
    const pageSlots: LibraryBook[][] = new Array(totalPages - 1).fill(null);

    const fetchPage = async (page: number, slotIndex: number) => {
      if (isCancelled()) return;
      const res = await api.get("/library", {
        params: { ...params, limit: BOOK_FETCH_PAGE_SIZE, page },
      });
      pageSlots[slotIndex] = Array.isArray(res.data) ? res.data : res.data.results;
    };

    // Process in parallel batches
    for (let i = 0; i < remainingPages.length; i += BOOK_FETCH_CONCURRENCY) {
      if (isCancelled()) return [];
      const batch = remainingPages.slice(i, i + BOOK_FETCH_CONCURRENCY);
      await Promise.all(batch.map((page, j) => fetchPage(page, i + j)));
      if (!isCancelled() && onPartialUpdate) {
        const soFar = [firstResults, ...pageSlots.filter(Boolean)].flat();
        onPartialUpdate(soFar);
      }
    }

    if (isCancelled()) return [];
    return [firstResults, ...pageSlots].flat();
  };

  const fetchBooks = async () => {
    try {
      const all = await fetchAllBooksPaginated(() => false, (first) => setBooks(first));
      setBooks(all);
    } catch (error) {
      console.error("Failed to fetch books", error);
    } finally {
      setLoading(false);
    }
  };

  const fetchLibraries = async () => {
    try {
      const filtersRes = await api.get("/library/filters");
      setFilterOptions(filtersRes.data);
    } catch (error) {
      console.error("Failed to fetch libraries", error);
    }
  };

  const refreshLibraryData = async () => {
    await Promise.all([fetchBooks(), fetchLibraries()]);
  };

  const fetchProgress = async () => {
    try {
      const res = await api.get("/progress");
      setProgressMap(new Map((res.data as Array<{ bookId: string; currentTime: number }>).map((r) => [r.bookId, r.currentTime])));
    } catch (error) {
      console.error("Failed to fetch progress", error);
    }
  };

  const removeBookFromInProgressState = (bookId: string) => {
    setProgressMap((current) => {
      const next = new Map(current);
      next.delete(bookId);
      return next;
    });
  };

  const handleMarkBookFinished = async (book: Pick<LibraryBook, "id" | "title" | "duration">) => {
    try {
      await api.post(`/progress/${book.id}`, {
        currentTime: book.duration,
        isFinished: true,
      });
      removeBookFromInProgressState(book.id);
      showToast({
        title: "Marked as finished",
        description: `"${book.title}" was removed from Continue Listening.`,
        tone: "success",
      });
    } catch (error) {
      console.error("Failed to mark book as finished", error);
      showToast({
        title: "Update failed",
        description: getErrorMessage(error, "Could not update progress."),
        tone: "error",
      });
    }
  };

  const handleRemoveBookFromContinueListening = async (book: Pick<LibraryBook, "id" | "title">) => {
    try {
      await api.post(`/progress/${book.id}`, {
        currentTime: 0,
        isFinished: false,
      });
      removeBookFromInProgressState(book.id);
      showToast({
        title: "Removed from Continue Listening",
        description: `"${book.title}" is no longer on this shelf.`,
        tone: "success",
      });
    } catch (error) {
      console.error("Failed to remove book from continue listening", error);
      showToast({
        title: "Update failed",
        description: getErrorMessage(error, "Could not update progress."),
        tone: "error",
      });
    }
  };

  const handleScanProgress = (data: ScanProgress) => {
    setScanProgress(data);
    if (data.status === "completed" || data.status === "failed") {
      const visibleLibraryId = filters.libraryId !== "all" ? filters.libraryId : undefined;
      const shouldRefreshLibrary = !data.libraryId || !visibleLibraryId || data.libraryId === visibleLibraryId;

      if (shouldRefreshLibrary) {
        void fetchBooks();
        void fetchLibraries();
      }
      setTimeout(() => setScanProgress(null), 5000);
    }
  };

  const updateBatchWriteProgress = (context: { index: number; total: number; title: string }, job: WriteTagsJob) => {
    const filePercent = job.totalFiles > 0 ? job.processedFiles / job.totalFiles : 0;
    const overallPercent = ((context.index + filePercent) / context.total) * 100;
    setTagWriteProgress({
      current: context.index + 1,
      total: context.total,
      percent: overallPercent,
      label:
        job.currentFile?.split(/[/\\]/).pop() ||
        job.message ||
        `Writing tags for ${context.title}`,
    });
  };

  const handleWriteTagsProgress = (job: WriteTagsJob) => {
    writeTagsJobsRef.current.set(job.id, job);

    const activeBatchWrite = activeBatchWriteRef.current;
    if (activeBatchWrite?.jobId === job.id) {
      updateBatchWriteProgress(activeBatchWrite, job);
    }

    if (job.status === "completed" || job.status === "failed") {
      const resolve = writeTagsResolversRef.current.get(job.id);
      if (resolve) {
        writeTagsResolversRef.current.delete(job.id);
        resolve(job);
      }
    }
  };

  const waitForWriteTagsJobCompletion = (jobId: string) => {
    const existing = writeTagsJobsRef.current.get(jobId);
    if (existing && (existing.status === "completed" || existing.status === "failed")) {
      return Promise.resolve(existing);
    }

    return new Promise<WriteTagsJob>((resolve) => {
      writeTagsResolversRef.current.set(jobId, resolve);
    });
  };

  useEffect(() => {
    void fetchProgress();
  }, []);

  useEffect(() => {
    void fetchLibraries();
  }, []);

  useEffect(() => {
    const socket = io(getSocketBaseUrl(), {
      withCredentials: true,
    });

    socket.on("scanProgress", handleScanProgress);
    socket.on("writeTagsProgress", handleWriteTagsProgress);

    return () => {
      socket.off("scanProgress", handleScanProgress);
      socket.off("writeTagsProgress", handleWriteTagsProgress);
      socket.disconnect();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const timeout = setTimeout(async () => {
      try {
        const all = await fetchAllBooksPaginated(
          () => cancelled,
          (first) => {
            if (!cancelled) setBooks(first);
          },
        );
        if (cancelled) return;
        setBooks(all);
      } catch (error) {
        console.error("Failed to fetch books", error);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }, search ? 300 : 0);

    return () => {
      cancelled = true;
      clearTimeout(timeout);
    };
  }, [filters, search, sortBy]);

  const handleRescan = async () => {
    if (!actionBook) return;
    setIsActionBusy(true);
    try {
      await api.post(`/admin/books/${actionBook.id}/rescan`);
      showToast({
        title: "Rescan complete",
        description: `Folder for "${actionBook.title}" rescanned.`,
        tone: "success",
      });
      setConfirmAction(null);
      await fetchBooks();
    } catch (error) {
      console.error("Rescan failed", error);
      showToast({ title: "Rescan failed", description: "Check server logs.", tone: "error" });
    } finally {
      setIsActionBusy(false);
    }
  };

  const handleFindDuplicates = async (book: LibraryBook) => {
    setIsActionBusy(true);
    setActionBook(book);
    try {
      const res = await api.get<LibraryBook[]>(`/admin/books/${book.id}/duplicates`);
      setDuplicates(res.data);
      if (res.data.length > 0) {
        setConfirmAction("merge-duplicates");
      } else {
        showToast({
          title: "No duplicates found",
          description: `No matching titles were found for "${book.title}".`,
          tone: "info",
        });
      }
    } catch (error) {
      console.error("Duplicate search failed", error);
      showToast({ title: "Search failed", description: "Check server logs.", tone: "error" });
    } finally {
      setIsActionBusy(false);
    }
  };

  const handleAutoChapterize = async (book: LibraryBook) => {
    try {
      const res = await api.post<{ message?: string; created?: number }>(
        `/admin/books/${book.id}/auto-chapterize`,
        { replaceExisting: true },
      );
      showToast({
        title: "Chapters generated",
        description: res.data.message || `Updated chapters for "${book.title}".`,
        tone: "success",
      });
    } catch (error) {
      console.error("Auto chapterize failed", error);
      showToast({
        title: "Chapterization failed",
        description: getErrorMessage(error, "Could not generate chapters for this book."),
        tone: "error",
      });
    }
  };

  const handleMergeDuplicates = async () => {
    if (!actionBook || selectedDuplicateIds.length === 0) return;
    setIsActionBusy(true);
    try {
      await api.post(`/admin/books/${actionBook.id}/merge-with`, {
        secondaryIds: selectedDuplicateIds,
      });
      showToast({
        title: "Books merged",
        description: "Selected duplicates merged into primary record.",
        tone: "success",
      });
      setConfirmAction(null);
      setSelectedDuplicateIds([]);
      await fetchBooks();
    } catch (error) {
      console.error("Merge failed", error);
      showToast({ title: "Merge failed", description: "Check server logs.", tone: "error" });
    } finally {
      setIsActionBusy(false);
    }
  };

  const handleDeleteBook = async () => {
    if (!actionBook) return;
    setIsActionBusy(true);
    try {
      if (deleteFiles && currentBook?.id === actionBook.id) {
        stopPlayer();
      }
      await api.delete(`/admin/books/${actionBook.id}`, { data: { deleteFiles } });
      showToast({
        title: "Title removed",
        description: deleteFiles ? "Book and files deleted." : "Book removed from library.",
        tone: "success",
      });
      setConfirmAction(null);
      await fetchBooks();
    } catch (error) {
      console.error("Delete failed", error);
      const message = isAxiosError<{ error?: string }>(error)
        ? error.response?.data?.error || "Could not remove the title."
        : "Could not remove the title.";
      showToast({ title: "Delete failed", description: message, tone: "error", durationMs: 7000 });
    } finally {
      setIsActionBusy(false);
    }
  };

  const handleStopScan = async () => {
    try {
      await api.post("/library/scan/stop");
    } catch (error) {
      console.error("Failed to stop scan", error);
    }
  };

  const bookIdToIndex = useMemo(
    () => new Map(books.map((book, index) => [book.id, index])),
    [books],
  );
  const bookById = useMemo(
    () => new Map(books.map((book) => [book.id, book])),
    [books],
  );
  const selectedBooks = useMemo(
    () => Array.from(selectedBookIds)
      .map((id) => bookById.get(id))
      .filter((book): book is LibraryBook => Boolean(book)),
    [selectedBookIds, bookById]
  );
  const quickMatchEligibleBooks = useMemo(
    () => selectedBooks.filter((book) => !hasTag(book.tags, "matched") && !hasTag(book.tags, "quick-matched")),
    [selectedBooks],
  );
  const visibleBooks = useMemo(
    () => books.slice(0, visibleBookCount),
    [books, visibleBookCount],
  );
  const seriesGroups = useMemo(() => {
    const groups = new Map<string, { id?: string; name: string; books: LibraryBook[] }>();
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
    const newParams = new URLSearchParams(searchParams);
    newParams.set("seriesId", series.id);
    newParams.set("seriesName", series.name);
    navigate({ pathname: "/library", search: newParams.toString() });
    setViewMode("books");
  };

  useEffect(() => {
    setVisibleBookCount(INITIAL_BOOK_RENDER_COUNT);
  }, [books]);

  useEffect(() => {
    if (visibleBookCount >= books.length) return;
    const node = loadMoreRef.current;
    if (!node) return;

    const observer = new IntersectionObserver(
      (entries) => {
        if (!entries[0]?.isIntersecting) return;
        setVisibleBookCount((current) => Math.min(current + BOOK_RENDER_CHUNK_SIZE, books.length));
      },
      { rootMargin: "400px 0px" },
    );

    observer.observe(node);
    return () => observer.disconnect();
  }, [books.length, visibleBookCount]);

  const updateBookSelection = (bookId: string, selected: boolean, shiftKey: boolean) => {
    setSelectedBookIds((current) => {
      const next = new Set(current);
      const anchorIndex = lastSelectedBookId ? (bookIdToIndex.get(lastSelectedBookId) ?? -1) : -1;
      const targetIndex = bookIdToIndex.get(bookId) ?? -1;

      if (selected && shiftKey && anchorIndex >= 0 && targetIndex >= 0) {
        const start = Math.min(anchorIndex, targetIndex);
        const end = Math.max(anchorIndex, targetIndex);
        books.slice(start, end + 1).forEach((book) => next.add(book.id));
      } else if (selected) {
        next.add(bookId);
      } else {
        next.delete(bookId);
      }
      return next;
    });
    setLastSelectedBookId(bookId);
  };

  const startMetadataQueue = () => {
    const queue = selectedBooks;
    if (queue.length === 0) return;

    setMatchQueue(queue);
    setMatchQueueIndex(0);
    setMatchBook(queue[0]);
  };

  const closeMetadataQueue = () => {
    setMatchBook(null);
    setMatchQueue([]);
    setMatchQueueIndex(0);
  };

  const updateQueuedBook = (updatedBook?: MetadataBook) => {
    if (!updatedBook) return matchQueue;

    const nextQueue = matchQueue.map((queuedBook) =>
      queuedBook.id === updatedBook.id ? { ...queuedBook, ...updatedBook } : queuedBook,
    );
    setMatchQueue(nextQueue);
    return nextQueue;
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

    setSelectedBookIds(new Set());
    setLastSelectedBookId(null);
    closeMetadataQueue();
    await refreshLibraryData();
  };

  const goToMetadataQueueIndex = (nextIndex: number) => {
    if (nextIndex < 0 || nextIndex >= matchQueue.length) return;

    setMatchQueueIndex(nextIndex);
    setMatchBook(matchQueue[nextIndex]);
  };

  const clearBatchSelection = () => {
    setSelectedBookIds(new Set());
    setLastSelectedBookId(null);
  };

  const runQuickMatch = async (mode: QuickMatchMode) => {
    const queue = quickMatchEligibleBooks;
    if (queue.length === 0) {
      setQuickMatchResult({
        mode,
        provider: quickMatchProvider,
        minConfidence: Number(quickMatchMinConfidence) || 0.9,
        ready: [],
        applied: [],
        skippedAlreadyMatched: selectedBooks.map((book) => ({ bookId: book.id, title: book.title, tags: book.tags ?? null })),
        needsReview: [],
        noResult: [],
        failed: [],
      });
      return;
    }

    setQuickMatchBusy(mode);
    setBatchActionMessage(null);
    try {
      const threshold = Number(quickMatchMinConfidence);
      const response = await api.post<QuickMatchResult>("/admin/books/quick-match", {
        bookIds: selectedBooks.map((book) => book.id),
        provider: quickMatchProvider,
        mode,
        minConfidence: Number.isFinite(threshold) ? threshold : 0.9,
        selectedFields: quickMatchFields,
      });
      setQuickMatchResult(response.data);

      if (mode === "apply") {
        await refreshLibraryData();
        setBatchActionMessage({
          type: "success",
          text: `Quick matched ${response.data.applied.length} title${response.data.applied.length === 1 ? "" : "s"}`,
        });
      }
    } catch (error) {
      setBatchActionMessage({
        type: "error",
        text: getErrorMessage(error, "Quick match failed"),
      });
    } finally {
      setQuickMatchBusy(null);
    }
  };

  const writeSelectedMetadataTags = async () => {
    const queue = selectedBooks;
    if (queue.length === 0) return;

    setTagWriteProgress({ current: 0, total: queue.length, percent: 0, label: "Preparing tag write…" });
    setBatchActionMessage(null);
    try {
      for (let index = 0; index < queue.length; index += 1) {
        const startResponse = await api.post<WriteTagsJob>(`/admin/books/${queue[index].id}/write-tags`);
        let currentJob = startResponse.data;
        writeTagsJobsRef.current.set(currentJob.id, currentJob);
        activeBatchWriteRef.current = {
          jobId: currentJob.id,
          bookId: queue[index].id,
          index,
          total: queue.length,
          title: queue[index].title,
        };
        updateBatchWriteProgress(activeBatchWriteRef.current, currentJob);

        if (currentJob.status === "pending" || currentJob.status === "running") {
          currentJob = await waitForWriteTagsJobCompletion(currentJob.id);
        }

        if (currentJob.status === "failed") {
          throw new Error(currentJob.message || "Failed to write metadata tags");
        }

        setTagWriteProgress({
          current: index + 1,
          total: queue.length,
          percent: ((index + 1) / queue.length) * 100,
          label: currentJob.message || `Finished ${queue[index].title}`,
        });
      }
      setBatchActionMessage({ type: "success", text: `Wrote tags for ${queue.length} title${queue.length === 1 ? "" : "s"}` });
    } catch (error) {
      console.error("Failed to write metadata tags", error);
      setBatchActionMessage({
        type: "error",
        text: getErrorMessage(error, "Failed to write metadata tags"),
      });
    } finally {
      activeBatchWriteRef.current = null;
      setTagWriteProgress(null);
    }
  };

  const batchActions = selectedBooks.length > 0 && (
    <>
      <span className="library-selected-count">
        {tagWriteProgress
          ? `Writing ${tagWriteProgress.current}/${tagWriteProgress.total}`
          : `${selectedBooks.length} selected`}
      </span>
      {tagWriteProgress && (
        <div className="library-batch-progress">
          <div className="progress-bar-container">
            <div className="progress-bar-fill" style={{ width: `${tagWriteProgress.percent}%` }} />
          </div>
          <span className="library-batch-progress-label">{tagWriteProgress.label}</span>
        </div>
      )}
      {batchActionMessage && (
        <span className={`library-batch-message ${batchActionMessage.type}`}>
          {batchActionMessage.text}
        </span>
      )}
      <button
        className="btn btn-primary"
        type="button"
        onClick={startMetadataQueue}
        disabled={Boolean(tagWriteProgress) || Boolean(quickMatchBusy)}
      >
        <Sparkles size={15} />
        Match
      </button>
      <button
        className="btn btn-secondary"
        type="button"
        onClick={() => {
          setQuickMatchResult(null);
          setIsQuickMatchOpen(true);
        }}
        disabled={Boolean(tagWriteProgress) || Boolean(quickMatchBusy)}
      >
        <Sparkles size={15} />
        Quick Match
      </button>
      <button
        className="btn btn-secondary"
        type="button"
        onClick={writeSelectedMetadataTags}
        disabled={Boolean(tagWriteProgress) || Boolean(quickMatchBusy)}
        aria-busy={Boolean(tagWriteProgress)}
      >
        {tagWriteProgress ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        {tagWriteProgress ? "Writing Tags..." : "Write Tags"}
      </button>
      <button
        className="btn btn-secondary"
        type="button"
        onClick={clearBatchSelection}
        disabled={Boolean(tagWriteProgress) || Boolean(quickMatchBusy)}
      >
        <X size={15} />
        Clear
      </button>
    </>
  );

  return (
    <>
    <div className="container library-page">
      {/* Mobile-only search/filter/sort toolbar — TopBar is hidden on mobile */}
      <div className="library-mobile-toolbar">
        <SearchBox
          value={search}
          onChange={(value) => {
            const next = new URLSearchParams(searchParams);
            if (value) next.set("search", value);
            else next.delete("search");
            setSearchParams(next, { replace: true });
          }}
        />
        <button
          type="button"
          className={`btn btn-secondary filter-toggle-btn${isFilterPanelOpen || activeFilterCount > 0 ? " active" : ""}`}
          onClick={() => {
            const next = new URLSearchParams(searchParams);
            if (isFilterPanelOpen) next.delete("filterPanel");
            else next.set("filterPanel", "open");
            setSearchParams(next, { replace: true });
          }}
          title="Filters"
        >
          <SlidersHorizontal size={15} />
          {activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
        </button>
        <div className="select-wrap">
          <select
            className="form-control"
            value={sortBy}
            onChange={(e) => {
              const next = new URLSearchParams(searchParams);
              next.set("sortBy", e.target.value);
              setSearchParams(next);
            }}
            aria-label="Sort order"
          >
            <option value="newest">Newest</option>
            <option value="oldest">Oldest</option>
            <option value="title_asc">A–Z</option>
            <option value="title_desc">Z–A</option>
            <option value="author_asc">Author A–Z</option>
            <option value="author_desc">Author Z–A</option>
            <option value="duration_asc">Shortest</option>
            <option value="duration_desc">Longest</option>
            <option value="year_desc">Year ↓</option>
            <option value="year_asc">Year ↑</option>
          </select>
        </div>
      </div>

      <div className={`library-filter-panel-wrapper${isFilterPanelOpen ? " open" : ""}`}>
        <section className="library-filter-panel">
          <div className="library-filter-panel-head">
            <div>
              <h2>Filters</h2>
              <p>Refine the full catalog by metadata, listening status, and file details.</p>
            </div>
            {activeFilterCount > 0 && (
              <button className="library-filter-clear" type="button" onClick={clearFilters}>
                <X size={14} />
                Clear all
              </button>
            )}
          </div>

          <div className="library-filter-grid">
            <label className="filter-field">
              <span>Library</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.libraryId} onChange={(e) => updateFilter("libraryId", e.target.value)}>
                  <option value="all">Any library</option>
                  {filterOptions.libraries.map((library) => (
                    <option key={library.id} value={library.id}>
                      {library.name} ({library._count.books})
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Author</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.authorId} onChange={(e) => updateFilter("authorId", e.target.value)}>
                  <option value="all">Any author</option>
                  {filterOptions.authors.map((author) => (
                    <option key={author.id} value={author.id}>
                      {author.name} ({author._count?.books ?? 0})
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Series</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.seriesId} onChange={(e) => updateFilter("seriesId", e.target.value)}>
                  <option value="all">Any series</option>
                  {filterOptions.series.map((series) => (
                    <option key={series.id} value={series.id}>
                      {series.name} ({series._count?.books ?? 0})
                    </option>
                  ))}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Narrator</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.narrator} onChange={(e) => updateFilter("narrator", e.target.value)}>
                  <option value="">Any narrator</option>
                  {filterOptions.narrators.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Publisher</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.publisher} onChange={(e) => updateFilter("publisher", e.target.value)}>
                  <option value="">Any publisher</option>
                  {filterOptions.publishers.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Language</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.language} onChange={(e) => updateFilter("language", e.target.value)}>
                  <option value="">Any language</option>
                  {filterOptions.languages.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Genre</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.genre} onChange={(e) => updateFilter("genre", e.target.value)}>
                  <option value="">Any genre</option>
                  {filterOptions.genres.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Tag</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.tag} onChange={(e) => updateFilter("tag", e.target.value)}>
                  <option value="">Any tag</option>
                  {filterOptions.tags.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Year from</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.yearFrom} onChange={(e) => updateFilter("yearFrom", e.target.value)}>
                  <option value="">Any</option>
                  {filterOptions.years.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Year to</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.yearTo} onChange={(e) => updateFilter("yearTo", e.target.value)}>
                  <option value="">Any</option>
                  {filterOptions.years.map((v) => <option key={v} value={v}>{v}</option>)}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Min hours</span>
              <input className="form-control" type="number" min="0" step="0.25" value={filters.durationMinHours} onChange={(e) => updateFilter("durationMinHours", e.target.value)} placeholder="Any" />
            </label>

            <label className="filter-field">
              <span>Max hours</span>
              <input className="form-control" type="number" min="0" step="0.25" value={filters.durationMaxHours} onChange={(e) => updateFilter("durationMaxHours", e.target.value)} placeholder="Any" />
            </label>

            <label className="filter-field">
              <span>Cover art</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.cover} onChange={(e) => updateFilter("cover", e.target.value)}>
                  <option value="all">Any</option>
                  <option value="with">Has cover</option>
                  <option value="missing">Missing cover</option>
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>ASIN</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.hasAsin} onChange={(e) => updateFilter("hasAsin", e.target.value)}>
                  <option value="all">Any</option>
                  <option value="true">Has ASIN</option>
                  <option value="false">Missing ASIN</option>
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>ISBN</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.hasIsbn} onChange={(e) => updateFilter("hasIsbn", e.target.value)}>
                  <option value="all">Any</option>
                  <option value="true">Has ISBN</option>
                  <option value="false">Missing ISBN</option>
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Edition</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.abridged} onChange={(e) => updateFilter("abridged", e.target.value)}>
                  <option value="all">Any</option>
                  <option value="false">Unabridged</option>
                  <option value="true">Abridged</option>
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>File type</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.fileType} onChange={(e) => updateFilter("fileType", e.target.value)}>
                  <option value="all">Any type</option>
                  {filterOptions.fileTypes.map((type) => (
                    <option key={type} value={type}>{type.toUpperCase().replace(".", "")}</option>
                  ))}
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Audio check</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.audioStatus} onChange={(e) => updateFilter("audioStatus", e.target.value)}>
                  <option value="all">Any</option>
                  <option value="silent">Has silent files</option>
                  <option value="clean">All files passed</option>
                </select>
              </div>
            </label>

            <label className="filter-field">
              <span>Listening status</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.listeningStatus} onChange={(e) => updateFilter("listeningStatus", e.target.value)}>
                  <option value="all">Any status</option>
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="finished">Finished</option>
                </select>
              </div>
            </label>
            <label className="filter-field">
              <span>Match status</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.matchStatus} onChange={(e) => updateFilter("matchStatus", e.target.value)}>
                  <option value="all">Any match status</option>
                  <option value="matched">Matched</option>
                  <option value="unmatched">Unmatched</option>
                  <option value="quick-matched">Quick matched</option>
                </select>
              </div>
            </label>
            <label className="filter-field">
              <span>Potential duplicates</span>
              <div className="select-wrap">
                <select className="form-control" value={filters.duplicates} onChange={(e) => updateFilter("duplicates", e.target.value)}>
                  <option value="all">Any</option>
                  <option value="true">Show duplicates only</option>
                </select>
              </div>
            </label>
          </div>

        </section>
      </div>

      {(filterAuthorId || filterSeriesId || filterNarrator || search || activeFilterCount > 0) && (
        <div className="library-filter-banner">
          <div className="library-filter-banner-label">
            {filterAuthorId && (
              <>Books by <strong>{filterAuthorName}</strong></>
            )}
            {filterSeriesId && (
              <>Series: <strong>{filterSeriesName}</strong></>
            )}
            {filterNarrator && (
              <>Narrated by <strong>{filterNarrator}</strong></>
            )}
            {search && !filterAuthorId && !filterSeriesId && !filterNarrator && (
              <>Search results for <strong>"{search}"</strong></>
            )}
            {activeFilterCount > 0 && !filterAuthorId && !filterSeriesId && !filterNarrator && !search && (
              <><strong>{activeFilterCount}</strong> active {activeFilterCount === 1 ? "filter" : "filters"}</>
            )}
          </div>
          <button className="library-filter-clear" onClick={clearFilters}>
            <X size={14} />
            Clear filter
          </button>
        </div>
      )}

      {scanProgress && (
        <div className="scan-progress-banner">
          <div className="scan-progress-info">
            <span className="scan-progress-status">
              {scanProgress.status === "starting" && "Starting scan..."}
              {scanProgress.status === "scanning" && (
                <>
                  Scanning: <span className="folder-name">{scanProgress.currentFolder}</span>
                  <span className="count">({scanProgress.scannedFolders}/{scanProgress.totalFolders})</span>
                </>
              )}
              {scanProgress.status === "completed" && "Scan complete!"}
              {scanProgress.status === "failed" && "Scan stopped."}
            </span>
            <div className="scan-progress-right">
              <span className="scan-progress-percentage">{scanProgress.progress}%</span>
              {(scanProgress.status === "scanning" || scanProgress.status === "starting") && (
                <button className="btn-stop-scan" onClick={handleStopScan} title="Stop scan">
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
          <div className="progress-bar-container">
            <div 
              className="progress-bar-fill" 
              style={{ width: `${scanProgress.progress}%` }} 
            />
          </div>
        </div>
      )}

      {loading ? (
        <div className="library-grid">
          {Array.from({ length: 12 }).map((_, i) => (
            <SkeletonCard key={i} />
          ))}
        </div>
      ) : books.length === 0 ? (
        <div className="library-empty">
          <div className="library-empty-icon">
            <BookOpen size={28} />
          </div>
          {search ? (
            <>
              <h3>No results for "{search}"</h3>
              <p>Try a different title, author, or series name.</p>
              <button className="btn btn-secondary" onClick={() => setSearch("")}>
                Clear search
              </button>
            </>
          ) : (
            <>
              <h3>Your library is empty</h3>
              <p>Upload your first audiobook to get started.</p>
              {user?.role === "ADMIN" && (
                <button
                  onClick={() => setIsUploadModalOpen(true)}
                  className="btn btn-primary"
                >
                  <Plus size={15} />
                  Upload your first book
                </button>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          <div className="library-grid-header">
            <span className="library-grid-count">
              {viewMode === "series"
                ? `${seriesGroups.length} ${seriesGroups.length === 1 ? "series" : "series"}`
                : `${books.length} ${books.length === 1 ? "audiobook" : "audiobooks"}`}
              {search && <span className="library-grid-filter-note"> matching "{search}"</span>}
            </span>
            <div className="library-view-actions">
              <div className="library-view-toggle" aria-label="View layout">
                <button
                  className={`library-view-toggle-btn${layoutMode === "grid" ? " active" : ""}`}
                  type="button"
                  onClick={() => setLayoutMode("grid")}
                >
                  <BookMarked size={15} />
                  Grid
                </button>
                <button
                  className={`library-view-toggle-btn${layoutMode === "list" ? " active" : ""}`}
                  type="button"
                  onClick={() => setLayoutMode("list")}
                >
                  <LayoutList size={15} />
                  List
                </button>
              </div>
              {user?.role === "ADMIN" && selectedBooks.length > 0 && (
                <div className="library-batch-actions">
                  {batchActions}
                </div>
              )}
            </div>
          </div>
          {viewMode === "series" ? (
            seriesLayout === "list" ? (
              <div className="series-list-view">
                {seriesGroups.map((series) => {
                  const firstCover = series.books.find((b) => b.coverPath)?.coverPath;
                  return (
                    <button
                      key={series.id ?? series.name}
                      className="series-list-row"
                      type="button"
                      onClick={() => openSeries(series)}
                    >
                      <div className="series-list-cover">
                        {firstCover ? <img src={firstCover} alt="" /> : <BookOpen size={20} />}
                      </div>
                      <div className="series-list-info">
                        <div className="series-list-title">{series.name}</div>
                        <div className="series-list-meta">
                          {series.books.length} {series.books.length === 1 ? "book" : "books"}
                          <span className="series-list-meta-sep"> · </span>
                          <span className="series-list-preview">
                            {series.books.slice(0, 3).map((book) => book.title).join(" / ")}
                          </span>
                        </div>
                      </div>
                    </button>
                  );
                })}
              </div>
            ) : (
              <div className="series-view-grid">
                {seriesGroups.map((series) => (
                  <button
                    key={series.id ?? series.name}
                    className="series-view-card"
                    type="button"
                    onClick={() => openSeries(series)}
                  >
                    <div className={`series-view-covers series-view-covers--${Math.min(series.books.length, 4)}`}>
                      {series.books.slice(0, 4).map((book) => (
                        <div key={book.id} className="series-view-cover">
                          {book.coverPath ? <img src={book.coverPath} alt="" /> : <BookOpen size={22} />}
                        </div>
                      ))}
                    </div>
                    <div className="series-view-info">
                      <div className="series-view-title">{series.name}</div>
                      <div className="series-view-count">{series.books.length} {series.books.length === 1 ? "book" : "books"}</div>
                      <div className="series-view-preview">
                        {series.books.slice(0, 3).map((book) => book.title).join(" / ")}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )
          ) : viewMode === "list" ? (
            <div className="library-list-view">
              {visibleBooks.map((book) => {
                const progress = progressMap.get(book.id);
                const pct = progress && book.duration > 0
                  ? Math.min(100, Math.round((progress / book.duration) * 100))
                  : 0;
                return (
                  <div
                    key={book.id}
                    className={`library-list-row${user?.role === "ADMIN" ? " library-list-row--admin" : ""}`}
                    onClick={() => {
                      if (filters.duplicates === "true") {
                        navigate("/duplicates", { state: { initialBookId: book.id, from: returnTo } });
                      } else {
                        navigate(`/book/${book.id}`, { state: { from: returnTo } });
                      }
                    }}
                  >
                    {user?.role === "ADMIN" && (
                      <div className="library-list-select" onClick={(event) => event.stopPropagation()}>
                        <label className="library-list-checkbox-label">
                          <input
                            type="checkbox"
                            checked={selectedBookIds.has(book.id)}
                            onChange={(event) => updateBookSelection(book.id, event.target.checked, false)}
                            aria-label={`Select ${book.title}`}
                          />
                        </label>
                      </div>
                    )}
                    <div className="library-list-cover">
                      {book.coverPath ? <img src={book.coverPath} alt="" loading="lazy" /> : <BookOpen size={24} />}
                    </div>
                    <div className="library-list-main">
                      <div className="library-list-title">{book.title}</div>
                      {book.subtitle && <div className="library-list-subtitle">{book.subtitle}</div>}
                      <div className="library-list-meta">
                        <span>{book.author.name}</span>
                        {book.series?.name && <span>{book.series.name}{book.sequence != null ? ` #${book.sequence}` : ""}</span>}
                        <span>{formatTimeLeft(book.duration).replace(" left", "")}</span>
                      </div>
                      {pct > 0 && (
                        <div className="library-list-progress">
                          <div className="library-list-progress-fill" style={{ width: `${pct}%` }} />
                        </div>
                      )}
                    </div>
                    {user?.role === "ADMIN" && (
                      <div className="library-list-actions" onClick={(event) => event.stopPropagation()}>
                        <button className="btn btn-secondary library-list-icon-btn" title="Match metadata" onClick={() => setMatchBook(book)}><Sparkles size={14} /></button>
                        <button className="btn btn-secondary library-list-icon-btn" title="Re-scan folder" onClick={() => { setActionBook(book); setConfirmAction("rescan"); }}><RefreshCw size={14} /></button>
                        <button className="btn btn-secondary library-list-icon-btn" title="Auto chapterize" onClick={() => void handleAutoChapterize(book)}><ListPlus size={14} /></button>
                        <button className="btn btn-secondary library-list-icon-btn" title="Find duplicates" onClick={() => handleFindDuplicates(book)}><FileSearch size={14} /></button>
                        <button className="btn btn-danger library-list-icon-btn" title="Delete" onClick={() => { setActionBook(book); setDeleteFiles(false); setConfirmAction("delete"); }}><Trash2 size={14} /></button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          ) : (
            <div className="library-grid">
              {visibleBooks.map((book) => (
                <BookCard
                  key={book.id}
                  book={book}
                  progressSeconds={progressMap.get(book.id)}
                  isAdmin={user?.role === "ADMIN"}
                  isSelectable={user?.role === "ADMIN"}
                  isSelected={selectedBookIds.has(book.id)}
                  selectionControlsActive={selectedBookIds.size > 0}
                  onSelect={(selected, shiftKey) => updateBookSelection(book.id, selected, shiftKey)}
                  onMatch={() => setMatchBook(book)}
                  onRescan={() => {
                    setActionBook(book);
                    setConfirmAction("rescan");
                  }}
                  onAutoChapterize={() => void handleAutoChapterize(book)}
                  onFindDuplicates={() => handleFindDuplicates(book)}
                  onDelete={() => {
                    setActionBook(book);
                    setDeleteFiles(false);
                    setConfirmAction("delete");
                  }}
                  onMarkFinished={() =>
                    void handleMarkBookFinished({
                      id: book.id,
                      title: book.title,
                      duration: book.duration,
                    })
                  }
                  onRemoveFromContinueListening={() =>
                    void handleRemoveBookFromContinueListening({
                      id: book.id,
                      title: book.title,
                    })
                  }
                  onClickOverride={filters.duplicates === "true" ? () => {
                    navigate("/duplicates", { state: { initialBookId: book.id, from: returnTo } });
                  } : undefined}
                />
              ))}
            </div>
          )}
          {viewMode !== "series" && visibleBookCount < books.length && (
            <div className="library-load-more-wrap" ref={loadMoreRef}>
              <button
                className="btn btn-secondary"
                onClick={() =>
                  setVisibleBookCount((current) => Math.min(current + BOOK_RENDER_CHUNK_SIZE, books.length))
                }
              >
                Show more
              </button>
              <span className="library-load-more-meta">
                Showing {visibleBooks.length} of {books.length}
              </span>
            </div>
          )}
        </>
      )}

      {isUploadModalOpen && (
        <UploadModal
          onClose={() => setIsUploadModalOpen(false)}
          onUploadComplete={async () => {
            await fetchLibraries();
            await fetchBooks();
          }}
        />
      )}

      {matchBook && (
        <BookMetadataModal
          key={matchBook.id}
          book={matchBook}
          onClose={closeMetadataQueue}
          onApplied={matchQueue.length > 0 ? advanceMetadataQueue : refreshLibraryData}
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

      {isQuickMatchOpen && (
        <QuickMatchModal
          selectedCount={selectedBooks.length}
          eligibleCount={quickMatchEligibleBooks.length}
          provider={quickMatchProvider}
          minConfidence={quickMatchMinConfidence}
          fields={quickMatchFields}
          result={quickMatchResult}
          busy={quickMatchBusy}
          onClose={() => setIsQuickMatchOpen(false)}
          onProviderChange={setQuickMatchProvider}
          onMinConfidenceChange={setQuickMatchMinConfidence}
          onFieldsChange={setQuickMatchFields}
          onRun={(mode) => void runQuickMatch(mode)}
        />
      )}

      {/* Book Management Modals */}
      <ConfirmDialog
        open={confirmAction === "rescan"}
        title="Refresh Metadata"
        message={`This will rescan the folder for "${actionBook?.title}" for file changes and update the database. Existing progress will be preserved.`}
        confirmLabel="Rescan Now"
        busy={isActionBusy}
        onCancel={() => setConfirmAction(null)}
        onConfirm={() => void handleRescan()}
      />

      {/* Duplicate Merge Modal */}
      {confirmAction === "merge-duplicates" && actionBook && (
        <div className="modal-overlay">
          <div className="modal-content metadata-modal">
            <div className="modal-header">
              <h2 className="modal-title">Merge Duplicates</h2>
              <button className="btn-close" onClick={() => setConfirmAction(null)}>×</button>
            </div>
            <div className="modal-body">
              <p className="mb-4">Select the books you want to merge <strong>INTO</strong> the primary record: <strong>{actionBook.title}</strong>.</p>
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
                        {dup.library?.name} - {dup._count?.audioFiles ?? 0} files
                      </div>
                      <div className="dup-path" title={dup.folderPath}>
                        {dup.folderPath}
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
                disabled={selectedDuplicateIds.length === 0 || isActionBusy}
                onClick={() => void handleMergeDuplicates()}
              >
                {isActionBusy ? "Merging..." : `Merge ${selectedDuplicateIds.length} Books`}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Delete Title Modal */}
      {confirmAction === "delete" && actionBook && (
        <div className="modal-overlay">
          <div className="modal-content metadata-modal">
            <div className="modal-header">
              <h2 className="modal-title">Remove Title</h2>
              <button className="btn-close" onClick={() => setConfirmAction(null)}>×</button>
            </div>
            <div className="modal-body">
              <p className="mb-4">Are you sure you want to remove <strong>{actionBook.title}</strong> from your library?</p>
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
                disabled={isActionBusy}
                onClick={() => void handleDeleteBook()}
              >
                {isActionBusy ? "Removing..." : deleteFiles ? "Delete Files & Remove" : "Remove from Library"}
              </button>
            </div>
          </div>
        </div>
      )}

      {user?.role === "ADMIN" && selectedBooks.length > 0 && !matchBook && !confirmAction && (
        <div className="library-sticky-selection-bar">
          <div className="library-sticky-selection-inner">
            {batchActions}
          </div>
        </div>
      )}
    </div>

</>
  );
};

export default Library;
