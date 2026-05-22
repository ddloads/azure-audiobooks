import { useState, useEffect } from "react";
import {
  BookOpen,
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  FolderTree,
  HardDrive,
  Pencil,
  Save,
  Sparkles,
  Users,
} from "lucide-react";
import { useTasks, type ClientRuntimeTask } from "../../../context/TaskContext";
import type {
  DashboardData,
  AdminLibrary,
  AdminRuntimeTask,
  OverviewSectionKey,
  OverviewPreferences,
} from "../types";
import { formatDate, formatElapsed, formatHours } from "../helpers";

type OverviewTask = AdminRuntimeTask | ClientRuntimeTask;

interface OverviewTabProps {
  dashboard: DashboardData;
  libraries: AdminLibrary[];
  runtimeTasks: AdminRuntimeTask[];
}

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

export default function OverviewTab({
  dashboard,
  libraries,
  runtimeTasks,
}: OverviewTabProps) {
  const { tasks: clientTasks } = useTasks();
  const [overviewPreferences, setOverviewPreferences] = useState<OverviewPreferences>(() =>
    loadOverviewPreferences()
  );
  const [isEditingOverview, setIsEditingOverview] = useState(false);
  const [overviewDraft, setOverviewDraft] = useState<OverviewPreferences | null>(null);

  useEffect(() => {
    window.localStorage.setItem(
      ADMIN_OVERVIEW_PREFERENCES_KEY,
      JSON.stringify(overviewPreferences)
    );
  }, [overviewPreferences]);

  const enabledSourceCount = libraries.reduce(
    (count, library) => count + library.sources.filter((source) => source.isEnabled).length,
    0
  );
  const writableSourceCount = libraries.reduce(
    (count, library) => count + library.sources.filter((source) => source.isWritable).length,
    0
  );

  const overviewTasks: OverviewTask[] = [...runtimeTasks, ...clientTasks].sort((a, b) =>
    b.updatedAt.localeCompare(a.updatedAt)
  );

  const displayedOverviewPreferences = isEditingOverview && overviewDraft
    ? overviewDraft
    : overviewPreferences;

  const getRuntimeTaskTypeLabel = (task: OverviewTask) => {
    if (task.type === "scan") return "Library scan";
    if (task.type === "merge") return "Merge";
    if (task.type === "download") return "Offline download";
    return "Write tags";
  };

  const toggleOverviewSection = (section: OverviewSectionKey) => {
    if (isEditingOverview) {
      setOverviewDraft((current) => {
        if (!current) return null;
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

  const handleStartOverviewEdit = () => {
    setOverviewDraft({
      showStats: overviewPreferences.showStats,
      visibleSections: { ...overviewPreferences.visibleSections },
      collapsedSections: { ...overviewPreferences.collapsedSections },
    });
    setIsEditingOverview(true);
  };

  const handleCancelOverviewEdit = () => {
    setIsEditingOverview(false);
    setOverviewDraft(null);
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

  const resetOverviewPreferences = () => {
    setOverviewDraft(defaultOverviewPreferences());
  };

  const toggleOverviewStatsVisibility = () => {
    setOverviewDraft((current) => {
      if (!current) return null;
      return {
        ...current,
        showStats: !current.showStats,
      };
    });
  };

  const toggleOverviewVisibility = (section: OverviewSectionKey) => {
    setOverviewDraft((current) => {
      if (!current) return null;
      return {
        ...current,
        visibleSections: {
          ...current.visibleSections,
          [section]: !current.visibleSections[section],
        },
      };
    });
  };

  return (
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

      {displayedOverviewPreferences.showStats && (
        <div className="admin-stat-grid">
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
        </div>
      )}

      {!displayedOverviewPreferences.showStats &&
        !(Object.values(displayedOverviewPreferences.visibleSections) as boolean[]).some(Boolean) && (
          <div className="admin-empty-state">
            Overview is fully hidden. Use Customize overview to turn sections back on.
          </div>
        )}

      <div className="admin-split-grid">
        {displayedOverviewPreferences.visibleSections.libraries && (
          <div className="card admin-section-card">
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
            {!displayedOverviewPreferences.collapsedSections.libraries && (
              <div className="admin-collapsible-body admin-list">
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
              </div>
            )}
          </div>
        )}

        {displayedOverviewPreferences.visibleSections.recentBooks && (
          <div className="card admin-section-card">
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
            {!displayedOverviewPreferences.collapsedSections.recentBooks && (
              <div className="admin-collapsible-body admin-list">
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
              </div>
            )}
          </div>
        )}
      </div>

      <div className="admin-split-grid">
        {displayedOverviewPreferences.visibleSections.tasks && (
          <div className="card admin-section-card">
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
            {!displayedOverviewPreferences.collapsedSections.tasks && (
              <div className="admin-collapsible-body admin-task-list">
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
              </div>
            )}
          </div>
        )}

        {displayedOverviewPreferences.visibleSections.recentUsers && (
          <div className="card admin-section-card">
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
            {!displayedOverviewPreferences.collapsedSections.recentUsers && (
              <div className="admin-collapsible-body admin-list">
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
                          {" · "}{user.email || "No recovery email"} · joined {formatDate(user.createdAt)}
                        </small>
                      </div>
                    </div>
                  </div>
                ))}
                {dashboard.recentUsers.length === 0 && (
                  <div className="admin-empty-state">No users yet.</div>
                )}
              </div>
            )}
          </div>
        )}

        {displayedOverviewPreferences.visibleSections.storage && (
          <div className="card admin-section-card">
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
            {!displayedOverviewPreferences.collapsedSections.storage && (
              <div className="admin-collapsible-body admin-meta-list">
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
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
