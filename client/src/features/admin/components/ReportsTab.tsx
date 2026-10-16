import { useState, useEffect } from "react";
import { CheckCheck, CheckCircle2, Inbox, MessageSquareWarning, RefreshCw, RotateCcw, Trash2, X } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import type { AdminBugReport } from "../types";
import { formatDate, getErrorMessage } from "../helpers";
import { Actions, Badge, Button, EmptyState, List, ListItem, Panel, Segmented, type Tone } from "../ui";
import "./ReportsTab.css";

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

const STATUS_TONES: Record<AdminBugReport["status"], Tone> = {
  open: "warning",
  fixed: "success",
  dismissed: "neutral",
};

type ReportView = "open" | "resolved" | "all";

export default function ReportsTab() {
  const { showToast } = useToast();
  const [bugReports, setBugReports] = useState<AdminBugReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [view, setView] = useState<ReportView>("open");

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
      setBugReports((prev) => prev.map((r) => (r.id === id ? { ...r, status } : r)));
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
  const visible = view === "open" ? open : view === "resolved" ? resolved : bugReports;

  const renderReport = (report: AdminBugReport) => {
    const busy = actionLoading !== null;
    return (
      <ListItem
        key={report.id}
        title={
          <>
            <Badge tone={report.status === "open" ? "accent" : "neutral"}>{REPORT_TYPE_LABELS[report.type] ?? report.type}</Badge>
            {report.status !== "open" && <Badge tone={STATUS_TONES[report.status]}>{STATUS_LABELS[report.status]}</Badge>}
          </>
        }
        subtitle={
          report.comment ? (
            <span className="as-reports-comment">{report.comment}</span>
          ) : (
            <span className="as-reports-comment as-subtle">No comment provided.</span>
          )
        }
        meta={`${report.username}${report.email ? ` · ${report.email}` : ""} · ${formatDate(report.createdAt)}`}
      >
        <div className="as-reports-extra">
          {report.path && <code className="as-reports-path">{report.path}</code>}
          {report.userAgent && (
            <p className="as-reports-ua" title={report.userAgent}>
              {report.userAgent}
            </p>
          )}
          <Actions align="start">
            {report.status !== "fixed" && (
              <Button
                size="sm"
                icon={CheckCheck}
                title="Mark as fixed"
                disabled={busy}
                loading={actionLoading === `fixed-${report.id}`}
                onClick={() => void updateStatus(report.id, "fixed")}
              >
                Fixed
              </Button>
            )}
            {report.status !== "dismissed" && (
              <Button
                size="sm"
                icon={X}
                title="Dismiss"
                disabled={busy}
                loading={actionLoading === `dismissed-${report.id}`}
                onClick={() => void updateStatus(report.id, "dismissed")}
              >
                Dismiss
              </Button>
            )}
            {report.status !== "open" && (
              <Button
                size="sm"
                icon={RotateCcw}
                title="Reopen"
                disabled={busy}
                loading={actionLoading === `open-${report.id}`}
                onClick={() => void updateStatus(report.id, "open")}
              >
                Reopen
              </Button>
            )}
            <Button
              size="sm"
              variant="danger"
              icon={Trash2}
              title="Delete report"
              disabled={busy}
              loading={actionLoading === `delete-${report.id}`}
              onClick={() => void deleteReport(report.id)}
            >
              Delete
            </Button>
          </Actions>
        </div>
      </ListItem>
    );
  };

  return (
    <Panel
      title="Issue reports"
      icon={MessageSquareWarning}
      description="Submitted from the library and mobile menu."
      actions={
        <Button size="sm" icon={RefreshCw} loading={reportsLoading} onClick={() => void loadBugReports()}>
          Refresh
        </Button>
      }
      flush
    >
      {bugReports.length > 0 && (
        <div className="as-panel-body as-reports-filters">
          <Segmented<ReportView>
            label="Report status"
            value={view}
            onChange={setView}
            options={[
              { value: "open", label: "Open", count: open.length },
              { value: "resolved", label: "Resolved", count: resolved.length },
              { value: "all", label: "All", count: bugReports.length },
            ]}
          />
        </div>
      )}

      <div className="as-reports-body">
        {reportsLoading && bugReports.length === 0 ? (
          <div className="as-loading">
            <div className="app-loading-spinner" />
          </div>
        ) : bugReports.length === 0 ? (
          <EmptyState icon={Inbox} title="No issue reports yet">
            When listeners use “Report an issue”, their reports show up here.
          </EmptyState>
        ) : visible.length === 0 ? (
          view === "open" ? (
            <EmptyState icon={CheckCircle2} title="All caught up" action={<Button size="sm" onClick={() => setView("resolved")}>View resolved ({resolved.length})</Button>}>
              Every report has been fixed or dismissed.
            </EmptyState>
          ) : (
            <EmptyState icon={Inbox} title="No resolved reports" />
          )
        ) : (
          <List>{visible.map(renderReport)}</List>
        )}
      </div>
    </Panel>
  );
}
