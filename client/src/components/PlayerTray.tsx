import { useEffect, useRef, useState } from "react";
import { useNavigate, useLocation } from "react-router-dom";
import {
  BookOpen, ChevronUp, ChevronDown,
  List, Moon, Pause, Play,
  Redo2, SkipBack, SkipForward,
  Undo2, Volume2, VolumeX, X,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP_OPTIONS = [15, 30, 45, 60];

const fmt = (s: number) => {
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  return `${h > 0 ? h + ":" : ""}${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
};

const fmtSleep = (s: number) => {
  const m = Math.floor(s / 60);
  const sec = s % 60;
  return m > 0 ? `${m}:${sec.toString().padStart(2, "0")}` : `${sec}s`;
};

export default function PlayerTray() {
  const {
    currentBook, currentFileIndex,
    isPlaying, currentTime, duration,
    volume, playbackRate, sleepRemaining,
    togglePlay, seek, skipForward, skipBackward,
    nextTrack, prevTrack,
    setVolume, setPlaybackRate,
    startSleepTimer, stopPlayer,
  } = usePlayer();

  const navigate = useNavigate();
  const location = useLocation();
  const returnTo = `${location.pathname}${location.search}`;

  const [expanded, setExpanded] = useState(false);
  const [showSpeed, setShowSpeed] = useState(false);
  const [showSleep, setShowSleep] = useState(false);
  const [showChapters, setShowChapters] = useState(false);

  const speedRef = useRef<HTMLDivElement>(null);
  const sleepRef = useRef<HTMLDivElement>(null);
  const chapRef  = useRef<HTMLDivElement>(null);

  // Close popups on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (speedRef.current && !speedRef.current.contains(e.target as Node)) setShowSpeed(false);
      if (sleepRef.current && !sleepRef.current.contains(e.target as Node)) setShowSleep(false);
      if (chapRef.current  && !chapRef.current.contains(e.target as Node))  setShowChapters(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.code === "Escape") { setShowSpeed(false); setShowSleep(false); setShowChapters(false); return; }
      if (!currentBook) return;
      if (e.code === "Space")      { e.preventDefault(); togglePlay(); }
      else if (e.code === "ArrowLeft")  { e.preventDefault(); skipBackward(15); }
      else if (e.code === "ArrowRight") { e.preventDefault(); skipForward(30); }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [currentBook, togglePlay, skipForward, skipBackward]);

  if (!currentBook) return null;

  const currentTrack = currentBook.audioFiles[currentFileIndex];
  const currentChapter = currentBook.chapters?.find(
    (c) => currentTime >= c.start && currentTime < c.end,
  );
  const trackLabel = currentChapter?.title || currentTrack?.title || `Track ${currentFileIndex + 1}`;
  const remaining  = Math.max(0, duration - currentTime);

  const closeAll = () => { setShowSpeed(false); setShowSleep(false); setShowChapters(false); };

  const PlayIcon = isPlaying
    ? <Pause size={20} fill="currentColor" />
    : <Play size={20} fill="currentColor" style={{ marginLeft: 2 }} />;

  return (
    <div className={`player-tray${expanded ? " tray-expanded" : ""}`}>
      {/* ── Drag handle ── */}
      <button
        className="tray-handle"
        onClick={() => setExpanded((v) => !v)}
        aria-label={expanded ? "Collapse player" : "Expand player"}
      >
        <div className="tray-handle-pip" />
      </button>

      {/* ── Mini row (always visible) ── */}
      <div className="tray-mini">
        <div
          className="tray-cover-sm"
          onClick={() => navigate(`/book/${currentBook.id}`, { state: { from: returnTo } })}
          role="button"
          tabIndex={0}
          aria-label={`View ${currentBook.title}`}
        >
          {currentBook.coverPath ? (
            <img src={currentBook.coverPath} alt={currentBook.title} />
          ) : (
            <div className="tray-cover-placeholder"><BookOpen size={20} /></div>
          )}
        </div>

        <div className="tray-mini-info" onClick={() => setExpanded((v) => !v)}>
          <div className="tray-mini-title">{currentBook.title}</div>
          <div className="tray-mini-author">{currentBook.author.name}</div>
        </div>

        <div className="tray-mini-controls">
          <button className="tray-btn" onClick={prevTrack} aria-label="Previous track">
            <SkipBack size={17} />
          </button>
          <button className="tray-play-btn" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
            {PlayIcon}
          </button>
          <button className="tray-btn" onClick={nextTrack} aria-label="Next track">
            <SkipForward size={17} />
          </button>
          <button className="tray-btn" onClick={() => setExpanded((v) => !v)} aria-label="Toggle player">
            {expanded ? <ChevronDown size={17} /> : <ChevronUp size={17} />}
          </button>
        </div>
      </div>

      {/* ── Expanded panel ── */}
      {expanded && (
        <div className="tray-full">
          {/* Top row: cover + info + close */}
          <div className="tray-full-top">
            <div
              className="tray-cover-lg"
              onClick={() => navigate(`/book/${currentBook.id}`, { state: { from: returnTo } })}
              role="button"
              tabIndex={0}
              aria-label={`View ${currentBook.title}`}
            >
              {currentBook.coverPath ? (
                <img src={currentBook.coverPath} alt={currentBook.title} />
              ) : (
                <div className="tray-cover-placeholder"><BookOpen size={26} /></div>
              )}
            </div>
            <div className="tray-full-info">
              <div className="tray-full-title">{currentBook.title}</div>
              <div className="tray-full-author">{currentBook.author.name}</div>
              <div className="tray-full-track">
                {trackLabel} · {currentFileIndex + 1}/{currentBook.audioFiles.length}
              </div>
            </div>
            <button className="tray-stop-btn" onClick={stopPlayer} aria-label="Stop and close player">
              <X size={14} />
            </button>
          </div>

          {/* Progress */}
          <div className="tray-progress">
            <span className="tray-time">{fmt(currentTime)}</span>
            <input
              type="range"
              className="tray-seek"
              min={0}
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seek(parseFloat(e.target.value))}
              aria-label="Seek"
            />
            <span className="tray-time tray-time-right">−{fmt(remaining)}</span>
          </div>

          {/* Main controls */}
          <div className="tray-controls">
            <button className="tray-btn" onClick={() => skipBackward(15)} title="Back 15s (←)">
              <Undo2 size={15} /><span>15</span>
            </button>
            <button className="tray-btn" onClick={prevTrack} aria-label="Previous track">
              <SkipBack size={17} />
            </button>
            <button className="tray-play-btn" onClick={togglePlay} aria-label={isPlaying ? "Pause" : "Play"}>
              {PlayIcon}
            </button>
            <button className="tray-btn" onClick={nextTrack} aria-label="Next track">
              <SkipForward size={17} />
            </button>
            <button className="tray-btn" onClick={() => skipForward(30)} title="Forward 30s (→)">
              <Redo2 size={15} /><span>30</span>
            </button>
          </div>

          {/* Secondary controls */}
          <div className="tray-secondary">
            {/* Chapters */}
            {currentBook.chapters && currentBook.chapters.length > 0 && (
              <div className="tray-popup-wrap" ref={chapRef}>
                <button
                  className={`tray-btn${showChapters ? " active" : ""}`}
                  onClick={() => { setShowChapters((v) => !v); setShowSpeed(false); setShowSleep(false); }}
                  title="Chapters"
                >
                  <List size={15} />
                </button>
                {showChapters && (
                  <div className="tray-popup">
                    <div className="tray-popup-header">Chapters</div>
                    <div className="tray-popup-scroll">
                      {currentBook.chapters.map((ch) => (
                        <button
                          key={ch.id}
                          className={`tray-popup-option${ch.id === currentChapter?.id ? " active" : ""}`}
                          onClick={() => { seek(ch.start); closeAll(); }}
                        >
                          <span>{ch.title}</span>
                          <span className="tray-chap-time">{fmt(ch.start)}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Speed */}
            <div className="tray-popup-wrap" ref={speedRef}>
              <button
                className={`tray-speed-btn${playbackRate !== 1 ? " active" : ""}`}
                onClick={() => { setShowSpeed((v) => !v); setShowSleep(false); setShowChapters(false); }}
                title="Playback speed"
              >
                {playbackRate === 1 ? "1×" : `${playbackRate}×`}
              </button>
              {showSpeed && (
                <div className="tray-popup">
                  <div className="tray-popup-header">Speed</div>
                  {SPEEDS.map((s) => (
                    <button
                      key={s}
                      className={`tray-popup-option${s === playbackRate ? " active" : ""}`}
                      onClick={() => { setPlaybackRate(s); setShowSpeed(false); }}
                    >
                      {s === 1 ? "Normal (1×)" : `${s}×`}
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Sleep */}
            <div className="tray-popup-wrap" ref={sleepRef}>
              <button
                className={`tray-btn${sleepRemaining !== null ? " active" : ""}`}
                onClick={() => { setShowSleep((v) => !v); setShowSpeed(false); setShowChapters(false); }}
                title={sleepRemaining !== null ? `Sleep in ${fmtSleep(sleepRemaining)}` : "Sleep timer"}
                style={{ position: "relative" }}
              >
                <Moon size={15} />
                {sleepRemaining !== null && (
                  <span className="tray-sleep-badge">{fmtSleep(sleepRemaining)}</span>
                )}
              </button>
              {showSleep && (
                <div className="tray-popup">
                  <div className="tray-popup-header">Sleep Timer</div>
                  {SLEEP_OPTIONS.map((m) => (
                    <button
                      key={m}
                      className="tray-popup-option"
                      onClick={() => { startSleepTimer(m); setShowSleep(false); }}
                    >
                      {m} min
                    </button>
                  ))}
                  {sleepRemaining !== null && (
                    <button
                      className="tray-popup-option tray-popup-cancel"
                      onClick={() => { startSleepTimer(null); setShowSleep(false); }}
                    >
                      Cancel timer
                    </button>
                  )}
                </div>
              )}
            </div>

            {/* Volume */}
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
                min={0} max={1} step={0.02}
                value={volume}
                onChange={(e) => setVolume(parseFloat(e.target.value))}
                className="tray-volume-slider"
                aria-label="Volume"
              />
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
