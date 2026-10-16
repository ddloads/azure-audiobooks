import { useState, useEffect } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Bug,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Copy,
  FileText,
  Info,
  RefreshCw,
  Trash2,
} from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import ConfirmDialog from "../../../components/ConfirmDialog";
import type {
  AdminLogEntry,
  AdminLogsResponse,
  AdminLogLevel,
  AdminLogScope,
  PendingAdminConfirm,
} from "../types";
import {
  formatDate,
  formatDurationMs,
  formatJsonBlock,
  buildLogSummary,
  getStatusCodeCategory,
  buildLogCopyText,
  copyTextToClipboard,
  getErrorMessage,
} from "../helpers";
import {
  Actions,
  Badge,
  Button,
  EmptyState,
  KeyValues,
  List,
  ListItem,
  Panel,
  SearchInput,
  Segmented,
  Stack,
  Toolbar,
  type Tone,
} from "../ui";
import "./LogsTab.css";

type LevelFilter = "all" | AdminLogLevel;

const ALL_LEVELS: AdminLogLevel[] = ["error", "warn", "info", "debug"];

const LEVEL_META: Record<AdminLogLevel, { label: string; tone: Tone; icon: typeof Info }> = {
  error: { label: "Errors", tone: "danger", icon: AlertCircle },
  warn: { label: "Warnings", tone: "warning", icon: AlertTriangle },
  info: { label: "Info", tone: "accent", icon: Info },
  debug: { label: "Debug", tone: "neutral", icon: Bug },
};

const STATUS_TONE: Record<ReturnType<typeof getStatusCodeCategory>, Tone> = {
  "2xx": "success",
  "3xx": "accent",
  "4xx": "warning",
  "5xx": "danger",
  other: "neutral",
};

const formatAgo = (value: string) => {
  const seconds = Math.max(0, Math.floor((Date.now() - new Date(value).getTime()) / 1000));
  if (seconds < 5) return "just now";
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return formatDate(value);
};

export default function LogsTab() {
  const { showToast } = useToast();
  const [logsData, setLogsData] = useState<AdminLogsResponse | null>(null);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [levelFilter, setLevelFilter] = useState<LevelFilter>("all");
  const [logSearch, setLogSearch] = useState("");
  const [logScopeFilter, setLogScopeFilter] = useState<AdminLogScope>("all");
  const [expandedLogKeys, setExpandedLogKeys] = useState<Set<string>>(new Set());
  const [copiedLogKey, setCopiedLogKey] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirm | null>(null);

  const enabledLogLevels = levelFilter === "all" ? ALL_LEVELS : [levelFilter];

  const loadLogs = async (page: number) => {
    setLogsLoading(true);
    try {
      const response = await api.get<AdminLogsResponse>("/admin/logs", {
        params: {
          page,
          limit: 30,
          levels: enabledLogLevels.join(","),
          search: logSearch.trim(),
          scope: logScopeFilter,
        },
      });
      setLogsData(response.data);
      setLogsPage(response.data.page);
    } catch (error) {
      showToast({
        title: "Failed to load logs",
        description: getErrorMessage(error, "Failed to fetch logs from server"),
        tone: "error",
      });
    } finally {
      setLogsLoading(false);
    }
  };

  useEffect(() => {
    const delayDebounceFn = setTimeout(() => {
      void loadLogs(1);
    }, 300);

    return () => clearTimeout(delayDebounceFn);
  }, [levelFilter, logSearch, logScopeFilter]);

  // Handle manual/pagination loads
  useEffect(() => {
    void loadLogs(logsPage);
  }, [logsPage]);

  const changeLevel = (level: LevelFilter) => {
    setLevelFilter(level);
    setLogsPage(1);
  };

  const toggleLogExpanded = (logKey: string) => {
    setExpandedLogKeys((prev) => {
      const next = new Set(prev);
      if (next.has(logKey)) {
        next.delete(logKey);
      } else {
        next.add(logKey);
      }
      return next;
    });
  };

  const copyLogEntry = async (entry: AdminLogEntry, logKey: string) => {
    const text = buildLogCopyText(entry);
    const success = await copyTextToClipboard(text);
    if (success) {
      setCopiedLogKey(logKey);
      setTimeout(() => setCopiedLogKey(null), 2000);
      showToast({ title: "Copied to clipboard", tone: "success" });
    } else {
      showToast({ title: "Failed to copy", tone: "error" });
    }
  };

  const handleClearLogs = async () => {
    setActionLoading("clear-logs");
    try {
      await api.delete("/admin/logs");
      showToast({ title: "Logs cleared", tone: "success" });
      setLogsPage(1);
      await loadLogs(1);
    } catch (error) {
      showToast({
        title: "Failed to clear logs",
        description: getErrorMessage(error, "Failed to clear application logs"),
        tone: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const stats = logsData?.stats;
  const totalCount = stats ? ALL_LEVELS.reduce((sum, level) => sum + stats[level], 0) : undefined;
  const currentPage = logsData?.page ?? logsPage;
  const totalPages = logsData?.totalPages ?? 1;

  const renderEntry = (entry: AdminLogEntry) => {
    const logKey = `${entry.timestamp}-${entry.requestId ?? entry.message}`;
    const isCopied = copiedLogKey === logKey;
    const isExpanded = expandedLogKeys.has(logKey);
    const isHttp = entry.tags?.includes("http") || (entry.method != null && entry.statusCode != null);
    const statusCategory = entry.statusCode != null ? getStatusCodeCategory(entry.statusCode) : null;
    const level = LEVEL_META[entry.level];
    const LevelIcon = level.icon;

    const metaParts = [
      entry.context,
      formatAgo(entry.timestamp),
      entry.durationMs != null ? formatDurationMs(entry.durationMs) : null,
    ].filter(Boolean);

    const details = [
      { label: "Time", value: formatDate(entry.timestamp) },
      ...(isHttp ? [{ label: "Message", value: entry.message }] : []),
      { label: "Context", value: entry.context },
      ...(isHttp && entry.method ? [{ label: "Method", value: entry.method, mono: true }] : []),
      ...(entry.path ? [{ label: "Path", value: entry.path, mono: true }] : []),
      ...(entry.statusCode != null ? [{ label: "Status", value: String(entry.statusCode), mono: true }] : []),
      ...(entry.durationMs != null ? [{ label: "Duration", value: formatDurationMs(entry.durationMs) }] : []),
      ...(entry.userId ? [{ label: "User", value: entry.role ? `${entry.userId} (${entry.role})` : entry.userId, mono: true }] : []),
      ...(entry.ip ? [{ label: "IP", value: entry.ip, mono: true }] : []),
      ...(entry.requestId ? [{ label: "Request ID", value: entry.requestId, mono: true }] : []),
      ...(entry.tags?.length ? [{ label: "Tags", value: entry.tags.join(", ") }] : []),
    ];

    return (
      <ListItem
        key={logKey}
        selected={isExpanded}
        onClick={() => toggleLogExpanded(logKey)}
        leading={
          <span className={`as-logs-level as-logs-level-${entry.level}`} title={entry.level}>
            <LevelIcon size={15} aria-hidden="true" />
          </span>
        }
        title={
          <>
            {isHttp && entry.method && <Badge>{entry.method}</Badge>}
            {entry.statusCode != null && statusCategory && <Badge tone={STATUS_TONE[statusCategory]}>{entry.statusCode}</Badge>}
            <span className="as-logs-summary">
              {isHttp ? entry.path || buildLogSummary(entry) : entry.message}
            </span>
          </>
        }
        subtitle={entry.error && !isHttp ? <span className="as-logs-error-line">{entry.error.message}</span> : undefined}
        meta={<span title={formatDate(entry.timestamp)}>{metaParts.join(" · ")}</span>}
        trailing={
          <ChevronDown
            size={16}
            className={`as-logs-chevron${isExpanded ? " as-logs-chevron-open" : ""}`}
            aria-hidden="true"
          />
        }
      >
        {isExpanded && (
          <Stack gap="sm">
            <KeyValues items={details} />
            {entry.error ? (
              <div className="as-logs-error">
                <p className="as-logs-error-head">
                  <AlertCircle size={14} aria-hidden="true" />
                  <strong>{entry.error.name}</strong>
                  <span>{entry.error.message}</span>
                </p>
                {entry.error.stack ? (
                  <pre className="as-code">
                    {entry.error.stack.replace(`${entry.error.name}: ${entry.error.message}\n`, "").trim()}
                  </pre>
                ) : null}
              </div>
            ) : null}
            {entry.data !== undefined ? <pre className="as-code">{formatJsonBlock(entry.data)}</pre> : null}
            <Actions>
              <Button
                size="sm"
                icon={isCopied ? Check : Copy}
                onClick={() => void copyLogEntry(entry, logKey)}
                title="Copy readable log entry"
              >
                {isCopied ? "Copied" : "Copy entry"}
              </Button>
            </Actions>
          </Stack>
        )}
      </ListItem>
    );
  };

  return (
    <Stack>
      <Panel
        title="Log explorer"
        icon={FileText}
        description={logsData ? `${logsData.totalMatching.toLocaleString()} matching ${logsData.totalMatching === 1 ? "entry" : "entries"}` : "Loading entries…"}
        actions={
          <>
            <Button
              size="sm"
              icon={RefreshCw}
              loading={logsLoading}
              onClick={() => void loadLogs(logsPage)}
            >
              Refresh
            </Button>
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              loading={actionLoading === "clear-logs"}
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
              Clear
            </Button>
          </>
        }
        flush
      >
        <div className="as-panel-body as-logs-filters">
          <Stack gap="sm">
            <Segmented<LevelFilter>
              label="Log level"
              value={levelFilter}
              onChange={changeLevel}
              options={[
                { value: "all", label: "All", count: totalCount },
                ...ALL_LEVELS.map((level) => ({ value: level, label: LEVEL_META[level].label, count: stats?.[level] })),
              ]}
            />
            <SearchInput
              placeholder="Search messages, paths, request IDs, payloads…"
              aria-label="Search logs"
              value={logSearch}
              onChange={(e) => {
                setLogSearch(e.target.value);
                setLogsPage(1);
              }}
            />
            <Toolbar>
              <select
                className="form-control"
                aria-label="Log scope"
                value={logScopeFilter}
                onChange={(e) => {
                  setLogScopeFilter(e.target.value as AdminLogScope);
                  setLogsPage(1);
                }}
              >
                <option value="all">All log entries</option>
                <option value="metadata">Metadata related</option>
              </select>
            </Toolbar>
          </Stack>
        </div>

        <div className={logsLoading && logsData ? "as-logs-list as-logs-list-loading" : "as-logs-list"}>
          {logsLoading && !logsData ? (
            <div className="as-loading">
              <div className="app-loading-spinner" />
            </div>
          ) : logsData?.entries.length ? (
            <List>{logsData.entries.map(renderEntry)}</List>
          ) : (
            <EmptyState icon={FileText} title="No log entries">
              {logsData
                ? "Nothing matched the current filters. Try another level or clear the search."
                : "Logs could not be loaded. Try refreshing."}
            </EmptyState>
          )}
        </div>

        {logsData && totalPages > 1 && (
          <div className="as-panel-body as-logs-pager">
            <div className="as-logs-pager-row">
              <Button
                icon={ChevronLeft}
                disabled={logsLoading || currentPage <= 1}
                onClick={() => setLogsPage((current) => Math.max(1, current - 1))}
              >
                Previous
              </Button>
              <span className="as-logs-page-info">
                Page {currentPage} of {totalPages}
              </span>
              <Button
                disabled={logsLoading || currentPage >= totalPages}
                onClick={() => setLogsPage((current) => current + 1)}
              >
                Next
                <ChevronRight size={16} aria-hidden="true" />
              </Button>
            </div>
          </div>
        )}
      </Panel>

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
