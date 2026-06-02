import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import {
  ArrowLeft,
  Bug,
  Copy,
  Database,
  FileText,
  FolderTree,
  Headphones,
  Palette,
  RefreshCw,
  Shield,
  Smartphone,
  Terminal,
  Upload,
  Users,
} from "lucide-react";
import api from "../api/axios";
import { getSocketBaseUrl } from "../api/backend";
import { useTasks } from "../context/TaskContext";
import { useToast } from "../context/ToastContext";

import type {
  TabKey,
  DashboardData,
  AdminUser,
  AdminLibrary,
  AdminRuntimeTask,
  AdminRuntimeTasksResponse,
  AdminWriteTagsJob,
} from "../features/admin/types";
import { getErrorMessage } from "../features/admin/helpers";

type ScanProgressEvent = {
  libraryId?: string;
  status: "starting" | "scanning" | "completed" | "failed";
  progress: number;
  currentFolder?: string;
  totalFolders?: number;
  scannedFolders?: number;
};

type MergeProgressEvent = {
  bookId: string;
  status: "starting" | "running" | "completed" | "failed";
  progress: number;
  stage: string;
  detail?: string;
};

type WriteTagsProgressEvent = AdminWriteTagsJob;

import OverviewTab from "../features/admin/components/OverviewTab";
import UsersTab from "../features/admin/components/UsersTab";
import LibrariesTab from "../features/admin/components/LibrariesTab";
import AppearanceTab from "../features/admin/components/AppearanceTab";
import ScriptsTab from "../features/admin/components/ScriptsTab";
import SystemTab from "../features/admin/components/SystemTab";
import ReportsTab from "../features/admin/components/ReportsTab";
import LogsTab from "../features/admin/components/LogsTab";
import SessionsTab from "../features/admin/components/SessionsTab";
import MobileAppTab from "../features/admin/components/MobileAppTab";

interface AdminSettingsModalProps {
  onLibraryChanged: () => Promise<void> | void;
  onRequestUpload: () => void;
}

const tabs: Array<{ key: TabKey; label: string; icon: typeof Shield; description: string }> = [
  {
    key: "overview",
    label: "Overview",
    icon: Shield,
    description: "Live status, recent activity, and overall library health.",
  },
  {
    key: "users",
    label: "Users",
    icon: Users,
    description: "Accounts, roles, password resets, and listener management.",
  },
  {
    key: "library",
    label: "Libraries",
    icon: FolderTree,
    description: "Libraries, mapped drives, network paths, and scanned inventory.",
  },
  {
    key: "appearance",
    label: "Appearance",
    icon: Palette,
    description: "Control which library items are visible in the catalog.",
  },
  {
    key: "scripts",
    label: "Scripts",
    icon: Terminal,
    description: "Run approved maintenance scripts from the server.",
  },
  {
    key: "system",
    label: "System",
    icon: Database,
    description: "Backups, storage paths, and maintenance controls.",
  },
  {
    key: "mobile",
    label: "Mobile App",
    icon: Smartphone,
    description: "Publish the Azure Player APK served by the Connect Mobile App modal.",
  },
  {
    key: "reports",
    label: "Reports",
    icon: Bug,
    description: "User-submitted issue reports and optional comments.",
  },
  {
    key: "logs",
    label: "Logs",
    icon: FileText,
    description: "Structured application logs, request traces, and error inspection.",
  },
  {
    key: "sessions",
    label: "Sessions",
    icon: Headphones,
    description: "All user listening sessions with platform, duration, and activity.",
  },
];

const upsertRuntimeTask = (tasks: AdminRuntimeTask[], nextTask: AdminRuntimeTask) => {
  const filtered = tasks.filter((task) => task.id !== nextTask.id);
  return [...filtered, nextTask].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

const removeRuntimeTask = (tasks: AdminRuntimeTask[], taskId: string) =>
  tasks.filter((task) => task.id !== taskId);

const AdminSettingsModal = ({
  onLibraryChanged,
  onRequestUpload,
}: AdminSettingsModalProps) => {
  const location = useLocation();
  const navigate = useNavigate();
  const { tasks: clientTasks } = useTasks();
  const { showToast } = useToast();

  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [libraries, setLibraries] = useState<AdminLibrary[]>([]);
  const [runtimeTasks, setRuntimeTasks] = useState<AdminRuntimeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const backTarget =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/";

  const activeLibraries = libraries.filter((library) => library.isActive).length;
  
  const activeTasks: AdminRuntimeTask[] = [...runtimeTasks];
  const runningTaskCount = activeTasks.length + clientTasks.length;

  const activeTabConfig = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];
  const ActiveTabIcon = activeTabConfig.icon;

  const loadDashboard = async () => {
    try {
      const response = await api.get<DashboardData>("/admin/dashboard");
      setDashboard(response.data);
      return true;
    } catch (error) {
      setDashboard(null);
      showToast({
        title: "Failed to load overview",
        description: getErrorMessage(error, "Failed to load overview"),
        tone: "error",
      });
      return false;
    }
  };

  const loadUsersData = async () => {
    try {
      const response = await api.get<AdminUser[]>("/admin/users");
      setUsers(response.data);
      return true;
    } catch (error) {
      setUsers([]);
      showToast({
        title: "Failed to load users",
        description: getErrorMessage(error, "Failed to load users"),
        tone: "error",
      });
      return false;
    }
  };

  const loadLibrariesData = async () => {
    try {
      const response = await api.get<AdminLibrary[]>("/admin/libraries");
      setLibraries(response.data);
      return true;
    } catch (error) {
      setLibraries([]);
      showToast({
        title: "Failed to load libraries",
        description: getErrorMessage(error, "Failed to load libraries"),
        tone: "error",
      });
      return false;
    }
  };

  const loadRuntimeTasks = async () => {
    try {
      const response = await api.get<AdminRuntimeTasksResponse>("/admin/tasks");
      setRuntimeTasks(response.data.active);
    } catch (actionError) {
      console.error("Failed to load runtime tasks", actionError);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.allSettled([
      loadDashboard(),
      loadUsersData(),
      loadLibrariesData(),
      loadRuntimeTasks(),
    ]);
    setLoading(false);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  useEffect(() => {
    if (activeTab === "overview") {
      void loadDashboard();
      void loadRuntimeTasks();
    } else if (activeTab === "users" || activeTab === "sessions") {
      void loadUsersData();
    } else if (activeTab === "library") {
      void loadLibrariesData();
    }
  }, [activeTab]);

  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;

    const tick = async () => {
      if (document.visibilityState === "hidden") {
        timeoutId = window.setTimeout(tick, 10000);
        return;
      }

      await loadRuntimeTasks();
      if (cancelled) return;

      timeoutId = window.setTimeout(tick, runtimeTasks.length > 0 ? 2500 : 10000);
    };

    timeoutId = window.setTimeout(tick, 2500);

    return () => {
      cancelled = true;
      if (timeoutId !== null) {
        window.clearTimeout(timeoutId);
      }
    };
  }, [runtimeTasks.length]);

  useEffect(() => {
    const socket = io(getSocketBaseUrl(), {
      withCredentials: true,
    });

    const handleScanProgress = (event: ScanProgressEvent) => {
      const taskId = `scan-${event.libraryId || "all"}`;
      if (event.status === "completed" || event.status === "failed") {
        setRuntimeTasks((current) => removeRuntimeTask(current, taskId));
        return;
      }

      setRuntimeTasks((current) => {
        const existing = current.find((task) => task.id === taskId);
        return upsertRuntimeTask(current, {
          id: taskId,
          type: "scan",
          status: event.status,
          title: event.libraryId ? "Library scan" : "Full library scan",
          progress: event.progress,
          detail:
            event.currentFolder ||
            (event.totalFolders
              ? `${event.scannedFolders || 0}/${event.totalFolders} folders`
              : "Preparing scan"),
          startedAt: existing?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
        });
      });
    };

    const handleMergeProgress = (event: MergeProgressEvent) => {
      const taskId = `merge-${event.bookId}`;
      if (event.status === "completed" || event.status === "failed") {
        setRuntimeTasks((current) => removeRuntimeTask(current, taskId));
        return;
      }

      setRuntimeTasks((current) => {
        const existing = current.find((task) => task.id === taskId);
        return upsertRuntimeTask(current, {
          id: taskId,
          type: "merge",
          status: event.status,
          title: "Merge to M4B",
          progress: event.progress,
          detail: event.detail || event.stage,
          stage: event.stage,
          startedAt: existing?.startedAt || new Date().toISOString(),
          updatedAt: new Date().toISOString(),
          bookId: event.bookId,
        });
      });
    };

    const handleWriteTagsProgress = (job: WriteTagsProgressEvent) => {
      if (job.status === "completed" || job.status === "failed") {
        setRuntimeTasks((current) => removeRuntimeTask(current, job.id));
        return;
      }

      setRuntimeTasks((current) =>
        upsertRuntimeTask(current, {
          id: job.id,
          type: "write-tags",
          status: job.status,
          title: job.bookTitle || "Untitled book",
          progress: job.totalFiles > 0 ? Math.round((job.processedFiles / job.totalFiles) * 100) : 0,
          detail:
            job.currentFile?.split(/[/\\]/).pop() ||
            job.message ||
            `${job.processedFiles}/${job.totalFiles} files`,
          startedAt: job.startedAt,
          updatedAt: job.updatedAt,
        }),
      );
    };

    socket.on("scanProgress", handleScanProgress);
    socket.on("mergeProgress", handleMergeProgress);
    socket.on("writeTagsProgress", handleWriteTagsProgress);

    return () => {
      socket.off("scanProgress", handleScanProgress);
      socket.off("mergeProgress", handleMergeProgress);
      socket.off("writeTagsProgress", handleWriteTagsProgress);
      socket.disconnect();
    };
  }, []);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionLoading(key);
    try {
      await action();
    } finally {
      setActionLoading(null);
    }
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
        await loadAll();
        if (onLibraryChanged) {
          await onLibraryChanged();
        }
      } catch (actionError) {
        showToast({
          title: "Failed to scan library",
          description: getErrorMessage(actionError, "Failed to scan library"),
          tone: "error",
        });
      }
    });
  };

  const openUploadFlow = () => {
    onRequestUpload();
  };

  return (
    <div className="admin-settings-page">
      <div className="admin-settings-page-shell animate-fade-in">

        {/* Header */}
        <div className="admin-settings-header">
          <div className="admin-settings-header-left">
            <Link to={backTarget} className="admin-back-btn" aria-label="Back">
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="admin-settings-title">Settings</h1>
              <p className="admin-settings-subtitle">
                {activeLibraries || dashboard?.stats.libraries || 0} {(activeLibraries || dashboard?.stats.libraries || 0) === 1 ? "library" : "libraries"}
                {dashboard?.stats.books ? ` · ${dashboard.stats.books.toLocaleString()} books` : ""}
                {runningTaskCount > 0 ? ` · ${runningTaskCount} active ${runningTaskCount === 1 ? "task" : "tasks"}` : ""}
              </p>
            </div>
          </div>
          <div className="admin-header-actions">
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
              Rescan
            </button>
            <button className="btn btn-primary" type="button" onClick={openUploadFlow}>
              <Upload size={15} />
              Upload
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="admin-settings-layout">
          <aside className="admin-settings-sidebar">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`admin-nav-btn${activeTab === key ? " admin-nav-btn-active" : ""}`}
                onClick={() => setActiveTab(key)}
                type="button"
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}

            <div className="admin-sidebar-divider" />

            <button
              className="admin-nav-btn admin-nav-btn-muted"
              type="button"
              onClick={() => navigate("/duplicates", { state: { from: backTarget } })}
            >
              <Copy size={15} />
              <span>Duplicates</span>
            </button>
          </aside>

          <section className="admin-settings-content">
            {loading ? (
              <div className="admin-settings-loading">
                <div className="app-loading-spinner" />
              </div>
            ) : (
              <>
                <div className="admin-content-topbar">
                  <div className="admin-content-title-row">
                    <ActiveTabIcon size={16} className="admin-content-title-icon" />
                    <h2 className="admin-content-title">{activeTabConfig.label}</h2>
                  </div>
                  <p className="admin-content-desc">{activeTabConfig.description}</p>
                </div>

                {activeTab === "overview" && dashboard && (
                  <OverviewTab
                    dashboard={dashboard}
                    libraries={libraries}
                    runtimeTasks={runtimeTasks}
                  />
                )}
                {activeTab === "users" && (
                  <UsersTab users={users} onRefresh={loadUsersData} />
                )}
                {activeTab === "library" && (
                  <LibrariesTab
                    libraries={libraries}
                    onRefresh={loadLibrariesData}
                    onRequestUpload={openUploadFlow}
                  />
                )}
                {activeTab === "appearance" && <AppearanceTab />}
                {activeTab === "scripts" && <ScriptsTab />}
                {activeTab === "system" && <SystemTab onLibraryChanged={onLibraryChanged} />}
                {activeTab === "mobile" && <MobileAppTab />}
                {activeTab === "reports" && <ReportsTab />}
                {activeTab === "logs" && <LogsTab />}
                {activeTab === "sessions" && <SessionsTab users={users} />}
              </>
            )}
          </section>
        </div>
      </div>
    </div>
  );
};

export default AdminSettingsModal;
