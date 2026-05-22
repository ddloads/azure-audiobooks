import { useState, useEffect } from "react";
import {
  AlertCircle,
  AlertTriangle,
  Info,
  Bug,
  FileText,
  Loader2,
  RefreshCw,
  Trash2,
  Clock,
  ChevronDown,
  Copy,
  Check,
  Globe,
  Users,
  ChevronRight,
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
  formatElapsed,
  formatDurationMs,
  formatJsonBlock,
  getStatusCodeCategory,
  buildLogCopyText,
  copyTextToClipboard,
  getErrorMessage,
} from "../helpers";

const LOG_LEVEL_OPTIONS: Array<{ value: AdminLogLevel; label: string }> = [
  { value: "error", label: "Errors" },
  { value: "warn", label: "Warnings" },
  { value: "info", label: "Info" },
  { value: "debug", label: "Debug" },
];

export default function LogsTab() {
  const { showToast } = useToast();
  const [logsData, setLogsData] = useState<AdminLogsResponse | null>(null);
  const [logsPage, setLogsPage] = useState(1);
  const [logsLoading, setLogsLoading] = useState(false);
  const [enabledLogLevels, setEnabledLogLevels] = useState<AdminLogLevel[]>([
    "info",
    "warn",
    "error",
  ]);
  const [logSearch, setLogSearch] = useState("");
  const [logScopeFilter, setLogScopeFilter] = useState<AdminLogScope>("all");
  const [expandedLogKeys, setExpandedLogKeys] = useState<Set<string>>(new Set());
  const [copiedLogKey, setCopiedLogKey] = useState<string | null>(null);

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirm | null>(null);

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
  }, [enabledLogLevels, logSearch, logScopeFilter]);

  // Handle manual/pagination loads
  useEffect(() => {
    void loadLogs(logsPage);
  }, [logsPage]);

  const toggleLogLevel = (level: AdminLogLevel) => {
    setEnabledLogLevels((prev) =>
      prev.includes(level) ? prev.filter((l) => l !== level) : [...prev, level]
    );
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
      showToast({
        title: "Copied to clipboard",
        tone: "success",
      });
    } else {
      showToast({
        title: "Failed to copy",
        tone: "error",
      });
    }
  };

  const handleClearLogs = async () => {
    setActionLoading("clear-logs");
    try {
      await api.post("/admin/logs/clear");
      showToast({
        title: "Logs cleared",
        tone: "success",
      });
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

  return (
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
          <div className="admin-pill">{logsData?.totalMatching ?? 0} matching</div>
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
              const isHttp =
                entry.tags?.includes("http") || (entry.method != null && entry.statusCode != null);
              const hasDetails = entry.error != null || entry.data !== undefined;
              const statusCategory =
                entry.statusCode != null ? getStatusCodeCategory(entry.statusCode) : null;

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
                      <span className="admin-log-timestamp" title={formatDate(entry.timestamp)}>
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
                            <pre className="admin-log-stack">
                              {entry.error.stack
                                .replace(`${entry.error.name}: ${entry.error.message}\n`, "")
                                .trim()}
                            </pre>
                          ) : null}
                        </div>
                      ) : null}
                      {entry.data !== undefined ? (
                        <pre className="admin-log-block">{formatJsonBlock(entry.data)}</pre>
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
            {logsData && <small> · {logsData.totalMatching} entries</small>}
          </span>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={logsLoading || (logsData?.page ?? logsPage) >= (logsData?.totalPages ?? 1)}
            onClick={() => setLogsPage((current) => current + 1)}
          >
            Next
            <ChevronRight size={14} />
          </button>
        </div>
      </div>

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
