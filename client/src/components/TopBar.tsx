import { useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { LogOut, Menu, Settings, User } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import AppLogo from "./AppLogo";

interface TopBarProps {
  onMenuToggle: () => void;
}

export default function TopBar({ onMenuToggle }: TopBarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [dropOpen, setDropOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);

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
        <AppLogo size={28} showWordmark />
      </button>

      <div className="topbar-spacer" />

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
