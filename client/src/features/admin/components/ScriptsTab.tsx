import { useState, useEffect } from "react";
import { Loader2, Play, RefreshCw } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import type { AdminScriptOption, AdminScriptResult } from "../types";
import { formatDate, getErrorMessage } from "../helpers";

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

  return (
    <div className="admin-panel-stack">
      <div className="card admin-section-card">
        <div className="admin-section-head">
          <div>
            <h3>Maintenance scripts</h3>
            <p className="admin-library-meta-text">
              Select an approved server-side script and run it from the admin console.
            </p>
          </div>
        </div>

        <div className="admin-toolbar">
          <select
            className="form-control"
            value={selectedScriptId}
            disabled={scriptsLoading || adminScripts.length === 0}
            onChange={(event) => {
              setSelectedScriptId(event.target.value);
              setScriptResult(null);
            }}
          >
            {adminScripts.length === 0 ? (
              <option value="">
                {scriptsLoading ? "Loading scripts..." : "No scripts available"}
              </option>
            ) : (
              adminScripts.map((script) => (
                <option key={script.id} value={script.id}>
                  {script.label}
                </option>
              ))
            )}
          </select>
          <button
            className="btn btn-primary"
            type="button"
            disabled={!selectedScriptId || scriptsLoading || actionLoading === "run-admin-script"}
            onClick={() => void handleRunAdminScript()}
          >
            {actionLoading === "run-admin-script" ? (
              <Loader2 size={15} className="animate-spin" />
            ) : (
              <Play size={15} />
            )}
            Run
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            disabled={scriptsLoading || actionLoading === "run-admin-script"}
            onClick={() => void loadAdminScripts()}
          >
            <RefreshCw size={15} className={scriptsLoading ? "animate-spin" : ""} />
            Refresh
          </button>
        </div>

        {scriptsError && (
          <div className="admin-empty-state">
            Unable to load scripts: {scriptsError}
          </div>
        )}

        {adminScripts.find((script) => script.id === selectedScriptId) && (
          <div className="admin-meta-list">
            <div>
              <span>Selected script</span>
              <strong>{adminScripts.find((script) => script.id === selectedScriptId)?.label}</strong>
            </div>
            <div>
              <span>Description</span>
              <small>{adminScripts.find((script) => script.id === selectedScriptId)?.description}</small>
            </div>
          </div>
        )}
      </div>

      {scriptResult && (
        <div className="card admin-section-card">
          <div className="admin-section-head">
            <div>
              <h3>Last run</h3>
              <p className="admin-library-meta-text">
                {scriptResult.script.label} finished with exit code {scriptResult.exitCode ?? "unknown"}.
              </p>
            </div>
            <div className={`admin-pill ${scriptResult.exitCode === 0 && !scriptResult.timedOut ? "" : "admin-inactive-badge"}`}>
              {scriptResult.timedOut ? "Timed out" : scriptResult.exitCode === 0 ? "Success" : "Failed"}
            </div>
          </div>

          <div className="admin-meta-list">
            <div>
              <span>Started</span>
              <small>{formatDate(scriptResult.startedAt)}</small>
            </div>
            <div>
              <span>Finished</span>
              <small>{formatDate(scriptResult.finishedAt)}</small>
            </div>
          </div>

          {scriptResult.stdout && (
            <div className="admin-log-details">
              <strong>Output</strong>
              <pre className="admin-log-block">{scriptResult.stdout}</pre>
            </div>
          )}

          {scriptResult.stderr && (
            <div className="admin-log-details">
              <strong>Errors</strong>
              <pre className="admin-log-block">{scriptResult.stderr}</pre>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
