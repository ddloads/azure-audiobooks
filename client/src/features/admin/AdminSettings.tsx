import { useCallback, useEffect, useState } from "react";
import { Link, Navigate, NavLink, useLocation, useNavigate, useParams } from "react-router-dom";
import { io } from "socket.io-client";
import { ArrowLeft, ChevronLeft, ChevronRight, RefreshCw, Upload } from "lucide-react";
import api from "../../api/axios";
import { getSocketBaseUrl } from "../../api/backend";
import { useTasks } from "../../context/TaskContext";
import { useToast } from "../../context/ToastContext";
import { useBreakpoint } from "../../hooks/useBreakpoint";
import type {
  AdminLibrary,
  AdminRuntimeTask,
  AdminRuntimeTasksResponse,
  AdminUser,
  AdminWriteTagsJob,
  DashboardData,
  TabKey,
} from "./types";
import { getErrorMessage } from "./helpers";
import { SECTION_GROUPS, findSectionBySlug, type SectionConfig } from "./sections";
import { Button } from "./ui";

import OverviewTab from "./components/OverviewTab";
import UsersTab from "./components/UsersTab";
import LibrariesTab from "./components/LibrariesTab";
import AppearanceTab from "./components/AppearanceTab";
import ScriptsTab from "./components/ScriptsTab";
import SystemTab from "./components/SystemTab";
import ReportsTab from "./components/ReportsTab";
import LogsTab from "./components/LogsTab";
import SessionsTab from "./components/SessionsTab";
import MobileAppTab from "./components/MobileAppTab";

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

interface AdminSettingsProps {
  onLibraryChanged: () => Promise<void> | void;
  onRequestUpload: () => void;
}

const upsertRuntimeTask = (tasks: AdminRuntimeTask[], nextTask: AdminRuntimeTask) => {
  const filtered = tasks.filter((task) => task.id !== nextTask.id);
  return [...filtered, nextTask].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
};

const removeRuntimeTask = (tasks: AdminRuntimeTask[], taskId: string) =>
  tasks.filter((task) => task.id !== taskId);

const plural = (count: number, one: string, many = `${one}s`) => `${count.toLocaleString()} ${count === 1 ? one : many}`;

export default function AdminSettings({ onLibraryChanged, onRequestUpload }: AdminSettingsProps) {
  const { section: slug } = useParams<{ section?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { isNarrow } = useBreakpoint();
  const { tasks: clientTasks } = useTasks();
  const { showToast } = useToast();

  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [libraries, setLibraries] = useState<AdminLibrary[]>([]);
  const [runtimeTasks, setRuntimeTasks] = useState<AdminRuntimeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [rescanning, setRescanning] = useState(false);

  // Where "back" leaves the settings area to. Kept in history state while
  // moving between sections so it survives navigation inside /settings.
  const exitTarget =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/";
  const navState = { from: exitTarget };

  const active = findSectionBySlug(slug);
  const activeKey: TabKey | null = active?.key ?? null;

  const loadDashboard = useCallback(async () => {
    try {
      const response = await api.get<DashboardData>("/admin/dashboard");
      setDashboard(response.data);
    } catch (error) {
      setDashboard(null);
      showToast({ title: "Failed to load overview", description: getErrorMessage(error, "Failed to load overview"), tone: "error" });
    }
  }, [showToast]);

  const loadUsersData = useCallback(async () => {
    try {
      const response = await api.get<AdminUser[]>("/admin/users");
      setUsers(response.data);
    } catch (error) {
      setUsers([]);
      showToast({ title: "Failed to load users", description: getErrorMessage(error, "Failed to load users"), tone: "error" });
    }
  }, [showToast]);

  const loadLibrariesData = useCallback(async () => {
    try {
      const response = await api.get<AdminLibrary[]>("/admin/libraries");
      setLibraries(response.data);
    } catch (error) {
      setLibraries([]);
      showToast({ title: "Failed to load libraries", description: getErrorMessage(error, "Failed to load libraries"), tone: "error" });
    }
  }, [showToast]);

  const loadRuntimeTasks = useCallback(async () => {
    try {
      const response = await api.get<AdminRuntimeTasksResponse>("/admin/tasks");
      setRuntimeTasks(response.data.active);
    } catch (error) {
      console.error("Failed to load runtime tasks", error);
    }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    await Promise.allSettled([loadDashboard(), loadUsersData(), loadLibrariesData(), loadRuntimeTasks()]);
    setLoading(false);
  }, [loadDashboard, loadUsersData, loadLibrariesData, loadRuntimeTasks]);

  useEffect(() => {
    void loadAll();
  }, []);

  // Refresh the data a section depends on when it is opened.
  useEffect(() => {
    if (activeKey === "overview") {
      void loadDashboard();
      void loadRuntimeTasks();
    } else if (activeKey === "users" || activeKey === "sessions") {
      void loadUsersData();
    } else if (activeKey === "library") {
      void loadLibrariesData();
    }
  }, [activeKey]);

  // Poll background tasks: fast while something runs, slow otherwise.
  useEffect(() => {
    let cancelled = false;
    let timeoutId: number | null = null;
    const tick = async () => {
      if (document.visibilityState !== "hidden") await loadRuntimeTasks();
      if (cancelled) return;
      timeoutId = window.setTimeout(tick, runtimeTasks.length > 0 ? 2500 : 10000);
    };
    timeoutId = window.setTimeout(tick, 2500);
    return () => {
      cancelled = true;
      if (timeoutId !== null) window.clearTimeout(timeoutId);
    };
  }, [runtimeTasks.length, loadRuntimeTasks]);

  useEffect(() => {
    const socket = io(getSocketBaseUrl(), { withCredentials: true });

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
            (event.totalFolders ? `${event.scannedFolders || 0}/${event.totalFolders} folders` : "Preparing scan"),
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

    const handleWriteTagsProgress = (job: AdminWriteTagsJob) => {
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
          detail: job.currentFile?.split(/[/\\]/).pop() || job.message || `${job.processedFiles}/${job.totalFiles} files`,
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

  const handleRescan = async () => {
    setRescanning(true);
    try {
      await api.post("/admin/library/scan");
      showToast({ title: "Library scan started", description: "The full library rescan has been queued.", tone: "success" });
      await loadAll();
      await onLibraryChanged?.();
    } catch (error) {
      showToast({ title: "Failed to scan library", description: getErrorMessage(error, "Failed to scan library"), tone: "error" });
    } finally {
      setRescanning(false);
    }
  };

  // Unknown slug → back to the index.
  if (slug && !active) return <Navigate to="/settings" replace state={navState} />;
  // Wide screens always show a section next to the sidebar.
  if (!isNarrow && !active) return <Navigate to="/settings/overview" replace state={navState} />;

  const libraryCount = libraries.filter((library) => library.isActive).length || dashboard?.stats.libraries || 0;
  const runningTaskCount = runtimeTasks.length + clientTasks.length;
  const summary = [
    plural(libraryCount, "library", "libraries"),
    dashboard?.stats.books ? plural(dashboard.stats.books, "book") : null,
    runningTaskCount > 0 ? `${plural(runningTaskCount, "active task")}` : null,
  ].filter(Boolean).join(" · ");

  const statusFor = (key: TabKey): string | null => {
    switch (key) {
      case "overview":
        return runningTaskCount > 0 ? `${runningTaskCount} running` : null;
      case "library":
        return libraryCount ? String(libraryCount) : null;
      case "users":
        return users.length ? String(users.length) : null;
      default:
        return null;
    }
  };

  const quickActions = (
    <>
      <Button icon={RefreshCw} loading={rescanning} onClick={() => void handleRescan()}>Rescan</Button>
      <Button variant="primary" icon={Upload} onClick={onRequestUpload}>Upload</Button>
    </>
  );

  const renderSection = (key: TabKey) => {
    switch (key) {
      case "overview":
        return dashboard ? <OverviewTab dashboard={dashboard} libraries={libraries} runtimeTasks={runtimeTasks} /> : null;
      case "users":
        return <UsersTab users={users} onRefresh={loadUsersData} />;
      case "library":
        return <LibrariesTab libraries={libraries} onRefresh={loadLibrariesData} onRequestUpload={onRequestUpload} />;
      case "appearance":
        return <AppearanceTab />;
      case "scripts":
        return <ScriptsTab />;
      case "system":
        return <SystemTab onLibraryChanged={onLibraryChanged} />;
      case "mobile":
        return <MobileAppTab />;
      case "reports":
        return <ReportsTab />;
      case "logs":
        return <LogsTab />;
      case "sessions":
        return <SessionsTab users={users} />;
      default:
        return null;
    }
  };

  const body = (section: SectionConfig) =>
    loading ? (
      <div className="as-loading" aria-live="polite"><div className="app-loading-spinner" /></div>
    ) : (
      renderSection(section.key)
    );

  /* ── Phones & tablets: index list → full-screen section ─────────────── */
  if (isNarrow) {
    if (!active) {
      return (
        <div className="as-page as-page-narrow">
          <header className="as-hub-head">
            <Link to={exitTarget} className="as-icon-link" aria-label="Leave settings">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="as-hub-title">Settings</h1>
              {summary && <p className="as-hub-summary">{summary}</p>}
            </div>
          </header>

          <div className="as-hub-actions">{quickActions}</div>

          {SECTION_GROUPS.map((group) => (
            <nav key={group.label} className="as-hub-group" aria-label={group.label}>
              <h2 className="as-hub-group-label">{group.label}</h2>
              <ul className="as-hub-list">
                {group.sections.map((section) => {
                  const Icon = section.icon;
                  const status = statusFor(section.key);
                  return (
                    <li key={section.key}>
                      <Link to={`/settings/${section.slug}`} state={navState} className="as-hub-row">
                        <span className="as-hub-icon"><Icon size={17} /></span>
                        <span className="as-hub-text">
                          <span className="as-hub-label">{section.label}</span>
                          <span className="as-hub-desc">{section.description}</span>
                        </span>
                        {status && <span className="as-hub-status">{status}</span>}
                        <ChevronRight size={16} className="as-hub-chevron" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
                {group.links?.map((link) => {
                  const Icon = link.icon;
                  return (
                    <li key={link.to}>
                      <Link to={link.to} state={{ from: "/settings" }} className="as-hub-row">
                        <span className="as-hub-icon"><Icon size={17} /></span>
                        <span className="as-hub-text">
                          <span className="as-hub-label">{link.label}</span>
                          <span className="as-hub-desc">{link.description}</span>
                        </span>
                        <ChevronRight size={16} className="as-hub-chevron" aria-hidden="true" />
                      </Link>
                    </li>
                  );
                })}
              </ul>
            </nav>
          ))}
        </div>
      );
    }

    const Icon = active.icon;
    return (
      <div className="as-page as-page-narrow">
        <header className="as-section-bar">
          <button
            type="button"
            className="as-back"
            onClick={() => navigate("/settings", { state: navState })}
            aria-label="Back to settings"
          >
            <ChevronLeft size={20} />
            <span>Settings</span>
          </button>
        </header>
        <div className="as-section-intro">
          <h1 className="as-section-title"><Icon size={20} aria-hidden="true" />{active.label}</h1>
          <p className="as-section-desc">{active.description}</p>
        </div>
        <div className="as-section-body">{body(active)}</div>
      </div>
    );
  }

  /* ── Desktop: grouped sidebar + section ─────────────────────────────── */
  const ActiveIcon = active!.icon;
  return (
    <div className="as-page as-page-wide">
      <div className="as-frame">
        <header className="as-frame-head">
          <div className="as-frame-heading">
            <Link to={exitTarget} className="as-icon-link" aria-label="Leave settings">
              <ArrowLeft size={18} />
            </Link>
            <div>
              <h1 className="as-hub-title">Settings</h1>
              {summary && <p className="as-hub-summary">{summary}</p>}
            </div>
          </div>
          <div className="as-frame-actions">{quickActions}</div>
        </header>

        <div className="as-frame-body">
          <aside className="as-sidebar">
            {SECTION_GROUPS.map((group) => (
              <nav key={group.label} className="as-nav-group" aria-label={group.label}>
                <h2 className="as-nav-label">{group.label}</h2>
                {group.sections.map((section) => {
                  const Icon = section.icon;
                  const status = statusFor(section.key);
                  return (
                    <NavLink
                      key={section.key}
                      to={`/settings/${section.slug}`}
                      state={navState}
                      className={({ isActive }) => `as-nav-link${isActive ? " as-nav-link-active" : ""}`}
                    >
                      <Icon size={16} aria-hidden="true" />
                      <span>{section.label}</span>
                      {status && <span className="as-nav-status">{status}</span>}
                    </NavLink>
                  );
                })}
                {group.links?.map((link) => {
                  const Icon = link.icon;
                  return (
                    <Link key={link.to} to={link.to} state={{ from: location.pathname }} className="as-nav-link as-nav-link-muted">
                      <Icon size={16} aria-hidden="true" />
                      <span>{link.label}</span>
                    </Link>
                  );
                })}
              </nav>
            ))}
          </aside>

          <main className="as-content">
            <div className="as-section-intro">
              <h2 className="as-section-title"><ActiveIcon size={20} aria-hidden="true" />{active!.label}</h2>
              <p className="as-section-desc">{active!.description}</p>
            </div>
            <div className="as-section-body">{body(active!)}</div>
          </main>
        </div>
      </div>
    </div>
  );
}
