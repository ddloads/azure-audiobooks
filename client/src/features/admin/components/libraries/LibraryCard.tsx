import { useState } from "react";
import {
  CheckCircle2,
  Database,
  FolderTree,
  Pencil,
  RefreshCw,
  Save,
  ScanLine,
  Trash2,
  Volume2,
  X,
} from "lucide-react";
import type { AdminLibrary, AdminLibrarySource, StructureCheckResult } from "../../types";
import { Actions, Badge, Button, Field, FormGrid, List, ListItem, Notice, Panel, Stack, ToggleRow } from "../../ui";
import SourceList, { type SourceDraft, type SourceFlag } from "./SourceList";

export type LibraryDraft = { name: string; description: string; isActive: boolean; folderPattern: string };

const FOLDER_PATTERNS = [
  { value: "", label: "None — no structure check" },
  { value: "{author} - {title}", label: "{Author} - {Title}  (e.g. Douglas Adams - Hitchhiker's Guide)" },
  { value: "{title}", label: "{Title} only  (e.g. Hitchhiker's Guide)" },
  { value: "{author}/{title}", label: "{Author}/{Title}  (nested 2 levels)" },
  { value: "{author}/{series}/{title}", label: "{Author}/{Series}/{Title}  (nested 3 levels)" },
];

interface LibraryCardProps {
  library: AdminLibrary;
  actionLoading: string | null;
  structureResult: StructureCheckResult | null | undefined;
  structureLoading: boolean;
  onSave: (draft: LibraryDraft) => Promise<boolean>;
  onScan: () => void;
  onSilenceCheck: (recheckAll: boolean) => void;
  onCheckStructure: () => void;
  onPurge: () => void;
  onDelete: () => void;
  onToggleSource: (sourceId: string, field: SourceFlag, value: boolean) => void;
  onRemoveSource: (source: AdminLibrarySource) => void;
  onCreateSource: (draft: SourceDraft) => Promise<boolean>;
}

export default function LibraryCard({
  library,
  actionLoading,
  structureResult,
  structureLoading,
  onSave,
  onScan,
  onSilenceCheck,
  onCheckStructure,
  onPurge,
  onDelete,
  onToggleSource,
  onRemoveSource,
  onCreateSource,
}: LibraryCardProps) {
  const [draft, setDraft] = useState<LibraryDraft | null>(null);
  const editing = draft !== null;
  const id = library.id;
  const sourceCount = library.sources.length;

  const startEditing = () =>
    setDraft({
      name: library.name,
      description: library.description ?? "",
      isActive: library.isActive,
      folderPattern: library.folderPattern ?? "",
    });

  return (
    <Panel
      className="as-libraries-card"
      icon={FolderTree}
      title={
        <span className="as-libraries-title">
          {library.name}
          {library.isActive ? <Badge tone="success">Active</Badge> : <Badge tone="warning">Inactive</Badge>}
        </span>
      }
      description={
        <>
          {!editing && library.description && <span className="as-libraries-desc">{library.description}</span>}
          <span className="as-libraries-counts">
            <span>
              <strong>{library._count.books.toLocaleString()}</strong> {library._count.books === 1 ? "book" : "books"}
            </span>
            <span>
              <strong>{sourceCount}</strong> {sourceCount === 1 ? "source" : "sources"}
            </span>
            {library.folderPattern && <code className="as-libraries-code">{library.folderPattern}</code>}
          </span>
        </>
      }
      actions={
        <Button size="sm" variant={editing ? "ghost" : "secondary"} icon={editing ? X : Pencil} onClick={() => (editing ? setDraft(null) : startEditing())}>
          {editing ? "Cancel" : "Edit"}
        </Button>
      }
    >
      <Stack gap="md">
        {editing && draft && (
          <form
            className="as-libraries-inset as-libraries-form"
            onSubmit={(event) => {
              event.preventDefault();
              if (!draft.name.trim()) return;
              void onSave(draft).then((ok) => ok && setDraft(null));
            }}
          >
            <Stack gap="md">
              <FormGrid>
                <Field label="Name" htmlFor={`library-name-${id}`}>
                  <input
                    id={`library-name-${id}`}
                    className="form-control"
                    autoComplete="off"
                    value={draft.name}
                    onChange={(e) => setDraft({ ...draft, name: e.target.value })}
                  />
                </Field>
                <Field label="Description" htmlFor={`library-desc-${id}`}>
                  <input
                    id={`library-desc-${id}`}
                    className="form-control"
                    autoComplete="off"
                    placeholder="Optional"
                    value={draft.description}
                    onChange={(e) => setDraft({ ...draft, description: e.target.value })}
                  />
                </Field>
                <Field label="Folder structure model" htmlFor={`library-pattern-${id}`} hint="Expected naming pattern for book folders. Enables the structure check." wide>
                  <select
                    id={`library-pattern-${id}`}
                    className="form-control"
                    value={draft.folderPattern}
                    onChange={(e) => setDraft({ ...draft, folderPattern: e.target.value })}
                  >
                    {FOLDER_PATTERNS.map((p) => (
                      <option key={p.value} value={p.value}>
                        {p.label}
                      </option>
                    ))}
                  </select>
                </Field>
              </FormGrid>
              <ToggleRow
                title="Active"
                description="Inactive libraries are hidden from listeners."
                checked={draft.isActive}
                onChange={(next) => setDraft({ ...draft, isActive: next })}
              />
              <Actions>
                <Button variant="ghost" icon={X} onClick={() => setDraft(null)}>
                  Cancel
                </Button>
                <Button
                  type="submit"
                  variant="primary"
                  icon={Save}
                  disabled={!draft.name.trim()}
                  loading={actionLoading === `update-library-${id}`}
                >
                  Save changes
                </Button>
              </Actions>

              <div className="as-libraries-danger">
                <div>
                  <p className="as-libraries-danger-title">Danger zone</p>
                  <p className="as-field-hint">Purging keeps the library and its sources so you can rescan from scratch.</p>
                </div>
                <Actions align="start">
                  <Button variant="danger" icon={Database} loading={actionLoading === `purge-library-${id}`} onClick={onPurge}>
                    Purge database
                  </Button>
                  <Button variant="danger" icon={Trash2} loading={actionLoading === `delete-library-${id}`} onClick={onDelete}>
                    Delete library
                  </Button>
                </Actions>
              </div>
            </Stack>
          </form>
        )}

        <div className="as-libraries-grid as-libraries-grid-compact">
          <Button size="sm" icon={RefreshCw} loading={actionLoading === `rescan-library-${id}`} onClick={onScan}>
            Scan library
          </Button>
          <Button
            size="sm"
            icon={Volume2}
            loading={actionLoading === `silence-check-${id}`}
            onClick={() => onSilenceCheck(false)}
            title="Probe unchecked and previously-silent files to detect silent or broken tracks"
          >
            Check new/silent
          </Button>
          <Button
            size="sm"
            icon={Volume2}
            loading={actionLoading === `silence-check-all-${id}`}
            onClick={() => onSilenceCheck(true)}
            title="Re-probe every audio file in this library"
          >
            Check all audio
          </Button>
          {library.folderPattern && (
            <Button size="sm" icon={ScanLine} loading={structureLoading} onClick={onCheckStructure}>
              Check structure
            </Button>
          )}
        </div>

        {structureResult && (
          <Stack gap="sm">
            {structureResult.nonConforming.length === 0 ? (
              <Notice tone="success" icon={CheckCircle2}>
                All {structureResult.total} folders match <code className="as-libraries-code">{structureResult.pattern}</code>
              </Notice>
            ) : (
              <Notice tone="warning" icon={ScanLine}>
                {structureResult.conforming} of {structureResult.total} conform ·{" "}
                <strong>{structureResult.nonConforming.length} don&apos;t match</strong>{" "}
                <code className="as-libraries-code">{structureResult.pattern}</code>
              </Notice>
            )}
            {structureResult.nonConforming.length > 0 && (
              <div className="as-libraries-scroll">
                <List>
                  {structureResult.nonConforming.map((item) => (
                    <ListItem
                      key={item.id}
                      title={item.title}
                      subtitle={item.author}
                      meta={<span className="as-libraries-path">{item.folderPath}</span>}
                    />
                  ))}
                </List>
              </div>
            )}
          </Stack>
        )}

        <SourceList
          libraryId={id}
          sources={library.sources}
          actionLoading={actionLoading}
          onToggle={onToggleSource}
          onRemove={onRemoveSource}
          onCreate={onCreateSource}
        />
      </Stack>
    </Panel>
  );
}
