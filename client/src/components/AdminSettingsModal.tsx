import { isAxiosError } from "axios";
import { useEffect, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { io } from "socket.io-client";
import {
  AlertCircle,
  AlertTriangle,
  ArrowLeft,
  BookOpen,
  Bug,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Clock,
  Copy,
  Database,
  Eye,
  EyeOff,
  FileText,
  FolderTree,
  Globe,
  HardDrive,
  Info,
  Loader2,
  Network,
  Pencil,
  Plus,
  RefreshCw,
  Save,
  ScanLine,
  Server,
  Settings,
  Shield,
  Sparkles,
  Trash2,
  Upload,
  UserPlus,
  Users,
  X,
} from "lucide-react";
import api from "../api/axios";
import { getSocketBaseUrl } from "../api/backend";
import { useTasks, type ClientRuntimeTask } from "../context/TaskContext";
import { useToast } from "../context/ToastContext";
import ConfirmDialog from "./ConfirmDialog";
import FolderBrowserModal from "./FolderBrowserModal";

type TabKey = "overview" | "users" | "library" | "system" | "logs";
type OverviewSectionKey = "libraries" | "recentBooks" | "recentUsers" | "storage" | "tasks";
interface OverviewPreferences {
  showStats: boolean;
  visibleSections: Record<OverviewSectionKey, boolean>;
  collapsedSections: Record<OverviewSectionKey, boolean>;
}

interface DashboardStats {
  users: number;
  admins: number;
  libraries: number;
  sources: number;
  books: number;
  authors: number;
  series: number;
  audioFiles: number;
  totalDuration: number;
}

interface DashboardBackup {
  name: string;
  size: number;
  createdAt: string;
}

interface DashboardLibrarySummary {
  id: string;
  name: string;
  _count: {
    books: number;
    sources: number;
  };
}

interface DashboardData {
  stats: DashboardStats;
  library: {
    coversRoot: string;
    libraries: DashboardLibrarySummary[];
  };
  backups: DashboardBackup[];
  recentUsers: Array<{
    id: string;
    username: string;
    role: string;
    createdAt: string;
  }>;
  recentBooks: Array<{
    id: string;
    title: string;
    duration: number;
    createdAt: string;
    author: { name: string };
    library: { name: string };
  }>;
}

interface AdminUser {
  id: string;
  username: string;
  role: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    progress: number;
  };
}

interface AdminLibrarySource {
  id: string;
  label?: string | null;
  path: string;
  kind: string;
  isEnabled: boolean;
  isWritable: boolean;
}

interface AdminLibrary {
  id: string;
  name: string;
  description?: string | null;
  isActive: boolean;
  folderPattern?: string | null;
  sources: AdminLibrarySource[];
  _count: {
    books: number;
  };
}

interface StructureCheckItem {
  id: string;
  title: string;
  author: string;
  folderPath: string;
}

interface StructureCheckResult {
  pattern: string;
  total: number;
  conforming: number;
  nonConforming: StructureCheckItem[];
}

interface AdminLogEntry {
  timestamp: string;
  level: "debug" | "info" | "warn" | "error";
  context: string;
  message: string;
  requestId?: string;
  method?: string;
  path?: string;
  statusCode?: number;
  durationMs?: number;
  tags?: string[];
  ip?: string;
  userId?: string;
  role?: string;
  data?: unknown;
  error?: {
    name: string;
    message: string;
    stack?: string;
  };
}

interface AdminLogsResponse {
  entries: AdminLogEntry[];
  page: number;
  limit: number;
  totalMatching: number;
  totalPages: number;
  stats: Record<"debug" | "info" | "warn" | "error", number>;
  logDirectory: string;
}

interface AdminWriteTagsJob {
  id: string;
  bookId: string;
  bookTitle: string | null;
  status: "pending" | "running" | "completed" | "failed";
  totalFiles: number;
  processedFiles: number;
  currentFile: string | null;
  currentFileStartedAt: string | null;
  lastCompletedFile: string | null;
  lastCompletedAt: string | null;
  startedAt: string;
  updatedAt: string;
  finishedAt: string | null;
  message: string | null;
  stallTimeoutMs: number;
}

interface AdminRuntimeTask {
  id: string;
  type: "scan" | "merge" | "write-tags";
  status: "starting" | "running" | "pending" | "scanning" | "completed" | "failed";
  title: string;
  progress: number;
  detail: string;
  stage?: string;
  startedAt: string;
  updatedAt: string;
  bookId?: string;
}

interface AdminRuntimeTasksResponse {
  active: AdminRuntimeTask[];
}

type OverviewTask = AdminRuntimeTask | ClientRuntimeTask;

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

interface AudibleCliStatus {
  installed: boolean;
  authenticated: boolean;
  configDir: string;
  marketplace: string;
  activeProfile: string | null;
  profiles: string[];
}

interface AdminSettingsModalProps {
  onLibraryChanged: () => Promise<void> | void;
  onRequestUpload: () => void;
}

type PendingAdminConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
};

type AdminLogLevel = "debug" | "info" | "warn" | "error";
type AdminLogScope = "all" | "metadata";

const LOG_LEVEL_OPTIONS: Array<{ value: AdminLogLevel; label: string }> = [
  { value: "error", label: "Errors" },
  { value: "warn", label: "Warnings" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
];

const tabs: Array<{ key: TabKey; label: string; icon: typeof Settings; description: string }> = [
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
    key: "system",
    label: "System",
    icon: Database,
    description: "Backups, storage paths, and maintenance controls.",
  },
  {
    key: "logs",
    label: "Logs",
    icon: FileText,
    description: "Structured application logs, request traces, and error inspection.",
  },
];

const ADMIN_OVERVIEW_PREFERENCES_KEY = "adminOverviewPreferences";

const defaultOverviewPreferences = (): OverviewPreferences => ({
  showStats: true,
  visibleSections: {
    libraries: true,
    recentBooks: true,
    recentUsers: true,
    storage: true,
    tasks: true,
  },
  collapsedSections: {
    libraries: false,
    recentBooks: false,
    recentUsers: false,
    storage: false,
    tasks: false,
  },
});

const overviewSectionLabels: Record<OverviewSectionKey, string> = {
  libraries: "Libraries",
  recentBooks: "Recent books",
  recentUsers: "Recent users",
  storage: "Storage",
  tasks: "Tasks",
};

const loadOverviewPreferences = (): OverviewPreferences => {
  const defaults = defaultOverviewPreferences();

  if (typeof window === "undefined") {
    return defaults;
  }

  try {
    const raw = window.localStorage.getItem(ADMIN_OVERVIEW_PREFERENCES_KEY);
    if (!raw) return defaults;

    const parsed = JSON.parse(raw) as Partial<OverviewPreferences>;

    return {
      showStats: parsed.showStats ?? defaults.showStats,
      visibleSections: {
        ...defaults.visibleSections,
        ...parsed.visibleSections,
      },
      collapsedSections: {
        ...defaults.collapsedSections,
        ...parsed.collapsedSections,
      },
    };
  } catch {
    return defaults;
  }
};

const FOLDER_PATTERNS: Array<{ value: string; label: string }> = [
  { value: "", label: "None — no structure check" },
  { value: "{author} - {title}", label: "{Author} - {Title}  (e.g. Douglas Adams - Hitchhiker's Guide)" },
  { value: "{title}", label: "{Title} only  (e.g. Hitchhiker's Guide)" },
  { value: "{author}/{title}", label: "{Author}/{Title}  (nested 2 levels)" },
  { value: "{author}/{series}/{title}", label: "{Author}/{Series}/{Title}  (nested 3 levels)" },
];

const detectKind = (path: string): string => {
  if (path.startsWith("\\\\") || path.startsWith("//")) return "NETWORK";
  return "LOCAL";
};

const derivedLabel = (path: string): string => {
  const normalized = path.replace(/\\/g, "/").replace(/\/$/, "");
  const parts = normalized.split("/").filter(Boolean);
  return parts[parts.length - 1] ?? path;
};

const formatHours = (seconds: number) => {
  const totalHours = seconds / 3600;
  return `${totalHours.toFixed(totalHours >= 100 ? 0 : 1)}h`;
};

const formatDate = (value: string) =>
  new Date(value).toLocaleString([], {
    month: "short",
    day: "numeric",
    year: "numeric",
    hour: "numeric",
    minute: "2-digit",
  });

const formatElapsed = (value: string | null) => {
  if (!value) return null;
  const diffSeconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (diffSeconds < 60) return `${diffSeconds}s ago`;
  const minutes = Math.floor(diffSeconds / 60);
  const seconds = diffSeconds % 60;
  return `${minutes}m ${seconds}s ago`;
};

const formatBytes = (bytes: number) => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
};

const getErrorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ error?: string }>(error)
    ? error.response?.data?.error || fallback
    : fallback;

const formatJsonBlock = (value: unknown) => JSON.stringify(value, null, 2);

const formatDurationMs = (ms: number) => {
  if (ms < 1000) return `${ms}ms`;
  return `${(ms / 1000).toFixed(2)}s`;
};

const getStatusCodeCategory = (code: number): "2xx" | "3xx" | "4xx" | "5xx" | "other" => {
  if (code >= 200 && code < 300) return "2xx";
  if (code >= 300 && code < 400) return "3xx";
  if (code >= 400 && code < 500) return "4xx";
  if (code >= 500) return "5xx";
  return "other";
};

const buildLogCopyText = (entry: AdminLogEntry) =>
  JSON.stringify(
    {
      timestamp: entry.timestamp,
      level: entry.level,
      context: entry.context,
      message: entry.message,
      requestId: entry.requestId,
      method: entry.method,
      path: entry.path,
      statusCode: entry.statusCode,
      durationMs: entry.durationMs,
      userId: entry.userId,
      ip: entry.ip,
      data: entry.data,
      error: entry.error,
    },
    null,
    2,
  );

const copyTextToClipboard = async (text: string) => {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fall back for browsers that block the async Clipboard API.
    }
  }

  const textarea = document.createElement("textarea");
  textarea.value = text;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.top = "0";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.focus();
  textarea.select();

  try {
    return document.execCommand("copy");
  } finally {
    document.body.removeChild(textarea);
  }
};

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
  const [activeTab, setActiveTab] = useState<TabKey>("overview");
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [users, setUsers] = useState<AdminUser[]>([]);
  const [libraries, setLibraries] = useState<AdminLibrary[]>([]);
  const [logsData, setLogsData] = useState<AdminLogsResponse | null>(null);
  const [runtimeTasks, setRuntimeTasks] = useState<AdminRuntimeTask[]>([]);
  const [loading, setLoading] = useState(true);
  const [logsLoading, setLogsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [newUsername, setNewUsername] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRole, setNewRole] = useState("USER");
  const [newLibraryName, setNewLibraryName] = useState("");
  const [newLibraryDescription, setNewLibraryDescription] = useState("");
  const [sourceDrafts, setSourceDrafts] = useState<
    Record<string, { label: string; path: string; kind: string; isWritable: boolean }>
  >({});
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [visiblePasswordDrafts, setVisiblePasswordDrafts] = useState<Record<string, boolean>>({});
  const [sourceBrowserLibraryId, setSourceBrowserLibraryId] = useState<string | null>(null);
  const [editingLibraryId, setEditingLibraryId] = useState<string | null>(null);
  const [enabledLogLevels, setEnabledLogLevels] = useState<AdminLogLevel[]>([
    "error",
    "warn",
    "info",
    "debug",
  ]);
  const [logScopeFilter, setLogScopeFilter] = useState<AdminLogScope>("all");
  const [logSearch, setLogSearch] = useState("");
  const [logsPage, setLogsPage] = useState(1);
  const [copiedLogKey, setCopiedLogKey] = useState<string | null>(null);
  const [expandedLogKeys, setExpandedLogKeys] = useState<Set<string>>(new Set());
  const [libraryEditDrafts, setLibraryEditDrafts] = useState<
    Record<string, { name: string; description: string; isActive: boolean; folderPattern: string }>
  >({});
  const [structureCheckResults, setStructureCheckResults] = useState<
    Record<string, StructureCheckResult | null>
  >({});
  const [structureCheckLoading, setStructureCheckLoading] = useState<string | null>(null);
  const [overviewPreferences, setOverviewPreferences] = useState<OverviewPreferences>(() =>
    loadOverviewPreferences(),
  );
  const [isEditingOverview, setIsEditingOverview] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState<OverviewPreferences | null>(null);
  const [audibleCliStatus, setAudibleCliStatus] = useState<AudibleCliStatus | null>(null);
  const [audibleCliStatusLoading, setAudibleCliStatusLoading] = useState(false);
  const [audibleAuthStep, setAudibleAuthStep] = useState<"idle" | "url" | "completing" | "done">("idle");
  const [audibleAuthMarketplace, setAudibleAuthMarketplace] = useState("us");
  const [audibleAuthProfileName, setAudibleAuthProfileName] = useState("");
  const [audibleAuthToken, setAudibleAuthToken] = useState("");
  const [audibleAuthUrl, setAudibleAuthUrl] = useState("");
  const [audibleAuthRedirect, setAudibleAuthRedirect] = useState("");
  const [audibleAuthError, setAudibleAuthError] = useState("");
  const [editingAudibleProfile, setEditingAudibleProfile] = useState<string | null>(null);
  const [audibleProfileDrafts, setAudibleProfileDrafts] = useState<Record<string, string>>({});
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirm | null>(null);
  const { tasks: clientTasks } = useTasks();
  const { showToast } = useToast();
  const backTarget =
    typeof location.state === "object" &&
    location.state !== null &&
    "from" in location.state &&
    typeof location.state.from === "string"
      ? location.state.from
      : "/";

  const enabledSourceCount = libraries.reduce(
    (count, library) => count + library.sources.filter((source) => source.isEnabled).length,
    0,
  );
  const writableSourceCount = libraries.reduce(
    (count, library) => count + library.sources.filter((source) => source.isWritable).length,
    0,
  );
  const activeLibraries = libraries.filter((library) => library.isActive).length;
  const overviewTasks: OverviewTask[] = [...runtimeTasks, ...clientTasks].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt),
  );
  const runningTaskCount = overviewTasks.length;
  const activeTabConfig = tabs.find((tab) => tab.key === activeTab) ?? tabs[0];
  const ActiveTabIcon = activeTabConfig.icon;
  const displayedOverviewPreferences = isEditingOverview && overviewDraft
    ? overviewDraft
    : overviewPreferences;
  const navigate = useNavigate();

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
      setRoleDrafts(
        Object.fromEntries(response.data.map((user) => [user.id, user.role])),
      );
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

  const loadAll = async () => {
    setLoading(true);

    await Promise.allSettled([loadDashboard(), loadUsersData(), loadLibrariesData()]);
    setLoading(false);
  };

  const loadLogs = async (page = logsPage) => {
    setLogsLoading(true);

    try {
      const response = await api.get<AdminLogsResponse>("/admin/logs", {
        params: {
          page,
          limit: 50,
          levels: enabledLogLevels.join(","),
          scope: logScopeFilter,
          search: logSearch.trim() || undefined,
        },
      });
      setLogsData(response.data);
      setExpandedLogKeys(new Set(
        response.data.entries
          .filter((e) => e.level === "error" && (e.error || e.data))
          .map((e) => `${e.timestamp}-${e.requestId ?? e.message}`),
      ));
    } catch (actionError) {
      showToast({
        title: "Failed to load logs",
        description: getErrorMessage(actionError, "Failed to load logs"),
        tone: "error",
      });
    } finally {
      setLogsLoading(false);
    }
  };

  const loadAudibleCliStatus = async () => {
    setAudibleCliStatusLoading(true);
    try {
      const res = await api.get<AudibleCliStatus>("/admin/audible-cli/status");
      setAudibleCliStatus(res.data);
    } catch {
      // Non-critical — don't surface to user
    } finally {
      setAudibleCliStatusLoading(false);
    }
  };

  const handleAudibleAuthStart = async () => {
    if (!audibleAuthProfileName.trim()) {
      setAudibleAuthError("Profile name is required");
      return;
    }
    setAudibleAuthError("");
    setAudibleAuthToken("");
    setAudibleAuthUrl("");
    setAudibleAuthRedirect("");
    setAudibleAuthStep("url");
    try {
      const res = await api.post("/admin/audible-cli/auth/start", {
        marketplace: audibleAuthMarketplace,
        profileName: audibleAuthProfileName.trim(),
      });
      setAudibleAuthToken(res.data.authToken);
      setAudibleAuthProfileName(res.data.profileName);
      setAudibleAuthUrl(res.data.url);
    } catch (e) {
      setAudibleAuthError(getErrorMessage(e, "Failed to generate login URL"));
      setAudibleAuthStep("idle");
    }
  };

  const handleAudibleAuthComplete = async () => {
    if (!audibleAuthRedirect.trim() || !audibleAuthToken || !audibleAuthProfileName.trim()) return;
    setAudibleAuthError("");
    setAudibleAuthStep("completing");
    try {
      await api.post("/admin/audible-cli/auth/complete", {
        redirectUrl: audibleAuthRedirect.trim(),
        authToken: audibleAuthToken,
        profileName: audibleAuthProfileName.trim(),
      });
      setAudibleAuthStep("done");
      setAudibleAuthToken("");
      setAudibleAuthUrl("");
      setAudibleAuthRedirect("");
      await loadAudibleCliStatus();
    } catch (e) {
      setAudibleAuthError(getErrorMessage(e, "Failed to complete authentication"));
      setAudibleAuthStep("url");
    }
  };

  const handleSetActiveAudibleProfile = async (profileName: string) => {
    await runAction(`audible-active-${profileName}`, async () => {
      try {
        await api.post("/admin/audible-cli/active-profile", { profileName });
        showToast({
          title: "Active profile updated",
          description: `Active Audible profile set to ${profileName}`,
          tone: "success",
        });
        await loadAudibleCliStatus();
      } catch (actionError) {
        showToast({
          title: "Failed to set active profile",
          description: getErrorMessage(actionError, "Failed to set active Audible profile"),
          tone: "error",
        });
      }
    });
  };

  const handleDeleteAudibleProfile = async (profileName: string) => {
    await runAction(`audible-delete-${profileName}`, async () => {
      try {
        const response = await api.delete<AudibleCliStatus & { ok: boolean }>(
          `/admin/audible-cli/profiles/${encodeURIComponent(profileName)}`,
        );
        setAudibleCliStatus(response.data);
        showToast({
          title: "Audible profile removed",
          description: `Removed Audible profile ${profileName}`,
          tone: "success",
        });
      } catch (actionError) {
        showToast({
          title: "Failed to remove Audible profile",
          description: getErrorMessage(actionError, "Failed to remove Audible profile"),
          tone: "error",
        });
      }
    });
  };

  const handleRenameAudibleProfile = async (profileName: string) => {
    const nextName = audibleProfileDrafts[profileName]?.trim();
    if (!nextName || nextName === profileName) {
      setEditingAudibleProfile(null);
      return;
    }

    await runAction(`audible-rename-${profileName}`, async () => {
      try {
        const response = await api.patch<AudibleCliStatus & { ok: boolean }>(
          `/admin/audible-cli/profiles/${encodeURIComponent(profileName)}`,
          { profileName: nextName },
        );
        setAudibleCliStatus(response.data);
        setEditingAudibleProfile(null);
        setAudibleProfileDrafts((current) => {
          const next = { ...current };
          delete next[profileName];
          next[nextName] = nextName;
          return next;
        });
        showToast({
          title: "Audible profile renamed",
          description: `Renamed Audible profile to ${nextName}`,
          tone: "success",
        });
      } catch (actionError) {
        showToast({
          title: "Failed to rename Audible profile",
          description: getErrorMessage(actionError, "Failed to rename Audible profile"),
          tone: "error",
        });
      }
    });
  };

  const loadRuntimeTasks = async () => {
    try {
      const response = await api.get<AdminRuntimeTasksResponse>("/admin/tasks");
      setRuntimeTasks(response.data.active);
    } catch (actionError) {
      console.error("Failed to load runtime tasks", actionError);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void (async () => {
        setLoading(true);
        await Promise.all([loadRuntimeTasks(), loadDashboard()]);
        setLoading(false);
        void loadUsersData();
        void loadLibrariesData();
      })();
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, []);

  useEffect(() => {
    if (activeTab === "system" && !audibleCliStatus) {
      void loadAudibleCliStatus();
    }
  }, [activeTab]);

  useEffect(() => {
    if (activeTab === "users" && users.length === 0) {
      void loadUsersData();
    }

    if (activeTab === "library" && libraries.length === 0) {
      void loadLibrariesData();
    }
  }, [activeTab, users.length, libraries.length]);

  useEffect(() => {
    if (activeTab !== "logs") return;
    void loadLogs(logsPage);
  }, [activeTab, logsPage, enabledLogLevels, logScopeFilter, logSearch]);

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

  useEffect(() => {
    window.localStorage.setItem(
      ADMIN_OVERVIEW_PREFERENCES_KEY,
      JSON.stringify(overviewPreferences),
    );
  }, [overviewPreferences]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionLoading(key);

    try {
      await action();
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateUser = async () => {
    await runAction("create-user", async () => {
      try {
        await api.post("/admin/users", {
          username: newUsername.trim(),
          password: newPassword,
          role: newRole,
        });
        showToast({
          title: "User created",
          description: `Created ${newUsername.trim()}`,
          tone: "success",
        });
        setNewUsername("");
        setNewPassword("");
        setNewRole("USER");
        await loadAll();
      } catch (actionError) {
        showToast({
          title: "Failed to create user",
          description: getErrorMessage(actionError, "Failed to create user"),
          tone: "error",
        });
      }
    });
  };

  const handleUpdateUser = async (userId: string) => {
    await runAction(`update-user-${userId}`, async () => {
      try {
        const payload: { role?: string; password?: string } = {};
        if (roleDrafts[userId]) payload.role = roleDrafts[userId];
        if (passwordDrafts[userId]?.trim()) payload.password = passwordDrafts[userId];

        await api.patch(`/admin/users/${userId}`, payload);
        setPasswordDrafts((current) => ({ ...current, [userId]: "" }));
        showToast({
          title: "User updated",
          tone: "success",
        });
        await loadAll();
      } catch (actionError) {
        showToast({
          title: "Failed to update user",
          description: getErrorMessage(actionError, "Failed to update user"),
          tone: "error",
        });
      }
    });
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    await runAction(`delete-user-${userId}`, async () => {
      try {
        await api.delete(`/admin/users/${userId}`);
        showToast({
          title: "User deleted",
          description: `Deleted ${username}`,
          tone: "success",
        });
        await loadAll();
      } catch (actionError) {
        showToast({
          title: "Failed to delete user",
          description: getErrorMessage(actionError, "Failed to delete user"),
          tone: "error",
        });
      }
    });
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
        await loadAll();
        await onLibraryChanged();
      } catch (actionError) {
        showToast({
          title: "Failed to create library",
          description: getErrorMessage(actionError, "Failed to create library"),
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
        await loadAll();
        await onLibraryChanged();
      } catch (actionError) {
        showToast({
          title: "Failed to update library",
          description: getErrorMessage(actionError, "Failed to update library"),
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
        await loadAll();
        await onLibraryChanged();
      } catch (actionError) {
        showToast({
          title: "Failed to delete library",
          description: getErrorMessage(actionError, "Failed to delete library"),
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
        await loadAll();
        await onLibraryChanged();
      } catch (actionError) {
        showToast({
          title: "Failed to purge library",
          description: getErrorMessage(actionError, "Failed to purge library"),
          tone: "error",
        });
      }
    });
  };

  const handleCheckStructure = async (library: AdminLibrary) => {
    setStructureCheckLoading(library.id);
    try {
      const response = await api.get<StructureCheckResult>(
        `/admin/libraries/${library.id}/structure-check`,
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
          },
        }));
        await loadAll();
        await onLibraryChanged();
      } catch (actionError) {
        showToast({
          title: "Failed to add source path",
          description: getErrorMessage(actionError, "Failed to add source path"),
          tone: "error",
        });
      }
    });
  };

  const handleToggleSource = async (
    sourceId: string,
    field: "isEnabled" | "isWritable",
    value: boolean,
  ) => {
    await runAction(`update-source-${sourceId}-${field}`, async () => {
      try {
        await api.patch(`/admin/sources/${sourceId}`, { [field]: value });
        showToast({
          title: "Source updated",
          tone: "success",
        });
        await loadAll();
        await onLibraryChanged();
      } catch (actionError) {
        showToast({
          title: "Failed to update source path",
          description: getErrorMessage(actionError, "Failed to update source path"),
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
        await loadAll();
        await onLibraryChanged();
      } catch (actionError) {
        showToast({
          title: "Failed to remove source path",
          description: getErrorMessage(actionError, "Failed to remove source path"),
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
        await loadAll();
        await onLibraryChanged();
      } catch (actionError) {
        showToast({
          title: "Failed to scan library",
          description: getErrorMessage(actionError, "Failed to scan library"),
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
        await loadAll();
        await onLibraryChanged();
      } catch (actionError) {
        showToast({
          title: "Failed to scan library",
          description: getErrorMessage(actionError, "Failed to scan library"),
          tone: "error",
        });
      }
    });
  };

  const handleCreateBackup = async () => {
    await runAction("create-backup", async () => {
      try {
        const res = await api.post("/admin/backups");
        showToast({
          title: "Backup created",
          description: res.data.message || "Backup created",
          tone: "success",
        });
        await loadAll();
      } catch (actionError) {
        showToast({
          title: "Failed to create backup",
          description: getErrorMessage(actionError, "Failed to create backup"),
          tone: "error",
        });
      }
    });
  };

  const handleClearLogs = async () => {
    await runAction("clear-logs", async () => {
      try {
        await api.delete("/admin/logs");
        showToast({
          title: "Logs cleared",
          tone: "success",
        });
        setLogsPage(1);
        await loadLogs(1);
      } catch (actionError) {
        showToast({
          title: "Failed to clear logs",
          description: getErrorMessage(actionError, "Failed to clear logs"),
          tone: "error",
        });
      }
    });
  };

  const toggleLogLevel = (level: AdminLogLevel) => {
    setEnabledLogLevels((current) => {
      if (current.includes(level)) {
        if (current.length === 1) {
          return current;
        }

        return current.filter((entry) => entry !== level);
      }

      return [...current, level];
    });
    setLogsPage(1);
  };

  const toggleLogExpanded = (key: string) => {
    setExpandedLogKeys((current) => {
      const next = new Set(current);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.add(key);
      }
      return next;
    });
  };

  const copyLogEntry = async (entry: AdminLogEntry, key: string) => {
    const copied = await copyTextToClipboard(buildLogCopyText(entry));

    if (copied) {
      setCopiedLogKey(key);
      showToast({
        title: "Log entry copied",
        description: "The selected log entry was copied to the clipboard.",
        tone: "success",
      });
      window.setTimeout(() => {
        setCopiedLogKey((current) => (current === key ? null : current));
      }, 2400);
      return;
    }

    showToast({
      title: "Copy blocked by browser",
      description: "Select the log text and copy it manually.",
      tone: "error",
      durationMs: 5000,
    });
  };

  const openUploadFlow = () => {
    onRequestUpload();
  };

  const getRuntimeTaskTypeLabel = (task: OverviewTask) => {
    if (task.type === "scan") return "Library scan";
    if (task.type === "merge") return "Merge";
    if (task.type === "download") return "Offline download";
    return "Write tags";
  };

  const toggleOverviewSection = (section: OverviewSectionKey) => {
    if (isEditingOverview) {
      setOverviewDraft((current) => {
        if (!current) return current;
        return {
          ...current,
          collapsedSections: {
            ...current.collapsedSections,
            [section]: !current.collapsedSections[section],
          },
        };
      });
      return;
    }

    setOverviewPreferences((current) => ({
      ...current,
      collapsedSections: {
        ...current.collapsedSections,
        [section]: !current.collapsedSections[section],
      },
    }));
  };

  const toggleOverviewVisibility = (section: OverviewSectionKey) => {
    setOverviewDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        visibleSections: {
          ...current.visibleSections,
          [section]: !current.visibleSections[section],
        },
      };
    });
  };

  const toggleOverviewStatsVisibility = () => {
    setOverviewDraft((current) => {
      if (!current) return current;
      return {
        ...current,
        showStats: !current.showStats,
      };
    });
  };

  const resetOverviewPreferences = () => {
    setOverviewDraft(defaultOverviewPreferences());
  };

  const handleStartOverviewEdit = () => {
    setOverviewDraft({
      showStats: overviewPreferences.showStats,
      visibleSections: { ...overviewPreferences.visibleSections },
      collapsedSections: { ...overviewPreferences.collapsedSections },
    });
    setIsEditingOverview(true);
  };

  const handleCancelOverviewEdit = () => {
    setOverviewDraft(null);
    setIsEditingOverview(false);
  };

  const handleSaveOverviewPreferences = () => {
    if (!overviewDraft) {
      setIsEditingOverview(false);
      return;
    }

    setOverviewPreferences(overviewDraft);
    setIsEditingOverview(false);
    setOverviewDraft(null);
  };

  const handleSelectSourcePath = (libraryId: string, selectedPath: string) => {
    const existingDraft = sourceDrafts[libraryId] ?? {
      label: "",
      path: "",
      kind: "LOCAL",
      isWritable: false,
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
    <div className="admin-settings-page">
      <div className="card admin-settings-page-shell animate-fade-in">
        <div className="admin-settings-header">
          <div className="admin-settings-header-copy">
            <div className="admin-settings-kicker">Admin Control Center</div>
            <h2>Settings</h2>
            <div className="admin-header-pills">
              <div className="admin-header-pill">
                <Shield size={14} />
                {users.filter((user) => user.role === "ADMIN").length || dashboard?.stats.admins || 0} admins
              </div>
              <div className="admin-header-pill">
                <FolderTree size={14} />
                {activeLibraries || dashboard?.stats.libraries || 0} libraries
              </div>
              <div className="admin-header-pill">
                <Network size={14} />
                {enabledSourceCount} live sources
              </div>
              <div className="admin-header-pill">
                <Sparkles size={14} />
                {runningTaskCount} active tasks
              </div>
            </div>
          </div>

          <div className="admin-header-actions">
            <button
              className="btn btn-secondary"
              type="button"
              onClick={() => navigate("/duplicates", { state: { from: backTarget } })}
            >
              <Copy size={15} />
              Duplicates
            </button>
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
            <Link to={backTarget} className="btn btn-secondary">
              <ArrowLeft size={16} />
              Back to library
            </Link>
          </div>
        </div>

        <div className="admin-settings-layout">
          <aside className="admin-settings-sidebar">
            <div className="admin-sidebar-nav-label">Navigation</div>

            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`admin-nav-btn ${activeTab === key ? "admin-nav-btn-active" : ""}`}
                onClick={() => setActiveTab(key)}
                type="button"
              >
                <Icon size={16} />
                <span>{label}</span>
              </button>
            ))}

            <div className="admin-sidebar-card admin-sidebar-metrics">
              <div>
                <span>Writable paths</span>
                <strong>{writableSourceCount}</strong>
              </div>
              <div>
                <span>Books indexed</span>
                <strong>{dashboard?.stats.books ?? 0}</strong>
              </div>
            </div>
          </aside>

          <section className="admin-settings-content">
            {loading ? (
              <div className="admin-settings-loading">
                <div className="app-loading-spinner" />
              </div>
            ) : (
              <>
                <div className="admin-content-topbar">
                  <h3 className="admin-content-title">
                    <ActiveTabIcon size={17} />
                    {activeTabConfig.label}
                  </h3>
                  <p className="admin-content-desc">{activeTabConfig.description}</p>
                </div>

                {activeTab === "overview" && dashboard && (
                  <div className="admin-panel-stack">
                    <div className="admin-overview-toolbar">
                      {!isEditingOverview ? (
                        <button className="btn btn-secondary" type="button" onClick={handleStartOverviewEdit}>
                          <Pencil size={15} />
                          Edit Overview
                        </button>
                      ) : (
                        <div className="admin-overview-toolbar-actions">
                          <button className="btn btn-secondary" type="button" onClick={resetOverviewPreferences}>
                            Reset layout
                          </button>
                          <button className="btn btn-secondary" type="button" onClick={handleCancelOverviewEdit}>
                            Cancel
                          </button>
                          <button className="btn btn-primary" type="button" onClick={handleSaveOverviewPreferences}>
                            <Save size={15} />
                            Save Layout
                          </button>
                        </div>
                      )}
                    </div>

                    {isEditingOverview && (
                      <div className="card admin-section-card admin-overview-customize-card">
                        <div className="admin-section-head admin-overview-customize-head">
                          <div>
                            <h3>Customize overview</h3>
                            <p className="admin-library-meta-text">
                              Choose which overview blocks stay visible in this browser.
                            </p>
                          </div>
                        </div>

                        <div className="admin-overview-customize-grid">
                          <button
                            type="button"
                            className={`admin-overview-toggle ${displayedOverviewPreferences.showStats ? "is-enabled" : ""}`}
                            onClick={toggleOverviewStatsVisibility}
                            aria-pressed={displayedOverviewPreferences.showStats}
                          >
                            <div className="admin-overview-toggle-copy">
                              <strong>Stats cards</strong>
                              <small>Show the top-level user, library, book, and runtime counters.</small>
                            </div>
                            {displayedOverviewPreferences.showStats ? <Eye size={16} /> : <EyeOff size={16} />}
                          </button>

                          {(Object.keys(overviewSectionLabels) as OverviewSectionKey[]).map((section) => (
                            <button
                              key={section}
                              type="button"
                              className={`admin-overview-toggle ${
                                displayedOverviewPreferences.visibleSections[section] ? "is-enabled" : ""
                              }`}
                              onClick={() => toggleOverviewVisibility(section)}
                              aria-pressed={displayedOverviewPreferences.visibleSections[section]}
                            >
                              <div className="admin-overview-toggle-copy">
                                <strong>{overviewSectionLabels[section]}</strong>
                                <small>
                                  {displayedOverviewPreferences.visibleSections[section] ? "Visible" : "Hidden"}
                                  {displayedOverviewPreferences.collapsedSections[section] ? " and collapsed" : ""}
                                </small>
                              </div>
                              {displayedOverviewPreferences.visibleSections[section] ? <Eye size={16} /> : <EyeOff size={16} />}
                            </button>
                          ))}
                        </div>
                      </div>
                    )}

                    {displayedOverviewPreferences.showStats && <div className="admin-stat-grid">
                      <div className="admin-stat-card">
                        <div className="admin-stat-icon"><Users size={15} /></div>
                        <strong>{dashboard.stats.users}</strong>
                        <span>Users</span>
                        <small>{dashboard.stats.admins} admins</small>
                      </div>
                      <div className="admin-stat-card">
                        <div className="admin-stat-icon"><FolderTree size={15} /></div>
                        <strong>{dashboard.stats.libraries}</strong>
                        <span>Libraries</span>
                        <small>{dashboard.stats.sources} source paths</small>
                      </div>
                      <div className="admin-stat-card">
                        <div className="admin-stat-icon"><BookOpen size={15} /></div>
                        <strong>{dashboard.stats.books}</strong>
                        <span>Books</span>
                        <small>{dashboard.stats.authors} authors</small>
                      </div>
                      <div className="admin-stat-card">
                        <div className="admin-stat-icon"><HardDrive size={15} /></div>
                        <strong>{formatHours(dashboard.stats.totalDuration)}</strong>
                        <span>Total runtime</span>
                        <small>{dashboard.stats.audioFiles} audio files</small>
                      </div>
                    </div>}

                    {!displayedOverviewPreferences.showStats &&
                      !(Object.values(displayedOverviewPreferences.visibleSections) as boolean[]).some(Boolean) && (
                        <div className="admin-empty-state">
                          Overview is fully hidden. Use Customize overview to turn sections back on.
                        </div>
                      )}

                    <div className="admin-split-grid">
                      {displayedOverviewPreferences.visibleSections.libraries && <div className="card admin-section-card">
                        <div className="admin-section-head">
                          <button
                            className="admin-collapsible-head"
                            type="button"
                            onClick={() => toggleOverviewSection("libraries")}
                            aria-expanded={!displayedOverviewPreferences.collapsedSections.libraries}
                          >
                            <div className="admin-collapsible-title">
                              {displayedOverviewPreferences.collapsedSections.libraries ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                              <h3>Libraries</h3>
                              <span className="admin-collapsible-count">{dashboard.library.libraries.length}</span>
                            </div>
                            <FolderTree size={15} />
                          </button>
                        </div>
                        {!displayedOverviewPreferences.collapsedSections.libraries && <div className="admin-collapsible-body admin-list">
                          {dashboard.library.libraries.map((library) => (
                            <div key={library.id} className="admin-row">
                              <div>
                                <strong>{library.name}</strong>
                                <small>{library._count.books} books · {library._count.sources} sources</small>
                              </div>
                              <div className="admin-pill">{library._count.books}</div>
                            </div>
                          ))}
                          {dashboard.library.libraries.length === 0 && (
                            <div className="admin-empty-state">No libraries configured.</div>
                          )}
                        </div>}
                      </div>}

                      {displayedOverviewPreferences.visibleSections.recentBooks && <div className="card admin-section-card">
                        <div className="admin-section-head">
                          <button
                            className="admin-collapsible-head"
                            type="button"
                            onClick={() => toggleOverviewSection("recentBooks")}
                            aria-expanded={!displayedOverviewPreferences.collapsedSections.recentBooks}
                          >
                            <div className="admin-collapsible-title">
                              {displayedOverviewPreferences.collapsedSections.recentBooks ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                              <h3>Recent books</h3>
                              <span className="admin-collapsible-count">{dashboard.recentBooks.length}</span>
                            </div>
                            <BookOpen size={15} />
                          </button>
                        </div>
                        {!displayedOverviewPreferences.collapsedSections.recentBooks && <div className="admin-collapsible-body admin-list">
                          {dashboard.recentBooks.map((book) => (
                            <div key={book.id} className="admin-row">
                              <div>
                                <strong>{book.title}</strong>
                                <small>{book.author.name} · {book.library.name}</small>
                              </div>
                              <span className="admin-row-meta">{formatHours(book.duration)}</span>
                            </div>
                          ))}
                          {dashboard.recentBooks.length === 0 && (
                            <div className="admin-empty-state">No books scanned yet.</div>
                          )}
                        </div>}
                      </div>}
                    </div>

                    <div className="admin-split-grid">
                      {displayedOverviewPreferences.visibleSections.tasks && <div className="card admin-section-card">
                        <div className="admin-section-head">
                          <button
                            className="admin-collapsible-head"
                            type="button"
                            onClick={() => toggleOverviewSection("tasks")}
                            aria-expanded={!displayedOverviewPreferences.collapsedSections.tasks}
                          >
                            <div className="admin-collapsible-title">
                              {displayedOverviewPreferences.collapsedSections.tasks ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                              <h3>Tasks</h3>
                              <span className="admin-collapsible-count">{overviewTasks.length}</span>
                            </div>
                            <Sparkles size={15} />
                          </button>
                        </div>
                        {!displayedOverviewPreferences.collapsedSections.tasks && <div className="admin-collapsible-body admin-task-list">
                          {overviewTasks.map((task) => (
                            <div key={task.id} className="admin-task-card">
                              <div className="admin-task-head">
                                <div>
                                  <strong>{task.title}</strong>
                                  <small>{getRuntimeTaskTypeLabel(task)} • {task.progress}%</small>
                                </div>
                                <div className="admin-pill">{task.status}</div>
                              </div>
                              <div className="progress-bar-container">
                                <div className="progress-bar-fill" style={{ width: `${task.progress}%` }} />
                              </div>
                              <div className="admin-task-meta">
                                <span>{"stage" in task && task.stage ? task.stage : task.detail}</span>
                                <span>{formatElapsed(task.updatedAt) || "just now"}</span>
                              </div>
                              {task.detail && "stage" in task && task.stage && task.detail !== task.stage && (
                                <div className="admin-task-submeta">{task.detail}</div>
                              )}
                            </div>
                          ))}
                          {overviewTasks.length === 0 && (
                            <div className="admin-empty-state">No tracked background tasks are currently running.</div>
                          )}
                        </div>}
                      </div>}

                      {displayedOverviewPreferences.visibleSections.recentUsers && <div className="card admin-section-card">
                        <div className="admin-section-head">
                          <button
                            className="admin-collapsible-head"
                            type="button"
                            onClick={() => toggleOverviewSection("recentUsers")}
                            aria-expanded={!displayedOverviewPreferences.collapsedSections.recentUsers}
                          >
                            <div className="admin-collapsible-title">
                              {displayedOverviewPreferences.collapsedSections.recentUsers ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                              <h3>Recent users</h3>
                              <span className="admin-collapsible-count">{dashboard.recentUsers.length}</span>
                            </div>
                            <Users size={15} />
                          </button>
                        </div>
                        {!displayedOverviewPreferences.collapsedSections.recentUsers && <div className="admin-collapsible-body admin-list">
                          {dashboard.recentUsers.map((user) => (
                            <div key={user.id} className="admin-row">
                              <div className="admin-row-with-avatar">
                                <div className="admin-user-avatar admin-user-avatar-sm">
                                  {user.username.slice(0, 2).toUpperCase()}
                                </div>
                                <div>
                                  <strong>{user.username}</strong>
                                  <small>
                                    <span className={`admin-role-badge admin-role-${user.role.toLowerCase()}`}>{user.role}</span>
                                    {" · "}joined {formatDate(user.createdAt)}
                                  </small>
                                </div>
                              </div>
                            </div>
                          ))}
                          {dashboard.recentUsers.length === 0 && (
                            <div className="admin-empty-state">No users yet.</div>
                          )}
                        </div>}
                      </div>}

                      {displayedOverviewPreferences.visibleSections.storage && <div className="card admin-section-card">
                        <div className="admin-section-head">
                          <button
                            className="admin-collapsible-head"
                            type="button"
                            onClick={() => toggleOverviewSection("storage")}
                            aria-expanded={!displayedOverviewPreferences.collapsedSections.storage}
                          >
                            <div className="admin-collapsible-title">
                              {displayedOverviewPreferences.collapsedSections.storage ? <ChevronRight size={16} /> : <ChevronDown size={16} />}
                              <h3>Storage</h3>
                              <span className="admin-collapsible-count">4</span>
                            </div>
                            <HardDrive size={15} />
                          </button>
                        </div>
                        {!displayedOverviewPreferences.collapsedSections.storage && <div className="admin-collapsible-body admin-meta-list">
                          <div>
                            <span>Cover storage</span>
                            <code>{dashboard.library.coversRoot}</code>
                          </div>
                          <div>
                            <span>Enabled source paths</span>
                            <code>{enabledSourceCount}</code>
                          </div>
                          <div>
                            <span>Writable source paths</span>
                            <code>{writableSourceCount}</code>
                          </div>
                          <div>
                            <span>Recent backups</span>
                            <code>{dashboard.backups.length}</code>
                          </div>
                        </div>}
                      </div>}
                    </div>
                  </div>
                )}

                {activeTab === "users" && (
                  <div className="admin-panel-stack">
                    <div className="card admin-section-card">
                      <div className="admin-section-head">
                        <h3>Create user</h3>
                        <UserPlus size={15} />
                      </div>
                      <div className="admin-create-user-grid">
                        <input
                          className="form-control"
                          placeholder="Username"
                          value={newUsername}
                          onChange={(e) => setNewUsername(e.target.value)}
                        />
                        <div className="password-field">
                          <input
                            className="form-control password-input"
                            placeholder="Temporary password"
                            type={showNewPassword ? "text" : "password"}
                            value={newPassword}
                            onChange={(e) => setNewPassword(e.target.value)}
                          />
                          <button
                            type="button"
                            className="password-toggle"
                            onClick={() => setShowNewPassword((current) => !current)}
                            aria-label={showNewPassword ? "Hide password" : "Show password"}
                          >
                            {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
                          </button>
                        </div>
                        <select
                          className="form-control"
                          value={newRole}
                          onChange={(e) => setNewRole(e.target.value)}
                        >
                          <option value="USER">User</option>
                          <option value="ADMIN">Admin</option>
                        </select>
                        <button
                          className="btn btn-primary"
                          type="button"
                          disabled={!newUsername.trim() || !newPassword || actionLoading === "create-user"}
                          onClick={() => void handleCreateUser()}
                        >
                          {actionLoading === "create-user" ? (
                            <Loader2 size={15} className="animate-spin" />
                          ) : (
                            <UserPlus size={15} />
                          )}
                          Create
                        </button>
                      </div>
                    </div>

                    <div className="card admin-section-card">
                      <div className="admin-section-head">
                        <h3>All accounts</h3>
                        <Shield size={15} />
                      </div>
                      <div className="admin-table">
                        {users.map((user) => (
                          <div key={user.id} className="admin-table-row">
                            <div className="admin-row-with-avatar">
                              <div className="admin-user-avatar">
                                {user.username.slice(0, 2).toUpperCase()}
                              </div>
                              <div className="admin-user-summary">
                                <strong>{user.username}</strong>
                                <small>
                                  <span className={`admin-role-badge admin-role-${user.role.toLowerCase()}`}>
                                    {user.role}
                                  </span>
                                  {" · "}{user._count.progress} listens · joined {formatDate(user.createdAt)}
                                </small>
                              </div>
                            </div>

                            <div className="admin-user-controls">
                              <select
                                className="form-control"
                                value={roleDrafts[user.id] ?? user.role}
                                onChange={(e) =>
                                  setRoleDrafts((current) => ({
                                    ...current,
                                    [user.id]: e.target.value,
                                  }))
                                }
                              >
                                <option value="USER">User</option>
                                <option value="ADMIN">Admin</option>
                              </select>
                              <div className="password-field">
                                <input
                                  className="form-control password-input"
                                  type={visiblePasswordDrafts[user.id] ? "text" : "password"}
                                  placeholder="New password"
                                  value={passwordDrafts[user.id] ?? ""}
                                  onChange={(e) =>
                                    setPasswordDrafts((current) => ({
                                      ...current,
                                      [user.id]: e.target.value,
                                    }))
                                  }
                                />
                                <button
                                  type="button"
                                  className="password-toggle"
                                  onClick={() =>
                                    setVisiblePasswordDrafts((current) => ({
                                      ...current,
                                      [user.id]: !current[user.id],
                                    }))
                                  }
                                  aria-label={
                                    visiblePasswordDrafts[user.id] ? "Hide password" : "Show password"
                                  }
                                >
                                  {visiblePasswordDrafts[user.id] ? (
                                    <EyeOff size={16} />
                                  ) : (
                                    <Eye size={16} />
                                  )}
                                </button>
                              </div>
                              <button
                                className="btn btn-secondary"
                                type="button"
                                disabled={actionLoading === `update-user-${user.id}`}
                                onClick={() => void handleUpdateUser(user.id)}
                              >
                                {actionLoading === `update-user-${user.id}` ? (
                                  <Loader2 size={14} className="animate-spin" />
                                ) : null}
                                Save
                              </button>
                              <button
                                className="btn admin-danger-btn"
                                type="button"
                                disabled={actionLoading === `delete-user-${user.id}`}
                                onClick={() =>
                                  setPendingConfirm({
                                    title: "Delete User",
                                    message: `Delete user "${user.username}"? This also removes saved progress.`,
                                    confirmLabel: "Delete User",
                                    tone: "danger",
                                    onConfirm: () => void handleDeleteUser(user.id, user.username),
                                  })
                                }
                              >
                                <Trash2 size={14} />
                              </button>
                            </div>
                          </div>
                        ))}
                        {users.length === 0 && (
                          <div className="admin-empty-state">No accounts found.</div>
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "library" && (
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
                        <button className="btn btn-primary" type="button" onClick={openUploadFlow}>
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

                  </div>
                )}

                {activeTab === "system" && dashboard && (
                  <div className="admin-panel-stack">
                    <div className="card admin-section-card">
                      <div className="admin-section-head">
                        <h3>Audible CLI Integration</h3>
                        <div className="admin-section-head-actions">
                          <button
                            className="btn btn-secondary"
                            type="button"
                            disabled={audibleCliStatusLoading}
                            onClick={() => void loadAudibleCliStatus()}
                          >
                            {audibleCliStatusLoading ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <RefreshCw size={14} />
                            )}
                            Check status
                          </button>
                        </div>
                      </div>

                      {audibleCliStatus ? (
                        <>
                          <div className="admin-meta-list">
                            <div>
                              <span>CLI installed</span>
                              <span className={`audible-cli-status-dot ${audibleCliStatus.installed ? "ok" : "off"}`}>
                                {audibleCliStatus.installed ? "Yes — audible found in PATH" : "Not found — ensure you have redeployed with the latest Docker image"}
                              </span>

                            </div>
                            <div>
                              <span>Authenticated</span>
                              <span className={`audible-cli-status-dot ${audibleCliStatus.authenticated ? "ok" : audibleCliStatus.installed ? "warn" : "off"}`}>
                                {audibleCliStatus.authenticated
                                  ? "Yes — profile detected"
                                  : audibleCliStatus.installed
                                  ? "No profile found — run: audible quickstart"
                                  : "N/A"}
                              </span>
                            </div>
                            <div>
                              <span>Config directory</span>
                              <code>{audibleCliStatus.configDir}</code>
                            </div>
                            <div>
                              <span>Marketplace</span>
                              <code>{audibleCliStatus.marketplace}</code>
                            </div>
                            <div>
                              <span>Active profile</span>
                              <code>{audibleCliStatus.activeProfile ?? "Automatic fallback"}</code>
                            </div>
                          </div>

                          {!audibleCliStatus.installed && (
                            <div className="audible-cli-setup-hint">
                              <strong>Installation pending</strong>
                              <p>audible-cli is now automatically installed in the server container. If it shows as "Not found", please pull the latest image and redeploy your stack.</p>
                            </div>
                          )}

                          {audibleCliStatus.installed && audibleCliStatus.profiles.length > 0 && (
                            <div className="card admin-section-card" style={{ marginTop: "1rem" }}>
                              <div className="admin-section-head">
                                <h3>Connected accounts</h3>
                                <Users size={15} />
                              </div>
                              <div className="admin-table">
                                {audibleCliStatus.profiles.map((profileName) => (
                                  <div key={profileName} className="admin-table-row">
                                    <div className="admin-book-summary">
                                      {editingAudibleProfile === profileName ? (
                                        <input
                                          className="form-control"
                                          value={audibleProfileDrafts[profileName] ?? profileName}
                                          onChange={(e) =>
                                            setAudibleProfileDrafts((current) => ({
                                              ...current,
                                              [profileName]: e.target.value,
                                            }))
                                          }
                                        />
                                      ) : (
                                        <strong>{profileName}</strong>
                                      )}
                                      <small>
                                        {audibleCliStatus.activeProfile === profileName
                                          ? "Used for audible-cli metadata searches"
                                          : "Available account"}
                                      </small>
                                    </div>
                                    <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                                      {editingAudibleProfile === profileName ? (
                                        <>
                                          <button
                                            className="btn btn-secondary"
                                            type="button"
                                            disabled={actionLoading === `audible-rename-${profileName}`}
                                            onClick={() => void handleRenameAudibleProfile(profileName)}
                                          >
                                            {actionLoading === `audible-rename-${profileName}` ? (
                                              <Loader2 size={14} className="animate-spin" />
                                            ) : (
                                              <Save size={14} />
                                            )}
                                            Save
                                          </button>
                                          <button
                                            className="btn btn-secondary"
                                            type="button"
                                            onClick={() => {
                                              setEditingAudibleProfile(null);
                                              setAudibleProfileDrafts((current) => ({
                                                ...current,
                                                [profileName]: profileName,
                                              }));
                                            }}
                                          >
                                            <X size={14} />
                                            Cancel
                                          </button>
                                        </>
                                      ) : (
                                        <button
                                          className="btn btn-secondary"
                                          type="button"
                                          onClick={() => {
                                            setEditingAudibleProfile(profileName);
                                            setAudibleProfileDrafts((current) => ({
                                              ...current,
                                              [profileName]: current[profileName] ?? profileName,
                                            }));
                                          }}
                                        >
                                          <Pencil size={14} />
                                          Rename
                                        </button>
                                      )}
                                      {audibleCliStatus.activeProfile === profileName ? (
                                        <div className="admin-pill">Active</div>
                                      ) : (
                                        <button
                                          className="btn btn-secondary"
                                          type="button"
                                          disabled={actionLoading === `audible-active-${profileName}`}
                                          onClick={() => void handleSetActiveAudibleProfile(profileName)}
                                        >
                                          {actionLoading === `audible-active-${profileName}` ? (
                                            <Loader2 size={14} className="animate-spin" />
                                          ) : (
                                            <Check size={14} />
                                          )}
                                          Make active
                                        </button>
                                      )}
                                      <button
                                        className="btn admin-danger-btn"
                                        type="button"
                                        disabled={actionLoading === `audible-delete-${profileName}`}
                                        onClick={() =>
                                          setPendingConfirm({
                                            title: "Remove Audible Profile",
                                            message: `Remove Audible profile "${profileName}"?`,
                                            confirmLabel: "Remove Profile",
                                            tone: "danger",
                                            onConfirm: () => void handleDeleteAudibleProfile(profileName),
                                          })
                                        }
                                      >
                                        {actionLoading === `audible-delete-${profileName}` ? (
                                          <Loader2 size={14} className="animate-spin" />
                                        ) : (
                                          <Trash2 size={14} />
                                        )}
                                        Remove
                                      </button>
                                    </div>
                                  </div>
                                ))}
                              </div>
                            </div>
                          )}

                          {audibleCliStatus.installed && (
                            <div className="audible-cli-setup-hint">
                              <strong>{audibleCliStatus.authenticated ? "Add another Audible account" : "Connect your Audible account"}</strong>
                              {audibleAuthError && (
                                <div className="auth-error" style={{ marginBottom: "0.5rem" }}>{audibleAuthError}</div>
                              )}

                              {audibleAuthStep === "idle" && (
                                <>
                                  <p>Choose a marketplace, assign a profile name, and generate a login URL. A free Audible account is sufficient.</p>
                                  <div className="audible-cli-auth-row">
                                    <div className="select-wrap" style={{ minWidth: "160px" }}>
                                      <select
                                        className="form-control"
                                        value={audibleAuthMarketplace}
                                        onChange={(e) => setAudibleAuthMarketplace(e.target.value)}
                                      >
                                        <option value="us">US (audible.com)</option>
                                        <option value="uk">UK (audible.co.uk)</option>
                                        <option value="de">Germany (audible.de)</option>
                                        <option value="fr">France (audible.fr)</option>
                                        <option value="ca">Canada (audible.ca)</option>
                                        <option value="it">Italy (audible.it)</option>
                                        <option value="au">Australia (audible.com.au)</option>
                                        <option value="in">India (audible.in)</option>
                                        <option value="jp">Japan (audible.co.jp)</option>
                                        <option value="es">Spain (audible.es)</option>
                                      </select>
                                    </div>
                                    <input
                                      className="form-control"
                                      style={{ minWidth: "180px" }}
                                      placeholder="Profile name"
                                      value={audibleAuthProfileName}
                                      onChange={(e) => setAudibleAuthProfileName(e.target.value)}
                                    />
                                    <button
                                      className="btn btn-primary"
                                      type="button"
                                      onClick={() => void handleAudibleAuthStart()}
                                    >
                                      <Network size={14} />
                                      Generate login URL
                                    </button>
                                  </div>
                                </>
                              )}

                              {audibleAuthStep === "url" && audibleAuthUrl && (
                                <>
                                  <p><strong>Step 1:</strong> Open the link below in your browser and log in with your Amazon / Audible account.</p>
                                  <div className="audible-cli-auth-url-row">
                                    <a
                                      className="btn btn-primary"
                                      href={audibleAuthUrl}
                                      target="_blank"
                                      rel="noreferrer"
                                    >
                                      <Network size={14} />
                                      Open Audible login
                                    </a>
                                    <button
                                      className="btn btn-secondary"
                                      type="button"
                                      onClick={() => void navigator.clipboard?.writeText(audibleAuthUrl)}
                                    >
                                      <Copy size={14} />
                                      Copy URL
                                    </button>
                                  </div>
                                  <p><strong>Step 2:</strong> After logging in, your browser will show an error page — that's expected. Copy the full URL from your browser's address bar and paste it below.</p>
                                  <textarea
                                    className="form-control audible-cli-redirect-input"
                                    placeholder="Paste the redirect URL here (starts with https://www.amazon.com/ap/maplanding?...)"
                                    value={audibleAuthRedirect}
                                    rows={3}
                                    onChange={(e) => setAudibleAuthRedirect(e.target.value)}
                                  />
                                  <div className="audible-cli-auth-row">
                                    <button
                                      className="btn btn-secondary"
                                      type="button"
                                      onClick={() => {
                                        setAudibleAuthStep("idle");
                                        setAudibleAuthToken("");
                                        setAudibleAuthUrl("");
                                        setAudibleAuthRedirect("");
                                      }}
                                    >
                                      Cancel
                                    </button>
                                    <button
                                      className="btn btn-primary"
                                      type="button"
                                      disabled={!audibleAuthRedirect.trim()}
                                      onClick={() => void handleAudibleAuthComplete()}
                                    >
                                      <Check size={14} />
                                      Complete setup
                                    </button>
                                  </div>
                                </>
                              )}

                              {audibleAuthStep === "url" && !audibleAuthUrl && (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)" }}>
                                  <Loader2 size={15} className="animate-spin" />
                                  Generating login URL…
                                </div>
                              )}

                              {audibleAuthStep === "completing" && (
                                <div style={{ display: "flex", alignItems: "center", gap: "0.5rem", color: "var(--text-secondary)" }}>
                                  <Loader2 size={15} className="animate-spin" />
                                  Completing authentication…
                                </div>
                              )}
                            </div>
                          )}

                          {(audibleCliStatus.authenticated || audibleAuthStep === "done") && (
                            <p className="audible-cli-active-note">
                              Metadata searches will use the active Audible profile via audible-cli. The web scraper is kept as a fallback.
                            </p>
                          )}
                        </>
                      ) : (
                        <div className="admin-empty-state">
                          {audibleCliStatusLoading ? "Checking audible-cli…" : "Click 'Check status' to probe the server environment."}
                        </div>
                      )}
                    </div>

                    <div className="admin-split-grid">
                      <div className="card admin-section-card">
                        <div className="admin-section-head">
                          <h3>Maintenance</h3>
                          <Database size={15} />
                        </div>
                        <div className="admin-action-list">
                          <div className="admin-action-item">
                            <div>
                              <strong>Create backup</strong>
                              <small>Snapshot the current database to a timestamped file</small>
                            </div>
                            <button
                              className="btn btn-primary"
                              type="button"
                              disabled={actionLoading === "create-backup"}
                              onClick={() => void handleCreateBackup()}
                            >
                              {actionLoading === "create-backup" ? (
                                <Loader2 size={15} className="animate-spin" />
                              ) : (
                                <Database size={15} />
                              )}
                              Backup now
                            </button>
                          </div>
                          <div className="admin-action-item">
                            <div>
                              <strong>Full library rescan</strong>
                              <small>Re-index all source paths and refresh book metadata</small>
                            </div>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              disabled={actionLoading === "rescan-library"}
                              onClick={() => void handleRescan()}
                            >
                              {actionLoading === "rescan-library" ? (
                                <Loader2 size={15} className="animate-spin" />
                              ) : (
                                <RefreshCw size={15} />
                              )}
                              Rescan all
                            </button>
                          </div>
                        </div>
                      </div>

                      <div className="card admin-section-card">
                        <div className="admin-section-head">
                          <h3>Paths & storage</h3>
                          <HardDrive size={15} />
                        </div>
                        <div className="admin-meta-list">
                          <div>
                            <span>Cover storage</span>
                            <code>{dashboard.library.coversRoot}</code>
                          </div>
                          <div>
                            <span>Configured libraries</span>
                            <code>{dashboard.stats.libraries}</code>
                          </div>
                          <div>
                            <span>Enabled sources</span>
                            <code>{enabledSourceCount}</code>
                          </div>
                          <div>
                            <span>Total backups</span>
                            <code>{dashboard.backups.length}</code>
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="card admin-section-card">
                      <div className="admin-section-head">
                        <h3>Backup history</h3>
                        <Database size={15} />
                      </div>
                      <div className="admin-table">
                        {dashboard.backups.length === 0 ? (
                          <div className="admin-empty-state">No backups yet. Create one above.</div>
                        ) : (
                          dashboard.backups.map((backup) => (
                            <div key={backup.name} className="admin-table-row">
                              <div className="admin-book-summary">
                                <strong>{backup.name}</strong>
                                <small>{formatDate(backup.createdAt)}</small>
                              </div>
                              <div className="admin-pill">{formatBytes(backup.size)}</div>
                            </div>
                          ))
                        )}
                      </div>
                    </div>
                  </div>
                )}

                {activeTab === "logs" && (
                  <div className="admin-panel-stack">
                    <div className="admin-log-stats-grid">
                      <div className="admin-log-stat-chip admin-log-stat-error">
                        <AlertCircle size={14} />
                        <strong>{logsData?.stats.error ?? 0}</strong>
                        <span>Errors</span>
                      </div>
                      <div className="admin-log-stat-chip admin-log-stat-warn">
                        <AlertTriangle size={14} />
                        <strong>{logsData?.stats.warn ?? 0}</strong>
                        <span>Warnings</span>
                      </div>
                      <div className="admin-log-stat-chip admin-log-stat-info">
                        <Info size={14} />
                        <strong>{logsData?.stats.info ?? 0}</strong>
                        <span>Info</span>
                      </div>
                      <div className="admin-log-stat-chip admin-log-stat-debug">
                        <Bug size={14} />
                        <strong>{logsData?.stats.debug ?? 0}</strong>
                        <span>Debug</span>
                      </div>
                    </div>

                    <div className="card admin-section-card">
                      <div className="admin-section-head admin-logs-explorer-head">
                        <div className="admin-logs-explorer-title">
                          <FileText size={15} />
                          <h3>Log explorer</h3>
                        </div>
                        <div className="admin-log-level-toggles" role="group" aria-label="Enabled log levels">
                          {LOG_LEVEL_OPTIONS.map((option) => {
                            const enabled = enabledLogLevels.includes(option.value);
                            return (
                              <button
                                key={option.value}
                                className={`admin-log-level-toggle ${enabled ? "enabled" : ""} admin-log-level-toggle-${option.value}`}
                                type="button"
                                onClick={() => toggleLogLevel(option.value)}
                                aria-pressed={enabled}
                                title={enabled ? `Hide ${option.label.toLowerCase()}` : `Show ${option.label.toLowerCase()}`}
                              >
                                <span className={`admin-log-level admin-log-level-${option.value}`}>
                                  {option.value === "error" && <AlertCircle size={11} />}
                                  {option.value === "warn" && <AlertTriangle size={11} />}
                                  {option.value === "info" && <Info size={11} />}
                                  {option.value === "debug" && <Bug size={11} />}
                                  {option.value}
                                </span>
                                {option.label}
                              </button>
                            );
                          })}
                        </div>
                      </div>

                      <div className="admin-logs-toolbar">
                        <input
                          className="form-control admin-search"
                          placeholder="Search messages, paths, request IDs, or payloads…"
                          value={logSearch}
                          onChange={(e) => {
                            setLogSearch(e.target.value);
                            setLogsPage(1);
                          }}
                        />
                        <select
                          className="form-control"
                          value={logScopeFilter}
                          onChange={(e) => {
                            setLogScopeFilter(e.target.value as AdminLogScope);
                            setLogsPage(1);
                          }}
                        >
                          <option value="all">All log entries</option>
                          <option value="metadata">Metadata related</option>
                        </select>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={logsLoading}
                          onClick={() => void loadLogs(logsPage)}
                        >
                          {logsLoading ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <RefreshCw size={14} />
                          )}
                          Refresh
                        </button>
                        <button
                          className="btn admin-danger-btn"
                          type="button"
                          disabled={actionLoading === "clear-logs"}
                          onClick={() =>
                            setPendingConfirm({
                              title: "Clear Application Logs",
                              message: "Clear all application logs?",
                              confirmLabel: "Clear Logs",
                              tone: "danger",
                              onConfirm: () => void handleClearLogs(),
                            })
                          }
                        >
                          {actionLoading === "clear-logs" ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                          Clear logs
                        </button>
                      </div>
                    </div>

                    <div className="card admin-section-card">
                      <div className="admin-section-head">
                        <h3>Entries</h3>
                        <div className="admin-pill">
                          {logsData?.totalMatching ?? 0} matching
                        </div>
                      </div>

                      <div className={`admin-logs-list ${logsLoading ? "admin-logs-list-loading" : ""}`}>
                        {logsLoading && !logsData ? (
                          <div className="admin-settings-loading">
                            <div className="app-loading-spinner" />
                          </div>
                        ) : logsData?.entries.length ? (
                          logsData.entries.map((entry) => {
                            const logKey = `${entry.timestamp}-${entry.requestId ?? entry.message}`;
                            const isCopied = copiedLogKey === logKey;
                            const isExpanded = expandedLogKeys.has(logKey);
                            const isHttp = entry.tags?.includes("http") || (entry.method != null && entry.statusCode != null);
                            const hasDetails = entry.error != null || entry.data !== undefined;
                            const statusCategory = entry.statusCode != null ? getStatusCodeCategory(entry.statusCode) : null;

                            return (
                            <div key={logKey} className={`admin-log-card admin-log-card-${entry.level}`}>
                              <div className="admin-log-head">
                                <div className="admin-log-title-row">
                                  <span className={`admin-log-level admin-log-level-${entry.level}`}>
                                    {entry.level === "error" && <AlertCircle size={11} />}
                                    {entry.level === "warn" && <AlertTriangle size={11} />}
                                    {entry.level === "info" && <Info size={11} />}
                                    {entry.level === "debug" && <Bug size={11} />}
                                    {entry.level}
                                  </span>
                                  <strong className="admin-log-message">{entry.message}</strong>
                                </div>
                                <div className="admin-log-head-actions">
                                  <span
                                    className="admin-log-timestamp"
                                    title={formatDate(entry.timestamp)}
                                  >
                                    <Clock size={11} />
                                    {formatElapsed(entry.timestamp) || "just now"}
                                  </span>
                                  {hasDetails && (
                                    <button
                                      className={`admin-log-expand-btn ${isExpanded ? "expanded" : ""}`}
                                      type="button"
                                      onClick={() => toggleLogExpanded(logKey)}
                                      aria-expanded={isExpanded}
                                    >
                                      <ChevronDown size={13} />
                                      {isExpanded ? "Less" : "Details"}
                                    </button>
                                  )}
                                  <button
                                    className={`admin-log-copy-btn ${isCopied ? "copied" : ""}`}
                                    type="button"
                                    onClick={() => void copyLogEntry(entry, logKey)}
                                    title="Copy log entry as JSON"
                                    aria-label="Copy log entry"
                                  >
                                    {isCopied ? <Check size={13} /> : <Copy size={13} />}
                                  </button>
                                </div>
                              </div>

                              <div className="admin-log-meta-row">
                                <div className="admin-pill admin-log-context-pill">{entry.context}</div>
                                {isHttp && (
                                  <div className="admin-pill admin-log-http-pill">
                                    <Globe size={11} />
                                    {entry.method}
                                  </div>
                                )}
                                {entry.path ? (
                                  <div className="admin-pill admin-log-path-pill" title={entry.path}>
                                    {entry.path.length > 60 ? `${entry.path.slice(0, 60)}…` : entry.path}
                                  </div>
                                ) : null}
                                {entry.statusCode != null ? (
                                  <div className={`admin-log-status admin-log-status-${statusCategory}`}>
                                    {entry.statusCode}
                                  </div>
                                ) : null}
                                {entry.durationMs != null ? (
                                  <div className="admin-log-duration">
                                    <Clock size={10} />
                                    {formatDurationMs(entry.durationMs)}
                                  </div>
                                ) : null}
                                {entry.userId ? (
                                  <div className="admin-pill">
                                    <Users size={11} />
                                    {entry.userId}
                                  </div>
                                ) : null}
                                {entry.requestId ? (
                                  <div className="admin-pill admin-log-reqid-pill" title={`Request ID: ${entry.requestId}`}>
                                    {entry.requestId.slice(0, 8)}…
                                  </div>
                                ) : null}
                              </div>

                              {isExpanded && hasDetails && (
                                <div className="admin-log-details">
                                  {entry.error ? (
                                    <div className="admin-log-error-block">
                                      <div className="admin-log-error-header">
                                        <AlertCircle size={13} />
                                        <span className="admin-log-error-name">{entry.error.name}</span>
                                        <span className="admin-log-error-message">{entry.error.message}</span>
                                      </div>
                                      {entry.error.stack ? (
                                        <pre className="admin-log-stack">{entry.error.stack.replace(`${entry.error.name}: ${entry.error.message}\n`, "").trim()}</pre>
                                      ) : null}
                                    </div>
                                  ) : null}
                                  {entry.data !== undefined ? (
                                    <pre className="admin-log-block">
                                      {formatJsonBlock(entry.data)}
                                    </pre>
                                  ) : null}
                                </div>
                              )}
                            </div>
                            );
                          })
                        ) : (
                          <div className="admin-empty-state">
                            {logsData
                              ? "No log entries matched the current filters. Try widening your level selection or clearing the search."
                              : "Select the Logs tab to load entries."}
                          </div>
                        )}
                      </div>

                      <div className="admin-logs-pagination">
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={logsLoading || (logsData?.page ?? logsPage) <= 1}
                          onClick={() => setLogsPage((current) => Math.max(1, current - 1))}
                        >
                          <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
                          Previous
                        </button>
                        <span className="admin-logs-page-info">
                          Page {logsData?.page ?? logsPage} of {logsData?.totalPages ?? 1}
                          {logsData && (
                            <small> · {logsData.totalMatching} entries</small>
                          )}
                        </span>
                        <button
                          className="btn btn-secondary"
                          type="button"
                          disabled={
                            logsLoading ||
                            (logsData?.page ?? logsPage) >= (logsData?.totalPages ?? 1)
                          }
                          onClick={() => setLogsPage((current) => current + 1)}
                        >
                          Next
                          <ChevronRight size={14} />
                        </button>
                      </div>
                    </div>
                  </div>
                )}
              </>
            )}
          </section>
        </div>
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
};

export default AdminSettingsModal;
