import { useState, useEffect, useRef } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import {
  Play, Pause, SkipForward, SkipBack,
  Volume2, VolumeX, X, Moon, Undo2, Redo2, List,
} from "lucide-react";
import { usePlayer } from "../context/PlayerContext";

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP_OPTIONS = [15, 30, 45, 60];

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h > 0 ? h + ":" : ""}${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
};

const formatSleepRemaining = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, "0")}` : `${s}s`;
};

const Player = () => {
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
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [showChapterMenu, setShowChapterMenu] = useState(false);
  const returnTo = `${location.pathname}${location.search}`;

  const speedMenuRef = useRef<HTMLDivElement>(null);
  const sleepMenuRef = useRef<HTMLDivElement>(null);
  const chapterMenuRef = useRef<HTMLDivElement>(null);

  // Close menus on outside click
  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (speedMenuRef.current && !speedMenuRef.current.contains(e.target as Node)) {
        setShowSpeedMenu(false);
      }
      if (sleepMenuRef.current && !sleepMenuRef.current.contains(e.target as Node)) {
        setShowSleepMenu(false);
      }
      if (chapterMenuRef.current && !chapterMenuRef.current.contains(e.target as Node)) {
        setShowChapterMenu(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  // Keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;

      if (e.code === "Escape") {
        setShowSpeedMenu(false);
        setShowSleepMenu(false);
        setShowChapterMenu(false);
        return;
      }

      if (!currentBook) return;

      if (e.code === "Space") {
        e.preventDefault();
        togglePlay();
      } else if (e.code === "ArrowLeft") {
        e.preventDefault();
        skipBackward(15);
      } else if (e.code === "ArrowRight") {
        e.preventDefault();
        skipForward(30);
      }
    };
    document.addEventListener("keydown", handler);
    return () => document.removeEventListener("keydown", handler);
  }, [currentBook, togglePlay, skipForward, skipBackward]);

  if (!currentBook) return null;

  const currentTrack = currentBook.audioFiles[currentFileIndex];
  const currentChapter = currentBook.chapters?.find(
    (c) => currentTime >= c.start && currentTime < c.end
  );
  const trackLabel = currentChapter?.title || currentTrack?.title || `Track ${currentFileIndex + 1}`;
  const remaining = Math.max(0, duration - currentTime);

  return (
    <>
      <div className="player-bar">
        <button onClick={stopPlayer} className="player-close-btn" aria-label="Close player">
          <X size={14} />
        </button>

        {/* Book info */}
        <div className="player-info">
          <button
            className="player-cover player-cover-btn"
            onClick={() => navigate(`/book/${currentBook.id}`, { state: { from: returnTo } })}
            aria-label={`View details for ${currentBook.title}`}
          >
            {currentBook.coverPath ? (
              <img src={currentBook.coverPath} alt={currentBook.title} />
            ) : (
              <div className="player-cover-placeholder">
                <img src="/azure-logo-192.png" alt="" className="player-cover-logo" />
              </div>
            )}
          </button>
          <div className="player-text">
            <div className="player-book-title">{currentBook.title}</div>
            <div className="player-book-author">{currentBook.author.name}</div>
            <div className="player-track-label">
              <span className="player-current-track-title" title={trackLabel}>{trackLabel}</span>
              <span className="player-track-count">
                {" · "}{currentFileIndex + 1}/{currentBook.audioFiles.length}
              </span>
            </div>
          </div>
        </div>

        {/* Playback controls */}
        <div className="player-controls">
          <div className="player-buttons">
            <button
              className="player-skip-btn player-step-btn"
              onClick={() => skipBackward(15)}
              title="Back 15 seconds (←)"
            >
              <Undo2 size={14} />
              <span>15</span>
            </button>

            <button className="player-skip-btn" onClick={prevTrack} aria-label="Previous track">
              <SkipBack size={16} />
            </button>

            <button
              className="player-play-btn"
              onClick={togglePlay}
              aria-label={isPlaying ? "Pause" : "Play"}
            >
              {isPlaying
                ? <Pause size={19} fill="currentColor" />
                : <Play size={19} fill="currentColor" style={{ marginLeft: "2px" }} />
              }
            </button>

            <button className="player-skip-btn" onClick={nextTrack} aria-label="Next track">
              <SkipForward size={16} />
            </button>

            <button
              className="player-skip-btn player-step-btn"
              onClick={() => skipForward(30)}
              title="Forward 30 seconds (→)"
            >
              <Redo2 size={14} />
              <span>30</span>
            </button>
          </div>

          <div className="player-progress">
            <span className="player-time">{formatTime(currentTime)}</span>
            <input
              type="range"
              min="0"
              max={duration || 100}
              value={currentTime}
              onChange={(e) => seek(parseFloat(e.target.value))}
              style={{ flex: 1 }}
              aria-label="Seek"
            />
            <span className="player-time player-time-right">−{formatTime(remaining)}</span>
          </div>
        </div>

        {/* Right controls: chapters · speed · sleep · volume */}
        <div className="player-right-controls">
          {/* Chapters */}
          {currentBook.chapters && currentBook.chapters.length > 0 && (
            <div className="player-menu-wrap" ref={chapterMenuRef}>
              <button
                className={`player-skip-btn${showChapterMenu ? " player-ctrl-active" : ""}`}
                onClick={() => {
                  setShowChapterMenu((v) => !v);
                  setShowSpeedMenu(false);
                  setShowSleepMenu(false);
                }}
                title="Chapters"
              >
                <List size={15} />
              </button>
              {showChapterMenu && (
                <div className="player-popup-menu player-chapters-menu">
                  <div className="player-menu-header">Chapters</div>
                  <div className="player-menu-scroll">
                    {currentBook.chapters.map((chap) => (
                      <button
                        key={chap.id}
                        className={`player-menu-option${chap.id === currentChapter?.id ? " active" : ""}`}
                        onClick={() => {
                          seek(chap.start);
                          setShowChapterMenu(false);
                        }}
                      >
                        <span className="player-menu-chap-title">{chap.title}</span>
                        <span className="player-menu-chap-time">{formatTime(chap.start)}</span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Playback speed */}
          <div className="player-menu-wrap" ref={speedMenuRef}>
            <button
              className={`player-speed-btn${playbackRate !== 1 ? " player-ctrl-active" : ""}`}
              onClick={() => { setShowSpeedMenu((v) => !v); setShowSleepMenu(false); }}
              title="Playback speed"
            >
              {playbackRate === 1 ? "1×" : `${playbackRate}×`}
            </button>
            {showSpeedMenu && (
              <div className="player-popup-menu">
                <div className="player-menu-header">Speed</div>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    className={`player-menu-option${s === playbackRate ? " active" : ""}`}
                    onClick={() => { setPlaybackRate(s); setShowSpeedMenu(false); }}
                  >
                    {s === 1 ? "Normal (1×)" : `${s}×`}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Sleep timer */}
          <div className="player-menu-wrap" ref={sleepMenuRef}>
            <button
              className={`player-skip-btn player-sleep-btn${sleepRemaining !== null ? " player-ctrl-active" : ""}`}
              onClick={() => { setShowSleepMenu((v) => !v); setShowSpeedMenu(false); }}
              title={sleepRemaining !== null ? `Sleep in ${formatSleepRemaining(sleepRemaining)}` : "Sleep timer"}
            >
              <Moon size={15} />
              {sleepRemaining !== null && (
                <span className="player-sleep-badge">{formatSleepRemaining(sleepRemaining)}</span>
              )}
            </button>
            {showSleepMenu && (
              <div className="player-popup-menu">
                <div className="player-menu-header">Sleep Timer</div>
                {SLEEP_OPTIONS.map((m) => (
                  <button
                    key={m}
                    className="player-menu-option"
                    onClick={() => { startSleepTimer(m); setShowSleepMenu(false); }}
                  >
                    {m} min
                  </button>
                ))}
                {sleepRemaining !== null && (
                  <button
                    className="player-menu-option player-menu-cancel"
                    onClick={() => { startSleepTimer(null); setShowSleepMenu(false); }}
                  >
                    Cancel timer
                  </button>
                )}
              </div>
            )}
          </div>

          {/* Volume */}
          <div className="player-volume">
            <button
              className="player-skip-btn"
              onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
              aria-label={volume === 0 ? "Unmute" : "Mute"}
            >
              {volume === 0 ? <VolumeX size={15} /> : <Volume2 size={15} />}
            </button>
            <input
              type="range"
              min="0"
              max="1"
              step="0.02"
              value={volume}
              onChange={(e) => setVolume(parseFloat(e.target.value))}
              className="player-volume-slider"
              aria-label="Volume"
            />
          </div>
        </div>
      </div>
    </>
  );
};

export default Player;
