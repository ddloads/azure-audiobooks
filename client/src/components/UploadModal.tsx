import { isAxiosError } from "axios";
import { useEffect, useState, type ChangeEvent, type FormEvent } from "react";
import { Upload, X, Loader2 } from "lucide-react";
import api from "../api/axios";

interface UploadModalProps {
  onClose: () => void;
  onUploadComplete: () => void;
}

interface UploadLibrary {
  id: string;
  name: string;
  _count: {
    books: number;
    sources: number;
  };
}

const getErrorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ error?: string }>(error)
    ? error.response?.data?.error || fallback
    : fallback;

const UploadModal = ({ onClose, onUploadComplete }: UploadModalProps) => {
  const [files, setFiles] = useState<File[]>([]);
  const [folderName, setFolderName] = useState("");
  const [libraries, setLibraries] = useState<UploadLibrary[]>([]);
  const [libraryId, setLibraryId] = useState("");
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState("");
  const hasLibraries = libraries.length > 0;

  useEffect(() => {
    const loadLibraries = async () => {
      try {
        const res = await api.get("/library/libraries");
        setLibraries(res.data);
        if (res.data[0]?.id) {
          setLibraryId(res.data[0].id);
        } else {
          setLibraryId("");
        }
      } catch (loadError) {
        setError(getErrorMessage(loadError, "Failed to load libraries"));
      }
    };

    void loadLibraries();
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files) return;
    const newFiles = Array.from(e.target.files);
    setFiles(newFiles);
    if (newFiles.length > 0 && newFiles[0].webkitRelativePath) {
      const parts = newFiles[0].webkitRelativePath.split("/");
      if (parts.length > 1) setFolderName(parts[0]);
    }
  };

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (files.length === 0 || !folderName || !libraryId) return;

    setUploading(true);
    setError("");

    const formData = new FormData();
    formData.append("folderName", folderName);
    if (libraryId) {
      formData.append("libraryId", libraryId);
    }
    files.forEach((file) => formData.append("files", file));

    try {
      await api.post("/upload", formData, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      onUploadComplete();
      onClose();
    } catch (error) {
      setError(
        isAxiosError<{ error?: string }>(error)
          ? error.response?.data?.error || "Upload failed"
          : "Upload failed",
      );
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="modal-backdrop" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div className="card modal-card">
        <div className="modal-header">
          <h2>Upload Audiobook</h2>
          <button className="modal-close" onClick={onClose} aria-label="Close">
            <X size={20} />
          </button>
        </div>

        {error && <div className="auth-error" style={{ marginBottom: "1.25rem" }}>{error}</div>}

        <form onSubmit={handleSubmit}>
          {!hasLibraries && (
            <div className="auth-error" style={{ marginBottom: "1.25rem" }}>
              Create a library and add at least one writable source path before uploading files.
            </div>
          )}

          <div className="form-group">
            <label>Library</label>
            <select
              className="form-control"
              value={libraryId}
              onChange={(e) => setLibraryId(e.target.value)}
              required
              disabled={!hasLibraries}
            >
              {!hasLibraries && <option value="">No libraries configured</option>}
              {libraries.map((library) => (
                <option key={library.id} value={library.id}>
                  {library.name} ({library._count.sources} source paths)
                </option>
              ))}
            </select>
          </div>

          <div className="form-group">
            <label>Folder Name (e.g. Author - Title)</label>
            <input
              type="text"
              className="form-control"
              value={folderName}
              onChange={(e) => setFolderName(e.target.value)}
              placeholder="J.R.R. Tolkien - The Hobbit"
              required
            />
          </div>

          <div
            className={`drop-zone${files.length > 0 ? " drop-zone-filled" : ""}`}
            onClick={() => document.getElementById("file-input")?.click()}
          >
            <div className="drop-zone-icon">
              <Upload size={36} />
            </div>
            {files.length > 0 ? (
              <div className="drop-zone-selected">
                <strong>{files.length} {files.length === 1 ? "file" : "files"} selected</strong>
                <span className="drop-zone-hint">Click to change selection</span>
              </div>
            ) : (
              <div className="drop-zone-selected">
                <strong>Click to select a folder</strong>
                <span className="drop-zone-hint">Supports MP3, M4A, M4B, OGG, FLAC, WAV</span>
              </div>
            )}
            <input
              id="file-input"
              type="file"
              multiple
              accept="audio/*,.mp3,.m4a,.m4b,.ogg,.flac,.wav,.aac,.opus"
              {...({ webkitdirectory: "", directory: "" } as Record<string, string>)}
              style={{ display: "none" }}
              onChange={handleFileChange}
            />
          </div>

          <button
            type="submit"
            className="btn btn-primary"
            style={{ width: "100%" }}
            disabled={uploading || files.length === 0 || !folderName || !libraryId || !hasLibraries}
          >
            {uploading ? (
              <>
                <Loader2 size={16} className="animate-spin" />
                Uploading…
              </>
            ) : (
              "Start Upload"
            )}
          </button>
        </form>
      </div>
    </div>
  );
};

export default UploadModal;
