import { useState, useEffect } from "react";
import {
  Database,
  RefreshCw,
  Loader2,
  HardDrive,
  Users,
  Save,
  X,
  Pencil,
  Check,
  Trash2,
  Network,
  Copy,
} from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import ConfirmDialog from "../../../components/ConfirmDialog";
import type {
  DashboardData,
  AdminLibrary,
  AudibleCliStatus,
  PendingAdminConfirm,
} from "../types";
import { formatDate, formatBytes, getErrorMessage } from "../helpers";

interface SystemTabProps {
  onLibraryChanged?: () => Promise<unknown> | unknown;
}

export default function SystemTab({ onLibraryChanged }: SystemTabProps) {
  const { showToast } = useToast();
  const [dashboard, setDashboard] = useState<DashboardData | null>(null);
  const [libraries, setLibraries] = useState<AdminLibrary[]>([]);
  const [loading, setLoading] = useState(true);

  // Audible CLI States
  const [audibleCliStatus, setAudibleCliStatus] = useState<AudibleCliStatus | null>(null);
  const [audibleCliStatusLoading, setAudibleCliStatusLoading] = useState(false);
  const [editingAudibleProfile, setEditingAudibleProfile] = useState<string | null>(null);
  const [audibleProfileDrafts, setAudibleProfileDrafts] = useState<Record<string, string>>({});
  const [audibleAuthError, setAudibleAuthError] = useState<string | null>(null);
  const [audibleAuthStep, setAudibleAuthStep] = useState<"idle" | "url" | "completing" | "done">("idle");
  const [audibleAuthMarketplace, setAudibleAuthMarketplace] = useState("us");
  const [audibleAuthProfileName, setAudibleAuthProfileName] = useState("");
  const [audibleAuthUrl, setAudibleAuthUrl] = useState("");
  const [audibleAuthRedirect, setAudibleAuthRedirect] = useState("");
  const [audibleAuthToken, setAudibleAuthToken] = useState("");

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirm | null>(null);

  const loadDashboardData = async () => {
    try {
      const response = await api.get<DashboardData>("/admin/dashboard");
      setDashboard(response.data);
    } catch (error) {
      showToast({
        title: "Failed to load system stats",
        description: getErrorMessage(error, "Failed to load dashboard data"),
        tone: "error",
      });
    }
  };

  const loadLibraries = async () => {
    try {
      const response = await api.get<AdminLibrary[]>("/admin/libraries");
      setLibraries(response.data);
    } catch (error) {
      showToast({
        title: "Failed to load libraries",
        description: getErrorMessage(error, "Failed to load libraries list"),
        tone: "error",
      });
    }
  };

  const loadAudibleCliStatus = async () => {
    setAudibleCliStatusLoading(true);
    try {
      const response = await api.get<AudibleCliStatus>("/admin/audible-cli/status");
      setAudibleCliStatus(response.data);
    } catch (error) {
      // Non-critical
      console.error("Failed to load audible-cli status", error);
    } finally {
      setAudibleCliStatusLoading(false);
    }
  };

  const loadAll = async () => {
    setLoading(true);
    await Promise.all([
      loadDashboardData(),
      loadLibraries(),
      loadAudibleCliStatus(),
    ]);
    setLoading(false);
  };

  useEffect(() => {
    void loadAll();
  }, []);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionLoading(key);
    try {
      await action();
    } finally {
      setActionLoading(null);
    }
  };

  const handleSetActiveAudibleProfile = async (profileName: string) => {
    await runAction(`audible-active-${profileName}`, async () => {
      try {
        await api.post("/admin/audible-cli/active-profile", { profileName });
        showToast({
          title: "Active profile updated",
          description: `Active Audible profile set to ${profileName}`,
          tone: "success",
        });
        await loadAudibleCliStatus();
      } catch (actionError) {
        showToast({
          title: "Failed to set active profile",
          description: getErrorMessage(actionError, "Failed to set active Audible profile"),
          tone: "error",
        });
      }
    });
  };

  const handleDeleteAudibleProfile = async (profileName: string) => {
    await runAction(`audible-delete-${profileName}`, async () => {
      try {
        const response = await api.delete<AudibleCliStatus & { ok: boolean }>(
          `/admin/audible-cli/profiles/${encodeURIComponent(profileName)}`
        );
        setAudibleCliStatus(response.data);
        showToast({
          title: "Audible profile removed",
          description: `Removed Audible profile ${profileName}`,
          tone: "success",
        });
      } catch (actionError) {
        showToast({
          title: "Failed to remove Audible profile",
          description: getErrorMessage(actionError, "Failed to remove Audible profile"),
          tone: "error",
        });
      }
    });
  };

  const handleRenameAudibleProfile = async (profileName: string) => {
    const nextName = audibleProfileDrafts[profileName]?.trim();
    if (!nextName || nextName === profileName) {
      setEditingAudibleProfile(null);
      return;
    }

    await runAction(`audible-rename-${profileName}`, async () => {
      try {
        const response = await api.patch<AudibleCliStatus & { ok: boolean }>(
          `/admin/audible-cli/profiles/${encodeURIComponent(profileName)}`,
          { profileName: nextName }
        );
        setAudibleCliStatus(response.data);
        setEditingAudibleProfile(null);
        setAudibleProfileDrafts((current) => {
          const next = { ...current };
          delete next[profileName];
          next[nextName] = nextName;
          return next;
        });
        showToast({
          title: "Audible profile renamed",
          description: `Renamed Audible profile to ${nextName}`,
          tone: "success",
        });
      } catch (actionError) {
        showToast({
          title: "Failed to rename Audible profile",
          description: getErrorMessage(actionError, "Failed to rename Audible profile"),
          tone: "error",
        });
      }
    });
  };

  const handleAudibleAuthStart = async () => {
    if (!audibleAuthProfileName.trim()) {
      setAudibleAuthError("Profile name is required");
      return;
    }
    setAudibleAuthError("");
    setAudibleAuthToken("");
    setAudibleAuthUrl("");
    setAudibleAuthRedirect("");
    setAudibleAuthStep("url");
    try {
      const res = await api.post("/admin/audible-cli/auth/start", {
        marketplace: audibleAuthMarketplace,
        profileName: audibleAuthProfileName.trim(),
      });
      setAudibleAuthToken(res.data.authToken);
      setAudibleAuthProfileName(res.data.profileName);
      setAudibleAuthUrl(res.data.url);
    } catch (e) {
      setAudibleAuthError(getErrorMessage(e, "Failed to generate login URL"));
      setAudibleAuthStep("idle");
    }
  };

  const handleAudibleAuthComplete = async () => {
    if (!audibleAuthRedirect.trim() || !audibleAuthToken || !audibleAuthProfileName.trim()) return;
    setAudibleAuthError("");
    setAudibleAuthStep("completing");
    try {
      await api.post("/admin/audible-cli/auth/complete", {
        redirectUrl: audibleAuthRedirect.trim(),
        authToken: audibleAuthToken,
        profileName: audibleAuthProfileName.trim(),
      });
      setAudibleAuthStep("done");
      setAudibleAuthToken("");
      setAudibleAuthUrl("");
      setAudibleAuthRedirect("");
      await loadAudibleCliStatus();
    } catch (e) {
      setAudibleAuthError(getErrorMessage(e, "Failed to complete authentication"));
      setAudibleAuthStep("url");
    }
  };

  const handleCreateBackup = async () => {
    await runAction("create-backup", async () => {
      try {
        const res = await api.post("/admin/backups");
        showToast({
          title: "Backup created",
          description: res.data.message || "Backup created",
          tone: "success",
        });
        await loadDashboardData();
      } catch (actionError) {
        showToast({
          title: "Failed to create backup",
          description: getErrorMessage(actionError, "Failed to create backup"),
          tone: "error",
        });
      }
    });
  };

  const handleRescan = async () => {
    await runAction("rescan-library", async () => {
      try {
        await api.post("/admin/library/scan");
        showToast({
          title: "Library scan started",
          description: "The full library rescan has been queued.",
          tone: "success",
        });
        await loadAll();
        if (onLibraryChanged) {
          await onLibraryChanged();
        }
      } catch (actionError) {
        showToast({
          title: "Failed to scan library",
          description: getErrorMessage(actionError, "Failed to scan library"),
          tone: "error",
        });
      }
    });
  };

  if (loading || !dashboard) {
    return (
      <div className="admin-settings-loading">
        <div className="app-loading-spinner" />
      </div>
    );
  }

  const enabledSourceCount = libraries.reduce(
    (count, library) => count + library.sources.filter((source) => source.isEnabled).length,
    0
  );

  return (
    <div className="admin-panel-stack">
      <div className="card admin-section-card">
        <div className="admin-section-head">
          <h3>Audible CLI Integration</h3>
          <div className="admin-section-head-actions">
            <button
              className="btn btn-secondary"
              type="button"
              disabled={audibleCliStatusLoading}
              onClick={() => void loadAudibleCliStatus()}
            >
              {audibleCliStatusLoading ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <RefreshCw size={14} />
              )}
              Check status
            </button>
          </div>
        </div>

        {audibleCliStatus ? (
          <>
            <div className="admin-meta-list">
              <div>
                <span>CLI installed</span>
                <span className={`audible-cli-status-dot ${audibleCliStatus.installed ? "ok" : "off"}`}>
                  {audibleCliStatus.installed
                    ? "Yes — audible found in PATH"
                    : "Not found — ensure you have redeployed with the latest Docker image"}
                </span>
              </div>
              <div>
                <span>Authenticated</span>
                <span
                  className={`audible-cli-status-dot ${
                    audibleCliStatus.authenticated
                      ? "ok"
                      : audibleCliStatus.installed
                      ? "warn"
                      : "off"
                  }`}
                >
                  {audibleCliStatus.authenticated
                    ? "Yes — profile detected"
                    : audibleCliStatus.installed
                    ? "No profile found — run: audible quickstart"
                    : "N/A"}
                </span>
              </div>
              <div>
                <span>Config directory</span>
                <code>{audibleCliStatus.configDir}</code>
              </div>
              <div>
                <span>Marketplace</span>
                <code>{audibleCliStatus.marketplace}</code>
              </div>
              <div>
                <span>Active profile</span>
                <code>{audibleCliStatus.activeProfile ?? "Automatic fallback"}</code>
              </div>
            </div>

            {!audibleCliStatus.installed && (
              <div className="audible-cli-setup-hint">
                <strong>Installation pending</strong>
                <p>
                  audible-cli is now automatically installed in the server container. If it shows as
                  "Not found", please pull the latest image and redeploy your stack.
                </p>
              </div>
            )}

            {audibleCliStatus.installed && audibleCliStatus.profiles.length > 0 && (
              <div className="card admin-section-card" style={{ marginTop: "1rem" }}>
                <div className="admin-section-head">
                  <h3>Connected accounts</h3>
                  <Users size={15} />
                </div>
                <div className="admin-table">
                  {audibleCliStatus.profiles.map((profileName) => (
                    <div key={profileName} className="admin-table-row">
                      <div className="admin-book-summary">
                        {editingAudibleProfile === profileName ? (
                          <input
                            className="form-control"
                            value={audibleProfileDrafts[profileName] ?? profileName}
                            onChange={(e) =>
                              setAudibleProfileDrafts((current) => ({
                                ...current,
                                [profileName]: e.target.value,
                              }))
                            }
                          />
                        ) : (
                          <strong>{profileName}</strong>
                        )}
                        <small>
                          {audibleCliStatus.activeProfile === profileName
                            ? "Used for audible-cli metadata searches"
                            : "Available account"}
                        </small>
                      </div>
                      <div style={{ display: "flex", gap: "0.5rem", alignItems: "center" }}>
                        {editingAudibleProfile === profileName ? (
                          <>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              disabled={actionLoading === `audible-rename-${profileName}`}
                              onClick={() => void handleRenameAudibleProfile(profileName)}
                            >
                              {actionLoading === `audible-rename-${profileName}` ? (
                                <Loader2 size={14} className="animate-spin" />
                              ) : (
                                <Save size={14} />
                              )}
                              Save
                            </button>
                            <button
                              className="btn btn-secondary"
                              type="button"
                              onClick={() => {
                                setEditingAudibleProfile(null);
                                setAudibleProfileDrafts((current) => ({
                                  ...current,
                                  [profileName]: profileName,
                                }));
                              }}
                            >
                              <X size={14} />
                              Cancel
                            </button>
                          </>
                        ) : (
                          <button
                            className="btn btn-secondary"
                            type="button"
                            onClick={() => {
                              setEditingAudibleProfile(profileName);
                              setAudibleProfileDrafts((current) => ({
                                ...current,
                                [profileName]: current[profileName] ?? profileName,
                              }));
                            }}
                          >
                            <Pencil size={14} />
                            Rename
                          </button>
                        )}
                        {audibleCliStatus.activeProfile === profileName ? (
                          <div className="admin-pill">Active</div>
                        ) : (
                          <button
                            className="btn btn-secondary"
                            type="button"
                            disabled={actionLoading === `audible-active-${profileName}`}
                            onClick={() => void handleSetActiveAudibleProfile(profileName)}
                          >
                            {actionLoading === `audible-active-${profileName}` ? (
                              <Loader2 size={14} className="animate-spin" />
                            ) : (
                              <Check size={14} />
                            )}
                            Make active
                          </button>
                        )}
                        <button
                          className="btn admin-danger-btn"
                          type="button"
                          disabled={actionLoading === `audible-delete-${profileName}`}
                          onClick={() =>
                            setPendingConfirm({
                              title: "Remove Audible Profile",
                              message: `Remove Audible profile "${profileName}"?`,
                              confirmLabel: "Remove Profile",
                              tone: "danger",
                              onConfirm: () => void handleDeleteAudibleProfile(profileName),
                            })
                          }
                        >
                          {actionLoading === `audible-delete-${profileName}` ? (
                            <Loader2 size={14} className="animate-spin" />
                          ) : (
                            <Trash2 size={14} />
                          )}
                          Remove
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {audibleCliStatus.installed && (
              <div className="audible-cli-setup-hint" style={{ marginTop: "1rem" }}>
                <strong>
                  {audibleCliStatus.authenticated
                    ? "Add another Audible account"
                    : "Connect your Audible account"}
                </strong>
                {audibleAuthError && (
                  <div className="auth-error" style={{ marginBottom: "0.5rem", color: "var(--brand-danger)" }}>
                    {audibleAuthError}
                  </div>
                )}

                {audibleAuthStep === "idle" && (
                  <>
                    <p>
                      Choose a marketplace, assign a profile name, and generate a login URL. A free
                      Audible account is sufficient.
                    </p>
                    <div className="audible-cli-auth-row">
                      <div className="select-wrap" style={{ minWidth: "160px" }}>
                        <select
                          className="form-control"
                          value={audibleAuthMarketplace}
                          onChange={(e) => setAudibleAuthMarketplace(e.target.value)}
                        >
                          <option value="us">US (audible.com)</option>
                          <option value="uk">UK (audible.co.uk)</option>
                          <option value="de">Germany (audible.de)</option>
                          <option value="fr">France (audible.fr)</option>
                          <option value="ca">Canada (audible.ca)</option>
                          <option value="it">Italy (audible.it)</option>
                          <option value="au">Australia (audible.com.au)</option>
                          <option value="in">India (audible.in)</option>
                          <option value="jp">Japan (audible.co.jp)</option>
                          <option value="es">Spain (audible.es)</option>
                        </select>
                      </div>
                      <input
                        className="form-control"
                        style={{ minWidth: "180px" }}
                        placeholder="Profile name"
                        value={audibleAuthProfileName}
                        onChange={(e) => setAudibleAuthProfileName(e.target.value)}
                      />
                      <button
                        className="btn btn-primary"
                        type="button"
                        onClick={() => void handleAudibleAuthStart()}
                      >
                        <Network size={14} />
                        Generate login URL
                      </button>
                    </div>
                  </>
                )}

                {audibleAuthStep === "url" && audibleAuthUrl && (
                  <>
                    <p>
                      <strong>Step 1:</strong> Open the link below in your browser and log in with your
                      Amazon / Audible account.
                    </p>
                    <div className="audible-cli-auth-url-row" style={{ display: "flex", gap: "0.5rem", marginBottom: "0.5rem" }}>
                      <a
                        className="btn btn-primary"
                        href={audibleAuthUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <Network size={14} />
                        Open Audible login
                      </a>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => void navigator.clipboard?.writeText(audibleAuthUrl)}
                      >
                        <Copy size={14} />
                        Copy URL
                      </button>
                    </div>
                    <p>
                      <strong>Step 2:</strong> After logging in, your browser will show an error page
                      — that's expected. Copy the full URL from your browser's address bar and paste
                      it below.
                    </p>
                    <textarea
                      className="form-control audible-cli-redirect-input"
                      placeholder="Paste the redirect URL here (starts with https://www.amazon.com/ap/maplanding?...)"
                      value={audibleAuthRedirect}
                      rows={3}
                      onChange={(e) => setAudibleAuthRedirect(e.target.value)}
                      style={{ width: "100%", marginBottom: "0.5rem" }}
                    />
                    <div className="audible-cli-auth-row" style={{ display: "flex", gap: "0.5rem" }}>
                      <button
                        className="btn btn-secondary"
                        type="button"
                        onClick={() => {
                          setAudibleAuthStep("idle");
                          setAudibleAuthToken("");
                          setAudibleAuthUrl("");
                          setAudibleAuthRedirect("");
                        }}
                      >
                        Cancel
                      </button>
                      <button
                        className="btn btn-primary"
                        type="button"
                        disabled={!audibleAuthRedirect.trim()}
                        onClick={() => void handleAudibleAuthComplete()}
                      >
                        <Check size={14} />
                        Complete setup
                      </button>
                    </div>
                  </>
                )}

                {audibleAuthStep === "url" && !audibleAuthUrl && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <Loader2 size={15} className="animate-spin" />
                    Generating login URL…
                  </div>
                )}

                {audibleAuthStep === "completing" && (
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: "0.5rem",
                      color: "var(--text-secondary)",
                    }}
                  >
                    <Loader2 size={15} className="animate-spin" />
                    Completing authentication…
                  </div>
                )}
              </div>
            )}

            {(audibleCliStatus.authenticated || audibleAuthStep === "done") && (
              <p className="audible-cli-active-note" style={{ marginTop: "1rem", color: "var(--text-secondary)", fontSize: "0.85rem" }}>
                Metadata searches will use the active Audible profile via audible-cli. The web
                scraper is kept as a fallback.
              </p>
            )}
          </>
        ) : (
          <div className="admin-empty-state">
            {audibleCliStatusLoading
              ? "Checking audible-cli…"
              : "Click 'Check status' to probe the server environment."}
          </div>
        )}
      </div>

      <div className="admin-split-grid">
        <div className="card admin-section-card">
          <div className="admin-section-head">
            <h3>Maintenance</h3>
            <Database size={15} />
          </div>
          <div className="admin-action-list">
            <div className="admin-action-item">
              <div>
                <strong>Create backup</strong>
                <small>Snapshot the current database to a timestamped file</small>
              </div>
              <button
                className="btn btn-primary"
                type="button"
                disabled={actionLoading === "create-backup"}
                onClick={() => void handleCreateBackup()}
              >
                {actionLoading === "create-backup" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <Database size={15} />
                )}
                Backup now
              </button>
            </div>
            <div className="admin-action-item">
              <div>
                <strong>Full library rescan</strong>
                <small>Re-index all source paths and refresh book metadata</small>
              </div>
              <button
                className="btn btn-secondary"
                type="button"
                disabled={actionLoading === "rescan-library"}
                onClick={() =>
                  setPendingConfirm({
                    title: "Full Library Rescan",
                    message: "Queue a full scan across all active library sources?",
                    confirmLabel: "Scan Libraries",
                    tone: "default",
                    onConfirm: () => void handleRescan(),
                  })
                }
              >
                {actionLoading === "rescan-library" ? (
                  <Loader2 size={15} className="animate-spin" />
                ) : (
                  <RefreshCw size={15} />
                )}
                Rescan all
              </button>
            </div>
          </div>
        </div>

        <div className="card admin-section-card">
          <div className="admin-section-head">
            <h3>Paths & storage</h3>
            <HardDrive size={15} />
          </div>
          <div className="admin-meta-list">
            <div>
              <span>Cover storage</span>
              <code>{dashboard.library.coversRoot}</code>
            </div>
            <div>
              <span>Configured libraries</span>
              <code>{dashboard.stats.libraries}</code>
            </div>
            <div>
              <span>Enabled sources</span>
              <code>{enabledSourceCount}</code>
            </div>
            <div>
              <span>Total backups</span>
              <code>{dashboard.backups.length}</code>
            </div>
          </div>
        </div>
      </div>

      <div className="card admin-section-card">
        <div className="admin-section-head">
          <h3>Backup history</h3>
          <Database size={15} />
        </div>
        <div className="admin-table">
          {dashboard.backups.length === 0 ? (
            <div className="admin-empty-state">No backups yet. Create one above.</div>
          ) : (
            dashboard.backups.map((backup) => (
              <div key={backup.name} className="admin-table-row">
                <div className="admin-book-summary">
                  <strong>{backup.name}</strong>
                  <small>{formatDate(backup.createdAt)}</small>
                </div>
                <div className="admin-pill">{formatBytes(backup.size)}</div>
              </div>
            ))
          )}
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
