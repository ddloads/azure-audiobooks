import { BookOpen, Pause, Play, Redo2, Undo2 } from 'lucide-react';
import { usePlayer } from '../context/PlayerContext';
import { coverUrl } from '../utils/covers';

interface Props {
  onExpand: () => void;
}

const MobileMiniPlayer = ({ onExpand }: Props) => {
  const { currentBook, isPlaying, currentTime, duration, togglePlay, skipBackward, skipForward } = usePlayer();

  if (!currentBook) return null;

  const pct = duration > 0 ? (currentTime / duration) * 100 : 0;

  return (
    <div className="mobile-mini-player" onClick={onExpand}>
      {currentBook.coverPath ? (
        <img src={coverUrl(currentBook.coverPath, 120)} alt="" className="mobile-mini-player-art" decoding="async" />
      ) : (
        <div className="mobile-mini-player-art">
          <BookOpen size={20} color="var(--text-subtle)" />
        </div>
      )}

      <div className="mobile-mini-player-info">
        <div className="mobile-mini-player-title">{currentBook.title}</div>
        <div className="mobile-mini-player-author">{currentBook.author.name}</div>
      </div>

      <div className="mobile-mini-player-controls">
        <button
          className="mobile-mini-player-btn"
          onClick={(e) => { e.stopPropagation(); skipBackward(15); }}
          aria-label="Skip back 15s"
        >
          <Undo2 size={18} />
        </button>
        <button
          className="mobile-mini-player-btn"
          onClick={(e) => { e.stopPropagation(); togglePlay(); }}
          aria-label={isPlaying ? 'Pause' : 'Play'}
        >
          {isPlaying
            ? <Pause size={22} fill="currentColor" />
            : <Play size={22} fill="currentColor" style={{ marginLeft: 2 }} />
          }
        </button>
        <button
          className="mobile-mini-player-btn"
          onClick={(e) => { e.stopPropagation(); skipForward(30); }}
          aria-label="Skip forward 30s"
        >
          <Redo2 size={18} />
        </button>
      </div>

      <div className="mobile-mini-player-progress" style={{ width: `${pct}%` }} />
    </div>
  );
};

export default MobileMiniPlayer;
