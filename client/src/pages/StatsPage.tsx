import { useEffect, useState } from "react";
import { Headphones, Loader2 } from "lucide-react";
import api from "../api/axios";
import type { UserListeningStats } from "../features/admin/types";
import { formatListenTime, formatDate } from "../features/admin/helpers";

export default function StatsPage() {
  const [stats, setStats] = useState<UserListeningStats | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api.get<UserListeningStats>("/sessions/stats/me")
      .then((res) => setStats(res.data))
      .catch(() => undefined)
      .finally(() => setLoading(false));
  }, []);

  return (
    <div className="stats-page">
      <div className="stats-header">
        <h1 className="stats-title">Listening Stats</h1>
        <p className="stats-subtitle">Your personal listening history and totals</p>
      </div>

      {loading ? (
        <div className="stats-loading">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : !stats ? (
        <div className="stats-empty">
          <Headphones size={44} />
          <p>No sessions recorded yet. Start listening to track your history.</p>
        </div>
      ) : (
        <>
          <div className="stats-grid">
            <div className="stats-card">
              <span className="stats-card-label">Today</span>
              <strong className="stats-card-value">{formatListenTime(stats.todaySeconds)}</strong>
            </div>
            <div className="stats-card">
              <span className="stats-card-label">This week</span>
              <strong className="stats-card-value">{formatListenTime(stats.weekSeconds)}</strong>
            </div>
            <div className="stats-card">
              <span className="stats-card-label">This month</span>
              <strong className="stats-card-value">{formatListenTime(stats.monthSeconds)}</strong>
            </div>
            <div className="stats-card">
              <span className="stats-card-label">All time</span>
              <strong className="stats-card-value">{formatListenTime(stats.allTimeSeconds)}</strong>
              <small className="stats-card-sub">{stats.sessionCount} sessions</small>
            </div>
          </div>

          <h2 className="stats-section-title">Recent Sessions</h2>
          {stats.recentSessions.length === 0 ? (
            <p className="stats-empty-sub">No sessions recorded yet.</p>
          ) : (
            <div className="stats-session-list">
              {stats.recentSessions.map((session) => (
                <div key={session.id} className="stats-session-row">
                  <div className="stats-session-info">
                    <strong>{session.book.title}</strong>
                    <small>{session.book.author.name} · {formatDate(session.startedAt)}</small>
                  </div>
                  <span className="stats-session-dur">
                    {formatListenTime(session.secondsListened)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
