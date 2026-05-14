import { isAxiosError } from "axios";
import { useEffect, useState } from "react";
import { ChevronRight, Folder, HardDrive, Loader2, RefreshCw, Search, X } from "lucide-react";
import api from "../api/axios";

interface FolderEntry {
  name: string;
  path: string;
}

interface FolderBrowserResponse {
  roots: string[];
  currentPath: string | null;
  parentPath: string | null;
  directories: FolderEntry[];
}

interface FolderBrowserModalProps {
  initialPath?: string;
  onClose: () => void;
  onSelect: (path: string) => void;
}

const getErrorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ error?: string }>(error)
    ? error.response?.data?.error || fallback
    : fallback;

const FolderBrowserModal = ({
  initialPath = "",
  onClose,
  onSelect,
}: FolderBrowserModalProps) => {
  const [browserData, setBrowserData] = useState<FolderBrowserResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [pathInput, setPathInput] = useState(initialPath);
  const [searchQuery, setSearchQuery] = useState("");

  const loadFolders = async (targetPath?: string) => {
    setLoading(true);
    setError("");
    setSearchQuery("");

    try {
      const response = await api.get<FolderBrowserResponse>("/admin/filesystem", {
        params: targetPath?.trim() ? { path: targetPath.trim() } : undefined,
      });
      setBrowserData(response.data);
      setPathInput(response.data.currentPath ?? targetPath ?? "");
    } catch (loadError) {
      setError(getErrorMessage(loadError, "Failed to browse folders"));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    const timeoutId = window.setTimeout(() => {
      void loadFolders(initialPath);
    }, 0);

    return () => {
      window.clearTimeout(timeoutId);
    };
  }, [initialPath]);

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card folder-browser-modal">
        <div className="modal-header">
          <h2>Browse Library Folders</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {error && <div className="auth-error">{error}</div>}

        <div className="folder-browser-toolbar">
          <input
            className="form-control"
            value={pathInput}
            onChange={(e) => setPathInput(e.target.value)}
            placeholder="C:\\Audiobooks or \\\\server\\share\\Audiobooks"
          />
          <button className="btn btn-secondary" type="button" onClick={() => void loadFolders(pathInput)}>
            <RefreshCw size={15} />
            Go
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={!browserData?.parentPath}
            onClick={() => browserData?.parentPath && void loadFolders(browserData.parentPath)}
          >
            Up
          </button>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!browserData?.currentPath}
            onClick={() => browserData?.currentPath && onSelect(browserData.currentPath)}
          >
            Use This Folder
          </button>
        </div>

        <div className="folder-browser-roots">
          {browserData?.roots.map((rootPath) => (
            <button
              key={rootPath}
              className="folder-browser-root"
              type="button"
              onClick={() => void loadFolders(rootPath)}
            >
              <HardDrive size={14} />
              {rootPath}
            </button>
          ))}
        </div>

        <div className="folder-browser-current">
          <span>Current folder</span>
          <code>{browserData?.currentPath ?? "Select a drive or enter a path to begin browsing."}</code>
        </div>

        {browserData && browserData.directories.length > 0 && (
          <div className="folder-browser-search">
            <Search size={14} className="folder-browser-search-icon" />
            <input
              className="form-control"
              placeholder="Filter folders..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
            />
            {searchQuery && (
              <button
                className="folder-browser-search-clear"
                type="button"
                onClick={() => setSearchQuery("")}
                aria-label="Clear filter"
              >
                <X size={13} />
              </button>
            )}
          </div>
        )}

        <div className="folder-browser-list">
          {loading ? (
            <div className="folder-browser-empty">
              <Loader2 size={18} className="animate-spin" />
              Loading folders...
            </div>
          ) : (() => {
            const filtered = browserData?.directories.filter((d) =>
              d.name.toLowerCase().includes(searchQuery.toLowerCase()),
            ) ?? [];
            return filtered.length > 0 ? (
              filtered.map((directory) => (
                <button
                  key={directory.path}
                  className="folder-browser-entry"
                  type="button"
                  onClick={() => void loadFolders(directory.path)}
                >
                  <div className="folder-browser-entry-main">
                    <Folder size={16} />
                    <span>{directory.name}</span>
                  </div>
                  <ChevronRight size={16} />
                </button>
              ))
            ) : (
              <div className="folder-browser-empty">
                {searchQuery
                  ? `No folders match "${searchQuery}".`
                  : "No subfolders found in this location."}
              </div>
            );
          })()}
        </div>
      </div>
    </div>
  );
};

export default FolderBrowserModal;
