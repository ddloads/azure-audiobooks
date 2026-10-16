import { useState, useEffect } from "react";
import {
  AlertTriangle,
  Check,
  CheckCircle2,
  Copy,
  Database,
  ExternalLink,
  HardDrive,
  Link2,
  Loader2,
  Network,
  RefreshCw,
  Save,
  Terminal,
  Trash2,
  UserCircle2,
  Users,
  Wrench,
  X,
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
import {
  Actions,
  Badge,
  Button,
  Columns,
  EmptyState,
  Field,
  FormGrid,
  KeyValues,
  List,
  ListItem,
  Notice,
  Panel,
  Stack,
} from "../ui";
import "./SystemTab.css";

const MARKETPLACES: Array<{ value: string; label: string }> = [
  { value: "us", label: "US (audible.com)" },
  { value: "uk", label: "UK (audible.co.uk)" },
  { value: "de", label: "Germany (audible.de)" },
  { value: "fr", label: "France (audible.fr)" },
  { value: "ca", label: "Canada (audible.ca)" },
  { value: "it", label: "Italy (audible.it)" },
  { value: "au", label: "Australia (audible.com.au)" },
  { value: "in", label: "India (audible.in)" },
  { value: "jp", label: "Japan (audible.co.jp)" },
  { value: "es", label: "Spain (audible.es)" },
];


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
      <div className="as-loading" aria-live="polite">
        <div className="app-loading-spinner" />
      </div>
    );
  }

  const enabledSourceCount = libraries.reduce(
    (count, library) => count + library.sources.filter((source) => source.isEnabled).length,
    0
  );

  const resetAuthFlow = () => {
    setAudibleAuthStep("idle");
    setAudibleAuthToken("");
    setAudibleAuthUrl("");
    setAudibleAuthRedirect("");
  };

  const cli = audibleCliStatus;

  return (
    <Stack>
      {/* ── Audible CLI status ─────────────────────────────────────── */}
      <Panel
        title="Audible CLI"
        icon={Terminal}
        description="audible-cli powers metadata searches; the web scraper is kept as a fallback."
        actions={
          <Button
            size="sm"
            icon={RefreshCw}
            loading={audibleCliStatusLoading}
            onClick={() => void loadAudibleCliStatus()}
          >
            Check status
          </Button>
        }
      >
        {cli ? (
          <Stack gap="sm">
            <KeyValues
              items={[
                {
                  label: "CLI installed",
                  value: cli.installed ? (
                    <span className="as-system-status">
                      <Badge tone="success">Installed</Badge>
                      <span className="as-muted">audible found in PATH</span>
                    </span>
                  ) : (
                    <span className="as-system-status">
                      <Badge tone="danger">Not found</Badge>
                    </span>
                  ),
                },
                {
                  label: "Authenticated",
                  value: cli.authenticated ? (
                    <span className="as-system-status">
                      <Badge tone="success">Yes</Badge>
                      <span className="as-muted">profile detected</span>
                    </span>
                  ) : cli.installed ? (
                    <span className="as-system-status">
                      <Badge tone="warning">No profile</Badge>
                      <span className="as-muted">
                        connect an account below or run <code className="as-mono">audible quickstart</code>
                      </span>
                    </span>
                  ) : (
                    <span className="as-system-status">
                      <Badge>N/A</Badge>
                    </span>
                  ),
                },
                { label: "Config directory", value: cli.configDir, mono: true },
                { label: "Marketplace", value: cli.marketplace, mono: true },
                {
                  label: "Active profile",
                  value: cli.activeProfile ?? <span className="as-muted">Automatic fallback</span>,
                  mono: Boolean(cli.activeProfile),
                },
              ]}
            />

            {!cli.installed && (
              <Notice tone="warning" icon={AlertTriangle}>
                <strong>Installation pending.</strong> audible-cli is installed automatically in the
                server container. If it shows as "Not found", pull the latest Docker image and
                redeploy your stack.
              </Notice>
            )}

            {(cli.authenticated || audibleAuthStep === "done") && (
              <Notice tone="success" icon={CheckCircle2}>
                Metadata searches will use the active Audible profile via audible-cli. The web
                scraper is kept as a fallback.
              </Notice>
            )}
          </Stack>
        ) : audibleCliStatusLoading ? (
          <EmptyState icon={Loader2} title="Checking audible-cli…" />
        ) : (
          <EmptyState icon={Terminal} title="Status unknown">
            Tap "Check status" to probe the server environment.
          </EmptyState>
        )}
      </Panel>

      {/* ── Connected Audible accounts ─────────────────────────────── */}
      {cli?.installed && cli.profiles.length > 0 && (
        <Panel
          title="Connected accounts"
          icon={Users}
          description="Tap an account to rename it, make it active or remove it."
          flush
        >
          <List>
            {cli.profiles.map((profileName) => {
              const expanded = editingAudibleProfile === profileName;
              const isActive = cli.activeProfile === profileName;
              const draft = audibleProfileDrafts[profileName] ?? profileName;
              const renameDirty = draft.trim().length > 0 && draft.trim() !== profileName;
              return (
                <ListItem
                  key={profileName}
                  selected={expanded}
                  onClick={() => {
                    if (expanded) {
                      setEditingAudibleProfile(null);
                      setAudibleProfileDrafts((current) => ({ ...current, [profileName]: profileName }));
                    } else {
                      setEditingAudibleProfile(profileName);
                      setAudibleProfileDrafts((current) => ({
                        ...current,
                        [profileName]: current[profileName] ?? profileName,
                      }));
                    }
                  }}
                  leading={
                    <span className={`as-system-profile-icon${isActive ? " as-system-profile-icon-active" : ""}`}>
                      <UserCircle2 size={20} aria-hidden="true" />
                    </span>
                  }
                  title={
                    <>
                      <span className="as-system-wrap">{profileName}</span>
                      {isActive && <Badge tone="accent">Active</Badge>}
                    </>
                  }
                  subtitle={isActive ? "Used for audible-cli metadata searches" : "Available account"}
                  chevron={!expanded}
                >
                  {expanded && (
                    <form
                      onSubmit={(event) => {
                        event.preventDefault();
                        void handleRenameAudibleProfile(profileName);
                      }}
                    >
                      <Stack gap="md">
                        <Field label="Profile name" htmlFor={`audible-profile-${profileName}`}>
                          <input
                            id={`audible-profile-${profileName}`}
                            className="form-control"
                            autoComplete="off"
                            autoCapitalize="none"
                            value={draft}
                            onChange={(e) =>
                              setAudibleProfileDrafts((current) => ({
                                ...current,
                                [profileName]: e.target.value,
                              }))
                            }
                          />
                        </Field>
                        <Actions align="between">
                          <Button
                            variant="danger"
                            icon={Trash2}
                            loading={actionLoading === `audible-delete-${profileName}`}
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
                            Remove
                          </Button>
                          <div className="as-system-btn-group">
                            {!isActive && (
                              <Button
                                icon={Check}
                                loading={actionLoading === `audible-active-${profileName}`}
                                onClick={() => void handleSetActiveAudibleProfile(profileName)}
                              >
                                Make active
                              </Button>
                            )}
                            <Button
                              type="submit"
                              variant="primary"
                              icon={Save}
                              disabled={!renameDirty}
                              loading={actionLoading === `audible-rename-${profileName}`}
                            >
                              Save name
                            </Button>
                          </div>
                        </Actions>
                      </Stack>
                    </form>
                  )}
                </ListItem>
              );
            })}
          </List>
        </Panel>
      )}

      {/* ── Connect an Audible account ─────────────────────────────── */}
      {cli?.installed && (
        <Panel
          title={cli.authenticated ? "Add another Audible account" : "Connect your Audible account"}
          icon={Link2}
          description="A free Audible account is sufficient."
          tone={cli.authenticated ? undefined : "accent"}
        >
          <Stack gap="md">
            {audibleAuthError && (
              <Notice tone="danger" icon={AlertTriangle}>
                {audibleAuthError}
              </Notice>
            )}

            {audibleAuthStep !== "url" && audibleAuthStep !== "completing" && (
              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void handleAudibleAuthStart();
                }}
              >
                <Stack gap="md">
                  <FormGrid>
                    <Field label="Marketplace" htmlFor="audible-auth-marketplace">
                      <select
                        id="audible-auth-marketplace"
                        className="form-control"
                        value={audibleAuthMarketplace}
                        onChange={(e) => setAudibleAuthMarketplace(e.target.value)}
                      >
                        {MARKETPLACES.map((option) => (
                          <option key={option.value} value={option.value}>
                            {option.label}
                          </option>
                        ))}
                      </select>
                    </Field>
                    <Field label="Profile name" htmlFor="audible-auth-profile" hint="How this account is labelled here.">
                      <input
                        id="audible-auth-profile"
                        className="form-control"
                        autoComplete="off"
                        autoCapitalize="none"
                        placeholder="e.g. family"
                        value={audibleAuthProfileName}
                        onChange={(e) => setAudibleAuthProfileName(e.target.value)}
                      />
                    </Field>
                  </FormGrid>
                  <Actions>
                    <Button type="submit" variant="primary" icon={Network}>
                      Generate login URL
                    </Button>
                  </Actions>
                </Stack>
              </form>
            )}

            {audibleAuthStep === "url" && !audibleAuthUrl && (
              <p className="as-system-working">
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                Generating login URL…
              </p>
            )}

            {audibleAuthStep === "url" && audibleAuthUrl && (
              <ol className="as-system-steps">
                <li>
                  <span className="as-system-step-num" aria-hidden="true">1</span>
                  <div className="as-system-step-body">
                    <p>
                      Open the link and log in with your Amazon / Audible account
                      {audibleAuthProfileName ? (
                        <> for profile <strong className="as-system-wrap">{audibleAuthProfileName}</strong></>
                      ) : null}
                      .
                    </p>
                    <Actions align="start">
                      <a
                        className="as-btn as-btn-primary"
                        href={audibleAuthUrl}
                        target="_blank"
                        rel="noreferrer"
                      >
                        <ExternalLink size={16} aria-hidden="true" />
                        Open Audible login
                      </a>
                      <Button
                        icon={Copy}
                        onClick={() => void navigator.clipboard?.writeText(audibleAuthUrl)}
                      >
                        Copy URL
                      </Button>
                    </Actions>
                  </div>
                </li>
                <li>
                  <span className="as-system-step-num" aria-hidden="true">2</span>
                  <div className="as-system-step-body">
                    <p>
                      After logging in your browser shows an error page — that's expected. Copy the
                      full URL from the address bar and paste it here.
                    </p>
                    <Field label="Redirect URL" htmlFor="audible-auth-redirect">
                      <textarea
                        id="audible-auth-redirect"
                        className="form-control as-mono"
                        placeholder="https://www.amazon.com/ap/maplanding?..."
                        value={audibleAuthRedirect}
                        rows={3}
                        autoCapitalize="none"
                        autoCorrect="off"
                        spellCheck={false}
                        onChange={(e) => setAudibleAuthRedirect(e.target.value)}
                      />
                    </Field>
                  </div>
                </li>
                <li className="as-system-steps-actions">
                  <Actions>
                    <Button variant="ghost" icon={X} onClick={resetAuthFlow}>
                      Cancel
                    </Button>
                    <Button
                      variant="primary"
                      icon={Check}
                      disabled={!audibleAuthRedirect.trim()}
                      onClick={() => void handleAudibleAuthComplete()}
                    >
                      Complete setup
                    </Button>
                  </Actions>
                </li>
              </ol>
            )}

            {audibleAuthStep === "completing" && (
              <p className="as-system-working">
                <Loader2 size={15} className="animate-spin" aria-hidden="true" />
                Completing authentication…
              </p>
            )}
          </Stack>
        </Panel>
      )}

      {/* ── Maintenance + storage ──────────────────────────────────── */}
      <Columns>
        <Panel title="Maintenance" icon={Wrench} flush>
          <List>
            <ListItem
              leading={<span className="as-system-profile-icon"><Database size={18} aria-hidden="true" /></span>}
              title="Create backup"
              subtitle="Snapshot the current database to a timestamped file"
            >
              <Actions align="start">
                <Button
                  variant="primary"
                  icon={Database}
                  loading={actionLoading === "create-backup"}
                  onClick={() => void handleCreateBackup()}
                >
                  Backup now
                </Button>
              </Actions>
            </ListItem>
            <ListItem
              leading={<span className="as-system-profile-icon"><RefreshCw size={18} aria-hidden="true" /></span>}
              title="Full library rescan"
              subtitle="Re-index all source paths and refresh book metadata"
            >
              <Actions align="start">
                <Button
                  icon={RefreshCw}
                  loading={actionLoading === "rescan-library"}
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
                  Rescan all
                </Button>
              </Actions>
            </ListItem>
          </List>
        </Panel>

        <Panel title="Paths & storage" icon={HardDrive}>
          <KeyValues
            items={[
              { label: "Cover storage", value: dashboard.library.coversRoot, mono: true },
              { label: "Configured libraries", value: dashboard.stats.libraries },
              { label: "Enabled sources", value: enabledSourceCount },
              { label: "Total backups", value: dashboard.backups.length },
            ]}
          />
        </Panel>
      </Columns>

      {/* ── Backup history ─────────────────────────────────────────── */}
      <Panel
        title="Backup history"
        icon={Database}
        description={
          dashboard.backups.length > 0
            ? `${dashboard.backups.length} ${dashboard.backups.length === 1 ? "backup" : "backups"} · ${formatBytes(
                dashboard.backups.reduce((total, backup) => total + backup.size, 0)
              )} total`
            : undefined
        }
        flush
      >
        {dashboard.backups.length === 0 ? (
          <EmptyState icon={Database} title="No backups yet">
            Use "Backup now" under Maintenance to create the first snapshot.
          </EmptyState>
        ) : (
          <List>
            {dashboard.backups.map((backup) => (
              <ListItem
                key={backup.name}
                title={<span className="as-system-wrap as-mono">{backup.name}</span>}
                subtitle={formatDate(backup.createdAt)}
                trailing={<Badge>{formatBytes(backup.size)}</Badge>}
              />
            ))}
          </List>
        )}
      </Panel>

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
    </Stack>
  );
}
