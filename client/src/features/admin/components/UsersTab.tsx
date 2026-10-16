import { useMemo, useState } from "react";
import { Save, Trash2, UserPlus, Users, X } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import ConfirmDialog from "../../../components/ConfirmDialog";
import type { AdminUser, PendingAdminConfirm } from "../types";
import { getErrorMessage } from "../helpers";
import {
  Actions,
  Avatar,
  Badge,
  Button,
  EmptyState,
  Field,
  FormGrid,
  List,
  ListItem,
  Panel,
  PasswordInput,
  SearchInput,
  Stack,
  Toolbar,
} from "../ui";

interface UsersTabProps {
  users: AdminUser[];
  onRefresh: () => Promise<unknown> | unknown;
}

const EMPTY_DRAFT = { username: "", email: "", password: "", role: "USER" };

export default function UsersTab({ users, onRefresh }: UsersTabProps) {
  const { showToast } = useToast();
  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState(EMPTY_DRAFT);
  const [query, setQuery] = useState("");
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirm | null>(null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = q
      ? users.filter((user) => user.username.toLowerCase().includes(q) || (user.email ?? "").toLowerCase().includes(q))
      : users;
    // Admins first, then alphabetical.
    return [...list].sort((a, b) =>
      a.role === b.role ? a.username.localeCompare(b.username) : a.role === "ADMIN" ? -1 : 1,
    );
  }, [users, query]);

  const adminCount = users.filter((user) => user.role === "ADMIN").length;

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionLoading(key);
    try {
      await action();
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateUser = () =>
    runAction("create-user", async () => {
      try {
        await api.post("/admin/users", {
          username: draft.username.trim(),
          email: draft.email.trim(),
          password: draft.password,
          role: draft.role,
        });
        showToast({ title: "User created", description: `Created ${draft.username.trim()}`, tone: "success" });
        setDraft(EMPTY_DRAFT);
        setCreating(false);
        await onRefresh();
      } catch (error) {
        showToast({ title: "Failed to create user", description: getErrorMessage(error, "Failed to create user"), tone: "error" });
      }
    });

  const handleUpdateUser = (user: AdminUser) =>
    runAction(`update-user-${user.id}`, async () => {
      try {
        const payload: { role?: string; password?: string } = {};
        const role = roleDrafts[user.id];
        if (role && role !== user.role) payload.role = role;
        if (passwordDrafts[user.id]?.trim()) payload.password = passwordDrafts[user.id];
        if (!payload.role && !payload.password) return;

        await api.patch(`/admin/users/${user.id}`, payload);
        setPasswordDrafts((current) => ({ ...current, [user.id]: "" }));
        showToast({
          title: "User updated",
          description: payload.password ? `Password reset for ${user.username}` : `${user.username} is now ${payload.role === "ADMIN" ? "an admin" : "a user"}`,
          tone: "success",
        });
        await onRefresh();
      } catch (error) {
        showToast({ title: "Failed to update user", description: getErrorMessage(error, "Failed to update user"), tone: "error" });
      }
    });

  const handleDeleteUser = (user: AdminUser) =>
    runAction(`delete-user-${user.id}`, async () => {
      try {
        await api.delete(`/admin/users/${user.id}`);
        showToast({ title: "User deleted", description: `Deleted ${user.username}`, tone: "success" });
        setExpandedId(null);
        await onRefresh();
      } catch (error) {
        showToast({ title: "Failed to delete user", description: getErrorMessage(error, "Failed to delete user"), tone: "error" });
      }
    });

  const canCreate = draft.username.trim() && draft.email.trim() && draft.password;

  return (
    <Stack>
      {creating && (
        <Panel
          title="New user"
          icon={UserPlus}
          description="They can change this temporary password after signing in."
          tone="accent"
        >
          <form
            onSubmit={(event) => {
              event.preventDefault();
              if (canCreate) void handleCreateUser();
            }}
          >
            <Stack gap="md">
              <FormGrid>
                <Field label="Username" htmlFor="new-user-name">
                  <input
                    id="new-user-name"
                    className="form-control"
                    autoComplete="off"
                    autoCapitalize="none"
                    value={draft.username}
                    onChange={(e) => setDraft({ ...draft, username: e.target.value })}
                  />
                </Field>
                <Field label="Recovery email" htmlFor="new-user-email">
                  <input
                    id="new-user-email"
                    className="form-control"
                    type="email"
                    autoComplete="off"
                    value={draft.email}
                    onChange={(e) => setDraft({ ...draft, email: e.target.value })}
                  />
                </Field>
                <Field label="Temporary password" htmlFor="new-user-password">
                  <PasswordInput
                    id="new-user-password"
                    autoComplete="new-password"
                    value={draft.password}
                    onChange={(e) => setDraft({ ...draft, password: e.target.value })}
                  />
                </Field>
                <Field label="Role" htmlFor="new-user-role">
                  <select
                    id="new-user-role"
                    className="form-control"
                    value={draft.role}
                    onChange={(e) => setDraft({ ...draft, role: e.target.value })}
                  >
                    <option value="USER">Listener</option>
                    <option value="ADMIN">Admin</option>
                  </select>
                </Field>
              </FormGrid>
              <Actions>
                <Button variant="ghost" icon={X} onClick={() => { setCreating(false); setDraft(EMPTY_DRAFT); }}>
                  Cancel
                </Button>
                <Button type="submit" variant="primary" icon={UserPlus} disabled={!canCreate} loading={actionLoading === "create-user"}>
                  Create user
                </Button>
              </Actions>
            </Stack>
          </form>
        </Panel>
      )}

      <Panel
        title="Accounts"
        icon={Users}
        description={`${users.length} ${users.length === 1 ? "account" : "accounts"} · ${adminCount} ${adminCount === 1 ? "admin" : "admins"}`}
        actions={!creating && <Button variant="primary" size="sm" icon={UserPlus} onClick={() => setCreating(true)}>Add user</Button>}
        flush
      >
        {users.length > 6 && (
          <div className="as-panel-body" style={{ paddingTop: 0 }}>
            <Toolbar>
              <SearchInput placeholder="Search by name or email" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Search users" />
            </Toolbar>
          </div>
        )}
        {filtered.length === 0 ? (
          <EmptyState icon={Users} title={query ? "No matching accounts" : "No accounts yet"} />
        ) : (
          <List>
            {filtered.map((user) => {
              const expanded = expandedId === user.id;
              const roleDraft = roleDrafts[user.id] ?? user.role;
              const passwordDraft = passwordDrafts[user.id] ?? "";
              const dirty = roleDraft !== user.role || passwordDraft.trim().length > 0;
              return (
                <ListItem
                  key={user.id}
                  selected={expanded}
                  onClick={() => setExpandedId(expanded ? null : user.id)}
                  leading={<Avatar name={user.username} tone={user.role === "ADMIN" ? "accent" : "neutral"} />}
                  title={
                    <>
                      {user.username}
                      {user.role === "ADMIN" && <Badge tone="accent">Admin</Badge>}
                    </>
                  }
                  subtitle={user.email || "No recovery email"}
                  meta={`${user._count.progress} ${user._count.progress === 1 ? "book" : "books"} listened · joined ${new Date(user.createdAt).toLocaleDateString([], { month: "short", day: "numeric", year: "numeric" })}`}
                  chevron={!expanded}
                >
                  {expanded && (
                    <Stack gap="md">
                      <FormGrid>
                        <Field label="Role" htmlFor={`role-${user.id}`}>
                          <select
                            id={`role-${user.id}`}
                            className="form-control"
                            value={roleDraft}
                            onChange={(e) => setRoleDrafts((current) => ({ ...current, [user.id]: e.target.value }))}
                          >
                            <option value="USER">Listener</option>
                            <option value="ADMIN">Admin</option>
                          </select>
                        </Field>
                        <Field label="Reset password" htmlFor={`password-${user.id}`} hint="Leave empty to keep the current password.">
                          <PasswordInput
                            id={`password-${user.id}`}
                            autoComplete="new-password"
                            placeholder="New password"
                            value={passwordDraft}
                            onChange={(e) => setPasswordDrafts((current) => ({ ...current, [user.id]: e.target.value }))}
                          />
                        </Field>
                      </FormGrid>
                      <Actions align="between">
                        <Button
                          variant="danger"
                          icon={Trash2}
                          loading={actionLoading === `delete-user-${user.id}`}
                          onClick={() =>
                            setPendingConfirm({
                              title: "Delete user",
                              message: `Delete "${user.username}"? Their listening progress is removed too.`,
                              confirmLabel: "Delete user",
                              tone: "danger",
                              onConfirm: () => void handleDeleteUser(user),
                            })
                          }
                        >
                          Delete
                        </Button>
                        <Button
                          variant="primary"
                          icon={Save}
                          disabled={!dirty}
                          loading={actionLoading === `update-user-${user.id}`}
                          onClick={() => void handleUpdateUser(user)}
                        >
                          Save changes
                        </Button>
                      </Actions>
                    </Stack>
                  )}
                </ListItem>
              );
            })}
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
