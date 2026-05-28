import { useState, useEffect } from "react";
import { Eye, EyeOff, Loader2 } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import type { AppearanceSettings } from "../types";
import { getErrorMessage } from "../helpers";

const defaultSettings: AppearanceSettings = {
  showReviewBooks: true,
  shelfContinueListening: true,
  shelfNextInSeries: true,
  shelfYouMightLike: true,
  shelfRecentlyAdded: true,
};

const SHELF_CONFIG: Array<{
  key: keyof Omit<AppearanceSettings, "showReviewBooks">;
  label: string;
  description: string;
}> = [
  {
    key: "shelfContinueListening",
    label: "Continue Listening",
    description: "Books you have started but not yet finished.",
  },
  {
    key: "shelfNextInSeries",
    label: "Up Next in Series",
    description: "The next unread book in a series you have completed.",
  },
  {
    key: "shelfYouMightLike",
    label: "You Might Like",
    description: "Books matched to your listening history.",
  },
  {
    key: "shelfRecentlyAdded",
    label: "Recently Added",
    description: "New arrivals you haven't started yet.",
  },
];

export default function AppearanceTab() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<AppearanceSettings>(defaultSettings);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState<string | null>(null);

  const loadSettings = async () => {
    try {
      const response = await api.get<AppearanceSettings>("/settings/appearance");
      setSettings({ ...defaultSettings, ...response.data });
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
    void loadSettings();
  }, []);

  const handleToggle = async (key: keyof AppearanceSettings) => {
    setActionLoading(key);
    const next = !settings[key];
    try {
      const response = await api.patch<AppearanceSettings>("/admin/settings/appearance", {
        [key]: next,
      });
      setSettings({ ...defaultSettings, ...response.data });
      showToast({ title: "Appearance updated", tone: "success" });
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

      {/* Catalog visibility */}
      <div className="card admin-section-card">
        <div className="admin-section-head">
          <div>
            <h3>Catalog visibility</h3>
            <p className="admin-library-meta-text">
              Choose whether titles tagged for review appear in the main library views.
            </p>
          </div>
        </div>

        <button
          type="button"
          className={`admin-overview-toggle ${settings.showReviewBooks ? "is-enabled" : ""}`}
          onClick={() => void handleToggle("showReviewBooks")}
          disabled={actionLoading === "showReviewBooks"}
          aria-pressed={settings.showReviewBooks}
        >
          <div className="admin-overview-toggle-copy">
            <strong>Books marked for review</strong>
            <small>
              {settings.showReviewBooks
                ? "Visible in the library, mobile library, and filter results."
                : "Hidden from the library, mobile library, and filter results."}
            </small>
          </div>
          {actionLoading === "showReviewBooks" ? (
            <Loader2 size={16} className="animate-spin" />
          ) : settings.showReviewBooks ? (
            <Eye size={16} />
          ) : (
            <EyeOff size={16} />
          )}
        </button>
      </div>

      {/* Home shelves */}
      <div className="card admin-section-card">
        <div className="admin-section-head">
          <div>
            <h3>Home shelves</h3>
            <p className="admin-library-meta-text">
              Choose which recommendation shelves appear on the home page.
            </p>
          </div>
        </div>

        {SHELF_CONFIG.map(({ key, label, description }) => {
          const enabled = settings[key] as boolean;
          return (
            <button
              key={key}
              type="button"
              className={`admin-overview-toggle ${enabled ? "is-enabled" : ""}`}
              onClick={() => void handleToggle(key)}
              disabled={actionLoading === key}
              aria-pressed={enabled}
            >
              <div className="admin-overview-toggle-copy">
                <strong>{label}</strong>
                <small>{description}</small>
              </div>
              {actionLoading === key ? (
                <Loader2 size={16} className="animate-spin" />
              ) : enabled ? (
                <Eye size={16} />
              ) : (
                <EyeOff size={16} />
              )}
            </button>
          );
        })}
      </div>

    </div>
  );
}
