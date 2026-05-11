import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
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
  coverPath?: string | null;
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
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

// Per-book slot colours — inline styles so they always render regardless of Tailwind scan
const PALETTE = [
  {
    label: "A",
    hex: "#3b82f6",      // blue-500
    textCls: "text-blue-400",
    badgeCls: "bg-blue-500 text-white",
    cardBg: "rgba(59,130,246,0.08)",
    cardBorder: "rgba(59,130,246,0.55)",
    headerBg: "rgba(59,130,246,0.10)",
    cellBg: "rgba(59,130,246,0.10)",
    cellBorderLeft: "2px solid rgba(59,130,246,0.55)",
    btnActive: "bg-blue-600 hover:bg-blue-500 border-blue-500 text-white",
    coverGradient: "linear-gradient(135deg, rgba(59,130,246,0.35) 0%, rgba(59,130,246,0.05) 100%)",
  },
  {
    label: "B",
    hex: "#f59e0b",      // amber-500
    textCls: "text-amber-400",
    badgeCls: "bg-amber-500 text-white",
    cardBg: "rgba(245,158,11,0.08)",
    cardBorder: "rgba(245,158,11,0.55)",
    headerBg: "rgba(245,158,11,0.10)",
    cellBg: "rgba(245,158,11,0.10)",
    cellBorderLeft: "2px solid rgba(245,158,11,0.55)",
    btnActive: "bg-amber-600 hover:bg-amber-500 border-amber-500 text-white",
    coverGradient: "linear-gradient(135deg, rgba(245,158,11,0.35) 0%, rgba(245,158,11,0.05) 100%)",
  },
  {
    label: "C",
    hex: "#22c55e",      // green-500
    textCls: "text-green-400",
    badgeCls: "bg-green-500 text-white",
    cardBg: "rgba(34,197,94,0.08)",
    cardBorder: "rgba(34,197,94,0.55)",
    headerBg: "rgba(34,197,94,0.10)",
    cellBg: "rgba(34,197,94,0.10)",
    cellBorderLeft: "2px solid rgba(34,197,94,0.55)",
    btnActive: "bg-green-600 hover:bg-green-500 border-green-500 text-white",
    coverGradient: "linear-gradient(135deg, rgba(34,197,94,0.35) 0%, rgba(34,197,94,0.05) 100%)",
  },
  {
    label: "D",
    hex: "#f43f5e",      // rose-500
    textCls: "text-rose-400",
    badgeCls: "bg-rose-500 text-white",
    cardBg: "rgba(244,63,94,0.08)",
    cardBorder: "rgba(244,63,94,0.55)",
    headerBg: "rgba(244,63,94,0.10)",
    cellBg: "rgba(244,63,94,0.10)",
    cellBorderLeft: "2px solid rgba(244,63,94,0.55)",
    btnActive: "bg-rose-600 hover:bg-rose-500 border-rose-500 text-white",
    coverGradient: "linear-gradient(135deg, rgba(244,63,94,0.35) 0%, rgba(244,63,94,0.05) 100%)",
  },
];


// ── Main component ────────────────────────────────────────────────────────────
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
      if (res.data.length === 0) { setSelectedGroupIndex(null); return; }
      if (initialBookId) {
        const idx = res.data.findIndex((g) => g.books.some((b) => b.id === initialBookId));
        setSelectedGroupIndex(idx >= 0 ? idx : 0);
        return;
      }
      setSelectedGroupIndex(0);
    } catch {
      showToast({ title: "Failed to load duplicates", tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { void fetchGroups(); }, []);

  const currentGroup = selectedGroupIndex !== null ? groups[selectedGroupIndex] : null;
  const keptCount        = Object.values(fileActions).filter((v) => v === "keep").length;
  const keptSubCount     = Object.values(fileActions).filter((v) => v === "keep_sub").length;
  const deletedCount     = Object.values(fileActions).filter((v) => v === "delete").length;
  const affectedBookCount = groups.reduce((n, g) => n + g.books.length, 0);

  useEffect(() => {
    if (!currentGroup?.books.length) return;
    setPrimaryBookId(currentGroup.books[0].id);
    setMetadataSourceId(currentGroup.books[0].id);
    setProgressSourceId(currentGroup.books[0].id);
    const acts: Record<string, "keep" | "delete" | "keep_sub"> = {};
    currentGroup.books.forEach((book, bi) => {
      book.audioFiles.forEach((f) => { acts[f.id] = bi === 0 ? "keep" : "delete"; });
    });
    setFileActions(acts);
  }, [currentGroup]);

  const handleMerge = async () => {
    if (!currentGroup || !primaryBookId) return;
    setIsMerging(true);
    try {
      const metaBook = currentGroup.books.find((b) => b.id === metadataSourceId);
      await api.post("/admin/duplicates/resolve", {
        primaryBookId,
        secondaryBookIds: currentGroup.books.filter((b) => b.id !== primaryBookId).map((b) => b.id),
        metadata: metaBook
          ? {
              title: metaBook.title, subtitle: metaBook.subtitle, authorId: metaBook.author.id,
              seriesId: metaBook.series?.id, sequence: metaBook.sequence, narrator: metaBook.narrator,
              publisher: metaBook.publisher, year: metaBook.year, genres: metaBook.genres,
              tags: metaBook.tags, language: metaBook.language, isbn: metaBook.isbn,
              asin: metaBook.asin, abridged: metaBook.abridged,
            }
          : undefined,
        keepProgressFromBookId: progressSourceId,
        audioFileActions: Object.entries(fileActions).map(([id, action]) => ({ audioFileId: id, action })),
      });
      showToast({ title: "Duplicates resolved successfully", tone: "success" });
      const next = [...groups];
      next.splice(selectedGroupIndex!, 1);
      setGroups(next);
      setSelectedGroupIndex(next.length > 0 ? Math.min(selectedGroupIndex!, next.length - 1) : null);
    } catch {
      showToast({ title: "Resolution failed", tone: "error" });
    } finally {
      setIsMerging(false);
    }
  };

  // ── Loading ───────────────────────────────────────────────────────────────
  if (loading) {
    return (
      <div className="relative min-h-screen overflow-hidden bg-background text-white">
        <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_28%)]" />
        <div className="relative flex min-h-screen flex-col items-center justify-center gap-5 px-4 text-center">
          <div className="relative">
            <Loader2 className="animate-spin text-primary" size={64} strokeWidth={1.5} />
            <Copy className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/35" size={24} />
          </div>
          <div className="max-w-lg space-y-2">
            <h2 className="text-2xl font-semibold tracking-tight">Scanning for duplicates</h2>
            <p className="text-sm text-gray-400">Comparing ASINs, ISBNs, and normalised title + author data across your libraries.</p>
          </div>
        </div>
      </div>
    );
  }

  // ── Main render ───────────────────────────────────────────────────────────
  return (
    <div className="relative min-h-screen overflow-hidden bg-background text-white">
      <div className="pointer-events-none absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(139,92,246,0.14),transparent_32%),radial-gradient(circle_at_top_right,rgba(59,130,246,0.10),transparent_28%)]" />

      <div className="relative mx-auto max-w-7xl px-4 py-6 md:px-6 lg:py-8">

        {/* Header */}
        <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-4">
            <button onClick={() => navigate(backTarget)} className="btn btn-secondary rounded-full p-2">
              <ArrowLeft size={20} />
            </button>
            <div>
              <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Duplicate Resolver</h1>
              <p className="mt-0.5 text-sm text-gray-400">
                {groups.length} group{groups.length !== 1 ? "s" : ""} · {affectedBookCount} affected books
              </p>
            </div>
          </div>
          <div className="flex flex-wrap gap-3">
            <button className="btn btn-secondary px-4 py-2" onClick={() => void fetchGroups()} disabled={loading}>
              Refresh Scan
            </button>
            {currentGroup && (
              <button className="btn btn-primary flex items-center gap-2 px-6 py-2" onClick={handleMerge} disabled={isMerging}>
                {isMerging ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
                Resolve &amp; Merge
              </button>
            )}
          </div>
        </header>

        {/* Empty state */}
        {!currentGroup ? (
          <div className="mt-16 rounded-2xl border border-white/10 bg-white/5 p-12 text-center">
            <Check size={56} className="mx-auto mb-4 text-green-400" />
            <h2 className="text-2xl font-semibold">No duplicates found</h2>
            <p className="mt-2 text-sm text-gray-400">Your library looks clean.</p>
            <button onClick={() => navigate("/")} className="btn btn-primary mt-6 px-8">Return to Library</button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[280px_minmax(0,1fr)]">

            {/* ── Sidebar: group list ── */}
            <aside className="xl:sticky xl:top-6 xl:h-fit">
              <div className="overflow-hidden rounded-2xl border border-white/10 bg-surface/95 shadow-2xl shadow-black/30">
                <div className="border-b border-white/10 px-4 py-3">
                  <p className="text-xs font-semibold uppercase tracking-widest text-gray-400">Duplicate Groups</p>
                </div>
                <div className="max-h-[75vh] overflow-y-auto p-2">
                  {groups.map((group, idx) => {
                    const active = selectedGroupIndex === idx;
                    const first = group.books[0];
                    const pal = PALETTE[0];
                    return (
                      <button
                        key={`${group.type}-${group.key}-${idx}`}
                        className={`mb-1.5 flex w-full items-center gap-3 rounded-xl border p-3 text-left transition-all ${
                          active
                            ? "border-primary/50 bg-primary/10"
                            : "border-transparent bg-white/5 hover:bg-white/10"
                        }`}
                        onClick={() => setSelectedGroupIndex(idx)}
                      >
                        {/* Mini cover */}
                        <div className="h-12 w-9 flex-shrink-0 overflow-hidden rounded-lg border border-white/10" style={{ background: pal.coverGradient }}>
                          {first?.coverPath
                            ? <img src={first.coverPath} alt="" className="h-full w-full object-cover" />
                            : <div className="flex h-full w-full items-center justify-center"><span className="text-sm font-black text-white/20">{String.fromCharCode(65)}</span></div>
                          }
                        </div>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium text-white" title={first?.title}>{first?.title ?? "Untitled"}</p>
                          <p className="mt-0.5 text-xs text-gray-500">{group.books.length} versions · {duplicateTypeLabel[group.type]}</p>
                        </div>
                        {active && <div className="h-2 w-2 flex-shrink-0 rounded-full bg-primary" />}
                      </button>
                    );
                  })}
                </div>
              </div>
            </aside>

            {/* ── Main panel ── */}
            <main className="min-w-0 space-y-6">

              {/* Match type badge row */}
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
                  {duplicateTypeLabel[currentGroup.type]}
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                  {currentGroup.books.length} versions detected
                </span>
                <span className="rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs text-gray-300">
                  {keptCount} keep · {keptSubCount} subfolder · {deletedCount} delete
                </span>
              </div>

              {/* ══════════════════════════════════════════════════
                  SECTION 1 — Side-by-side book cards
              ══════════════════════════════════════════════════ */}
              <section>
                <h2 className="mb-3 text-sm font-semibold uppercase tracking-widest text-gray-400">
                  Compare Versions
                </h2>

                <div
                  className="grid gap-4"
                  style={{ gridTemplateColumns: `repeat(${Math.min(currentGroup.books.length, 2)}, minmax(0,1fr))` }}
                >
                  {currentGroup.books.map((book, bi) => {
                    const pal = PALETTE[bi % PALETTE.length];
                    const isPrimary  = primaryBookId    === book.id;
                    const isMeta     = metadataSourceId === book.id;
                    const isProgress = progressSourceId === book.id;

                    return (
                      <article
                        key={book.id}
                        className="flex flex-col overflow-hidden rounded-2xl shadow-2xl shadow-black/30 transition-all"
                        style={{
                          background: isPrimary ? pal.cardBg : "rgba(16,29,53,0.95)",
                          border: `2px solid ${isPrimary ? pal.cardBorder : "rgba(148,163,184,0.12)"}`,
                        }}
                      >
                        {/* Slot header bar */}
                        <div
                          className="flex items-center gap-2.5 px-4 py-2.5"
                          style={{ background: pal.cardBg, borderBottom: "1px solid rgba(255,255,255,0.06)" }}
                        >
                          <span className={`inline-flex h-6 w-6 flex-shrink-0 items-center justify-center rounded-full text-xs font-bold ${pal.badgeCls}`}>
                            {pal.label}
                          </span>
                          <span className={`text-xs font-medium ${pal.textCls}`}>
                            Book {pal.label} — {book.library.name}
                          </span>
                          {isPrimary && (
                            <span className="ml-auto rounded-full bg-white/15 px-2.5 py-0.5 text-[10px] font-semibold uppercase tracking-widest text-white">
                              Primary
                            </span>
                          )}
                        </div>

                        {/* ── Cover art area ── */}
                        <div
                          className="relative flex h-56 w-full items-center justify-center overflow-hidden"
                          style={{ background: pal.coverGradient }}
                        >
                          {book.coverPath ? (
                            <img
                              src={book.coverPath}
                              alt={book.title}
                              className="h-full w-full object-contain p-4 drop-shadow-2xl"
                            />
                          ) : (
                            /* Rich no-cover placeholder */
                            <div className="flex flex-col items-center gap-3">
                              <div
                                className="flex h-28 w-20 items-center justify-center rounded-xl shadow-lg"
                                style={{ background: "rgba(0,0,0,0.25)", border: `1px solid ${pal.hex}44` }}
                              >
                                <span className="select-none text-5xl font-black" style={{ color: `${pal.hex}55` }}>
                                  {pal.label}
                                </span>
                              </div>
                              <span className="text-xs text-white/30">No cover art</span>
                            </div>
                          )}
                        </div>

                        {/* ── Book details ── */}
                        <div className="flex flex-1 flex-col gap-3 p-4">
                          <div>
                            <h3 className="text-base font-semibold leading-snug text-white">{book.title}</h3>
                            {book.subtitle && <p className="mt-0.5 text-sm text-gray-400">{book.subtitle}</p>}
                            <p className="mt-1 text-sm text-gray-300">{book.author.name}</p>
                            {book.series && (
                              <p className="mt-0.5 text-xs text-gray-500">
                                {book.series.name}{book.sequence ? ` · Book ${book.sequence}` : ""}
                              </p>
                            )}
                          </div>

                          {/* Metadata pills */}
                          <div className="flex flex-wrap gap-1.5">
                            {book.year && (
                              <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300">{book.year}</span>
                            )}
                            <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300">{formatDuration(book.duration)}</span>
                            <span className="flex items-center gap-1 rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300">
                              <HardDrive size={9} />{book.audioFiles.length} file{book.audioFiles.length !== 1 ? "s" : ""}
                            </span>
                            {book.progress.length > 0 && (
                              <span className="rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300">
                                {book.progress.length} listener{book.progress.length !== 1 ? "s" : ""}
                              </span>
                            )}
                            {book.narrator && (
                              <span className="max-w-[200px] truncate rounded-full bg-black/30 px-2.5 py-0.5 text-xs text-gray-300" title={book.narrator}>
                                {book.narrator}
                              </span>
                            )}
                          </div>

                          {/* Folder path */}
                          <p className="break-all text-[11px] leading-relaxed text-gray-600">{book.folderPath}</p>

                          {/* Action buttons */}
                          <div className="mt-auto space-y-2 pt-1">
                            <button
                              onClick={() => setPrimaryBookId(book.id)}
                              className={`flex w-full items-center justify-center gap-2 rounded-xl border py-2.5 text-sm font-medium transition-all ${
                                isPrimary
                                  ? `${pal.btnActive} border`
                                  : "border-white/10 bg-white/5 text-gray-300 hover:bg-white/10"
                              }`}
                            >
                              {isPrimary && <Check size={15} />}
                              {isPrimary ? "Primary Target" : "Set as Primary"}
                            </button>

                            <div className="grid grid-cols-2 gap-2">
                              <button
                                onClick={() => setMetadataSourceId(book.id)}
                                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition-all ${
                                  isMeta
                                    ? "border-white/20 bg-white/15 text-white"
                                    : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
                                }`}
                              >
                                {isMeta && <Check size={10} />}
                                Use Metadata
                              </button>
                              <button
                                onClick={() => setProgressSourceId(book.id)}
                                className={`flex items-center justify-center gap-1.5 rounded-xl border py-2 text-xs font-medium transition-all ${
                                  isProgress
                                    ? "border-white/20 bg-white/15 text-white"
                                    : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
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

              {/* ══════════════════════════════════════════════════
                  SECTION 2 — Field-by-field metadata comparison
              ══════════════════════════════════════════════════ */}
              <section>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-400">
                    <Info size={13} /> Metadata Comparison
                  </h2>
                  <button
                    onClick={() => setShowIdentical(!showIdentical)}
                    className="flex items-center gap-1.5 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-gray-400 transition-colors hover:bg-white/10 hover:text-gray-200"
                  >
                    {showIdentical ? <EyeOff size={11} /> : <Eye size={11} />}
                    {showIdentical ? "Hide identical" : "Show all fields"}
                  </button>
                </div>

                <div className="overflow-hidden rounded-2xl border border-white/10 bg-surface/95 shadow-xl shadow-black/20">
                  {/* Column headers — one per book with cover + title + author */}
                  <div
                    className="grid border-b border-white/10"
                    style={{ gridTemplateColumns: `160px repeat(${currentGroup.books.length}, minmax(0,1fr))` }}
                  >
                    <div className="flex items-end border-r border-white/10 px-4 py-3">
                      <span className="text-[10px] font-semibold uppercase tracking-widest text-gray-500">Field</span>
                    </div>
                    {currentGroup.books.map((book, bi) => {
                      const pal = PALETTE[bi % PALETTE.length];
                      const isSource = book.id === metadataSourceId;
                      return (
                        <div
                          key={book.id}
                          className="border-r border-white/10 px-4 py-3 last:border-r-0"
                          style={{ background: isSource ? pal.headerBg : "transparent" }}
                        >
                          <div className="flex items-start gap-3">
                            {/* Cover thumbnail */}
                            <div
                              className="h-16 w-12 flex-shrink-0 overflow-hidden rounded-lg border border-white/10 shadow-md"
                              style={{ background: pal.coverGradient }}
                            >
                              {book.coverPath ? (
                                <img src={book.coverPath} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center">
                                  <span className="text-xl font-black" style={{ color: `${pal.hex}44` }}>{pal.label}</span>
                                </div>
                              )}
                            </div>

                            <div className="min-w-0">
                              {/* Badge row */}
                              <div className="mb-1 flex items-center gap-1.5 flex-wrap">
                                <span className={`inline-flex h-4 w-4 items-center justify-center rounded-full text-[9px] font-bold ${pal.badgeCls}`}>
                                  {pal.label}
                                </span>
                                {isSource && (
                                  <span className="rounded-full bg-primary/15 px-1.5 py-0.5 text-[9px] font-semibold uppercase tracking-wide text-primary">
                                    Metadata source
                                  </span>
                                )}
                              </div>
                              <p className="truncate text-xs font-semibold text-white" title={book.title}>{book.title}</p>
                              <p className="truncate text-[10px] text-gray-400">{book.author.name}</p>
                              <p className={`text-[10px] ${pal.textCls}`}>{book.library.name}</p>
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>

                  {/* Rows */}
                  <div className="divide-y divide-white/5">
                    {(() => {
                      const rows = comparisonFields.map((field) => {
                        const values = currentGroup.books.map((b) =>
                          "val" in field ? field.val(b) : b[field.key],
                        );
                        const strs = values.map((v) => String(v ?? ""));
                        const allSame = strs.every((s) => s === strs[0]);
                        return { field, values, allSame };
                      });

                      const visibleRows = rows.filter((r) => !r.allSame || showIdentical);

                      if (visibleRows.length === 0) {
                        return (
                          <div className="px-4 py-8 text-center text-sm text-gray-500">
                            All metadata fields are identical.{" "}
                            <button className="text-gray-300 underline hover:text-white" onClick={() => setShowIdentical(true)}>
                              Show all fields
                            </button>
                          </div>
                        );
                      }

                      return visibleRows.map(({ field, values, allSame }) => (
                        <div
                          key={field.key}
                          className="grid"
                          style={{
                            gridTemplateColumns: `160px repeat(${currentGroup.books.length}, minmax(0,1fr))`,
                            opacity: allSame ? 0.55 : 1,
                            background: allSame ? "transparent" : "rgba(250,204,21,0.025)",
                          }}
                        >
                          {/* Field label */}
                          <div className="flex flex-col justify-center border-r border-white/10 px-4 py-3">
                            <span className="text-sm font-medium text-gray-300">{field.label}</span>
                            {!allSame && (
                              <span className="mt-0.5 text-[9px] font-semibold uppercase tracking-wider text-yellow-400/80">
                                differs
                              </span>
                            )}
                          </div>

                          {/* Per-book value cells */}
                          {currentGroup.books.map((book, bi) => {
                            const pal = PALETTE[bi % PALETTE.length];
                            const value = values[bi];
                            const isSource = book.id === metadataSourceId;
                            return (
                              <div
                                key={book.id}
                                className="border-r border-white/10 px-3 py-3 text-sm last:border-r-0"
                                style={isSource ? { background: pal.cellBg, borderLeft: pal.cellBorderLeft } : {}}
                              >
                                {value != null && String(value) !== "" ? (
                                  <span className={isSource ? "text-white" : "text-gray-300"}>{String(value)}</span>
                                ) : (
                                  <span className="italic text-gray-600">—</span>
                                )}
                              </div>
                            );
                          })}
                        </div>
                      ));
                    })()}
                  </div>
                </div>
              </section>

              {/* ══════════════════════════════════════════════════
                  SECTION 3 — Audio files
              ══════════════════════════════════════════════════ */}
              <section>
                <div className="mb-3 flex flex-col gap-1 sm:flex-row sm:items-center sm:justify-between">
                  <h2 className="flex items-center gap-2 text-sm font-semibold uppercase tracking-widest text-gray-400">
                    <Mic size={13} /> Audio Files
                  </h2>
                  <span className="text-xs text-gray-500">
                    {keptCount} keeping · {keptSubCount} subfolder · {deletedCount} deleting
                  </span>
                </div>

                <div className="space-y-4">
                  {currentGroup.books.map((book, bi) => {
                    const pal = PALETTE[bi % PALETTE.length];
                    return (
                      <div
                        key={book.id}
                        className="overflow-hidden rounded-2xl shadow-xl shadow-black/20"
                        style={{ border: `2px solid ${pal.cardBorder}` }}
                      >
                        {/* Book group header */}
                        <div
                          className="flex items-center gap-3 border-b border-white/10 px-4 py-3"
                          style={{ background: pal.cardBg }}
                        >
                          {/* Cover thumbnail */}
                          <div
                            className="h-12 w-9 flex-shrink-0 overflow-hidden rounded-lg border border-white/10"
                            style={{ background: pal.coverGradient }}
                          >
                            {book.coverPath ? (
                              <img src={book.coverPath} alt="" className="h-full w-full object-cover" />
                            ) : (
                              <div className="flex h-full w-full items-center justify-center">
                                <span className="text-base font-black" style={{ color: `${pal.hex}55` }}>{pal.label}</span>
                              </div>
                            )}
                          </div>

                          <div className="min-w-0 flex-1">
                            <div className="flex items-center gap-2">
                              <span className={`inline-flex h-5 w-5 flex-shrink-0 items-center justify-center rounded-full text-[10px] font-bold ${pal.badgeCls}`}>
                                {pal.label}
                              </span>
                              <span className="truncate text-sm font-semibold text-white" title={book.title}>{book.title}</span>
                            </div>
                            <p className={`mt-0.5 text-xs ${pal.textCls}`}>
                              {book.library.name} · {book.audioFiles.length} file{book.audioFiles.length !== 1 ? "s" : ""} · {formatDuration(book.duration)}
                            </p>
                          </div>

                          <button
                            className={`flex-shrink-0 rounded-full border px-3 py-1.5 text-xs font-medium transition-all ${
                              primaryBookId === book.id
                                ? `${pal.btnActive} border`
                                : "border-white/10 bg-white/5 text-gray-400 hover:bg-white/10"
                            }`}
                            onClick={() => setPrimaryBookId(book.id)}
                          >
                            {primaryBookId === book.id ? "Primary" : "Set Primary"}
                          </button>
                        </div>

                        {/* File rows */}
                        <div className="divide-y divide-white/5 bg-surface/90">
                          {book.audioFiles.map((file) => (
                            <div
                              key={file.id}
                              className="grid items-center gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_140px_170px]"
                            >
                              <div className="min-w-0">
                                <p className="truncate text-sm font-medium text-gray-100" title={file.filename}>{file.filename}</p>
                                <p className="truncate text-[11px] text-gray-600" title={file.path}>{file.path}</p>
                              </div>
                              <div className="text-xs text-gray-400">
                                {file.title
                                  ? <p className="truncate">{file.title}</p>
                                  : <p className="italic text-gray-600">No title tag</p>
                                }
                                <p className="text-gray-500">{formatDuration(file.duration)}</p>
                              </div>
                              <select
                                className={`w-full rounded-lg border bg-black/40 px-3 py-2 text-xs outline-none focus:border-primary ${
                                  fileActions[file.id] === "delete"
                                    ? "border-red-500/40 text-red-300"
                                    : fileActions[file.id] === "keep_sub"
                                      ? "border-yellow-400/40 text-yellow-300"
                                      : "border-green-500/30 text-green-300"
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
