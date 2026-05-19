import { isAxiosError } from "axios";
import { useState, type FormEvent } from "react";
import { useLocation } from "react-router-dom";
import { Loader2, Mail } from "lucide-react";
import api from "../api/axios";
import { useAuth } from "../context/AuthContext";

const getErrorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ error?: string }>(error) ? error.response?.data?.error || fallback : fallback;

export default function AccountEmailPrompt() {
  const { user, loading, updateUser } = useAuth();
  const location = useLocation();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);

  const isAuthPage = location.pathname === "/login" || location.pathname === "/register";
  const shouldPrompt = !loading && user && !user.email && !isAuthPage;

  if (!shouldPrompt) return null;

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError("");

    try {
      const response = await api.patch("/auth/me/email", { email });
      updateUser(response.data);
    } catch (submitError) {
      setError(getErrorMessage(submitError, "Failed to save email"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-backdrop">
      <div className="modal-card account-email-modal">
        <div className="modal-header">
          <div className="modal-header-title">
            <Mail size={17} />
            Add Recovery Email
          </div>
        </div>

        <form className="account-email-body" onSubmit={handleSubmit}>
          <p className="account-email-copy">
            Add an email address to your account so password recovery can work when you need it.
          </p>

          {error && <div className="auth-error">{error}</div>}

          <div className="form-group">
            <label>Email</label>
            <input
              className="form-control"
              type="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              placeholder="you@example.com"
              autoFocus
              required
            />
          </div>

          <button className="btn btn-primary account-email-submit" type="submit" disabled={saving || !email.trim()}>
            {saving ? <Loader2 size={16} className="animate-spin" /> : <Mail size={16} />}
            Save Email
          </button>
        </form>
      </div>
    </div>
  );
}
