import { useState } from "react";
import { KeyRound, Loader2, User } from "lucide-react";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";
import { useToast } from "../context/ToastContext";

interface ApiUser {
  id: string;
  username: string;
  email?: string | null;
  role: string;
}

export default function AccountSettingsPage() {
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();

  // Profile form state
  const [username, setUsername] = useState(user?.username ?? "");
  const [email, setEmail] = useState(user?.email ?? "");
  const [profileLoading, setProfileLoading] = useState(false);

  // Password form state
  const [currentPassword, setCurrentPassword] = useState("");
  const [newPassword, setNewPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [passwordLoading, setPasswordLoading] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileLoading(true);

    try {
      const updates: Promise<{ data: ApiUser }>[] = [];

      if (username.trim() && username.trim() !== user.username) {
        updates.push(api.patch<ApiUser>("/auth/me/username", { username: username.trim() }));
      }
      if (email.trim() !== (user.email ?? "")) {
        updates.push(api.patch<ApiUser>("/auth/me/email", { email: email.trim() }));
      }

      if (updates.length === 0) {
        showToast({ title: "No changes to save", tone: "info" });
        return;
      }

      const results = await Promise.all(updates);
      const latest = results[results.length - 1].data;
      updateUser(latest);
      setUsername(latest.username);
      setEmail(latest.email ?? "");
      showToast({ title: "Profile updated", tone: "success" });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast({ title: "Update failed", description: msg ?? "Could not save changes.", tone: "error" });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast({ title: "Passwords do not match", tone: "error" });
      return;
    }
    setPasswordLoading(true);
    try {
      await api.patch("/auth/me/password", { currentPassword, newPassword });
      setCurrentPassword("");
      setNewPassword("");
      setConfirmPassword("");
      showToast({ title: "Password updated", tone: "success" });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast({ title: "Update failed", description: msg ?? "Could not change password.", tone: "error" });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="admin-settings-page">
      <div className="admin-settings-page-shell">
        <div className="admin-page-header">
          <div className="admin-page-title-row">
            <h1 className="admin-page-title">Account Settings</h1>
          </div>
          <p className="admin-page-subtitle">Manage your profile and password.</p>
        </div>

        <div className="admin-panel-stack" style={{ maxWidth: 560 }}>

          {/* Profile */}
          <div className="card admin-section-card">
            <div className="admin-section-head">
              <div>
                <h3><User size={15} style={{ verticalAlign: "middle", marginRight: 7 }} />Profile</h3>
                <p className="admin-library-meta-text">Update your display name and email address.</p>
              </div>
            </div>

            <form onSubmit={(e) => void handleSaveProfile(e)} className="account-form">
              <div className="account-field">
                <label className="account-field-label" htmlFor="acc-username">Username</label>
                <input
                  id="acc-username"
                  className="form-control"
                  type="text"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  minLength={2}
                  maxLength={32}
                  autoComplete="username"
                />
              </div>

              <div className="account-field">
                <label className="account-field-label" htmlFor="acc-email">Email</label>
                <input
                  id="acc-email"
                  className="form-control"
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                  placeholder="you@example.com"
                />
              </div>

              <div className="account-form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={profileLoading}
                >
                  {profileLoading && <Loader2 size={14} className="animate-spin" />}
                  Save Profile
                </button>
              </div>
            </form>
          </div>

          {/* Change Password */}
          <div className="card admin-section-card">
            <div className="admin-section-head">
              <div>
                <h3><KeyRound size={15} style={{ verticalAlign: "middle", marginRight: 7 }} />Change Password</h3>
                <p className="admin-library-meta-text">You'll need your current password to set a new one.</p>
              </div>
            </div>

            <form onSubmit={(e) => void handleChangePassword(e)} className="account-form">
              <div className="account-field">
                <label className="account-field-label" htmlFor="acc-current-pw">Current password</label>
                <input
                  id="acc-current-pw"
                  className="form-control"
                  type="password"
                  value={currentPassword}
                  onChange={(e) => setCurrentPassword(e.target.value)}
                  autoComplete="current-password"
                  required
                />
              </div>

              <div className="account-field">
                <label className="account-field-label" htmlFor="acc-new-pw">New password</label>
                <input
                  id="acc-new-pw"
                  className="form-control"
                  type="password"
                  value={newPassword}
                  onChange={(e) => setNewPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>

              <div className="account-field">
                <label className="account-field-label" htmlFor="acc-confirm-pw">Confirm new password</label>
                <input
                  id="acc-confirm-pw"
                  className="form-control"
                  type="password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  minLength={6}
                  required
                />
              </div>

              <div className="account-form-actions">
                <button
                  type="submit"
                  className="btn btn-primary"
                  disabled={passwordLoading}
                >
                  {passwordLoading && <Loader2 size={14} className="animate-spin" />}
                  Update Password
                </button>
              </div>
            </form>
          </div>

        </div>
      </div>
    </div>
  );
}
