import { useEffect, useRef, useState } from "react";
import { ListMusic, SlidersHorizontal } from "lucide-react";
import api from "../../../../api/axios";
import { useToast } from "../../../../context/ToastContext";
import type { AudibleChapterBackfillStatus, ScanSettings } from "../../types";
import { getErrorMessage } from "../../helpers";
import { Actions, Button, Panel, Progress, Stack, ToggleRow } from "../../ui";

const SCAN_TOGGLES: Array<{ key: keyof ScanSettings; label: string; on: string; off: string }> = [
  {
    key: "audibleChapters",
    label: "Get chapters from Audible",
    on: "Books without embedded chapters that have an ASIN get Audible's chapter list (via audnex.us), if its runtime matches the files. Fast and accurate.",
    off: "Chapters for those books are generated from the files, pauses or even spacing instead.",
  },
  {
    key: "fastStartEnabled",
    label: "Optimise files for streaming",
    on: "New .m4b and .m4a files are rewritten so seeking starts instantly. Slow on a network share: each file is read and written in full.",
    off: "Files are left as they are. Seeking in some .m4b and .m4a files may be slower when streaming.",
  },
  {
    key: "silenceChapters",
    label: "Find chapters from pauses",
    on: "Single-file books with no embedded or Audible chapters are decoded to place chapters at pauses. Can take minutes per book during a scan.",
    off: "Those books get evenly spaced chapters instead. Auto-chapterize on a book still uses pauses.",
  },
];

const POLL_MS = 3000;

const backfillSummary = (status: AudibleChapterBackfillStatus) => {
  const skipped = status.notFound + status.mismatched + status.failed;
  return `${status.updated.toLocaleString()} updated · ${skipped.toLocaleString()} skipped (${status.notFound} not on Audible, ${status.mismatched} different edition, ${status.failed} errors)`;
};

/** Admin switches for the expensive per-file work a library scan does. */
export default function ScanSettingsPanel() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [saving, setSaving] = useState<keyof ScanSettings | null>(null);
  const [backfill, setBackfill] = useState<AudibleChapterBackfillStatus | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const loadBackfill = async () => {
    try {
      const response = await api.get<AudibleChapterBackfillStatus>("/admin/chapters/audible");
      setBackfill(response.data);
      if (!response.data.running) stopPolling();
      return response.data;
    } catch {
      stopPolling();
      return null;
    }
  };

  const startPolling = () => {
    stopPolling();
    pollRef.current = window.setInterval(() => void loadBackfill(), POLL_MS);
  };

  useEffect(() => {
    api
      .get<ScanSettings>("/admin/settings/scan")
      .then((response) => setSettings(response.data))
      .catch((error) =>
        showToast({
          title: "Failed to load scan settings",
          description: getErrorMessage(error, "Failed to load scan settings"),
          tone: "error",
        }),
      );
    void loadBackfill().then((status) => {
      if (status?.running) startPolling();
    });
    return stopPolling;
  }, []);

  const handleToggle = async (key: keyof ScanSettings) => {
    if (!settings) return;
    setSaving(key);
    try {
      const response = await api.patch<ScanSettings>("/admin/settings/scan", { [key]: !settings[key] });
      setSettings(response.data);
      showToast({ title: "Scan settings updated", tone: "success" });
    } catch (error) {
      showToast({
        title: "Failed to update scan settings",
        description: getErrorMessage(error, "Failed to update scan settings"),
        tone: "error",
      });
    } finally {
      setSaving(null);
    }
  };

  const handleBackfill = async () => {
    setStarting(true);
    try {
      const response = await api.post<AudibleChapterBackfillStatus>("/admin/chapters/audible");
      setBackfill(response.data);
      showToast({
        title: response.data.total > 0 ? "Looking up Audible chapters" : "No books need Audible chapters",
        description: response.data.total > 0 ? `${response.data.total.toLocaleString()} books to check.` : undefined,
        tone: "success",
      });
      if (response.data.running) startPolling();
    } catch (error) {
      showToast({
        title: "Couldn't start the chapter lookup",
        description: getErrorMessage(error, "Failed to start the Audible chapter lookup"),
        tone: "error",
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Panel
      title="Scan processing"
      icon={SlidersHorizontal}
      description="Extra work done on new or changed books. Turn the slow ones off to speed up a large first import. Changes apply to running scans within a few seconds."
    >
      <Stack gap="md">
        <div>
          {SCAN_TOGGLES.map(({ key, label, on, off }) => (
            <ToggleRow
              key={key}
              title={label}
              description={settings?.[key] === false ? off : on}
              checked={settings?.[key] ?? false}
              disabled={!settings || saving === key}
              onChange={() => void handleToggle(key)}
            />
          ))}
        </div>

        <Stack gap="sm">
          <p className="as-subtle" style={{ margin: 0 }}>
            Books imported before this existed, or with chapters guessed from pauses or even spacing, can be upgraded to
            Audible's chapters. Books with real embedded chapters are left alone.
          </p>
          {backfill?.running ? (
            <>
              <Progress
                value={backfill.total > 0 ? (backfill.processed / backfill.total) * 100 : 0}
                label="Audible chapter lookup progress"
              />
              <span className="as-subtle">
                {backfill.processed.toLocaleString()} / {backfill.total.toLocaleString()} books checked ·{" "}
                {backfill.updated.toLocaleString()} updated
              </span>
            </>
          ) : (
            backfill?.finishedAt && (
              <span className="as-subtle">
                Last run: {backfillSummary(backfill)}
              </span>
            )
          )}
          <Actions align="start">
            <Button icon={ListMusic} loading={starting} disabled={backfill?.running} onClick={() => void handleBackfill()}>
              {backfill?.running ? "Looking up chapters…" : "Get Audible chapters for existing books"}
            </Button>
          </Actions>
        </Stack>
      </Stack>
    </Panel>
  );
}
