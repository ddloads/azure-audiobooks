import { useState, useEffect, type ReactNode } from "react";
import {
  Archive,
  BookOpen,
  ChevronDown,
  ChevronUp,
  Clock,
  FolderTree,
  Headphones,
  HardDrive,
  RotateCcw,
  Save,
  SlidersHorizontal,
  Sparkles,
  Users,
  X,
  type LucideIcon,
} from "lucide-react";
import { useTasks, type ClientRuntimeTask } from "../../../context/TaskContext";
import api from "../../../api/axios";
import type {
  DashboardData,
  AdminLibrary,
  AdminRuntimeTask,
  AdminListeningStats,
  OverviewSectionKey,
  OverviewPreferences,
} from "../types";
import { formatBytes, formatDate, formatElapsed, formatHours, formatListenTime } from "../helpers";
import {
  Actions,
  Avatar,
  Badge,
  Button,
  Columns,
  EmptyState,
  KeyValues,
  List,
  ListItem,
  Panel,
  Progress,
  Stack,
  Stat,
  StatGrid,
  ToggleRow,
  type Tone,
} from "../ui";
import "./OverviewTab.css";

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
    listening: true,
  },
  collapsedSections: {
    libraries: false,
    recentBooks: false,
    recentUsers: false,
    storage: false,
    tasks: false,
    listening: false,
  },
});

const overviewSectionLabels: Record<OverviewSectionKey, string> = {
  libraries: "Libraries",
  recentBooks: "Recent books",
  recentUsers: "Recent users",
  storage: "Storage",
  tasks: "Tasks",
  listening: "Listening activity",
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

const overviewSectionDescriptions: Record<OverviewSectionKey, string> = {
  libraries: "Each library with its book and source counts.",
  recentBooks: "The latest titles picked up by scans.",
  recentUsers: "Newest accounts and their roles.",
  storage: "Cover storage, source paths and recent backups.",
  tasks: "Scans, merges, tag writes and downloads in progress.",
  listening: "Listening time today and this week, with top listeners and books.",
};

const taskStatusTone = (status: string): Tone => {
  if (status === "failed") return "danger";
  if (status === "completed") return "success";
  return "accent";
};

interface SectionPanelProps {
  title: string;
  icon: LucideIcon;
  count?: number;
  collapsed: boolean;
  onToggle: () => void;
  flush?: boolean;
  tone?: Tone;
  children: ReactNode;
}

/** Overview card whose body can be folded away; the fold state is remembered per browser. */
function SectionPanel({ title, icon, count, collapsed, onToggle, flush, tone, children }: SectionPanelProps) {
  return (
    <Panel
      title={
        <>
          {title}
          {count !== undefined && <Badge tone={tone === "accent" ? "accent" : "neutral"}>{count}</Badge>}
        </>
      }
      icon={icon}
      tone={tone}
      flush={flush}
      actions={
        <Button
          variant="ghost"
          size="sm"
          iconOnly
          icon={collapsed ? ChevronDown : ChevronUp}
          aria-label={collapsed ? `Expand ${title}` : `Collapse ${title}`}
          aria-expanded={!collapsed}
          onClick={onToggle}
        />
      }
    >
      {collapsed ? undefined : children}
    </Panel>
  );
}

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
  const [listenStats, setListenStats] = useState<AdminListeningStats | null>(null);

  useEffect(() => {
    api.get<AdminListeningStats>("/sessions/stats/admin")
      .then((res) => setListenStats(res.data))
      .catch(() => undefined);
  }, []);

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
    <Stack>
      {!isEditingOverview && (
        <div className="as-overview-bar">
          <p className="as-overview-bar-note">
            {overviewTasks.length > 0
              ? `${overviewTasks.length} background ${overviewTasks.length === 1 ? "task" : "tasks"} running`
              : "Everything is idle"}
          </p>
          <Button variant="ghost" size="sm" icon={SlidersHorizontal} onClick={handleStartOverviewEdit}>
            Customize
          </Button>
        </div>
      )}

      {isEditingOverview && (
        <Panel
          title="Customize overview"
          icon={SlidersHorizontal}
          description="Choose which blocks stay visible in this browser. Use the arrow on any card to fold it."
          tone="accent"
        >
          <Stack gap="md">
            <div>
              <ToggleRow
                title="Stats cards"
                description="User, library, book and runtime counters."
                checked={displayedOverviewPreferences.showStats}
                onChange={toggleOverviewStatsVisibility}
              />
              {(Object.keys(overviewSectionLabels) as OverviewSectionKey[]).map((section) => (
                <ToggleRow
                  key={section}
                  title={overviewSectionLabels[section]}
                  description={
                    displayedOverviewPreferences.visibleSections[section] &&
                    displayedOverviewPreferences.collapsedSections[section]
                      ? `${overviewSectionDescriptions[section]} Currently collapsed.`
                      : overviewSectionDescriptions[section]
                  }
                  checked={displayedOverviewPreferences.visibleSections[section]}
                  onChange={() => toggleOverviewVisibility(section)}
                />
              ))}
            </div>
            <Actions>
              <Button variant="ghost" icon={RotateCcw} onClick={resetOverviewPreferences}>
                Reset layout
              </Button>
              <Button variant="secondary" icon={X} onClick={handleCancelOverviewEdit}>
                Cancel
              </Button>
              <Button variant="primary" icon={Save} onClick={handleSaveOverviewPreferences}>
                Save layout
              </Button>
            </Actions>
          </Stack>
        </Panel>
      )}

      {displayedOverviewPreferences.visibleSections.tasks && overviewTasks.length > 0 && (
        <SectionPanel
          title="Running tasks"
          icon={Sparkles}
          count={overviewTasks.length}
          tone="accent"
          collapsed={displayedOverviewPreferences.collapsedSections.tasks}
          onToggle={() => toggleOverviewSection("tasks")}
          flush
        >
          <List>
            {overviewTasks.map((task) => {
              const stage = "stage" in task && task.stage ? task.stage : null;
              return (
                <ListItem
                  key={task.id}
                  title={task.title}
                  subtitle={`${getRuntimeTaskTypeLabel(task)} · ${stage ?? task.detail}`}
                  meta={`Updated ${formatElapsed(task.updatedAt) || "just now"}`}
                  trailing={
                    <>
                      <span className="as-overview-pct">{task.progress}%</span>
                      <Badge tone={taskStatusTone(task.status)}>{task.status}</Badge>
                    </>
                  }
                >
                  <div className="as-overview-task-extra">
                    <Progress value={task.progress} tone={taskStatusTone(task.status)} label={`${task.title} progress`} />
                    {task.detail && stage && task.detail !== stage && (
                      <p className="as-overview-task-detail">{task.detail}</p>
                    )}
                  </div>
                </ListItem>
              );
            })}
          </List>
        </SectionPanel>
      )}

      {displayedOverviewPreferences.showStats && (
        <StatGrid>
          <Stat label="Users" value={dashboard.stats.users} sub={`${dashboard.stats.admins} admins`} icon={Users} tone="accent" />
          <Stat label="Libraries" value={dashboard.stats.libraries} sub={`${dashboard.stats.sources} source paths`} icon={FolderTree} tone="accent" />
          <Stat label="Books" value={dashboard.stats.books} sub={`${dashboard.stats.authors} authors`} icon={BookOpen} tone="accent" />
          <Stat label="Total runtime" value={formatHours(dashboard.stats.totalDuration)} sub={`${dashboard.stats.audioFiles} audio files`} icon={Clock} tone="accent" />
        </StatGrid>
      )}

      {!displayedOverviewPreferences.showStats &&
        !(Object.values(displayedOverviewPreferences.visibleSections) as boolean[]).some(Boolean) && (
          <Panel>
            <EmptyState
              icon={SlidersHorizontal}
              title="Overview is fully hidden"
              action={
                !isEditingOverview && (
                  <Button variant="secondary" size="sm" icon={SlidersHorizontal} onClick={handleStartOverviewEdit}>
                    Customize overview
                  </Button>
                )
              }
            >
              Turn sections back on to see them here.
            </EmptyState>
          </Panel>
        )}

      <Columns>
        {displayedOverviewPreferences.visibleSections.libraries && (
          <SectionPanel
            title="Libraries"
            icon={FolderTree}
            count={dashboard.library.libraries.length}
            collapsed={displayedOverviewPreferences.collapsedSections.libraries}
            onToggle={() => toggleOverviewSection("libraries")}
            flush
          >
            {dashboard.library.libraries.length === 0 ? (
              <EmptyState icon={FolderTree} title="No libraries configured" />
            ) : (
              <List>
                {dashboard.library.libraries.map((library) => (
                  <ListItem
                    key={library.id}
                    title={library.name}
                    subtitle={`${library._count.books} ${library._count.books === 1 ? "book" : "books"} · ${library._count.sources} ${library._count.sources === 1 ? "source" : "sources"}`}
                    trailing={<Badge>{library._count.books}</Badge>}
                  />
                ))}
              </List>
            )}
          </SectionPanel>
        )}

        {displayedOverviewPreferences.visibleSections.recentBooks && (
          <SectionPanel
            title="Recent books"
            icon={BookOpen}
            count={dashboard.recentBooks.length}
            collapsed={displayedOverviewPreferences.collapsedSections.recentBooks}
            onToggle={() => toggleOverviewSection("recentBooks")}
            flush
          >
            {dashboard.recentBooks.length === 0 ? (
              <EmptyState icon={BookOpen} title="No books scanned yet" />
            ) : (
              <List>
                {dashboard.recentBooks.map((book) => (
                  <ListItem
                    key={book.id}
                    title={book.title}
                    subtitle={`${book.author.name} · ${book.library.name}`}
                    trailing={<span className="as-muted">{formatHours(book.duration)}</span>}
                  />
                ))}
              </List>
            )}
          </SectionPanel>
        )}

        {displayedOverviewPreferences.visibleSections.tasks && overviewTasks.length === 0 && (
          <SectionPanel
            title="Tasks"
            icon={Sparkles}
            count={0}
            collapsed={displayedOverviewPreferences.collapsedSections.tasks}
            onToggle={() => toggleOverviewSection("tasks")}
            flush
          >
            <EmptyState icon={Sparkles} title="No background tasks running">
              Scans, merges, tag writes and downloads show up here with live progress.
            </EmptyState>
          </SectionPanel>
        )}

        {displayedOverviewPreferences.visibleSections.recentUsers && (
          <SectionPanel
            title="Recent users"
            icon={Users}
            count={dashboard.recentUsers.length}
            collapsed={displayedOverviewPreferences.collapsedSections.recentUsers}
            onToggle={() => toggleOverviewSection("recentUsers")}
            flush
          >
            {dashboard.recentUsers.length === 0 ? (
              <EmptyState icon={Users} title="No users yet" />
            ) : (
              <List>
                {dashboard.recentUsers.map((user) => (
                  <ListItem
                    key={user.id}
                    leading={<Avatar name={user.username} tone={user.role === "ADMIN" ? "accent" : "neutral"} />}
                    title={
                      <>
                        {user.username}
                        <Badge tone={user.role === "ADMIN" ? "accent" : "neutral"}>{user.role}</Badge>
                      </>
                    }
                    subtitle={user.email || "No recovery email"}
                    meta={`Joined ${formatDate(user.createdAt)}`}
                  />
                ))}
              </List>
            )}
          </SectionPanel>
        )}

        {displayedOverviewPreferences.visibleSections.listening && (
          <SectionPanel
            title="Listening activity"
            icon={Headphones}
            collapsed={displayedOverviewPreferences.collapsedSections.listening}
            onToggle={() => toggleOverviewSection("listening")}
            flush
          >
            {!listenStats ? (
              <EmptyState title="Loading…" />
            ) : (
              <>
                <div className="as-overview-pad">
                  <StatGrid>
                    <Stat
                      label="Today"
                      value={formatListenTime(listenStats.todaySeconds)}
                      sub={`${listenStats.todaySessions} ${listenStats.todaySessions === 1 ? "session" : "sessions"}`}
                    />
                    <Stat label="This week" value={formatListenTime(listenStats.weekSeconds)} />
                  </StatGrid>
                </div>

                {listenStats.topListeners.length > 0 && (
                  <>
                    <p className="as-overview-sub">Top listeners this week</p>
                    <List>
                      {listenStats.topListeners.map(({ user, weekSeconds }) => (
                        <ListItem
                          key={user.id}
                          leading={<Avatar name={user.username} tone="neutral" />}
                          title={user.username}
                          trailing={<span className="as-muted">{formatListenTime(weekSeconds)}</span>}
                        />
                      ))}
                    </List>
                  </>
                )}

                {listenStats.topBooks.length > 0 && (
                  <>
                    <p className="as-overview-sub">Most listened this week</p>
                    <List>
                      {listenStats.topBooks.map(({ book, weekSeconds }) => (
                        <ListItem
                          key={book.id}
                          title={book.title}
                          subtitle={book.author?.name}
                          trailing={<span className="as-muted">{formatListenTime(weekSeconds)}</span>}
                        />
                      ))}
                    </List>
                  </>
                )}

                {listenStats.topListeners.length === 0 && listenStats.topBooks.length === 0 && (
                  <EmptyState icon={Headphones} title="No listening sessions recorded this week" />
                )}
              </>
            )}
          </SectionPanel>
        )}

        {displayedOverviewPreferences.visibleSections.storage && (
          <SectionPanel
            title="Storage"
            icon={HardDrive}
            collapsed={displayedOverviewPreferences.collapsedSections.storage}
            onToggle={() => toggleOverviewSection("storage")}
            flush
          >
            <div className="as-overview-pad">
              <KeyValues
                items={[
                  { label: "Cover storage", value: dashboard.library.coversRoot, mono: true },
                  { label: "Enabled source paths", value: enabledSourceCount },
                  { label: "Writable source paths", value: writableSourceCount },
                  { label: "Recent backups", value: dashboard.backups.length },
                ]}
              />
            </div>
            {dashboard.backups.length > 0 && (
              <>
                <p className="as-overview-sub">Recent backups</p>
                <List>
                  {dashboard.backups.map((backup) => (
                    <ListItem
                      key={backup.name}
                      leading={<Archive size={18} className="as-subtle" aria-hidden="true" />}
                      title={<span className="as-mono">{backup.name}</span>}
                      subtitle={formatDate(backup.createdAt)}
                      trailing={<span className="as-muted">{formatBytes(backup.size)}</span>}
                    />
                  ))}
                </List>
              </>
            )}
          </SectionPanel>
        )}
      </Columns>
    </Stack>
  );
}
