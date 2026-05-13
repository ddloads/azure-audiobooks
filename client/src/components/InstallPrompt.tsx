import { useState, useEffect } from "react";
import { Download, X } from "lucide-react";

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

const InstallPrompt = () => {
  const [deferredPrompt, setDeferredPrompt] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // Don't show if already running as installed PWA
    if (window.matchMedia("(display-mode: standalone)").matches) return;
    // Don't show if user dismissed this session
    if (sessionStorage.getItem("pwa-prompt-dismissed")) return;

    const handler = (e: Event) => {
      e.preventDefault();
      setDeferredPrompt(e as BeforeInstallPromptEvent);
    };

    window.addEventListener("beforeinstallprompt", handler);
    return () => window.removeEventListener("beforeinstallprompt", handler);
  }, []);

  if (!deferredPrompt || dismissed) return null;

  const handleInstall = async () => {
    await deferredPrompt.prompt();
    const { outcome } = await deferredPrompt.userChoice;
    if (outcome === "accepted") setDeferredPrompt(null);
    setDismissed(true);
  };

  const handleDismiss = () => {
    sessionStorage.setItem("pwa-prompt-dismissed", "1");
    setDismissed(true);
  };

  return (
    <div style={{
      position: "fixed",
      bottom: "calc(var(--player-height, 86px) + 12px)",
      left: "50%",
      transform: "translateX(-50%)",
      zIndex: 9999,
      display: "flex",
      alignItems: "center",
      gap: "12px",
      padding: "10px 14px",
      background: "var(--surface)",
      border: "1px solid var(--border-strong)",
      borderRadius: "var(--radius-lg)",
      boxShadow: "var(--shadow-lg)",
      whiteSpace: "nowrap",
      maxWidth: "calc(100vw - 24px)",
    }}>
      <Download size={16} color="var(--primary-light)" />
      <span style={{ fontSize: "0.85rem", color: "var(--text)" }}>
        Install Azure on your device
      </span>
      <button
        onClick={handleInstall}
        style={{
          padding: "5px 12px",
          background: "var(--primary)",
          color: "#fff",
          border: "none",
          borderRadius: "var(--radius-sm)",
          fontSize: "0.8rem",
          fontWeight: 600,
          cursor: "pointer",
        }}
      >
        Install
      </button>
      <button
        onClick={handleDismiss}
        style={{ background: "none", border: "none", cursor: "pointer", display: "flex", padding: 2 }}
        aria-label="Dismiss"
      >
        <X size={14} color="var(--text-muted)" />
      </button>
    </div>
  );
};

export default InstallPrompt;
