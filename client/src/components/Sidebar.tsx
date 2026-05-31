import { useNavigate, useLocation } from "react-router-dom";
import {
  BookOpen,
  Boxes,
  Copy,
  FolderOpen,
  Headphones,
  Home,
  Settings,
  Users,
} from "lucide-react";
import { useAuth } from "../context/AuthContext";

interface SidebarProps {
  collapsed: boolean;
}

interface NavItem {
  path: string;
  icon: React.ReactNode;
  label: string;
  adminOnly?: boolean;
}

const NAV_ITEMS: NavItem[] = [
  { path: "/",        icon: <Home size={18} />,        label: "Home" },
  { path: "/library", icon: <BookOpen size={18} />,    label: "Library" },
  { path: "/series",  icon: <Boxes size={18} />,       label: "Series" },
  { path: "/authors", icon: <Users size={18} />,       label: "Authors" },
  { path: "/stats",   icon: <Headphones size={18} />,  label: "Stats" },
];

const ADMIN_ITEMS: NavItem[] = [
  { path: "/settings",   icon: <Settings size={18} />,   label: "Settings",     adminOnly: true },
  { path: "/files",      icon: <FolderOpen size={18} />, label: "File Manager", adminOnly: true },
  { path: "/duplicates", icon: <Copy size={18} />,       label: "Duplicates",   adminOnly: true },
];

export default function Sidebar({ collapsed }: SidebarProps) {
  const { user } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();

  const isAdmin = user?.role === "ADMIN";

  const isActive = (path: string) =>
    ["/", "/library", "/series", "/authors"].includes(path)
      ? location.pathname === path
      : location.pathname.startsWith(path);

  return (
    <nav className="sidebar" aria-label="Main navigation">
      <div className="sidebar-nav">
        {NAV_ITEMS.map((item) => (
          <button
            key={item.path}
            className={`sidebar-item${isActive(item.path) ? " active" : ""}`}
            onClick={() => navigate(item.path)}
            data-label={collapsed ? item.label : undefined}
            aria-label={item.label}
          >
            <span className="sidebar-icon">{item.icon}</span>
            <span className="sidebar-label">{item.label}</span>
          </button>
        ))}

        {isAdmin && (
          <>
            <div className="sidebar-sep" />
            <div className="sidebar-section-label">Admin</div>
            {ADMIN_ITEMS.map((item) => (
              <button
                key={item.path}
                className={`sidebar-item${isActive(item.path) ? " active" : ""}`}
                onClick={() => navigate(item.path)}
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

      <div className="sidebar-footer">
        <div className="sidebar-version" aria-label={`Azure version ${__APP_VERSION__}`}>
          v{__APP_VERSION__}
        </div>
      </div>
    </nav>
  );
}
