import { createPortal } from "react-dom";
import { useEffect, useEffectEvent, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { isAxiosError } from "axios";
import {
  BookMarked,
  Plus,
  RefreshCw,
  LogOut,
  BookOpen,
  Check,
  EyeOff,
  FileSearch,
  FolderOpen,
  Loader2,
  ListPlus,
  MoreVertical,
  Search,
  Share2,
  Trash2,
  Settings,
  Save,
  Sparkles,
  X,
  Headphones,
  SlidersHorizontal,
} from "lucide-react";
import { io } from "socket.io-client";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";
import api from "../api/axios";
import { getSocketBaseUrl } from "../api/backend";
import AppLogo from "../components/AppLogo";
import BookCard from "../components/BookCard";
import BookMetadataModal from "../components/BookMetadataModal";
import SearchBox from "../components/SearchBox";
import UploadModal from "../components/UploadModal";
import ConfirmDialog from "../components/ConfirmDialog";
import { usePlayer } from "../context/PlayerContext";

interface LibraryBook {
  id: string;
  title: string;
  subtitle?: string | null;
  asin?: string | null;
  duration: number;
  coverPath?: string;
  library: { id: string; name: string };
  author: { name: string };
}

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
  listeningStatus: string;
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
  listeningStatus: "all",
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

const INITIAL_BOOK_RENDER_COUNT = 120;
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

const Library = () => {
  const { user, logout } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams, setSearchParams] = useSearchParams();
  const { playBook } = usePlayer();
  const returnTo = `${location.pathname}${location.search}`;

  const filterAuthorId = searchParams.get("authorId") ?? undefined;
  const filterSeriesId = searchParams.get("seriesId") ?? undefined;
  const filterNarrator = searchParams.get("narrator") ?? undefined;
  const filterAuthorName = searchParams.get("authorName") ?? undefined;
  const filterSeriesName = searchParams.get("seriesName") ?? undefined;

  const [books, setBooks] = useState<LibraryBook[]>([]);
  const [filterOptions, setFilterOptions] = useState<FilterOptions>(emptyFilterOptions);
  const [progressRecords, setProgressRecords] = useState<ProgressRecord[]>([]);
  const [progressMap, setProgressMap] = useState<Map<string, number>>(new Map());
  const [filters, setFilters] = useState<LibraryFilters>(() => getFiltersFromParams(searchParams));
  const [isFilterPanelOpen, setIsFilterPanelOpen] = useState(false);
  const [search, setSearch] = useState(searchParams.get("search") || "");
  const [sortBy, setSortBy] = useState(searchParams.get("sortBy") || "newest");

  useEffect(() => {
    setFilters(getFiltersFromParams(searchParams));
    setSearch(searchParams.get("search") || "");
    setSortBy(searchParams.get("sortBy") || "newest");
  }, [searchParams]);

  const [loading, setLoading] = useState(true);
  const [isUploadModalOpen, setIsUploadModalOpen] = useState(false);
  const [matchBook, setMatchBook] = useState<LibraryBook | null>(null);
  const [actionBook, setActionBook] = useState<LibraryBook | null>(null);
  const [confirmAction, setConfirmAction] = useState<null | "rescan" | "cleanup" | "merge-duplicates" | "delete">(null);
  const [duplicates, setDuplicates] = useState<LibraryBook[]>([]);
  const [selectedDuplicateIds, setSelectedDuplicateIds] = useState<string[]>([]);
  const [isActionBusy, setIsActionBusy] = useState(false);
  const [deleteFiles, setDeleteFiles] = useState(false);
  const [selectedBookIds, setSelectedBookIds] = useState<Set<string>>(new Set());
  const [lastSelectedBookId, setLastSelectedBookId] = useState<string | null>(null);
  const [matchQueue, setMatchQueue] = useState<LibraryBook[]>([]);
  const [matchQueueIndex, setMatchQueueIndex] = useState(0);
  const [tagWriteProgress, setTagWriteProgress] = useState<{
    current: number;
    total: number;
    percent: number;
    label: string;
  } | null>(null);
  const [batchActionMessage, setBatchActionMessage] = useState<{ type: "success" | "error"; text: string } | null>(null);
  const [isScanning, setIsScanning] = useState(false);
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [visibleBookCount, setVisibleBookCount] = useState(INITIAL_BOOK_RENDER_COUNT);
  const [openContinueMenuBookId, setOpenContinueMenuBookId] = useState<string | null>(null);
  const [continueMenuPos, setContinueMenuPos] = useState<{ top: number; right: number } | null>(null);
  const loadMoreRef = useRef<HTMLDivElement | null>(null);
  const continueMenuRef = useRef<HTMLDivElement | null>(null);
  const continuePortalMenuRef = useRef<HTMLDivElement | null>(null);
  const writeTagsJobsRef = useRef<Map<string, WriteTagsJob>>(new Map());
  const writeTagsResolversRef = useRef<Map<string, (job: WriteTagsJob) => void>>(new Map());
  const activeBatchWriteRef = useRef<{
    jobId: string;
    bookId: string;
    index: number;
    total: number;
    title: string;
  } | null>(null);

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
    listeningStatus: filters.listeningStatus !== "all" ? filters.listeningStatus : undefined,
    duplicatesOnly: filters.duplicates === "true" ? true : undefined,
  });

  const activeFilterCount = useMemo(() =>
    Object.entries(filters).filter(([key, value]) => {
      if (["libraryId", "authorId", "seriesId", "cover", "hasAsin", "hasIsbn", "abridged", "fileType", "listeningStatus", "duplicates"].includes(key)) {
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
    setSearchParams({});
  };

  const fetchBooks = async () => {
    try {
      const res = await api.get("/library", {
        params: buildBookParams(),
      });
      setBooks(res.data);
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
      const records: ProgressRecord[] = res.data;
      setProgressRecords(records);
      setProgressMap(new Map(records.map((r) => [r.bookId, r.currentTime])));
    } catch (error) {
      console.error("Failed to fetch progress", error);
    }
  };

  const handleContinuePlay = async (record: ProgressRecord) => {
    try {
      const bookRes = await api.get(`/library/${record.bookId}`);
      playBook(bookRes.data, record.currentTime);
    } catch (error) {
      console.error("Failed to resume playback", error);
    }
  };

  const removeBookFromInProgressState = (bookId: string) => {
    setProgressMap((current) => {
      const next = new Map(current);
      next.delete(bookId);
      return next;
    });

    setProgressRecords((current) => current.filter((record) => record.bookId !== bookId));
  };

  const handleQuickMenuPlaceholder = (label: string) => {
    showToast({
      title: `${label} not available`,
      description: `${label} is not wired up in the web app yet.`,
      tone: "info",
    });
  };

  const handleShareBook = async (book: Pick<LibraryBook, "id" | "title" | "author">) => {
    const shareUrl = `${window.location.origin}/book/${book.id}`;
    try {
      if (navigator.share) {
        await navigator.share({
          title: book.title,
          text: `Listen to ${book.title} by ${book.author.name}`,
          url: shareUrl,
        });
        return;
      }

      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(shareUrl);
        showToast({
          title: "Link copied",
          description: `Copied a share link for "${book.title}".`,
          tone: "success",
        });
        return;
      }

      showToast({
        title: "Share unavailable",
        description: "This browser does not support sharing or clipboard copy.",
        tone: "error",
      });
    } catch (error) {
      if ((error as { name?: string })?.name === "AbortError") {
        return;
      }
      showToast({
        title: "Share failed",
        description: getErrorMessage(error, "Could not share this title."),
        tone: "error",
      });
    }
  };

  const handleMarkBookFinished = async (book: Pick<LibraryBook, "id" | "title" | "duration">) => {
    try {
      await api.post(`/progress/${book.id}`, {
        currentTime: book.duration,
        isFinished: true,
      });
      removeBookFromInProgressState(book.id);
      setOpenContinueMenuBookId(null);
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
      setOpenContinueMenuBookId(null);
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

  useEffect(() => {
    if (!openContinueMenuBookId) return;

    const handleClickOutside = (event: MouseEvent) => {
      const inTrigger = continueMenuRef.current?.contains(event.target as Node);
      const inMenu = continuePortalMenuRef.current?.contains(event.target as Node);
      if (!inTrigger && !inMenu) setOpenContinueMenuBookId(null);
    };

    document.addEventListener("mousedown", handleClickOutside);
    return () => document.removeEventListener("mousedown", handleClickOutside);
  }, [openContinueMenuBookId]);

  const handleScanProgress = useEffectEvent((data: ScanProgress) => {
    setScanProgress(data);
    if (data.status === "scanning" || data.status === "starting") {
      setIsScanning(true);
    } else if (data.status === "completed" || data.status === "failed") {
      setIsScanning(false);
      void fetchBooks();
      void fetchLibraries();
      setTimeout(() => setScanProgress(null), 5000);
    }
  });

  const updateBatchWriteProgress = useEffectEvent(
    (context: { index: number; total: number; title: string }, job: WriteTagsJob) => {
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
    },
  );

  const handleWriteTagsProgress = useEffectEvent((job: WriteTagsJob) => {
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
  });

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
        const booksRes = await api.get("/library", {
          params: buildBookParams(),
        });
        if (cancelled) return;

        setBooks(booksRes.data);
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

  const handleScan = async () => {
    setIsScanning(true);
    try {
      await api.post("/library/scan");
      showToast({
        title: "Scan started",
        description: "Checking libraries for new content.",
        tone: "info",
      });
    } catch (error) {
      console.error("Scan failed", error);
      showToast({
        title: "Scan failed",
        description: getErrorMessage(error, "Check server logs."),
        tone: "error",
      });
      setIsScanning(false);
    }
  };

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
      showToast({ title: "Delete failed", description: "Check server logs.", tone: "error" });
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
  const visibleBooks = useMemo(
    () => books.slice(0, visibleBookCount),
    [books, visibleBookCount],
  );

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

  const advanceMetadataQueue = async () => {
    const nextIndex = matchQueueIndex + 1;
    if (matchQueue.length > 0 && nextIndex < matchQueue.length) {
      setMatchQueueIndex(nextIndex);
      setMatchBook(matchQueue[nextIndex]);
      setSelectedBookIds((current) => {
        const next = new Set(current);
        next.delete(matchQueue[matchQueueIndex].id);
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
        disabled={Boolean(tagWriteProgress)}
      >
        <Sparkles size={15} />
        Fetch Metadata
      </button>
      <button
        className="btn btn-secondary"
        type="button"
        onClick={writeSelectedMetadataTags}
        disabled={Boolean(tagWriteProgress)}
        aria-busy={Boolean(tagWriteProgress)}
      >
        {tagWriteProgress ? <Loader2 size={15} className="animate-spin" /> : <Save size={15} />}
        {tagWriteProgress ? "Writing Tags..." : "Write Tags"}
      </button>
      <button
        className="btn btn-secondary"
        type="button"
        onClick={clearBatchSelection}
        disabled={Boolean(tagWriteProgress)}
      >
        <X size={15} />
        Clear
      </button>
    </>
  );

  return (
    <div className="container library-page">
      <header className="library-header">
        <div className="library-brand-section">
          <AppLogo className="library-brand" imageClassName="library-brand-image" textClassName="library-title" />
          <p className="library-subtitle">Welcome back, {user?.username}</p>
        </div>

        <div className="library-toolbar">
          <SearchBox
            value={search}
            onChange={(v) => {
              const newParams = new URLSearchParams(searchParams);
              if (v) newParams.set("search", v);
              else newParams.delete("search");
              setSearchParams(newParams, { replace: true });
            }}
          />

          <div className="filter-group">
            <button
              className={`btn btn-secondary filter-toggle-btn ${isFilterPanelOpen || activeFilterCount > 0 ? "active" : ""}`}
              type="button"
              onClick={() => setIsFilterPanelOpen((current) => !current)}
            >
              <SlidersHorizontal size={15} />
              Filters
              {activeFilterCount > 0 && <span className="filter-count-badge">{activeFilterCount}</span>}
            </button>

            <div className="filter-item">
              <div className="select-wrap filter-select">
                <select
                  className="form-control"
                  value={sortBy}
                  onChange={(e) => {
                    const newParams = new URLSearchParams(searchParams);
                    newParams.set("sortBy", e.target.value);
                    setSearchParams(newParams);
                  }}
                >
                  <option value="newest">Newest First</option>
                  <option value="oldest">Oldest First</option>
                  <option value="title_asc">Title (A-Z)</option>
                  <option value="title_desc">Title (Z-A)</option>
                  <option value="author_asc">Author (A-Z)</option>
                  <option value="author_desc">Author (Z-A)</option>
                  <option value="duration_asc">Shortest First</option>
                  <option value="duration_desc">Longest First</option>
                  <option value="year_desc">Year (Newest)</option>
                  <option value="year_asc">Year (Oldest)</option>
                </select>
              </div>
            </div>
          </div>
        </div>

        <div className="library-actions">
          {user?.role === "ADMIN" && (
            <>
              <button
                onClick={handleScan}
                className="btn btn-secondary"
                disabled={isScanning}
              >
                <RefreshCw size={15} className={isScanning ? "animate-spin" : ""} />
                {isScanning ? "Scanning…" : "Scan Library"}
              </button>
              <button
                onClick={() => setIsUploadModalOpen(true)}
                className="btn btn-primary"
              >
                <Plus size={15} />
                Add Book
              </button>
              <button
                onClick={() => navigate("/settings", { state: { from: returnTo } })}
                className="btn btn-secondary library-icon-btn"
              >
                <Settings size={15} />
              </button>
            </>
          )}
          <button
            onClick={logout}
            className="btn logout-btn"
            title="Sign out"
          >
            <LogOut size={18} />
          </button>
        </div>
      </header>

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
          <button className="library-filter-clear" onClick={() => {
            if (search) setSearch("");
            clearFilters();
            navigate("/");
          }}>
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

      {progressRecords.length > 0 && (
        <section className="continue-listening-section">
          <div className="continue-listening-header">
            <Headphones size={18} className="continue-listening-icon" />
            <h2 className="continue-listening-title">Continue Listening</h2>
          </div>
          <div className="continue-shelf">
            {progressRecords.map((record) => {
              const pct = Math.min(100, Math.round((record.currentTime / record.book.duration) * 100));
              const remaining = Math.max(0, record.book.duration - record.currentTime);
              return (
                <div
                  key={record.bookId}
                  className="continue-card"
                  onClick={() => handleContinuePlay(record)}
                  title={`Resume ${record.book.title}`}
                >
                  <div className="continue-card-cover">
                    <div
                      className="book-card-menu-wrap"
                      ref={openContinueMenuBookId === record.bookId ? continueMenuRef : null}
                    >
                      <button
                        className="book-card-menu-trigger"
                        onClick={(event) => {
                          event.stopPropagation();
                          if (openContinueMenuBookId === record.bookId) {
                            setOpenContinueMenuBookId(null);
                          } else {
                            const rect = event.currentTarget.getBoundingClientRect();
                            setContinueMenuPos({ top: rect.bottom + 4, right: window.innerWidth - rect.right });
                            setOpenContinueMenuBookId(record.bookId);
                          }
                        }}
                        aria-label={`Open actions for ${record.book.title}`}
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
          </div>
        </section>
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
              {books.length} {books.length === 1 ? "audiobook" : "audiobooks"}
              {search && <span className="library-grid-filter-note"> matching "{search}"</span>}
            </span>
            {user?.role === "ADMIN" && selectedBooks.length > 0 && (
              <div className="library-batch-actions">
                {batchActions}
              </div>
            )}
          </div>
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
          {visibleBookCount < books.length && (
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

    {/* Continue-shelf context menu — rendered in a portal to escape overflow:auto clipping */}
    {(() => {
      const r = progressRecords.find((rec) => rec.bookId === openContinueMenuBookId);
      if (!openContinueMenuBookId || !continueMenuPos || !r) return null;
      return createPortal(
        <div
          className="book-card-menu"
          ref={continuePortalMenuRef}
          style={{ top: continueMenuPos.top, right: continueMenuPos.right }}
        >
          <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setOpenContinueMenuBookId(null); void handleMarkBookFinished({ id: r.bookId, title: r.book.title, duration: r.book.duration }); }}>
            <Check size={14} /> Mark as Finished
          </button>
          <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setOpenContinueMenuBookId(null); handleQuickMenuPlaceholder("Add to Collection"); }}>
            <BookMarked size={14} /> Add to Collection
          </button>
          <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setOpenContinueMenuBookId(null); handleQuickMenuPlaceholder("Add to Playlist"); }}>
            <ListPlus size={14} /> Add to Playlist
          </button>
          <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setOpenContinueMenuBookId(null); void handleShareBook({ id: r.bookId, title: r.book.title, author: r.book.author }); }}>
            <Share2 size={14} /> Share
          </button>
          <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setOpenContinueMenuBookId(null); navigate(`/book/${r.bookId}`, { state: { from: returnTo } }); }}>
            <FolderOpen size={14} /> Files
          </button>
          {user?.role === "ADMIN" && (
            <>
              <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setOpenContinueMenuBookId(null); setMatchBook({ id: r.bookId, title: r.book.title, duration: r.book.duration, coverPath: r.book.coverPath ?? undefined, author: r.book.author, library: { id: "", name: "" } }); }}>
                <Search size={14} /> Match
              </button>
              <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setOpenContinueMenuBookId(null); setActionBook({ id: r.bookId, title: r.book.title, duration: r.book.duration, coverPath: r.book.coverPath ?? undefined, author: r.book.author, library: { id: "", name: "" } }); setConfirmAction("rescan"); }}>
                <RefreshCw size={14} /> Re-Scan
              </button>
              <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); setOpenContinueMenuBookId(null); handleFindDuplicates({ id: r.bookId, title: r.book.title, duration: r.book.duration, coverPath: r.book.coverPath ?? undefined, author: r.book.author, library: { id: "", name: "" } }); }}>
                <FileSearch size={14} /> Find Duplicates
              </button>
            </>
          )}
          <button className="book-card-menu-item" onClick={(e) => { e.stopPropagation(); void handleRemoveBookFromContinueListening({ id: r.bookId, title: r.book.title }); }}>
            <EyeOff size={14} /> Remove from Continue Listening
          </button>
          {user?.role === "ADMIN" && (
            <>
              <div className="book-card-menu-divider" />
              <button className="book-card-menu-item text-danger" onClick={(e) => { e.stopPropagation(); setOpenContinueMenuBookId(null); setActionBook({ id: r.bookId, title: r.book.title, duration: r.book.duration, coverPath: r.book.coverPath ?? undefined, author: r.book.author, library: { id: "", name: "" } }); setDeleteFiles(false); setConfirmAction("delete"); }}>
                <Trash2 size={14} /> Delete
              </button>
            </>
          )}
        </div>,
        document.body,
      );
    })()}
  );
};

export default Library;
