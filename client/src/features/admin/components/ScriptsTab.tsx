import { useState, useEffect } from "react";
import { AlertTriangle, CheckCircle2, Circle, FileCode2, Play, RefreshCw, TerminalSquare } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import type { AdminScriptOption, AdminScriptResult } from "../types";
import { formatDate, getErrorMessage } from "../helpers";
import { Actions, Badge, Button, EmptyState, KeyValues, List, ListItem, Notice, Panel, Stack } from "../ui";
import "./ScriptsTab.css";

export default function ScriptsTab() {
  const { showToast } = useToast();
  const [adminScripts, setAdminScripts] = useState<AdminScriptOption[]>([]);
  const [selectedScriptId, setSelectedScriptId] = useState("");
  const [scriptsLoading, setScriptsLoading] = useState(false);
  const [scriptsError, setScriptsError] = useState<string | null>(null);
  const [scriptResult, setScriptResult] = useState<AdminScriptResult | null>(null);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadAdminScripts = async () => {
    setScriptsLoading(true);
    setScriptsError(null);
    try {
      const response = await api.get<AdminScriptOption[]>("/admin/scripts");
      setAdminScripts(response.data);
      if (response.data.length > 0 && !selectedScriptId) {
        setSelectedScriptId(response.data[0].id);
      }
    } catch (error) {
      setScriptsError(getErrorMessage(error, "Failed to load maintenance scripts"));
      showToast({
        title: "Failed to load scripts",
        description: getErrorMessage(error, "Failed to load maintenance scripts"),
        tone: "error",
      });
    } finally {
      setScriptsLoading(false);
    }
  };

  useEffect(() => {
    void loadAdminScripts();
  }, []);

  const handleRunAdminScript = async () => {
    if (!selectedScriptId) return;
    setActionLoading("run-admin-script");
    try {
      const response = await api.post<AdminScriptResult>("/admin/scripts/run", {
        scriptId: selectedScriptId,
      });
      setScriptResult(response.data);
      if (response.data.exitCode === 0 && !response.data.timedOut) {
        showToast({
          title: "Script completed successfully",
          tone: "success",
        });
      } else {
        showToast({
          title: "Script finished with errors",
          tone: "error",
        });
      }
    } catch (error) {
      showToast({
        title: "Failed to run script",
        description: getErrorMessage(error, "Failed to execute script"),
        tone: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  const selectedScript = adminScripts.find((script) => script.id === selectedScriptId);
  const running = actionLoading === "run-admin-script";
  const succeeded = scriptResult ? scriptResult.exitCode === 0 && !scriptResult.timedOut : false;
  const durationSeconds = scriptResult
    ? Math.max(0, (new Date(scriptResult.finishedAt).getTime() - new Date(scriptResult.startedAt).getTime()) / 1000)
    : 0;

  return (
    <Stack>
      <Panel
        title="Maintenance scripts"
        icon={FileCode2}
        description="Pick an approved server-side script and run it from the admin console."
        actions={
          <Button
            size="sm"
            icon={RefreshCw}
            loading={scriptsLoading}
            disabled={running}
            onClick={() => void loadAdminScripts()}
          >
            Refresh
          </Button>
        }
        flush
      >
        {scriptsError && (
          <div className="as-panel-body as-scripts-notice">
            <Notice tone="danger" icon={AlertTriangle}>
              Unable to load scripts: {scriptsError}
            </Notice>
          </div>
        )}

        {adminScripts.length === 0 ? (
          scriptsLoading ? (
            <div className="as-loading" aria-live="polite">
              <div className="app-loading-spinner" />
            </div>
          ) : (
            <EmptyState icon={FileCode2} title="No scripts available">
              The server has no approved maintenance scripts configured.
            </EmptyState>
          )
        ) : (
          <>
            <List className="as-scripts-list">
              {adminScripts.map((script) => {
                const selected = script.id === selectedScriptId;
                return (
                  <ListItem
                    key={script.id}
                    selected={selected}
                    onClick={() => {
                      if (running) return;
                      setSelectedScriptId(script.id);
                      setScriptResult(null);
                    }}
                    leading={
                      selected ? (
                        <CheckCircle2 size={20} className="as-scripts-radio as-scripts-radio-on" aria-hidden="true" />
                      ) : (
                        <Circle size={20} className="as-scripts-radio" aria-hidden="true" />
                      )
                    }
                    title={script.label}
                    subtitle={script.description}
                  />
                );
              })}
            </List>
            <div className="as-panel-body">
              <Actions>
                <Button
                  variant="primary"
                  icon={Play}
                  className="as-scripts-run"
                  loading={running}
                  disabled={!selectedScriptId || scriptsLoading}
                  onClick={() => void handleRunAdminScript()}
                >
                  {running ? "Running…" : selectedScript ? `Run ${selectedScript.label}` : "Run"}
                </Button>
              </Actions>
            </div>
          </>
        )}
      </Panel>

      {scriptResult && (
        <Panel
          title="Last run"
          icon={TerminalSquare}
          tone={succeeded ? undefined : "danger"}
          description={`${scriptResult.script.label} finished with exit code ${scriptResult.exitCode ?? "unknown"}.`}
          actions={
            <Badge tone={scriptResult.timedOut ? "warning" : succeeded ? "success" : "danger"}>
              {scriptResult.timedOut ? "Timed out" : scriptResult.exitCode === 0 ? "Success" : "Failed"}
            </Badge>
          }
        >
          <Stack gap="md">
            <KeyValues
              items={[
                { label: "Started", value: formatDate(scriptResult.startedAt) },
                { label: "Finished", value: formatDate(scriptResult.finishedAt) },
                { label: "Duration", value: `${durationSeconds < 10 ? durationSeconds.toFixed(1) : Math.round(durationSeconds)}s` },
                { label: "Exit code", value: scriptResult.exitCode ?? "unknown", mono: true },
              ]}
            />

            {scriptResult.stdout && (
              <div className="as-scripts-output">
                <span className="as-field-label">Output</span>
                <pre className="as-code">{scriptResult.stdout}</pre>
              </div>
            )}

            {scriptResult.stderr && (
              <div className="as-scripts-output">
                <span className="as-field-label">Errors</span>
                <pre className="as-code as-scripts-stderr">{scriptResult.stderr}</pre>
              </div>
            )}

            {!scriptResult.stdout && !scriptResult.stderr && (
              <p className="as-subtle as-scripts-nooutput">The script produced no output.</p>
            )}
          </Stack>
        </Panel>
      )}
    </Stack>
  );
}
