import { useEffect, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  BookOpen,
  List,
  Moon,
  Pause,
  Play,
  Redo2,
  SkipBack,
  SkipForward,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP_OPTIONS = [15, 30, 45, 60];

const fmt = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h > 0 ? `${h}:` : ""}${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const fmtSleep = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
};

export default function PlayerTray() {
  const {
    currentBook,
    currentFileIndex,
    isPlaying,
    currentTime,
    duration,
    volume,
    playbackRate,
    sleepRemaining,
    togglePlay,
    seek,
    skipForward,
    skipBackward,
    nextTrack,
    prevTrack,
    setVolume,
    setPlaybackRate,
    startSleepTimer,
    stopPlayer,
  } = usePlayer();

  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;

  const [showSpeed, setShowSpeed] = useState(false);
  const [showSleep, setShowSleep] = useState(false);
  const [showChapters, setShowChapters] = useState(false);

  const speedRef = useRef<HTMLDivElement>(null);
  const sleepRef = useRef<HTMLDivElement>(null);
  const chapterRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (event: MouseEvent) => {
      const target = event.target as Node;
      if (speedRef.current && !speedRef.current.contains(target)) setShowSpeed(false);
      if (sleepRef.current && !sleepRef.current.contains(target)) setShowSleep(false);
      if (chapterRef.current && !chapterRef.current.contains(target)) setShowChapters(false);
    };

    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const tag = (event.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (event.code === "Escape") {
        setShowSpeed(false);
        setShowSleep(false);
        setShowChapters(false);
        return;
      }
      if (!currentBook) return;
      if (event.code === "Space") {
        event.preventDefault();
        togglePlay();
      } else if (event.code === "ArrowLeft") {
        event.preventDefault();
        skipBackward(15);
      } else if (event.code === "ArrowRight") {
        event.preventDefault();
        skipForward(30);
      }
    };

    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [currentBook, skipBackward, skipForward, togglePlay]);

  if (!currentBook) return null;

  const currentTrack = currentBook.audioFiles[currentFileIndex];
  const currentChapter = currentBook.chapters?.find(
    (chapter) => currentTime >= chapter.start && currentTime < chapter.end,
  );
  const trackLabel = currentChapter?.title || currentTrack?.title || `Track ${currentFileIndex + 1}`;
  const remaining = Math.max(0, duration - currentTime);
  const playIcon = isPlaying
    ? <Pause size={20} fill="currentColor" />
    : <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />;

  const closeMenus = () => {
    setShowSpeed(false);
    setShowSleep(false);
    setShowChapters(false);
  };

  const seekFill = duration > 0 ? `${(currentTime / duration) * 100}%` : "0%";
  const volFill = `${Math.round(volume * 100)}%`;

  return (
    <div className={`player-tray${isPlaying ? " is-playing" : ""}`}>
      {/* Full-width seek bar at the top */}
      <div className="tray-progress">
        <span className="tray-time">{fmt(currentTime)}</span>
        <input
          type="range"
          className="tray-seek"
          min={0}
          max={duration || 100}
          value={currentTime}
          onChange={(event) => seek(parseFloat(event.target.value))}
          style={{ "--fill": seekFill } as React.CSSProperties}
          aria-label="Seek"
        />
        <span className="tray-time tray-time-right">-{fmt(remaining)}</span>
      </div>

      <div className="tray-static">
        <button
          className="tray-cover-lg"
          onClick={() => navigate(`/book/${currentBook.id}`, { state: { from: returnTo } })}
          aria-label={`View ${currentBook.title}`}
        >
          {currentBook.coverPath ? (
            <img src={currentBook.coverPath} alt={currentBook.title} />
          ) : (
            <div className="tray-cover-placeholder">
              <BookOpen size={26} />
            </div>
          )}
        </button>

        <div className="tray-static-info">
          <div className="tray-full-title">{currentBook.title}</div>
          <div className="tray-full-author">{currentBook.author.name}</div>
          <div className="tray-full-track">
            {trackLabel} · {currentFileIndex + 1}/{currentBook.audioFiles.length}
          </div>
        </div>

        <div className="tray-controls">
          <button className="tray-btn" onClick={() => skipBackward(15)} title="Back 15 seconds">
            <Undo2 size={15} />
            <span>15</span>
          </button>
          <button className="tray-btn" onClick={prevTrack} aria-label="Previous track">
            <SkipBack size={17} />
          </button>
          <button className="tray-play-btn" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
            {playIcon}
          </button>
          <button className="tray-btn" onClick={nextTrack} aria-label="Next track">
            <SkipForward size={17} />
          </button>
          <button className="tray-btn" onClick={() => skipForward(30)} title="Forward 30 seconds">
            <Redo2 size={15} />
            <span>30</span>
          </button>
        </div>

        <div className="tray-secondary">
          {currentBook.chapters && currentBook.chapters.length > 0 && (
            <div className="tray-popup-wrap" ref={chapterRef}>
              <button
                className={`tray-btn${showChapters ? " active" : ""}`}
                onClick={() => {
                  setShowChapters((value) => !value);
                  setShowSpeed(false);
                  setShowSleep(false);
                }}
                title="Chapters"
              >
                <List size={15} />
              </button>
              {showChapters && (
                <div className="tray-popup">
                  <div className="tray-popup-header">Chapters</div>
                  <div className="tray-popup-scroll">
                    {currentBook.chapters.map((chapter) => (
                      <button
                        key={chapter.id}
                        className={`tray-popup-option${chapter.id === currentChapter?.id ? " active" : ""}`}
                        onClick={() => {
                          seek(chapter.start);
                          closeMenus();
                        }}
                      >
                        <span>{chapter.title}</span>
                        <span className="tray-chap-time">{fmt(chapter.start)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          <div className="tray-popup-wrap" ref={speedRef}>
            <button
              className={`tray-speed-btn${playbackRate !== 1 ? " active" : ""}`}
              onClick={() => {
                setShowSpeed((value) => !value);
                setShowSleep(false);
                setShowChapters(false);
              }}
              title="Playback speed"
            >
              {playbackRate === 1 ? "1x" : `${playbackRate}x`}
            </button>
            {showSpeed && (
              <div className="tray-popup">
                <div className="tray-popup-header">Speed</div>
                {SPEEDS.map((speed) => (
                  <button
                    key={speed}
                    className={`tray-popup-option${speed === playbackRate ? " active" : ""}`}
                    onClick={() => {
                      setPlaybackRate(speed);
                      setShowSpeed(false);
                    }}
                  >
                    {speed === 1 ? "Normal (1x)" : `${speed}x`}
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="tray-popup-wrap" ref={sleepRef}>
            <button
              className={`tray-btn${sleepRemaining !== null ? " active" : ""}`}
              onClick={() => {
                setShowSleep((value) => !value);
                setShowSpeed(false);
                setShowChapters(false);
              }}
              title={sleepRemaining !== null ? `Sleep in ${fmtSleep(sleepRemaining)}` : "Sleep timer"}
            >
              <Moon size={15} />
              {sleepRemaining !== null && (
                <span className="tray-sleep-badge">{fmtSleep(sleepRemaining)}</span>
              )}
            </button>
            {showSleep && (
              <div className="tray-popup">
                <div className="tray-popup-header">Sleep Timer</div>
                {SLEEP_OPTIONS.map((minutes) => (
                  <button
                    key={minutes}
                    className="tray-popup-option"
                    onClick={() => {
                      startSleepTimer(minutes);
                      setShowSleep(false);
                    }}
                  >
                    {minutes} min
                  </button>
                ))}
                {sleepRemaining !== null && (
                  <button
                    className="tray-popup-option tray-popup-cancel"
                    onClick={() => {
                      startSleepTimer(null);
                      setShowSleep(false);
                    }}
                  >
                    Cancel timer
                  </button>
                )}
              </div>
            )}
          </div>

          <div className="tray-volume">
            <button
              className="tray-btn"
              onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
              aria-label={volume === 0 ? "Unmute" : "Mute"}
            >
              {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              min={0}
              max={1}
              step={0.02}
              value={volume}
              onChange={(event) => setVolume(parseFloat(event.target.value))}
              className="tray-volume-slider"
              style={{ "--vol": volFill } as React.CSSProperties}
              aria-label="Volume"
            />
          </div>

          <button className="tray-stop-btn" onClick={stopPlayer} aria-label="Stop and close player">
            <X size={14} />
          </button>
        </div>
      </div>
    </div>
  );
}
