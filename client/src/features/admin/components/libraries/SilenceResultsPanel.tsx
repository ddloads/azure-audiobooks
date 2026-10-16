import { AlertTriangle, CheckCircle2, Loader2, RefreshCw, Volume2 } from "lucide-react";
import { Badge, Button, List, ListItem, Notice, Panel, Stack, Stat, StatGrid } from "../../ui";

export type SilentFileResult = {
  id: string;
  path: string;
  fileName: string;
  maxVolumeDb: number | null;
  silenceCheckedAt: string | null;
  book: { id: string; title: string; author: { name: string } } | null;
};

export type SilenceCheckResults = {
  totalFiles: number;
  totalChecked: number;
  totalSilent: number;
  silentFiles: SilentFileResult[];
};

interface SilenceResultsPanelProps {
  results: SilenceCheckResults | null;
  loading: boolean;
  onRefresh: () => void;
}

export default function SilenceResultsPanel({ results, loading, onRefresh }: SilenceResultsPanelProps) {
  const groups = results
    ? Object.values(
        results.silentFiles.reduce<Record<string, { book: SilentFileResult["book"]; files: SilentFileResult[] }>>(
          (acc, file) => {
            const key = file.book?.id ?? "__unknown";
            if (!acc[key]) acc[key] = { book: file.book, files: [] };
            acc[key].files.push(file);
            return acc;
          },
          {},
        ),
      )
    : [];

  const checkedPct = results && results.totalFiles > 0 ? (results.totalChecked / results.totalFiles) * 100 : 0;

  return (
    <Panel
      title="Audio check results"
      icon={Volume2}
      description="Files whose loudest point is near silence are usually broken or truncated rips."
      actions={
        <Button size="sm" icon={RefreshCw} loading={loading} onClick={onRefresh}>
          Refresh
        </Button>
      }
    >
      {loading && !results ? (
        <div className="as-libraries-loading">
          <Loader2 size={18} className="animate-spin" aria-hidden="true" />
          Loading results…
        </div>
      ) : results ? (
        <Stack gap="md">
          <StatGrid>
            <Stat
              label="Checked"
              value={results.totalChecked.toLocaleString()}
              sub={`of ${results.totalFiles.toLocaleString()} files · ${Math.round(checkedPct)}%`}
            />
            <Stat
              label="Silent"
              value={results.totalSilent.toLocaleString()}
              tone={results.totalSilent > 0 ? "warning" : "success"}
              sub={results.totalSilent > 0 ? `in ${groups.length} ${groups.length === 1 ? "book" : "books"}` : "Nothing to fix"}
            />
          </StatGrid>

          {results.totalChecked === 0 ? (
            <Notice icon={Volume2}>No files have been checked yet. Run an audio check from Library actions above.</Notice>
          ) : results.totalSilent === 0 ? (
            <Notice tone="success" icon={CheckCircle2}>
              All {results.totalChecked.toLocaleString()} checked files have audible content.
            </Notice>
          ) : (
            <Notice tone="warning" icon={AlertTriangle}>
              {results.totalSilent} silent file{results.totalSilent === 1 ? "" : "s"} found.
            </Notice>
          )}

          {results.totalSilent > 0 && (
            <List className="as-libraries-list">
              {groups.map((group) => (
                <ListItem
                  key={group.book?.id ?? "__unknown"}
                  title={group.book?.title ?? "Unknown book"}
                  subtitle={group.book?.author?.name}
                  trailing={<Badge tone="warning">{group.files.length}</Badge>}
                >
                  <ul className="as-libraries-files">
                    {group.files.map((file) => (
                      <li key={file.id} className="as-libraries-file" title={file.path}>
                        <span className="as-libraries-path">{file.fileName}</span>
                        <Badge tone={file.maxVolumeDb === null ? "danger" : "warning"}>
                          {file.maxVolumeDb !== null ? `${file.maxVolumeDb.toFixed(1)} dB` : "no audio"}
                        </Badge>
                      </li>
                    ))}
                  </ul>
                </ListItem>
              ))}
            </List>
          )}
        </Stack>
      ) : null}
    </Panel>
  );
}
