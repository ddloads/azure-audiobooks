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
  "title-author": "Title + author match",
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
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
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
      setSelectedGroupIndex(nextGroups.length > 0 ? Math.min(selectedGroupIndex!, nextGroups.length - 1) : null);
    } catch (error) {
      console.error("Merge failed", error);
      showToast({ title: "Resolution failed", tone: "error" });
    } finally {
      setIsMerging(false);
    }
  };

  if (loading) {
    return (
      <div className="duplicates-page flex h-screen flex-col items-center justify-center bg-background">
        <div className="animate-in fade-in zoom-in flex flex-col items-center gap-6 text-center duration-300">
          <div className="relative">
            <Loader2 className="animate-spin text-primary" size={64} strokeWidth={1.5} />
            <Copy
              className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/40"
              size={24}
            />
          </div>
          <div>
            <h2 className="mb-2 text-2xl font-bold">Scanning for duplicates</h2>
            <p className="max-w-md text-gray-400">
              Comparing ASINs, ISBNs, and normalized title and author data across your libraries.
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="duplicates-page container mx-auto min-h-screen px-4 py-6 text-white md:px-6">
      <header className="mb-8 flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
        <div className="flex items-start gap-4">
          <button onClick={() => navigate(backTarget)} className="btn btn-secondary rounded-full p-2">
            <ArrowLeft size={20} />
          </button>
          <div className="space-y-2">
            <div>
              <h1 className="text-2xl font-bold">Duplicate Resolver</h1>
              <p className="text-gray-400">
                {groups.length} duplicate groups across {affectedBookCount} books.
              </p>
            </div>
            <div className="flex flex-wrap gap-2 text-xs text-gray-300">
              <span className="rounded-full border border-border bg-white/5 px-3 py-1">
                Library-wide normalized matching
              </span>
              {currentGroup ? (
                <span className="rounded-full border border-primary/30 bg-primary/10 px-3 py-1 text-primary">
                  {duplicateTypeLabel[currentGroup.type]}
                </span>
              ) : null}
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
        <div className="mt-20 flex flex-col items-center justify-center rounded-xl border border-border bg-surface p-12">
          <Check size={64} className="mb-4 text-green-500" />
          <h2 className="text-2xl font-bold">No duplicates found</h2>
          <p className="text-gray-400">Your library is clean and organized.</p>
          <button onClick={() => navigate("/")} className="btn btn-primary mt-6 px-8">
            Return to Library
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-8 xl:grid-cols-12">
          <aside className="h-fit overflow-hidden rounded-xl border border-border bg-surface xl:col-span-4 2xl:col-span-3">
            <div className="border-b border-border p-4 font-bold">Groups</div>
            <div className="max-h-[70vh] overflow-y-auto">
              {groups.map((group, index) => (
                <button
                  key={`${group.type}-${group.key}-${index}`}
                  className={`w-full border-b border-border p-4 text-left transition-colors hover:bg-white/5 ${
                    selectedGroupIndex === index ? "border-l-4 border-l-primary bg-white/10" : ""
                  }`}
                  onClick={() => setSelectedGroupIndex(index)}
                >
                  <div className="truncate font-medium">{group.books[0].title}</div>
                  <div className="mt-1 flex items-center justify-between text-xs text-gray-500">
                    <span>{group.books.length} versions</span>
                    <span className="rounded bg-white/10 px-1.5 py-0.5 uppercase">{group.type}</span>
                  </div>
                  <div className="mt-2 truncate text-xs text-gray-400">{duplicateTypeLabel[group.type]}</div>
                </button>
              ))}
            </div>
          </aside>

          <main className="space-y-6 xl:col-span-8 2xl:col-span-9">
            <div className="grid grid-cols-1 gap-6 2xl:grid-cols-2">
              {currentGroup.books.map((book) => (
                <div
                  key={book.id}
                  className={`relative rounded-xl border-2 bg-surface p-6 transition-all ${
                    primaryBookId === book.id ? "border-primary" : "border-border"
                  }`}
                >
                  <div className="flex gap-4">
                    <div className="h-24 w-24 flex-shrink-0 overflow-hidden rounded-lg bg-black/20">
                      {book.coverPath ? (
                        <img src={book.coverPath} alt="" className="h-full w-full object-cover" />
                      ) : (
                        <div className="flex h-full w-full items-center justify-center">
                          <BookOpen className="text-gray-600" />
                        </div>
                      )}
                    </div>
                    <div className="min-w-0 flex-grow">
                      <h3 className="truncate text-lg font-bold" title={book.title}>
                        {book.title}
                      </h3>
                      <p className="truncate text-sm text-gray-400">{book.author.name}</p>
                      <div className="mt-2 flex flex-wrap gap-2 text-xs">
                        <span className="flex items-center gap-1 rounded bg-white/5 px-2 py-0.5">
                          <HardDrive size={10} /> {book.library.name}
                        </span>
                        <span className="rounded bg-white/5 px-2 py-0.5">{formatDuration(book.duration)}</span>
                        <span className="rounded bg-white/5 px-2 py-0.5">{book.audioFiles.length} files</span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">
                    <button
                      className={`flex w-full items-center justify-center gap-2 rounded-lg border py-2 transition-colors ${
                        primaryBookId === book.id
                          ? "border-primary bg-primary text-white"
                          : "border-border hover:border-gray-500"
                      }`}
                      onClick={() => setPrimaryBookId(book.id)}
                    >
                      {primaryBookId === book.id ? <Check size={16} /> : null}
                      {primaryBookId === book.id ? "Primary Target" : "Set as Primary"}
                    </button>

                    <div className="flex gap-2">
                      <button
                        className={`flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 text-xs transition-colors ${
                          metadataSourceId === book.id
                            ? "border-white/20 bg-white/10"
                            : "border-border hover:border-gray-500"
                        }`}
                        onClick={() => setMetadataSourceId(book.id)}
                      >
                        {metadataSourceId === book.id ? <Check size={12} /> : null}
                        Keep Metadata
                      </button>
                      <button
                        className={`flex flex-1 items-center justify-center gap-1 rounded-lg border py-1.5 text-xs transition-colors ${
                          progressSourceId === book.id
                            ? "border-white/20 bg-white/10"
                            : "border-border hover:border-gray-500"
                        }`}
                        onClick={() => setProgressSourceId(book.id)}
                      >
                        {progressSourceId === book.id ? <Check size={12} /> : null}
                        Keep Progress
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 border-t border-border/50 pt-4 text-xs text-gray-400">
                    <div className="truncate" title={book.folderPath}>
                      <span className="font-bold text-gray-500">Path:</span> {book.folderPath}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex items-center gap-2 bg-white/5 p-4 font-bold">
                <Info size={16} /> Metadata Comparison
              </div>
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-gray-500">
                      <th className="w-1/4 p-4 text-left">Field</th>
                      {currentGroup.books.map((book) => (
                        <th key={book.id} className="p-4 text-left">
                          {book.id === metadataSourceId ? <span className="mr-1 text-primary">●</span> : null}
                          {book.library.name} Version
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {comparisonFields.map((field) => (
                      <tr key={field.key} className="border-b border-border/50 hover:bg-white/2">
                        <td className="p-4 font-medium text-gray-400">{field.label}</td>
                        {currentGroup.books.map((book) => {
                          const value = "val" in field ? field.val(book) : book[field.key];
                          return (
                            <td key={book.id} className="p-4">
                              {value ? String(value) : <span className="italic text-gray-600">None</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="overflow-hidden rounded-xl border border-border bg-surface">
              <div className="flex flex-col gap-2 bg-white/5 p-4 font-bold sm:flex-row sm:items-center sm:justify-between">
                <div className="flex items-center gap-2">
                  <Mic size={16} /> Audio Files Management
                </div>
                <div className="text-xs text-gray-400">
                  {keptCount} keeping in primary · {keptInSubfolderCount} keeping in subfolder · {deletedCount} deleting
                </div>
              </div>
              <div className="max-h-[500px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 z-10 bg-surface">
                    <tr className="border-b border-border text-gray-500">
                      <th className="p-4 text-left">File Name / Path</th>
                      <th className="w-32 p-4 text-left">Source</th>
                      <th className="w-48 p-4 text-right">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentGroup.books.flatMap((book) =>
                      book.audioFiles.map((file) => (
                        <tr key={file.id} className="border-b border-border/50 hover:bg-white/2">
                          <td className="p-4">
                            <div className="max-w-[400px] truncate font-medium" title={file.filename}>
                              {file.filename}
                            </div>
                            <div className="max-w-[400px] truncate text-[10px] text-gray-500" title={file.path}>
                              {file.path}
                            </div>
                          </td>
                          <td className="p-4">
                            <span className="rounded bg-white/5 px-2 py-0.5 text-xs">{book.library.name}</span>
                          </td>
                          <td className="p-4 text-right">
                            <select
                              className={`rounded border border-border bg-black/40 px-2 py-1 text-xs outline-none focus:border-primary ${
                                fileActions[file.id] === "delete" ? "text-red-400" : "text-green-400"
                              }`}
                              value={fileActions[file.id]}
                              onChange={(event) =>
                                setFileActions((prev) => ({
                                  ...prev,
                                  [file.id]: event.target.value as "keep" | "delete" | "keep_sub",
                                }))
                              }
                            >
                              <option value="keep">Keep (Primary)</option>
                              <option value="keep_sub">Keep (Subfolder)</option>
                              <option value="delete">Delete File</option>
                            </select>
                          </td>
                        </tr>
                      )),
                    )}
                  </tbody>
                </table>
              </div>
            </div>
          </main>
        </div>
      )}
    </div>
  );
};

export default DuplicatesPage;
