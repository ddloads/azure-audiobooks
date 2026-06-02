import { useState, useEffect } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import { ArrowLeft, BookOpen, Bug, Eye, EyeOff, Headphones, History, Image, KeyRound, Loader2, Monitor, Palette, Play, User } from "lucide-react";
import { isAxiosError } from "axios";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import { usePlayer } from "../context/PlayerContext";
import { useToast } from "../context/ToastContext";
import { useShelfPrefs } from "../hooks/useShelfPrefs";
import type { UserListeningSession } from "../features/admin/types";
import { formatListenTime, formatDate } from "../features/admin/helpers";

type TabKey = "profile" | "security" | "appearance" | "sessions" | "history" | "report";

interface FinishedRecord {
  bookId: string;
  lastUpdate: string;
  book: {
    id: string;
    title: string;
    duration: number;
    coverPath?: string | null;
    author: { name: string };
    series?: { id: string; title: string } | null;
    seriesOrder?: number | null;
  };
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, { year: "numeric", month: "short", day: "numeric" });

interface ApiUser {
  id: string;
  username: string;
  email?: string | null;
  avatarUrl?: string | null;
  role: string;
}

const issueTypes = [
  { value: "playback", label: "Playback issue" },
  { value: "library", label: "Library or scanning" },
  { value: "metadata", label: "Book metadata" },
  { value: "account", label: "Account or login" },
  { value: "performance", label: "Slow or unresponsive" },
  { value: "visual", label: "Visual problem" },
  { value: "other", label: "Something else" },
];

const SHELF_LABELS: Record<string, { label: string; description: string }> = {
  shelfContinueListening: { label: "Continue Listening",  description: "Books you have started but not finished." },
  shelfNextInSeries:      { label: "Up Next in Series",   description: "Next unread book in a series you've been following." },
  shelfYouMightLike:      { label: "You Might Like",      description: "Books matched to your listening history." },
  shelfRecentlyAdded:     { label: "Recently Added",      description: "New arrivals you haven't started yet." },
};

const tabs: Array<{ key: TabKey; label: string; icon: typeof User; description: string }> = [
  { key: "profile",    label: "Profile",    icon: User,       description: "Update your profile photo and account details." },
  { key: "security",   label: "Security",   icon: KeyRound,   description: "Change your password." },
  { key: "appearance", label: "Appearance", icon: Palette,    description: "Choose which shelves appear on your home screen." },
  { key: "sessions",   label: "Sessions",   icon: Headphones, description: "Your recent listening sessions." },
  { key: "history",    label: "History",    icon: History,    description: "Books you have finished listening to." },
  { key: "report",     label: "Report",     icon: Bug,        description: "Submit a bug report or feedback to the admin." },
];

export default function AccountSettingsPage() {
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  const { playBook } = usePlayer();
  const location = useLocation();
  const navigate = useNavigate();

  const backTarget =
    typeof location.state === "object" && location.state !== null && "from" in location.state
      ? (location.state as { from: string }).from
      : "/";

  const [activeTab, setActiveTab] = useState<TabKey>("profile");

  // Profile
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [avatarUrl, setAvatarUrl] = useState(user?.avatarUrl ?? "");
  const [profileLoading, setProfileLoading] = useState(false);

  // Security
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  // Appearance
  const { prefs, toggle, SHELF_KEYS } = useShelfPrefs(user?.id ?? "");

  // Sessions
  const [sessions, setSessions] = useState<UserListeningSession[] | null>(null);
  const [sessionsLoading, setSessionsLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== "sessions" || sessions) return;
    setSessionsLoading(true);
    api.get<UserListeningSession[]>("/sessions/me")
      .then((res) => setSessions(res.data))
      .catch(() => setSessions([]))
      .finally(() => setSessionsLoading(false));
  }, [activeTab, sessions]);

  // History
  const [historyRecords, setHistoryRecords] = useState<FinishedRecord[] | null>(null);
  const [historyLoading, setHistoryLoading] = useState(false);

  useEffect(() => {
    if (activeTab !== "history" || historyRecords) return;
    setHistoryLoading(true);
    api.get<FinishedRecord[]>("/progress/finished")
      .then((res) => setHistoryRecords(res.data))
      .catch(() => setHistoryRecords([]))
      .finally(() => setHistoryLoading(false));
  }, [activeTab, historyRecords]);

  // Report
  const [reportType, setReportType] = useState(issueTypes[0].value);
  const [reportComment, setReportComment] = useState("");
  const [reportLoading, setReportLoading] = useState(false);

  useEffect(() => {
    setUsername(user?.username ?? "");
    setEmail(user?.email ?? "");
    setAvatarUrl(user?.avatarUrl ?? "");
  }, [user?.username, user?.email, user?.avatarUrl]);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileLoading(true);
    try {
      const updates: Promise<{ data: ApiUser }>[] = [];
      if (username.trim() && username.trim() !== user.username)
        updates.push(api.patch<ApiUser>("/auth/me/username", { username: username.trim() }));
      if (email.trim() !== (user.email ?? ""))
        updates.push(api.patch<ApiUser>("/auth/me/email", { email: email.trim() }));
      if (avatarUrl.trim() !== (user.avatarUrl ?? ""))
        updates.push(api.patch<ApiUser>("/auth/me/avatar", { avatarUrl: avatarUrl.trim() }));
      if (updates.length === 0) { showToast({ title: "No changes to save", tone: "info" }); return; }
      await Promise.all(updates);
      const latest = (await api.get<ApiUser>("/auth/me")).data;
      updateUser(latest);
      setUsername(latest.username);
      setEmail(latest.email ?? "");
      setAvatarUrl(latest.avatarUrl ?? "");
      showToast({ title: "Profile updated", tone: "success" });
    } catch (err) {
      const msg = isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : undefined;
      showToast({ title: "Update failed", description: msg ?? "Could not save changes.", tone: "error" });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { showToast({ title: "Passwords do not match", tone: "error" }); return; }
    setPasswordLoading(true);
    try {
      await api.patch("/auth/me/password", { currentPassword, newPassword });
      setCurrentPassword(""); setNewPassword(""); setConfirmPassword("");
      showToast({ title: "Password updated", tone: "success" });
    } catch (err) {
      const msg = isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : undefined;
      showToast({ title: "Update failed", description: msg ?? "Could not change password.", tone: "error" });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportLoading(true);
    try {
      await api.post("/reports", {
        type: reportType,
        comment: reportComment,
        path: `${window.location.pathname}${window.location.search}`,
      });
      setReportComment("");
      showToast({ title: "Report submitted", description: "An admin will review it.", tone: "success" });
    } catch (err) {
      const msg = isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : undefined;
      showToast({ title: "Submit failed", description: msg ?? "Could not submit the report.", tone: "error" });
    } finally {
      setReportLoading(false);
    }
  };

  const activeTabConfig = tabs.find((t) => t.key === activeTab) ?? tabs[0];
  const ActiveTabIcon = activeTabConfig.icon;

  return (
    <div className="admin-settings-page">
      <div className="admin-settings-page-shell animate-fade-in">

        <div className="admin-settings-header">
          <div className="admin-settings-header-left">
            <Link to={backTarget} className="admin-back-btn" aria-label="Back">
              <ArrowLeft size={16} />
            </Link>
            <div>
              <h1 className="admin-settings-title">Settings</h1>
              <p className="admin-settings-subtitle">{user?.username}</p>
            </div>
          </div>
        </div>

        <div className="admin-settings-layout">
          <aside className="admin-settings-sidebar">
            {tabs.map(({ key, label, icon: Icon }) => (
              <button
                key={key}
                className={`admin-nav-btn${activeTab === key ? " admin-nav-btn-active" : ""}`}
                onClick={() => setActiveTab(key)}
                type="button"
              >
                <Icon size={15} />
                <span>{label}</span>
              </button>
            ))}
          </aside>

          <section className="admin-settings-content">
            <div className="admin-content-topbar">
              <div className="admin-content-title-row">
                <ActiveTabIcon size={16} className="admin-content-title-icon" />
                <h2 className="admin-content-title">{activeTabConfig.label}</h2>
              </div>
              <p className="admin-content-desc">{activeTabConfig.description}</p>
            </div>

            {activeTab === "profile" && (
              <form onSubmit={(e) => void handleSaveProfile(e)} className="account-profile-page">
                <div className="account-profile-hero">
                  <div className="account-profile-hero-copy">
                    <span className="account-profile-kicker">Azure Profile</span>
                    <h3>{username || user?.username}</h3>
                    <p>{email || user?.email || "No email address set"}</p>
                    <div className="account-profile-meta">
                      <span>{user?.role?.toLowerCase()}</span>
                      <span>Account ID {user?.id}</span>
                    </div>
                  </div>
                  <div className="account-profile-avatar-frame">
                    <div className="account-profile-avatar">
                      {avatarUrl.trim() ? (
                        <img src={avatarUrl.trim()} alt={`${username || user?.username || "User"} avatar`} />
                      ) : (
                        <span>{(username || user?.username || "?").charAt(0).toUpperCase()}</span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="account-profile-grid">
                  <section className="account-profile-panel account-profile-photo-panel">
                    <div>
                      <span className="account-profile-panel-label">Profile Photo</span>
                      <h4>Avatar image</h4>
                    </div>
                    <div className="account-field">
                      <label className="account-field-label" htmlFor="acc-avatar">Image URL</label>
                      <div className="account-avatar-input">
                        <Image size={16} />
                        <input id="acc-avatar" className="form-control" type="url" value={avatarUrl}
                          onChange={(e) => setAvatarUrl(e.target.value)} autoComplete="url" placeholder="https://example.com/avatar.jpg" />
                      </div>
                    </div>
                    <p className="account-profile-help">Use a direct http or https image URL. Clear this field to return to the initial badge.</p>
                  </section>

                  <section className="account-profile-panel">
                    <div>
                      <span className="account-profile-panel-label">Account Details</span>
                      <h4>Identity</h4>
                    </div>
                    <div className="account-field">
                      <label className="account-field-label" htmlFor="acc-username">Username</label>
                      <input id="acc-username" className="form-control" type="text" value={username}
                        onChange={(e) => setUsername(e.target.value)} minLength={2} maxLength={32} autoComplete="username" />
                    </div>
                    <div className="account-field">
                      <label className="account-field-label" htmlFor="acc-email">Email</label>
                      <input id="acc-email" className="form-control" type="email" value={email}
                        onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
                    </div>
                  </section>
                </div>

                <div className="account-profile-stat-grid">
                  <div className="account-profile-stat">
                    <span>Role</span>
                    <strong>{user?.role?.toLowerCase()}</strong>
                  </div>
                  <div className="account-profile-stat">
                    <span>Email</span>
                    <strong>{email || "Not set"}</strong>
                  </div>
                  <div className="account-profile-stat">
                    <span>Avatar</span>
                    <strong>{avatarUrl.trim() ? "Custom image" : "Initial badge"}</strong>
                  </div>
                </div>

                <div className="account-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={profileLoading}>
                    {profileLoading && <Loader2 size={14} className="animate-spin" />}
                    Save Profile
                  </button>
                </div>
              </form>
            )}

            {activeTab === "security" && (
              <form onSubmit={(e) => void handleChangePassword(e)} className="account-form">
                <div className="account-field">
                  <label className="account-field-label" htmlFor="acc-current-pw">Current password</label>
                  <input id="acc-current-pw" className="form-control" type="password" value={currentPassword}
                    onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
                </div>
                <div className="account-field">
                  <label className="account-field-label" htmlFor="acc-new-pw">New password</label>
                  <input id="acc-new-pw" className="form-control" type="password" value={newPassword}
                    onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={6} required />
                </div>
                <div className="account-field">
                  <label className="account-field-label" htmlFor="acc-confirm-pw">Confirm new password</label>
                  <input id="acc-confirm-pw" className="form-control" type="password" value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={6} required />
                </div>
                <div className="account-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={passwordLoading}>
                    {passwordLoading && <Loader2 size={14} className="animate-spin" />}
                    Update Password
                  </button>
                </div>
              </form>
            )}

            {activeTab === "appearance" && (
              <div className="account-shelf-toggles">
                {SHELF_KEYS.map((key) => {
                  const { label, description } = SHELF_LABELS[key];
                  const enabled = prefs[key];
                  return (
                    <button
                      key={key}
                      type="button"
                      className={`admin-overview-toggle${enabled ? " is-enabled" : ""}`}
                      onClick={() => toggle(key)}
                      aria-pressed={enabled}
                    >
                      <div className="admin-overview-toggle-copy">
                        <strong>{label}</strong>
                        <small>{description}</small>
                      </div>
                      {enabled ? <Eye size={16} /> : <EyeOff size={16} />}
                    </button>
                  );
                })}
              </div>
            )}

            {activeTab === "sessions" && (
              <div className="account-sessions">
                {sessionsLoading || !sessions ? (
                  <div className="account-stats-loading">
                    {sessionsLoading && <Loader2 size={20} className="animate-spin" />}
                  </div>
                ) : sessions.length === 0 ? (
                  <p className="account-stats-empty">No sessions recorded yet.</p>
                ) : (
                  <div className="account-session-list">
                    {sessions.map((s) => (
                      <div key={s.id} className="account-session-row">
                        <div className="account-session-info">
                          <strong>{s.book.title}</strong>
                          <small>{s.book.author.name} · {formatDate(s.startedAt)}</small>
                        </div>
                        <div className="account-session-meta">
                          <span className="account-session-duration">{formatListenTime(s.secondsListened)}</span>
                          {s.platform && (
                            <span className="account-session-platform">
                              <Monitor size={11} />
                              {s.platform}
                            </span>
                          )}
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "history" && (
              <div className="account-history">
                {historyLoading || !historyRecords ? (
                  <div className="account-stats-loading">
                    {historyLoading && <Loader2 size={20} className="animate-spin" />}
                  </div>
                ) : historyRecords.length === 0 ? (
                  <p className="account-stats-empty">No finished books yet.</p>
                ) : (
                  <div className="account-history-list">
                    {historyRecords.map((record) => (
                      <div
                        key={record.bookId}
                        className="account-history-item"
                        onClick={() => navigate(`/book/${record.bookId}`)}
                      >
                        <div className="account-history-cover">
                          {record.book.coverPath ? (
                            <img src={record.book.coverPath} alt={record.book.title} />
                          ) : (
                            <div className="account-history-cover-placeholder">
                              <BookOpen size={16} />
                            </div>
                          )}
                        </div>
                        <div className="account-history-info">
                          <strong>{record.book.title}</strong>
                          <small>
                            {record.book.author.name}
                            {record.book.series ? ` · ${record.book.series.title}` : ""}
                            {" · "}Finished {fmtDate(record.lastUpdate)}
                          </small>
                        </div>
                        <button
                          className="account-history-play"
                          title="Play again"
                          onClick={async (e) => {
                            e.stopPropagation();
                            const bookRes = await api.get(`/library/${record.bookId}`);
                            playBook(bookRes.data, 0);
                          }}
                        >
                          <Play size={14} fill="currentColor" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {activeTab === "report" && (
              <form onSubmit={(e) => void handleSubmitReport(e)} className="account-form">
                <div className="account-field">
                  <label className="account-field-label" htmlFor="report-type">Issue type</label>
                  <div className="select-wrap">
                    <select id="report-type" className="form-control" value={reportType}
                      onChange={(e) => setReportType(e.target.value)}>
                      {issueTypes.map((o) => (
                        <option key={o.value} value={o.value}>{o.label}</option>
                      ))}
                    </select>
                  </div>
                </div>
                <div className="account-field">
                  <label className="account-field-label" htmlFor="report-comment">Details</label>
                  <textarea id="report-comment" className="form-control account-report-textarea"
                    value={reportComment} onChange={(e) => setReportComment(e.target.value)}
                    maxLength={2000} placeholder="Describe the problem in as much detail as you can." />
                </div>
                <div className="account-form-actions">
                  <button type="submit" className="btn btn-primary" disabled={reportLoading}>
                    {reportLoading ? <Loader2 size={14} className="animate-spin" /> : <Bug size={14} />}
                    {reportLoading ? "Submitting…" : "Submit Report"}
                  </button>
                </div>
              </form>
            )}
          </section>
        </div>
      </div>
    </div>
  );
}
