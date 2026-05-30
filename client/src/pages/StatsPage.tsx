import { useEffect, useState } from "react";
import { Headphones, Loader2 } from "lucide-react";
import api from "../api/axios";
import type { UserListeningStats } from "../features/admin/types";
import { formatListenTime } from "../features/admin/helpers";

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
        <p className="stats-subtitle">Your personal listening totals</p>
      </div>

      {loading ? (
        <div className="stats-loading">
          <Loader2 size={22} className="animate-spin" />
        </div>
      ) : !stats ? (
        <div className="stats-empty">
          <Headphones size={44} />
          <p>No sessions recorded yet. Start listening to track your stats.</p>
        </div>
      ) : (
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
      )}
    </div>
  );
}
