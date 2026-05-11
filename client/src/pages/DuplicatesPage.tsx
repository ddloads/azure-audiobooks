import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Check,
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
  const [fileActions, setFileActions] = useState<Record<string, "keep" | "delete" | "keep_sub">>(
    {}
  );
  const [isMerging, setIsMerging] = useState(false);

  const backTarget =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/settings";

  const fetchGroups = async () => {
    setLoading(true);
    try {
      const res = await api.get<DuplicateGroup[]>("/admin/duplicates");
      setGroups(res.data);
      if (res.data.length > 0) {
        setSelectedGroupIndex(0);
      }
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

  useEffect(() => {
    if (currentGroup && currentGroup.books.length > 0) {
      setPrimaryBookId(currentGroup.books[0].id);
      setMetadataSourceId(currentGroup.books[0].id);
      setProgressSourceId(currentGroup.books[0].id);

      const initialActions: Record<string, "keep" | "delete" | "keep_sub"> = {};
      currentGroup.books.forEach((book, bIdx) => {
        book.audioFiles.forEach((file) => {
          initialActions[file.id] = bIdx === 0 ? "keep" : "delete";
        });
      });
      setFileActions(initialActions);
    }
  }, [currentGroup]);

  const handleMerge = async () => {
    if (!currentGroup || !primaryBookId) return;
    setIsMerging(true);
    try {
      const metadataBook = currentGroup.books.find((b) => b.id === metadataSourceId);

      const payload = {
        primaryBookId,
        secondaryBookIds: currentGroup.books
          .filter((b) => b.id !== primaryBookId)
          .map((b) => b.id),
        metadata: metadataBook ? {
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
        } : undefined,
        keepProgressFromBookId: progressSourceId,
        audioFileActions: Object.entries(fileActions).map(([id, action]) => ({
          audioFileId: id,
          action,
        })),
      };

      await api.post("/admin/duplicates/resolve", payload);
      showToast({ title: "Duplicates resolved successfully", tone: "success" });
      
      // Refresh groups
      const nextGroups = [...groups];
      nextGroups.splice(selectedGroupIndex!, 1);
      setGroups(nextGroups);
      if (nextGroups.length > 0) {
        setSelectedGroupIndex(Math.min(selectedGroupIndex!, nextGroups.length - 1));
      } else {
        setSelectedGroupIndex(null);
      }
    } catch (error) {
      console.error("Merge failed", error);
      showToast({ title: "Resolution failed", tone: "error" });
    } finally {
      setIsMerging(false);
    }
  };

  if (loading) {
    return (
      <div className="duplicates-page flex flex-col items-center justify-center h-screen bg-background">
        <div className="flex flex-col items-center gap-6 text-center animate-in fade-in zoom-in duration-300">
          <div className="relative">
            <Loader2 className="animate-spin text-primary" size={64} strokeWidth={1.5} />
            <Copy className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 text-primary/40" size={24} />
          </div>
          <div>
            <h2 className="text-2xl font-bold mb-2">Scanning for Duplicates</h2>
            <p className="text-gray-400 max-w-md">
              Comparing ASINs, ISBNs, and titles across your libraries to find matching content.
              This may take a moment...
            </p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="duplicates-page container mx-auto p-6 text-white min-h-screen">
      <header className="flex items-center justify-between mb-8">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate(backTarget)} className="btn btn-secondary p-2 rounded-full">
            <ArrowLeft size={20} />
          </button>
          <div>
            <h1 className="text-2xl font-bold">Duplicate Resolver</h1>
            <p className="text-gray-400">
              {groups.length} duplicate groups found in your library.
            </p>
          </div>
        </div>
        {currentGroup && (
          <button
            className="btn btn-primary px-6 py-2 flex items-center gap-2"
            onClick={handleMerge}
            disabled={isMerging}
          >
            {isMerging ? <Loader2 className="animate-spin" size={18} /> : <Check size={18} />}
            Resolve and Merge
          </button>
        )}
      </header>

      {!currentGroup ? (
        <div className="flex flex-col items-center justify-center mt-20 p-12 bg-surface rounded-xl border border-border">
          <Check size={64} className="text-green-500 mb-4" />
          <h2 className="text-2xl font-bold">No duplicates found!</h2>
          <p className="text-gray-400">Your library is clean and organized.</p>
          <button onClick={() => navigate("/")} className="btn btn-primary mt-6 px-8">
            Return to Library
          </button>
        </div>
      ) : (
        <div className="grid grid-cols-12 gap-8">
          {/* Sidebar: Group List */}
          <aside className="col-span-3 bg-surface rounded-xl border border-border overflow-hidden h-fit">
            <div className="p-4 border-b border-border font-bold">Groups</div>
            <div className="max-h-[70vh] overflow-y-auto">
              {groups.map((group, idx) => (
                <button
                  key={idx}
                  className={`w-full text-left p-4 border-b border-border transition-colors hover:bg-white/5 ${
                    selectedGroupIndex === idx ? "bg-white/10 border-l-4 border-l-primary" : ""
                  }`}
                  onClick={() => setSelectedGroupIndex(idx)}
                >
                  <div className="font-medium truncate">{group.books[0].title}</div>
                  <div className="text-xs text-gray-500 mt-1 flex items-center justify-between">
                    <span>{group.books.length} versions</span>
                    <span className="bg-white/10 px-1.5 rounded uppercase">{group.type}</span>
                  </div>
                </button>
              ))}
            </div>
          </aside>

          {/* Main: Comparison View */}
          <main className="col-span-9 space-y-6">
            <div className="grid grid-cols-2 gap-6">
              {currentGroup.books.map((book) => (
                <div
                  key={book.id}
                  className={`relative p-6 bg-surface rounded-xl border-2 transition-all ${
                    primaryBookId === book.id ? "border-primary" : "border-border"
                  }`}
                >
                  <div className="flex gap-4">
                    <div className="w-24 h-24 rounded-lg overflow-hidden bg-black/20 flex-shrink-0">
                      {book.coverPath ? (
                        <img src={book.coverPath} alt="" className="w-full h-full object-cover" />
                      ) : (
                        <div className="w-full h-full flex items-center justify-center">
                          <BookOpen className="text-gray-600" />
                        </div>
                      )}
                    </div>
                    <div className="flex-grow min-width-0">
                      <h3 className="text-lg font-bold truncate" title={book.title}>
                        {book.title}
                      </h3>
                      <p className="text-sm text-gray-400 truncate">{book.author.name}</p>
                      <div className="mt-2 text-xs flex flex-wrap gap-2">
                        <span className="bg-white/5 px-2 py-0.5 rounded flex items-center gap-1">
                          <HardDrive size={10} /> {book.library.name}
                        </span>
                        <span className="bg-white/5 px-2 py-0.5 rounded">
                          {formatDuration(book.duration)}
                        </span>
                        <span className="bg-white/5 px-2 py-0.5 rounded">
                          {book.audioFiles.length} files
                        </span>
                      </div>
                    </div>
                  </div>

                  <div className="mt-6 space-y-3">
                    <button
                      className={`w-full py-2 rounded-lg border flex items-center justify-center gap-2 transition-colors ${
                        primaryBookId === book.id
                          ? "bg-primary border-primary text-white"
                          : "border-border hover:border-gray-500"
                      }`}
                      onClick={() => setPrimaryBookId(book.id)}
                    >
                      {primaryBookId === book.id ? <Check size={16} /> : null}
                      {primaryBookId === book.id ? "Primary Target" : "Set as Primary"}
                    </button>

                    <div className="flex gap-2">
                      <button
                        className={`flex-1 py-1.5 rounded-lg border text-xs flex items-center justify-center gap-1 transition-colors ${
                          metadataSourceId === book.id
                            ? "bg-white/10 border-white/20"
                            : "border-border hover:border-gray-500"
                        }`}
                        onClick={() => setMetadataSourceId(book.id)}
                      >
                        {metadataSourceId === book.id && <Check size={12} />} Keep Metadata
                      </button>
                      <button
                        className={`flex-1 py-1.5 rounded-lg border text-xs flex items-center justify-center gap-1 transition-colors ${
                          progressSourceId === book.id
                            ? "bg-white/10 border-white/20"
                            : "border-border hover:border-gray-500"
                        }`}
                        onClick={() => setProgressSourceId(book.id)}
                      >
                        {progressSourceId === book.id && <Check size={12} />} Keep Progress
                      </button>
                    </div>
                  </div>

                  <div className="mt-6 pt-4 border-t border-border/50 text-xs text-gray-400">
                    <div className="flex items-center gap-2 truncate" title={book.folderPath}>
                      <span className="font-bold text-gray-500">Path:</span> {book.folderPath}
                    </div>
                  </div>
                </div>
              ))}
            </div>

            {/* Detailed Comparison Table */}
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <div className="p-4 bg-white/5 font-bold flex items-center gap-2">
                <Info size={16} /> Metadata Comparison
              </div>
              <div className="p-0">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="border-b border-border text-gray-500">
                      <th className="p-4 text-left w-1/4">Field</th>
                      {currentGroup.books.map((b) => (
                        <th key={b.id} className="p-4 text-left">
                          {b.id === metadataSourceId && <span className="text-primary mr-1">●</span>}
                          {b.library.name} Version
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {[
                      { label: "Title", key: "title" },
                      { label: "Subtitle", key: "subtitle" },
                      { label: "Series", key: "series", val: (b: Book) => b.series?.name },
                      { label: "Sequence", key: "sequence" },
                      { label: "Narrator", key: "narrator" },
                      { label: "Publisher", key: "publisher" },
                      { label: "Year", key: "year" },
                      { label: "ASIN", key: "asin" },
                      { label: "ISBN", key: "isbn" },
                      { label: "Language", key: "language" },
                    ].map((field) => (
                      <tr key={field.key} className="border-b border-border/50 hover:bg-white/2">
                        <td className="p-4 font-medium text-gray-400">{field.label}</td>
                        {currentGroup.books.map((b) => {
                          const val = (field as any).val ? (field as any).val(b) : (b as any)[field.key];
                          return (
                            <td key={b.id} className="p-4">
                              {val || <span className="text-gray-600 italic">None</span>}
                            </td>
                          );
                        })}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Audio Files Management */}
            <div className="bg-surface rounded-xl border border-border overflow-hidden">
              <div className="p-4 bg-white/5 font-bold flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Mic size={16} /> Audio Files Management
                </div>
                <div className="text-xs text-gray-400">
                  {Object.values(fileActions).filter((v) => v === "keep").length} keeping ·{" "}
                  {Object.values(fileActions).filter((v) => v === "delete").length} deleting
                </div>
              </div>
              <div className="p-0 max-h-[500px] overflow-y-auto">
                <table className="w-full text-sm">
                  <thead className="sticky top-0 bg-surface z-10">
                    <tr className="border-b border-border text-gray-500">
                      <th className="p-4 text-left">File Name / Path</th>
                      <th className="p-4 text-left w-32">Source</th>
                      <th className="p-4 text-right w-48">Action</th>
                    </tr>
                  </thead>
                  <tbody>
                    {currentGroup.books.flatMap((book) =>
                      book.audioFiles.map((file) => (
                        <tr key={file.id} className="border-b border-border/50 hover:bg-white/2">
                          <td className="p-4">
                            <div className="font-medium truncate max-w-[400px]" title={file.filename}>
                              {file.filename}
                            </div>
                            <div className="text-[10px] text-gray-500 truncate max-w-[400px]" title={file.path}>
                              {file.path}
                            </div>
                          </td>
                          <td className="p-4">
                            <span className="bg-white/5 px-2 py-0.5 rounded text-xs">
                              {book.library.name}
                            </span>
                          </td>
                          <td className="p-4 text-right">
                            <select
                              className={`bg-black/40 border border-border rounded px-2 py-1 text-xs outline-none focus:border-primary ${
                                fileActions[file.id] === "delete" ? "text-red-400" : "text-green-400"
                              }`}
                              value={fileActions[file.id]}
                              onChange={(e) =>
                                setFileActions((prev) => ({
                                  ...prev,
                                  [file.id]: e.target.value as any,
                                }))
                              }
                            >
                              <option value="keep">Keep (Primary)</option>
                              <option value="keep_sub">Keep (Subfolder)</option>
                              <option value="delete">Delete File</option>
                            </select>
                          </td>
                        </tr>
                      ))
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
