import { useEffect, useRef, useState } from "react";
import { CheckCircle2, Download, Trash2, X } from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import { formatElapsed, getErrorMessage } from "../admin/helpers";
import { Actions, Badge, Button, EmptyState, List, ListItem, Progress, Stack, type Tone } from "../admin/ui";

interface DownloadProgress {
  asin: string;
  title: string;
  phase: "downloading" | "converting" | "importing";
  percent: number | null;
  bytes: number | null;
  totalBytes: number | null;
  startedAt: string;
}

interface DownloadItem {
  asin: string;
  profile: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  downloadStatus: string;
  downloadError: string | null;
  downloadedPath: string | null;
  downloadedAt: string | null;
  updatedAt: string;
}

interface DownloadsResponse {
  current: DownloadProgress | null;
  queued: Array<{ asin: string; title: string }>;
  items: DownloadItem[];
}

const ACTIVE_POLL_MS = 2000;
const IDLE_POLL_MS = 15000;

const PHASE_LABELS: Record<DownloadProgress["phase"], string> = {
  downloading: "Downloading from Audible",
  converting: "Converting to M4B",
  importing: "Adding to library",
};

const STATUS_BADGES: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  done: { label: "Added", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

const describeProgress = (progress: DownloadProgress) => {
  const parts: string[] = [PHASE_LABELS[progress.phase]];
  if (progress.percent !== null) parts.push(`${Math.floor(progress.percent)}%`);
  if (progress.phase === "downloading" && progress.bytes) {
    parts.push(progress.totalBytes ? `${formatBytes(progress.bytes)} of ${formatBytes(progress.totalBytes)}` : formatBytes(progress.bytes));
  }
  return parts.join(" · ");
};

const Cover = ({ url }: { url: string | null }) =>
  url ? <img className="audible-missing-cover" src={url} alt="" loading="lazy" /> : <span className="audible-missing-cover" />;

interface Props {
  libraryId: string;
  /** Called when a download finishes, so the title lists can refresh. */
  onFinished: () => void;
}

/** The download queue: the title being processed with live progress, what's waiting, and recent results. */
export default function AudibleDownloads({ libraryId, onFinished }: Props) {
  const { showToast } = useToast();
  const [data, setData] = useState<DownloadsResponse | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const activeCountRef = useRef<number | null>(null);

  const load = async () => {
    try {
      const response = await api.get<DownloadsResponse>("/admin/audible-library/downloads");
      const active = (response.data.current ? 1 : 0) + response.data.queued.length;
      if (activeCountRef.current !== null && active < activeCountRef.current) onFinished();
      activeCountRef.current = active;
      setData(response.data);
    } catch {
      // Keep showing the last state; the next poll retries.
    }
  };

  const isActive = Boolean(data?.current || data?.queued.length);
  useEffect(() => {
    if (!data) {
      void load();
      return;
    }
    const timer = window.setTimeout(() => void load(), isActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => window.clearTimeout(timer);
  }, [data]);

  const run = async (key: string, action: () => Promise<void>, failure: string) => {
    setBusy(key);
    try {
      await action();
      await load();
    } catch (error) {
      showToast({ title: failure, description: getErrorMessage(error, "Try again in a moment."), tone: "error" });
    } finally {
      setBusy(null);
    }
  };

  const cancel = (asin: string) =>
    run(`cancel:${asin}`, async () => {
      await api.post("/admin/audible-library/downloads/cancel", { asins: [asin] });
    }, "Couldn't cancel");

  const retry = (item: DownloadItem) =>
    run(`retry:${item.asin}`, async () => {
      await api.post("/admin/audible-library/download", { profile: item.profile, asins: [item.asin], libraryId });
    }, "Couldn't start download");

  const clearFinished = () =>
    run("clear", async () => {
      await api.post("/admin/audible-library/downloads/clear");
      onFinished();
    }, "Couldn't clear");

  if (!data) return <div className="as-loading" aria-live="polite"><div className="app-loading-spinner" /></div>;

  const { current, queued } = data;
  const byAsin = new Map(data.items.map((item) => [item.asin, item]));
  const finished = data.items.filter((item) => item.downloadStatus === "done" || item.downloadStatus === "failed");

  if (!current && !queued.length && !finished.length) {
    return (
      <EmptyState icon={Download} title="No downloads">
        Titles you download from the Missing tab show up here with their progress.
      </EmptyState>
    );
  }

  return (
    <Stack gap="md">
      {(current || queued.length > 0) && (
        <List className="audible-missing-list">
          {current && (
            <ListItem
              leading={<Cover url={byAsin.get(current.asin)?.coverUrl ?? null} />}
              title={current.title}
              subtitle={byAsin.get(current.asin)?.author ?? null}
              meta={`${describeProgress(current)} · started ${formatElapsed(current.startedAt)}`}
            >
              <Progress
                value={current.percent ?? 0}
                tone="accent"
                label={`${current.title} progress`}
              />
            </ListItem>
          )}
          {queued.map((entry, index) => {
            const item = byAsin.get(entry.asin);
            return (
              <ListItem
                key={entry.asin}
                leading={<Cover url={item?.coverUrl ?? null} />}
                title={entry.title}
                subtitle={item?.author ?? null}
                meta={`Waiting · ${index + 1} of ${queued.length} in the queue`}
                trailing={
                  <span className="audible-missing-actions">
                    <Badge tone={STATUS_BADGES.queued.tone}>{STATUS_BADGES.queued.label}</Badge>
                    <Button size="sm" variant="ghost" icon={X} loading={busy === `cancel:${entry.asin}`} onClick={() => void cancel(entry.asin)}>
                      Cancel
                    </Button>
                  </span>
                }
              />
            );
          })}
        </List>
      )}

      {finished.length > 0 && (
        <>
          <Actions align="between">
            <span className="as-subtle">Finished</span>
            <Button size="sm" variant="ghost" icon={Trash2} loading={busy === "clear"} onClick={() => void clearFinished()}>
              Clear finished
            </Button>
          </Actions>
          <List className="audible-missing-list">
            {finished.map((item) => {
              const badge = STATUS_BADGES[item.downloadStatus];
              const when = item.downloadedAt ?? item.updatedAt;
              return (
                <ListItem
                  key={item.asin}
                  leading={<Cover url={item.coverUrl} />}
                  title={item.title}
                  subtitle={item.author}
                  meta={item.downloadStatus === "done" ? `${item.downloadedPath ?? ""} · ${formatElapsed(when)}` : formatElapsed(when)}
                  trailing={
                    <span className="audible-missing-actions">
                      <Badge tone={badge.tone}>
                        {item.downloadStatus === "done" && <CheckCircle2 size={12} aria-hidden="true" />} {badge.label}
                      </Badge>
                      {item.downloadStatus === "failed" && (
                        <Button
                          size="sm"
                          variant="primary"
                          icon={Download}
                          disabled={!libraryId}
                          loading={busy === `retry:${item.asin}`}
                          onClick={() => void retry(item)}
                        >
                          Retry
                        </Button>
                      )}
                    </span>
                  }
                >
                  {item.downloadStatus === "failed" && item.downloadError && (
                    <p className="audible-missing-error">{item.downloadError}</p>
                  )}
                </ListItem>
              );
            })}
          </List>
        </>
      )}
    </Stack>
  );
}
