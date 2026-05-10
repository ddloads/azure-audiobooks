import { isAxiosError } from "axios";
import { useEffect, useMemo, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import { Check, ChevronLeft, ChevronRight, Loader2, Pencil, Save, Search, Sparkles, X } from "lucide-react";
import { io } from "socket.io-client";
import api from "../api/axios";
import { getSocketBaseUrl } from "../api/backend";

type MetadataBook = {
  id: string;
  title: string;
  subtitle?: string | null;
  author: { name: string };
  narrator?: string | null;
  series?: { name: string } | null;
  sequence?: number | null;
  description?: string | null;
  publisher?: string | null;
  year?: string | null;
  genres?: string | null;
  tags?: string | null;
  language?: string | null;
  isbn?: string | null;
  asin?: string | null;
  abridged?: boolean | null;
  duration: number;
};

type CandidateMetadata = {
  title: string | null;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  description: string | null;
  publisher: string | null;
  year: string | null;
  genres: string | null;
  tags: string | null;
  language: string | null;
  isbn: string | null;
  asin: string | null;
  abridged: boolean | null;
  seriesName: string | null;
  seriesSequence: number | null;
  durationSeconds: number | null;
  releaseDate: string | null;
  imageUrl: string | null;
  audibleUrl: string | null;
};

type MatchCandidate = {
  id: string;
  audibleUrl: string;
  confidence: number;
  confidenceLabel: string;
  metadata: CandidateMetadata;
};

interface BookMetadataModalProps {
  book: MetadataBook;
  onClose: () => void;
  onApplied: () => Promise<void> | void;
  initialTab?: "edit" | "fetch";
  closeAfterSave?: boolean;
  queuePosition?: {
    current: number;
    total: number;
  };
  onQueuePrevious?: () => void;
  onQueueNext?: () => void;
}

type EditableFields = {
  title: string;
  subtitle: string;
  author: string;
  narrator: string;
  seriesName: string;
  seriesSequence: string;
  description: string;
  publisher: string;
  year: string;
  genres: string;
  tags: string;
  language: string;
  isbn: string;
  asin: string;
  abridged: boolean;
  imageUrl: string;
};

type SelectableFieldKey = keyof EditableFields;
type MetadataProvider = "audible" | "google" | "combined";

type WriteTagsJob = {
  id: string;
  bookId: string;
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

const FIELD_DEFINITIONS: Array<{
  key: SelectableFieldKey;
  label: string;
  type: "text" | "textarea" | "checkbox";
}> = [
  { key: "imageUrl", label: "Cover Art", type: "text" },
  { key: "title", label: "Title", type: "text" },
  { key: "subtitle", label: "Subtitle", type: "text" },
  { key: "author", label: "Author", type: "text" },
  { key: "narrator", label: "Narrator", type: "text" },
  { key: "seriesName", label: "Series", type: "text" },
  { key: "seriesSequence", label: "Series Number", type: "text" },
  { key: "description", label: "Description", type: "textarea" },
  { key: "publisher", label: "Publisher", type: "text" },
  { key: "year", label: "Year", type: "text" },
  { key: "genres", label: "Genres", type: "text" },
  { key: "tags", label: "Tags", type: "text" },
  { key: "language", label: "Language", type: "text" },
  { key: "isbn", label: "ISBN", type: "text" },
  { key: "asin", label: "ASIN", type: "text" },
  { key: "abridged", label: "Abridged", type: "checkbox" },
];

const emptyFields = (): EditableFields => ({
  title: "",
  subtitle: "",
  author: "",
  narrator: "",
  seriesName: "",
  seriesSequence: "",
  description: "",
  publisher: "",
  year: "",
  genres: "",
  tags: "",
  language: "",
  isbn: "",
  asin: "",
  abridged: false,
  imageUrl: "",
});

const formatDuration = (seconds: number | null) => {
  if (!seconds || seconds <= 0) return null;
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return hours > 0 ? `${hours}h ${minutes}m` : `${minutes}m`;
};

const buildFieldsFromCandidate = (candidate: MatchCandidate): EditableFields => ({
  title: candidate.metadata.title ?? "",
  subtitle: candidate.metadata.subtitle ?? "",
  author: candidate.metadata.author ?? "",
  narrator: candidate.metadata.narrator ?? "",
  seriesName: candidate.metadata.seriesName ?? "",
  seriesSequence:
    candidate.metadata.seriesSequence === null || candidate.metadata.seriesSequence === undefined
      ? ""
      : String(candidate.metadata.seriesSequence),
  description: candidate.metadata.description ?? "",
  publisher: candidate.metadata.publisher ?? "",
  year: candidate.metadata.year ?? "",
  genres: candidate.metadata.genres ?? "",
  tags: candidate.metadata.tags ?? "",
  language: candidate.metadata.language ?? "",
  isbn: candidate.metadata.isbn ?? "",
  asin: candidate.metadata.asin ?? "",
  abridged: candidate.metadata.abridged ?? false,
  imageUrl: candidate.metadata.imageUrl ?? "",
});

const buildFieldsFromBook = (book: MetadataBook): EditableFields => ({
  title: book.title ?? "",
  subtitle: book.subtitle ?? "",
  author: book.author.name ?? "",
  narrator: book.narrator ?? "",
  seriesName: book.series?.name ?? "",
  seriesSequence: book.sequence === null || book.sequence === undefined ? "" : String(book.sequence),
  description: book.description ?? "",
  publisher: book.publisher ?? "",
  year: book.year ?? "",
  genres: book.genres ?? "",
  tags: book.tags ?? "",
  language: book.language ?? "",
  isbn: book.isbn ?? "",
  asin: book.asin ?? "",
  abridged: book.abridged ?? false,
  imageUrl: "",
});

const buildSelectionFromFields = (fields: EditableFields) =>
  FIELD_DEFINITIONS.reduce<Record<SelectableFieldKey, boolean>>((acc, field) => {
    acc[field.key] =
      field.type === "checkbox" ? Boolean(fields[field.key]) : String(fields[field.key]).trim().length > 0;
    return acc;
  }, {} as Record<SelectableFieldKey, boolean>);

const getErrorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ error?: string }>(error) ? error.response?.data?.error || fallback : fallback;

const formatRelativeSeconds = (value: string | null) => {
  if (!value) return null;
  const elapsedMs = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsedMs) || elapsedMs < 0) return null;
  return `${Math.floor(elapsedMs / 1000)}s`;
};

const BookMetadataModal = ({
  book,
  onClose,
  onApplied,
  initialTab = "fetch",
  closeAfterSave = true,
  queuePosition,
  onQueuePrevious,
  onQueueNext,
}: BookMetadataModalProps) => {
  const [activeTab, setActiveTab] = useState<"edit" | "fetch">(initialTab);
  const [provider, setProvider] = useState<MetadataProvider>("audible");
  const [query, setQuery] = useState(book.asin || book.title);
  const [authorSearch, setAuthorSearch] = useState(book.author.name);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [writingTags, setWritingTags] = useState(false);
  const [writeTagsJob, setWriteTagsJob] = useState<WriteTagsJob | null>(null);
  const [tagSuccess, setTagSuccess] = useState(false);
  const [error, setError] = useState("");
  const [results, setResults] = useState<MatchCandidate[]>([]);
  const [selectedCandidateId, setSelectedCandidateId] = useState<string | null>(null);

  // For Fetch tab
  const [fetchFields, setFetchFields] = useState<EditableFields>(emptyFields);
  const [selectedFields, setSelectedFields] = useState<Record<SelectableFieldKey, boolean>>(
    buildSelectionFromFields(emptyFields()),
  );

  // For Edit tab
  const [editFields, setEditFields] = useState<EditableFields>(() => buildFieldsFromBook(book));
  const [, setProgressTick] = useState(0);
  const writeTagsJobsRef = useRef<Map<string, WriteTagsJob>>(new Map());
  const writeTagsResolversRef = useRef<Map<string, (job: WriteTagsJob) => void>>(new Map());

  const selectedCandidate = useMemo(
    () => results.find((candidate) => candidate.id === selectedCandidateId) ?? null,
    [results, selectedCandidateId],
  );

  const waitForWriteTagsJobCompletion = (jobId: string) => {
    const existing = writeTagsJobsRef.current.get(jobId);
    if (existing && (existing.status === "completed" || existing.status === "failed")) {
      return Promise.resolve(existing);
    }

    return new Promise<WriteTagsJob>((resolve) => {
      writeTagsResolversRef.current.set(jobId, resolve);
    });
  };

  const runSearch = async (event?: FormEvent, providerOverride: MetadataProvider = provider) => {
    event?.preventDefault();
    setLoading(true);
    setError("");

    try {
      const res = await api.post(`/admin/books/${book.id}/match/search`, {
        query,
        author: authorSearch,
        provider: providerOverride,
      });

      const candidates: MatchCandidate[] = res.data.candidates ?? [];
      setResults(candidates);

      if (candidates[0]) {
        const nextFields = buildFieldsFromCandidate(candidates[0]);
        setSelectedCandidateId(candidates[0].id);
        setFetchFields(nextFields);
        setSelectedFields(buildSelectionFromFields(nextFields));
      } else {
        setSelectedCandidateId(null);
        setFetchFields(emptyFields());
        setSelectedFields(buildSelectionFromFields(emptyFields()));
      }
    } catch (searchError) {
      setError(getErrorMessage(searchError, "Failed to search Audible"));
    } finally {
      setLoading(false);
    }
  };

  const handleProviderChange = (nextProvider: MetadataProvider) => {
    setProvider(nextProvider);
    setResults([]);
    setSelectedCandidateId(null);
    setFetchFields(emptyFields());
    setSelectedFields(buildSelectionFromFields(emptyFields()));
    void runSearch(undefined, nextProvider);
  };

  useEffect(() => {
    if (activeTab === "fetch" && results.length === 0) {
      void runSearch();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [book.id, activeTab]);

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, []);

  useEffect(() => {
    const socket = io(getSocketBaseUrl(), {
      withCredentials: true,
    });

    const handleWriteTagsProgress = (job: WriteTagsJob) => {
      writeTagsJobsRef.current.set(job.id, job);

      if (job.bookId === book.id) {
        setWriteTagsJob(job);
      }

      if (job.status === "completed" || job.status === "failed") {
        const resolve = writeTagsResolversRef.current.get(job.id);
        if (resolve) {
          writeTagsResolversRef.current.delete(job.id);
          resolve(job);
        }
      }
    };

    socket.on("writeTagsProgress", handleWriteTagsProgress);

    return () => {
      socket.off("writeTagsProgress", handleWriteTagsProgress);
      socket.disconnect();
    };
  }, [book.id]);

  useEffect(() => {
    if (!writingTags || !writeTagsJob) return;

    const intervalId = window.setInterval(() => {
      setProgressTick((current) => current + 1);
    }, 1000);

    return () => {
      window.clearInterval(intervalId);
    };
  }, [writeTagsJob, writingTags]);

  const handleSelectCandidate = (candidate: MatchCandidate) => {
    const nextFields = buildFieldsFromCandidate(candidate);
    setSelectedCandidateId(candidate.id);
    setFetchFields(nextFields);
    setSelectedFields(buildSelectionFromFields(nextFields));
  };

  const handleFetchFieldChange = (key: SelectableFieldKey, value: string | boolean) => {
    setFetchFields((current) => ({ ...current, [key]: value }));
  };

  const handleEditFieldChange = (key: SelectableFieldKey, value: string | boolean) => {
    setEditFields((current) => ({ ...current, [key]: value }));
  };

  const handleSaveFetch = async () => {
    setSaving(true);
    setError("");

    try {
      await api.post(`/admin/books/${book.id}/match/apply`, {
        selectedFields,
        fields: fetchFields,
      });
      await onApplied();
      if (closeAfterSave) onClose();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Failed to save fetched metadata"));
    } finally {
      setSaving(false);
    }
  };

  const handleSaveEdit = async () => {
    setSaving(true);
    setError("");

    try {
      await api.patch(`/admin/books/${book.id}/metadata`, editFields);
      await onApplied();
      if (closeAfterSave) onClose();
    } catch (saveError) {
      setError(getErrorMessage(saveError, "Failed to update book metadata"));
    } finally {
      setSaving(false);
    }
  };

  const handleWriteTags = async () => {
    setWritingTags(true);
    setWriteTagsJob(null);
    setTagSuccess(false);
    setError("");

    try {
      const startResponse = await api.post<WriteTagsJob>(`/admin/books/${book.id}/write-tags`);
      let currentJob = startResponse.data;
      writeTagsJobsRef.current.set(currentJob.id, currentJob);
      setWriteTagsJob(currentJob);

      if (currentJob.status === "pending" || currentJob.status === "running") {
        currentJob = await waitForWriteTagsJobCompletion(currentJob.id);
        setWriteTagsJob(currentJob);
      }

      if (currentJob.status === "failed") {
        setError(currentJob.message || "Failed to write tags to audio files");
        return;
      }

      setTagSuccess(true);
      setTimeout(() => setTagSuccess(false), 3000);
    } catch (tagError) {
      setError(getErrorMessage(tagError, "Failed to write tags to audio files"));
    } finally {
      setWritingTags(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && onClose()}>
      <div className="card modal-card book-match-modal metadata-modal">
        <div className="modal-header">
          <div>
            <h2>Manage Metadata</h2>
            <p className="book-match-subtitle">{book.title}</p>
            {queuePosition && queuePosition.total > 1 && (
              <p className="book-match-queue-status">
                Title {queuePosition.current} of {queuePosition.total}
              </p>
            )}
          </div>
          {queuePosition && queuePosition.total > 1 && (
            <div className="book-match-queue-controls">
              <button
                className="btn btn-secondary"
                type="button"
                onClick={onQueuePrevious}
                disabled={saving || loading || queuePosition.current <= 1}
              >
                <ChevronLeft size={16} />
                Previous
              </button>
              <button
                className="btn btn-secondary"
                type="button"
                onClick={onQueueNext}
                disabled={saving || loading || queuePosition.current >= queuePosition.total}
              >
                Next
                <ChevronRight size={16} />
              </button>
            </div>
          )}
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        <div className="metadata-tabs">
          <button
            className={`metadata-tab ${activeTab === "edit" ? "active" : ""}`}
            onClick={() => setActiveTab("edit")}
          >
            <Pencil size={16} />
            Edit Metadata
          </button>
          <button
            className={`metadata-tab ${activeTab === "fetch" ? "active" : ""}`}
            onClick={() => setActiveTab("fetch")}
          >
            <Sparkles size={16} />
            Fetch Metadata
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}
        {writeTagsJob && (
          <div className="tag-write-progress-card">
            <div className="tag-write-progress-head">
              <strong>
                {writingTags ? "Writing tags to audio files" : writeTagsJob.message || "Tag write complete"}
              </strong>
              <span>
                {writeTagsJob.totalFiles > 0
                  ? `${writeTagsJob.processedFiles}/${writeTagsJob.totalFiles}`
                  : "0/0"}
              </span>
            </div>
            <div className="progress-bar-container tag-write-progress-bar">
              <div
                className="progress-bar-fill"
                style={{
                  width: `${
                    writeTagsJob.totalFiles > 0
                      ? (writeTagsJob.processedFiles / writeTagsJob.totalFiles) * 100
                      : 0
                  }%`,
                }}
              />
            </div>
            {writeTagsJob.currentFile && writingTags && (
              <>
                <div className="tag-write-progress-label">
                  Current file: {writeTagsJob.currentFile.split(/[/\\]/).pop()}
                  {writeTagsJob.currentFileStartedAt
                    ? ` • ${formatRelativeSeconds(writeTagsJob.currentFileStartedAt) || "0s"} elapsed`
                    : ""}
                </div>
                <div className="tag-write-progress-submeta">
                  Timeout: {writeTagsJob.stallTimeoutMs > 0 ? `${Math.round(writeTagsJob.stallTimeoutMs / 1000)}s per file` : "Adaptive per file"}
                </div>
              </>
            )}
            {!writeTagsJob.currentFile && writeTagsJob.lastCompletedFile && (
              <div className="tag-write-progress-submeta">
                Last completed: {writeTagsJob.lastCompletedFile.split(/[/\\]/).pop()}
                {writeTagsJob.lastCompletedAt
                  ? ` • ${formatRelativeSeconds(writeTagsJob.lastCompletedAt) || "0s"} ago`
                  : ""}
              </div>
            )}
          </div>
        )}

        {activeTab === "fetch" ? (
          <>
            <form className="book-match-search" onSubmit={runSearch}>
              <div className="book-match-search-grid">
                <div className="form-group">
                  <label>Provider</label>
                  <select
                    className="form-control"
                    value={provider}
                    onChange={(event) => handleProviderChange(event.target.value as MetadataProvider)}
                  >
                    <option value="audible">Audible.com</option>
                    <option value="google">Google Books</option>
                    <option value="combined">Audible + Google</option>
                  </select>
                </div>

                <div className="form-group">
                  <label>Search Title or ASIN</label>
                  <input
                    className="form-control"
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="Title or ASIN"
                  />
                </div>

                <div className="form-group">
                  <label>Author</label>
                  <input
                    className="form-control"
                    value={authorSearch}
                    onChange={(event) => setAuthorSearch(event.target.value)}
                    placeholder="Author"
                  />
                </div>
              </div>

              <button className="btn btn-primary book-match-search-btn" type="submit" disabled={loading}>
                {loading ? <Loader2 size={16} className="animate-spin" /> : <Search size={16} />}
                Search
              </button>
            </form>

            <div className="book-match-results">
              <div className="book-match-results-list">
                {results.length === 0 && !loading ? (
                  <div className="admin-empty-state">No Audible metadata found for this search.</div>
                ) : (
                  results.map((candidate) => {
                    const isSelected = candidate.id === selectedCandidateId;
                    const durationLabel = formatDuration(candidate.metadata.durationSeconds);
                    return (
                      <button
                        key={candidate.id}
                        type="button"
                        className={`book-match-result-card ${isSelected ? "selected" : ""}`}
                        onClick={() => handleSelectCandidate(candidate)}
                      >
                        <div className="book-match-result-cover">
                          {candidate.metadata.imageUrl ? (
                            <img
                              src={candidate.metadata.imageUrl}
                              alt={candidate.metadata.title || "Fetched title"}
                            />
                          ) : (
                            <div className="book-cover-placeholder">No Cover</div>
                          )}
                        </div>

                        <div className="book-match-result-copy">
                          <div className="book-match-result-head">
                            <div>
                              <h3>{candidate.metadata.title || "Unknown title"}</h3>
                              {candidate.metadata.subtitle && (
                                <p className="book-match-result-subcopy">
                                  {candidate.metadata.subtitle}
                                </p>
                              )}
                            </div>
                            <span className="book-match-confidence">{candidate.confidenceLabel}</span>
                          </div>

                          <p className="book-match-result-meta">
                            {candidate.metadata.author || "Unknown author"}
                            {candidate.metadata.narrator
                              ? ` · Narrator: ${candidate.metadata.narrator}`
                              : ""}
                            {durationLabel ? ` · ${durationLabel}` : ""}
                          </p>

                          {candidate.metadata.seriesName && (
                            <p className="book-match-result-subcopy">
                              {candidate.metadata.seriesName}
                              {candidate.metadata.seriesSequence
                                ? ` · Book ${candidate.metadata.seriesSequence}`
                                : ""}
                            </p>
                          )}

                          {(candidate.metadata.genres || candidate.metadata.language) && (
                            <p className="book-match-result-meta">
                              {candidate.metadata.genres}
                              {candidate.metadata.genres && candidate.metadata.language ? " · " : ""}
                              {candidate.metadata.language ? candidate.metadata.language.toUpperCase() : ""}
                            </p>
                          )}

                          {candidate.metadata.description && (
                            <p className="book-match-result-desc">{candidate.metadata.description}</p>
                          )}

                          {isSelected && (
                            <span className="book-match-selected-pill">
                              <Check size={14} />
                              Selected
                            </span>
                          )}
                        </div>
                      </button>
                    );
                  })
                )}
              </div>

              {selectedCandidate && (
                <div className="book-match-fields">
                  <div className="book-match-fields-header">
                    <div>
                      <span className="book-match-fields-kicker">Selected Metadata</span>
                      <h3>{selectedCandidate.metadata.title}</h3>
                    </div>
                    {(selectedCandidate.metadata.audibleUrl || selectedCandidate.audibleUrl) && (
                      <a
                        className="book-match-link"
                        href={selectedCandidate.metadata.audibleUrl || selectedCandidate.audibleUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Sparkles size={14} />
                        {selectedCandidate.id.startsWith("google_") ? "Google Books" : "Audible"}
                      </a>
                    )}
                  </div>

                  <div className="book-match-field-list">
                    {FIELD_DEFINITIONS.map((field) => (
                      <div key={field.key} className="book-match-field-row">
                        <label className="book-match-select">
                          <input
                            type="checkbox"
                            checked={selectedFields[field.key]}
                            onChange={(event) =>
                              setSelectedFields((current) => ({
                                ...current,
                                [field.key]: event.target.checked,
                              }))
                            }
                          />
                          <span>{field.label}</span>
                        </label>

                        <div className="book-match-field-control">
                          {field.key === "imageUrl" && fetchFields.imageUrl ? (
                            <div className="book-match-cover-preview">
                              <img src={fetchFields.imageUrl} alt="Cover preview" />
                              <input
                                className="form-control"
                                value={fetchFields[field.key] as string}
                                onChange={(event) => handleFetchFieldChange(field.key, event.target.value)}
                              />
                            </div>
                          ) : field.type === "textarea" ? (
                            <textarea
                              className="form-control"
                              rows={5}
                              value={fetchFields[field.key] as string}
                              onChange={(event) =>
                                handleFetchFieldChange(field.key, event.target.value)
                              }
                            />
                          ) : field.type === "checkbox" ? (
                            <label className="admin-checkbox">
                              <input
                                type="checkbox"
                                checked={Boolean(fetchFields[field.key])}
                                onChange={(event: ChangeEvent<HTMLInputElement>) =>
                                  handleFetchFieldChange(field.key, event.target.checked)
                                }
                              />
                              <span>{fetchFields[field.key] ? "Yes" : "No"}</span>
                            </label>
                          ) : (
                            <input
                              className="form-control"
                              value={fetchFields[field.key] as string}
                              onChange={(event) =>
                                handleFetchFieldChange(field.key, event.target.value)
                              }
                            />
                          )}
                        </div>
                      </div>
                    ))}
                  </div>

                  <div className="book-match-actions">
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={onClose}
                      disabled={saving}
                    >
                      Cancel
                    </button>
                    <button
                      className="btn btn-primary"
                      type="button"
                      onClick={handleSaveFetch}
                      disabled={saving}
                    >
                      {saving ? (
                        <Loader2 size={16} className="animate-spin" />
                      ) : (
                        <Check size={16} />
                      )}
                      Save Selected Fields
                    </button>
                  </div>
                </div>
              )}
            </div>
          </>
        ) : (
          <div className="metadata-edit-form">
            <div className="book-match-field-list">
              {FIELD_DEFINITIONS.filter((f) => f.key !== "imageUrl").map((field) => (
                <div key={field.key} className="book-match-field-row">
                  <label className="book-match-select">
                    <span>{field.label}</span>
                  </label>

                  <div className="book-match-field-control">
                    {field.type === "textarea" ? (
                      <textarea
                        className="form-control"
                        rows={10}
                        value={editFields[field.key] as string}
                        onChange={(event) => handleEditFieldChange(field.key, event.target.value)}
                      />
                    ) : field.type === "checkbox" ? (
                      <label className="admin-checkbox">
                        <input
                          type="checkbox"
                          checked={Boolean(editFields[field.key])}
                          onChange={(event: ChangeEvent<HTMLInputElement>) =>
                            handleEditFieldChange(field.key, event.target.checked)
                          }
                        />
                          <span>{editFields[field.key] ? "Yes" : "No"}</span>
                      </label>
                    ) : (
                      <input
                        className="form-control"
                        value={editFields[field.key] as string}
                        onChange={(event) => handleEditFieldChange(field.key, event.target.value)}
                      />
                    )}
                  </div>
                </div>
              ))}
            </div>

            <div className="book-match-actions">
              <div className="metadata-actions-left">
                <button
                  className={`btn ${tagSuccess ? "btn-success" : "btn-secondary"}`}
                  type="button"
                  onClick={handleWriteTags}
                  disabled={writingTags || saving}
                >
                  {writingTags ? (
                    <Loader2 size={16} className="animate-spin" />
                  ) : tagSuccess ? (
                    <Check size={16} />
                  ) : (
                    <Save size={16} />
                  )}
                  {tagSuccess ? "Tags Written!" : "Write Tags to Files"}
                </button>
              </div>
              <div className="metadata-actions-right">
                <button
                  className="btn btn-secondary"
                  type="button"
                  onClick={onClose}
                  disabled={saving || writingTags}
                >
                  Cancel
                </button>
                <button
                  className="btn btn-primary"
                  type="button"
                  onClick={handleSaveEdit}
                  disabled={saving || writingTags}
                >
                  {saving ? <Loader2 size={16} className="animate-spin" /> : <Check size={16} />}
                  Update Metadata
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default BookMetadataModal;
