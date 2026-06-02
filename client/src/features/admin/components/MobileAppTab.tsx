import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, Loader2, Smartphone, Upload } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import { formatBytes, formatDate, getErrorMessage } from "../helpers";

type MobileAppRelease = {
  appName: string;
  version: string;
  fileName: string;
  size: number;
  updatedAt: string;
  downloadUrl: string;
};

const VERSION_REGEX = /v?(\d+\.\d+\.\d+(?:[-.][A-Za-z0-9]+)?)/;

export default function MobileAppTab() {
  const { showToast } = useToast();
  const [release, setRelease] = useState<MobileAppRelease | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [file, setFile] = useState<File | null>(null);
  const [version, setVersion] = useState("");
  const fileRef = useRef<HTMLInputElement | null>(null);

  const loadRelease = async () => {
    setLoading(true);
    try {
      const res = await api.get<MobileAppRelease>("/mobile-app/latest");
      setRelease(res.data);
    } catch {
      setRelease(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadRelease();
  }, []);

  const handleFileChange = (e: ChangeEvent<HTMLInputElement>) => {
    const selected = e.target.files?.[0] ?? null;
    setFile(selected);
    if (selected) {
      const match = selected.name.match(VERSION_REGEX);
      if (match) setVersion(match[1]);
    }
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    try {
      const form = new FormData();
      form.append("apk", file);
      const trimmed = version.trim();
      if (trimmed) form.append("version", trimmed);
      const res = await api.post<MobileAppRelease>("/mobile-app/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
      });
      setRelease(res.data);
      setFile(null);
      setVersion("");
      if (fileRef.current) fileRef.current.value = "";
      showToast({
        title: "Azure Player APK published",
        description: `Version ${res.data.version} is now downloadable.`,
        tone: "success",
      });
    } catch (err) {
      showToast({
        title: "Failed to publish APK",
        description: getErrorMessage(err, "Failed to upload APK"),
        tone: "error",
      });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="admin-panel-stack">
      <div className="card admin-section-card">
        <div className="admin-section-head">
          <h3>Currently published</h3>
          <Smartphone size={15} />
        </div>
        {loading ? (
          <div className="admin-empty-state">Checking latest APK…</div>
        ) : release ? (
          <>
            <div className="admin-meta-list">
              <div>
                <span>Version</span>
                <code>{release.version}</code>
              </div>
              <div>
                <span>File</span>
                <code>{release.fileName}</code>
              </div>
              <div>
                <span>Size</span>
                <code>{formatBytes(release.size)}</code>
              </div>
              <div>
                <span>Published</span>
                <code>{formatDate(release.updatedAt)}</code>
              </div>
            </div>
            <a
              className="btn btn-secondary"
              href={release.downloadUrl}
              style={{ marginTop: "1rem" }}
            >
              <Download size={14} />
              Download published APK
            </a>
          </>
        ) : (
          <div className="admin-empty-state">
            No APK has been published yet. Upload one below to enable the
            Download Azure Player APK button in the Connect Mobile App modal.
          </div>
        )}
      </div>

      <div className="card admin-section-card">
        <div className="admin-section-head">
          <h3>Publish a new APK</h3>
          <Upload size={15} />
        </div>
        <p style={{ color: "var(--text-secondary)", fontSize: "0.9rem" }}>
          Upload a release APK from the Azure Player Android build (for example{" "}
          <code>AzurePlayer-v1.0.7-release.apk</code>). It replaces the file
          served by the Download Azure Player APK button immediately.
        </p>

        <div className="admin-action-list" style={{ marginTop: "1rem" }}>
          <div className="admin-action-item">
            <div>
              <strong>APK file</strong>
              <small>
                {file
                  ? `${file.name} (${formatBytes(file.size)})`
                  : "Select a .apk file to upload"}
              </small>
            </div>
            <input
              ref={fileRef}
              type="file"
              accept=".apk,application/vnd.android.package-archive"
              onChange={handleFileChange}
              disabled={uploading}
              style={{ maxWidth: "280px" }}
            />
          </div>

          <div className="admin-action-item">
            <div>
              <strong>Version</strong>
              <small>Optional. Defaults to the version parsed from the filename.</small>
            </div>
            <input
              className="form-control"
              type="text"
              placeholder="1.0.7"
              value={version}
              onChange={(e) => setVersion(e.target.value)}
              disabled={uploading}
              style={{ maxWidth: "200px" }}
            />
          </div>

          <div className="admin-action-item">
            <div>
              <strong>Publish</strong>
              <small>Replaces the currently published APK and manifest.</small>
            </div>
            <button
              className="btn btn-primary"
              type="button"
              disabled={!file || uploading}
              onClick={() => void handleUpload()}
            >
              {uploading ? (
                <Loader2 size={15} className="animate-spin" />
              ) : (
                <Upload size={15} />
              )}
              {uploading ? "Uploading…" : "Publish APK"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
