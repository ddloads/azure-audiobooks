import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { Download, FileUp, Package, Smartphone, Upload, X } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import { formatBytes, formatDate, getErrorMessage } from "../helpers";
import { Actions, Button, EmptyState, Field, KeyValues, Panel, Progress, Stack } from "../ui";
import "./MobileAppTab.css";

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
  const [uploadProgress, setUploadProgress] = useState(0);
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

  const clearFile = () => {
    setFile(null);
    setVersion("");
    if (fileRef.current) fileRef.current.value = "";
  };

  const handleUpload = async () => {
    if (!file) return;
    setUploading(true);
    setUploadProgress(0);
    try {
      const form = new FormData();
      form.append("apk", file);
      const trimmed = version.trim();
      if (trimmed) form.append("version", trimmed);
      const res = await api.post<MobileAppRelease>("/mobile-app/upload", form, {
        headers: { "Content-Type": "multipart/form-data" },
        onUploadProgress: (event) => {
          if (event.total) setUploadProgress((event.loaded / event.total) * 100);
        },
      });
      setRelease(res.data);
      clearFile();
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
    <Stack>
      <Panel title="Currently published" icon={Smartphone} description="What the Download Azure Player APK button serves.">
        {loading ? (
          <div className="as-loading">
            <div className="app-loading-spinner" />
          </div>
        ) : release ? (
          <Stack gap="md">
            <KeyValues
              items={[
                { label: "Version", value: release.version, mono: true },
                { label: "File", value: release.fileName, mono: true },
                { label: "Size", value: formatBytes(release.size) },
                { label: "Uploaded", value: formatDate(release.updatedAt) },
              ]}
            />
            <Actions align="start">
              <a className="as-btn as-btn-secondary" href={release.downloadUrl} download={release.fileName}>
                <Download size={16} aria-hidden="true" />
                Download APK
              </a>
            </Actions>
          </Stack>
        ) : (
          <EmptyState icon={Package} title="No APK published yet">
            Upload one below to enable the Download Azure Player APK button in the Connect Mobile App modal.
          </EmptyState>
        )}
      </Panel>

      <Panel
        title="Publish a new APK"
        icon={Upload}
        description={
          <>
            Upload a release build (for example <code>AzurePlayer-v1.0.7-release.apk</code>). It replaces the
            published APK and manifest immediately.
          </>
        }
      >
        <form
          onSubmit={(event) => {
            event.preventDefault();
            void handleUpload();
          }}
        >
          <Stack gap="md">
            <Field label="APK file" htmlFor="mobile-apk-file">
              <input
                id="mobile-apk-file"
                ref={fileRef}
                className="as-mobile-file-input"
                type="file"
                accept=".apk,application/vnd.android.package-archive"
                onChange={handleFileChange}
                disabled={uploading}
              />
              {file ? (
                <div className="as-mobile-file as-mobile-file-selected">
                  <span className="as-mobile-file-icon"><Package size={18} aria-hidden="true" /></span>
                  <span className="as-mobile-file-text">
                    <strong>{file.name}</strong>
                    <small>{formatBytes(file.size)}</small>
                  </span>
                  <Button variant="ghost" size="sm" iconOnly icon={X} aria-label="Remove file" disabled={uploading} onClick={clearFile} />
                </div>
              ) : (
                <label htmlFor="mobile-apk-file" className="as-mobile-file">
                  <span className="as-mobile-file-icon"><FileUp size={18} aria-hidden="true" /></span>
                  <span className="as-mobile-file-text">
                    <strong>Choose an .apk file</strong>
                    <small>Tap to browse</small>
                  </span>
                </label>
              )}
            </Field>

            <Field label="Version" htmlFor="mobile-apk-version" hint="Optional. Defaults to the version parsed from the filename.">
              <input
                id="mobile-apk-version"
                className="form-control"
                type="text"
                inputMode="decimal"
                placeholder="1.0.7"
                value={version}
                onChange={(e) => setVersion(e.target.value)}
                disabled={uploading}
              />
            </Field>

            {uploading && (
              <div className="as-mobile-progress">
                <Progress value={uploadProgress} label="Upload progress" />
                <span>{uploadProgress >= 100 ? "Processing…" : `Uploading… ${Math.round(uploadProgress)}%`}</span>
              </div>
            )}

            <Actions>
              <Button type="submit" variant="primary" icon={Upload} disabled={!file} loading={uploading}>
                {uploading ? "Uploading…" : "Publish APK"}
              </Button>
            </Actions>
          </Stack>
        </form>
      </Panel>
    </Stack>
  );
}
