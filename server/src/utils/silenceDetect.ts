import { spawn } from "child_process";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";

// Files with max_volume at or below this threshold (dB) are considered silent
export const SILENCE_THRESHOLD_DB = -70;

// Sample up to this many seconds of audio to keep checks fast
const SAMPLE_DURATION_SEC = 120;

export type SilenceCheckResult = {
  isSilent: boolean;
  maxVolumeDb: number | null;
  error?: string;
};

export async function checkAudioSilence(
  filePath: string,
  signal?: AbortSignal,
): Promise<SilenceCheckResult> {
  return new Promise((resolve) => {
    if (signal?.aborted) {
      resolve({ isSilent: false, maxVolumeDb: null, error: "cancelled" });
      return;
    }

    let stderr = "";

    const nullSink = process.platform === "win32" ? "NUL" : "/dev/null";

    const proc = spawn(ffmpegInstaller.path, [
      "-hide_banner",
      "-t", String(SAMPLE_DURATION_SEC),
      "-i", filePath,
      "-af", "volumedetect",
      "-vn",
      "-f", "null",
      nullSink,
    ]);

    const onAbort = () => {
      try { proc.kill("SIGKILL"); } catch { /* ignore */ }
    };

    signal?.addEventListener("abort", onAbort);

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });

    proc.on("close", () => {
      signal?.removeEventListener("abort", onAbort);

      if (signal?.aborted) {
        resolve({ isSilent: false, maxVolumeDb: null, error: "cancelled" });
        return;
      }

      const maxMatch = stderr.match(/max_volume:\s*([-\d.]+)\s*dB/);

      if (!maxMatch) {
        // No audio stream or unparseable output — treat as silent
        resolve({ isSilent: true, maxVolumeDb: null });
        return;
      }

      const maxVolume = parseFloat(maxMatch[1]);
      resolve({
        isSilent: maxVolume <= SILENCE_THRESHOLD_DB,
        maxVolumeDb: maxVolume,
      });
    });

    proc.on("error", (err) => {
      signal?.removeEventListener("abort", onAbort);
      resolve({ isSilent: false, maxVolumeDb: null, error: err.message });
    });
  });
}
