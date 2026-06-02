import { useEffect, useRef, useState } from "react";
import { QRCodeSVG } from "qrcode.react";
import { Download, RefreshCw, Smartphone, X } from "lucide-react";
import api from "../api/axios";

const STORAGE_KEY = "azure_mobile_server_url";
const DEFAULT_URL = "https://azure.ddsplayground.com";

interface ConnectMobileModalProps {
  onClose: () => void;
}

type MobileAppRelease = {
  appName: string;
  version: string;
  fileName: string;
  size: number;
  updatedAt: string;
  downloadUrl: string;
};

export default function ConnectMobileModal({ onClose }: ConnectMobileModalProps) {
  const [serverUrl, setServerUrl] = useState(() => {
    return localStorage.getItem(STORAGE_KEY) ?? DEFAULT_URL;
  });
  const [pairingCode, setPairingCode] = useState<string | null>(null);
  const [expiresAt, setExpiresAt] = useState<number | null>(null);
  const [secondsLeft, setSecondsLeft] = useState(0);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [mobileRelease, setMobileRelease] = useState<MobileAppRelease | null>(null);
  const [releaseError, setReleaseError] = useState<string | null>(null);
  const refreshTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const countdownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const fetchCode = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await api.post<{ pairingCode: string; expiresAt: number }>("/auth/pair");
      setPairingCode(res.data.pairingCode);
      setExpiresAt(res.data.expiresAt);
    } catch {
      setError("Could not generate pairing code. Check server connection.");
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchCode();
    api
      .get<MobileAppRelease>("/mobile-app/latest")
      .then((res) => {
        setMobileRelease(res.data);
        setReleaseError(null);
      })
      .catch(() => {
        setMobileRelease(null);
        setReleaseError("No APK has been published yet.");
      });
    return () => {
      if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, []);

  useEffect(() => {
    if (!expiresAt) return;
    if (countdownRef.current) clearInterval(countdownRef.current);
    if (refreshTimerRef.current) clearTimeout(refreshTimerRef.current);

    const tick = () => {
      const remaining = Math.max(0, Math.round((expiresAt - Date.now()) / 1000));
      setSecondsLeft(remaining);
    };
    tick();
    countdownRef.current = setInterval(tick, 1000);

    // Refresh 30s before expiry so the code never visibly expires while open
    const refreshIn = expiresAt - Date.now() - 30_000;
    if (refreshIn > 0) {
      refreshTimerRef.current = setTimeout(() => fetchCode(), refreshIn);
    }

    return () => {
      if (countdownRef.current) clearInterval(countdownRef.current);
    };
  }, [expiresAt]);

  const cleanUrl = serverUrl.replace(/\/+$/, "");

  const qrValue = pairingCode
    ? JSON.stringify({ serverUrl: cleanUrl, pairingCode })
    : "";

  const formatCountdown = (s: number) =>
    `${Math.floor(s / 60)}:${(s % 60).toString().padStart(2, "0")}`;

  const formatSize = (bytes: number) => `${(bytes / 1024 / 1024).toFixed(1)} MB`;

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal-card connect-mobile-modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div className="modal-header-title">
            <Smartphone size={17} />
            Connect Mobile App
          </div>
          <button className="modal-close-btn" onClick={onClose} aria-label="Close">
            <X size={18} />
          </button>
        </div>

        <div className="connect-mobile-body">
          <div className="connect-mobile-download">
            <a
              className={`btn btn-primary connect-mobile-download-btn${mobileRelease ? "" : " disabled"}`}
              href={mobileRelease?.downloadUrl ?? undefined}
              aria-disabled={!mobileRelease}
              onClick={(event) => {
                if (!mobileRelease) event.preventDefault();
              }}
            >
              <Download size={16} />
              Download Azure Player APK
            </a>
            <p className="connect-mobile-download-meta">
              {mobileRelease
                ? `Version ${mobileRelease.version} - ${formatSize(mobileRelease.size)}`
                : releaseError ?? "Checking latest APK..."}
            </p>
          </div>

          <div className="connect-mobile-url-section">
            <label className="connect-mobile-label">Remote Server URL</label>
            <input
              className="form-control connect-mobile-url-input"
              value={serverUrl}
              onChange={(e) => {
                setServerUrl(e.target.value);
                localStorage.setItem(STORAGE_KEY, e.target.value);
              }}
              placeholder="https://your-server.com"
              spellCheck={false}
              autoComplete="off"
            />
            <p className="connect-mobile-hint">
              Must be reachable from your phone — not localhost or a local IP.
            </p>
          </div>

          <div className="connect-mobile-qr-wrap">
            {isLoading && (
              <div className="connect-mobile-spinner">
                <RefreshCw size={26} className="spin" />
              </div>
            )}
            {!isLoading && error && (
              <div className="connect-mobile-error">
                <p>{error}</p>
                <button className="btn btn-secondary btn-sm" onClick={fetchCode}>Try again</button>
              </div>
            )}
            {!isLoading && !error && qrValue && (
              <div className="connect-mobile-qr-inner">
                <div className="connect-mobile-qr-frame">
                  <QRCodeSVG
                    value={qrValue}
                    size={200}
                    bgColor="transparent"
                    fgColor="#f1f5f9"
                    level="M"
                  />
                </div>
                <p className="connect-mobile-code-label">
                  Code: <strong className="connect-mobile-code">{pairingCode}</strong>
                </p>
                <p className={`connect-mobile-countdown${secondsLeft < 60 ? " urgent" : ""}`}>
                  Expires in {formatCountdown(secondsLeft)}
                </p>
              </div>
            )}
          </div>

          <div className="connect-mobile-instructions">
            Open <strong>Azure Player</strong> → tap <strong>Scan QR</strong> on the login screen.
            The code is single-use and expires in 5 minutes.
          </div>
        </div>
      </div>
    </div>
  );
}
