import { useState } from 'react';
import { BookOpen, ChevronDown, ChevronLeft, ChevronRight, Moon, Pause, Play, RotateCcw, RotateCw } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';

interface Props {
  onClose: () => void;
}

const SPEEDS = [0.75, 1, 1.25, 1.5, 1.75, 2, 2.5, 3];
const SLEEP_OPTIONS = [15, 30, 45, 60];

const formatTime = (seconds: number) => {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  const s = Math.floor(seconds % 60);
  return `${h > 0 ? h + ':' : ''}${m.toString().padStart(2, '0')}:${s.toString().padStart(2, '0')}`;
};

const formatSleepRemaining = (seconds: number) => {
  const m = Math.floor(seconds / 60);
  const s = seconds % 60;
  return m > 0 ? `${m}:${s.toString().padStart(2, '0')}` : `${s}s`;
};

const MobilePlayer = ({ onClose }: Props) => {
  const {
    currentBook,
    isPlaying,
    currentTime,
    duration,
    playbackRate,
    sleepRemaining,
    togglePlay,
    seek,
    skipForward,
    skipBackward,
    nextTrack,
    prevTrack,
    setPlaybackRate,
    startSleepTimer,
  } = usePlayer();

  const [showSleepMenu, setShowSleepMenu] = useState(false);

  if (!currentBook) return null;

  const cycleSpeed = () => {
    const idx = SPEEDS.indexOf(playbackRate);
    setPlaybackRate(SPEEDS[(idx + 1) % SPEEDS.length]);
  };

  const handleSleepToggle = () => {
    if (sleepRemaining !== null) {
      startSleepTimer(null);
    } else {
      setShowSleepMenu(v => !v);
    }
  };

  return (
    <div className="mobile-full-player">
      <div className="mobile-player-handle">
        <div className="mobile-player-handle-bar" />
      </div>

      <div className="mobile-player-header">
        <button className="mobile-player-close-btn" onClick={onClose} aria-label="Close player">
          <ChevronDown size={26} />
        </button>
        <span className="mobile-player-header-label">Now Playing</span>
        <div style={{ width: 36 }} />
      </div>

      <div className="mobile-player-art-container">
        {currentBook.coverPath ? (
          <img src={currentBook.coverPath} alt={currentBook.title} className="mobile-player-art" />
        ) : (
          <div className="mobile-player-art-placeholder">
            <BookOpen size={64} color="var(--text-subtle)" />
          </div>
        )}
      </div>

      <div className="mobile-player-info">
        <div className="mobile-player-book-title">{currentBook.title}</div>
        <div className="mobile-player-book-author">{currentBook.author.name}</div>
      </div>

      <div className="mobile-player-progress-section">
        <input
          type="range"
          min={0}
          max={duration || 1}
          step={1}
          value={Math.min(currentTime, duration || 0)}
          onChange={(e) => seek(Number(e.target.value))}
          className="mobile-player-slider"
          style={{
            background: duration > 0
              ? `linear-gradient(to right, var(--primary) ${(currentTime / duration) * 100}%, var(--border-strong) ${(currentTime / duration) * 100}%)`
              : 'var(--border-strong)',
          }}
        />
        <div className="mobile-player-time-row">
          <span>{formatTime(currentTime)}</span>
          <span>{formatTime(duration)}</span>
        </div>
      </div>

      <div className="mobile-player-controls">
        <button className="mobile-player-ctrl-btn" onClick={prevTrack} aria-label="Previous track">
          <ChevronLeft size={30} />
        </button>
        <button className="mobile-player-ctrl-btn" onClick={() => skipBackward(30)} aria-label="Skip back 30s">
          <RotateCcw size={26} />
          <span className="mobile-player-ctrl-label">30</span>
        </button>
        <button className="mobile-player-play-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying
            ? <Pause size={28} fill="var(--bg)" color="var(--bg)" />
            : <Play size={28} fill="var(--bg)" color="var(--bg)" style={{ marginLeft: 3 }} />
          }
        </button>
        <button className="mobile-player-ctrl-btn" onClick={() => skipForward(30)} aria-label="Skip forward 30s">
          <RotateCw size={26} />
          <span className="mobile-player-ctrl-label">30</span>
        </button>
        <button className="mobile-player-ctrl-btn" onClick={nextTrack} aria-label="Next track">
          <ChevronRight size={30} />
        </button>
      </div>

      <div className="mobile-player-extras">
        <button className="mobile-player-extra-btn" onClick={cycleSpeed} aria-label="Change speed">
          <span className="mobile-player-speed-label">{playbackRate}×</span>
          <span>Speed</span>
        </button>

        <div style={{ position: 'relative' }}>
          <button
            className={`mobile-player-extra-btn ${sleepRemaining !== null ? 'active' : ''}`}
            onClick={handleSleepToggle}
            aria-label="Sleep timer"
          >
            <Moon size={20} />
            <span>{sleepRemaining !== null ? formatSleepRemaining(sleepRemaining) : 'Sleep'}</span>
          </button>
          {showSleepMenu && (
            <div className="mobile-player-sleep-menu">
              {SLEEP_OPTIONS.map(min => (
                <button
                  key={min}
                  className="mobile-player-sleep-option"
                  onClick={() => { startSleepTimer(min); setShowSleepMenu(false); }}
                >
                  {min} min
                </button>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default MobilePlayer;
