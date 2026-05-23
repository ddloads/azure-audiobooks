import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { CheckCircle2, Loader2, LogOut, Menu, ScanLine, Settings, User, XCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useScanProgress } from "../context/ScanProgressContext";
import AppLogo from "./AppLogo";

interface TopBarProps {
  onMenuToggle: () => void;
}

export default function TopBar({ onMenuToggle }: TopBarProps) {
  const { user, logout } = useAuth();
  const { scanProgress } = useScanProgress();
  const navigate = useNavigate();
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

  const isActiveScan = scanProgress?.status === "starting" || scanProgress?.status === "scanning";
  const scanProgressValue = Math.max(0, Math.min(100, Math.round(scanProgress?.progress ?? 0)));
  const scanLabel = !scanProgress
    ? ""
    : scanProgress.status === "starting"
      ? "Preparing library scan"
      : scanProgress.status === "completed"
        ? "Library scan complete"
        : scanProgress.status === "failed"
          ? "Library scan stopped"
          : scanProgress.currentFolder
            ? `Scanning ${scanProgress.currentFolder}`
            : "Scanning library";
  const scanDetail = scanProgress?.status === "scanning" && scanProgress.totalFolders
    ? `${scanProgress.scannedFolders ?? 0}/${scanProgress.totalFolders} folders`
    : `${scanProgressValue}%`;

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (dropRef.current && !dropRef.current.contains(e.target as Node)) {
        setDropOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  return (
    <header className="topbar">
      <button
        className="topbar-hamburger"
        onClick={onMenuToggle}
        aria-label="Toggle navigation"
      >
        <Menu size={19} />
      </button>

      <button
        className="topbar-logo-btn"
        onClick={() => navigate("/")}
        aria-label="Go to library"
      >
        <AppLogo size={40} showWordmark />
      </button>

      <div className="topbar-spacer" />

      {scanProgress && (
        <div
          className={`topbar-scan-progress topbar-scan-progress-${scanProgress.status}`}
          role="status"
          aria-live="polite"
          aria-label={`${scanLabel}, ${scanProgressValue}%`}
        >
          <div className="topbar-scan-icon">
            {isActiveScan ? (
              scanProgress.status === "starting" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ScanLine size={14} />
              )
            ) : scanProgress.status === "completed" ? (
              <CheckCircle2 size={14} />
            ) : (
              <XCircle size={14} />
            )}
          </div>
          <div className="topbar-scan-copy">
            <span className="topbar-scan-label">{scanLabel}</span>
            <span className="topbar-scan-detail">{scanDetail}</span>
          </div>
          <div className="topbar-scan-track">
            <div className="topbar-scan-fill" style={{ width: `${scanProgressValue}%` }} />
          </div>
        </div>
      )}

      <div className="topbar-actions">
        {user && (
          <div className="topbar-user-wrap" ref={dropRef}>
            <button
              className="topbar-user-btn"
              onClick={() => setDropOpen((v) => !v)}
              aria-label="User menu"
            >
              <span className="topbar-avatar">
                {user.username.charAt(0).toUpperCase()}
              </span>
              <span className="topbar-username">{user.username}</span>
            </button>

            {dropOpen && (
              <div className="topbar-dropdown">
                <div className="topbar-dropdown-header">
                  <div className="topbar-dropdown-name">{user.username}</div>
                  <div className="topbar-dropdown-role">{user.role}</div>
                </div>

                {user.role === "ADMIN" && (
                  <button
                    className="topbar-dropdown-item"
                    onClick={() => { navigate("/settings"); setDropOpen(false); }}
                  >
                    <Settings size={14} /> Settings
                  </button>
                )}

                <button
                  className="topbar-dropdown-item"
                  onClick={() => { navigate("/"); setDropOpen(false); }}
                >
                  <User size={14} /> Library
                </button>

                <button
                  className="topbar-dropdown-item danger"
                  onClick={() => { logout(); setDropOpen(false); }}
                >
                  <LogOut size={14} /> Sign out
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
}
