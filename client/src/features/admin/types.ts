export type TabKey = "overview" | "users" | "library" | "appearance" | "scripts" | "system" | "reports" | "logs";

export type OverviewSectionKey = "libraries" | "recentBooks" | "recentUsers" | "storage" | "tasks";

export interface OverviewPreferences {
  showStats: boolean;
  visibleSections: Record<OverviewSectionKey, boolean>;
  collapsedSections: Record<OverviewSectionKey, boolean>;
}

export interface AppearanceSettings {
  showReviewBooks: boolean;
}

export interface DashboardStats {
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

export interface DashboardBackup {
  name: string;
  size: number;
  createdAt: string;
}

export interface DashboardLibrarySummary {
  id: string;
  name: string;
  _count: {
    books: number;
    sources: number;
  };
}

export interface DashboardData {
  stats: DashboardStats;
  library: {
    coversRoot: string;
    libraries: DashboardLibrarySummary[];
  };
  backups: DashboardBackup[];
  recentUsers: Array<{
    id: string;
    username: string;
    email?: string | null;
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

export interface AdminUser {
  id: string;
  username: string;
  email?: string | null;
  role: string;
  createdAt: string;
  updatedAt: string;
  _count: {
    progress: number;
  };
}

export interface AdminLibrarySource {
  id: string;
  label?: string | null;
  path: string;
  kind: string;
  isEnabled: boolean;
  isWritable: boolean;
  isWatched: boolean;
}

export interface AdminLibrary {
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

export interface StructureCheckItem {
  id: string;
  title: string;
  author: string;
  folderPath: string;
}

export interface StructureCheckResult {
  pattern: string;
  total: number;
  conforming: number;
  nonConforming: StructureCheckItem[];
}

export interface AdminLogEntry {
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

export interface AdminLogsResponse {
  entries: AdminLogEntry[];
  page: number;
  limit: number;
  totalMatching: number;
  totalPages: number;
  stats: Record<"debug" | "info" | "warn" | "error", number>;
  logDirectory: string;
}

export interface AdminBugReport {
  id: string;
  type: string;
  comment?: string | null;
  path?: string | null;
  userAgent?: string | null;
  createdAt: string;
  userId: string;
  username: string;
  email?: string | null;
}

export interface AdminScriptOption {
  id: string;
  label: string;
  description: string;
}

export interface AdminScriptResult {
  script: AdminScriptOption;
  exitCode: number | null;
  timedOut: boolean;
  stdout: string;
  stderr: string;
  startedAt: string;
  finishedAt: string;
}

export interface AdminWriteTagsJob {
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

export interface AdminRuntimeTask {
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

export interface AdminRuntimeTasksResponse {
  active: AdminRuntimeTask[];
}

export interface AudibleCliStatus {
  installed: boolean;
  authenticated: boolean;
  configDir: string;
  marketplace: string;
  activeProfile: string | null;
  profiles: string[];
}

export type PendingAdminConfirm = {
  title: string;
  message: string;
  confirmLabel: string;
  tone?: "default" | "danger";
  onConfirm: () => void;
};

export type AdminLogLevel = "debug" | "info" | "warn" | "error";
export type AdminLogScope = "all" | "metadata";
