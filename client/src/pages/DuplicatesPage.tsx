import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  Check,
  CheckCircle2,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  FileAudio,
  FolderOpen,
  HardDrive,
  Info,
  Loader2,
  Pause,
  Play,
  RefreshCw,
  ShieldCheck,
  Trash2,
  X,
} from "lucide-react";
import api from "../api/axios";
import { usePlayer } from "../context/PlayerContext";
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

type FileAction = "keep" | "delete" | "keep_sub";
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
  asin: "Same ASIN",
  isbn: "Same ISBN",
  "title-author": "Same title and author",
};

const duplicateTypeDescription: Record<DuplicateGroup["type"], string> = {
  asin: "These books share the same Audible identifier.",
  isbn: "These books share the same ISBN.",
  "title-author": "These books have matching normalized title and author data.",
};

const comparisonFields: Array<
  | { label: string; key: ComparableField }
  | { label: string; key: "series"; val: (book: Book) => string | number | null | undefined }
> = [
  { label: "Title", key: "title" },
  { label: "Subtitle", key: "subtitle" },
  { label: "Series", key: "series", val: (book) => book.series?.name },
  { label: "Sequence", key: "sequence" },
  { label: "Narrator", key: "narrator" },
  { label: "Publisher", key: "publisher" },
  { label: "Year", key: "year" },
  { label: "ASIN", key: "asin" },
  { label: "ISBN", key: "isbn" },
  { label: "Language", key: "language" },
];

const versionLabels = ["A", "B", "C", "D", "E", "F"];

const formatDuration = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h ${m}m`;
  return `${m}m`;
};

const formatFileAction = (action: FileAction) => {
  if (action === "keep") return "Keep in primary";
  if (action === "keep_sub") return "Keep in subfolder";
  return "Delete file";
};

const getStateValue = (state: unknown, key: string) =>
  typeof state === "object" && state !== null && key in state
    ? (state as Record<string, unknown>)[key]
    : null;

const DuplicatesPage = () => {
  const { showToast } = useToast();
  const { currentBook, isPlaying, isPreviewMode, playPreviewBook, stopPlayer } = usePlayer();
  const navigate = useNavigate();
  const location = useLocation();

  const [loading, setLoading] = useState(true);
  const [groups, setGroups] = useState<DuplicateGroup[]>([]);
  const [selectedGroupIndex, setSelectedGroupIndex] = useState<number | null>(null);
  const [primaryBookId, setPrimaryBookId] = useState<string | null>(null);
  const [metadataSourceId, setMetadataSourceId] = useState<string | null>(null);
  const [progressSourceId, setProgressSourceId] = useState<string | null>(null);
  const [fileActions, setFileActions] = useState<Record<string, FileAction>>({});
  const [isMerging, setIsMerging] = useState(false);
  const [showIdentical, setShowIdentical] = useState(false);

  const backTargetValue = getStateValue(location.state, "from");
  const initialBookIdValue = getStateValue(location.state, "initialBookId");
  const backTarget = typeof backTargetValue === "string" ? backTargetValue : "/settings";
  const initialBookId = typeof initialBookIdValue === "string" ? initialBookIdValue : null;

  const currentGroup = selectedGroupIndex !== null ? groups[selectedGroupIndex] : null;

  const filePlan = useMemo(() => {
    const values = Object.values(fileActions);
    return {
      keep: values.filter((value) => value === "keep").length,
      keepSub: values.filter((value) => value === "keep_sub").length,
      delete: values.filter((value) => value === "delete").length,
      total: values.length,
    };
  }, [fileActions]);

  const affectedBookCount = useMemo(
    () => groups.reduce((count, group) => count + group.books.length, 0),
    [groups],
  );

  const selectedBooks = currentGroup?.books ?? [];
  const primaryBook = selectedBooks.find((book) => book.id === primaryBookId) ?? selectedBooks[0] ?? null;
  const metadataBook = selectedBooks.find((book) => book.id === metadataSourceId) ?? primaryBook;
  const progressBook = selectedBooks.find((book) => book.id === progressSourceId) ?? primaryBook;

  const comparisonRows = useMemo(() => {
    if (!currentGroup) return [];

    return comparisonFields
      .map((field) => {
        const values = currentGroup.books.map((book) =>
          "val" in field ? field.val(book) : book[field.key],
        );
        const normalized = values.map((value) => String(value ?? ""));
        const identical = normalized.every((value) => value === normalized[0]);
        return { field, values, identical };
      })
      .filter((row) => showIdentical || !row.identical);
  }, [currentGroup, showIdentical]);

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
        const index = res.data.findIndex((group) =>
          group.books.some((book) => book.id === initialBookId),
        );
        setSelectedGroupIndex(index >= 0 ? index : 0);
        return;
      }

      setSelectedGroupIndex(0);
    } catch {
      showToast({ title: "Failed to load duplicates", tone: "error" });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void fetchGroups();
  }, []);

  useEffect(() => {
    if (!currentGroup?.books.length) return;

    const recommendedPrimary = currentGroup.books
      .slice()
      .sort((a, b) => {
        const progressDiff = b.progress.length - a.progress.length;
        if (progressDiff !== 0) return progressDiff;
        const fileDiff = b.audioFiles.length - a.audioFiles.length;
        if (fileDiff !== 0) return fileDiff;
        return b.duration - a.duration;
      })[0];

    const initialId = recommendedPrimary?.id ?? currentGroup.books[0].id;
    setPrimaryBookId(initialId);
    setMetadataSourceId(initialId);
    setProgressSourceId(initialId);

    const nextActions: Record<string, FileAction> = {};
    currentGroup.books.forEach((book) => {
      book.audioFiles.forEach((file) => {
        nextActions[file.id] = book.id === initialId ? "keep" : "delete";
      });
    });
    setFileActions(nextActions);
  }, [currentGroup]);

  const setAllFilesForBook = (book: Book, action: FileAction) => {
    setFileActions((current) => {
      const next = { ...current };
      book.audioFiles.forEach((file) => {
        next[file.id] = action;
      });
      return next;
    });
  };

  const handleMerge = async () => {
    if (!currentGroup || !primaryBookId) return;
    if (filePlan.keep + filePlan.keepSub === 0) {
      showToast({
        title: "Choose at least one file to keep",
        description: "A resolved duplicate group must keep one playable audio file.",
        tone: "error",
      });
      return;
    }

    setIsMerging(true);

    try {
      if (currentBook && currentGroup.books.some((book) => book.id === currentBook.id)) {
        stopPlayer();
      }

      await api.post("/admin/duplicates/resolve", {
        primaryBookId,
        secondaryBookIds: currentGroup.books
          .filter((book) => book.id !== primaryBookId)
          .map((book) => book.id),
        metadata: metadataBook
          ? {
              title: metadataBook.title,
              subtitle: metadataBook.subtitle,
              authorId: metadataBook.author.id,
              seriesId: metadataBook.series?.id ?? null,
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
        audioFileActions: Object.entries(fileActions).map(([audioFileId, action]) => ({
          audioFileId,
          action,
        })),
      });

      showToast({ title: "Duplicates resolved", tone: "success" });

      const nextGroups = [...groups];
      nextGroups.splice(selectedGroupIndex ?? 0, 1);
      setGroups(nextGroups);
      setSelectedGroupIndex(
        nextGroups.length > 0 ? Math.min(selectedGroupIndex ?? 0, nextGroups.length - 1) : null,
      );
    } catch (error) {
      const message = isAxiosError<{ error?: string }>(error)
        ? error.response?.data?.error
        : null;
      showToast({
        title: "Resolution failed",
        description: message ?? "Could not resolve this duplicate group.",
        tone: "error",
      });
    } finally {
      setIsMerging(false);
    }
  };

  const handleDismiss = async () => {
    if (selectedGroupIndex === null || !currentGroup) return;
    setIsMerging(true);

    try {
      await api.post("/admin/duplicates/dismiss", {
        bookIds: currentGroup.books.map((book) => book.id),
        reason: "not_duplicates",
      });

      const nextGroups = [...groups];
      nextGroups.splice(selectedGroupIndex, 1);
      setGroups(nextGroups);
      setSelectedGroupIndex(
        nextGroups.length > 0 ? Math.min(selectedGroupIndex, nextGroups.length - 1) : null,
      );
      showToast({
        title: "Group dismissed",
        description: "These editions will stay out of duplicate results after rescans.",
        tone: "success",
      });
    } catch (error) {
      const message = isAxiosError<{ error?: string }>(error)
        ? error.response?.data?.error
        : null;
      showToast({
        title: "Dismiss failed",
        description: message ?? "Could not save this duplicate decision.",
        tone: "error",
      });
    } finally {
      setIsMerging(false);
    }
  };

  const handlePreviewBook = (book: Book) => {
    const isCurrentPreview = isPreviewMode && currentBook?.id === book.id && isPlaying;
    if (isCurrentPreview) {
      stopPlayer();
      return;
    }

    playPreviewBook({
      id: book.id,
      title: book.title,
      author: { name: book.author.name },
      coverPath: book.coverPath ?? undefined,
      duration: book.duration,
      audioFiles: book.audioFiles.map((file) => ({
        id: file.id,
        filename: file.filename,
        title: file.title,
        duration: file.duration,
        index: file.index,
      })),
      chapters: [],
    });
  };

  if (loading) {
    return (
      <div className="duplicates-page duplicates-page--centered">
        <div className="duplicates-loading">
          <Loader2 className="animate-spin" size={42} />
          <Copy size={22} />
        </div>
        <h1>Scanning duplicate candidates</h1>
        <p>Checking ASIN, ISBN, title, and author matches across your libraries.</p>
      </div>
    );
  }

  return (
    <div className="duplicates-page">
      <header className="duplicates-header">
        <div className="admin-settings-header-left">
          <button className="admin-back-btn" onClick={() => navigate(backTarget)} aria-label="Back">
            <ArrowLeft size={16} />
          </button>
          <div>
            <h1 className="admin-settings-title">Duplicate Resolver</h1>
            <p className="admin-settings-subtitle">
              {groups.length} {groups.length === 1 ? "group" : "groups"} · {affectedBookCount} affected books
            </p>
          </div>
        </div>

        <div className="duplicates-header-actions">
          <button className="btn btn-secondary" onClick={() => void fetchGroups()} disabled={loading}>
            <RefreshCw size={15} />
            Refresh
          </button>
          {currentGroup && (
            <>
              <button className="btn btn-secondary" onClick={() => void handleDismiss()} disabled={isMerging}>
                <X size={15} />
                Not Duplicates
              </button>
              <button
                className="btn btn-primary"
                onClick={handleMerge}
                disabled={isMerging || !primaryBookId || filePlan.keep + filePlan.keepSub === 0}
              >
                {isMerging ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
                Resolve Group
              </button>
            </>
          )}
        </div>
      </header>

      {!currentGroup ? (
        <section className="duplicates-empty">
          <CheckCircle2 size={52} />
          <h2>No duplicate groups found</h2>
          <p>Your library looks clean right now.</p>
          <button className="btn btn-primary" onClick={() => navigate("/")}>
            Return Home
          </button>
        </section>
      ) : (
        <div className="duplicates-layout">
          <aside className="duplicates-sidebar">
            <div className="duplicates-sidebar-head">
              <span>Duplicate Groups</span>
              <strong>{groups.length}</strong>
            </div>
            <div className="duplicates-group-list">
              {groups.map((group, index) => {
                const active = index === selectedGroupIndex;
                const first = group.books[0];
                return (
                  <button
                    key={`${group.type}-${group.key}-${index}`}
                    className={`duplicates-group-item${active ? " active" : ""}`}
                    onClick={() => setSelectedGroupIndex(index)}
                  >
                    <div className="duplicates-group-cover">
                      {first?.coverPath ? <img src={first.coverPath} alt="" /> : <Copy size={18} />}
                    </div>
                    <div>
                      <strong>{first?.title ?? "Untitled"}</strong>
                      <span>{group.books.length} versions · {duplicateTypeLabel[group.type]}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          </aside>

          <main className="duplicates-main">
            <section className="duplicates-decision-panel">
              <div className="duplicates-decision-card">
                <span>Primary book</span>
                <strong>{primaryBook?.title ?? "Choose a primary"}</strong>
                <p>This record survives the merge.</p>
              </div>
              <div className="duplicates-decision-card">
                <span>Metadata source</span>
                <strong>{metadataBook?.title ?? "Choose metadata"}</strong>
                <p>Title, author, series, IDs, and tags copy from here.</p>
              </div>
              <div className="duplicates-decision-card">
                <span>Progress source</span>
                <strong>{progressBook?.title ?? "Choose progress"}</strong>
                <p>Listening progress is preserved from this version.</p>
              </div>
            </section>

            <section className="duplicates-section">
              <div className="duplicates-section-head">
                <div>
                  <h2>Choose The Winning Version</h2>
                  <p>{duplicateTypeDescription[currentGroup.type]}</p>
                </div>
              </div>

              <div className="duplicates-version-grid">
                {currentGroup.books.map((book, index) => {
                  const label = versionLabels[index] ?? String(index + 1);
                  const isCurrentPreview = isPreviewMode && currentBook?.id === book.id && isPlaying;
                  return (
                    <article
                      key={book.id}
                      className={`duplicates-version-card${book.id === primaryBookId ? " primary" : ""}`}
                    >
                      <div className="duplicates-version-top">
                        <div className="duplicates-version-cover">
                          {book.coverPath ? <img src={book.coverPath} alt={book.title} /> : <Copy size={24} />}
                        </div>
                        <div>
                          <span className="duplicates-version-label">Version {label}</span>
                          <h3>{book.title}</h3>
                          <p>{book.author.name}</p>
                        </div>
                      </div>

                      <div className="duplicates-version-meta">
                        <span>{book.library.name}</span>
                        <span>{formatDuration(book.duration)}</span>
                        <span>{book.audioFiles.length} files</span>
                        <span>{book.progress.length} progress</span>
                      </div>

                      <p className="duplicates-folder" title={book.folderPath}>
                        <FolderOpen size={13} />
                        {book.folderPath}
                      </p>

                      <div className="duplicates-version-actions">
                        <button
                          className={`duplicates-choice-btn${isCurrentPreview ? " active" : ""}`}
                          type="button"
                          onClick={() => handlePreviewBook(book)}
                          disabled={book.audioFiles.length === 0}
                          style={{ gridColumn: "1 / -1" }}
                          title="Preview without saving listening progress"
                        >
                          {isCurrentPreview ? <Pause size={14} /> : <Play size={14} />}
                          {isCurrentPreview ? "Stop Preview" : "Preview"}
                        </button>
                        <button
                          className={`duplicates-choice-btn${book.id === primaryBookId ? " active" : ""}`}
                          onClick={() => setPrimaryBookId(book.id)}
                        >
                          {book.id === primaryBookId && <Check size={14} />}
                          Primary
                        </button>
                        <button
                          className={`duplicates-choice-btn${book.id === metadataSourceId ? " active" : ""}`}
                          onClick={() => setMetadataSourceId(book.id)}
                        >
                          {book.id === metadataSourceId && <Check size={14} />}
                          Metadata
                        </button>
                        <button
                          className={`duplicates-choice-btn${book.id === progressSourceId ? " active" : ""}`}
                          onClick={() => setProgressSourceId(book.id)}
                        >
                          {book.id === progressSourceId && <Check size={14} />}
                          Progress
                        </button>
                      </div>

                      <a className="duplicates-open-link" href={`/book/${book.id}`} target="_blank" rel="noreferrer">
                        Open details <ExternalLink size={13} />
                      </a>
                    </article>
                  );
                })}
              </div>
            </section>

            <section className="duplicates-section">
              <div className="duplicates-section-head">
                <div>
                  <h2>Metadata Differences</h2>
                  <p>Only differing fields are shown by default.</p>
                </div>
                <button className="btn btn-secondary" onClick={() => setShowIdentical((value) => !value)}>
                  {showIdentical ? <EyeOff size={15} /> : <Eye size={15} />}
                  {showIdentical ? "Hide Identical" : "Show All"}
                </button>
              </div>

              <div className="duplicates-comparison">
                {comparisonRows.length === 0 ? (
                  <div className="duplicates-comparison-empty">
                    <Info size={18} />
                    All visible metadata fields are identical.
                  </div>
                ) : (
                  comparisonRows.map(({ field, values, identical }) => (
                    <div key={field.key} className={`duplicates-compare-row${identical ? " identical" : ""}`}>
                      <div className="duplicates-compare-field">
                        <strong>{field.label}</strong>
                        {!identical && <span>differs</span>}
                      </div>
                      <div className="duplicates-compare-values">
                        {currentGroup.books.map((book, index) => (
                          <div
                            key={book.id}
                            className={book.id === metadataSourceId ? "selected" : ""}
                          >
                            <span>{versionLabels[index] ?? index + 1}</span>
                            <p>{values[index] != null && String(values[index]) !== "" ? String(values[index]) : "Empty"}</p>
                          </div>
                        ))}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </section>

            <section className="duplicates-section">
              <div className="duplicates-section-head">
                <div>
                  <h2>Audio File Plan</h2>
                  <p>Choose which files survive and where they should land.</p>
                </div>
                <div className="duplicates-file-counts">
                  <span>{filePlan.keep} keep</span>
                  <span>{filePlan.keepSub} subfolder</span>
                  <span>{filePlan.delete} delete</span>
                </div>
              </div>

              <div className="duplicates-file-books">
                {currentGroup.books.map((book, index) => (
                  <div key={book.id} className="duplicates-file-book">
                    <div className="duplicates-file-book-head">
                      <div>
                        <span>Version {versionLabels[index] ?? index + 1}</span>
                        <strong>{book.title}</strong>
                      </div>
                      <div className="duplicates-file-bulk">
                        <button onClick={() => setAllFilesForBook(book, "keep")}>Keep all</button>
                        <button onClick={() => setAllFilesForBook(book, "keep_sub")}>Subfolder</button>
                        <button onClick={() => setAllFilesForBook(book, "delete")}>Delete all</button>
                      </div>
                    </div>

                    {book.audioFiles.map((file) => (
                      <div key={file.id} className="duplicates-file-row">
                        <div className="duplicates-file-main">
                          <FileAudio size={17} />
                          <div>
                            <strong>{file.filename}</strong>
                            <span>{file.title || "No title tag"} · {formatDuration(file.duration)}</span>
                            <p>{file.path}</p>
                          </div>
                        </div>
                        <label className={`duplicates-action-select action-${fileActions[file.id]}`}>
                          {fileActions[file.id] === "delete" ? <Trash2 size={15} /> : <HardDrive size={15} />}
                          <select
                            value={fileActions[file.id]}
                            onChange={(event) =>
                              setFileActions((current) => ({
                                ...current,
                                [file.id]: event.target.value as FileAction,
                              }))
                            }
                          >
                            <option value="keep">{formatFileAction("keep")}</option>
                            <option value="keep_sub">{formatFileAction("keep_sub")}</option>
                            <option value="delete">{formatFileAction("delete")}</option>
                          </select>
                        </label>
                      </div>
                    ))}
                  </div>
                ))}
              </div>
            </section>
          </main>

          <div className="duplicates-action-bar">
            <div>
              <strong>{primaryBook ? `Merging into ${primaryBook.title}` : "Choose a primary book"}</strong>
              <span>{filePlan.keep + filePlan.keepSub} files kept, {filePlan.delete} marked for deletion</span>
            </div>
            <button className="btn btn-secondary" onClick={() => void handleDismiss()} disabled={isMerging}>
              <X size={15} />
              Not Duplicates
            </button>
            <button
              className="btn btn-primary"
              onClick={handleMerge}
              disabled={isMerging || !primaryBookId || filePlan.keep + filePlan.keepSub === 0}
            >
              {isMerging ? <Loader2 className="animate-spin" size={16} /> : <ShieldCheck size={16} />}
              Resolve & Merge
            </button>
          </div>
        </div>
      )}
    </div>
  );
};

export default DuplicatesPage;
