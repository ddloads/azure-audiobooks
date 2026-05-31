import { useState, useEffect } from "react";
import { ChevronRight, Headphones, RefreshCw } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import type { AdminUser, AdminSession, AdminSessionsResponse } from "../types";
import { formatDate, formatListenTime, getErrorMessage } from "../helpers";

const PAGE_SIZE = 25;

interface SessionsTabProps {
  users: AdminUser[];
}

export default function SessionsTab({ users }: SessionsTabProps) {
  const { showToast } = useToast();
  const [data, setData] = useState<AdminSessionsResponse | null>(null);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [userFilter, setUserFilter] = useState("");
  const [refreshKey, setRefreshKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    const run = async () => {
      setLoading(true);
      try {
        const res = await api.get<AdminSessionsResponse>("/sessions/admin/all", {
          params: {
            page,
            limit: PAGE_SIZE,
            ...(userFilter ? { userId: userFilter } : {}),
          },
        });
        if (!cancelled) setData(res.data);
      } catch (error) {
        if (!cancelled)
          showToast({
            title: "Failed to load sessions",
            description: getErrorMessage(error, "Could not retrieve listening sessions"),
            tone: "error",
          });
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [page, userFilter, refreshKey]);

  const handleFilterChange = (uid: string) => {
    setUserFilter(uid);
    setPage(1);
  };

  const formatEnded = (session: AdminSession) => {
    if (!session.endedAt)
      return <span className="sessions-badge sessions-badge-active">Active</span>;
    return <span>{formatDate(session.endedAt)}</span>;
  };

  return (
    <div className="admin-panel-stack">
      <div className="card admin-section-card">
        <div className="admin-section-head admin-sessions-head">
          <div className="admin-logs-explorer-title">
            <Headphones size={16} />
            <h3>Listening Sessions</h3>
            {data && (
              <span className="admin-logs-page-info">
                · {data.total.toLocaleString()} total
              </span>
            )}
          </div>
          <div className="admin-sessions-head-actions">
            <select
              className="input input-sm"
              value={userFilter}
              onChange={(e) => handleFilterChange(e.target.value)}
            >
              <option value="">All Users</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.username}
                </option>
              ))}
            </select>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              title="Refresh"
              disabled={loading}
              onClick={() => setRefreshKey((k) => k + 1)}
            >
              <RefreshCw size={13} className={loading ? "animate-spin" : ""} />
            </button>
          </div>
        </div>

        {loading && !data ? (
          <div className="admin-settings-loading">
            <div className="app-loading-spinner" />
          </div>
        ) : !data || data.sessions.length === 0 ? (
          <p className="admin-empty-text">No sessions found.</p>
        ) : (
          <div className="admin-sessions-table-wrap">
            <table className="admin-sessions-table">
              <thead>
                <tr>
                  <th>Book</th>
                  <th>User</th>
                  <th>Platform</th>
                  <th>Listened</th>
                  <th>Started</th>
                  <th>Ended</th>
                </tr>
              </thead>
              <tbody>
                {data.sessions.map((s) => (
                  <tr key={s.id}>
                    <td>
                      <div className="sessions-book-cell">
                        <span className="sessions-book-title">{s.book.title}</span>
                        <span className="sessions-book-author">{s.book.author.name}</span>
                      </div>
                    </td>
                    <td>{s.user.username}</td>
                    <td>{s.platform ?? "—"}</td>
                    <td>
                      <strong>{formatListenTime(s.secondsListened)}</strong>
                    </td>
                    <td className="sessions-date">{formatDate(s.startedAt)}</td>
                    <td className="sessions-date">{formatEnded(s)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {data && data.totalPages > 1 && (
          <div className="admin-logs-pagination">
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={loading || page <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              <ChevronRight size={14} style={{ transform: "rotate(180deg)" }} />
              Previous
            </button>
            <span className="admin-logs-page-info">
              Page {data.page} of {data.totalPages}
              <small> · {data.total.toLocaleString()} sessions</small>
            </span>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              disabled={loading || page >= data.totalPages}
              onClick={() => setPage((p) => p + 1)}
            >
              Next
              <ChevronRight size={14} />
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
