import { useState } from "react";
import { Outlet, useLocation, useNavigate } from "react-router-dom";
import { Home, Library, Headphones, Menu } from "lucide-react";
import { usePlayer } from "../context/PlayerContext";
import { useBreakpoint } from "../hooks/useBreakpoint";
import { ScanProgressProvider } from "../context/ScanProgressContext";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import PlayerTray from "./PlayerTray";
import InstallPrompt from "./InstallPrompt";
import MobileMiniPlayer from "../mobile/MobileMiniPlayer";
import MobilePlayer from "../mobile/MobilePlayer";

const MOBILE_TABS = [
  { path: "/",        icon: Home,       label: "Home"    },
  { path: "/library", icon: Library,    label: "Library" },
  { path: "__player__", icon: Headphones, label: "Player" },
  { path: "/menu",    icon: Menu,       label: "Menu"    },
];

export default function UnifiedShell() {
  const [collapsed, setCollapsed]       = useState(false);
  const [isPlayerOpen, setIsPlayerOpen] = useState(false);
  const { currentBook }                 = usePlayer();
  const { isNarrow }                    = useBreakpoint();
  const location                        = useLocation();
  const navigate                        = useNavigate();

  const handleMenuToggle = () => {
    if (!isNarrow) setCollapsed((v) => !v);
  };

  const isTabActive = (path: string) => {
    if (path === "__player__") return isPlayerOpen;
    if (path === "/") return location.pathname === "/";
    if (path === "/library") {
      return (
        ["/library", "/series", "/authors"].includes(location.pathname) ||
        location.pathname.startsWith("/book/")
      );
    }
    return location.pathname.startsWith(path);
  };

  const handleTabPress = (path: string) => {
    if (path === "__player__") {
      setIsPlayerOpen(true);
    } else {
      setIsPlayerOpen(false);
      navigate(path);
    }
  };

  return (
    <ScanProgressProvider>
      <div className={`app-shell${collapsed && !isNarrow ? " sidebar-collapsed" : ""}`}>
        {/* ── Desktop top bar (hidden on mobile via CSS) ── */}
        <TopBar onMenuToggle={handleMenuToggle} />

        {/* ── Mobile full-screen player overlay (fixed, z-index: 200) ── */}
        {isNarrow && isPlayerOpen && (
          <MobilePlayer onClose={() => setIsPlayerOpen(false)} />
        )}

        {/* ── Desktop body ── */}
        <div className="shell-body">
          <Sidebar collapsed={collapsed} />

          <main className={[
            "shell-main",
            !isNarrow && currentBook ? "has-player" : "",
            isNarrow && currentBook && !isPlayerOpen ? "mobile-has-mini" : "",
          ].filter(Boolean).join(" ")}>
            <Outlet />
          </main>
        </div>

        {/* ── Desktop player tray (hidden on mobile via CSS) ── */}
        <PlayerTray />

        {/* ── Mobile mini player (hidden on desktop via CSS) ── */}
        {isNarrow && currentBook && !isPlayerOpen && (
          <MobileMiniPlayer onExpand={() => setIsPlayerOpen(true)} />
        )}

        {/* ── Mobile bottom nav (hidden on desktop via CSS) ── */}
        <nav className="mobile-bottom-nav">
          {MOBILE_TABS.map((tab) => (
            <button
              key={tab.path}
              className={`mobile-nav-tab${isTabActive(tab.path) ? " active" : ""}`}
              onClick={() => handleTabPress(tab.path)}
            >
              <tab.icon size={22} />
              <span>{tab.label}</span>
            </button>
          ))}
        </nav>

        <InstallPrompt />
      </div>
    </ScanProgressProvider>
  );
}
