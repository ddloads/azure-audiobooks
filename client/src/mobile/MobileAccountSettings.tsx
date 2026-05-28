import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, KeyRound, Loader2, User } from 'lucide-react';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface ApiUser {
  id: string;
  username: string;
  email?: string | null;
  role: string;
}

const MobileAccountSettings = () => {
  const { user, updateUser } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [username, setUsername] = useState(user?.username ?? '');
  const [email, setEmail] = useState(user?.email ?? '');
  const [profileLoading, setProfileLoading] = useState(false);

  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [passwordLoading, setPasswordLoading] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileLoading(true);
    try {
      const updates: Promise<{ data: ApiUser }>[] = [];
      if (username.trim() && username.trim() !== user.username) {
        updates.push(api.patch<ApiUser>('/auth/me/username', { username: username.trim() }));
      }
      if (email.trim() !== (user.email ?? '')) {
        updates.push(api.patch<ApiUser>('/auth/me/email', { email: email.trim() }));
      }
      if (updates.length === 0) {
        showToast({ title: 'No changes to save', tone: 'info' });
        return;
      }
      const results = await Promise.all(updates);
      const latest = results[results.length - 1].data;
      updateUser(latest);
      setUsername(latest.username);
      setEmail(latest.email ?? '');
      showToast({ title: 'Profile updated', tone: 'success' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast({ title: 'Update failed', description: msg ?? 'Could not save changes.', tone: 'error' });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) {
      showToast({ title: 'Passwords do not match', tone: 'error' });
      return;
    }
    setPasswordLoading(true);
    try {
      await api.patch('/auth/me/password', { currentPassword, newPassword });
      setCurrentPassword('');
      setNewPassword('');
      setConfirmPassword('');
      showToast({ title: 'Password updated', tone: 'success' });
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      showToast({ title: 'Update failed', description: msg ?? 'Could not change password.', tone: 'error' });
    } finally {
      setPasswordLoading(false);
    }
  };

  return (
    <div className="mobile-account-settings">

      {/* Header */}
      <div className="mobile-account-header">
        <button className="mobile-account-back" onClick={() => navigate('/menu')} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <h1 className="mobile-account-title">Account Settings</h1>
      </div>

      <div className="mobile-account-body">

        {/* Profile */}
        <section className="mobile-account-section">
          <div className="mobile-account-section-head">
            <User size={14} />
            <span>Profile</span>
          </div>

          <form onSubmit={(e) => void handleSaveProfile(e)} className="mobile-account-form">
            <div className="mobile-account-field">
              <label htmlFor="m-username">Username</label>
              <input
                id="m-username"
                className="form-control"
                type="text"
                value={username}
                onChange={(e) => setUsername(e.target.value)}
                minLength={2}
                maxLength={32}
                autoComplete="username"
              />
            </div>

            <div className="mobile-account-field">
              <label htmlFor="m-email">Email</label>
              <input
                id="m-email"
                className="form-control"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                placeholder="you@example.com"
              />
            </div>

            <button type="submit" className="btn btn-primary mobile-account-save" disabled={profileLoading}>
              {profileLoading ? <Loader2 size={14} className="animate-spin" /> : null}
              Save Profile
            </button>
          </form>
        </section>

        {/* Change Password */}
        <section className="mobile-account-section">
          <div className="mobile-account-section-head">
            <KeyRound size={14} />
            <span>Change Password</span>
          </div>

          <form onSubmit={(e) => void handleChangePassword(e)} className="mobile-account-form">
            <div className="mobile-account-field">
              <label htmlFor="m-current-pw">Current password</label>
              <input
                id="m-current-pw"
                className="form-control"
                type="password"
                value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)}
                autoComplete="current-password"
                required
              />
            </div>

            <div className="mobile-account-field">
              <label htmlFor="m-new-pw">New password</label>
              <input
                id="m-new-pw"
                className="form-control"
                type="password"
                value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>

            <div className="mobile-account-field">
              <label htmlFor="m-confirm-pw">Confirm new password</label>
              <input
                id="m-confirm-pw"
                className="form-control"
                type="password"
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                autoComplete="new-password"
                minLength={6}
                required
              />
            </div>

            <button type="submit" className="btn btn-primary mobile-account-save" disabled={passwordLoading}>
              {passwordLoading ? <Loader2 size={14} className="animate-spin" /> : null}
              Update Password
            </button>
          </form>
        </section>

      </div>
    </div>
  );
};

export default MobileAccountSettings;
