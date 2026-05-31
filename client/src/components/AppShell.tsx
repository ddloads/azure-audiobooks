import { useState } from "react";
import { Outlet } from "react-router-dom";
import { usePlayer } from "../context/PlayerContext";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import PlayerTray from "./PlayerTray";
import InstallPrompt from "./InstallPrompt";
import { ScanProgressProvider } from "../context/ScanProgressContext";

export default function AppShell() {
  const [collapsed, setCollapsed] = useState(false);
  const { currentBook } = usePlayer();

  return (
    <ScanProgressProvider>
      <div className={`app-shell${collapsed ? " sidebar-collapsed" : ""}`}>
        <TopBar onMenuToggle={() => setCollapsed((v) => !v)} />

        <div className="shell-body">
          <Sidebar collapsed={collapsed} />

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
