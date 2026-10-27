import { useEffect, useState } from "react";
import { Copy, Link2, Trash2, UserCheck } from "lucide-react";
import api from "../../../../api/axios";
import { useToast } from "../../../../context/ToastContext";
import type { AdminInvite, RegistrationSettings } from "../../types";
import { getErrorMessage } from "../../helpers";
import { Actions, Badge, Button, EmptyState, Field, FormGrid, List, ListItem, Notice, Panel, Stack, ToggleRow } from "../../ui";

const EXPIRY_OPTIONS = [
  { days: 1, label: "1 day" },
  { days: 7, label: "7 days" },
  { days: 30, label: "30 days" },
];

const STATUS_TONE = { active: "success", used: "neutral", expired: "warning" } as const;

const formatDate = (value: string) =>
  new Date(value).toLocaleDateString(undefined, { day: "numeric", month: "short", year: "numeric" });

const inviteSubtitle = (invite: AdminInvite) => {
  if (invite.status === "used") return `Used by ${invite.usedBy ?? "a deleted user"} on ${formatDate(invite.usedAt!)}`;
  if (invite.status === "expired") return `Expired ${formatDate(invite.expiresAt)}`;
  return `Expires ${formatDate(invite.expiresAt)}${invite.createdBy ? ` · created by ${invite.createdBy}` : ""}`;
};

/** Open registration switch and single-use invite links. */
export default function RegistrationPanel() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<RegistrationSettings | null>(null);
  const [invites, setInvites] = useState<AdminInvite[]>([]);
  const [note, setNote] = useState("");
  const [expiresInDays, setExpiresInDays] = useState(7);
  const [newLink, setNewLink] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const reportError = (title: string, error: unknown) =>
    showToast({ title, description: getErrorMessage(error, title), tone: "error" });

  const loadInvites = () =>
    api
      .get<AdminInvite[]>("/admin/invites")
      .then((response) => setInvites(response.data))
      .catch((error) => reportError("Failed to load invites", error));

  useEffect(() => {
    api
      .get<RegistrationSettings>("/admin/settings/registration")
      .then((response) => setSettings(response.data))
      .catch((error) => reportError("Failed to load registration settings", error));
    void loadInvites();
  }, []);

  const handleToggle = async () => {
    if (!settings) return;
    setBusy("toggle");
    try {
      const response = await api.patch<RegistrationSettings>("/admin/settings/registration", {
        openRegistration: !settings.openRegistration,
      });
      setSettings(response.data);
      showToast({
        title: response.data.openRegistration ? "Anyone can now create an account" : "Registration is now invite-only",
        tone: "success",
      });
    } catch (error) {
      reportError("Failed to update registration", error);
    } finally {
      setBusy(null);
    }
  };

  const handleCreate = async () => {
    setBusy("create");
    try {
      const response = await api.post<{ token: string }>("/admin/invites", { note: note.trim() || undefined, expiresInDays });
      setNewLink(`${window.location.origin}/register?invite=${encodeURIComponent(response.data.token)}`);
      setNote("");
      void loadInvites();
    } catch (error) {
      reportError("Failed to create invite", error);
    } finally {
      setBusy(null);
    }
  };

  const handleCopy = async () => {
    if (!newLink) return;
    try {
      await navigator.clipboard.writeText(newLink);
      showToast({ title: "Invite link copied", tone: "success" });
    } catch {
      showToast({ title: "Couldn't copy automatically", description: "Select the link and copy it by hand.", tone: "error" });
    }
  };

  const handleRevoke = async (invite: AdminInvite) => {
    setBusy(invite.id);
    try {
      await api.delete(`/admin/invites/${invite.id}`);
      showToast({ title: "Invite revoked", tone: "success" });
      void loadInvites();
    } catch (error) {
      reportError("Failed to revoke invite", error);
    } finally {
      setBusy(null);
    }
  };

  return (
    <Panel
      title="Registration"
      icon={UserCheck}
      description="Control who can create an account. Invite links always work, even when registration is closed."
    >
      <Stack gap="md">
        <ToggleRow
          title="Anyone can create an account"
          description={
            settings?.openRegistration === false
              ? "Off: the sign-up page only works with an invite link, and the login page hides the sign-up link."
              : "On: anyone who can reach this server can sign up. Turn this off if the server is on the internet."
          }
          checked={settings?.openRegistration ?? false}
          disabled={!settings || busy === "toggle"}
          onChange={() => void handleToggle()}
        />

        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleCreate();
          }}
        >
          <Stack gap="sm">
            <FormGrid>
              <Field label="Who is it for? (optional)" htmlFor="invite-note" hint="Only admins see this note.">
                <input
                  id="invite-note"
                  className="form-control"
                  value={note}
                  maxLength={120}
                  onChange={(event) => setNote(event.target.value)}
                  placeholder="e.g. Sam's tablet"
                />
              </Field>
              <Field label="Link expires after" htmlFor="invite-expiry">
                <select
                  id="invite-expiry"
                  className="form-control"
                  value={expiresInDays}
                  onChange={(event) => setExpiresInDays(Number(event.target.value))}
                >
                  {EXPIRY_OPTIONS.map((option) => (
                    <option key={option.days} value={option.days}>{option.label}</option>
                  ))}
                </select>
              </Field>
            </FormGrid>
            <Actions align="start">
              <Button type="submit" variant="primary" icon={Link2} loading={busy === "create"}>
                Create invite link
              </Button>
            </Actions>
          </Stack>
        </form>

        {newLink && (
          <Notice tone="success" icon={Link2}>
            <Stack gap="sm">
              <span>Send this link to the person you're inviting. It works once, and you won't see it again after leaving this page.</span>
              <input className="form-control" readOnly value={newLink} onFocus={(event) => event.currentTarget.select()} aria-label="Invite link" />
              <Actions align="start">
                <Button size="sm" icon={Copy} onClick={() => void handleCopy()}>Copy link</Button>
              </Actions>
            </Stack>
          </Notice>
        )}

        {invites.length === 0 ? (
          <EmptyState icon={Link2} title="No recent invites">
            Invite links you create show up here until 30 days after they were made.
          </EmptyState>
        ) : (
          <List>
            {invites.map((invite) => (
              <ListItem
                key={invite.id}
                title={invite.note || "Invite"}
                subtitle={inviteSubtitle(invite)}
                meta={<Badge tone={STATUS_TONE[invite.status]}>{invite.status}</Badge>}
                trailing={
                  invite.status === "active" ? (
                    <Button
                      size="sm"
                      variant="ghost"
                      icon={Trash2}
                      iconOnly
                      aria-label="Revoke invite"
                      title="Revoke invite"
                      loading={busy === invite.id}
                      onClick={() => void handleRevoke(invite)}
                    />
                  ) : undefined
                }
              />
            ))}
          </List>
        )}
      </Stack>
    </Panel>
  );
}
