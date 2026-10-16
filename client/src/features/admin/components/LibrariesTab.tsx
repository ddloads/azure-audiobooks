import { useEffect, useRef, useState } from "react";
import { FolderPlus, FolderTree, Library, RefreshCw, Upload, Volume2, X, Zap } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import { useScanProgress } from "../../../context/ScanProgressContext";
import ConfirmDialog from "../../../components/ConfirmDialog";
import type { AdminLibrary, AdminLibrarySource, PendingAdminConfirm, StructureCheckResult } from "../types";
import { getErrorMessage } from "../helpers";
import { Actions, Button, EmptyState, Field, FormGrid, Panel, Progress, Stack } from "../ui";
import LibraryCard, { type LibraryDraft } from "./libraries/LibraryCard";
import SilenceResultsPanel, { type SilenceCheckResults } from "./libraries/SilenceResultsPanel";
import type { SourceDraft, SourceFlag } from "./libraries/SourceList";
import "./LibrariesTab.css";

interface LibrariesTabProps {
  libraries: AdminLibrary[];
  onRefresh: () => Promise<unknown> | unknown;
  onRequestUpload: () => void;
}

export default function LibrariesTab({ libraries, onRefresh, onRequestUpload }: LibrariesTabProps) {
  const { showToast } = useToast();
  const { silenceCheckProgress } = useScanProgress();

  const [creating, setCreating] = useState(false);
  const [newLibraryName, setNewLibraryName] = useState("");
  const [newLibraryDescription, setNewLibraryDescription] = useState("");

  const [silenceResults, setSilenceResults] = useState<SilenceCheckResults | null>(null);
  const [silenceResultsLoading, setSilenceResultsLoading] = useState(false);
  const prevSilenceStatusRef = useRef<string | null>(null);
  const lastSilenceResultsRefreshRef = useRef(0);

  const [structureCheckResults, setStructureCheckResults] = useState<Record<string, StructureCheckResult | null>>({});
  const [structureCheckLoading, setStructureCheckLoading] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirm | null>(null);
  const isSilenceCheckActive =
    silenceCheckProgress?.status === "starting" || silenceCheckProgress?.status === "checking";

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionLoading(key);
    try {
      await action();
    } finally {
      setActionLoading(null);
    }
  };

  const fetchSilenceResults = async (showSpinner = true) => {
    if (showSpinner) setSilenceResultsLoading(true);
    try {
      const response = await api.get<SilenceCheckResults>("/admin/library/silence-check/results");
      setSilenceResults(response.data);
    } catch {
      // no results yet — leave panel hidden
    } finally {
      if (showSpinner) setSilenceResultsLoading(false);
    }
  };

  useEffect(() => {
    void fetchSilenceResults();
  }, []);

  useEffect(() => {
    const status = silenceCheckProgress?.status;
    if (status !== "starting" && status !== "checking") return;

    const interval = setInterval(() => {
      void fetchSilenceResults(false);
    }, 2000);

    return () => clearInterval(interval);
  }, [silenceCheckProgress?.status]);

  useEffect(() => {
    const status = silenceCheckProgress?.status;
    if (status !== "starting" && status !== "checking") return;

    const now = Date.now();
    if (now - lastSilenceResultsRefreshRef.current < 1000) return;
    lastSilenceResultsRefreshRef.current = now;
    void fetchSilenceResults(false);
  }, [
    silenceCheckProgress?.checkedFiles,
    silenceCheckProgress?.silentFiles,
    silenceCheckProgress?.status,
    silenceCheckProgress?.totalFiles,
  ]);

  useEffect(() => {
    const prev = prevSilenceStatusRef.current;
    const current = silenceCheckProgress?.status ?? null;
    prevSilenceStatusRef.current = current;

    if (prev !== null && prev !== "completed" && current === "completed") {
      void fetchSilenceResults(false);
      const silent = silenceCheckProgress?.silentFiles ?? 0;
      showToast({
        title: "Audio check complete",
        description:
          silent === 0
            ? "All checked files have audible content."
            : `Found ${silent} silent file${silent === 1 ? "" : "s"} — see results below.`,
        tone: silent === 0 ? "success" : "info",
      });
    }
  }, [silenceCheckProgress?.status]);

  const handleCreateLibrary = async () => {
    await runAction("create-library", async () => {
      try {
        await api.post("/admin/libraries", {
          name: newLibraryName.trim(),
          description: newLibraryDescription.trim(),
        });
        showToast({ title: "Library created", description: `Created ${newLibraryName.trim()}`, tone: "success" });
        setNewLibraryName("");
        setNewLibraryDescription("");
        setCreating(false);
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

  const handleUpdateLibrary = async (libraryId: string, draft: LibraryDraft) => {
    if (!draft.name.trim()) return false;
    let ok = false;
    await runAction(`update-library-${libraryId}`, async () => {
      try {
        await api.patch(`/admin/libraries/${libraryId}`, {
          name: draft.name.trim(),
          description: draft.description.trim(),
          isActive: draft.isActive,
          folderPattern: draft.folderPattern,
        });
        showToast({ title: "Library updated", tone: "success" });
        ok = true;
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to update library",
          description: getErrorMessage(error, "Failed to update library"),
          tone: "error",
        });
      }
    });
    return ok;
  };

  const handleDeleteLibrary = async (library: AdminLibrary) => {
    await runAction(`delete-library-${library.id}`, async () => {
      try {
        await api.delete(`/admin/libraries/${library.id}`);
        showToast({ title: "Library deleted", description: `Deleted ${library.name}`, tone: "success" });
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
      const response = await api.get<StructureCheckResult>(`/admin/libraries/${library.id}/structure-check`);
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

  const handleCreateSource = async (libraryId: string, draft: SourceDraft) => {
    if (!draft.path.trim()) return false;
    let ok = false;
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
        showToast({ title: "Source path added", tone: "success" });
        ok = true;
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to add source path",
          description: getErrorMessage(error, "Failed to add source path"),
          tone: "error",
        });
      }
    });
    return ok;
  };

  const handleToggleSource = async (sourceId: string, field: SourceFlag, value: boolean) => {
    await runAction(`update-source-${sourceId}-${field}`, async () => {
      try {
        await api.patch(`/admin/sources/${sourceId}`, { [field]: value });
        showToast({ title: "Source updated", tone: "success" });
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
        showToast({ title: "Source removed", description: `Removed source "${label}"`, tone: "success" });
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

  const handleSilenceCheck = async (recheckAll = false) => {
    const actionKey = recheckAll ? "silence-check-all" : "silence-check";
    await runAction(actionKey, async () => {
      try {
        const response = await api.post("/admin/library/silence-check", { recheckAll });
        if (response.data?.status === "skipped") {
          showToast({
            title: "Audio check already running",
            description: response.data.message || "A previous audio check is still in progress.",
            tone: "info",
          });
          return;
        }
        showToast({
          title: "Audio check started",
          description: recheckAll
            ? "Rechecking every audio file in the background."
            : "Checking new and previously-silent audio files in the background.",
          tone: "success",
        });
      } catch (error) {
        showToast({
          title: "Failed to start audio check",
          description: getErrorMessage(error, "Failed to start audio check"),
          tone: "error",
        });
      }
    });
  };

  const handleLibrarySilenceCheck = async (library: AdminLibrary, recheckAll = false) => {
    const actionKey = recheckAll ? `silence-check-all-${library.id}` : `silence-check-${library.id}`;
    await runAction(actionKey, async () => {
      try {
        const response = await api.post(`/admin/libraries/${library.id}/silence-check`, { recheckAll });
        if (response.data?.status === "skipped") {
          showToast({
            title: "Audio check already running",
            description: response.data.message || `An audio check for "${library.name}" is already in progress.`,
            tone: "info",
          });
          return;
        }
        showToast({
          title: "Audio check started",
          description: recheckAll
            ? `Rechecking every audio file in "${library.name}".`
            : `Checking new and previously-silent files in "${library.name}".`,
          tone: "success",
        });
      } catch (error) {
        showToast({
          title: "Failed to start audio check",
          description: getErrorMessage(error, "Failed to start audio check"),
          tone: "error",
        });
      }
    });
  };

  const confirmRemoveSource = (source: AdminLibrarySource) => {
    const label = source.label || source.path;
    setPendingConfirm({
      title: "Remove Source",
      message: `Remove source "${label}"?`,
      confirmLabel: "Remove Source",
      tone: "danger",
      onConfirm: () => void handleDeleteSource(source.id, label),
    });
  };

  const totalBooks = libraries.reduce((sum, library) => sum + library._count.books, 0);
  const totalSources = libraries.reduce((sum, library) => sum + library.sources.length, 0);
  const runningLibrary = silenceCheckProgress?.libraryId
    ? libraries.find((library) => library.id === silenceCheckProgress.libraryId)
    : undefined;

  return (
    <Stack>
      <Panel title="Library actions" icon={Zap} description="Run across every library. Scans and audio checks continue in the background.">
        <Stack gap="md">
          <div className="as-libraries-grid">
            <Button icon={RefreshCw} loading={actionLoading === "rescan-library"} onClick={() => void handleRescan()}>
              Rescan all libraries
            </Button>
            <Button
              icon={Volume2}
              loading={actionLoading === "silence-check"}
              onClick={() => void handleSilenceCheck()}
              title="Probe unchecked and previously-silent files to detect silent or broken tracks"
            >
              Check new/silent audio
            </Button>
            <Button
              icon={Volume2}
              loading={actionLoading === "silence-check-all"}
              onClick={() => void handleSilenceCheck(true)}
              title="Re-probe every audio file in every library"
            >
              Check all audio
            </Button>
            <Button variant="primary" icon={Upload} onClick={onRequestUpload}>
              Upload book
            </Button>
          </div>
          {isSilenceCheckActive && (
            <div className="as-libraries-run">
              <div className="as-libraries-run-head">
                <span>Audio check running{runningLibrary ? ` · ${runningLibrary.name}` : ""}</span>
                <span className="as-muted">
                  {(silenceCheckProgress?.checkedFiles ?? 0).toLocaleString()} / {(silenceCheckProgress?.totalFiles ?? 0).toLocaleString()}
                </span>
              </div>
              <Progress value={silenceCheckProgress?.progress ?? 0} label="Audio check progress" />
              {silenceCheckProgress?.currentFile && (
                <span className="as-libraries-path as-subtle">{silenceCheckProgress.currentFile}</span>
              )}
            </div>
          )}
        </Stack>
      </Panel>

      {creating && (
        <Panel title="New library" icon={FolderPlus} description="Add source folders after it's created." tone="accent">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (newLibraryName.trim()) void handleCreateLibrary();
            }}
          >
            <Stack gap="md">
              <FormGrid>
                <Field label="Library name" htmlFor="new-library-name">
                  <input
                    id="new-library-name"
                    className="form-control"
                    autoComplete="off"
                    placeholder="e.g. Audiobooks"
                    value={newLibraryName}
                    onChange={(e) => setNewLibraryName(e.target.value)}
                  />
                </Field>
                <Field label="Description" htmlFor="new-library-description">
                  <input
                    id="new-library-description"
                    className="form-control"
                    autoComplete="off"
                    placeholder="Optional"
                    value={newLibraryDescription}
                    onChange={(e) => setNewLibraryDescription(e.target.value)}
                  />
                </Field>
              </FormGrid>
              <Actions>
                <Button
                  variant="ghost"
                  icon={X}
                  onClick={() => {
                    setCreating(false);
                    setNewLibraryName("");
                    setNewLibraryDescription("");
                  }}
                >
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  icon={FolderTree}
                  disabled={!newLibraryName.trim()}
                  loading={actionLoading === "create-library"}
                >
                  Create library
                </Button>
              </Actions>
            </Stack>
          </form>
        </Panel>
      )}

      <div className="as-libraries-sectionhead">
        <div>
          <h3 className="as-panel-title">
            <Library size={16} aria-hidden="true" />
            Libraries
          </h3>
          <p className="as-panel-desc">
            {libraries.length} {libraries.length === 1 ? "library" : "libraries"} · {totalBooks.toLocaleString()}{" "}
            {totalBooks === 1 ? "book" : "books"} · {totalSources} {totalSources === 1 ? "source" : "sources"}
          </p>
        </div>
        {!creating && (
          <Button variant="primary" size="sm" icon={FolderPlus} onClick={() => setCreating(true)}>
            Add library
          </Button>
        )}
      </div>

      {libraries.length === 0 ? (
        <Panel>
          <EmptyState
            icon={FolderTree}
            title="No libraries yet"
            action={
              !creating && (
                <Button variant="primary" icon={FolderPlus} onClick={() => setCreating(true)}>
                  Add library
                </Button>
              )
            }
          >
            Create a library, then add the folders that hold your audiobooks.
          </EmptyState>
        </Panel>
      ) : (
        <div className="as-libraries-cards">
          {libraries.map((library) => (
            <LibraryCard
              key={library.id}
              library={library}
              actionLoading={actionLoading}
              structureResult={structureCheckResults[library.id]}
              structureLoading={structureCheckLoading === library.id}
              onSave={(draft) => handleUpdateLibrary(library.id, draft)}
              onScan={() => void handleRescanSingleLibrary(library)}
              onSilenceCheck={(recheckAll) => void handleLibrarySilenceCheck(library, recheckAll)}
              onCheckStructure={() => void handleCheckStructure(library)}
              onPurge={() =>
                setPendingConfirm({
                  title: "Purge Library Database",
                  message: `Delete all books, audio files, chapters, and progress records from "${library.name}"? The library and source paths will stay in place so you can rescan from scratch.`,
                  confirmLabel: "Purge Library",
                  tone: "danger",
                  onConfirm: () => void handlePurgeLibrary(library),
                })
              }
              onDelete={() =>
                setPendingConfirm({
                  title: "Delete Library",
                  message: `Delete library "${library.name}"?`,
                  confirmLabel: "Delete Library",
                  tone: "danger",
                  onConfirm: () => void handleDeleteLibrary(library),
                })
              }
              onToggleSource={(sourceId, field, value) => void handleToggleSource(sourceId, field, value)}
              onRemoveSource={confirmRemoveSource}
              onCreateSource={(draft) => handleCreateSource(library.id, draft)}
            />
          ))}
        </div>
      )}

      {(silenceResults !== null || silenceResultsLoading) && (
        <SilenceResultsPanel
          results={silenceResults}
          loading={silenceResultsLoading}
          onRefresh={() => void fetchSilenceResults()}
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
    </Stack>
  );
}
