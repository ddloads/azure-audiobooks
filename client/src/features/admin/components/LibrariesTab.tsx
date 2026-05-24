import { useState } from "react";
import {
  Database,
  FolderTree,
  HardDrive,
  Loader2,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  ScanLine,
  Server,
  Trash2,
  Upload,
  X,
  CheckCircle2,
} from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import ConfirmDialog from "../../../components/ConfirmDialog";
import FolderBrowserModal from "../../../components/FolderBrowserModal";
import type { AdminLibrary, PendingAdminConfirm, StructureCheckResult } from "../types";
import { detectKind, derivedLabel, getErrorMessage } from "../helpers";

interface LibrariesTabProps {
  libraries: AdminLibrary[];
  onRefresh: () => Promise<unknown> | unknown;
  onRequestUpload: () => void;
}

const FOLDER_PATTERNS = [
  { value: "", label: "None — no structure check" },
  { value: "{author} - {title}", label: "{Author} - {Title}  (e.g. Douglas Adams - Hitchhiker's Guide)" },
  { value: "{title}", label: "{Title} only  (e.g. Hitchhiker's Guide)" },
  { value: "{author}/{title}", label: "{Author}/{Title}  (nested 2 levels)" },
  { value: "{author}/{series}/{title}", label: "{Author}/{Series}/{Title}  (nested 3 levels)" },
];

export default function LibrariesTab({
  libraries,
  onRefresh,
  onRequestUpload,
}: LibrariesTabProps) {
  const { showToast } = useToast();

  const [newLibraryName, setNewLibraryName] = useState("");
  const [newLibraryDescription, setNewLibraryDescription] = useState("");

  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [libraryEditDrafts, setLibraryEditDrafts] = useState<
    Record<string, { name: string; description: string; isActive: boolean; folderPattern: string }>
  >({});

  const [sourceDrafts, setSourceDrafts] = useState<
    Record<string, { label: string; path: string; kind: string; isWritable: boolean; isWatched: boolean }>
  >({});

  const [structureCheckResults, setStructureCheckResults] = useState<
    Record<string, StructureCheckResult | null>
  >({});
  const [structureCheckLoading, setStructureCheckLoading] = useState<string | null>(null);

  const [sourceBrowserLibraryId, setSourceBrowserLibraryId] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirm | null>(null);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionLoading(key);
    try {
      await action();
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateLibrary = async () => {
    await runAction("create-library", async () => {
      try {
        await api.post("/admin/libraries", {
          name: newLibraryName.trim(),
          description: newLibraryDescription.trim(),
        });
        showToast({
          title: "Library created",
          description: `Created ${newLibraryName.trim()}`,
          tone: "success",
        });
        setNewLibraryName("");
        setNewLibraryDescription("");
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to create library",
          description: getErrorMessage(error, "Failed to create library"),
          tone: "error",
        });
      }
    });
  };

  const handleUpdateLibrary = async (libraryId: string) => {
    const draft = libraryEditDrafts[libraryId];
    if (!draft?.name.trim()) return;

    await runAction(`update-library-${libraryId}`, async () => {
      try {
        await api.patch(`/admin/libraries/${libraryId}`, {
          name: draft.name.trim(),
          description: draft.description.trim(),
          isActive: draft.isActive,
          folderPattern: draft.folderPattern,
        });
        showToast({
          title: "Library updated",
          tone: "success",
        });
        setEditingLibraryId(null);
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to update library",
          description: getErrorMessage(error, "Failed to update library"),
          tone: "error",
        });
      }
    });
  };

  const handleDeleteLibrary = async (library: AdminLibrary) => {
    await runAction(`delete-library-${library.id}`, async () => {
      try {
        await api.delete(`/admin/libraries/${library.id}`);
        showToast({
          title: "Library deleted",
          description: `Deleted ${library.name}`,
          tone: "success",
        });
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to delete library",
          description: getErrorMessage(error, "Failed to delete library"),
          tone: "error",
        });
      }
    });
  };

  const handlePurgeLibrary = async (library: AdminLibrary) => {
    await runAction(`purge-library-${library.id}`, async () => {
      try {
        const response = await api.delete(`/admin/libraries/${library.id}/purge`);
        showToast({
          title: "Library purged",
          description: response.data?.message || `Purged ${library.name}`,
          tone: "success",
        });
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to purge library",
          description: getErrorMessage(error, "Failed to purge library"),
          tone: "error",
        });
      }
    });
  };

  const handleCheckStructure = async (library: AdminLibrary) => {
    setStructureCheckLoading(library.id);
    try {
      const response = await api.get<StructureCheckResult>(
        `/admin/libraries/${library.id}/structure-check`
      );
      setStructureCheckResults((c) => ({ ...c, [library.id]: response.data }));
    } catch (checkError) {
      showToast({
        title: "Structure check failed",
        description: getErrorMessage(checkError, "Failed to check library structure"),
        tone: "error",
      });
    } finally {
      setStructureCheckLoading(null);
    }
  };

  const handleCreateSource = async (libraryId: string) => {
    const draft = sourceDrafts[libraryId];
    if (!draft?.path.trim()) return;

    await runAction(`create-source-${libraryId}`, async () => {
      try {
        await api.post(`/admin/libraries/${libraryId}/sources`, {
          label: draft.label.trim(),
          path: draft.path.trim(),
          kind: draft.kind,
          isWritable: draft.isWritable,
          isWatched: draft.isWatched,
          isEnabled: true,
        });
        showToast({
          title: "Source path added",
          tone: "success",
        });
        setSourceDrafts((current) => ({
          ...current,
          [libraryId]: {
            label: "",
            path: "",
            kind: "LOCAL",
            isWritable: false,
            isWatched: false,
          },
        }));
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to add source path",
          description: getErrorMessage(error, "Failed to add source path"),
          tone: "error",
        });
      }
    });
  };

  const handleToggleSource = async (
    sourceId: string,
    field: "isEnabled" | "isWritable" | "isWatched",
    value: boolean
  ) => {
    await runAction(`update-source-${sourceId}-${field}`, async () => {
      try {
        await api.patch(`/admin/sources/${sourceId}`, { [field]: value });
        showToast({
          title: "Source updated",
          tone: "success",
        });
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to update source path",
          description: getErrorMessage(error, "Failed to update source path"),
          tone: "error",
        });
      }
    });
  };

  const handleDeleteSource = async (sourceId: string, label: string) => {
    await runAction(`delete-source-${sourceId}`, async () => {
      try {
        await api.delete(`/admin/sources/${sourceId}`);
        showToast({
          title: "Source removed",
          description: `Removed source "${label}"`,
          tone: "success",
        });
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to remove source path",
          description: getErrorMessage(error, "Failed to remove source path"),
          tone: "error",
        });
      }
    });
  };

  const handleRescan = async () => {
    await runAction("rescan-library", async () => {
      try {
        await api.post("/admin/library/scan");
        showToast({
          title: "Library scan started",
          description: "The full library rescan has been queued.",
          tone: "success",
        });
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to scan library",
          description: getErrorMessage(error, "Failed to scan library"),
          tone: "error",
        });
      }
    });
  };

  const handleRescanSingleLibrary = async (library: AdminLibrary) => {
    await runAction(`rescan-library-${library.id}`, async () => {
      try {
        const response = await api.post(`/admin/libraries/${library.id}/scan`);
        showToast({
          title: "Library scan started",
          description: response.data.message || `${library.name} scan started`,
          tone: "success",
        });
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to scan library",
          description: getErrorMessage(error, "Failed to scan library"),
          tone: "error",
        });
      }
    });
  };

  const handleSelectSourcePath = (libraryId: string, selectedPath: string) => {
    const existingDraft = sourceDrafts[libraryId] ?? {
      label: "",
      path: "",
      kind: "LOCAL",
      isWritable: false,
      isWatched: false,
    };

    setSourceDrafts((current) => ({
      ...current,
      [libraryId]: {
        ...existingDraft,
        path: selectedPath,
        kind: detectKind(selectedPath),
      },
    }));
    setSourceBrowserLibraryId(null);
  };

  return (
    <div className="admin-panel-stack">
      <div className="card admin-section-card">
        <div className="admin-section-head">
          <h3>Create library</h3>
          <FolderTree size={16} />
        </div>
        <div className="admin-library-create-grid">
          <input
            className="form-control"
            placeholder="Library name"
            value={newLibraryName}
            onChange={(e) => setNewLibraryName(e.target.value)}
          />
          <input
            className="form-control"
            placeholder="Description (optional)"
            value={newLibraryDescription}
            onChange={(e) => setNewLibraryDescription(e.target.value)}
          />
          <button
            className="btn btn-primary"
            type="button"
            disabled={!newLibraryName.trim() || actionLoading === "create-library"}
            onClick={() => void handleCreateLibrary()}
          >
            <FolderTree size={15} />
            Create library
          </button>
        </div>
      </div>

      <div className="admin-toolbar">
        <div className="admin-toolbar-actions">
          <button
            className="btn btn-secondary"
            type="button"
            disabled={actionLoading === "rescan-library"}
            onClick={() => void handleRescan()}
          >
            {actionLoading === "rescan-library" ? (
              <RefreshCw size={15} className="animate-spin" />
            ) : (
              <RefreshCw size={15} />
            )}
            Rescan all libraries
          </button>
          <button className="btn btn-primary" type="button" onClick={onRequestUpload}>
            <Upload size={15} />
            Upload book
          </button>
        </div>
      </div>

      <div className="admin-library-grid">
        {libraries.map((library) => {
          const draft = sourceDrafts[library.id] ?? {
            label: "",
            path: "",
            kind: "LOCAL",
            isWritable: false,
            isWatched: false,
          };

          return (
            <div key={library.id} className="card admin-section-card admin-library-manager-card">
              <div className="admin-section-head">
                <div>
                  <h3>{library.name}</h3>
                  <p className="admin-library-meta-text">
                    {library._count.books} books · {library.sources.length} source paths
                    {!library.isActive && <span className="admin-inactive-badge"> · Inactive</span>}
                    {library.folderPattern && (
                      <span className="admin-pattern-badge"> · <code>{library.folderPattern}</code></span>
                    )}
                  </p>
                </div>
                <div className="admin-library-card-actions">
                  <button
                    className="btn btn-secondary"
                    type="button"
                    onClick={() => {
                      if (editingLibraryId === library.id) {
                        setEditingLibraryId(null);
                      } else {
                        setLibraryEditDrafts((c) => ({
                          ...c,
                          [library.id]: {
                            name: library.name,
                            description: library.description ?? "",
                            isActive: library.isActive,
                            folderPattern: library.folderPattern ?? "",
                          },
                        }));
                        setEditingLibraryId(library.id);
                      }
                    }}
                  >
                    {editingLibraryId === library.id ? <X size={14} /> : <Pencil size={14} />}
                    {editingLibraryId === library.id ? "Cancel" : "Edit"}
                  </button>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={actionLoading === `rescan-library-${library.id}`}
                    onClick={() => void handleRescanSingleLibrary(library)}
                  >
                    {actionLoading === `rescan-library-${library.id}` ? (
                      <RefreshCw size={14} className="animate-spin" />
                    ) : (
                      <RefreshCw size={14} />
                    )}
                    Scan
                  </button>
                  {library.folderPattern && (
                    <button
                      className="btn btn-secondary"
                      type="button"
                      disabled={structureCheckLoading === library.id}
                      onClick={() => void handleCheckStructure(library)}
                    >
                      {structureCheckLoading === library.id ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : (
                        <ScanLine size={14} />
                      )}
                      Check Structure
                    </button>
                  )}
                  <button
                    className="btn admin-danger-btn"
                    type="button"
                    disabled={actionLoading === `purge-library-${library.id}`}
                    onClick={() =>
                      setPendingConfirm({
                        title: "Purge Library Database",
                        message: `Delete all books, audio files, chapters, and progress records from "${library.name}"? The library and source paths will stay in place so you can rescan from scratch.`,
                        confirmLabel: "Purge Library",
                        tone: "danger",
                        onConfirm: () => void handlePurgeLibrary(library),
                      })
                    }
                  >
                    {actionLoading === `purge-library-${library.id}` ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Database size={14} />
                    )}
                    Purge DB
                  </button>
                  <button
                    className="btn admin-danger-btn"
                    type="button"
                    disabled={actionLoading === `delete-library-${library.id}`}
                    onClick={() =>
                      setPendingConfirm({
                        title: "Delete Library",
                        message: `Delete library "${library.name}"?`,
                        confirmLabel: "Delete Library",
                        tone: "danger",
                        onConfirm: () => void handleDeleteLibrary(library),
                      })
                    }
                  >
                    <Trash2 size={14} />
                  </button>
                </div>
              </div>

              {editingLibraryId === library.id && libraryEditDrafts[library.id] && (
                <div className="admin-library-edit-form">
                  <input
                    className="form-control"
                    placeholder="Library name"
                    value={libraryEditDrafts[library.id].name}
                    onChange={(e) =>
                      setLibraryEditDrafts((c) => ({
                        ...c,
                        [library.id]: { ...c[library.id], name: e.target.value },
                      }))
                    }
                  />
                  <input
                    className="form-control"
                    placeholder="Description (optional)"
                    value={libraryEditDrafts[library.id].description}
                    onChange={(e) =>
                      setLibraryEditDrafts((c) => ({
                        ...c,
                        [library.id]: { ...c[library.id], description: e.target.value },
                      }))
                    }
                  />
                  <div className="admin-library-pattern-row">
                    <label className="admin-field-label">
                      Folder structure model
                      <small className="admin-field-hint">Expected naming pattern for book folders</small>
                    </label>
                    <select
                      className="form-control"
                      value={libraryEditDrafts[library.id].folderPattern}
                      onChange={(e) =>
                        setLibraryEditDrafts((c) => ({
                          ...c,
                          [library.id]: { ...c[library.id], folderPattern: e.target.value },
                        }))
                      }
                    >
                      {FOLDER_PATTERNS.map((p) => (
                        <option key={p.value} value={p.value}>
                          {p.label}
                        </option>
                      ))}
                    </select>
                  </div>
                  <div className="admin-library-edit-footer">
                    <label className="admin-checkbox">
                      <input
                        type="checkbox"
                        checked={libraryEditDrafts[library.id].isActive}
                        onChange={(e) =>
                          setLibraryEditDrafts((c) => ({
                            ...c,
                            [library.id]: { ...c[library.id], isActive: e.target.checked },
                          }))
                        }
                      />
                      Active
                    </label>
                    <button
                      className="btn btn-primary"
                      type="button"
                      disabled={
                        !libraryEditDrafts[library.id].name.trim() ||
                        actionLoading === `update-library-${library.id}`
                      }
                      onClick={() => void handleUpdateLibrary(library.id)}
                    >
                      {actionLoading === `update-library-${library.id}` ? (
                        <Loader2 size={14} className="animate-spin" />
                      ) : null}
                      Save changes
                    </button>
                  </div>
                </div>
              )}

              {!editingLibraryId && library.description && (
                <p className="admin-library-description">{library.description}</p>
              )}

              <div className="admin-source-list">
                {library.sources.map((source) => (
                  <div key={source.id} className="admin-source-card">
                    <div className="admin-source-head">
                      <div>
                        <strong>{source.label || source.path}</strong>
                        <small>{source.kind} · {source.path}</small>
                      </div>
                      <button
                        className="btn admin-danger-btn"
                        type="button"
                        disabled={actionLoading === `delete-source-${source.id}`}
                        onClick={() =>
                          setPendingConfirm({
                            title: "Remove Source",
                            message: `Remove source "${source.label || source.path}"?`,
                            confirmLabel: "Remove Source",
                            tone: "danger",
                            onConfirm: () => void handleDeleteSource(source.id, source.label || source.path),
                          })
                        }
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                    <div className="admin-source-actions">
                      <label className="admin-checkbox">
                        <input
                          type="checkbox"
                          checked={source.isEnabled}
                          onChange={(e) =>
                            void handleToggleSource(source.id, "isEnabled", e.target.checked)
                          }
                        />
                        Enabled
                      </label>
                      <label className="admin-checkbox">
                        <input
                          type="checkbox"
                          checked={source.isWritable}
                          onChange={(e) =>
                            void handleToggleSource(source.id, "isWritable", e.target.checked)
                          }
                        />
                        Writable
                      </label>
                      <label className="admin-checkbox">
                        <input
                          type="checkbox"
                          checked={source.isWatched}
                          onChange={(e) =>
                            void handleToggleSource(source.id, "isWatched", e.target.checked)
                          }
                        />
                        Watched
                      </label>
                      <div className="admin-pill">
                        {source.kind === "NETWORK" ? (
                          <Network size={12} />
                        ) : source.kind === "MAPPED" ? (
                          <Server size={12} />
                        ) : (
                          <HardDrive size={12} />
                        )}
                        {source.kind}
                      </div>
                    </div>
                  </div>
                ))}
              </div>

              <div className="admin-source-form">
                <div className="admin-source-form-heading">Add source path</div>
                <div className="admin-source-path-row">
                  <div className="admin-source-path-picker">
                    <input
                      className="form-control"
                      placeholder={`C:\\Audiobooks  or  \\\\server\\share`}
                      value={draft.path}
                      onChange={(e) => {
                        const path = e.target.value;
                        setSourceDrafts((current) => ({
                          ...current,
                          [library.id]: { ...draft, path, kind: detectKind(path) },
                        }));
                      }}
                    />
                    <button
                      className="btn btn-secondary"
                      type="button"
                      onClick={() => setSourceBrowserLibraryId(library.id)}
                    >
                      Browse
                    </button>
                  </div>
                  <div className={`admin-pill admin-kind-pill-${draft.kind.toLowerCase()}`}>
                    {draft.kind === "NETWORK" ? (
                      <Network size={12} />
                    ) : draft.kind === "MAPPED" ? (
                      <Server size={12} />
                    ) : (
                      <HardDrive size={12} />
                    )}
                    {draft.kind}
                  </div>
                </div>
                <div className="admin-source-meta-row">
                  <input
                    className="form-control"
                    placeholder={
                      draft.path
                        ? `Label — default: "${derivedLabel(draft.path)}"`
                        : "Label (optional)"
                    }
                    value={draft.label}
                    onChange={(e) =>
                      setSourceDrafts((current) => ({
                        ...current,
                        [library.id]: { ...draft, label: e.target.value },
                      }))
                    }
                  />
                  <label className="admin-checkbox admin-writable-label">
                    <input
                      type="checkbox"
                      checked={draft.isWritable}
                      onChange={(e) =>
                        setSourceDrafts((current) => ({
                          ...current,
                          [library.id]: { ...draft, isWritable: e.target.checked },
                        }))
                      }
                    />
                    <span>
                      Writable
                      <small className="admin-field-hint">Allow uploads</small>
                    </span>
                  </label>
                  <label className="admin-checkbox admin-writable-label">
                    <input
                      type="checkbox"
                      checked={draft.isWatched}
                      onChange={(e) =>
                        setSourceDrafts((current) => ({
                          ...current,
                          [library.id]: { ...draft, isWatched: e.target.checked },
                        }))
                      }
                    />
                    <span>
                      Watch
                      <small className="admin-field-hint">Auto-scan changes</small>
                    </span>
                  </label>
                  <button
                    className="btn btn-secondary"
                    type="button"
                    disabled={!draft.path.trim() || actionLoading === `create-source-${library.id}`}
                    onClick={() => void handleCreateSource(library.id)}
                  >
                    {actionLoading === `create-source-${library.id}` ? (
                      <Loader2 size={14} className="animate-spin" />
                    ) : (
                      <Plus size={14} />
                    )}
                    Add
                  </button>
                </div>
              </div>

              {structureCheckResults[library.id] !== undefined && (
                <div className="structure-check-panel">
                  {(() => {
                    const result = structureCheckResults[library.id];
                    if (!result) return null;
                    return (
                      <>
                        <div className="structure-check-summary">
                          {result.nonConforming.length === 0 ? (
                            <span className="structure-check-ok">
                              <CheckCircle2 size={15} />
                              All {result.total} folders match <code>{result.pattern}</code>
                            </span>
                          ) : (
                            <span className="structure-check-issues">
                              <ScanLine size={15} />
                              {result.conforming} of {result.total} conform · <strong>{result.nonConforming.length} don&apos;t match</strong> <code>{result.pattern}</code>
                            </span>
                          )}
                        </div>
                        {result.nonConforming.length > 0 && (
                          <div className="structure-check-list">
                            {result.nonConforming.map((item) => (
                              <div key={item.id} className="structure-check-item">
                                <div className="structure-check-item-title">
                                  {item.title} <span className="structure-check-item-author">— {item.author}</span>
                                </div>
                                <div className="structure-check-item-path">{item.folderPath}</div>
                              </div>
                            ))}
                          </div>
                        )}
                      </>
                    );
                  })()}
                </div>
              )}
            </div>
          );
        })}
      </div>

      {sourceBrowserLibraryId && (
        <FolderBrowserModal
          initialPath={sourceDrafts[sourceBrowserLibraryId]?.path ?? ""}
          onClose={() => setSourceBrowserLibraryId(null)}
          onSelect={(selectedPath) => handleSelectSourcePath(sourceBrowserLibraryId, selectedPath)}
        />
      )}

      <ConfirmDialog
        open={pendingConfirm !== null}
        title={pendingConfirm?.title || ""}
        message={pendingConfirm?.message || ""}
        confirmLabel={pendingConfirm?.confirmLabel || "Confirm"}
        tone={pendingConfirm?.tone || "default"}
        busy={Boolean(actionLoading)}
        onCancel={() => setPendingConfirm(null)}
        onConfirm={() => {
          const current = pendingConfirm;
          if (!current) return;
          setPendingConfirm(null);
          current.onConfirm();
        }}
      />
    </div>
  );
}
