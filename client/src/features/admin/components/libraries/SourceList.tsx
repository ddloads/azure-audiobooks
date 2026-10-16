import { useState } from "react";
import { FolderOpen, FolderPlus, HardDrive, Network, Plus, Server, Trash2, X, type LucideIcon } from "lucide-react";
import FolderBrowserModal from "../../../../components/FolderBrowserModal";
import type { AdminLibrarySource } from "../../types";
import { derivedLabel, detectKind } from "../../helpers";
import { Actions, Badge, Button, EmptyState, Field, List, ListItem, Stack, ToggleRow } from "../../ui";

export type SourceDraft = { label: string; path: string; kind: string; isWritable: boolean; isWatched: boolean };
export type SourceFlag = "isEnabled" | "isWritable" | "isWatched";

const EMPTY_SOURCE: SourceDraft = { label: "", path: "", kind: "LOCAL", isWritable: false, isWatched: false };

const KIND_META: Record<string, { icon: LucideIcon; label: string }> = {
  LOCAL: { icon: HardDrive, label: "Local" },
  MAPPED: { icon: Server, label: "Mapped drive" },
  NETWORK: { icon: Network, label: "Network share" },
};

const kindMeta = (kind: string) => KIND_META[kind] ?? { icon: HardDrive, label: kind };

export function KindIcon({ kind }: { kind: string }) {
  const { icon: Icon } = kindMeta(kind);
  return (
    <span className="as-libraries-kind" aria-hidden="true">
      <Icon size={16} />
    </span>
  );
}

interface SourceListProps {
  libraryId: string;
  sources: AdminLibrarySource[];
  actionLoading: string | null;
  onToggle: (sourceId: string, field: SourceFlag, value: boolean) => void;
  onRemove: (source: AdminLibrarySource) => void;
  onCreate: (draft: SourceDraft) => Promise<boolean>;
}

export default function SourceList({ libraryId, sources, actionLoading, onToggle, onRemove, onCreate }: SourceListProps) {
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState<SourceDraft>(EMPTY_SOURCE);
  const [browsing, setBrowsing] = useState(false);

  const createKey = `create-source-${libraryId}`;
  const pathId = `source-path-${libraryId}`;
  const labelId = `source-label-${libraryId}`;

  const submit = async () => {
    if (!draft.path.trim()) return;
    const ok = await onCreate(draft);
    if (ok) {
      setDraft(EMPTY_SOURCE);
      setAdding(false);
    }
  };

  return (
    <Stack gap="sm">
      <div className="as-libraries-subhead">
        <span>Source folders</span>
        {!adding && (
          <Button size="sm" variant="ghost" icon={FolderPlus} onClick={() => setAdding(true)}>
            Add source
          </Button>
        )}
      </div>

      {sources.length === 0 && !adding ? (
        <div className="as-libraries-inset">
          <EmptyState
            icon={FolderOpen}
            title="No source folders"
            action={<Button size="sm" variant="primary" icon={FolderPlus} onClick={() => setAdding(true)}>Add source</Button>}
          >
            Point this library at a local folder, mapped drive or network share so it can be scanned.
          </EmptyState>
        </div>
      ) : sources.length > 0 ? (
        <List className="as-libraries-list">
          {sources.map((source) => {
            const expanded = expandedId === source.id;
            const meta = kindMeta(source.kind);
            return (
              <ListItem
                key={source.id}
                selected={expanded}
                onClick={() => setExpandedId(expanded ? null : source.id)}
                leading={<KindIcon kind={source.kind} />}
                title={
                  <>
                    {source.label || derivedLabel(source.path)}
                    {!source.isEnabled && <Badge tone="warning">Disabled</Badge>}
                  </>
                }
                subtitle={<span className="as-libraries-path">{source.path}</span>}
                meta={
                  <span className="as-libraries-flags">
                    <span>{meta.label}</span>
                    {source.isWritable && <Badge tone="accent">Writable</Badge>}
                    {source.isWatched && <Badge tone="success">Watched</Badge>}
                  </span>
                }
                chevron={!expanded}
              >
                {expanded && (
                  <Stack gap="sm">
                    <div className="as-libraries-toggles">
                      <ToggleRow
                        title="Enabled"
                        description="Include this folder when scanning."
                        checked={source.isEnabled}
                        disabled={actionLoading === `update-source-${source.id}-isEnabled`}
                        onChange={(next) => onToggle(source.id, "isEnabled", next)}
                      />
                      <ToggleRow
                        title="Writable"
                        description="Allow uploaded books to be saved here."
                        checked={source.isWritable}
                        disabled={actionLoading === `update-source-${source.id}-isWritable`}
                        onChange={(next) => onToggle(source.id, "isWritable", next)}
                      />
                      <ToggleRow
                        title="Watched"
                        description="Rescan automatically when files change."
                        checked={source.isWatched}
                        disabled={actionLoading === `update-source-${source.id}-isWatched`}
                        onChange={(next) => onToggle(source.id, "isWatched", next)}
                      />
                    </div>
                    <Actions align="start">
                      <Button
                        variant="danger"
                        size="sm"
                        icon={Trash2}
                        loading={actionLoading === `delete-source-${source.id}`}
                        onClick={() => onRemove(source)}
                      >
                        Remove source
                      </Button>
                    </Actions>
                  </Stack>
                )}
              </ListItem>
            );
          })}
        </List>
      ) : null}

      {adding && (
        <form
          className="as-libraries-inset as-libraries-form"
          onSubmit={(event) => {
            event.preventDefault();
            void submit();
          }}
        >
          <Stack gap="md">
            <Field
              label="Folder path"
              htmlFor={pathId}
              hint={
                <span className="as-libraries-flags">
                  Detected as <Badge tone="accent">{kindMeta(draft.kind).label}</Badge>
                </span>
              }
            >
              <div className="as-libraries-path-picker">
                <input
                  id={pathId}
                  className="form-control as-libraries-path-input"
                  placeholder={`C:\\Audiobooks  or  \\\\server\\share`}
                  autoComplete="off"
                  autoCapitalize="none"
                  spellCheck={false}
                  value={draft.path}
                  onChange={(e) => {
                    const path = e.target.value;
                    setDraft((current) => ({ ...current, path, kind: detectKind(path) }));
                  }}
                />
                <Button icon={FolderOpen} onClick={() => setBrowsing(true)}>
                  Browse
                </Button>
              </div>
            </Field>
            <Field label="Label" htmlFor={labelId} hint="Optional. Shown instead of the full path.">
              <input
                id={labelId}
                className="form-control"
                autoComplete="off"
                placeholder={draft.path ? `Default: ${derivedLabel(draft.path)}` : "e.g. NAS audiobooks"}
                value={draft.label}
                onChange={(e) => setDraft((current) => ({ ...current, label: e.target.value }))}
              />
            </Field>
            <div className="as-libraries-toggles">
              <ToggleRow
                title="Writable"
                description="Allow uploads into this folder."
                checked={draft.isWritable}
                onChange={(next) => setDraft((current) => ({ ...current, isWritable: next }))}
              />
              <ToggleRow
                title="Watch"
                description="Auto-scan when files change."
                checked={draft.isWatched}
                onChange={(next) => setDraft((current) => ({ ...current, isWatched: next }))}
              />
            </div>
            <Actions>
              <Button
                variant="ghost"
                icon={X}
                onClick={() => {
                  setAdding(false);
                  setDraft(EMPTY_SOURCE);
                }}
              >
                Cancel
              </Button>
              <Button type="submit" variant="primary" icon={Plus} disabled={!draft.path.trim()} loading={actionLoading === createKey}>
                Add source
              </Button>
            </Actions>
          </Stack>
        </form>
      )}

      {browsing && (
        <FolderBrowserModal
          initialPath={draft.path}
          onClose={() => setBrowsing(false)}
          onSelect={(selectedPath) => {
            setDraft((current) => ({ ...current, path: selectedPath, kind: detectKind(selectedPath) }));
            setBrowsing(false);
          }}
        />
      )}
    </Stack>
  );
}
