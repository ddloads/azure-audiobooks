import { useState, useEffect } from "react";
import { Eye, EyeOff, Loader2, Shield, Trash2, UserPlus } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import ConfirmDialog from "../../../components/ConfirmDialog";
import type { AdminUser, PendingAdminConfirm } from "../types";
import { formatDate, getErrorMessage } from "../helpers";

interface UsersTabProps {
  users: AdminUser[];
  onRefresh: () => Promise<unknown> | unknown;
}

export default function UsersTab({ users, onRefresh }: UsersTabProps) {
  const { showToast } = useToast();
  const [newUsername, setNewUsername] = useState("");
  const [newEmail, setNewEmail] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [showNewPassword, setShowNewPassword] = useState(false);
  const [newRole, setNewRole] = useState("USER");

  const [roleDrafts, setRoleDrafts] = useState<Record<string, string>>({});
  const [passwordDrafts, setPasswordDrafts] = useState<Record<string, string>>({});
  const [visiblePasswordDrafts, setVisiblePasswordDrafts] = useState<Record<string, boolean>>({});

  const [actionLoading, setActionLoading] = useState<string | null>(null);
  const [pendingConfirm, setPendingConfirm] = useState<PendingAdminConfirm | null>(null);

  useEffect(() => {
    if (users) {
      setRoleDrafts((prev) => {
        const next = { ...prev };
        users.forEach((user) => {
          if (next[user.id] === undefined) {
            next[user.id] = user.role;
          }
        });
        return next;
      });
    }
  }, [users]);

  const runAction = async (key: string, action: () => Promise<void>) => {
    setActionLoading(key);
    try {
      await action();
    } finally {
      setActionLoading(null);
    }
  };

  const handleCreateUser = async () => {
    await runAction("create-user", async () => {
      try {
        await api.post("/admin/users", {
          username: newUsername.trim(),
          email: newEmail.trim(),
          password: newPassword,
          role: newRole,
        });
        showToast({
          title: "User created",
          description: `Created ${newUsername.trim()}`,
          tone: "success",
        });
        setNewUsername("");
        setNewEmail("");
        setNewPassword("");
        setNewRole("USER");
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to create user",
          description: getErrorMessage(error, "Failed to create user"),
          tone: "error",
        });
      }
    });
  };

  const handleUpdateUser = async (userId: string) => {
    await runAction(`update-user-${userId}`, async () => {
      try {
        const payload: { role?: string; password?: string } = {};
        if (roleDrafts[userId]) payload.role = roleDrafts[userId];
        if (passwordDrafts[userId]?.trim()) payload.password = passwordDrafts[userId];

        await api.patch(`/admin/users/${userId}`, payload);
        setPasswordDrafts((current) => ({ ...current, [userId]: "" }));
        showToast({
          title: "User updated",
          tone: "success",
        });
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to update user",
          description: getErrorMessage(error, "Failed to update user"),
          tone: "error",
        });
      }
    });
  };

  const handleDeleteUser = async (userId: string, username: string) => {
    await runAction(`delete-user-${userId}`, async () => {
      try {
        await api.delete(`/admin/users/${userId}`);
        showToast({
          title: "User deleted",
          description: `Deleted ${username}`,
          tone: "success",
        });
        await onRefresh();
      } catch (error) {
        showToast({
          title: "Failed to delete user",
          description: getErrorMessage(error, "Failed to delete user"),
          tone: "error",
        });
      }
    });
  };

  return (
    <div className="admin-panel-stack">
      <div className="card admin-section-card">
        <div className="admin-section-head">
          <h3>Create user</h3>
          <UserPlus size={15} />
        </div>
        <div className="admin-create-user-grid">
          <input
            className="form-control"
            placeholder="Username"
            value={newUsername}
            onChange={(e) => setNewUsername(e.target.value)}
          />
          <input
            className="form-control"
            placeholder="Recovery email"
            type="email"
            value={newEmail}
            onChange={(e) => setNewEmail(e.target.value)}
          />
          <div className="password-field">
            <input
              className="form-control password-input"
              placeholder="Temporary password"
              type={showNewPassword ? "text" : "password"}
              value={newPassword}
              onChange={(e) => setNewPassword(e.target.value)}
            />
            <button
              type="button"
              className="password-toggle"
              onClick={() => setShowNewPassword((current) => !current)}
              aria-label={showNewPassword ? "Hide password" : "Show password"}
            >
              {showNewPassword ? <EyeOff size={16} /> : <Eye size={16} />}
            </button>
          </div>
          <select
            className="form-control"
            value={newRole}
            onChange={(e) => setNewRole(e.target.value)}
          >
            <option value="USER">User</option>
            <option value="ADMIN">Admin</option>
          </select>
          <button
            className="btn btn-primary"
            type="button"
            disabled={
              !newUsername.trim() ||
              !newEmail.trim() ||
              !newPassword ||
              actionLoading === "create-user"
            }
            onClick={() => void handleCreateUser()}
          >
            {actionLoading === "create-user" ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <UserPlus size={15} />
            )}
            Create
          </button>
        </div>
      </div>

      <div className="card admin-section-card">
        <div className="admin-section-head">
          <h3>All accounts</h3>
          <Shield size={15} />
        </div>
        <div className="admin-table">
          {users.map((user) => (
            <div key={user.id} className="admin-table-row">
              <div className="admin-row-with-avatar">
                <div className="admin-user-avatar">
                  {user.username.slice(0, 2).toUpperCase()}
                </div>
                <div className="admin-user-summary">
                  <strong>{user.username}</strong>
                  <small>
                    <span className={`admin-role-badge admin-role-${user.role.toLowerCase()}`}>
                      {user.role}
                    </span>
                    {" · "}{user.email || "No recovery email"} · {user._count.progress} listens · joined {formatDate(user.createdAt)}
                  </small>
                </div>
              </div>

              <div className="admin-user-controls">
                <select
                  className="form-control"
                  value={roleDrafts[user.id] ?? user.role}
                  onChange={(e) =>
                    setRoleDrafts((current) => ({
                      ...current,
                      [user.id]: e.target.value,
                    }))
                  }
                >
                  <option value="USER">User</option>
                  <option value="ADMIN">Admin</option>
                </select>
                <div className="password-field">
                  <input
                    className="form-control password-input"
                    type={visiblePasswordDrafts[user.id] ? "text" : "password"}
                    placeholder="New password"
                    value={passwordDrafts[user.id] ?? ""}
                    onChange={(e) =>
                      setPasswordDrafts((current) => ({
                        ...current,
                        [user.id]: e.target.value,
                      }))
                    }
                  />
                  <button
                    type="button"
                    className="password-toggle"
                    onClick={() =>
                      setVisiblePasswordDrafts((current) => ({
                        ...current,
                        [user.id]: !current[user.id],
                      }))
                    }
                    aria-label={
                      visiblePasswordDrafts[user.id] ? "Hide password" : "Show password"
                    }
                  >
                    {visiblePasswordDrafts[user.id] ? (
                      <EyeOff size={16} />
                    ) : (
                      <Eye size={16} />
                    )}
                  </button>
                </div>
                <button
                  className="btn btn-secondary"
                  type="button"
                  disabled={actionLoading === `update-user-${user.id}`}
                  onClick={() => void handleUpdateUser(user.id)}
                >
                  {actionLoading === `update-user-${user.id}` ? (
                    <Loader2 size={14} className="animate-spin" />
                  ) : null}
                  Save
                </button>
                <button
                  className="btn admin-danger-btn"
                  type="button"
                  disabled={actionLoading === `delete-user-${user.id}`}
                  onClick={() =>
                    setPendingConfirm({
                      title: "Delete User",
                      message: `Delete user "${user.username}"? This also removes saved progress.`,
                      confirmLabel: "Delete User",
                      tone: "danger",
                      onConfirm: () => void handleDeleteUser(user.id, user.username),
                    })
                  }
                >
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          ))}
          {users.length === 0 && (
            <div className="admin-empty-state">No accounts found.</div>
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
