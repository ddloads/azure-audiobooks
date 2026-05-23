import { useState } from "react";
import { Outlet } from "react-router-dom";
import { usePlayer } from "../context/PlayerContext";
import { useIsMobile } from "../hooks/useIsMobile";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import PlayerTray from "./PlayerTray";
import InstallPrompt from "./InstallPrompt";
import { ScanProgressProvider } from "../context/ScanProgressContext";

export default function AppShell() {
  const [collapsed, setCollapsed]     = useState(false);
  const [mobileOpen, setMobileOpen]   = useState(false);
  const { currentBook } = usePlayer();
  const isMobile = useIsMobile();

  const handleMenuToggle = () => {
    if (isMobile) setMobileOpen((v) => !v);
    else setCollapsed((v) => !v);
  };

  return (
    <ScanProgressProvider>
      <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`}>
        <TopBar onMenuToggle={handleMenuToggle} />

        <div className="shell-body">
          <Sidebar
            collapsed={collapsed}
            mobileOpen={mobileOpen}
            onCollapseToggle={() => setCollapsed((v) => !v)}
            onMobileClose={() => setMobileOpen(false)}
          />

          {mobileOpen && (
            <div
              className="sidebar-overlay"
              onClick={() => setMobileOpen(false)}
            />
          )}

          <main className={`shell-main${currentBook ? " has-player" : ""}`}>
            <Outlet />
          </main>
        </div>

        <PlayerTray />
        <InstallPrompt />
      </div>
    </ScanProgressProvider>
  );
}
