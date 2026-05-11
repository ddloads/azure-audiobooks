import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Check,
  Copy,
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
  { label: "Sequence", key: "sequence" },
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
  const keptCount = Object.values(fileActions).filter((value) => value === "keep").length;
  const keptInSubfolderCount = Object.values(fileActions).filter((value) => value === "keep_sub").length;
  const deletedCount = Object.values(fileActions).filter((value) => value === "delete").length;
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
        <header className="mb-6 flex flex-col gap-4 xl:flex-row xl:items-start xl:justify-between">
          <div className="flex items-start gap-4">
            <button onClick={() => navigate(backTarget)} className="btn btn-secondary rounded-full p-2">
              <ArrowLeft size={20} />
            </button>
            <div className="space-y-3">
              <div>
                <h1 className="text-2xl font-semibold tracking-tight md:text-3xl">Duplicate Resolver</h1>
                <p className="mt-1 text-sm text-gray-300">
                  {groups.length} duplicate groups across {affectedBookCount} books.
                </p>
              </div>

              <div className="flex flex-wrap gap-2">
                <span className="rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-gray-200">
                  Library-wide normalized matching
                </span>
                {currentGroup ? (
                  <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
                    {duplicateTypeLabel[currentGroup.type]}
                  </span>
                ) : null}
                <span className="rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-gray-200">
                  {keptCount} keep
                </span>
                <span className="rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-gray-200">
                  {keptInSubfolderCount} subfolder
                </span>
                <span className="rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-gray-200">
                  {deletedCount} delete
                </span>
              </div>
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
          <div className="grid grid-cols-1 gap-6 xl:grid-cols-[320px_minmax(0,1fr)]">
            <aside className="h-fit overflow-hidden rounded-2xl border border-border bg-surface/95 shadow-2xl shadow-black/20 backdrop-blur-sm xl:sticky xl:top-6">
              <div className="border-b border-border bg-white/5 px-4 py-4">
                <div className="text-sm font-semibold uppercase tracking-[0.18em] text-gray-400">Groups</div>
                <div className="mt-1 text-sm text-gray-300">Select a cluster to review.</div>
              </div>
              <div className="max-h-[72vh] overflow-y-auto p-2">
                {groups.map((group, index) => {
                  const selected = selectedGroupIndex === index;
                  const firstTitle = group.books[0]?.title || "Untitled";
                  const reason = duplicateTypeLabel[group.type];

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
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium text-white" title={firstTitle}>
                            {firstTitle}
                          </div>
                          <div className="mt-1 text-xs text-gray-400">
                            {group.books.length} books in this group
                          </div>
                        </div>
                        <span className="rounded-full border border-white/10 bg-white/10 px-2 py-1 text-[10px] uppercase tracking-wide text-gray-200">
                          {group.type}
                        </span>
                      </div>
                      <div className="mt-3 flex flex-wrap gap-2 text-[11px] text-gray-300">
                        <span className="rounded-full bg-black/20 px-2 py-1">{reason}</span>
                        <span className="rounded-full bg-black/20 px-2 py-1">{group.key || "normal match"}</span>
                      </div>
                    </button>
                  );
                })}
              </div>
            </aside>

            <main className="space-y-6">
              <section className="rounded-2xl border border-border bg-surface/95 p-5 shadow-2xl shadow-black/20 backdrop-blur-sm">
                <div className="flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-xs text-primary">
                        {duplicateTypeLabel[currentGroup.type]}
                      </span>
                      <span className="rounded-full border border-border bg-white/5 px-3 py-1 text-xs text-gray-200">
                        {currentGroup.books.length} versions
                      </span>
                    </div>
                    <h2 className="text-xl font-semibold tracking-tight">
                      {currentGroup.books[0]?.title || "Duplicate group"}
                    </h2>
                    <p className="max-w-3xl text-sm text-gray-300">
                      Review the candidates below, choose the primary record, and then keep metadata and progress
                      from the version you trust most.
                    </p>
                  </div>

                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    <div className="rounded-xl border border-border bg-black/20 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">Books</div>
                      <div className="mt-1 text-lg font-semibold">{currentGroup.books.length}</div>
                    </div>
                    <div className="rounded-xl border border-border bg-black/20 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">Files</div>
                      <div className="mt-1 text-lg font-semibold">
                        {currentGroup.books.reduce((sum, book) => sum + book.audioFiles.length, 0)}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-black/20 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">Primary</div>
                      <div className="mt-1 text-lg font-semibold">
                        {currentGroup.books.find((book) => book.id === primaryBookId)?.library.name || "Unset"}
                      </div>
                    </div>
                    <div className="rounded-xl border border-border bg-black/20 px-3 py-2">
                      <div className="text-[10px] uppercase tracking-wide text-gray-400">Actions</div>
                      <div className="mt-1 text-lg font-semibold">{deletedCount + keptCount + keptInSubfolderCount}</div>
                    </div>
                  </div>
                </div>
              </section>

              <section className="grid grid-cols-1 gap-4 2xl:grid-cols-2">
                {currentGroup.books.map((book) => {
                  const isPrimary = primaryBookId === book.id;
                  const isMetadata = metadataSourceId === book.id;
                  const isProgress = progressSourceId === book.id;

                  return (
                    <article
                      key={book.id}
                      className={`rounded-2xl border p-5 shadow-2xl shadow-black/20 transition-all ${
                        isPrimary ? "border-primary/60 bg-primary/10" : "border-border bg-white/5"
                      }`}
                    >
                      <div className="flex gap-4">
                        <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-xl border border-border bg-black/20">
                          {book.coverPath ? (
                            <img src={book.coverPath} alt="" className="h-full w-full object-cover" />
                          ) : (
                            <div className="flex h-full w-full items-center justify-center">
                              <BookOpen className="text-gray-500" />
                            </div>
                          )}
                        </div>

                        <div className="min-w-0 flex-1 space-y-2">
                          <div className="flex items-start justify-between gap-3">
                            <div className="min-w-0">
                              <h3 className="truncate text-lg font-semibold" title={book.title}>
                                {book.title}
                              </h3>
                              <p className="truncate text-sm text-gray-300">{book.author.name}</p>
                            </div>
                            {isPrimary ? (
                              <span className="rounded-full bg-primary px-2.5 py-1 text-[10px] font-semibold uppercase tracking-wide text-white">
                                Primary
                              </span>
                            ) : null}
                          </div>

                          <div className="flex flex-wrap gap-2 text-xs text-gray-200">
                            <span className="flex items-center gap-1 rounded-full bg-black/20 px-2.5 py-1">
                              <HardDrive size={10} /> {book.library.name}
                            </span>
                            <span className="rounded-full bg-black/20 px-2.5 py-1">{formatDuration(book.duration)}</span>
                            <span className="rounded-full bg-black/20 px-2.5 py-1">
                              {book.audioFiles.length} files
                            </span>
                          </div>

                          <div className="text-xs text-gray-400">
                            <span className="font-medium text-gray-300">Path:</span>{" "}
                            <span className="break-all">{book.folderPath}</span>
                          </div>
                        </div>
                      </div>

                      <div className="mt-5 space-y-3">
                        <button
                          className={`flex w-full items-center justify-center gap-2 rounded-xl border px-4 py-2.5 text-sm transition-colors ${
                            isPrimary
                              ? "border-primary bg-primary text-white"
                              : "border-border bg-black/10 hover:border-gray-500"
                          }`}
                          onClick={() => setPrimaryBookId(book.id)}
                        >
                          {isPrimary ? <Check size={16} /> : null}
                          {isPrimary ? "Primary target" : "Set as primary"}
                        </button>

                        <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                          <button
                            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${
                              isMetadata
                                ? "border-white/20 bg-white/10 text-white"
                                : "border-border bg-black/10 text-gray-200 hover:border-gray-500"
                            }`}
                            onClick={() => setMetadataSourceId(book.id)}
                          >
                            {isMetadata ? <Check size={12} /> : null}
                            Keep metadata
                          </button>
                          <button
                            className={`flex items-center justify-center gap-2 rounded-xl border px-3 py-2 text-xs transition-colors ${
                              isProgress
                                ? "border-white/20 bg-white/10 text-white"
                                : "border-border bg-black/10 text-gray-200 hover:border-gray-500"
                            }`}
                            onClick={() => setProgressSourceId(book.id)}
                          >
                            {isProgress ? <Check size={12} /> : null}
                            Keep progress
                          </button>
                        </div>
                      </div>
                    </article>
                  );
                })}
              </section>

              <section className="rounded-2xl border border-border bg-surface/95 p-5 shadow-2xl shadow-black/20 backdrop-blur-sm">
                <div className="mb-4 flex items-center gap-2 text-lg font-semibold">
                  <Info size={16} /> Metadata comparison
                </div>

                <div className="overflow-hidden rounded-xl border border-border">
                  <div className="hidden grid-cols-[220px_repeat(2,minmax(0,1fr))] border-b border-border bg-white/5 text-xs uppercase tracking-wide text-gray-400 md:grid">
                    <div className="p-4">Field</div>
                    {currentGroup.books.map((book) => (
                      <div key={book.id} className="p-4">
                        {book.id === metadataSourceId ? (
                          <span className="mr-2 rounded-full bg-primary/15 px-2 py-0.5 text-[10px] text-primary">
                            Source
                          </span>
                        ) : null}
                        {book.library.name}
                      </div>
                    ))}
                  </div>

                  <div className="divide-y divide-border">
                    {comparisonFields.map((field) => (
                      <div
                        key={field.key}
                        className="grid gap-2 border-b border-border/60 bg-black/10 p-4 md:grid-cols-[220px_repeat(2,minmax(0,1fr))] md:items-start"
                      >
                        <div className="text-sm font-medium text-gray-300">{field.label}</div>
                        {currentGroup.books.map((book) => {
                          const value = "val" in field ? field.val(book) : book[field.key];
                          const isSource = book.id === metadataSourceId;
                          return (
                            <div
                              key={book.id}
                              className={`rounded-xl border px-3 py-2 text-sm ${
                                isSource
                                  ? "border-primary/40 bg-primary/10 text-white"
                                  : "border-border bg-black/20 text-gray-100"
                              }`}
                            >
                              {value ? String(value) : <span className="text-gray-500">None</span>}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                </div>
              </section>

              <section className="rounded-2xl border border-border bg-surface/95 p-5 shadow-2xl shadow-black/20 backdrop-blur-sm">
                <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2 text-lg font-semibold">
                    <Mic size={16} /> Audio files
                  </div>
                  <div className="text-sm text-gray-400">
                    {keptCount} keeping in primary | {keptInSubfolderCount} keeping in subfolder | {deletedCount} deleting
                  </div>
                </div>

                <div className="space-y-4">
                  {currentGroup.books.map((book) => (
                    <div key={book.id} className="rounded-xl border border-border bg-black/10">
                      <div className="flex flex-col gap-2 border-b border-border px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                        <div className="min-w-0">
                          <div className="truncate font-medium">{book.title}</div>
                          <div className="text-xs text-gray-400">
                            {book.library.name} | {book.audioFiles.length} files
                          </div>
                        </div>
                        <button
                          className={`rounded-full border px-3 py-1 text-xs transition-colors ${
                            primaryBookId === book.id
                              ? "border-primary bg-primary text-white"
                              : "border-border bg-black/20 text-gray-200 hover:border-gray-500"
                          }`}
                          onClick={() => setPrimaryBookId(book.id)}
                        >
                          {primaryBookId === book.id ? "Primary book" : "Set primary book"}
                        </button>
                      </div>

                      <div className="divide-y divide-border/70">
                        {book.audioFiles.map((file) => (
                          <div
                            key={file.id}
                            className="grid gap-3 px-4 py-3 md:grid-cols-[minmax(0,1fr)_160px_180px] md:items-center"
                          >
                            <div className="min-w-0">
                              <div className="truncate text-sm font-medium" title={file.filename}>
                                {file.filename}
                              </div>
                              <div className="truncate text-[11px] text-gray-500" title={file.path}>
                                {file.path}
                              </div>
                            </div>

                            <div className="text-xs text-gray-300">
                              {file.title ? <div className="truncate">Track: {file.title}</div> : <div>Track: unknown</div>}
                              <div className="text-gray-500">{formatDuration(file.duration)}</div>
                            </div>

                            <select
                              className={`w-full rounded-lg border bg-black/30 px-3 py-2 text-xs outline-none focus:border-primary ${
                                fileActions[file.id] === "delete" ? "border-red-400/40 text-red-300" : "border-border text-green-300"
                              }`}
                              value={fileActions[file.id]}
                              onChange={(event) =>
                                setFileActions((prev) => ({
                                  ...prev,
                                  [file.id]: event.target.value as "keep" | "delete" | "keep_sub",
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
                  ))}
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
