import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate, useSearchParams } from "react-router-dom";
import { Bug, CheckCircle2, Loader2, LogOut, Menu, Plus, ScanLine, Settings, SlidersHorizontal, Smartphone, User, Volume2, XCircle } from "lucide-react";
import { useAuth } from "../context/AuthContext";
import { useScanProgress } from "../context/ScanProgressContext";
import { useIsMobile } from "../hooks/useIsMobile";
import AppLogo from "./AppLogo";
import SearchBox from "./SearchBox";
import BugReportModal from "./BugReportModal";
import ConnectMobileModal from "./ConnectMobileModal";

// Keys that live in the library URL but aren't filters proper. Used to count
// the active filter badge in the top bar without coupling to Library's full
// LibraryFilters shape.
const NON_FILTER_PARAM_KEYS = new Set([
  "search",
  "sortBy",
  "page",
  "limit",
  "authorName",
  "seriesName",
  "filterPanel",
]);

interface TopBarProps {
  onMenuToggle: () => void;
}

export default function TopBar({ onMenuToggle }: TopBarProps) {
  const { user, logout } = useAuth();
  const { scanProgress, silenceCheckProgress } = useScanProgress();
  const navigate = useNavigate();
  const location = useLocation();
  const isMobile = useIsMobile();
  const [searchParams, setSearchParams] = useSearchParams();
  const [dropOpen, setDropOpen] = useState(false);
  const [isConnectMobileOpen, setIsConnectMobileOpen] = useState(false);
  const [isBugReportOpen, setIsBugReportOpen] = useState(false);
  const dropRef = useRef<HTMLDivElement>(null);
  const isLibraryRoute = location.pathname === "/library";
  const isSeriesRoute = location.pathname === "/series";
  const isBrowseRoute = isLibraryRoute || isSeriesRoute;
  const searchValue = isBrowseRoute ? searchParams.get("search") || "" : "";

  const showLibraryControls = isBrowseRoute && !isMobile && Boolean(user);
  const sortBy = searchParams.get("sortBy") || "newest";
  const isFilterPanelOpen = searchParams.get("filterPanel") === "open";
  let activeFilterCount = 0;
  for (const key of searchParams.keys()) {
    if (!NON_FILTER_PARAM_KEYS.has(key)) activeFilterCount++;
  }

  const toggleFilterPanel = () => {
    const next = new URLSearchParams(searchParams);
    if (isFilterPanelOpen) next.delete("filterPanel");
    else next.set("filterPanel", "open");
    setSearchParams(next, { replace: true });
  };

  const updateSort = (value: string) => {
    const next = new URLSearchParams(searchParams);
    next.set("sortBy", value);
    setSearchParams(next);
  };

  // Library owns the upload modal; the top bar signals "open it" by setting
  // ?upload=open. Library consumes and clears the param.
  const openUpload = () => {
    if (location.pathname === "/library" || location.pathname === "/series") {
      const next = new URLSearchParams(searchParams);
      next.set("upload", "open");
      setSearchParams(next, { replace: true });
    } else {
      navigate({ pathname: "/library", search: "?upload=open" });
    }
  };

  const isActiveScan = scanProgress?.status === "starting" || scanProgress?.status === "scanning";
  const scanProgressValue = Math.max(0, Math.min(100, Math.round(scanProgress?.progress ?? 0)));
  const scanLabel = !scanProgress
    ? ""
    : scanProgress.status === "starting"
      ? "Preparing library scan"
      : scanProgress.status === "completed"
        ? "Library scan complete"
        : scanProgress.status === "failed"
          ? "Library scan stopped"
          : scanProgress.currentFolder
            ? `Scanning ${scanProgress.currentFolder}`
            : "Scanning library";
  const scanDetail = scanProgress?.status === "scanning" && scanProgress.totalFolders
    ? `${scanProgress.scannedFolders ?? 0}/${scanProgress.totalFolders} folders`
    : `${scanProgressValue}%`;

  const isActiveSilenceCheck = silenceCheckProgress?.status === "starting" || silenceCheckProgress?.status === "checking";
  const silenceProgressValue = Math.max(0, Math.min(100, Math.round(silenceCheckProgress?.progress ?? 0)));
  const silenceLabel = !silenceCheckProgress
    ? ""
    : silenceCheckProgress.status === "starting"
      ? "Preparing audio check"
      : silenceCheckProgress.status === "completed"
        ? "Audio check complete"
        : silenceCheckProgress.status === "failed"
          ? "Audio check stopped"
          : silenceCheckProgress.currentFile
            ? `Checking ${silenceCheckProgress.currentFile}`
            : "Checking audio files";
  const silenceDetail = silenceCheckProgress?.status === "checking" && silenceCheckProgress.totalFiles
    ? `${silenceCheckProgress.checkedFiles ?? 0}/${silenceCheckProgress.totalFiles} files`
    : `${silenceProgressValue}%`;

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
    <>
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
        <AppLogo size={40} showWordmark />
      </button>

      {user && (
        <div className="topbar-search">
          <SearchBox
            value={searchValue}
            onChange={(value) => {
              const nextParams =
                isBrowseRoute ? new URLSearchParams(searchParams) : new URLSearchParams();

              if (value) nextParams.set("search", value);
              else nextParams.delete("search");

              if (isBrowseRoute) {
                setSearchParams(nextParams, { replace: true });
              } else {
                navigate({ pathname: "/library", search: nextParams.toString() }, { replace: false });
              }
            }}
          />
        </div>
      )}

      <div className="topbar-spacer" />

      {silenceCheckProgress && (
        <div
          className={`topbar-scan-progress topbar-scan-progress-${silenceCheckProgress.status === "checking" ? "scanning" : silenceCheckProgress.status}`}
          role="status"
          aria-live="polite"
          aria-label={`${silenceLabel}, ${silenceProgressValue}%`}
        >
          <div className="topbar-scan-icon">
            {isActiveSilenceCheck ? (
              silenceCheckProgress.status === "starting" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <Volume2 size={14} />
              )
            ) : silenceCheckProgress.status === "completed" ? (
              <CheckCircle2 size={14} />
            ) : (
              <XCircle size={14} />
            )}
          </div>
          <div className="topbar-scan-copy">
            <span className="topbar-scan-label">{silenceLabel}</span>
            <span className="topbar-scan-detail">{silenceDetail}</span>
          </div>
          <div className="topbar-scan-track">
            <div className="topbar-scan-fill" style={{ width: `${silenceProgressValue}%` }} />
          </div>
        </div>
      )}

      {scanProgress && (
        <div
          className={`topbar-scan-progress topbar-scan-progress-${scanProgress.status}`}
          role="status"
          aria-live="polite"
          aria-label={`${scanLabel}, ${scanProgressValue}%`}
        >
          <div className="topbar-scan-icon">
            {isActiveScan ? (
              scanProgress.status === "starting" ? (
                <Loader2 size={14} className="animate-spin" />
              ) : (
                <ScanLine size={14} />
              )
            ) : scanProgress.status === "completed" ? (
              <CheckCircle2 size={14} />
            ) : (
              <XCircle size={14} />
            )}
          </div>
          <div className="topbar-scan-copy">
            <span className="topbar-scan-label">{scanLabel}</span>
            <span className="topbar-scan-detail">{scanDetail}</span>
          </div>
          <div className="topbar-scan-track">
            <div className="topbar-scan-fill" style={{ width: `${scanProgressValue}%` }} />
          </div>
        </div>
      )}

      <div className="topbar-actions">
        {showLibraryControls && user?.role === "ADMIN" && (
          <button
            type="button"
            className="topbar-icon-btn"
            onClick={openUpload}
            title="Add book"
            aria-label="Add book"
          >
            <Plus size={16} />
          </button>
        )}
        {showLibraryControls && (
          <>
            <button
              type="button"
              className={`btn btn-secondary filter-toggle-btn${isFilterPanelOpen || activeFilterCount > 0 ? " active" : ""}`}
              onClick={toggleFilterPanel}
              title="Filters"
            >
              <SlidersHorizontal size={15} />
              Filters
              {activeFilterCount > 0 && (
                <span className="filter-count-badge">{activeFilterCount}</span>
              )}
            </button>
            <div className="select-wrap filter-select topbar-sort-select">
              <select
                className="form-control"
                value={sortBy}
                onChange={(e) => updateSort(e.target.value)}
                aria-label="Sort order"
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="title_asc">Title (A-Z)</option>
                <option value="title_desc">Title (Z-A)</option>
                <option value="author_asc">Author (A-Z)</option>
                <option value="author_desc">Author (Z-A)</option>
                <option value="duration_asc">Shortest First</option>
                <option value="duration_desc">Longest First</option>
                <option value="year_desc">Year (Newest)</option>
                <option value="year_asc">Year (Oldest)</option>
              </select>
            </div>
          </>
        )}

        {user && (
          <>
          <button
            type="button"
            className="topbar-icon-btn"
            onClick={() => setIsConnectMobileOpen(true)}
            title="Connect Mobile App"
            aria-label="Connect Mobile App"
          >
            <Smartphone size={16} />
          </button>
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
                  className="topbar-dropdown-item"
                  onClick={() => { setIsBugReportOpen(true); setDropOpen(false); }}
                >
                  <Bug size={14} /> Report an issue
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
          </>
        )}
      </div>
    </header>
    {isConnectMobileOpen && (
      <ConnectMobileModal onClose={() => setIsConnectMobileOpen(false)} />
    )}
    {isBugReportOpen && (
      <BugReportModal onClose={() => setIsBugReportOpen(false)} />
    )}
    </>
  );
}
