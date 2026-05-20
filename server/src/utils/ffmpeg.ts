import path from "path";
import ffmpeg from "fluent-ffmpeg";
import ffmpegInstaller from "@ffmpeg-installer/ffmpeg";
import ffprobeInstaller from "@ffprobe-installer/ffprobe";

ffmpeg.setFfmpegPath(ffmpegInstaller.path);
ffmpeg.setFfprobePath(ffprobeInstaller.path);

export const tonePath = path.join(
  process.cwd(),
  "bin",
  process.platform === "win32" ? "tone.exe" : "tone",
);

export default ffmpeg;
