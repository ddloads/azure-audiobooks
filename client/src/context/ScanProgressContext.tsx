import React, { createContext, useContext, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import { getSocketBaseUrl } from "../api/backend";
import { useAuth } from "./AuthContext";

export type ScanProgressStatus = "starting" | "scanning" | "completed" | "failed";

export type ScanProgress = {
  libraryId?: string;
  status: ScanProgressStatus;
  progress: number;
  currentFolder?: string;
  totalFolders?: number;
  scannedFolders?: number;
};

type ScanProgressContextValue = {
  scanProgress: ScanProgress | null;
};

const ScanProgressContext = createContext<ScanProgressContextValue | undefined>(undefined);

export const ScanProgressProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const clearTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user) {
      setScanProgress(null);
      return;
    }

    const socket = io(getSocketBaseUrl(), {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    const clearPendingTimer = () => {
      if (clearTimerRef.current !== null) {
        window.clearTimeout(clearTimerRef.current);
        clearTimerRef.current = null;
      }
    };

    const handleScanProgress = (event: ScanProgress) => {
      clearPendingTimer();
      setScanProgress(event);

      if (event.status === "completed" || event.status === "failed") {
        clearTimerRef.current = window.setTimeout(() => {
          setScanProgress(null);
          clearTimerRef.current = null;
        }, 4500);
      }
    };

    socket.on("scanProgress", handleScanProgress);

    return () => {
      clearPendingTimer();
      socket.off("scanProgress", handleScanProgress);
      socket.disconnect();
    };
  }, [user]);

  const value = useMemo<ScanProgressContextValue>(
    () => ({ scanProgress }),
    [scanProgress],
  );

  return (
    <ScanProgressContext.Provider value={value}>
      {children}
    </ScanProgressContext.Provider>
  );
};

export const useScanProgress = () => {
  const context = useContext(ScanProgressContext);
  if (!context) {
    throw new Error("useScanProgress must be used within a ScanProgressProvider");
  }

  return context;
};
