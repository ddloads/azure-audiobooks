import { useEffect, useState } from "react";
import { SlidersHorizontal } from "lucide-react";
import api from "../../../../api/axios";
import { useToast } from "../../../../context/ToastContext";
import type { ScanSettings } from "../../types";
import { getErrorMessage } from "../../helpers";
import { Panel, ToggleRow } from "../../ui";

const SCAN_TOGGLES: Array<{ key: keyof ScanSettings; label: string; on: string; off: string }> = [
  {
    key: "fastStartEnabled",
    label: "Optimise files for streaming",
    on: "New .m4b and .m4a files are rewritten so seeking starts instantly. Slow on a network share: each file is read and written in full.",
    off: "Files are left as they are. Seeking in some .m4b and .m4a files may be slower when streaming.",
  },
  {
    key: "silenceChapters",
    label: "Find chapters from pauses",
    on: "Single-file books without embedded chapters are decoded to place chapters at pauses. Can take minutes per book during a scan.",
    off: "Those books get evenly spaced chapters instead. Auto-chapterize on a book still uses pauses.",
  },
];

/** Admin switches for the expensive per-file work a library scan does. */
export default function ScanSettingsPanel() {
  const { showToast } = useToast();
  const [settings, setSettings] = useState<ScanSettings | null>(null);
  const [saving, setSaving] = useState<keyof ScanSettings | null>(null);

  useEffect(() => {
    api
      .get<ScanSettings>("/admin/settings/scan")
      .then((response) => setSettings(response.data))
      .catch((error) =>
        showToast({
          title: "Failed to load scan settings",
          description: getErrorMessage(error, "Failed to load scan settings"),
          tone: "error",
        }),
      );
  }, []);

  const handleToggle = async (key: keyof ScanSettings) => {
    if (!settings) return;
    setSaving(key);
    try {
      const response = await api.patch<ScanSettings>("/admin/settings/scan", { [key]: !settings[key] });
      setSettings(response.data);
      showToast({ title: "Scan settings updated", tone: "success" });
    } catch (error) {
      showToast({
        title: "Failed to update scan settings",
        description: getErrorMessage(error, "Failed to update scan settings"),
        tone: "error",
      });
    } finally {
      setSaving(null);
    }
  };

  return (
    <Panel
      title="Scan processing"
      icon={SlidersHorizontal}
      description="Extra work done on new or changed books. Turn these off to speed up a large first import. Changes apply to running scans within a few seconds."
    >
      {SCAN_TOGGLES.map(({ key, label, on, off }) => (
        <ToggleRow
          key={key}
          title={label}
          description={settings?.[key] === false ? off : on}
          checked={settings?.[key] ?? false}
          disabled={!settings || saving === key}
          onChange={() => void handleToggle(key)}
        />
      ))}
    </Panel>
  );
}
