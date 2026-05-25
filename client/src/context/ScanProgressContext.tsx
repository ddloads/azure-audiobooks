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

export type SilenceCheckProgressStatus = "starting" | "checking" | "completed" | "failed";

export type SilenceCheckProgress = {
  libraryId?: string;
  status: SilenceCheckProgressStatus;
  progress: number;
  currentFile?: string;
  totalFiles?: number;
  checkedFiles?: number;
  silentFiles?: number;
};

type ScanProgressContextValue = {
  scanProgress: ScanProgress | null;
  silenceCheckProgress: SilenceCheckProgress | null;
};

const ScanProgressContext = createContext<ScanProgressContextValue | undefined>(undefined);

export const ScanProgressProvider = ({ children }: { children: React.ReactNode }) => {
  const { user } = useAuth();
  const [scanProgress, setScanProgress] = useState<ScanProgress | null>(null);
  const [silenceCheckProgress, setSilenceCheckProgress] = useState<SilenceCheckProgress | null>(null);
  const clearScanTimerRef = useRef<number | null>(null);
  const clearSilenceTimerRef = useRef<number | null>(null);

  useEffect(() => {
    if (!user) {
      setScanProgress(null);
      setSilenceCheckProgress(null);
      return;
    }

    const socket = io(getSocketBaseUrl(), {
      withCredentials: true,
      transports: ["websocket", "polling"],
    });

    const clearScanTimer = () => {
      if (clearScanTimerRef.current !== null) {
        window.clearTimeout(clearScanTimerRef.current);
        clearScanTimerRef.current = null;
      }
    };

    const clearSilenceTimer = () => {
      if (clearSilenceTimerRef.current !== null) {
        window.clearTimeout(clearSilenceTimerRef.current);
        clearSilenceTimerRef.current = null;
      }
    };

    const handleScanProgress = (event: ScanProgress) => {
      clearScanTimer();
      setScanProgress(event);

      if (event.status === "completed" || event.status === "failed") {
        clearScanTimerRef.current = window.setTimeout(() => {
          setScanProgress(null);
          clearScanTimerRef.current = null;
        }, 4500);
      }
    };

    const handleSilenceCheckProgress = (event: SilenceCheckProgress) => {
      clearSilenceTimer();
      setSilenceCheckProgress(event);

      if (event.status === "completed" || event.status === "failed") {
        clearSilenceTimerRef.current = window.setTimeout(() => {
          setSilenceCheckProgress(null);
          clearSilenceTimerRef.current = null;
        }, 4500);
      }
    };

    socket.on("scanProgress", handleScanProgress);
    socket.on("silenceCheckProgress", handleSilenceCheckProgress);

    return () => {
      clearScanTimer();
      clearSilenceTimer();
      socket.off("scanProgress", handleScanProgress);
      socket.off("silenceCheckProgress", handleSilenceCheckProgress);
      socket.disconnect();
    };
  }, [user]);

  const value = useMemo<ScanProgressContextValue>(
    () => ({ scanProgress, silenceCheckProgress }),
    [scanProgress, silenceCheckProgress],
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
