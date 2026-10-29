import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { BookOpen, History } from "lucide-react";
import api from "../../api/axios";
import { useToast } from "../../context/ToastContext";
import { formatDate, getErrorMessage } from "../admin/helpers";
import { Actions, Badge, Button, EmptyState, List, ListItem, SearchInput, Stack, Toolbar, type Tone } from "../admin/ui";

interface HistoryEntry {
  id: string;
  asin: string;
  title: string;
  author: string | null;
  coverUrl: string | null;
  status: "done" | "failed" | "cancelled";
  error: string | null;
  trigger: "manual" | "auto";
  folderPath: string | null;
  bookId: string | null;
  sizeBytes: number | null;
  startedAt: string | null;
  finishedAt: string;
}

interface HistoryResponse {
  entries: HistoryEntry[];
  nextCursor: string | null;
}

const STATUS_BADGES: Record<HistoryEntry["status"], { label: string; tone: Tone }> = {
  done: { label: "Added", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
  cancelled: { label: "Cancelled", tone: "neutral" },
};

const SEARCH_DELAY_MS = 300;

const formatBytes = (bytes: number) =>
  bytes >= 1024 ** 3 ? `${(bytes / 1024 ** 3).toFixed(2)} GB` : `${Math.round(bytes / 1024 ** 2)} MB`;

const formatTook = (startedAt: string | null, finishedAt: string) => {
  if (!startedAt) return null;
  const minutes = Math.round((new Date(finishedAt).getTime() - new Date(startedAt).getTime()) / 60000);
  if (minutes < 1) return "took under a minute";
  return minutes < 60 ? `took ${minutes}m` : `took ${Math.floor(minutes / 60)}h ${minutes % 60}m`;
};

/** Every past download attempt, newest first, including failed and cancelled ones. */
export default function AudibleDownloadHistory() {
  const { showToast } = useToast();
  const [entries, setEntries] = useState<HistoryEntry[] | null>(null);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [search, setSearch] = useState("");
  const [loadingMore, setLoadingMore] = useState(false);

  const fetchPage = async (query: string, before: string | null) => {
    const response = await api.get<HistoryResponse>("/admin/audible-library/history", {
      params: { ...(query ? { q: query } : {}), ...(before ? { before } : {}) },
    });
    return response.data;
  };

  useEffect(() => {
    let cancelled = false;
    const timer = window.setTimeout(() => {
      fetchPage(search.trim(), null)
        .then((page) => {
          if (cancelled) return;
          setEntries(page.entries);
          setNextCursor(page.nextCursor);
        })
        .catch((error) => {
          if (!cancelled) showToast({ title: "Couldn't load history", description: getErrorMessage(error, "Try again in a moment."), tone: "error" });
        });
    }, entries === null ? 0 : SEARCH_DELAY_MS);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [search]);

  const loadMore = async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await fetchPage(search.trim(), nextCursor);
      setEntries((current) => [...(current ?? []), ...page.entries]);
      setNextCursor(page.nextCursor);
    } catch (error) {
      showToast({ title: "Couldn't load more", description: getErrorMessage(error, "Try again in a moment."), tone: "error" });
    } finally {
      setLoadingMore(false);
    }
  };

  return (
    <Stack gap="md">
      <Toolbar>
        <SearchInput
          placeholder="Search title, author or ASIN"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
          aria-label="Search download history"
        />
      </Toolbar>

      {entries === null ? (
        <div className="as-loading" aria-live="polite"><div className="app-loading-spinner" /></div>
      ) : entries.length === 0 ? (
        <EmptyState icon={History} title={search.trim() ? "No downloads match your search" : "No downloads yet"}>
          {search.trim() ? null : "Every download from Audible is recorded here, including failed and cancelled ones."}
        </EmptyState>
      ) : (
        <>
          <List className="audible-missing-list">
            {entries.map((entry) => {
              const badge = STATUS_BADGES[entry.status];
              const meta = [
                formatDate(entry.finishedAt),
                entry.trigger === "auto" ? "Automatic" : "Manual",
                entry.sizeBytes ? formatBytes(entry.sizeBytes) : null,
                entry.status === "done" ? formatTook(entry.startedAt, entry.finishedAt) : null,
              ].filter(Boolean).join(" · ");
              return (
                <ListItem
                  key={entry.id}
                  leading={
                    entry.coverUrl
                      ? <img className="audible-missing-cover" src={entry.coverUrl} alt="" loading="lazy" />
                      : <span className="audible-missing-cover" />
                  }
                  title={entry.title}
                  subtitle={entry.author}
                  meta={meta}
                  trailing={
                    <span className="audible-missing-actions">
                      <Badge tone={badge.tone}>{badge.label}</Badge>
                      {entry.bookId && (
                        <Link className="as-btn as-btn-ghost as-btn-sm" to={`/book/${entry.bookId}`}>
                          <BookOpen size={14} aria-hidden="true" />
                          Open
                        </Link>
                      )}
                    </span>
                  }
                >
                  {entry.status === "failed" && entry.error && <p className="audible-missing-error">{entry.error}</p>}
                  {entry.status === "done" && entry.folderPath && <p className="as-subtle audible-missing-path">{entry.folderPath}</p>}
                </ListItem>
              );
            })}
          </List>
          {nextCursor && (
            <Actions align="start">
              <Button size="sm" loading={loadingMore} onClick={() => void loadMore()}>Load more</Button>
            </Actions>
          )}
        </>
      )}
    </Stack>
  );
}
