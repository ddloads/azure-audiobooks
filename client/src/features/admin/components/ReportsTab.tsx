import { useState, useEffect } from "react";
import { RefreshCw } from "lucide-react";
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

export default function ReportsTab() {
  const { showToast } = useToast();
  const [bugReports, setBugReports] = useState<AdminBugReport[]>([]);
  const [reportsLoading, setReportsLoading] = useState(false);

  const loadBugReports = async () => {
    setReportsLoading(true);
    try {
      const response = await api.get<AdminBugReport[]>("/admin/bug-reports");
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

      <div className="admin-report-list">
        {reportsLoading && bugReports.length === 0 ? (
          <div className="admin-empty-state">Loading reports...</div>
        ) : bugReports.length === 0 ? (
          <div className="admin-empty-state">No issue reports have been submitted.</div>
        ) : (
          bugReports.map((report) => (
            <article className="card admin-section-card admin-report-card" key={report.id}>
              <div className="admin-report-card-head">
                <div>
                  <h3>{REPORT_TYPE_LABELS[report.type] ?? report.type}</h3>
                  <p className="admin-library-meta-text">
                    {report.username}
                    {report.email ? ` · ${report.email}` : ""}
                    {" · "}
                    {formatDate(report.createdAt)}
                  </p>
                </div>
                <div className="admin-pill">{report.path || "No path"}</div>
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
          ))
        )}
      </div>
    </div>
  );
}
