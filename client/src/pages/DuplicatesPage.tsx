import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
  Eye,
  EyeOff,
  HardDrive,
  Info,
  Loader2,
  Mic,
} from "lucide-react";
import api from "../api/axios";
import { useToast } from "../context/ToastContext";

interface AudioFile {
  id: string;
  filename: string;
  path: string;
  title?: string | null;
  duration: number;
  index: number;
  bookId: string;
}

interface ProgressRecord {
  userId: string;
  bookId: string;
  currentTime: number;
  isFinished: boolean;
  lastUpdate: string;
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
  folderPath: string;
  library: { name: string };
  audioFiles: AudioFile[];
  progress: ProgressRecord[];
}

interface DuplicateGroup {
  type: "asin" | "isbn" | "title-author";
  key: string;
  books: Book[];
}

type ComparableField =
  | "title"
  | "subtitle"
  | "sequence"
  | "narrator"
  | "publisher"
  | "year"
  | "asin"
  | "isbn"
  | "language";

const duplicateTypeLabel: Record<DuplicateGroup["type"], string> = {
  asin: "ASIN match",
  isbn: "ISBN match",
  "title-author": "Title and author match",
};

const comparisonFields: Array<
  | { label: string; key: ComparableField }
  | { label: string; key: "series"; val: (book: Book) => string | number | null | undefined }
> = [
  { label: "Title", key: "title" },
  { label: "Subtitle", key: "subtitle" },
  { label: "Series", key: "series", val: (book: Book) => book.series?.name },
  { label: "Sequence #", key: "sequence" },
  { label: "Narrator", key: "narrator" },
  { label: "Publisher", key: "publisher" },
  { label: "Year", key: "year" },
  { label: "ASIN", key: "asin" },
  { label: "ISBN", key: "isbn" },
  { label: "Language", key: "language" },
];

const formatDuration = (seconds: number) => {
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  if (hours > 0) return `${hours}h ${minutes}m`;
  return `${minutes}m`;
};

// Color palette per book slot (A, B, C, D)
const BOOK_PALETTE = [
  {
    label: "A",
    badgeBg: "bg-blue-500",
    text: "text-blue-400",
    cardBorder: "border-blue-500/60",
    cardBg: "bg-blue-500/8",
    colHeaderBg: "bg-blue-500/10",
    colHeaderBorder: "border-b-blue-500/50",
    cellHighlight: "bg-blue-500/10 border-l-2 border-l-blue-500/60",
    activePrimaryBtn: "bg-blue-600 border-blue-500 text-white hover:bg-blue-500",
  },
  {
    label: "B",
    badgeBg: "bg-amber-500",
    text: "text-amber-400",
    cardBorder: "border-amber-500/60",
    cardBg: "bg-amber-500/8",
    colHeaderBg: "bg-amber-500/10",
    colHeaderBorder: "border-b-amber-500/50",
    cellHighlight: "bg-amber-500/10 border-l-2 border-l-amber-500/60",
    activePrimaryBtn: "bg-amber-600 border-amber-500 text-white hover:bg-amber-500",
  },
  {
    label: "C",
    badgeBg: "bg-green-500",
    text: "text-green-400",
    cardBorder: "border-green-500/60",
    cardBg: "bg-green-500/8",
    colHeaderBg: "bg-green-500/10",
    colHeaderBorder: "border-b-green-500/50",
    cellHighlight: "bg-green-500/10 border-l-2 border-l-green-500/60",
    activePrimaryBtn: "bg-green-600 border-green-500 text-white hover:bg-green-500",
  },
  {
    label: "D",
    badgeBg: "bg-rose-500",
    text: "text-rose-400",
    cardBorder: "border-rose-500/60",
    cardBg: "bg-rose-500/8",
    colHeaderBg: "bg-rose-500/10",
    colHeaderBorder: "border-b-rose-500/50",
    cellHighlight: "bg-rose-500/10 border-l-2 border-l-rose-500/60",
    activePrimaryBtn: "bg-rose-600 border-rose-500 text-white hover:bg-rose-500",
  },
];

const BookCoverPlaceholder = ({ size = "lg" }: { size?: "sm" | "md" | "lg" }) => {
  const iconSize = size === "sm" ? 12 : size === "md" ? 20 : 40;
  return (
    <div className="flex h-full w-full flex-col items-center justify-center gap-2 bg-black/20">
      <BookOpen size={iconSize} className="text-gray-600" />
      {size === "lg" && <span className="text-[11px] text-gray-600">No cover</span>}
    </div>
  );
};

const DuplicatesPage = () => {
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();
  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
  const [primaryBookId, setPrimaryBookId] = useState<string | null>(null);
  const [metadataSourceId, setMetadataSourceId] = useState<string | null>(null);
  const [progressSourceId, setProgressSourceId] = useState<string | null>(null);
  const [fileActions, setFileActions] = useState<Record<string, "keep" | "delete" | "keep_sub">>({});
  const [isMerging, setIsMerging] = useState(false);
  const [showIdentical, setShowIdentical] = useState(false);

  const backTarget =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/settings";

  const initialBookId =
    typeof location.state === "object" &&
    location.state !== null &&
    "initialBookId" in location.state &&
    typeof location.state.initialBookId === "string"
      ? location.state.initialBookId
      : null;

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const res = await api.get<DuplicateGroup[]>("/admin/duplicates");
      setGroups(res.data);

      if (res.data.length === 0) {
        setSelectedGroupIndex(null);
        return;
      }

      if (initialBookId) {
        const matchedIndex = res.data.findIndex((group) =>
          group.books.some((book) => book.id === initialBookId),
        );
        setSelectedGroupIndex(matchedIndex >= 0 ? matchedIndex : 0);
        return;
      }

      setSelectedGroupIndex(0);
    } catch (error) {
      console.error("Failed to fetch duplicates", error);
      showToast({ title: "Failed to load duplicates", tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchGroups();
  }, []);

  const currentGroup = selectedGroupIndex !== null ? groups[selectedGroupIndex] : null;
  const keptCount = Object.values(fileActions).filter((v) => v === "keep").length;
  const keptInSubfolderCount = Object.values(fileActions).filter((v) => v === "keep_sub").length;
  const deletedCount = Object.values(fileActions).filter((v) => v === "delete").length;
  const affectedBookCount = groups.reduce((count, group) => count + group.books.length, 0);

  useEffect(() => {
    if (!currentGroup || currentGroup.books.length === 0) return;

    setPrimaryBookId(currentGroup.books[0].id);
    setMetadataSourceId(currentGroup.books[0].id);
    setProgressSourceId(currentGroup.books[0].id);

    const initialActions: Record<string, "keep" | "delete" | "keep_sub"> = {};
    currentGroup.books.forEach((book, bookIndex) => {
      book.audioFiles.forEach((file) => {
        initialActions[file.id] = bookIndex === 0 ? "keep" : "delete";
      });
    });
    setFileActions(initialActions);
  }, [currentGroup]);

  const handleMerge = async () => {
    if (!currentGroup || !primaryBookId) return;

    setIsMerging(true);
    try {
      const metadataBook = currentGroup.books.find((book) => book.id === metadataSourceId);

      const payload = {
        primaryBookId,
        secondaryBookIds: currentGroup.books
          .filter((book) => book.id !== primaryBookId)
          .map((book) => book.id),
        metadata: metadataBook
          ? {
              title: metadataBook.title,
              subtitle: metadataBook.subtitle,
              authorId: metadataBook.author.id,
              seriesId: metadataBook.series?.id,
              sequence: metadataBook.sequence,
              narrator: metadataBook.narrator,
              publisher: metadataBook.publisher,
              year: metadataBook.year,
              genres: metadataBook.genres,
              tags: metadataBook.tags,
              language: metadataBook.language,
              isbn: metadataBook.isbn,
              asin: metadataBook.asin,
              abridged: metadataBook.abridged,
            }
          : undefined,
        keepProgressFromBookId: progressSourceId,
        audioFileActions: Object.entries(fileActions).map(([id, action]) => ({
          audioFileId: id,
          action,
        })),
      };

      await api.post("/admin/duplicates/resolve", payload);
      showToast({ title: "Duplicates resolved successfully", tone: "success" });

      const nextGroups = [...groups];
      nextGroups.splice(selectedGroupIndex!, 1);
      setGroups(nextGroups);
      setSelectedGroupIndex(
        nextGroups.length > 0 ? Math.min(selectedGroupIndex!, nextGroups.length - 1) : null,
      );
    } catch (error) {
      console.error("Merge failed", error);
      showToast({ title: "Resolution failed", tone: "error" });
    } finally {
      setIsMerging(false);
    }
  };

  if (loading) {
    return (
      <div className="duplicates-page relative min-h-screen overflow-hidden bg-background text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_28%),linear-gradient(180deg,rgba(9,9,20,0.98),rgba(8,10,18,1))]" />
        <div className="relative flex min-h-screen flex-col items-center justify-center px-4 text-center">
          <div className="flex flex-col items-center gap-5">
            <div className="relative">
              <Loader2 className="animate-spin text-primary" size={64} strokeWidth={1.5} />
              <Copy
                className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/35"
                size={24}
              />
            </div>
            <div className="max-w-xl space-y-2">
              <h2 className="text-2xl font-semibold tracking-tight">Scanning for duplicates</h2>
              <p className="text-sm text-gray-300">
                Comparing ASINs, ISBNs, and normalized title and author data across your libraries.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="duplicates-page relative min-h-screen overflow-hidden bg-background text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_28%),linear-gradient(180deg,rgba(9,9,20,0.98),rgba(8,10,18,1))]" />
      <div className="relative mx-auto max-w-7xl px-4 py-6 md:px-6 lg:py-8">

        {/* ── Header ── */}
        <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-4">
            <button onClick={() => navigate(backTarget)} className="btn btn-secondary rounded-full p-2">
              <ArrowLeft size={20} />
            </button>
            <div className="space-y-2">
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Duplicate Resolver</h1>
              <p className="text-sm text-gray-300">
                {groups.length} duplicate group{groups.length !== 1 ? "s" : ""} across {affectedBookCount} books.
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <button className="btn btn-secondary px-4 py-2" onClick={() => void fetchGroups()} disabled={loading}>
              Refresh Scan
            </button>
            {currentGroup ? (
              <button
                className="btn btn-primary flex items-center gap-2 px-6 py-2"
                onClick={handleMerge}
                disabled={isMerging}
              >
                {isMerging ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                Resolve and Merge
              </button>
            ) : null}
          </div>
        </header>

        {/* ── Empty state ── */}
        {!currentGroup ? (
          <div className="mt-16 rounded-2xl border border-border bg-white/5 p-10 text-center shadow-2xl shadow-black/20 backdrop-blur-sm">
            <Check size={64} className="mx-auto mb-4 text-green-400" />
            <h2 className="text-2xl font-semibold">No duplicates found</h2>
            <p className="mt-2 text-sm text-gray-300">Your library is clean and organized.</p>
            <button onClick={() => navigate("/")} className="btn btn-primary mt-6 px-8">
              Return to Library
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[300px_minmax(0,1fr)]">

            {/* ── Group list sidebar ── */}
            <aside className="h-fit overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-2xl shadow-black/20 backdrop-blur-sm xl:sticky xl:top-6">
              <div className="border-b border-border bg-white/5 px-4 py-4">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Groups</div>
                <div className="mt-1 text-sm text-gray-300">Select a cluster to review.</div>
              </div>
              <div className="max-h-[72vh] overflow-y-auto p-2">
                {groups.map((group, index) => {
                  const selected = selectedGroupIndex === index;
                  const firstBook = group.books[0];

                  return (
                    <button
                      key={`${group.type}-${group.key}-${index}`}
                      className={`mb-2 w-full rounded-xl border p-3 text-left transition-all ${
                        selected
                          ? "border-primary/60 bg-primary/10 shadow-lg shadow-primary/10"
                          : "border-border bg-white/5 hover:bg-white/10"
                      }`}
                      onClick={() => setSelectedGroupIndex(index)}
                    >
                      <div className="flex items-center gap-3">
                        {/* Mini cover in sidebar */}
                        <div className="h-12 w-9 flex-shrink-0 overflow-hidden rounded-lg border border-border/60 bg-black/30">
                          {firstBook?.coverPath ? (
                            <img src={firstBook.coverPath} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <BookCoverPlaceholder size="sm" />
                          )}
                        </div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-sm font-medium text-white" title={firstBook?.title}>
                            {firstBook?.title || "Untitled"}
                          </div>
                          <div className="mt-0.5 text-xs text-gray-400">
                            {group.books.length} versions · {duplicateTypeLabel[group.type]}
                          </div>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/10 px-2 py-0.5 text-[10px] uppercase tracking-wide text-gray-300">
                          {group.type}
                        </span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            {/* ── Main content ── */}
            <main className="space-y-6">

              {/* Group info bar */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
                  {duplicateTypeLabel[currentGroup.type]}
                </span>
                <span className="rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-gray-300">
                  {currentGroup.books.length} versions detected
                </span>
                <span className="rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-gray-300">
                  {keptCount} keep · {keptInSubfolderCount} subfolder · {deletedCount} delete
                </span>
              </div>

              {/* ── Book comparison cards ── */}
              <section>
                <h2 className="mb-3 text-base font-semibold text-gray-200">
                  Compare Versions
                  <span className="ml-2 text-sm font-normal text-gray-500">
                    — choose which record to keep and which metadata to use
                  </span>
                </h2>

                <div
                  className="grid gap-4"
                  style={{
                    gridTemplateColumns: `repeat(${Math.min(currentGroup.books.length, 2)}, minmax(0, 1fr))`,
                  }}
                >
                  {currentGroup.books.map((book, bookIndex) => {
                    const palette = BOOK_PALETTE[bookIndex % BOOK_PALETTE.length];
                    const isPrimary = primaryBookId === book.id;
                    const isMetadata = metadataSourceId === book.id;
                    const isProgress = progressSourceId === book.id;

                    return (
                      <article
                        key={book.id}
                        className={`flex flex-col overflow-hidden rounded-2xl border-2 shadow-2xl shadow-black/25 transition-all ${
                          isPrimary ? `${palette.cardBorder} ${palette.cardBg}` : "border-border bg-surface/90"
                        }`}
                      >
                        {/* Book slot header bar */}
                        <div className={`flex items-center gap-2 px-4 py-2.5 ${palette.cardBg} border-b border-white/5`}>
                          <span
                            className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full ${palette.badgeBg} text-xs font-bold text-white`}
                          >
                            {palette.label}
                          </span>
                          <span className={`text-xs font-medium ${palette.text}`}>
                            Book {palette.label} — {book.library.name}
                          </span>
                          {isPrimary && (
                            <span className="ml-auto rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-wider text-white">
                              Primary
                            </span>
                          )}
                        </div>

                        {/* Cover art — contained, full artwork visible */}
                        <div className="flex h-52 w-full items-center justify-center bg-black/30 p-4">
                          {book.coverPath ? (
                            <img
                              src={book.coverPath}
                              alt={book.title}
                              className="max-h-full max-w-full object-contain drop-shadow-2xl"
                            />
                          ) : (
                            <BookCoverPlaceholder size="lg" />
                          )}
                        </div>

                        {/* Book details */}
                        <div className="flex flex-1 flex-col gap-3 p-4">
                          <div>
                            <h3 className="text-base font-semibold leading-snug">{book.title}</h3>
                            <p className="mt-0.5 text-sm text-gray-300">{book.author.name}</p>
                            {book.series && (
                              <p className="mt-0.5 text-xs text-gray-400">
                                {book.series.name}
                                {book.sequence ? ` #${book.sequence}` : ""}
                              </p>
                            )}
                          </div>

                          {/* Metadata pills */}
                          <div className="flex flex-wrap gap-1.5">
                            {book.year && (
                              <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300">
                                {book.year}
                              </span>
                            )}
                            <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300">
                              {formatDuration(book.duration)}
                            </span>
                            <span className="flex items-center gap-1 rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300">
                              <HardDrive size={9} />
                              {book.audioFiles.length} file{book.audioFiles.length !== 1 ? "s" : ""}
                            </span>
                            {book.progress.length > 0 && (
                              <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300">
                                {book.progress.length} listener{book.progress.length !== 1 ? "s" : ""}
                              </span>
                            )}
                            {book.narrator && (
                              <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300">
                                {book.narrator}
                              </span>
                            )}
                          </div>

                          {/* Folder path */}
                          <p className="break-all text-[11px] leading-relaxed text-gray-500">
                            {book.folderPath}
                          </p>

                          {/* Action buttons */}
                          <div className="mt-auto space-y-2 pt-1">
                            <button
                              onClick={() => setPrimaryBookId(book.id)}
                              className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-all ${
                                isPrimary
                                  ? `${palette.activePrimaryBtn} border`
                                  : "border-border bg-black/10 text-gray-200 hover:border-gray-500"
                              }`}
                            >
                              {isPrimary && <Check size={15} />}
                              {isPrimary ? "Primary Target" : "Set as Primary"}
                            </button>

                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={() => setMetadataSourceId(book.id)}
                                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs transition-all ${
                                  isMetadata
                                    ? "border-white/20 bg-white/10 text-white"
                                    : "border-border bg-black/10 text-gray-300 hover:border-gray-500"
                                }`}
                              >
                                {isMetadata && <Check size={10} />}
                                Use Metadata
                              </button>
                              <button
                                onClick={() => setProgressSourceId(book.id)}
                                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs transition-all ${
                                  isProgress
                                    ? "border-white/20 bg-white/10 text-white"
                                    : "border-border bg-black/10 text-gray-300 hover:border-gray-500"
                                }`}
                              >
                                {isProgress && <Check size={10} />}
                                Use Progress
                              </button>
                            </div>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              </section>

              {/* ── Metadata comparison table ── */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-gray-200">
                    <Info size={15} className="text-gray-400" />
                    Field-by-Field Comparison
                  </h2>
                  <button
                    onClick={() => setShowIdentical(!showIdentical)}
                    className="flex items-center gap-1.5 rounded-full border border-border bg-white/5 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:border-gray-500 hover:text-gray-200"
                  >
                    {showIdentical ? <EyeOff size={12} /> : <Eye size={12} />}
                    {showIdentical ? "Hide identical rows" : "Show identical rows"}
                  </button>
                </div>

                <div className="overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-2xl shadow-black/20">

                  {/* Column headers — with cover art per book */}
                  <div
                    className="grid border-b border-border"
                    style={{
                      gridTemplateColumns: `160px repeat(${currentGroup.books.length}, minmax(0, 1fr))`,
                    }}
                  >
                    <div className="border-r border-border px-4 py-4">
                      <span className="text-xs font-semibold uppercase tracking-widest text-gray-500">Field</span>
                    </div>

                    {currentGroup.books.map((book, bookIndex) => {
                      const palette = BOOK_PALETTE[bookIndex % BOOK_PALETTE.length];
                      const isSource = book.id === metadataSourceId;
                      return (
                        <div
                          key={book.id}
                          className={`border-r border-border px-4 py-3 last:border-r-0 ${
                            isSource ? palette.colHeaderBg : "bg-white/3"
                          }`}
                        >
                          <div className="flex items-center gap-3">
                            {/* Cover thumbnail */}
                            <div className="h-14 w-10 flex-shrink-0 overflow-hidden rounded-lg border border-border/60 bg-black/30 shadow-md">
                              {book.coverPath ? (
                                <img
                                  src={book.coverPath}
                                  alt=""
                                  className="h-full w-full object-cover"
                                />
                              ) : (
                                <BookCoverPlaceholder size="sm" />
                              )}
                            </div>

                            <div className="min-w-0">
                              <div className="mb-1 flex items-center gap-1.5">
                                <span
                                  className={`inline-flex h-4 w-4 items-center justify-center rounded-full ${palette.badgeBg} text-[9px] font-bold text-white`}
                                >
                                  {palette.label}
                                </span>
                                {isSource && (
                                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                                    Metadata source
                                  </span>
                                )}
                              </div>
                              <div
                                className="truncate text-xs font-semibold text-white"
                                title={book.title}
                              >
                                {book.title}
                              </div>
                              <div className="truncate text-[10px] text-gray-400">
                                {book.author.name}
                              </div>
                              <div className={`text-[10px] ${palette.text}`}>
                                {book.library.name}
                              </div>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Comparison rows */}
                  <div className="divide-y divide-border/40">
                    {comparisonFields.map((field) => {
                      const values = currentGroup.books.map((book) =>
                        "val" in field ? field.val(book) : book[field.key],
                      );
                      const strValues = values.map((v) => String(v ?? ""));
                      const allSame = strValues.every((v) => v === strValues[0]);

                      if (allSame && !showIdentical) return null;

                      return (
                        <div
                          key={field.key}
                          className={`grid ${allSame ? "opacity-60" : "bg-yellow-400/3"}`}
                          style={{
                            gridTemplateColumns: `160px repeat(${currentGroup.books.length}, minmax(0, 1fr))`,
                          }}
                        >
                          {/* Field label */}
                          <div className="flex flex-col justify-center border-r border-border/40 px-4 py-3">
                            <span className="text-sm font-medium text-gray-300">{field.label}</span>
                            {!allSame && (
                              <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-yellow-500">
                                differs
                              </span>
                            )}
                          </div>

                          {/* Per-book value cells */}
                          {currentGroup.books.map((book, bookIndex) => {
                            const palette = BOOK_PALETTE[bookIndex % BOOK_PALETTE.length];
                            const value = values[bookIndex];
                            const isSource = book.id === metadataSourceId;
                            return (
                              <div
                                key={book.id}
                                className={`border-r border-border/40 px-3 py-3 text-sm last:border-r-0 ${
                                  isSource ? palette.cellHighlight : "text-gray-300"
                                }`}
                              >
                                {value != null && String(value) !== "" ? (
                                  String(value)
                                ) : (
                                  <span className="italic text-gray-600">—</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      );
                    })}

                    {/* Message if all rows are identical and hidden */}
                    {!showIdentical &&
                      comparisonFields.every((field) => {
                        const values = currentGroup.books.map((book) =>
                          "val" in field ? field.val(book) : book[field.key],
                        );
                        const strValues = values.map((v) => String(v ?? ""));
                        return strValues.every((v) => v === strValues[0]);
                      }) && (
                        <div className="px-4 py-6 text-center text-sm text-gray-500">
                          All metadata fields are identical.{" "}
                          <button
                            className="text-gray-300 underline hover:text-white"
                            onClick={() => setShowIdentical(true)}
                          >
                            Show all rows
                          </button>
                        </div>
                      )}
                  </div>
                </div>
              </section>

              {/* ── Audio files ── */}
              <section>
                <div className="mb-3 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="flex items-center gap-2 text-base font-semibold text-gray-200">
                    <Mic size={15} className="text-gray-400" />
                    Audio Files
                  </h2>
                  <span className="text-sm text-gray-400">
                    {keptCount} keeping in primary · {keptInSubfolderCount} keeping in subfolder · {deletedCount} deleting
                  </span>
                </div>

                <div className="space-y-4">
                  {currentGroup.books.map((book, bookIndex) => {
                    const palette = BOOK_PALETTE[bookIndex % BOOK_PALETTE.length];
                    return (
                      <div
                        key={book.id}
                        className={`overflow-hidden rounded-2xl border-2 shadow-xl shadow-black/20 ${palette.cardBorder}`}
                      >
                        {/* Book group header */}
                        <div
                          className={`flex items-center gap-3 border-b border-border/50 px-4 py-3 ${palette.cardBg}`}
                        >
                          {/* Cover thumbnail */}
                          <div className="h-11 w-8 flex-shrink-0 overflow-hidden rounded border border-border/60 bg-black/30 shadow">
                            {book.coverPath ? (
                              <img
                                src={book.coverPath}
                                alt=""
                                className="h-full w-full object-cover"
                              />
                            ) : (
                              <BookCoverPlaceholder size="sm" />
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span
                                className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full ${palette.badgeBg} text-[10px] font-bold text-white`}
                              >
                                {palette.label}
                              </span>
                              <span className="truncate text-sm font-medium" title={book.title}>
                                {book.title}
                              </span>
                            </div>
                            <div className={`mt-0.5 text-xs ${palette.text}`}>
                              {book.library.name} · {book.audioFiles.length} file
                              {book.audioFiles.length !== 1 ? "s" : ""} · {formatDuration(book.duration)}
                            </div>
                          </div>

                          <button
                            className={`flex-shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-colors ${
                              primaryBookId === book.id
                                ? `${palette.badgeBg} border-transparent text-white`
                                : "border-border bg-black/20 text-gray-300 hover:border-gray-500"
                            }`}
                            onClick={() => setPrimaryBookId(book.id)}
                          >
                            {primaryBookId === book.id ? "Primary" : "Set Primary"}
                          </button>
                        </div>

                        {/* File rows */}
                        <div className="divide-y divide-border/40 bg-surface/90">
                          {book.audioFiles.map((file) => (
                            <div
                              key={file.id}
                              className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_150px_170px] md:items-center"
                            >
                              <div className="min-w-0">
                                <div
                                  className="truncate text-sm font-medium text-gray-100"
                                  title={file.filename}
                                >
                                  {file.filename}
                                </div>
                                <div
                                  className="truncate text-[11px] text-gray-500"
                                  title={file.path}
                                >
                                  {file.path}
                                </div>
                              </div>

                              <div className="text-xs text-gray-400">
                                {file.title ? (
                                  <div className="truncate">{file.title}</div>
                                ) : (
                                  <div className="italic text-gray-600">No title tag</div>
                                )}
                                <div className="text-gray-500">{formatDuration(file.duration)}</div>
                              </div>

                              <select
                                className={`w-full rounded-lg border bg-black/30 px-3 py-2 text-xs outline-none focus:border-primary ${
                                  fileActions[file.id] === "delete"
                                    ? "border-red-400/40 text-red-300"
                                    : fileActions[file.id] === "keep_sub"
                                      ? "border-yellow-400/40 text-yellow-300"
                                      : "border-green-400/30 text-green-300"
                                }`}
                                value={fileActions[file.id]}
                                onChange={(e) =>
                                  setFileActions((prev) => ({
                                    ...prev,
                                    [file.id]: e.target.value as "keep" | "delete" | "keep_sub",
                                  }))
                                }
                              >
                                <option value="keep">Keep in primary</option>
                                <option value="keep_sub">Keep in subfolder</option>
                                <option value="delete">Delete file</option>
                              </select>
                            </div>
                          ))}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </section>

            </main>
          </div>
        )}
      </div>
    </div>
  );
};

export default DuplicatesPage;
