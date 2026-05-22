import { useState, useEffect } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import type { AppearanceSettings } from "../types";
import { getErrorMessage } from "../helpers";

export default function AppearanceTab() {
  const { showToast } = useToast();
  const [appearanceSettings, setAppearanceSettings] = useState<AppearanceSettings>({
    showReviewBooks: false,
  });
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadAppearanceSettings = async () => {
    try {
      const response = await api.get<AppearanceSettings>("/settings/appearance");
      setAppearanceSettings(response.data);
    } catch (error) {
      showToast({
        title: "Failed to load appearance",
        description: getErrorMessage(error, "Failed to load appearance settings"),
        tone: "error",
      });
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void loadAppearanceSettings();
  }, []);

  const handleToggleReviewBooks = async () => {
    setActionLoading("appearance-review-books");
    const nextShowReviewBooks = !appearanceSettings.showReviewBooks;
    try {
      const response = await api.patch<AppearanceSettings>("/admin/settings/appearance", {
        showReviewBooks: nextShowReviewBooks,
      });
      setAppearanceSettings(response.data);
      showToast({
        title: "Appearance updated",
        tone: "success",
      });
    } catch (error) {
      showToast({
        title: "Failed to update appearance",
        description: getErrorMessage(error, "Failed to update appearance settings"),
        tone: "error",
      });
    } finally {
      setActionLoading(null);
    }
  };

  if (loading) {
    return (
      <div className="admin-settings-loading">
        <div className="app-loading-spinner" />
      </div>
    );
  }

  return (
    <div className="admin-panel-stack">
      <div className="card admin-section-card">
        <div className="admin-section-head">
          <div>
            <h3>Catalog visibility</h3>
            <p className="admin-library-meta-text">
              Choose whether titles tagged review appear in the main library views.
            </p>
          </div>
        </div>

        <button
          type="button"
          className={`admin-overview-toggle ${appearanceSettings.showReviewBooks ? "is-enabled" : ""}`}
          onClick={() => void handleToggleReviewBooks()}
          disabled={actionLoading === "appearance-review-books"}
          aria-pressed={appearanceSettings.showReviewBooks}
        >
          <div className="admin-overview-toggle-copy">
            <strong>Books marked for review</strong>
            <small>
              {appearanceSettings.showReviewBooks
                ? "Visible in the library, mobile library, and filter results."
                : "Hidden from the library, mobile library, and filter results."}
            </small>
          </div>
          {actionLoading === "appearance-review-books" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : appearanceSettings.showReviewBooks ? (
            <Eye size={16} />
          ) : (
            <EyeOff size={16} />
          )}
        </button>
      </div>
    </div>
  );
}
