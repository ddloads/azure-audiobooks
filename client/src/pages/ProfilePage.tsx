import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import {
  ArrowLeft,
  BookOpen,
  Bookmark,
  Calendar,
  Check,
  CheckCircle2,
  ChevronRight,
  Clock,
  Edit3,
  Flame,
  Headphones,
  Layers,
  LogOut,
  Mail,
  Monitor,
  Play,
  Settings,
  Shield,
  Smartphone,
  Sparkles,
  Star,
  Tablet,
  Target,
  TrendingUp,
  Trophy,
} from "lucide-react";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
/* ─── types matching backend responses ─── */
interface ApiSession {
  id: string;
  startedAt: string;
  endedAt: string | null;
  secondsListened: number;
  platform: string | null;
  book: { id: string; title: string; coverPath: string | null; author: { name: string } };
}

interface ApiStats {
  todaySeconds: number;
  weekSeconds: number;
  monthSeconds: number;
  allTimeSeconds: number;
  sessionCount: number;
  recentSessions: ApiSession[];
}

interface ApiProgressBook {
  bookId: string;
  currentTime: number;
  isFinished: boolean;
  lastUpdate: string;
  book: {
    id: string;
    title: string;
    duration: number;
    coverPath: string | null;
    narrator: string | null;
    seriesId: string | null;
    sequence: number | null;
    genres: string | null;
    author: { name: string };
    series?: { id: string; name: string } | null;
  };
}

interface ApiBookmark {
  id: string;
  bookId: string;
  position: number;
  label: string | null;
  createdAt: string;
  book: { id: string; title: string; author: { name: string } };
}

/* ─── helpers ─── */
const fmtHM = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h === 0) return `${m}m`;
  return m === 0 ? `${h}h` : `${h}h ${m}m`;
};

const fmtClock = (sec: number) => {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = Math.floor(sec % 60);
  const p = (n: number) => String(n).padStart(2, "0");
  return h > 0 ? `${h}:${p(m)}:${p(s)}` : `${m}:${p(s)}`;
};

const memberSince = (iso?: string | null) => {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString(undefined, { month: "long", year: "numeric" });
};

const colorFromId = (id: string) => {
  let hash = 0;
  for (let i = 0; i < id.length; i++) hash = (hash << 5) - hash + id.charCodeAt(i);
  const palette = ["#1eafb4", "#1e7dc9", "#c98a1e", "#b41e6e", "#7d5cff", "#c9871e", "#2f7d4f", "#a4501e"];
  return palette[Math.abs(hash) % palette.length];
};

const shade = (hex: string, amt: number) => {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  const f = (c: number) => Math.max(0, Math.min(255, c + amt));
  return `#${[f(r), f(g), f(b)].map(c => c.toString(16).padStart(2, "0")).join("")}`;
};

const relativeTime = (iso: string) => {
  const diff = Date.now() - new Date(iso).getTime();
  if (diff < 60_000) return "just now";
  const m = Math.floor(diff / 60_000);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });
};

const finishedDateLabel = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { month: "short", day: "numeric" });

const platformCategory = (raw: string | null): "mobile" | "tablet" | "web" => {
  if (!raw) return "web";
  const s = raw.toLowerCase();
  if (s.includes("ipad")) return "tablet";
  if (s.includes("ios") || s.includes("android") || s.includes("iphone")) return "mobile";
  return "web";
};

const localDayKey = (iso: string) => {
  const d = new Date(iso);
  return `${d.getFullYear()}-${d.getMonth()}-${d.getDate()}`;
};

/* ─── derivations ─── */
const buildWeekBars = (sessions: ApiSession[]) => {
  const labels = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const now = new Date();
  const startOfWeek = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  startOfWeek.setDate(startOfWeek.getDate() - startOfWeek.getDay());
  const totals = [0, 0, 0, 0, 0, 0, 0];
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (d < startOfWeek) continue;
    totals[d.getDay()] += s.secondsListened;
  }
  // Display Mon..Sun for cultural neutrality but keep math simple
  const order = [1, 2, 3, 4, 5, 6, 0];
  return order.map((i) => ({ day: labels[i], sec: totals[i] }));
};

const buildTrend = (sessions: ApiSession[]) => {
  const weeks = 16;
  const buckets = new Array(weeks).fill(0) as number[];
  const now = new Date();
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfThisWeek = new Date(todayStart);
  startOfThisWeek.setDate(todayStart.getDate() - todayStart.getDay());
  for (const s of sessions) {
    const d = new Date(s.startedAt);
    if (d >= startOfThisWeek) {
      buckets[weeks - 1] += s.secondsListened;
      continue;
    }
    const diffMs = startOfThisWeek.getTime() - d.getTime();
    const weeksAgo = Math.ceil(diffMs / (7 * 24 * 60 * 60 * 1000));
    const idx = weeks - 1 - weeksAgo;
    if (idx >= 0 && idx < weeks) buckets[idx] += s.secondsListened;
  }
  return buckets.map((sec, i) => ({ week: i, hours: sec / 3600 }));
};

const buildPlatformSplit = (sessions: ApiSession[]) => {
  const totals = { web: 0, mobile: 0, tablet: 0 };
  let grand = 0;
  for (const s of sessions) {
    const key = platformCategory(s.platform);
    totals[key] += s.secondsListened;
    grand += s.secondsListened;
  }
  if (grand === 0) return [];
  const rows: Array<{ key: "web" | "mobile" | "tablet"; label: string; pct: number; color: string }> = [
    { key: "web",    label: "Web",    pct: Math.round((totals.web    / grand) * 100), color: "#38bdf8" },
    { key: "mobile", label: "Mobile", pct: Math.round((totals.mobile / grand) * 100), color: "#1f9be4" },
    { key: "tablet", label: "Tablet", pct: Math.round((totals.tablet / grand) * 100), color: "#0e4471" },
  ];
  return rows.filter((r) => r.pct > 0);
};

const computeStreak = (sessions: ApiSession[]) => {
  if (sessions.length === 0) return 0;
  const days = new Set(sessions.map((s) => localDayKey(s.startedAt)));
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const cursor = new Date(today);
  if (!days.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) {
    cursor.setDate(cursor.getDate() - 1);
    if (!days.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) return 0;
  }
  let streak = 0;
  while (days.has(`${cursor.getFullYear()}-${cursor.getMonth()}-${cursor.getDate()}`)) {
    streak++;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
};

const computeLongestStreak = (sessions: ApiSession[]) => {
  if (sessions.length === 0) return 0;
  const dayKeys = Array.from(new Set(sessions.map((s) => localDayKey(s.startedAt))))
    .map((k) => {
      const [y, m, d] = k.split("-").map(Number);
      return new Date(y, m, d).getTime();
    })
    .sort((a, b) => a - b);
  const ONE = 24 * 60 * 60 * 1000;
  let longest = 1;
  let run = 1;
  for (let i = 1; i < dayKeys.length; i++) {
    if (dayKeys[i] - dayKeys[i - 1] === ONE) {
      run++;
      if (run > longest) longest = run;
    } else {
      run = 1;
    }
  }
  return longest;
};

const buildTopAuthors = (finished: ApiProgressBook[]) => {
  const map = new Map<string, { name: string; count: number; seconds: number }>();
  for (const f of finished) {
    const key = f.book.author?.name ?? "Unknown";
    const entry = map.get(key) ?? { name: key, count: 0, seconds: 0 };
    entry.count++;
    entry.seconds += f.book.duration;
    map.set(key, entry);
  }
  return [...map.values()]
    .sort((a, b) => b.seconds - a.seconds)
    .slice(0, 4)
    .map((a) => ({ name: a.name, count: a.count, hours: Math.round(a.seconds / 3600) }));
};

const buildTopGenres = (finished: ApiProgressBook[]) => {
  const map = new Map<string, number>();
  let total = 0;
  for (const f of finished) {
    const raw = f.book.genres;
    if (!raw) continue;
    const tags = raw.split(",").map((t) => t.trim()).filter(Boolean);
    for (const tag of tags) {
      map.set(tag, (map.get(tag) ?? 0) + 1);
      total++;
    }
  }
  if (total === 0) return [];
  return [...map.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([name, count]) => ({ name, pct: Math.round((count / total) * 100) }));
};

const buildTopNarrator = (finished: ApiProgressBook[]) => {
  const map = new Map<string, { name: string; books: number; seconds: number }>();
  for (const f of finished) {
    const raw = f.book.narrator;
    if (!raw) continue;
    const first = raw.split(",")[0]?.trim();
    if (!first) continue;
    const entry = map.get(first) ?? { name: first, books: 0, seconds: 0 };
    entry.books++;
    entry.seconds += f.book.duration;
    map.set(first, entry);
  }
  const top = [...map.values()].sort((a, b) => b.seconds - a.seconds)[0];
  if (!top) return null;
  return { name: top.name, books: top.books, hours: Math.round(top.seconds / 3600) };
};

/* ─── small visual subcomponents ─── */
function Cover({
  book,
  size = 92,
  showOverlayTitle = true,
}: {
  book: { id: string; title: string; coverPath?: string | null };
  size?: number;
  showOverlayTitle?: boolean;
}) {
  const color = colorFromId(book.id);
  return (
    <div
      className="pf-cover"
      style={{
        width: size,
        height: size,
        background: `linear-gradient(155deg, ${color} 0%, ${shade(color, -34)} 100%)`,
      }}
    >
      {book.coverPath ? (
        <img src={book.coverPath} alt={book.title} loading="lazy" />
      ) : (
        showOverlayTitle && (
          <div className="pf-cover-art">
            <div className="pf-cover-tag">AUDIO</div>
            <div className="pf-cover-ttl">
              {book.title.split(":")[0].split("(")[0].slice(0, 34).trim()}
            </div>
          </div>
        )
      )}
    </div>
  );
}

function Stars({ n }: { n: number }) {
  return (
    <div className="pf-stars">
      {[1, 2, 3, 4, 5].map((i) => (
        <Star key={i} size={12} fill={i <= n ? "currentColor" : "transparent"} className={i <= n ? "" : "pf-stars-off"} />
      ))}
    </div>
  );
}

function WeekChart({ bars }: { bars: Array<{ day: string; sec: number }> }) {
  const max = Math.max(1, ...bars.map((b) => b.sec));
  const peakIdx = bars.findIndex((b) => b.sec === max);
  return (
    <div className="pf-weekbars">
      {bars.map((b, i) => (
        <div key={b.day} className={`pf-wb${i === peakIdx && b.sec > 0 ? " pf-peak" : ""}`}>
          <div className="pf-wb-val">{b.sec > 0 ? `${Math.round(b.sec / 360) / 10}h` : "—"}</div>
          <div className="pf-wb-track">
            <div className="pf-wb-fill" style={{ height: `${(b.sec / max) * 100}%` }} />
          </div>
          <div className="pf-wb-day">{b.day}</div>
        </div>
      ))}
    </div>
  );
}

function GoalRing({
  weekSeconds,
  goalSeconds,
  todaySeconds,
}: {
  weekSeconds: number;
  goalSeconds: number;
  todaySeconds: number;
}) {
  const pct = Math.min(1, weekSeconds / goalSeconds);
  const r = 56;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - pct);
  return (
    <div className="pf-ring-card">
      <div
        className="pf-ring-wrap"
        style={{ "--ring-circ": circ, "--ring-target": offset } as React.CSSProperties}
      >
        <svg width="132" height="132" viewBox="0 0 132 132">
          <defs>
            <linearGradient id="pfRingGrad" x1="0" y1="0" x2="1" y2="1">
              <stop offset="0%" stopColor="#67d3fb" />
              <stop offset="100%" stopColor="#1e7dc9" />
            </linearGradient>
          </defs>
          <circle className="pf-ring-bg" cx="66" cy="66" r={r} strokeWidth="11" />
          <circle className="pf-ring-fg" cx="66" cy="66" r={r} strokeWidth="11" />
        </svg>
        <div className="pf-ring-center">
          <div className="pf-pct">{Math.round(pct * 100)}%</div>
          <div className="pf-ring-sub">of goal</div>
        </div>
      </div>
      <div className="pf-ring-copy">
        <strong>Weekly goal</strong>
        <p>
          {fmtHM(weekSeconds)} of {fmtHM(goalSeconds)} listened this week.
        </p>
        <div className="pf-ring-mini">
          <div>
            <b>{fmtHM(todaySeconds)}</b>today
          </div>
          <div>
            <b>{Math.round((weekSeconds / 7 / 360)) / 10}h</b>daily avg
          </div>
        </div>
      </div>
    </div>
  );
}

function TrendChart({ trend }: { trend: Array<{ week: number; hours: number }> }) {
  const W = 560;
  const H = 150;
  const pad = 6;
  if (trend.length === 0 || trend.every((t) => t.hours === 0)) {
    return <div className="pf-trend-empty">No listening data yet.</div>;
  }
  const max = Math.max(...trend.map((t) => t.hours));
  const min = Math.min(...trend.map((t) => t.hours));
  const xs = (i: number) => pad + (i / (trend.length - 1)) * (W - pad * 2);
  const ys = (h: number) => H - pad - ((h - min) / (max - min || 1)) * (H - pad * 2 - 10);
  const pts = trend.map((t, i) => [xs(i), ys(t.hours)] as const);
  const line = pts.map((p, i) => `${i === 0 ? "M" : "L"}${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(" ");
  const last = pts[pts.length - 1];
  const area = `${line} L${xs(trend.length - 1).toFixed(1)},${H - pad} L${pad},${H - pad} Z`;
  return (
    <div>
      <svg className="pf-trend-svg" viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="none">
        <defs>
          <linearGradient id="pfAreaGrad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="rgba(56,189,248,.32)" />
            <stop offset="100%" stopColor="rgba(56,189,248,0)" />
          </linearGradient>
        </defs>
        <path className="pf-trend-area" d={area} />
        <path className="pf-trend-line" d={line} />
        <circle className="pf-trend-dot" cx={last[0]} cy={last[1]} r="4" />
      </svg>
      <div className="pf-trend-axis">
        <span>16 weeks ago</span>
        <span>8 weeks</span>
        <span>This week</span>
      </div>
    </div>
  );
}

function PlatformSplit({
  rows,
}: {
  rows: Array<{ key: "web" | "mobile" | "tablet"; label: string; pct: number; color: string }>;
}) {
  if (rows.length === 0) {
    return <p className="pf-empty-line">No sessions recorded yet.</p>;
  }
  const Icon = ({ k }: { k: "web" | "mobile" | "tablet" }) =>
    k === "web" ? <Monitor size={13} /> : k === "mobile" ? <Smartphone size={13} /> : <Tablet size={13} />;
  return (
    <div>
      <div className="pf-plat-bar">
        {rows.map((p) => (
          <div key={p.key} className="pf-plat-seg" style={{ width: `${p.pct}%`, background: p.color }} />
        ))}
      </div>
      <div className="pf-plat-legend">
        {rows.map((p) => (
          <div key={p.key} className="pf-plat-row">
            <span className="pf-plat-dot" style={{ background: p.color }} />
            <span className="pf-plat-nm">
              <Icon k={p.key} /> {p.label}
            </span>
            <span className="pf-plat-pc">{p.pct}%</span>
          </div>
        ))}
      </div>
    </div>
  );
}

function ContinueCard({
  record,
  onResume,
}: {
  record: ApiProgressBook;
  onResume: (b: ApiProgressBook) => void;
}) {
  const pct = Math.round((record.currentTime / record.book.duration) * 100);
  const left = Math.max(0, record.book.duration - record.currentTime);
  return (
    <div className="pf-cl" onClick={() => onResume(record)} role="button" tabIndex={0}>
      <Cover book={record.book} size={92} />
      <div className="pf-cl-body">
        {record.book.series && (
          <div className="pf-cl-series">
            {record.book.series.name}
            {record.book.sequence ? ` · Book ${record.book.sequence}` : ""}
          </div>
        )}
        <div className="pf-cl-title">{record.book.title}</div>
        <div className="pf-cl-author">{record.book.author.name}</div>
        {record.book.narrator && (
          <div className="pf-cl-narr">
            <Headphones size={11} /> {record.book.narrator}
          </div>
        )}
        <div className="pf-cl-prog">
          <div className="pf-cl-bar">
            <div style={{ width: `${pct}%` }} />
          </div>
          <div className="pf-cl-prog-meta">
            <span className="pf-cl-prog-pct">
              {pct}% · {fmtHM(left)} left
            </span>
            <span>{relativeTime(record.lastUpdate)}</span>
          </div>
        </div>
      </div>
      <button
        className="pf-cl-resume"
        title="Resume"
        onClick={(e) => {
          e.stopPropagation();
          onResume(record);
        }}
      >
        <Play size={14} fill="currentColor" />
      </button>
    </div>
  );
}

/* ────────────────────────────────────────── */
export default function ProfilePage() {
  const { user } = useAuth();
  const { playBook } = usePlayer();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [stats, setStats] = useState<ApiStats | null>(null);
  const [sessions, setSessions] = useState<ApiSession[]>([]);
  const [inProgress, setInProgress] = useState<ApiProgressBook[]>([]);
  const [finished, setFinished] = useState<ApiProgressBook[]>([]);
  const [bookmarks, setBookmarks] = useState<ApiBookmark[]>([]);
  const [loading, setLoading] = useState(true);

  // user-meta (createdAt) isn't part of AuthContext; fetch it lazily
  const [createdAt, setCreatedAt] = useState<string | null>(null);

  const cancelRef = useRef(false);
  useEffect(() => {
    cancelRef.current = false;
    setLoading(true);
    Promise.allSettled([
      api.get<ApiStats>("/sessions/stats/me"),
      api.get<ApiSession[]>("/sessions/me"),
      api.get<ApiProgressBook[]>("/progress"),
      api.get<ApiProgressBook[]>("/progress/finished"),
      api.get<ApiBookmark[]>("/bookmarks"),
      api.get<{ createdAt?: string }>("/auth/me"),
    ]).then((results) => {
      if (cancelRef.current) return;
      const [statsR, sessionsR, progressR, finishedR, bookmarksR, meR] = results;
      if (statsR.status === "fulfilled") setStats(statsR.value.data);
      if (sessionsR.status === "fulfilled") setSessions(sessionsR.value.data);
      if (progressR.status === "fulfilled") setInProgress(progressR.value.data);
      if (finishedR.status === "fulfilled") setFinished(finishedR.value.data);
      if (bookmarksR.status === "fulfilled") setBookmarks(bookmarksR.value.data);
      if (meR.status === "fulfilled") setCreatedAt(meR.value.data?.createdAt ?? null);
      setLoading(false);
    });
    return () => {
      cancelRef.current = true;
    };
  }, []);

  const weekBars = useMemo(() => buildWeekBars(sessions), [sessions]);
  const trend = useMemo(() => buildTrend(sessions), [sessions]);
  const platforms = useMemo(() => buildPlatformSplit(sessions), [sessions]);
  const streak = useMemo(() => computeStreak(sessions), [sessions]);
  const longestStreak = useMemo(() => computeLongestStreak(sessions), [sessions]);
  const topAuthors = useMemo(() => buildTopAuthors(finished), [finished]);
  const topGenres = useMemo(() => buildTopGenres(finished), [finished]);
  const topNarrator = useMemo(() => buildTopNarrator(finished), [finished]);

  const totalHours = stats ? Math.round(stats.allTimeSeconds / 3600) : 0;
  const booksFinished = finished.length;
  const inProgressCount = inProgress.length;
  const bookmarkCount = bookmarks.length;
  const weeklyGoalSeconds = 36000; // 10 h/week — a sane default for the goal ring

  const monogram = (user?.username ?? "?").charAt(0).toUpperCase();

  const handleResume = async (record: ApiProgressBook) => {
    try {
      const bookRes = await api.get(`/library/${record.bookId}`);
      playBook(bookRes.data, record.currentTime);
    } catch {
      showToast({ title: "Could not start playback", tone: "error" });
    }
  };

  const handlePlayBookmark = async (bm: ApiBookmark) => {
    try {
      const bookRes = await api.get(`/library/${bm.bookId}`);
      playBook(bookRes.data, bm.position);
    } catch {
      showToast({ title: "Could not start playback", tone: "error" });
    }
  };

  const handlePlayFinished = async (record: ApiProgressBook) => {
    try {
      const bookRes = await api.get(`/library/${record.bookId}`);
      playBook(bookRes.data, 0);
    } catch {
      showToast({ title: "Could not start playback", tone: "error" });
    }
  };

  const milestones = useMemo(() => {
    const hours = totalHours;
    const items = [
      { id: "m1", label: "100 hours listened", sub: "All-time", reached: hours >= 100, icon: "clock" as const, progress: Math.min(1, hours / 100) },
      { id: "m2", label: "Finished 10 books",  sub: "Library",  reached: booksFinished >= 10, icon: "check" as const, progress: Math.min(1, booksFinished / 10) },
      { id: "m3", label: "7-day streak",       sub: streak >= 7 ? "Earned" : `${Math.max(0, 7 - streak)} days to go`, reached: streak >= 7, icon: "flame" as const, progress: Math.min(1, streak / 7) },
      { id: "m4", label: "30-day streak",      sub: streak >= 30 ? "Earned" : `${Math.max(0, 30 - streak)} days to go`, reached: streak >= 30, icon: "trophy" as const, progress: Math.min(1, streak / 30) },
    ];
    return items;
  }, [totalHours, booksFinished, streak]);

  if (!user) return null;

  return (
    <div className="profile-page">
      <style dangerouslySetInnerHTML={{ __html: pageCss }} />

      <div className="pf-wrap">
        {/* ── back / breadcrumb (lightweight; UnifiedShell still owns the topbar) ── */}
        <div className="pf-pagenav">
          <Link to="/" className="pf-pagenav-back" title="Back to library">
            <ArrowLeft size={16} />
          </Link>
          <span className="pf-pagenav-crumb">
            <b>Profile</b>
          </span>
          <div className="pf-pagenav-spacer" />
          <Link to="/account" state={{ from: "/profile" }} className="pf-pagenav-link">
            <Settings size={14} /> Settings
          </Link>
        </div>

        {/* ── HERO ── */}
        <header className="pf-hero">
          <div className="pf-hero-cover" />
          <div className="pf-hero-body">
            <div className="pf-avatar">
              <div className="pf-avatar-ring" />
              {user.avatarUrl ? <img src={user.avatarUrl} alt="" /> : <span className="pf-avatar-mono">{monogram}</span>}
            </div>
            <div className="pf-hero-id">
              <span className={`pf-hero-role ${user.role === "ADMIN" ? "pf-role-admin" : "pf-role-user"}`}>
                {user.role === "ADMIN" ? <Shield size={11} /> : <Headphones size={11} />}{" "}
                {user.role === "ADMIN" ? "Administrator" : "Listener"}
              </span>
              <h1 className="pf-hero-name">{user.username}</h1>
              <div className="pf-hero-handle">
                @{user.username}
                {user.email && (
                  <>
                    {" · "}
                    <span className="pf-mono">{user.email}</span>
                  </>
                )}
              </div>
              <div className="pf-hero-meta">
                <span className="pf-hero-meta-item">
                  <Calendar size={12} /> <span>Member since {memberSince(createdAt)}</span>
                </span>
                {stats && (
                  <span className="pf-hero-meta-item">
                    <Headphones size={12} /> <span>{stats.sessionCount} sessions</span>
                  </span>
                )}
                <span className="pf-hero-meta-item">
                  <Flame size={12} /> <span>{streak}-day streak</span>
                </span>
              </div>
            </div>
            <div className="pf-hero-actions">
              <button
                className="pf-btn pf-btn-ghost"
                onClick={() => navigate("/account", { state: { from: "/profile" } })}
              >
                <Edit3 size={14} /> Edit profile
              </button>
              {inProgress[0] && (
                <button className="pf-btn pf-btn-primary" onClick={() => handleResume(inProgress[0])}>
                  <Play size={14} fill="currentColor" /> Resume listening
                </button>
              )}
            </div>
          </div>
          <div className="pf-hero-stats">
            <div className="pf-hero-stat">
              <div className="pf-hero-stat-v">
                {totalHours}
                <span className="pf-hero-stat-u">hours</span>
              </div>
              <div className="pf-hero-stat-l">
                <Clock size={12} /> Total listened
              </div>
            </div>
            <div className="pf-hero-stat">
              <div className="pf-hero-stat-v">
                {booksFinished}
                <span className="pf-hero-stat-u">books</span>
              </div>
              <div className="pf-hero-stat-l">
                <CheckCircle2 size={12} /> Finished
              </div>
            </div>
            <div className="pf-hero-stat pf-hero-stat-flame">
              <div className="pf-hero-stat-v">
                {streak}
                <span className="pf-hero-stat-u">days</span>
              </div>
              <div className="pf-hero-stat-l">
                <Flame size={12} /> Current streak
              </div>
            </div>
          </div>
        </header>

        {/* ── LISTENING ACTIVITY ── */}
        <section className="pf-sec">
          <div className="pf-sec-head">
            <span className="pf-sec-ico">
              <TrendingUp size={16} />
            </span>
            <h2>Listening activity</h2>
          </div>
          <div className="pf-dash">
            <div className="pf-card pf-panel">
              <div className="pf-panel-head">
                <div>
                  <div className="pf-panel-title">This week</div>
                  <div className="pf-panel-big">{stats ? fmtHM(stats.weekSeconds) : "—"}</div>
                </div>
                {stats && (
                  <span
                    className={`pf-goal-tag${stats.weekSeconds < weeklyGoalSeconds ? " pf-goal-under" : ""}`}
                  >
                    <Target size={12} />{" "}
                    <span>{Math.round((stats.weekSeconds / weeklyGoalSeconds) * 100)}% of goal</span>
                  </span>
                )}
              </div>
              <WeekChart bars={weekBars} />
            </div>
            <div className="pf-card pf-panel">
              <GoalRing
                weekSeconds={stats?.weekSeconds ?? 0}
                goalSeconds={weeklyGoalSeconds}
                todaySeconds={stats?.todaySeconds ?? 0}
              />
            </div>
          </div>
        </section>

        {/* ── STAT CHIPS ── */}
        <section className="pf-sec">
          <div className="pf-statgrid">
            <div className="pf-card pf-statchip">
              <div className="pf-statchip-ic">
                <Clock size={16} />
              </div>
              <div className="pf-statchip-v">{stats ? fmtHM(stats.todaySeconds) : "—"}</div>
              <div className="pf-statchip-l">Listened today</div>
            </div>
            <div className="pf-card pf-statchip pf-statchip-green">
              <div className="pf-statchip-ic">
                <Headphones size={16} />
              </div>
              <div className="pf-statchip-v">{stats ? fmtHM(stats.monthSeconds) : "—"}</div>
              <div className="pf-statchip-l">This month</div>
            </div>
            <div className="pf-card pf-statchip pf-statchip-amber">
              <div className="pf-statchip-ic">
                <Flame size={16} />
              </div>
              <div className="pf-statchip-v">
                {longestStreak}
                <span className="pf-statchip-u">days</span>
              </div>
              <div className="pf-statchip-l">Longest streak</div>
            </div>
            <div className="pf-card pf-statchip pf-statchip-gold">
              <div className="pf-statchip-ic">
                <Bookmark size={16} />
              </div>
              <div className="pf-statchip-v">{bookmarkCount}</div>
              <div className="pf-statchip-l">Bookmarks saved</div>
            </div>
          </div>
        </section>

        {/* ── TREND + PLATFORM ── */}
        <section className="pf-sec">
          <div className="pf-dash">
            <div className="pf-card pf-trend-card">
              <div className="pf-panel-head">
                <div>
                  <div className="pf-panel-title">16-week trend</div>
                  <div className="pf-panel-big">
                    {Math.round(((stats?.monthSeconds ?? 0) / 3600) / 4)}
                    <span className="pf-panel-big-u">h / wk avg</span>
                  </div>
                </div>
              </div>
              <TrendChart trend={trend} />
            </div>
            <div className="pf-card pf-plat-card">
              <div className="pf-panel-head">
                <div className="pf-panel-title">Where you listen</div>
              </div>
              <PlatformSplit rows={platforms} />
            </div>
          </div>
        </section>

        {/* ── CONTINUE LISTENING ── */}
        {inProgress.length > 0 && (
          <section className="pf-sec">
            <div className="pf-sec-head">
              <span className="pf-sec-ico">
                <Play size={14} fill="currentColor" />
              </span>
              <h2>Continue listening</h2>
              <span className="pf-sec-count">{inProgressCount} in progress</span>
              <span className="pf-sec-spacer" />
              <Link to="/library" className="pf-sec-more">
                Library <ChevronRight size={13} />
              </Link>
            </div>
            <div className="pf-shelf">
              {inProgress.map((b) => (
                <ContinueCard key={b.bookId} record={b} onResume={handleResume} />
              ))}
            </div>
          </section>
        )}

        {/* ── FINISHED + BOOKMARKS ── */}
        <section className="pf-sec">
          <div className="pf-twocol">
            <div>
              <div className="pf-sec-head">
                <span className="pf-sec-ico">
                  <CheckCircle2 size={14} />
                </span>
                <h2>Recently finished</h2>
                <span className="pf-sec-spacer" />
                <Link to="/history" className="pf-sec-more">
                  All {booksFinished} <ChevronRight size={13} />
                </Link>
              </div>
              <div className="pf-card pf-list">
                {finished.length === 0 && (
                  <p className="pf-empty-line">No finished books yet — keep listening.</p>
                )}
                {finished.slice(0, 6).map((record) => (
                  <div key={record.bookId} className="pf-li" onClick={() => navigate(`/book/${record.bookId}`)}>
                    <Cover book={record.book} size={44} showOverlayTitle={false} />
                    <div className="pf-li-body">
                      <div className="pf-li-title">{record.book.title}</div>
                      <div className="pf-li-sub">
                        {record.book.author.name}
                        {record.book.series && (
                          <>
                            <span className="pf-sep">·</span>
                            {record.book.series.name}
                          </>
                        )}
                      </div>
                    </div>
                    <div className="pf-li-right">
                      <Stars n={5} />
                      <span className="pf-li-when">Finished {finishedDateLabel(record.lastUpdate)}</span>
                    </div>
                    <button
                      className="pf-li-play"
                      title="Play again"
                      onClick={(e) => {
                        e.stopPropagation();
                        void handlePlayFinished(record);
                      }}
                    >
                      <Play size={12} fill="currentColor" />
                    </button>
                  </div>
                ))}
              </div>
            </div>
            <div>
              <div className="pf-sec-head">
                <span className="pf-sec-ico">
                  <Bookmark size={14} />
                </span>
                <h2>Bookmarks</h2>
                <span className="pf-sec-spacer" />
                {bookmarks.length > 0 && (
                  <span className="pf-sec-more pf-sec-more-static">
                    All {bookmarkCount}
                  </span>
                )}
              </div>
              <div className="pf-card pf-list">
                {bookmarks.length === 0 && (
                  <p className="pf-empty-line">No bookmarks yet. Tap the bookmark icon in the player to save a spot.</p>
                )}
                {bookmarks.slice(0, 6).map((bm) => (
                  <div
                    key={bm.id}
                    className="pf-bm"
                    onClick={() => void handlePlayBookmark(bm)}
                    role="button"
                    tabIndex={0}
                  >
                    <div className="pf-bm-tick" />
                    <div className="pf-bm-body">
                      <div className="pf-bm-label">{bm.label || "Untitled bookmark"}</div>
                      <div className="pf-bm-meta">
                        <span className="pf-bm-pos">{fmtClock(bm.position)}</span>
                        <span>{bm.book.title}</span>
                        <span className="pf-sep">·</span>
                        <span>{relativeTime(bm.createdAt)}</span>
                      </div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        </section>

        {/* ── INSIGHTS ── */}
        {(topAuthors.length > 0 || topGenres.length > 0 || topNarrator) && (
          <section className="pf-sec">
            <div className="pf-sec-head">
              <span className="pf-sec-ico">
                <Sparkles size={14} />
              </span>
              <h2>Your listening taste</h2>
            </div>
            <div className="pf-insights">
              <div className="pf-card pf-ins-card">
                <div className="pf-ins-title">
                  <BookOpen size={13} /> Top authors
                </div>
                {topAuthors.length === 0 ? (
                  <p className="pf-empty-line">Finish a book to see your top authors.</p>
                ) : (
                  topAuthors.map((a, i) => (
                    <div key={a.name} className="pf-author-row">
                      <span className="pf-author-rank">{i + 1}</span>
                      <div className="pf-author-info">
                        <div className="pf-author-name">{a.name}</div>
                        <div className="pf-author-sub">{a.count} books</div>
                      </div>
                      <span className="pf-author-hrs">{a.hours}h</span>
                    </div>
                  ))
                )}
              </div>
              <div className="pf-card pf-ins-card">
                <div className="pf-ins-title">
                  <Layers size={13} /> By genre
                </div>
                {topGenres.length === 0 ? (
                  <p className="pf-empty-line">Books need tagged genres to populate this chart.</p>
                ) : (
                  topGenres.map((g) => (
                    <div key={g.name} className="pf-genre-row">
                      <div className="pf-genre-top">
                        <span className="pf-genre-name">{g.name}</span>
                        <span className="pf-genre-pct">{g.pct}%</span>
                      </div>
                      <div className="pf-genre-bar">
                        <div style={{ width: `${g.pct}%` }} />
                      </div>
                    </div>
                  ))
                )}
              </div>
              <div className="pf-card pf-ins-card">
                <div className="pf-ins-title">
                  <Headphones size={13} /> Most-heard narrator
                </div>
                {!topNarrator ? (
                  <p className="pf-empty-line">No narrator data yet.</p>
                ) : (
                  <div className="pf-narr-feature">
                    <div className="pf-narr-av">
                      <Headphones size={22} />
                    </div>
                    <div className="pf-narr-name">{topNarrator.name}</div>
                    <div className="pf-narr-sub">Your go-to voice</div>
                    <div className="pf-narr-stats">
                      <div>
                        <b>{topNarrator.books}</b>books
                      </div>
                      <div>
                        <b>{topNarrator.hours}h</b>narrated
                      </div>
                    </div>
                  </div>
                )}
              </div>
            </div>
          </section>
        )}

        {/* ── MILESTONES ── */}
        <section className="pf-sec">
          <div className="pf-sec-head">
            <span className="pf-sec-ico">
              <Trophy size={14} />
            </span>
            <h2>Milestones</h2>
          </div>
          <div className="pf-miles">
            {milestones.map((m) => {
              const Ic =
                m.icon === "clock" ? Clock : m.icon === "check" ? Check : m.icon === "flame" ? Flame : Trophy;
              return (
                <div key={m.id} className={`pf-card pf-mile${m.reached ? " pf-mile-done" : " pf-mile-locked"}`}>
                  {m.reached && (
                    <span className="pf-mile-badge">
                      <CheckCircle2 size={14} />
                    </span>
                  )}
                  <div className="pf-mile-ic">
                    <Ic size={18} />
                  </div>
                  <div>
                    <div className="pf-mile-label">{m.label}</div>
                    <div className="pf-mile-sub">{m.sub}</div>
                  </div>
                  {!m.reached && (
                    <div className="pf-mile-prog">
                      <div style={{ width: `${Math.round(m.progress * 100)}%` }} />
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        </section>

        {/* ── ACCOUNT QUICK LINKS ── */}
        <section className="pf-sec">
          <div className="pf-sec-head">
            <span className="pf-sec-ico">
              <Settings size={14} />
            </span>
            <h2>Account</h2>
          </div>
          <div className="pf-acct">
            <div className="pf-card pf-acct-rows">
              <div className="pf-acct-row">
                <span className="pf-acct-ic">
                  <Headphones size={14} />
                </span>
                <div className="pf-acct-body">
                  <div className="pf-acct-k">Username</div>
                  <div className="pf-acct-val">@{user.username}</div>
                </div>
                <Link to="/account" state={{ from: "/profile" }} className="pf-acct-act">
                  Edit
                </Link>
              </div>
              <div className="pf-acct-row">
                <span className="pf-acct-ic">
                  <Mail size={14} />
                </span>
                <div className="pf-acct-body">
                  <div className="pf-acct-k">Email</div>
                  <div className="pf-acct-val">{user.email || "Not set"}</div>
                </div>
                <Link to="/account" state={{ from: "/profile" }} className="pf-acct-act">
                  Edit
                </Link>
              </div>
              <div className="pf-acct-row">
                <span className="pf-acct-ic">
                  <Shield size={14} />
                </span>
                <div className="pf-acct-body">
                  <div className="pf-acct-k">Password</div>
                  <div className="pf-acct-val">••••••••••</div>
                </div>
                <Link to="/account" state={{ from: "/profile" }} className="pf-acct-act">
                  Change
                </Link>
              </div>
              <div className="pf-acct-row">
                <span className="pf-acct-ic">
                  <Settings size={14} />
                </span>
                <div className="pf-acct-body">
                  <div className="pf-acct-k">Role &amp; user ID</div>
                  <div className="pf-acct-val pf-mono">{user.role} · {user.id.slice(0, 13)}…</div>
                </div>
              </div>
            </div>
            <div className="pf-card pf-acct-side">
              <p className="pf-acct-side-title">Quick links</p>
              <Link to="/history" className="pf-acct-side-link">
                <CheckCircle2 size={14} /> Listening history
              </Link>
              <Link to="/stats" className="pf-acct-side-link">
                <Headphones size={14} /> Listening stats
              </Link>
              <Link to="/account" state={{ from: "/profile" }} className="pf-acct-side-link">
                <Settings size={14} /> Account settings
              </Link>
              <button
                className="pf-btn pf-btn-danger"
                onClick={() => {
                  showToast({ title: "Use the menu to sign out", tone: "info" });
                }}
              >
                <LogOut size={14} /> Sign out
              </button>
            </div>
          </div>
        </section>

        {loading && (
          <div className="pf-loading-overlay" aria-hidden="true">
            <div className="pf-loading-bar" />
          </div>
        )}
      </div>
    </div>
  );
}

/* ────────────────────────────────────────── */
/* All page CSS, scoped under .profile-page    */
const pageCss = `
.profile-page { color: var(--text); }
.profile-page .pf-wrap { max-width: 1240px; margin: 0 auto; padding: 0 28px 120px; position: relative; }

.profile-page .pf-pagenav { display:flex; align-items:center; gap:12px; padding: 12px 0 18px; }
.profile-page .pf-pagenav-back { width:34px; height:34px; border-radius: var(--radius); background: rgba(255,255,255,.04); border:1px solid var(--border); color: var(--text-muted); display:grid; place-items:center; transition: 140ms; }
.profile-page .pf-pagenav-back:hover { background: var(--card-hover); color: var(--text); border-color: var(--border-strong); }
.profile-page .pf-pagenav-crumb { color: var(--text-subtle); font-size: 13px; }
.profile-page .pf-pagenav-crumb b { color: var(--text-muted); font-weight: 500; }
.profile-page .pf-pagenav-spacer { flex:1; }
.profile-page .pf-pagenav-link { display:inline-flex; align-items:center; gap:8px; padding: 8px 14px; border-radius: var(--radius); font-size: 13px; font-weight: 500; color: var(--text-muted); background: rgba(255,255,255,.04); border:1px solid var(--border); transition: 140ms; }
.profile-page .pf-pagenav-link:hover { color: var(--text); background: var(--card-hover); border-color: var(--border-strong); }

/* hero */
.profile-page .pf-hero { position: relative; border-radius: var(--radius-xl); overflow: hidden; border:1px solid var(--border); background:
  linear-gradient(160deg, rgba(56,189,248,.12), transparent 42%),
  linear-gradient(180deg, var(--card-bg), var(--bg-1));
  box-shadow: var(--shadow); }
.profile-page .pf-hero-cover { position:absolute; inset:0; opacity:.5; background:
  radial-gradient(680px 280px at 12% -30%, rgba(56,189,248,.35), transparent 70%),
  radial-gradient(520px 300px at 88% 0%, rgba(30,125,201,.30), transparent 70%); pointer-events:none; }
.profile-page .pf-hero-body { position: relative; display:flex; align-items:flex-end; gap: 26px; padding: 38px 36px 30px; flex-wrap: wrap; }
.profile-page .pf-avatar { width: 112px; height: 112px; border-radius: 26px; flex-shrink:0; display:grid; place-items:center; font-family: var(--font-display); font-weight: 600; font-size: 46px; color: #052338; background: var(--grad-accent); box-shadow: 0 12px 36px -8px rgba(56,189,248,.6), inset 0 2px 0 rgba(255,255,255,.4); position: relative; overflow:hidden; }
.profile-page .pf-avatar img { width:100%; height:100%; object-fit: cover; }
.profile-page .pf-avatar-mono { font-family: var(--font-display); font-weight: 600; font-size: 46px; }
.profile-page .pf-avatar-ring { position:absolute; inset:-4px; border-radius: 30px; border: 2px solid rgba(56,189,248,.4); }
.profile-page .pf-hero-id { flex:1; min-width: 240px; }
.profile-page .pf-hero-role { display:inline-flex; align-items:center; gap:6px; font-size: 11px; letter-spacing: .12em; text-transform: uppercase; font-weight: 700; padding: 4px 10px; border-radius: 999px; margin-bottom: 12px; }
.profile-page .pf-role-admin { color: var(--gold, #f5c563); background: rgba(245,197,99,.12); border:1px solid rgba(245,197,99,.3); }
.profile-page .pf-role-user  { color: var(--accent); background: var(--primary-subtle); border:1px solid rgba(56,189,248,.3); }
.profile-page .pf-hero-name { font-family: var(--font-display); font-weight: 600; font-size: 40px; line-height: 1.05; letter-spacing: -.02em; margin: 0; }
.profile-page .pf-hero-handle { color: var(--text-muted); font-size: 15px; margin-top: 4px; word-break: break-all; }
.profile-page .pf-mono { font-family: var(--font-mono); font-size: 13px; color: var(--text-subtle); }
.profile-page .pf-hero-meta { display:flex; gap: 18px; margin-top: 14px; flex-wrap: wrap; }
.profile-page .pf-hero-meta-item { display:inline-flex; align-items:center; gap:7px; font-size: 13px; color: var(--text-muted); }
.profile-page .pf-hero-meta-item svg { color: var(--text-subtle); }
.profile-page .pf-hero-actions { display:flex; gap:10px; align-self: flex-start; margin-left: auto; flex-wrap: wrap; }

.profile-page .pf-hero-stats { position: relative; display:grid; grid-template-columns: repeat(3, 1fr); border-top:1px solid var(--border); }
.profile-page .pf-hero-stat { padding: 20px 36px; border-right:1px solid var(--border); }
.profile-page .pf-hero-stat:last-child { border-right:0; }
.profile-page .pf-hero-stat-v { font-family: var(--font-display); font-weight: 600; font-size: 30px; line-height: 1; letter-spacing: -.01em; }
.profile-page .pf-hero-stat-u { font-size: 16px; color: var(--text-subtle); font-weight: 500; margin-left: 3px; font-family: var(--font-sans); }
.profile-page .pf-hero-stat-l { font-size: 12px; color: var(--text-subtle); letter-spacing: .08em; text-transform: uppercase; margin-top: 7px; display:flex; align-items:center; gap:6px; }
.profile-page .pf-hero-stat-flame .pf-hero-stat-v { color: #fb923c; }

/* buttons */
.profile-page .pf-btn { display:inline-flex; align-items:center; justify-content:center; gap:8px; font-size:13px; font-weight:600; padding: 0 16px; height: 40px; border-radius: var(--radius); border:1px solid transparent; transition: 140ms; line-height: 1; cursor: pointer; font-family: inherit; }
.profile-page .pf-btn-primary { background: var(--grad-primary); color: #042134; box-shadow: var(--shadow-primary); }
.profile-page .pf-btn-primary:hover { filter: brightness(1.07); transform: translateY(-1px); }
.profile-page .pf-btn-ghost { background: rgba(255,255,255,.05); border-color: var(--border); color: var(--text-muted); }
.profile-page .pf-btn-ghost:hover { background: var(--card-hover); color: var(--text); border-color: var(--border-strong); }
.profile-page .pf-btn-danger { background: rgba(239,68,68,.1); border-color: rgba(239,68,68,.28); color: #fca5a5; width:100%; margin-top: 14px; }
.profile-page .pf-btn-danger:hover { background: rgba(239,68,68,.18); color:#fff; }

/* section scaffold */
.profile-page .pf-sec { margin-top: 30px; }
.profile-page .pf-sec-head { display:flex; align-items:center; gap: 12px; margin-bottom: 16px; }
.profile-page .pf-sec-head h2 { font-family: var(--font-display); font-weight: 600; font-size: 21px; letter-spacing: -.01em; margin:0; white-space: nowrap; }
.profile-page .pf-sec-ico { width: 30px; height: 30px; border-radius: 9px; display:grid; place-items:center; background: var(--primary-subtle); color: var(--accent); flex-shrink:0; }
.profile-page .pf-sec-count { font-size: 12px; color: var(--text-subtle); background: rgba(255,255,255,.04); border:1px solid var(--border); padding: 3px 9px; border-radius: 999px; font-variant-numeric: tabular-nums; }
.profile-page .pf-sec-spacer { flex:1; }
.profile-page .pf-sec-more { font-size: 13px; color: var(--text-muted); display:inline-flex; align-items:center; gap: 4px; }
.profile-page .pf-sec-more:hover { color: var(--accent); }
.profile-page .pf-sec-more-static { background: rgba(255,255,255,.04); padding: 3px 9px; border-radius: 999px; border:1px solid var(--border); font-variant-numeric: tabular-nums; font-size: 12px; }

.profile-page .pf-card { background: var(--card-bg); border:1px solid var(--border); border-radius: var(--radius-lg); box-shadow: var(--shadow); }

/* dashboard grid */
.profile-page .pf-dash { display:grid; grid-template-columns: 1.45fr 1fr; gap: 18px; }
@media (max-width: 1023px) { .profile-page .pf-dash { grid-template-columns: 1fr; } }

.profile-page .pf-panel { padding: 22px 24px; }
.profile-page .pf-panel-head { display:flex; align-items:baseline; justify-content:space-between; margin-bottom: 18px; gap: 16px; }
.profile-page .pf-panel-title { font-size: 13px; color: var(--text-subtle); letter-spacing: .08em; text-transform: uppercase; font-weight: 600; }
.profile-page .pf-panel-big { font-family: var(--font-display); font-weight: 600; font-size: 26px; letter-spacing: -.01em; }
.profile-page .pf-panel-big-u { font-size: 15px; color: var(--text-subtle); font-weight: 500; font-family: var(--font-sans); margin-left: 2px; }
.profile-page .pf-goal-tag { font-size: 12px; color: #4ade80; display:inline-flex; align-items:center; gap:5px; font-weight: 600; white-space: nowrap; }
.profile-page .pf-goal-under { color: var(--text-muted); }

/* week bars */
.profile-page .pf-weekbars { display:grid; grid-template-columns: repeat(7, 1fr); gap: 10px; align-items: end; height: 150px; margin-top: 6px; }
.profile-page .pf-wb { display:flex; flex-direction:column; align-items:center; gap: 8px; height:100%; justify-content:flex-end; }
.profile-page .pf-wb-track { width: 100%; flex:1; display:flex; align-items:flex-end; border-radius: 7px; background: rgba(255,255,255,.03); overflow: hidden; }
.profile-page .pf-wb-fill { width:100%; border-radius: 7px 7px 0 0; background: var(--grad-primary); position: relative; }
.profile-page .pf-peak .pf-wb-fill { background: linear-gradient(180deg, #67d3fb, #38bdf8); box-shadow: 0 0 16px rgba(56,189,248,.5); }
.profile-page .pf-wb-day { font-size: 11px; color: var(--text-subtle); font-weight: 500; }
.profile-page .pf-wb-val { font-size: 10.5px; color: var(--text-muted); font-family: var(--font-mono); }
.profile-page .pf-peak .pf-wb-day, .profile-page .pf-peak .pf-wb-val { color: var(--accent); }

/* goal ring */
.profile-page .pf-ring-card { display:flex; align-items:center; gap: 22px; }
.profile-page .pf-ring-wrap { position: relative; width: 132px; height: 132px; flex-shrink:0; }
.profile-page .pf-ring-wrap svg { transform: rotate(-90deg); }
.profile-page .pf-ring-bg { fill:none; stroke: rgba(255,255,255,.06); }
.profile-page .pf-ring-fg { fill:none; stroke: url(#pfRingGrad); stroke-linecap: round; stroke-dasharray: var(--ring-circ); stroke-dashoffset: var(--ring-target); transition: stroke-dashoffset .9s cubic-bezier(.3,.8,.3,1); }
.profile-page .pf-ring-center { position:absolute; inset:0; display:flex; flex-direction:column; align-items:center; justify-content:center; }
.profile-page .pf-pct { font-family: var(--font-display); font-weight: 600; font-size: 26px; line-height:1; }
.profile-page .pf-ring-sub { font-size: 10.5px; color: var(--text-subtle); margin-top: 3px; letter-spacing:.06em; text-transform:uppercase; }
.profile-page .pf-ring-copy strong { display:block; font-family: var(--font-display); font-weight:600; font-size: 17px; margin-bottom: 4px; }
.profile-page .pf-ring-copy p { font-size: 13px; color: var(--text-muted); line-height: 1.5; }
.profile-page .pf-ring-mini { margin-top: 12px; display:flex; gap: 16px; }
.profile-page .pf-ring-mini div { font-size: 12px; color: var(--text-subtle); }
.profile-page .pf-ring-mini b { display:block; font-size: 17px; color: var(--text); font-family: var(--font-display); font-weight:600; }

/* stat chips */
.profile-page .pf-statgrid { display:grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 860px) { .profile-page .pf-statgrid { grid-template-columns: repeat(2, 1fr); } }
.profile-page .pf-statchip { padding: 18px; position: relative; overflow: hidden; }
.profile-page .pf-statchip-ic { width: 34px; height: 34px; border-radius: 9px; display:grid; place-items:center; background: var(--primary-subtle); color: var(--accent); margin-bottom: 14px; }
.profile-page .pf-statchip-amber .pf-statchip-ic { background: rgba(251,146,60,.13); color: #fb923c; }
.profile-page .pf-statchip-green .pf-statchip-ic { background: rgba(74,222,128,.12); color: #4ade80; }
.profile-page .pf-statchip-gold .pf-statchip-ic { background: rgba(245,197,99,.13); color: #f5c563; }
.profile-page .pf-statchip-v { font-family: var(--font-display); font-weight: 600; font-size: 27px; line-height: 1; letter-spacing: -.01em; }
.profile-page .pf-statchip-u { font-size: 14px; color: var(--text-subtle); font-weight: 500; font-family: var(--font-sans); margin-left: 2px; }
.profile-page .pf-statchip-l { font-size: 12.5px; color: var(--text-muted); margin-top: 8px; }

/* trend chart */
.profile-page .pf-trend-card { padding: 22px 24px; }
.profile-page .pf-trend-svg { width:100%; height: 150px; display:block; margin-top: 4px; overflow: visible; }
.profile-page .pf-trend-area { fill: url(#pfAreaGrad); }
.profile-page .pf-trend-line { fill:none; stroke: var(--accent); stroke-width: 2.4; stroke-linecap: round; stroke-linejoin: round; }
.profile-page .pf-trend-dot { fill: var(--bg); stroke: var(--accent); stroke-width: 2.4; }
.profile-page .pf-trend-axis { display:flex; justify-content: space-between; margin-top: 10px; font-size: 11px; color: var(--text-subtle); }
.profile-page .pf-trend-empty { height: 150px; display:grid; place-items:center; color: var(--text-subtle); font-size: 13px; }

/* platform split */
.profile-page .pf-plat-card { padding: 22px 24px; }
.profile-page .pf-plat-bar { display:flex; height: 16px; border-radius: 999px; overflow:hidden; margin: 4px 0 18px; gap:2px; }
.profile-page .pf-plat-seg { height:100%; transition: 200ms; }
.profile-page .pf-plat-seg:first-child { border-radius: 999px 0 0 999px; }
.profile-page .pf-plat-seg:last-child { border-radius: 0 999px 999px 0; }
.profile-page .pf-plat-legend { display:flex; flex-direction: column; gap: 12px; }
.profile-page .pf-plat-row { display:flex; align-items:center; gap: 10px; font-size: 13px; }
.profile-page .pf-plat-dot { width: 9px; height: 9px; border-radius: 3px; flex-shrink:0; }
.profile-page .pf-plat-nm { color: var(--text-muted); display:inline-flex; align-items:center; gap:7px; }
.profile-page .pf-plat-nm svg { color: var(--text-subtle); }
.profile-page .pf-plat-pc { margin-left:auto; font-family: var(--font-mono); font-weight: 600; color: var(--text); }

/* continue listening shelf */
.profile-page .pf-shelf { display:grid; grid-template-columns: repeat(2, 1fr); gap: 14px; }
@media (max-width: 720px) { .profile-page .pf-shelf { grid-template-columns: 1fr; } }
.profile-page .pf-cl { display:flex; gap: 16px; padding: 16px; border-radius: var(--radius-lg); background: var(--card-bg); border:1px solid var(--border); transition: 160ms; position: relative; overflow:hidden; cursor: pointer; }
.profile-page .pf-cl:hover { border-color: var(--border-strong); background: var(--card-hover); transform: translateY(-2px); box-shadow: var(--shadow); }
.profile-page .pf-cover { border-radius: var(--radius); overflow:hidden; flex-shrink:0; position: relative; box-shadow: 0 8px 22px -8px rgba(0,0,0,.7); }
.profile-page .pf-cover img { width:100%; height:100%; object-fit: cover; display:block; }
.profile-page .pf-cover-art { position:absolute; inset:0; display:flex; flex-direction:column; justify-content:flex-end; padding: 9px; }
.profile-page .pf-cover-ttl { font-family: var(--font-display); font-weight: 700; font-size: 11px; line-height: 1.12; color: #fff; text-shadow: 0 1px 4px rgba(0,0,0,.55); }
.profile-page .pf-cover-tag { position:absolute; top:7px; left:8px; font-family: var(--font-mono); font-size: 8px; letter-spacing:.14em; color: rgba(255,255,255,.65); }
.profile-page .pf-cl-body { flex:1; min-width:0; display:flex; flex-direction:column; }
.profile-page .pf-cl-series { font-size: 11px; color: var(--accent); font-weight: 600; letter-spacing:.03em; }
.profile-page .pf-cl-title { font-family: var(--font-display); font-weight: 600; font-size: 16px; line-height: 1.2; margin: 3px 0 2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-page .pf-cl-author { font-size: 12.5px; color: var(--text-muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-page .pf-cl-narr { font-size: 11.5px; color: var(--text-subtle); margin-top: 1px; display:flex; align-items:center; gap:5px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-page .pf-cl-prog { margin-top: auto; padding-top: 12px; }
.profile-page .pf-cl-bar { height: 5px; border-radius: 999px; background: rgba(255,255,255,.07); overflow:hidden; }
.profile-page .pf-cl-bar > div { height:100%; border-radius: 999px; background: var(--grad-primary); }
.profile-page .pf-cl-prog-meta { display:flex; justify-content:space-between; margin-top: 7px; font-size: 11px; color: var(--text-subtle); font-variant-numeric: tabular-nums; }
.profile-page .pf-cl-prog-pct { color: var(--text-muted); font-weight: 600; }
.profile-page .pf-cl-resume { position:absolute; top:14px; right:14px; width: 34px; height:34px; border-radius:50%; background: var(--grad-primary); color:#042134; border: 0; display:grid; place-items:center; box-shadow: var(--shadow-primary); opacity:0; transform: scale(.85); transition: 160ms; cursor:pointer; }
.profile-page .pf-cl:hover .pf-cl-resume { opacity:1; transform: scale(1); }

/* finished + bookmarks */
.profile-page .pf-twocol { display:grid; grid-template-columns: 1.3fr 1fr; gap: 18px; align-items:start; }
@media (max-width: 1023px) { .profile-page .pf-twocol { grid-template-columns: 1fr; } }

.profile-page .pf-list { display:flex; flex-direction:column; }
.profile-page .pf-li { display:flex; align-items:center; gap: 14px; padding: 12px 16px; border-bottom:1px solid var(--border); transition: 120ms; cursor: pointer; }
.profile-page .pf-li:last-child { border-bottom:0; }
.profile-page .pf-li:hover { background: rgba(255,255,255,.02); }
.profile-page .pf-li-body { flex:1; min-width:0; }
.profile-page .pf-li-title { font-weight: 600; font-size: 14px; line-height:1.25; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-page .pf-li-sub { font-size: 12px; color: var(--text-subtle); margin-top: 2px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-page .pf-sep { opacity:.5; margin: 0 5px; }
.profile-page .pf-li-right { display:flex; flex-direction:column; align-items:flex-end; gap:4px; flex-shrink:0; }
.profile-page .pf-stars { display:flex; gap: 1px; color: #f5c563; }
.profile-page .pf-stars-off { color: rgba(167,188,214,.2); }
.profile-page .pf-li-when { font-size: 11px; color: var(--text-subtle); white-space:nowrap; }
.profile-page .pf-li-play { width: 32px; height:32px; border-radius:50%; background: rgba(255,255,255,.05); border:1px solid var(--border); color: var(--text-muted); display:grid; place-items:center; transition:140ms; flex-shrink:0; cursor:pointer; }
.profile-page .pf-li-play:hover { background: var(--grad-primary); color:#042134; border-color:transparent; }

/* bookmark item */
.profile-page .pf-bm { display:flex; gap: 12px; padding: 14px 16px; border-bottom:1px solid var(--border); cursor: pointer; transition: 120ms; }
.profile-page .pf-bm:last-child { border-bottom:0; }
.profile-page .pf-bm:hover { background: rgba(255,255,255,.02); }
.profile-page .pf-bm-tick { width: 3px; border-radius:2px; background: var(--accent); flex-shrink:0; }
.profile-page .pf-bm-body { flex:1; min-width:0; }
.profile-page .pf-bm-label { font-size: 13.5px; color: var(--text); line-height:1.4; font-style: italic; }
.profile-page .pf-bm-meta { font-size: 11.5px; color: var(--text-subtle); margin-top: 5px; display:flex; align-items:center; gap: 8px; flex-wrap: wrap; }
.profile-page .pf-bm-pos { font-family: var(--font-mono); color: var(--accent); background: var(--primary-subtle); padding: 1px 7px; border-radius: 5px; font-size: 11px; }

.profile-page .pf-empty-line { padding: 16px; color: var(--text-subtle); font-size: 13px; }

/* insights */
.profile-page .pf-insights { display:grid; grid-template-columns: repeat(3, 1fr); gap: 18px; }
@media (max-width: 1023px) { .profile-page .pf-insights { grid-template-columns: 1fr; } }
.profile-page .pf-ins-card { padding: 20px 22px; }
.profile-page .pf-ins-title { font-size: 12px; color: var(--text-subtle); letter-spacing:.08em; text-transform:uppercase; font-weight: 600; margin-bottom: 16px; display:flex; align-items:center; gap:8px; }
.profile-page .pf-ins-title svg { color: var(--accent); }
.profile-page .pf-author-row { display:flex; align-items:center; gap: 12px; margin-bottom: 14px; }
.profile-page .pf-author-row:last-child { margin-bottom:0; }
.profile-page .pf-author-rank { width: 26px; height:26px; border-radius: 8px; display:grid; place-items:center; font-family: var(--font-mono); font-size: 12px; font-weight: 600; background: rgba(255,255,255,.05); color: var(--text-muted); flex-shrink:0; }
.profile-page .pf-author-row:first-child .pf-author-rank { background: rgba(245,197,99,.15); color: #f5c563; }
.profile-page .pf-author-info { flex:1; min-width:0; }
.profile-page .pf-author-name { font-size: 13.5px; font-weight: 600; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-page .pf-author-sub { font-size: 11.5px; color: var(--text-subtle); }
.profile-page .pf-author-hrs { font-family: var(--font-mono); font-size: 12.5px; color: var(--text-muted); font-weight:600; }

.profile-page .pf-genre-row { margin-bottom: 13px; }
.profile-page .pf-genre-row:last-child { margin-bottom:0; }
.profile-page .pf-genre-top { display:flex; justify-content:space-between; font-size: 13px; margin-bottom: 5px; }
.profile-page .pf-genre-name { color: var(--text-muted); font-weight: 500; }
.profile-page .pf-genre-pct { font-family: var(--font-mono); color: var(--text-subtle); font-size: 12px; }
.profile-page .pf-genre-bar { height: 6px; border-radius: 999px; background: rgba(255,255,255,.05); overflow:hidden; }
.profile-page .pf-genre-bar > div { height:100%; border-radius:999px; background: var(--grad-accent); }

.profile-page .pf-narr-feature { display:flex; flex-direction:column; align-items:center; text-align:center; padding-top: 4px; }
.profile-page .pf-narr-av { width: 64px; height:64px; border-radius:50%; background: linear-gradient(135deg, var(--surface), var(--primary)); display:grid; place-items:center; color:var(--accent); margin-bottom: 14px; box-shadow: inset 0 0 0 1px var(--border-strong); }
.profile-page .pf-narr-name { font-family: var(--font-display); font-weight: 600; font-size: 18px; }
.profile-page .pf-narr-sub { font-size: 12.5px; color: var(--text-subtle); margin-top: 4px; }
.profile-page .pf-narr-stats { display:flex; gap: 22px; margin-top: 16px; }
.profile-page .pf-narr-stats div { font-size: 11.5px; color: var(--text-subtle); }
.profile-page .pf-narr-stats b { display:block; font-family: var(--font-display); font-weight:600; font-size: 20px; color: var(--text); }

/* milestones */
.profile-page .pf-miles { display:grid; grid-template-columns: repeat(4, 1fr); gap: 14px; }
@media (max-width: 860px) { .profile-page .pf-miles { grid-template-columns: repeat(2,1fr); } }
.profile-page .pf-mile { padding: 18px; display:flex; flex-direction:column; gap: 12px; position: relative; overflow:hidden; }
.profile-page .pf-mile-locked { opacity: .82; }
.profile-page .pf-mile-ic { width: 40px; height:40px; border-radius: 11px; display:grid; place-items:center; background: var(--primary-subtle); color: var(--accent); }
.profile-page .pf-mile-done .pf-mile-ic { background: linear-gradient(135deg, rgba(245,197,99,.22), rgba(245,197,99,.08)); color: #f5c563; }
.profile-page .pf-mile-label { font-weight: 600; font-size: 14px; line-height: 1.25; }
.profile-page .pf-mile-sub { font-size: 12px; color: var(--text-subtle); }
.profile-page .pf-mile-badge { position:absolute; top: 16px; right: 16px; color: #4ade80; }
.profile-page .pf-mile-prog { height: 5px; border-radius:999px; background: rgba(255,255,255,.06); overflow:hidden; margin-top: 2px; }
.profile-page .pf-mile-prog > div { height:100%; background: var(--grad-primary); border-radius:999px; }

/* account */
.profile-page .pf-acct { display:grid; grid-template-columns: 1.3fr 1fr; gap: 18px; }
@media (max-width: 1023px) { .profile-page .pf-acct { grid-template-columns: 1fr; } }
.profile-page .pf-acct-rows { padding: 8px 0; }
.profile-page .pf-acct-row { display:flex; align-items:center; gap: 14px; padding: 15px 22px; border-bottom:1px solid var(--border); }
.profile-page .pf-acct-row:last-child { border-bottom:0; }
.profile-page .pf-acct-ic { width: 36px; height:36px; border-radius: 9px; background: rgba(255,255,255,.04); border:1px solid var(--border); color: var(--text-muted); display:grid; place-items:center; flex-shrink:0; }
.profile-page .pf-acct-body { flex:1; min-width:0; }
.profile-page .pf-acct-k { font-size: 12px; color: var(--text-subtle); }
.profile-page .pf-acct-val { font-size: 14px; color: var(--text); font-weight: 500; margin-top: 1px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
.profile-page .pf-acct-act { font-size: 12.5px; color: var(--accent); font-weight:600; }
.profile-page .pf-acct-act:hover { color: var(--primary-light); }

.profile-page .pf-acct-side { padding: 18px 22px; display:flex; flex-direction:column; gap: 10px; }
.profile-page .pf-acct-side-title { font-size: 12px; color: var(--text-subtle); letter-spacing:.08em; text-transform:uppercase; font-weight: 600; }
.profile-page .pf-acct-side-link { display:flex; align-items:center; gap: 10px; padding: 10px 12px; border-radius: var(--radius); background: rgba(255,255,255,.04); border:1px solid var(--border); color: var(--text-muted); font-size: 13.5px; font-weight: 500; transition: 140ms; }
.profile-page .pf-acct-side-link:hover { background: var(--card-hover); color: var(--text); border-color: var(--border-strong); }

/* loading overlay */
.profile-page .pf-loading-overlay { position: fixed; top: 0; left: 0; right: 0; height: 2px; pointer-events: none; z-index: 5; }
.profile-page .pf-loading-bar { height:100%; width: 32%; background: var(--grad-primary); border-radius: 0 999px 999px 0; animation: pfLoad 1.2s ease-in-out infinite; }
@keyframes pfLoad { 0% { transform: translateX(-100%); } 100% { transform: translateX(360%); } }

/* ── phone overrides ── */
@media (max-width: 720px) {
  .profile-page .pf-wrap { padding: 0 14px 96px; }
  .profile-page .pf-hero-body { padding: 24px 18px 22px; gap: 18px; }
  .profile-page .pf-avatar { width: 84px; height: 84px; border-radius: 22px; }
  .profile-page .pf-avatar-mono { font-size: 36px; }
  .profile-page .pf-avatar-ring { border-radius: 26px; }
  .profile-page .pf-hero-id { min-width: 0; flex-basis: 100%; }
  .profile-page .pf-hero-name { font-size: clamp(24px, 7vw, 32px); }
  .profile-page .pf-hero-handle { font-size: 13px; }
  .profile-page .pf-mono { font-size: 12px; }
  .profile-page .pf-hero-meta { gap: 10px 14px; }
  .profile-page .pf-hero-meta-item { font-size: 12px; }
  .profile-page .pf-hero-actions { margin-left: 0; width: 100%; }
  .profile-page .pf-hero-actions .pf-btn { flex: 1; }
  .profile-page .pf-hero-stats { grid-template-columns: 1fr; }
  .profile-page .pf-hero-stat { padding: 14px 18px; border-right: 0; border-bottom: 1px solid var(--border); }
  .profile-page .pf-hero-stat:last-child { border-bottom: 0; }
  .profile-page .pf-hero-stat-v { font-size: 24px; }

  .profile-page .pf-statgrid { grid-template-columns: 1fr 1fr; gap: 10px; }
  .profile-page .pf-statchip { padding: 14px; }
  .profile-page .pf-statchip-v { font-size: 22px; }
  .profile-page .pf-miles { grid-template-columns: 1fr; }
  .profile-page .pf-panel { padding: 18px 16px; }
  .profile-page .pf-trend-card, .profile-page .pf-plat-card { padding: 18px 16px; }
  .profile-page .pf-sec-head h2 { font-size: 18px; }
  .profile-page .pf-pagenav { padding: 8px 0 14px; }
}

@media (max-width: 480px) {
  .profile-page .pf-statgrid { grid-template-columns: 1fr; }
  .profile-page .pf-cl { padding: 12px; gap: 12px; }
  .profile-page .pf-ring-card { flex-direction: column; align-items: flex-start; gap: 16px; }
  .profile-page .pf-acct-row { padding: 12px 16px; }
}
`;
