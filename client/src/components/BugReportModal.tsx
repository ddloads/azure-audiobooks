import { useState } from "react";
import { Bug, Loader2, X } from "lucide-react";
import { isAxiosError } from "axios";
import api from "../api/axios";
import { useToast } from "../context/ToastContext";

const issueTypes = [
  { value: "playback", label: "Playback issue" },
  { value: "library", label: "Library or scanning" },
  { value: "metadata", label: "Book metadata" },
  { value: "account", label: "Account or login" },
  { value: "performance", label: "Slow or unresponsive" },
  { value: "visual", label: "Visual problem" },
  { value: "other", label: "Something else" },
];

const getErrorMessage = (error: unknown, fallback: string) =>
  isAxiosError<{ error?: string }>(error) ? error.response?.data?.error || fallback : fallback;

interface BugReportModalProps {
  onClose: () => void;
}

const BugReportModal = ({ onClose }: BugReportModalProps) => {
  const { showToast } = useToast();
  const [type, setType] = useState(issueTypes[0].value);
  const [comment, setComment] = useState("");
  const [isSubmitting, setIsSubmitting] = useState(false);

  const handleSubmit = async () => {
    setIsSubmitting(true);
    try {
      await api.post("/reports", {
        type,
        comment,
        path: `${window.location.pathname}${window.location.search}`,
      });
      showToast({
        title: "Report submitted",
        description: "Thanks. An admin can review it from settings.",
        tone: "success",
      });
      onClose();
    } catch (error) {
      showToast({
        title: "Report failed",
        description: getErrorMessage(error, "Could not submit the report."),
        tone: "error",
      });
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <div className="modal-overlay" role="dialog" aria-modal="true" aria-labelledby="bug-report-title">
      <div className="modal-content bug-report-modal">
        <div className="modal-header">
          <div className="bug-report-title-wrap">
            <Bug size={18} />
            <h2 className="modal-title" id="bug-report-title">Report an issue</h2>
          </div>
          <button className="btn-close" type="button" onClick={onClose} aria-label="Close report form">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body bug-report-body">
          <label className="form-group">
            <span>Issue type</span>
            <div className="select-wrap">
              <select className="form-control" value={type} onChange={(event) => setType(event.target.value)}>
                {issueTypes.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </div>
          </label>

          <label className="form-group">
            <span>Comment</span>
            <textarea
              className="form-control bug-report-textarea"
              value={comment}
              onChange={(event) => setComment(event.target.value)}
              maxLength={2000}
              placeholder="Add details if you want."
            />
          </label>
        </div>

        <div className="modal-footer">
          <button className="btn btn-secondary" type="button" onClick={onClose} disabled={isSubmitting}>
            Cancel
          </button>
          <button className="btn btn-primary" type="button" onClick={() => void handleSubmit()} disabled={isSubmitting}>
            {isSubmitting ? <Loader2 size={15} className="animate-spin" /> : <Bug size={15} />}
            {isSubmitting ? "Submitting..." : "Submit report"}
          </button>
        </div>
      </div>
    </div>
  );
};

export default BugReportModal;
