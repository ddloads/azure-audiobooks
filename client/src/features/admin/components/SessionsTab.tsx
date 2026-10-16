import { useState, useEffect } from "react";
import { BookOpen, ChevronLeft, ChevronRight, Headphones, RefreshCw } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import { coverUrl } from "../../../utils/covers";
import type { AdminUser, AdminSession, AdminSessionsResponse } from "../types";
import { formatDate, formatListenTime, getErrorMessage } from "../helpers";
import { Badge, Button, EmptyState, List, ListItem, Panel, Toolbar } from "../ui";
import "./SessionsTab.css";

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

  const describeWhen = (session: AdminSession) =>
    session.endedAt
      ? `${formatDate(session.startedAt)} → ${new Date(session.endedAt).toLocaleTimeString([], { hour: "numeric", minute: "2-digit" })}`
      : `Started ${formatDate(session.startedAt)}`;

  return (
    <Panel
      title="History"
      icon={Headphones}
      description={data ? `${data.total.toLocaleString()} ${data.total === 1 ? "session" : "sessions"}${userFilter ? " for this user" : " in total"}` : "Loading…"}
      flush
    >
      <div className="as-panel-body as-sessions-filters">
        <Toolbar>
          <select
            className="form-control"
            aria-label="Filter by user"
            value={userFilter}
            onChange={(e) => handleFilterChange(e.target.value)}
          >
            <option value="">All users</option>
            {users.map((u) => (
              <option key={u.id} value={u.id}>
                {u.username}
              </option>
            ))}
          </select>
          <Button icon={RefreshCw} loading={loading} onClick={() => setRefreshKey((k) => k + 1)}>
            Refresh
          </Button>
        </Toolbar>
      </div>

      <div className="as-sessions-body">
        {loading && !data ? (
          <div className="as-loading">
            <div className="app-loading-spinner" />
          </div>
        ) : !data || data.sessions.length === 0 ? (
          <EmptyState icon={Headphones} title="No sessions found">
            {userFilter ? "This user hasn't listened to anything yet." : "Sessions appear here once someone starts listening."}
          </EmptyState>
        ) : (
          <List>
            {data.sessions.map((s) => (
              <ListItem
                key={s.id}
                leading={
                  <span className="as-sessions-cover" aria-hidden="true">
                    {s.book.coverPath ? (
                      <img src={coverUrl(s.book.coverPath, 80)} alt="" loading="lazy" decoding="async" />
                    ) : (
                      <BookOpen size={16} />
                    )}
                  </span>
                }
                title={s.book.title}
                subtitle={`${s.user.username} · ${s.platform ?? "Unknown device"}`}
                meta={`${s.book.author.name} · ${describeWhen(s)}`}
                trailing={
                  <span className="as-sessions-duration">
                    <strong>{formatListenTime(s.secondsListened)}</strong>
                    {!s.endedAt && <Badge tone="success">Active</Badge>}
                  </span>
                }
              />
            ))}
          </List>
        )}
      </div>

      {data && data.totalPages > 1 && (
        <div className="as-panel-body as-sessions-pager">
          <Button icon={ChevronLeft} disabled={loading || page <= 1} onClick={() => setPage((p) => Math.max(1, p - 1))}>
            Previous
          </Button>
          <span className="as-sessions-page-info">
            Page {data.page} of {data.totalPages}
          </span>
          <Button disabled={loading || page >= data.totalPages} onClick={() => setPage((p) => p + 1)}>
            Next
            <ChevronRight size={16} aria-hidden="true" />
          </Button>
        </div>
      )}
    </Panel>
  );
}
