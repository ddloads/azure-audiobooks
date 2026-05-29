import { useState, useEffect } from "react";
import { CheckCheck, RefreshCw, Trash2, X } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import type { AdminBugReport } from "../types";
import { formatDate, getErrorMessage } from "../helpers";

const REPORT_TYPE_LABELS: Record<string, string> = {
  playback: "Playback issue",
  library: "Library or scanning",
  metadata: "Book metadata",
  account: "Account or login",
  performance: "Slow or unresponsive",
  visual: "Visual problem",
  other: "Something else",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Open",
  fixed: "Fixed",
  dismissed: "Dismissed",
};

export default function ReportsTab() {
  const { showToast } = useToast();
  const [bugReports, setBugReports] = useState<AdminBugReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadBugReports = async () => {
    setReportsLoading(true);
    try {
      const response = await api.get<AdminBugReport[]>("/reports/admin");
      setBugReports(response.data);
    } catch (error) {
      showToast({
        title: "Failed to load reports",
        description: getErrorMessage(error, "Failed to retrieve issue reports"),
        tone: "error",
      });
    } finally {
      setReportsLoading(false);
    }
  };

  useEffect(() => {
    void loadBugReports();
  }, []);

  const updateStatus = async (id: string, status: AdminBugReport["status"]) => {
    setActionLoading(`${status}-${id}`);
    try {
      await api.patch(`/reports/${id}`, { status });
      setBugReports((prev) =>
        prev.map((r) => (r.id === id ? { ...r, status } : r)),
      );
    } catch (error) {
      showToast({
        title: "Failed to update report",
        description: getErrorMessage(error, "Could not update report status"),
        tone: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const deleteReport = async (id: string) => {
    setActionLoading(`delete-${id}`);
    try {
      await api.delete(`/reports/${id}`);
      setBugReports((prev) => prev.filter((r) => r.id !== id));
    } catch (error) {
      showToast({
        title: "Failed to delete report",
        description: getErrorMessage(error, "Could not delete report"),
        tone: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const open = bugReports.filter((r) => r.status === "open");
  const resolved = bugReports.filter((r) => r.status !== "open");

  const renderCard = (report: AdminBugReport) => {
    const busy = actionLoading !== null;
    const isResolved = report.status !== "open";

    return (
      <article
        className={`card admin-section-card admin-report-card${isResolved ? " admin-report-card-resolved" : ""}`}
        key={report.id}
      >
        <div className="admin-report-card-head">
          <div className="admin-report-card-meta">
            <div className="admin-report-card-title-row">
              <h3>{REPORT_TYPE_LABELS[report.type] ?? report.type}</h3>
              {isResolved && (
                <span className={`admin-report-status-badge admin-report-status-${report.status}`}>
                  {STATUS_LABELS[report.status]}
                </span>
              )}
            </div>
            <p className="admin-library-meta-text">
              {report.username}
              {report.email ? ` · ${report.email}` : ""}
              {" · "}
              {formatDate(report.createdAt)}
            </p>
          </div>
          <div className="admin-report-card-actions">
            {report.path && (
              <span className="admin-pill admin-report-path">{report.path}</span>
            )}
            {report.status !== "fixed" && (
              <button
                className="btn btn-secondary btn-sm"
                title="Mark as fixed"
                disabled={busy}
                onClick={() => void updateStatus(report.id, "fixed")}
              >
                <CheckCheck size={14} />
                Fixed
              </button>
            )}
            {report.status !== "dismissed" && (
              <button
                className="btn btn-secondary btn-sm"
                title="Dismiss"
                disabled={busy}
                onClick={() => void updateStatus(report.id, "dismissed")}
              >
                <X size={14} />
                Dismiss
              </button>
            )}
            {report.status !== "open" && (
              <button
                className="btn btn-secondary btn-sm"
                title="Reopen"
                disabled={busy}
                onClick={() => void updateStatus(report.id, "open")}
              >
                Reopen
              </button>
            )}
            <button
              className="btn btn-danger btn-sm"
              title="Delete report"
              disabled={busy}
              onClick={() => void deleteReport(report.id)}
            >
              <Trash2 size={14} />
            </button>
          </div>
        </div>

        {report.comment ? (
          <p className="admin-report-comment">{report.comment}</p>
        ) : (
          <p className="admin-report-comment admin-report-comment-muted">No comment provided.</p>
        )}

        {report.userAgent && (
          <div className="admin-report-user-agent" title={report.userAgent}>
            {report.userAgent}
          </div>
        )}
      </article>
    );
  };

  return (
    <div className="admin-panel-stack">
      <div className="admin-section-head">
        <div>
          <h3>Issue reports</h3>
          <p className="admin-library-meta-text">
            Latest reports submitted from the library and mobile menu.
          </p>
        </div>
        <button
          className="btn btn-secondary"
          type="button"
          onClick={() => void loadBugReports()}
          disabled={reportsLoading}
        >
          <RefreshCw size={15} className={reportsLoading ? "animate-spin" : ""} />
          Refresh
        </button>
      </div>

      {reportsLoading && bugReports.length === 0 ? (
        <div className="admin-empty-state">Loading reports...</div>
      ) : bugReports.length === 0 ? (
        <div className="admin-empty-state">No issue reports have been submitted.</div>
      ) : (
        <>
          {open.length > 0 && (
            <div className="admin-report-list">
              {open.map(renderCard)}
            </div>
          )}

          {open.length === 0 && resolved.length > 0 && (
            <div className="admin-empty-state">All reports have been resolved.</div>
          )}

          {resolved.length > 0 && (
            <details className="admin-report-resolved-section">
              <summary className="admin-report-resolved-summary">
                Resolved ({resolved.length})
              </summary>
              <div className="admin-report-list admin-report-list-resolved">
                {resolved.map(renderCard)}
              </div>
            </details>
          )}
        </>
      )}
    </div>
  );
}
