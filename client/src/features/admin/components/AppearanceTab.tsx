import { useState, useEffect } from "react";
import { Eye, LayoutList } from "lucide-react";
import api from "../../../api/axios";
import { useToast } from "../../../context/ToastContext";
import type { AppearanceSettings } from "../types";
import { getErrorMessage } from "../helpers";
import { Panel, Stack, ToggleRow } from "../ui";

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
      <div className="as-loading">
        <div className="app-loading-spinner" />
      </div>
    );
  }

  return (
    <Stack>
      <Panel
        title="Catalog visibility"
        icon={Eye}
        description="Choose whether titles tagged for review appear in the main library views."
      >
        <ToggleRow
          title="Books marked for review"
          description={
            settings.showReviewBooks
              ? "Visible in the library, mobile library, and filter results."
              : "Hidden from the library, mobile library, and filter results."
          }
          checked={settings.showReviewBooks}
          disabled={actionLoading === "showReviewBooks"}
          onChange={() => void handleToggle("showReviewBooks")}
        />
      </Panel>

      <Panel
        title="Home shelves"
        icon={LayoutList}
        description="Choose which recommendation shelves appear on the home page."
      >
        {SHELF_CONFIG.map(({ key, label, description }) => (
          <ToggleRow
            key={key}
            title={label}
            description={description}
            checked={settings[key] as boolean}
            disabled={actionLoading === key}
            onChange={() => void handleToggle(key)}
          />
        ))}
      </Panel>

      <p className="as-subtle" style={{ margin: 0, fontSize: "0.8rem" }}>
        Changes save as soon as you flip a switch.
      </p>
    </Stack>
  );
}
