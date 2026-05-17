import { Check, Loader2, Search, X } from "lucide-react";
import { metadataProviderOptions } from "../metadata/providers";
import type { MetadataProvider } from "../metadata/types";
import {
  defaultQuickMatchFields,
  quickMatchFieldLabels,
  type QuickMatchBusyState,
  type QuickMatchFields,
  type QuickMatchMode,
  type QuickMatchResult,
} from "./types";

type QuickMatchModalProps = {
  selectedCount: number;
  eligibleCount: number;
  provider: MetadataProvider;
  minConfidence: string;
  fields: QuickMatchFields;
  result: QuickMatchResult | null;
  busy: QuickMatchBusyState;
  onClose: () => void;
  onProviderChange: (provider: MetadataProvider) => void;
  onMinConfidenceChange: (value: string) => void;
  onFieldsChange: (fields: QuickMatchFields | ((current: QuickMatchFields) => QuickMatchFields)) => void;
  onRun: (mode: QuickMatchMode) => void;
};

const QuickMatchModal = ({
  selectedCount,
  eligibleCount,
  provider,
  minConfidence,
  fields,
  result,
  busy,
  onClose,
  onProviderChange,
  onMinConfidenceChange,
  onFieldsChange,
  onRun,
}: QuickMatchModalProps) => {
  const isBusy = Boolean(busy);

  return (
    <div className="modal-backdrop" onClick={(event) => event.target === event.currentTarget && !isBusy && onClose()}>
      <div className="card modal-card quick-match-modal">
        <div className="modal-header">
          <div>
            <h2>Quick Match</h2>
            <p className="book-match-subtitle">
              Automatically match only selected titles that are currently unmatched.
            </p>
          </div>
          <button
            className="modal-close"
            onClick={onClose}
            aria-label="Close"
            disabled={isBusy}
          >
            <X size={20} />
          </button>
        </div>

        <div className="quick-match-summary-grid">
          <div>
            <strong>{selectedCount}</strong>
            <span>Selected</span>
          </div>
          <div>
            <strong>{eligibleCount}</strong>
            <span>Eligible</span>
          </div>
          <div>
            <strong>{selectedCount - eligibleCount}</strong>
            <span>Already matched</span>
          </div>
        </div>

        <div className="quick-match-options">
          <label className="form-group">
            <span>Provider</span>
            <select
              className="form-control"
              value={provider}
              onChange={(event) => onProviderChange(event.target.value as MetadataProvider)}
              disabled={isBusy}
            >
              {metadataProviderOptions.map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          </label>
          <label className="form-group">
            <span>Minimum confidence</span>
            <input
              className="form-control"
              type="number"
              min="0"
              max="1"
              step="0.01"
              value={minConfidence}
              onChange={(event) => onMinConfidenceChange(event.target.value)}
              disabled={isBusy}
            />
          </label>
        </div>

        <div className="quick-match-fields">
          <div className="quick-match-fields-head">
            <strong>Fields to update</strong>
            <button
              className="btn btn-secondary btn-sm"
              type="button"
              onClick={() => onFieldsChange(defaultQuickMatchFields())}
              disabled={isBusy}
            >
              Reset
            </button>
          </div>
          <div className="quick-match-field-grid">
            {quickMatchFieldLabels.map((field) => (
              <label key={field.key} className="admin-checkbox">
                <input
                  type="checkbox"
                  checked={fields[field.key]}
                  disabled={isBusy}
                  onChange={(event) =>
                    onFieldsChange((current) => ({
                      ...current,
                      [field.key]: event.target.checked,
                    }))
                  }
                />
                <span>{field.label}</span>
              </label>
            ))}
          </div>
        </div>

        {eligibleCount === 0 && (
          <div className="admin-empty-state">
            No selected titles are eligible. Quick Match only runs on titles without a matched state.
          </div>
        )}

        {result && (
          <div className="quick-match-results">
            <div className="quick-match-result-row success">
              <strong>{result.mode === "apply" ? result.applied.length : result.ready.length}</strong>
              <span>{result.mode === "apply" ? "Applied" : "Ready to apply"}</span>
            </div>
            <div className="quick-match-result-row">
              <strong>{result.skippedAlreadyMatched.length}</strong>
              <span>Skipped matched</span>
            </div>
            <div className="quick-match-result-row warning">
              <strong>{result.needsReview.length}</strong>
              <span>Needs review</span>
            </div>
            <div className="quick-match-result-row">
              <strong>{result.noResult.length}</strong>
              <span>No result</span>
            </div>
            <div className="quick-match-result-row danger">
              <strong>{result.failed.length}</strong>
              <span>Failed</span>
            </div>
          </div>
        )}

        {result && (
          <div className="quick-match-detail-list">
            {(result.mode === "apply" ? result.applied : result.ready).slice(0, 8).map((item) => (
              <div key={item.bookId} className="quick-match-detail-item">
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.candidateTitle || "Unknown title"}</span>
                </div>
                <em>{Math.round(item.confidence * 100)}%</em>
              </div>
            ))}
            {result.needsReview.slice(0, 5).map((item) => (
              <div key={item.bookId} className="quick-match-detail-item muted">
                <div>
                  <strong>{item.title}</strong>
                  <span>{item.reason}</span>
                </div>
              </div>
            ))}
          </div>
        )}

        <div className="book-match-actions">
          <button
            className="btn btn-secondary"
            type="button"
            onClick={onClose}
            disabled={isBusy}
          >
            Cancel
          </button>
          <button
            className="btn btn-secondary"
            type="button"
            onClick={() => onRun("preview")}
            disabled={isBusy || eligibleCount === 0}
          >
            {busy === "preview" ? <Loader2 size={15} className="animate-spin" /> : <Search size={15} />}
            Preview
          </button>
          <button
            className="btn btn-primary"
            type="button"
            onClick={() => onRun("apply")}
            disabled={isBusy || eligibleCount === 0}
          >
            {busy === "apply" ? <Loader2 size={15} className="animate-spin" /> : <Check size={15} />}
            Apply Safe Matches
          </button>
        </div>
      </div>
    </div>
  );
};

export default QuickMatchModal;
