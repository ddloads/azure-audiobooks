import { useEffect, useRef, useState } from "react";
import { ListMusic, SearchCheck, type LucideIcon } from "lucide-react";
import api from "../../../../api/axios";
import { useToast } from "../../../../context/ToastContext";
import type { AsinFinderStatus, AudibleChapterBackfillStatus } from "../../types";
import { getErrorMessage } from "../../helpers";
import { Actions, Button, Progress, Stack } from "../../ui";

const POLL_MS = 3000;

type JobStatus = { running: boolean; total: number; processed: number; finishedAt: string | null };

interface JobConfig<T extends JobStatus> {
  path: string;
  icon: LucideIcon;
  label: string;
  runningLabel: string;
  description: string;
  startedToast: (status: T) => string;
  progressText: (status: T) => string;
  summary: (status: T) => string;
}

const ASIN_JOB: JobConfig<AsinFinderStatus> = {
  path: "/admin/asins/find",
  icon: SearchCheck,
  label: "Find ASINs for books without one",
  runningLabel: "Finding ASINs…",
  description:
    "Looks each book up in Audible's catalog and saves the ASIN only when the runtime and author match. Nothing else about the book changes. Books that get an ASIN also get Audible's chapters.",
  startedToast: (status) => (status.total > 0 ? `${status.total.toLocaleString()} books to look up.` : "Every book already has an ASIN."),
  progressText: (status) =>
    `${status.processed.toLocaleString()} / ${status.total.toLocaleString()} books checked · ${status.found.toLocaleString()} ASINs found · ${status.chaptersUpdated.toLocaleString()} chapter lists updated`,
  summary: (status) =>
    `${status.found.toLocaleString()} ASINs found, ${status.chaptersUpdated.toLocaleString()} chapter lists updated · ${status.noMatch.toLocaleString()} no confident match · ${status.failed} errors`,
};

const CHAPTERS_JOB: JobConfig<AudibleChapterBackfillStatus> = {
  path: "/admin/chapters/audible",
  icon: ListMusic,
  label: "Get Audible chapters for existing books",
  runningLabel: "Looking up chapters…",
  description:
    "For books that already have an ASIN: replaces chapters guessed from pauses or even spacing with Audible's. Books with real embedded chapters are left alone.",
  startedToast: (status) => (status.total > 0 ? `${status.total.toLocaleString()} books to check.` : "No books need Audible chapters."),
  progressText: (status) =>
    `${status.processed.toLocaleString()} / ${status.total.toLocaleString()} books checked · ${status.updated.toLocaleString()} updated`,
  summary: (status) => {
    const skipped = status.notFound + status.mismatched + status.failed;
    return `${status.updated.toLocaleString()} updated · ${skipped.toLocaleString()} skipped (${status.notFound} not on Audible, ${status.mismatched} different edition, ${status.failed} errors)`;
  },
};

function AudibleJob<T extends JobStatus>({ config, otherRunning, onRunningChange }: {
  config: JobConfig<T>;
  otherRunning: boolean;
  onRunningChange: (running: boolean) => void;
}) {
  const { showToast } = useToast();
  const [status, setStatus] = useState<T | null>(null);
  const [starting, setStarting] = useState(false);
  const pollRef = useRef<number | null>(null);

  const stopPolling = () => {
    if (pollRef.current !== null) window.clearInterval(pollRef.current);
    pollRef.current = null;
  };

  const load = async () => {
    try {
      const response = await api.get<T>(config.path);
      setStatus(response.data);
      onRunningChange(response.data.running);
      if (!response.data.running) stopPolling();
      return response.data;
    } catch {
      stopPolling();
      return null;
    }
  };

  const startPolling = () => {
    stopPolling();
    pollRef.current = window.setInterval(() => void load(), POLL_MS);
  };

  useEffect(() => {
    void load().then((current) => {
      if (current?.running) startPolling();
    });
    return stopPolling;
  }, []);

  const handleStart = async () => {
    setStarting(true);
    try {
      const response = await api.post<T>(config.path);
      setStatus(response.data);
      onRunningChange(response.data.running);
      showToast({ title: config.label, description: config.startedToast(response.data), tone: "success" });
      if (response.data.running) startPolling();
    } catch (error) {
      showToast({
        title: "Couldn't start",
        description: getErrorMessage(error, "Another Audible job may be running. Try again when it finishes."),
        tone: "error",
      });
    } finally {
      setStarting(false);
    }
  };

  return (
    <Stack gap="sm">
      <p className="as-subtle" style={{ margin: 0 }}>{config.description}</p>
      {status?.running ? (
        <>
          <Progress value={status.total > 0 ? (status.processed / status.total) * 100 : 0} label={`${config.label} progress`} />
          <span className="as-subtle">{config.progressText(status)}</span>
        </>
      ) : (
        status?.finishedAt && <span className="as-subtle">Last run: {config.summary(status)}</span>
      )}
      <Actions align="start">
        <Button
          icon={config.icon}
          loading={starting}
          disabled={status?.running || otherRunning}
          title={otherRunning ? "Wait for the other Audible job to finish" : undefined}
          onClick={() => void handleStart()}
        >
          {status?.running ? config.runningLabel : config.label}
        </Button>
      </Actions>
    </Stack>
  );
}

/** Background jobs that fill in ASINs and Audible chapters. Only one runs at a time. */
export default function AudibleJobs() {
  const [asinRunning, setAsinRunning] = useState(false);
  const [chaptersRunning, setChaptersRunning] = useState(false);

  return (
    <Stack gap="md">
      <AudibleJob config={ASIN_JOB} otherRunning={chaptersRunning} onRunningChange={setAsinRunning} />
      <AudibleJob config={CHAPTERS_JOB} otherRunning={asinRunning} onRunningChange={setChaptersRunning} />
    </Stack>
  );
}
