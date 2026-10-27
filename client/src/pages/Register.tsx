import { isAxiosError } from "axios";
import { useEffect, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import api from "../api/axios";
import AppLogo from "../components/AppLogo";
import { useAuth } from "../context/AuthContext";

export interface RegistrationStatus {
  open: boolean;
  firstUser: boolean;
  invite: "valid" | "invalid" | null;
}

const Register = () => {
  const [searchParams] = useSearchParams();
  const inviteToken = searchParams.get("invite") || undefined;
  const [status, setStatus] = useState<RegistrationStatus | null>(null);
  const [username, setUsername] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [showPassword, setShowPassword] = useState(false);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const { login } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    api
      .get<RegistrationStatus>("/auth/registration", { params: inviteToken ? { invite: inviteToken } : undefined })
      // If the check fails, show the form; the server still enforces the rules on submit.
      .then((response) => setStatus(response.data))
      .catch(() => setStatus({ open: true, firstUser: false, invite: null }));
  }, [inviteToken]);

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await api.post("/auth/register", { username, email, password, inviteToken });
      login(res.data.user);
      navigate("/");
    } catch (error) {
      setError(
        isAxiosError<{ error?: string }>(error)
          ? error.response?.data?.error || "Registration failed"
          : "Registration failed",
      );
    } finally {
      setLoading(false);
    }
  };

  const hasValidInvite = status?.invite === "valid";
  const blockedMessage = !status
    ? null
    : status.invite === "invalid"
      ? "This invite link is invalid, has already been used, or has expired. Ask an admin for a new one."
      : !status.open && !hasValidInvite
        ? "Sign-up is by invitation only. Ask an admin of this server for an invite link."
        : null;

  if (!status || blockedMessage) {
    return (
      <div className="auth-page">
        <AppLogo className="auth-logo" imageClassName="auth-logo-image" textClassName="auth-logo-text" />
        <div className="card auth-card">
          {!status ? (
            <Loader2 size={20} className="animate-spin" aria-label="Loading" />
          ) : (
            <>
              <h2>Can't create an account</h2>
              <p className="auth-subtitle">{blockedMessage}</p>
            </>
          )}
          <div className="auth-footer">
            Already have an account?{" "}
            <Link to="/login">Sign in</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="auth-page">
      <AppLogo className="auth-logo" imageClassName="auth-logo-image" textClassName="auth-logo-text" />

      <div className="card auth-card">
        <h2>Create an account</h2>
        <p className="auth-subtitle">
          {status.firstUser
            ? "This is the first account on this server, so it will be the admin."
            : hasValidInvite
              ? "You've been invited to this audiobook server."
              : "Start building your audiobook library"}
        </p>

        {error && <div className="auth-error">{error}</div>}

        <form onSubmit={handleSubmit}>
          <div className="form-group">
            <label>Username</label>
            <input
              type="text"
              className="form-control"
              value={username}
              onChange={(e) => setUsername(e.target.value)}
              placeholder="Choose a username"
              required
              autoFocus
            />
          </div>
          <div className="form-group">
            <label>Email</label>
            <input
              type="email"
              className="form-control"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="Enter your recovery email"
              required
            />
          </div>
          <div className="form-group">
            <label>Password</label>
            <div className="password-field">
              <input
                type={showPassword ? "text" : "password"}
                className="form-control password-input"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="Choose a password"
                required
              />
              <button
                type="button"
                className="password-toggle"
                onClick={() => setShowPassword((current) => !current)}
                aria-label={showPassword ? "Hide password" : "Show password"}
              >
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </div>
          <button
            type="submit"
            className="btn btn-primary auth-submit-btn"
            disabled={loading}
          >
            {loading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Creating account…
              </>
            ) : (
              "Create Account"
            )}
          </button>
        </form>

        <div className="auth-footer">
          Already have an account?{" "}
          <Link to="/login">Sign in</Link>
        </div>
      </div>
    </div>
  );
};

export default Register;
