import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { CloudDownload, Download, Eye, EyeOff, Library, RefreshCw } from "lucide-react";
import api from "../api/axios";
import { useToast } from "../context/ToastContext";
import { getErrorMessage, formatElapsed } from "../features/admin/helpers";
import {
  Actions,
  Badge,
  Button,
  EmptyState,
  Field,
  FormGrid,
  List,
  ListItem,
  Notice,
  Panel,
  SearchInput,
  Segmented,
  Stack,
  Toolbar,
  type Tone,
} from "../features/admin/ui";
import "./AudibleMissingPage.css";

interface AudibleTitle {
  asin: string;
  title: string;
  subtitle: string | null;
  author: string | null;
  narrator: string | null;
  seriesName: string | null;
  seriesSequence: string | null;
  durationSeconds: number | null;
  coverUrl: string | null;
  releaseDate: string | null;
  purchaseDate: string | null;
  ignored: boolean;
  downloadStatus: string | null;
  downloadError: string | null;
  bookId: string | null;
}

interface AudibleLibraryResponse {
  profile: string | null;
  profiles: string[];
  lastSyncedAt: string | null;
  syncing: boolean;
  items: AudibleTitle[];
  libraries: Array<{ id: string; name: string }>;
}

type View = "missing" | "ignored";

const POLL_MS = 4000;
const ACTIVE_STATUSES = new Set(["queued", "downloading", "converting", "importing"]);

const STATUS_LABELS: Record<string, { label: string; tone: Tone }> = {
  queued: { label: "Queued", tone: "neutral" },
  downloading: { label: "Downloading…", tone: "accent" },
  converting: { label: "Converting…", tone: "accent" },
  importing: { label: "Adding to library…", tone: "accent" },
  done: { label: "Downloaded", tone: "success" },
  failed: { label: "Failed", tone: "danger" },
};

const formatRuntime = (seconds: number | null) => {
  if (!seconds) return null;
  const h = Math.floor(seconds / 3600);
  const m = Math.round((seconds % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
};

const matchesSearch = (item: AudibleTitle, query: string) =>
  !query ||
  [item.title, item.subtitle, item.author, item.narrator, item.seriesName, item.asin]
    .some((value) => value?.toLowerCase().includes(query));

export default function AudibleMissingPage() {
  const { showToast } = useToast();
  const [data, setData] = useState<AudibleLibraryResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [profile, setProfile] = useState<string | null>(null);
  const [libraryId, setLibraryId] = useState<string>("");
  const [view, setView] = useState<View>("missing");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [syncing, setSyncing] = useState(false);
  const [busyAsins, setBusyAsins] = useState<Set<string>>(new Set());
  const pollRef = useRef<number | null>(null);

  const load = async (nextProfile = profile) => {
    try {
      const response = await api.get<AudibleLibraryResponse>("/admin/audible-library", {
        params: nextProfile ? { profile: nextProfile } : undefined,
      });
      setData(response.data);
      setProfile(response.data.profile);
      setLibraryId((current) =>
        response.data.libraries.some((library) => library.id === current) ? current : response.data.libraries[0]?.id ?? "",
      );
      return response.data;
    } catch (error) {
      showToast({ title: "Couldn't load Audible titles", description: getErrorMessage(error, "Try again in a moment."), tone: "error" });
      return null;
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
    return () => {
      if (pollRef.current !== null) window.clearTimeout(pollRef.current);
    };
  }, []);

  // Keep refreshing while downloads are in flight so their status moves along.
  const hasActiveDownloads = data?.items.some((item) => item.downloadStatus && ACTIVE_STATUSES.has(item.downloadStatus)) ?? false;
  useEffect(() => {
    if (!hasActiveDownloads) return;
    pollRef.current = window.setTimeout(() => void load(), POLL_MS);
    return () => {
      if (pollRef.current !== null) window.clearTimeout(pollRef.current);
    };
  }, [data, hasActiveDownloads]);

  const notInLibrary = useMemo(() => data?.items.filter((item) => !item.bookId) ?? [], [data]);
  const missing = useMemo(() => notInLibrary.filter((item) => !item.ignored), [notInLibrary]);
  const ignored = useMemo(() => notInLibrary.filter((item) => item.ignored), [notInLibrary]);
  const inLibraryCount = (data?.items.length ?? 0) - notInLibrary.length;

  const query = search.trim().toLowerCase();
  const visible = (view === "missing" ? missing : ignored).filter((item) => matchesSearch(item, query));
  const selectedVisible = visible.filter((item) => selected.has(item.asin));

  const changeView = (next: View) => {
    setView(next);
    setSelected(new Set());
  };

  const changeProfile = (next: string) => {
    setProfile(next);
    setSelected(new Set());
    void load(next);
  };

  const toggleSelected = (asin: string) =>
    setSelected((current) => {
      const next = new Set(current);
      if (next.has(asin)) next.delete(asin);
      else next.add(asin);
      return next;
    });

  const allVisibleSelected = visible.length > 0 && selectedVisible.length === visible.length;
  const toggleAll = () => setSelected(allVisibleSelected ? new Set() : new Set(visible.map((item) => item.asin)));

  const markBusy = (asins: string[], busy: boolean) =>
    setBusyAsins((current) => {
      const next = new Set(current);
      for (const asin of asins) {
        if (busy) next.add(asin);
        else next.delete(asin);
      }
      return next;
    });

  const handleSync = async () => {
    setSyncing(true);
    try {
      const response = await api.post<{ titles: number; removed: number }>("/admin/audible-library/sync", { profile });
      showToast({ title: "Audible library synced", description: `${response.data.titles.toLocaleString()} titles on the account.`, tone: "success" });
      await load();
    } catch (error) {
      showToast({ title: "Sync failed", description: getErrorMessage(error, "Couldn't reach Audible."), tone: "error" });
    } finally {
      setSyncing(false);
    }
  };

  const handleIgnore = async (asins: string[], nextIgnored: boolean) => {
    markBusy(asins, true);
    try {
      await api.post("/admin/audible-library/ignore", { profile, asins, ignored: nextIgnored });
      setSelected((current) => new Set([...current].filter((asin) => !asins.includes(asin))));
      await load();
    } catch (error) {
      showToast({ title: "Couldn't update", description: getErrorMessage(error, "Try again in a moment."), tone: "error" });
    } finally {
      markBusy(asins, false);
    }
  };

  const handleDownload = async (asins: string[]) => {
    markBusy(asins, true);
    try {
      const response = await api.post<{ queued: number }>("/admin/audible-library/download", { profile, asins, libraryId });
      showToast({
        title: response.data.queued ? "Download started" : "Already downloading",
        description: response.data.queued
          ? `${response.data.queued} ${response.data.queued === 1 ? "title" : "titles"} queued. They'll appear in the library when done.`
          : "Those titles are already in the queue.",
        tone: "success",
      });
      setSelected((current) => new Set([...current].filter((asin) => !asins.includes(asin))));
      await load();
    } catch (error) {
      showToast({ title: "Couldn't start download", description: getErrorMessage(error, "Try again in a moment."), tone: "error" });
    } finally {
      markBusy(asins, false);
    }
  };

  const canDownload = Boolean(libraryId);
  const downloadBlockedReason = canDownload ? undefined : "Mark a library folder as writable to download into it";

  const renderTrailing = (item: AudibleTitle) => {
    const status = item.downloadStatus ? STATUS_LABELS[item.downloadStatus] : null;
    const active = item.downloadStatus ? ACTIVE_STATUSES.has(item.downloadStatus) : false;
    const busy = busyAsins.has(item.asin);
    return (
      <>
        {status && <Badge tone={status.tone}>{status.label}</Badge>}
        {!active && view === "missing" && (
          <>
            <Button
              size="sm"
              variant="primary"
              icon={Download}
              loading={busy}
              disabled={!canDownload}
              title={downloadBlockedReason}
              onClick={() => void handleDownload([item.asin])}
            >
              {item.downloadStatus === "failed" ? "Retry" : "Download"}
            </Button>
            <Button size="sm" variant="ghost" icon={EyeOff} disabled={busy} onClick={() => void handleIgnore([item.asin], true)}>
              Ignore
            </Button>
          </>
        )}
        {view === "ignored" && (
          <Button size="sm" icon={Eye} loading={busy} onClick={() => void handleIgnore([item.asin], false)}>
            Restore
          </Button>
        )}
      </>
    );
  };

  const profiles = data?.profiles ?? [];
  const lastSynced = formatElapsed(data?.lastSyncedAt ?? null);

  return (
    <div className="as-page as-page-narrow audible-missing">
      <div className="as-section-intro">
        <h1 className="as-section-title"><CloudDownload size={20} aria-hidden="true" />Missing from library</h1>
        <p className="as-section-desc">
          Audible titles you own that aren't in the library yet. Download them or ignore the ones you don't want.
        </p>
      </div>

      {loading ? (
        <div className="as-loading" aria-live="polite"><div className="app-loading-spinner" /></div>
      ) : !profiles.length ? (
        <Notice tone="warning">
          No Audible account is linked. Add one in <Link to="/settings/system">Settings → System</Link>, then come back to sync.
        </Notice>
      ) : (
        <Stack gap="lg">
          <Panel
            title="Audible account"
            description={lastSynced ? `Last synced ${lastSynced}.` : "Not synced yet. Sync to fetch the titles on this account."}
            actions={
              <Button variant="primary" icon={RefreshCw} loading={syncing || data?.syncing} onClick={() => void handleSync()}>
                Sync
              </Button>
            }
          >
            <FormGrid>
              {profiles.length > 1 && (
                <Field label="Account" htmlFor="audible-missing-profile">
                  <select
                    id="audible-missing-profile"
                    className="form-control"
                    value={profile ?? ""}
                    onChange={(event) => changeProfile(event.target.value)}
                  >
                    {profiles.map((name) => <option key={name} value={name}>{name}</option>)}
                  </select>
                </Field>
              )}
              <Field label="Download into" htmlFor="audible-missing-library" hint="Books go into the library's writable folder as Author/Series/Title, or Author/Title when not in a series.">
                {data?.libraries.length ? (
                  <select
                    id="audible-missing-library"
                    className="form-control"
                    value={libraryId}
                    onChange={(event) => setLibraryId(event.target.value)}
                  >
                    {data.libraries.map((library) => <option key={library.id} value={library.id}>{library.name}</option>)}
                  </select>
                ) : (
                  <span className="as-subtle">
                    No library has a writable folder. Set one in <Link to="/settings/libraries">Settings → Libraries</Link>.
                  </span>
                )}
              </Field>
            </FormGrid>
            {data && data.items.length > 0 && (
              <p className="as-subtle audible-missing-summary">
                {data.items.length.toLocaleString()} titles on Audible · {inLibraryCount.toLocaleString()} in the library ·{" "}
                {missing.length.toLocaleString()} missing · {ignored.length.toLocaleString()} ignored
              </p>
            )}
          </Panel>

          <Segmented<View>
            label="Titles"
            value={view}
            onChange={changeView}
            options={[
              { value: "missing", label: "Missing", count: missing.length },
              { value: "ignored", label: "Ignored", count: ignored.length },
            ]}
          />

          <Toolbar>
            <SearchInput
              placeholder="Search title, author, narrator or series"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              aria-label="Search titles"
            />
          </Toolbar>

          {visible.length > 0 && (
            <Actions align="between" className="audible-missing-bulk">
              <label className="audible-missing-check">
                <input type="checkbox" checked={allVisibleSelected} onChange={toggleAll} />
                <span>{selectedVisible.length ? `${selectedVisible.length} selected` : "Select all"}</span>
              </label>
              {selectedVisible.length > 0 && (
                <div className="audible-missing-bulk-actions">
                  {view === "missing" ? (
                    <>
                      <Button
                        size="sm"
                        variant="primary"
                        icon={Download}
                        disabled={!canDownload}
                        title={downloadBlockedReason}
                        onClick={() => void handleDownload(selectedVisible.map((item) => item.asin))}
                      >
                        Download {selectedVisible.length}
                      </Button>
                      <Button size="sm" icon={EyeOff} onClick={() => void handleIgnore(selectedVisible.map((item) => item.asin), true)}>
                        Ignore {selectedVisible.length}
                      </Button>
                    </>
                  ) : (
                    <Button size="sm" icon={Eye} onClick={() => void handleIgnore(selectedVisible.map((item) => item.asin), false)}>
                      Restore {selectedVisible.length}
                    </Button>
                  )}
                </div>
              )}
            </Actions>
          )}

          {visible.length === 0 ? (
            <EmptyState icon={view === "missing" ? Library : EyeOff} title={
              query ? "No titles match your search" :
              !data?.items.length ? "No Audible titles yet" :
              view === "missing" ? "Everything on Audible is in the library" : "No ignored titles"
            }>
              {!data?.items.length && !query ? "Sync to fetch the titles on this Audible account." : null}
            </EmptyState>
          ) : (
            <List className="audible-missing-list">
              {visible.map((item) => {
                const series = item.seriesName ? `${item.seriesName}${item.seriesSequence ? ` #${item.seriesSequence}` : ""}` : null;
                const purchased = item.purchaseDate ? `Purchased ${new Date(item.purchaseDate).toLocaleDateString()}` : null;
                return (
                  <ListItem
                    key={item.asin}
                    selected={selected.has(item.asin)}
                    leading={
                      <span className="audible-missing-leading">
                        <input
                          type="checkbox"
                          checked={selected.has(item.asin)}
                          onChange={() => toggleSelected(item.asin)}
                          aria-label={`Select ${item.title}`}
                        />
                        {item.coverUrl ? (
                          <img className="audible-missing-cover" src={item.coverUrl} alt="" loading="lazy" />
                        ) : (
                          <span className="audible-missing-cover audible-missing-cover-empty" />
                        )}
                      </span>
                    }
                    title={item.title}
                    subtitle={[item.author, item.narrator && `Narrated by ${item.narrator}`].filter(Boolean).join(" · ") || null}
                    meta={[series, formatRuntime(item.durationSeconds), purchased].filter(Boolean).join(" · ") || null}
                    trailing={<span className="audible-missing-actions">{renderTrailing(item)}</span>}
                  >
                    {item.downloadStatus === "failed" && item.downloadError && (
                      <p className="audible-missing-error">{item.downloadError}</p>
                    )}
                  </ListItem>
                );
              })}
            </List>
          )}
        </Stack>
      )}
    </div>
  );
}
