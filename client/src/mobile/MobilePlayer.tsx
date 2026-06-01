import { useState } from 'react';
import {
  BookmarkPlus,
  BookOpen,
  ChevronDown,
  List,
  Moon,
  Pause,
  Play,
  Redo2,
  SkipBack,
  SkipForward,
  Trash2,
  Undo2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import api from '../api/axios';
import { usePlayer } from '../context/PlayerContext';

interface Props {
  onClose: () => void;
}

interface Bookmark {
  id: string;
  position: number;
  label?: string | null;
  createdAt: string;
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

  const [showSleepMenu, setShowSleepMenu] = useState(false);
  const [activePanel, setActivePanel] = useState<null | 'chapters' | 'bookmarks' | 'speed' | 'volume'>(null);
  const [bookmarks, setBookmarks] = useState<Bookmark[]>([]);
  const [bookmarkLoading, setBookmarkLoading] = useState(false);

  if (!currentBook) return null;

  const currentTrack = currentBook.audioFiles[currentFileIndex];
  const currentChapter = currentBook.chapters?.find(
    (chapter) => currentTime >= chapter.start && currentTime < chapter.end,
  );
  const trackLabel = currentChapter?.title || currentTrack?.title || `Track ${currentFileIndex + 1}`;

  const closePanels = () => {
    setActivePanel(null);
    setShowSleepMenu(false);
  };

  const handleSleepToggle = () => {
    setActivePanel(null);
    if (sleepRemaining !== null) {
      startSleepTimer(null);
    } else {
      setShowSleepMenu((value) => !value);
    }
  };

  const openBookmarks = async () => {
    setShowSleepMenu(false);
    if (activePanel === 'bookmarks') {
      setActivePanel(null);
      return;
    }
    setActivePanel('bookmarks');
    setBookmarkLoading(true);
    try {
      const res = await api.get<Bookmark[]>(`/bookmarks/${currentBook.id}`);
      setBookmarks(res.data);
    } catch {
      setBookmarks([]);
    } finally {
      setBookmarkLoading(false);
    }
  };

  const addBookmark = async () => {
    try {
      const res = await api.post<Bookmark>('/bookmarks', {
        bookId: currentBook.id,
        position: currentTime,
      });
      setBookmarks((prev) => [...prev, res.data].sort((a, b) => a.position - b.position));
    } catch {
      // Bookmark creation is non-fatal to playback.
    }
  };

  const deleteBookmark = async (id: string) => {
    try {
      await api.delete(`/bookmarks/${id}`);
      setBookmarks((prev) => prev.filter((bookmark) => bookmark.id !== id));
    } catch {
      // Bookmark deletion is non-fatal to playback.
    }
  };

  const handleStop = () => {
    stopPlayer();
    onClose();
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
        <div className="mobile-player-track-label">{trackLabel}</div>
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
          <SkipBack size={30} />
        </button>
        <button className="mobile-player-ctrl-btn" onClick={() => skipBackward(15)} aria-label="Skip back 15s">
          <Undo2 size={26} />
          <span className="mobile-player-ctrl-label">15</span>
        </button>
        <button className="mobile-player-play-btn" onClick={togglePlay} aria-label={isPlaying ? 'Pause' : 'Play'}>
          {isPlaying
            ? <Pause size={28} fill="#042233" color="#042233" />
            : <Play size={28} fill="#042233" color="#042233" style={{ marginLeft: 3 }} />
          }
        </button>
        <button className="mobile-player-ctrl-btn" onClick={() => skipForward(30)} aria-label="Skip forward 30s">
          <Redo2 size={26} />
          <span className="mobile-player-ctrl-label">30</span>
        </button>
        <button className="mobile-player-ctrl-btn" onClick={nextTrack} aria-label="Next track">
          <SkipForward size={30} />
        </button>
      </div>

      <div className="mobile-player-extras">
        {currentBook.chapters && currentBook.chapters.length > 0 && (
          <button
            className={`mobile-player-extra-btn ${activePanel === 'chapters' ? 'active' : ''}`}
            onClick={() => {
              setShowSleepMenu(false);
              setActivePanel(activePanel === 'chapters' ? null : 'chapters');
            }}
            aria-label="Chapters"
          >
            <List size={20} />
            <span>Chapters</span>
          </button>
        )}

        <button
          className={`mobile-player-extra-btn ${activePanel === 'bookmarks' ? 'active' : ''}`}
          onClick={() => void openBookmarks()}
          aria-label="Bookmarks"
        >
          <BookmarkPlus size={20} />
          <span>Bookmarks</span>
        </button>

        <button
          className={`mobile-player-extra-btn ${activePanel === 'speed' || playbackRate !== 1 ? 'active' : ''}`}
          onClick={() => {
            setShowSleepMenu(false);
            setActivePanel(activePanel === 'speed' ? null : 'speed');
          }}
          aria-label="Playback speed"
        >
          <span className="mobile-player-speed-label">{playbackRate}x</span>
          <span>Speed</span>
        </button>

        <div className="mobile-player-extra-wrap">
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
              {SLEEP_OPTIONS.map((min) => (
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

        <button
          className={`mobile-player-extra-btn ${activePanel === 'volume' || volume === 0 ? 'active' : ''}`}
          onClick={() => {
            setShowSleepMenu(false);
            setActivePanel(activePanel === 'volume' ? null : 'volume');
          }}
          aria-label="Volume"
        >
          {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
          <span>{volume === 0 ? 'Muted' : 'Volume'}</span>
        </button>

        <button className="mobile-player-extra-btn danger" onClick={handleStop} aria-label="Stop and close player">
          <X size={20} />
          <span>Stop</span>
        </button>
      </div>

      {activePanel && (
        <div className="mobile-player-panel" role="dialog" aria-label={`${activePanel} controls`}>
          <div className="mobile-player-panel-header">
            <span>
              {activePanel === 'chapters' && 'Chapters'}
              {activePanel === 'bookmarks' && 'Bookmarks'}
              {activePanel === 'speed' && 'Playback Speed'}
              {activePanel === 'volume' && 'Volume'}
            </span>
            <button className="mobile-player-panel-close" onClick={closePanels} aria-label="Close panel">
              <X size={18} />
            </button>
          </div>

          {activePanel === 'chapters' && (
            <div className="mobile-player-panel-list">
              {currentBook.chapters.map((chapter) => (
                <button
                  key={chapter.id}
                  className={`mobile-player-panel-row${chapter.id === currentChapter?.id ? ' active' : ''}`}
                  onClick={() => {
                    seek(chapter.start);
                    closePanels();
                  }}
                >
                  <span>{chapter.title}</span>
                  <span>{formatTime(chapter.start)}</span>
                </button>
              ))}
            </div>
          )}

          {activePanel === 'bookmarks' && (
            <>
              <div className="mobile-player-panel-list">
                {bookmarkLoading ? (
                  <div className="mobile-player-panel-empty">Loading...</div>
                ) : bookmarks.length === 0 ? (
                  <div className="mobile-player-panel-empty">No bookmarks yet</div>
                ) : (
                  bookmarks.map((bookmark) => (
                    <div key={bookmark.id} className="mobile-player-bookmark-row">
                      <button
                        className="mobile-player-bookmark-seek"
                        onClick={() => {
                          seek(bookmark.position);
                          closePanels();
                        }}
                      >
                        <span>{bookmark.label ?? 'Bookmark'}</span>
                        <span>{formatTime(bookmark.position)}</span>
                      </button>
                      <button
                        className="mobile-player-bookmark-delete"
                        onClick={() => void deleteBookmark(bookmark.id)}
                        aria-label="Delete bookmark"
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  ))
                )}
              </div>
              <button className="mobile-player-panel-action" onClick={() => void addBookmark()}>
                <BookmarkPlus size={16} />
                Add at {formatTime(currentTime)}
              </button>
            </>
          )}

          {activePanel === 'speed' && (
            <div className="mobile-player-speed-grid">
              {SPEEDS.map((speed) => (
                <button
                  key={speed}
                  className={`mobile-player-speed-option${speed === playbackRate ? ' active' : ''}`}
                  onClick={() => {
                    setPlaybackRate(speed);
                    closePanels();
                  }}
                >
                  {speed === 1 ? '1x' : `${speed}x`}
                </button>
              ))}
            </div>
          )}

          {activePanel === 'volume' && (
            <div className="mobile-player-volume-panel">
              <button
                className="mobile-player-volume-toggle"
                onClick={() => setVolume(volume === 0 ? 0.7 : 0)}
              >
                {volume === 0 ? <VolumeX size={20} /> : <Volume2 size={20} />}
                {volume === 0 ? 'Unmute' : 'Mute'}
              </button>
              <input
                type="range"
                min={0}
                max={1}
                step={0.02}
                value={volume}
                onChange={(event) => setVolume(Number(event.target.value))}
                className="mobile-player-volume-slider"
                aria-label="Volume"
              />
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default MobilePlayer;
