import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Bug, KeyRound, Loader2, User } from 'lucide-react';
import { isAxiosError } from 'axios';
import api from '../api/axios';
import { useAuth } from '../context/AuthContext';
import { useToast } from '../context/ToastContext';

interface ApiUser {
  id: string;
  username: string;
  email?: string | null;
  role: string;
}

const issueTypes = [
  { value: 'playback', label: 'Playback issue' },
  { value: 'library', label: 'Library or scanning' },
  { value: 'metadata', label: 'Book metadata' },
  { value: 'account', label: 'Account or login' },
  { value: 'performance', label: 'Slow or unresponsive' },
  { value: 'visual', label: 'Visual problem' },
  { value: 'other', label: 'Something else' },
];

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

  const [reportType, setReportType] = useState(issueTypes[0].value);
  const [reportComment, setReportComment] = useState('');
  const [reportLoading, setReportLoading] = useState(false);

  const handleSaveProfile = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!user) return;
    setProfileLoading(true);
    try {
      const updates: Promise<{ data: ApiUser }>[] = [];
      if (username.trim() && username.trim() !== user.username)
        updates.push(api.patch<ApiUser>('/auth/me/username', { username: username.trim() }));
      if (email.trim() !== (user.email ?? ''))
        updates.push(api.patch<ApiUser>('/auth/me/email', { email: email.trim() }));
      if (updates.length === 0) { showToast({ title: 'No changes to save', tone: 'info' }); return; }
      const results = await Promise.all(updates);
      const latest = results[results.length - 1].data;
      updateUser(latest);
      setUsername(latest.username);
      setEmail(latest.email ?? '');
      showToast({ title: 'Profile updated', tone: 'success' });
    } catch (err) {
      const msg = isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : undefined;
      showToast({ title: 'Update failed', description: msg ?? 'Could not save changes.', tone: 'error' });
    } finally {
      setProfileLoading(false);
    }
  };

  const handleChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (newPassword !== confirmPassword) { showToast({ title: 'Passwords do not match', tone: 'error' }); return; }
    setPasswordLoading(true);
    try {
      await api.patch('/auth/me/password', { currentPassword, newPassword });
      setCurrentPassword(''); setNewPassword(''); setConfirmPassword('');
      showToast({ title: 'Password updated', tone: 'success' });
    } catch (err) {
      const msg = isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : undefined;
      showToast({ title: 'Update failed', description: msg ?? 'Could not change password.', tone: 'error' });
    } finally {
      setPasswordLoading(false);
    }
  };

  const handleSubmitReport = async (e: React.FormEvent) => {
    e.preventDefault();
    setReportLoading(true);
    try {
      await api.post('/reports', {
        type: reportType,
        comment: reportComment,
        path: `${window.location.pathname}${window.location.search}`,
      });
      setReportComment('');
      showToast({ title: 'Report submitted', description: 'An admin will review it.', tone: 'success' });
    } catch (err) {
      const msg = isAxiosError<{ error?: string }>(err) ? err.response?.data?.error : undefined;
      showToast({ title: 'Submit failed', description: msg ?? 'Could not submit the report.', tone: 'error' });
    } finally {
      setReportLoading(false);
    }
  };

  return (
    <div className="mobile-account-settings">
      <div className="mobile-account-header">
        <button className="mobile-account-back" onClick={() => navigate('/menu')} aria-label="Back">
          <ArrowLeft size={20} />
        </button>
        <h1 className="mobile-account-title">Settings</h1>
      </div>

      <div className="mobile-account-body">

        <section className="mobile-account-section">
          <div className="mobile-account-section-head">
            <User size={14} />
            <span>Profile</span>
          </div>
          <form onSubmit={(e) => void handleSaveProfile(e)} className="mobile-account-form">
            <div className="mobile-account-field">
              <label htmlFor="m-username">Username</label>
              <input id="m-username" className="form-control" type="text" value={username}
                onChange={(e) => setUsername(e.target.value)} minLength={2} maxLength={32} autoComplete="username" />
            </div>
            <div className="mobile-account-field">
              <label htmlFor="m-email">Email</label>
              <input id="m-email" className="form-control" type="email" value={email}
                onChange={(e) => setEmail(e.target.value)} autoComplete="email" placeholder="you@example.com" />
            </div>
            <button type="submit" className="btn btn-primary mobile-account-save" disabled={profileLoading}>
              {profileLoading && <Loader2 size={14} className="animate-spin" />}
              Save Profile
            </button>
          </form>
        </section>

        <section className="mobile-account-section">
          <div className="mobile-account-section-head">
            <KeyRound size={14} />
            <span>Security</span>
          </div>
          <form onSubmit={(e) => void handleChangePassword(e)} className="mobile-account-form">
            <div className="mobile-account-field">
              <label htmlFor="m-current-pw">Current password</label>
              <input id="m-current-pw" className="form-control" type="password" value={currentPassword}
                onChange={(e) => setCurrentPassword(e.target.value)} autoComplete="current-password" required />
            </div>
            <div className="mobile-account-field">
              <label htmlFor="m-new-pw">New password</label>
              <input id="m-new-pw" className="form-control" type="password" value={newPassword}
                onChange={(e) => setNewPassword(e.target.value)} autoComplete="new-password" minLength={6} required />
            </div>
            <div className="mobile-account-field">
              <label htmlFor="m-confirm-pw">Confirm new password</label>
              <input id="m-confirm-pw" className="form-control" type="password" value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)} autoComplete="new-password" minLength={6} required />
            </div>
            <button type="submit" className="btn btn-primary mobile-account-save" disabled={passwordLoading}>
              {passwordLoading && <Loader2 size={14} className="animate-spin" />}
              Update Password
            </button>
          </form>
        </section>

        <section className="mobile-account-section">
          <div className="mobile-account-section-head">
            <Bug size={14} />
            <span>Report an Issue</span>
          </div>
          <form onSubmit={(e) => void handleSubmitReport(e)} className="mobile-account-form">
            <div className="mobile-account-field">
              <label htmlFor="m-report-type">Issue type</label>
              <div className="select-wrap">
                <select id="m-report-type" className="form-control" value={reportType}
                  onChange={(e) => setReportType(e.target.value)}>
                  {issueTypes.map((o) => (
                    <option key={o.value} value={o.value}>{o.label}</option>
                  ))}
                </select>
              </div>
            </div>
            <div className="mobile-account-field">
              <label htmlFor="m-report-comment">Details</label>
              <textarea id="m-report-comment" className="form-control mobile-account-textarea"
                value={reportComment} onChange={(e) => setReportComment(e.target.value)}
                maxLength={2000} placeholder="Describe the problem." />
            </div>
            <button type="submit" className="btn btn-primary mobile-account-save" disabled={reportLoading}>
              {reportLoading ? <Loader2 size={14} className="animate-spin" /> : <Bug size={14} />}
              {reportLoading ? 'Submitting…' : 'Submit Report'}
            </button>
          </form>
        </section>

      </div>
    </div>
  );
};

export default MobileAccountSettings;
