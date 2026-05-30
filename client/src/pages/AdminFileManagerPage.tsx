import { isAxiosError } from "axios";
import { useEffect, useMemo, useState } from "react";
import { Navigate, useLocation, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  ChevronRight,
  ChevronUp,
  File,
  FolderOpen,
  FolderPlus,
  MoveRight,
  Pencil,
  RefreshCw,
  RotateCcw,
  Settings,
  Trash2,
  X,
} from "lucide-react";
import api from "../api/axios";
import ConfirmDialog from "../components/ConfirmDialog";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

type ManagedRoot = {
  sourceId: string;
  libraryId: string;
  libraryName: string;
  label: string | null;
  path: string;
  resolvedPath: string;
  isWritable: boolean;
};

type FileManagerEntry = {
  name: string;
  path: string;
  relativePath: string;
  type: "directory" | "file";
  size: number;
  modifiedAt: string;
  isProtected: boolean;
};

type TrashRecord = {
  trashId: string;
  rootId: string;
  originalPath: string;
  trashedPath: string;
  itemName: string;
  itemType: "directory" | "file";
  deletedAt: string;
  deletedBy: string | null;
  size: number;
};

type PreviewSummary = {
  rootId: string;
  libraryId: string;
  itemCount: number;
  fileCount: number;
  directoryCount: number;
  affectedBookCount: number;
  affectedBooks: Array<{ id: string; title: string; folderPath: string }>;
  warnings: string[];
};

type TreeResponse = {
  root: ManagedRoot;
  currentPath: string;
  relativePath: string;
  parentPath: string | null;
  entries: FileManagerEntry[];
  directories: FileManagerEntry[];
  files: FileManagerEntry[];
};

type TrashResponse = {
  root: ManagedRoot;
  items: TrashRecord[];
};

type DialogState =
  | { type: "create" }
  | { type: "rename"; item: FileManagerEntry }
  | { type: "move" }
  | null;

const getErrorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ error?: string }>(error) ? error.response?.data?.error || fallback : fallback;

const formatBytes = (bytes: number) => {
  if (!Number.isFinite(bytes) || bytes <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let value = bytes;
  let index = 0;
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024;
    index += 1;
  }
  return `${value >= 10 || index === 0 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`;
};

const formatDate = (value: string) =>
  new Date(value).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const getRootLabel = (root: ManagedRoot) => root.label?.trim() || root.libraryName;

const AdminFileManagerPage = () => {
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();
  const location = useLocation();

  const [roots, setRoots] = useState<ManagedRoot[]>([]);
  const [currentRootId, setCurrentRootId] = useState("");
  const [currentPath, setCurrentPath] = useState("");
  const [treeData, setTreeData] = useState<TreeResponse | null>(null);
  const [trashData, setTrashData] = useState<TrashResponse | null>(null);
  const [viewMode, setViewMode] = useState<"browse" | "trash">("browse");
  const [selectedPaths, setSelectedPaths] = useState<string[]>([]);
  const [selectedTrashIds, setSelectedTrashIds] = useState<string[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [dialog, setDialog] = useState<DialogState>(null);
  const [folderName, setFolderName] = useState("");
  const [renameValue, setRenameValue] = useState("");
  const [destinationPath, setDestinationPath] = useState("");
  const [deletePreview, setDeletePreview] = useState<PreviewSummary | null>(null);
  const [deleteDialogOpen, setDeleteDialogOpen] = useState(false);
  const [permanentDeleteDialogOpen, setPermanentDeleteDialogOpen] = useState(false);

  const returnTo = location.state?.from || "/";
  const currentRoot = useMemo(
    () => roots.find((root) => root.sourceId === currentRootId) ?? null,
    [roots, currentRootId],
  );
  const selectedEntries = useMemo(
    () => treeData?.entries.filter((entry) => selectedPaths.includes(entry.path)) ?? [],
    [treeData, selectedPaths],
  );
  const singleSelectedEntry = selectedEntries.length === 1 ? selectedEntries[0] : null;
  const isReadOnlyRoot = currentRoot ? !currentRoot.isWritable : true;

  const loadRoots = async () => {
    const response = await api.get<{ roots: ManagedRoot[] }>("/admin/filesystem/roots");
    const nextRoots = response.data.roots;
    setRoots(nextRoots);

    if (!nextRoots.length) {
      setCurrentRootId("");
      setCurrentPath("");
      return;
    }

    setCurrentRootId((current) => {
      if (current && nextRoots.some((root) => root.sourceId === current)) return current;
      return nextRoots[0].sourceId;
    });
  };

  const loadTree = async (rootId: string, path: string) => {
    const response = await api.get<TreeResponse>("/admin/filesystem/tree", {
      params: { rootId, path },
    });
    setTreeData(response.data);
    setCurrentPath(response.data.currentPath);
  };

  const loadTrash = async (rootId: string) => {
    const response = await api.get<TrashResponse>("/admin/filesystem/trash", {
      params: { rootId },
    });
    setTrashData(response.data);
  };

  const refreshCurrentView = async (nextRootId = currentRootId, nextPath = currentPath, nextMode = viewMode) => {
    if (!nextRootId) return;
    setLoading(true);
    try {
      if (nextMode === "trash") {
        await loadTrash(nextRootId);
      } else {
        await loadTree(nextRootId, nextPath || currentRoot?.resolvedPath || "");
      }
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    let active = true;
    setLoading(true);
    loadRoots()
      .catch((error) => {
        if (!active) return;
        showToast({ title: "Failed to load file manager", description: getErrorMessage(error, "Check server logs."), tone: "error" });
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [showToast]);

  useEffect(() => {
    if (!currentRootId) return;
    const root = roots.find((entry) => entry.sourceId === currentRootId);
    if (!root) return;
    setCurrentPath((existing) => existing || root.resolvedPath);
  }, [currentRootId, roots]);

  useEffect(() => {
    if (!currentRootId) return;
    void refreshCurrentView(currentRootId, currentPath || currentRoot?.resolvedPath || "", viewMode);
    setSelectedPaths([]);
    setSelectedTrashIds([]);
    setDialog(null);
    setDeletePreview(null);
    setDeleteDialogOpen(false);
    setPermanentDeleteDialogOpen(false);
  }, [currentRootId, viewMode]);

  useEffect(() => {
    if (!currentRootId || !currentPath || viewMode !== "browse") return;
    void refreshCurrentView(currentRootId, currentPath, "browse");
    setSelectedPaths([]);
  }, [currentPath]);

  if (user?.role !== "ADMIN") {
    return <Navigate to="/" replace />;
  }

  const openDialog = (nextDialog: DialogState) => {
    setDialog(nextDialog);
    if (nextDialog?.type === "create") {
      setFolderName("");
    }
    if (nextDialog?.type === "rename") {
      setRenameValue(nextDialog.item.name);
    }
    if (nextDialog?.type === "move") {
      setDestinationPath(treeData?.currentPath ?? currentRoot?.resolvedPath ?? "");
    }
  };

  const handleRefresh = async () => {
    try {
      await refreshCurrentView();
    } catch (error) {
      showToast({ title: "Refresh failed", description: getErrorMessage(error, "Unable to refresh this view."), tone: "error" });
    }
  };

  const handleNavigateInto = (entry: FileManagerEntry) => {
    if (entry.type !== "directory") return;
    setCurrentPath(entry.path);
  };

  const handleNavigateUp = () => {
    if (!treeData?.parentPath) return;
    setCurrentPath(treeData.parentPath);
  };

  const togglePathSelection = (pathValue: string) => {
    setSelectedPaths((current) =>
      current.includes(pathValue) ? current.filter((entry) => entry !== pathValue) : [...current, pathValue],
    );
  };

  const toggleTrashSelection = (trashId: string) => {
    setSelectedTrashIds((current) =>
      current.includes(trashId) ? current.filter((entry) => entry !== trashId) : [...current, trashId],
    );
  };

  const runMutation = async (work: () => Promise<void>, successTitle: string, successDescription: string) => {
    setBusy(true);
    try {
      await work();
      showToast({ title: successTitle, description: successDescription, tone: "success" });
      await refreshCurrentView();
      await loadRoots();
      setDialog(null);
      setDeletePreview(null);
      setDeleteDialogOpen(false);
      setPermanentDeleteDialogOpen(false);
      setSelectedPaths([]);
      setSelectedTrashIds([]);
    } catch (error) {
      showToast({ title: "Action failed", description: getErrorMessage(error, "Check server logs."), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleCreateFolder = async () => {
    if (!currentRootId || !treeData) return;
    await runMutation(
      () =>
        api.post("/admin/filesystem/folder", {
          rootId: currentRootId,
          parentPath: treeData.currentPath,
          folderName,
        }),
      "Folder created",
      "A library rescan was queued for this source.",
    );
  };

  const handleRename = async () => {
    if (!currentRootId || !singleSelectedEntry) return;
    await runMutation(
      () =>
        api.post("/admin/filesystem/rename", {
          rootId: currentRootId,
          itemPath: singleSelectedEntry.path,
          nextName: renameValue,
        }),
      "Item renamed",
      "A library rescan was queued for this source.",
    );
  };

  const handleMove = async () => {
    if (!currentRootId || selectedPaths.length === 0) return;
    await runMutation(
      () =>
        api.post("/admin/filesystem/move", {
          rootId: currentRootId,
          itemPaths: selectedPaths,
          destinationPath,
        }),
      "Items moved",
      "A library rescan was queued for this source.",
    );
  };

  const handlePreviewDelete = async () => {
    if (!currentRootId || selectedPaths.length === 0) return;
    setBusy(true);
    try {
      const response = await api.post<PreviewSummary>("/admin/filesystem/preview", {
        rootId: currentRootId,
        paths: selectedPaths,
      });
      setDeletePreview(response.data);
      setDeleteDialogOpen(true);
    } catch (error) {
      showToast({ title: "Preview failed", description: getErrorMessage(error, "Unable to preview delete."), tone: "error" });
    } finally {
      setBusy(false);
    }
  };

  const handleDelete = async () => {
    if (!currentRootId) return;
    await runMutation(
      () =>
        api.post("/admin/filesystem/delete", {
          rootId: currentRootId,
          itemPaths: selectedPaths,
        }),
      "Items moved to trash",
      "Restore remains available from this page.",
    );
  };

  const handleRestore = async () => {
    if (!currentRootId || selectedTrashIds.length === 0) return;
    await runMutation(
      () =>
        api.post("/admin/filesystem/restore", {
          rootId: currentRootId,
          trashIds: selectedTrashIds,
        }),
      "Items restored",
      "A library rescan was queued for this source.",
    );
  };

  const handlePermanentDelete = async () => {
    if (!currentRootId || selectedTrashIds.length === 0) return;
    await runMutation(
      () =>
        api.post("/admin/filesystem/delete-permanently", {
          rootId: currentRootId,
          trashIds: selectedTrashIds,
        }),
      "Trash deleted",
      "Selected trash items were removed permanently.",
    );
  };

  const handleRescan = async () => {
    if (!currentRootId) return;
    await runMutation(
      () => api.post("/admin/filesystem/rescan", { rootId: currentRootId }),
      "Rescan queued",
      "The library scanner will reconcile filesystem changes.",
    );
  };

  const breadcrumbSegments = (() => {
    if (!treeData || !currentRoot) return [];
    if (!treeData.relativePath) return [];
    const parts = treeData.relativePath.split(/[\\/]/).filter(Boolean);
    return parts.map((segment, index) => ({
      label: segment,
      path:
        index === 0
          ? `${currentRoot.resolvedPath}\\${segment}`.replace(/\\/g, "\\")
          : `${currentRoot.resolvedPath}\\${parts.slice(0, index + 1).join("\\")}`,
    }));
  })();

  return (
    <div className="admin-settings-page">
      <div className="card admin-settings-page-shell">
        <header className="admin-settings-header">
          <div className="admin-settings-header-left">
            <button className="admin-back-btn" onClick={() => navigate(returnTo)} aria-label="Back">
              <ArrowLeft size={16} />
            </button>
            <div>
              <h1 className="admin-settings-title">File Manager</h1>
              {currentRoot && (
                <p className="admin-settings-subtitle">{getRootLabel(currentRoot)}</p>
              )}
            </div>
          </div>
          <div className="admin-header-actions">
            <button className="btn btn-secondary" onClick={() => navigate("/settings", { state: { from: returnTo } })}>
              <Settings size={15} />
              Settings
            </button>
          </div>
        </header>

        <div className="admin-settings-layout">
          <aside className="admin-settings-sidebar">
            {roots.map((root) => (
              <button
                key={root.sourceId}
                className={`admin-nav-btn${root.sourceId === currentRootId ? " admin-nav-btn-active" : ""}`}
                onClick={() => {
                  setCurrentRootId(root.sourceId);
                  setCurrentPath(root.resolvedPath);
                }}
              >
                <FolderOpen size={16} />
                <div>
                  <strong>{getRootLabel(root)}</strong>
                  <small>{root.isWritable ? "Writable" : "Read-only"}</small>
                </div>
              </button>
            ))}
          </aside>

          <section className="admin-settings-content">
            <div className="admin-content-topbar">
              <div className="file-manager-toolbar">
                <div className="file-manager-mode-tabs" role="tablist" aria-label="File manager view">
                  <button
                    className={`btn ${viewMode === "browse" ? "btn-primary" : "btn-secondary"} file-manager-mode-btn`}
                    onClick={() => setViewMode("browse")}
                  >
                    <FolderOpen size={15} />
                    Browse
                  </button>
                  <button
                    className={`btn ${viewMode === "trash" ? "btn-primary" : "btn-secondary"} file-manager-mode-btn`}
                    onClick={() => setViewMode("trash")}
                  >
                    <Trash2 size={15} />
                    Trash
                  </button>
                </div>
              </div>
              {currentRoot && <p className="file-manager-root-path">{currentRoot.path}</p>}
            </div>

            {viewMode === "browse" && treeData && (
              <>
                <div className="file-manager-breadcrumbs">
                  <button className="btn btn-secondary" onClick={handleNavigateUp} disabled={!treeData.parentPath}>
                    <ChevronUp size={14} />
                    Up
                  </button>
                  <button className="file-manager-crumb" onClick={() => setCurrentPath(currentRoot?.resolvedPath ?? treeData.currentPath)}>
                    {getRootLabel(treeData.root)}
                  </button>
                  {breadcrumbSegments.map((segment) => (
                    <div key={segment.path} className="file-manager-crumb-group">
                      <ChevronRight size={14} />
                      <button className="file-manager-crumb" onClick={() => setCurrentPath(segment.path)}>
                        {segment.label}
                      </button>
                    </div>
                  ))}
                </div>

                <div className="file-manager-action-bar">
                  <div className="file-manager-selection-copy">
                    <strong>{selectedPaths.length}</strong>
                    <span>selected</span>
                    {isReadOnlyRoot && <small>This root is read-only.</small>}
                  </div>
                  <div className="admin-toolbar-actions">
                    <button className="btn btn-secondary" onClick={handleRefresh} disabled={busy || loading}>
                      <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                      Refresh
                    </button>
                    <button className="btn btn-secondary" onClick={() => openDialog({ type: "create" })} disabled={busy || isReadOnlyRoot}>
                      <FolderPlus size={15} />
                      New Folder
                    </button>
                    <button className="btn btn-secondary" onClick={() => singleSelectedEntry && openDialog({ type: "rename", item: singleSelectedEntry })} disabled={busy || isReadOnlyRoot || !singleSelectedEntry}>
                      <Pencil size={15} />
                      Rename
                    </button>
                    <button className="btn btn-secondary" onClick={() => openDialog({ type: "move" })} disabled={busy || isReadOnlyRoot || selectedPaths.length === 0}>
                      <MoveRight size={15} />
                      Move
                    </button>
                    <button className="btn btn-secondary" onClick={handleRescan} disabled={busy}>
                      <RefreshCw size={15} />
                      Rescan
                    </button>
                    <button className="btn btn-danger" onClick={handlePreviewDelete} disabled={busy || isReadOnlyRoot || selectedPaths.length === 0}>
                      <Trash2 size={15} />
                      Delete to Trash
                    </button>
                  </div>
                </div>

                <div className="file-manager-table">
                  <div className="file-manager-table-head">
                    <div />
                    <div>Name</div>
                    <div>Type</div>
                    <div>Modified</div>
                    <div>Size</div>
                  </div>
                  {treeData.entries.length === 0 ? (
                    <div className="admin-empty-state">This folder is empty.</div>
                  ) : (
                    treeData.entries.map((entry) => (
                      <div key={entry.path} className={`file-manager-row ${selectedPaths.includes(entry.path) ? "selected" : ""}`}>
                        <label className="admin-checkbox-inline">
                          <input
                            type="checkbox"
                            checked={selectedPaths.includes(entry.path)}
                            onChange={() => togglePathSelection(entry.path)}
                          />
                        </label>
                        <button className="file-manager-name-cell" onClick={() => handleNavigateInto(entry)}>
                          {entry.type === "directory" ? <FolderOpen size={16} /> : <File size={16} />}
                          <span>{entry.name}</span>
                          {entry.isProtected && <small className="admin-pill">Protected</small>}
                        </button>
                        <div>{entry.type === "directory" ? "Folder" : "File"}</div>
                        <div>{formatDate(entry.modifiedAt)}</div>
                        <div>{entry.type === "directory" ? "—" : formatBytes(entry.size)}</div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {viewMode === "trash" && trashData && (
              <>
                <div className="file-manager-action-bar">
                  <div className="file-manager-selection-copy">
                    <strong>{selectedTrashIds.length}</strong>
                    <span>selected</span>
                    <small>Restore is preferred. Permanent delete is final.</small>
                  </div>
                  <div className="admin-toolbar-actions">
                    <button className="btn btn-secondary" onClick={handleRefresh} disabled={busy || loading}>
                      <RefreshCw size={15} className={loading ? "animate-spin" : ""} />
                      Refresh
                    </button>
                    <button className="btn btn-secondary" onClick={handleRestore} disabled={busy || isReadOnlyRoot || selectedTrashIds.length === 0}>
                      <RotateCcw size={15} />
                      Restore
                    </button>
                    <button className="btn btn-danger" onClick={() => setPermanentDeleteDialogOpen(true)} disabled={busy || isReadOnlyRoot || selectedTrashIds.length === 0}>
                      <Trash2 size={15} />
                      Delete Permanently
                    </button>
                  </div>
                </div>

                <div className="file-manager-table">
                  <div className="file-manager-table-head file-manager-trash-head">
                    <div />
                    <div>Name</div>
                    <div>Original Path</div>
                    <div>Deleted</div>
                    <div>Size</div>
                  </div>
                  {trashData.items.length === 0 ? (
                    <div className="admin-empty-state">Trash is empty for this root.</div>
                  ) : (
                    trashData.items.map((item) => (
                      <div key={item.trashId} className={`file-manager-row ${selectedTrashIds.includes(item.trashId) ? "selected" : ""}`}>
                        <label className="admin-checkbox-inline">
                          <input
                            type="checkbox"
                            checked={selectedTrashIds.includes(item.trashId)}
                            onChange={() => toggleTrashSelection(item.trashId)}
                          />
                        </label>
                        <div className="file-manager-name-static">
                          {item.itemType === "directory" ? <FolderOpen size={16} /> : <File size={16} />}
                          <span>{item.itemName}</span>
                        </div>
                        <div className="file-manager-path-cell">{item.originalPath}</div>
                        <div>{formatDate(item.deletedAt)}</div>
                        <div>{item.itemType === "directory" ? "Folder" : formatBytes(item.size)}</div>
                      </div>
                    ))
                  )}
                </div>
              </>
            )}

            {!loading && roots.length === 0 && (
              <div className="admin-empty-state file-manager-empty-state">
                Nothing here yet. Add a library source in settings, then come back to manage it.
              </div>
            )}
          </section>
        </div>
      </div>

      {dialog && (
        <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && !busy && setDialog(null)}>
          <div className="card file-manager-dialog">
            <div className="file-manager-dialog-head">
              <h3>
                {dialog.type === "create" && "Create Folder"}
                {dialog.type === "rename" && "Rename Item"}
                {dialog.type === "move" && "Move Items"}
              </h3>
              <button className="file-manager-dialog-close" onClick={() => setDialog(null)} disabled={busy} aria-label="Close">
                <X size={16} />
              </button>
            </div>

            {dialog.type === "create" && (
              <>
                <label className="filter-field">
                  <span>Folder name</span>
                  <input className="form-control" value={folderName} onChange={(event) => setFolderName(event.target.value)} />
                </label>
                <div className="confirm-dialog-actions">
                  <button className="btn btn-secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => void handleCreateFolder()} disabled={busy || !folderName.trim()}>Create</button>
                </div>
              </>
            )}

            {dialog.type === "rename" && (
              <>
                <label className="filter-field">
                  <span>New name</span>
                  <input className="form-control" value={renameValue} onChange={(event) => setRenameValue(event.target.value)} />
                </label>
                <div className="confirm-dialog-actions">
                  <button className="btn btn-secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => void handleRename()} disabled={busy || !renameValue.trim()}>Rename</button>
                </div>
              </>
            )}

            {dialog.type === "move" && (
              <>
                <label className="filter-field">
                  <span>Destination path</span>
                  <input className="form-control" value={destinationPath} onChange={(event) => setDestinationPath(event.target.value)} />
                </label>
                <p className="file-manager-dialog-hint">Use a folder path inside the active root. The server rejects escapes and protected folders.</p>
                <div className="confirm-dialog-actions">
                  <button className="btn btn-secondary" onClick={() => setDialog(null)} disabled={busy}>Cancel</button>
                  <button className="btn btn-primary" onClick={() => void handleMove()} disabled={busy || !destinationPath.trim()}>Move</button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {deleteDialogOpen && deletePreview && (
        <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && !busy && setDeleteDialogOpen(false)}>
          <div className="card file-manager-dialog file-manager-preview-dialog">
            <div className="file-manager-dialog-head">
              <h3>Delete Preview</h3>
              <button className="file-manager-dialog-close" onClick={() => setDeleteDialogOpen(false)} disabled={busy} aria-label="Close">
                <X size={16} />
              </button>
            </div>
            <div className="file-manager-preview-grid">
              <div><strong>{deletePreview.itemCount}</strong><span>items</span></div>
              <div><strong>{deletePreview.directoryCount}</strong><span>folders</span></div>
              <div><strong>{deletePreview.fileCount}</strong><span>files</span></div>
              <div><strong>{deletePreview.affectedBookCount}</strong><span>scanned books</span></div>
            </div>
            {deletePreview.warnings.length > 0 && (
              <div className="file-manager-preview-block">
                <strong>Warnings</strong>
                <ul>
                  {deletePreview.warnings.map((warning) => (
                    <li key={warning}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {deletePreview.affectedBooks.length > 0 && (
              <div className="file-manager-preview-block">
                <strong>Affected books</strong>
                <ul>
                  {deletePreview.affectedBooks.map((book) => (
                    <li key={book.id}>{book.title}</li>
                  ))}
                </ul>
              </div>
            )}
            <div className="confirm-dialog-actions">
              <button className="btn btn-secondary" onClick={() => setDeleteDialogOpen(false)} disabled={busy}>Cancel</button>
              <button className="btn btn-danger" onClick={() => void handleDelete()} disabled={busy}>Move to Trash</button>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={permanentDeleteDialogOpen}
        title="Delete trash permanently?"
        message={`Remove ${selectedTrashIds.length} selected trash item${selectedTrashIds.length === 1 ? "" : "s"} permanently. This cannot be undone.`}
        confirmLabel="Delete Permanently"
        tone="danger"
        busy={busy}
        onCancel={() => setPermanentDeleteDialogOpen(false)}
        onConfirm={() => void handlePermanentDelete()}
      />
    </div>
  );
};

export default AdminFileManagerPage;
