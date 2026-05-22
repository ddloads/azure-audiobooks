import { useNavigate, useLocation } from "react-router-dom";
import {
  BookOpen,
  ChevronLeft,
  ChevronRight,
  Copy,
  FolderOpen,
  Home,
  LogOut,
  Settings,
  X,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";
import AppLogo from "./AppLogo";

interface SidebarProps {
  collapsed: boolean;
  mobileOpen: boolean;
  onCollapseToggle: () => void;
  onMobileClose: () => void;
}

interface NavItem {
  path: string;
  icon: React.ReactNode;
  label: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/",        icon: <Home size={18} />,     label: "Home" },
  { path: "/library", icon: <BookOpen size={18} />, label: "Library" },
];

const ADMIN_ITEMS: NavItem[] = [
  { path: "/settings",   icon: <Settings size={18} />,   label: "Settings",      adminOnly: true },
  { path: "/files",      icon: <FolderOpen size={18} />, label: "File Manager",  adminOnly: true },
  { path: "/duplicates", icon: <Copy size={18} />,       label: "Duplicates",    adminOnly: true },
];

export default function Sidebar({
  collapsed,
  mobileOpen,
  onCollapseToggle,
  onMobileClose,
}: SidebarProps) {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isAdmin = user?.role === "ADMIN";

  const isActive = (path: string) =>
    path === "/" || path === "/library"
      ? location.pathname === path
      : location.pathname.startsWith(path);

  const handleNav = (path: string) => {
    navigate(path);
    onMobileClose();
  };

  const sidebarClass = [
    "sidebar",
    mobileOpen ? "mobile-open" : "",
  ].filter(Boolean).join(" ");

  return (
    <nav className={sidebarClass} aria-label="Main navigation">
      {/* Mobile-only top row with logo + close */}
      <div className="sidebar-mobile-top">
        <AppLogo size={26} showWordmark />
        <button className="sidebar-close-btn" onClick={onMobileClose} aria-label="Close menu">
          <X size={18} />
        </button>
      </div>

      <div className="sidebar-nav">
        {/* Primary nav */}
        {NAV_ITEMS.map((item) => (
          <button
            key={item.path}
            className={`sidebar-item${isActive(item.path) ? " active" : ""}`}
            onClick={() => handleNav(item.path)}
            data-label={collapsed ? item.label : undefined}
            aria-label={item.label}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}

        {/* Admin section */}
        {isAdmin && (
          <>
            <div className="sidebar-sep" />
            <div className="sidebar-section-label">Admin</div>
            {ADMIN_ITEMS.map((item) => (
              <button
                key={item.path}
                className={`sidebar-item${isActive(item.path) ? " active" : ""}`}
                onClick={() => handleNav(item.path)}
                data-label={collapsed ? item.label : undefined}
                aria-label={item.label}
              >
                <span className="sidebar-icon">{item.icon}</span>
                <span className="sidebar-label">{item.label}</span>
              </button>
            ))}
          </>
        )}
      </div>

      {/* Footer: logout + collapse toggle */}
      <div className="sidebar-footer">
        <button
          className="sidebar-item"
          onClick={() => { logout(); onMobileClose(); }}
          data-label={collapsed ? "Sign out" : undefined}
          aria-label="Sign out"
        >
          <span className="sidebar-icon"><LogOut size={18} /></span>
          <span className="sidebar-label">Sign out</span>
        </button>

        {/* Desktop collapse toggle */}
        <button
          className="sidebar-collapse-btn"
          onClick={onCollapseToggle}
          aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
        >
          {!collapsed && <span className="sidebar-label" style={{ color: "var(--text-subtle)", fontSize: 12 }}>Collapse</span>}
          {collapsed ? <ChevronRight size={16} /> : <ChevronLeft size={16} />}
        </button>
      </div>
    </nav>
  );
}
