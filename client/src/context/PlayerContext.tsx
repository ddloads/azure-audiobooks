import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";
import api from "../api/axios";
import { getApiBaseUrl } from "../api/backend";

interface AudioFile {
  id: string;
  filename: string;
  title?: string | null;
  duration: number;
  index: number;
}

interface Chapter {
  id: string;
  title: string;
  start: number;
  end: number;
}

interface Book {
  id: string;
  title: string;
  author: { name: string };
  coverPath?: string;
  duration: number;
  audioFiles: AudioFile[];
  chapters: Chapter[];
}

interface PlayerContextType {
  currentBook: Book | null;
  currentFileIndex: number;
  isPlaying: boolean;
  currentTime: number;
  duration: number;
  volume: number;
  playbackRate: number;
  sleepRemaining: number | null;
  playBook: (book: Book, startTime?: number) => void;
  togglePlay: () => void;
  seek: (time: number) => void;
  skipForward: (seconds: number) => void;
  skipBackward: (seconds: number) => void;
  nextTrack: () => void;
  prevTrack: () => void;
  setVolume: (v: number) => void;
  setPlaybackRate: (rate: number) => void;
  startSleepTimer: (minutes: number | null) => void;
  stopPlayer: () => void;
}

const PlayerContext = createContext<PlayerContextType | undefined>(undefined);

const getElapsedBeforeIndex = (book: Book, index: number) => {
  let elapsed = 0;
  for (let i = 0; i < index; i++) {
    elapsed += book.audioFiles[i]?.duration ?? 0;
  }
  return elapsed;
};

export const PlayerProvider = ({ children }: { children: ReactNode }) => {
  const [currentBook, _setCurrentBook] = useState<Book | null>(null);
  const [currentFileIndex, _setCurrentFileIndex] = useState(0);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [volume, _setVolume] = useState(1);
  const [playbackRate, _setPlaybackRate] = useState(1);
  const [sleepRemaining, setSleepRemaining] = useState<number | null>(null);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sleepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bookRef = useRef<Book | null>(null);
  const fileIndexRef = useRef(0);
  const timeRef = useRef(0);
  const playbackRateRef = useRef(1);

  const setCurrentBook = (book: Book | null) => {
    bookRef.current = book;
    _setCurrentBook(book);
  };

  const setCurrentFileIndex = (idx: number) => {
    fileIndexRef.current = idx;
    _setCurrentFileIndex(idx);
  };

  const loadAudio = async (fileId: string, startTime = 0) => {
    const audio = audioRef.current;
    if (!audio) return;
    
    const url = `${getApiBaseUrl()}/stream/file/${fileId}`;
    
    // Check if the file is in our explicit audio-cache
    try {
      const cache = await caches.open("audio-cache");
      const match = await cache.match(url);
      if (match) {
        const blob = await match.blob();
        audio.src = URL.createObjectURL(blob);
      } else {
        audio.src = url;
      }
    } catch {
      audio.src = url;
    }

    audio.currentTime = startTime;
    audio.playbackRate = playbackRateRef.current;
    audio.play().catch(() => undefined);
  };

  const saveProgress = () => {
    const book = bookRef.current;
    if (!book) return;
    const total = getElapsedBeforeIndex(book, fileIndexRef.current) + timeRef.current;
    if (total > 0) {
      void api.post(`/progress/${book.id}`, { currentTime: total, isFinished: false });
    }
  };

  useEffect(() => {
    const audio = new Audio();
    audio.crossOrigin = "use-credentials";
    audioRef.current = audio;

    let lastUpdate = 0;
    audio.ontimeupdate = () => {
      const localTime = audio.currentTime;
      timeRef.current = localTime;

      const book = bookRef.current;
      const totalTime = book
        ? getElapsedBeforeIndex(book, fileIndexRef.current) + localTime
        : localTime;

      const now = Date.now();
      if (now - lastUpdate >= 250) {
        lastUpdate = now;
        setCurrentTime(totalTime);
      }
    };

    audio.onloadedmetadata = () => {
      const book = bookRef.current;
      setDuration(book?.duration || audio.duration || 0);
      audio.playbackRate = playbackRateRef.current;
    };
    audio.onplay = () => setIsPlaying(true);
    audio.onpause = () => setIsPlaying(false);
    audio.onended = () => {
      const book = bookRef.current;
      const idx = fileIndexRef.current;

      if (book && idx < book.audioFiles.length - 1) {
        const nextIdx = idx + 1;
        setCurrentFileIndex(nextIdx);
        setCurrentTime(getElapsedBeforeIndex(book, nextIdx));
        loadAudio(book.audioFiles[nextIdx].id);
        return;
      }

      if (book) {
        setCurrentTime(book.duration);
        void api.post(`/progress/${book.id}`, { currentTime: book.duration, isFinished: true });
      }

      setIsPlaying(false);
    };

    return () => {
      audio.pause();
      audio.src = "";
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      if (sleepIntervalRef.current) clearInterval(sleepIntervalRef.current);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!isPlaying || !currentBook) return;

    syncTimerRef.current = setInterval(() => {
      const book = bookRef.current;
      if (!book) return;
      const total = getElapsedBeforeIndex(book, fileIndexRef.current) + timeRef.current;
      void api.post(`/progress/${book.id}`, { currentTime: total, isFinished: false });
    }, 10000);

    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [isPlaying, currentBook]);

  const playBook = (book: Book, startTime = 0) => {
    setCurrentBook(book);
    setDuration(book.duration);
    setCurrentTime(startTime);

    let accumulated = 0;
    let fileIndex = 0;
    let fileStart = 0;

    for (let i = 0; i < book.audioFiles.length; i++) {
      const nextElapsed = accumulated + book.audioFiles[i].duration;
      if (nextElapsed > startTime || i === book.audioFiles.length - 1) {
        fileIndex = i;
        fileStart = Math.max(0, startTime - accumulated);
        break;
      }
      accumulated = nextElapsed;
    }

    timeRef.current = fileStart;
    setCurrentFileIndex(fileIndex);
    loadAudio(book.audioFiles[fileIndex].id, fileStart);
  };

  const togglePlay = () => {
    const audio = audioRef.current;
    if (!audio) return;

    if (audio.paused) {
      audio.play().catch(() => undefined);
    } else {
      audio.pause();
      saveProgress();
    }
  };

  const seek = (time: number) => {
    const audio = audioRef.current;
    const book = bookRef.current;
    if (!audio || !book) return;

    let accumulated = 0;
    let targetIndex = 0;
    let localTime = 0;

    for (let i = 0; i < book.audioFiles.length; i++) {
      const fileDuration = book.audioFiles[i].duration;
      if (accumulated + fileDuration > time || i === book.audioFiles.length - 1) {
        targetIndex = i;
        localTime = Math.max(0, time - accumulated);
        break;
      }
      accumulated += fileDuration;
    }

    setCurrentTime(time);
    timeRef.current = localTime;

    if (targetIndex === fileIndexRef.current) {
      audio.currentTime = localTime;
      return;
    }

    setCurrentFileIndex(targetIndex);
    loadAudio(book.audioFiles[targetIndex].id, localTime);
  };

  const skipForward = (seconds: number) => {
    const book = bookRef.current;
    if (!book) return;
    const total = getElapsedBeforeIndex(book, fileIndexRef.current) + timeRef.current;
    seek(Math.min(total + seconds, book.duration - 0.5));
  };

  const skipBackward = (seconds: number) => {
    const book = bookRef.current;
    if (!book) return;
    const total = getElapsedBeforeIndex(book, fileIndexRef.current) + timeRef.current;
    seek(Math.max(0, total - seconds));
  };

  const nextTrack = () => {
    const book = bookRef.current;
    const idx = fileIndexRef.current;
    if (book && idx < book.audioFiles.length - 1) {
      const nextIdx = idx + 1;
      setCurrentFileIndex(nextIdx);
      timeRef.current = 0;
      setCurrentTime(getElapsedBeforeIndex(book, nextIdx));
      loadAudio(book.audioFiles[nextIdx].id);
    }
  };

  const prevTrack = () => {
    const audio = audioRef.current;
    const book = bookRef.current;
    const idx = fileIndexRef.current;

    if (book && idx > 0) {
      const prevIdx = idx - 1;
      setCurrentFileIndex(prevIdx);
      timeRef.current = 0;
      setCurrentTime(getElapsedBeforeIndex(book, prevIdx));
      loadAudio(book.audioFiles[prevIdx].id);
      return;
    }

    if (audio) {
      audio.currentTime = 0;
      timeRef.current = 0;
      setCurrentTime(0);
    }
  };

  const setVolume = (value: number) => {
    _setVolume(Math.max(0, Math.min(1, value)));
  };

  const setPlaybackRate = (rate: number) => {
    playbackRateRef.current = rate;
    _setPlaybackRate(rate);
    if (audioRef.current) audioRef.current.playbackRate = rate;
  };

  const startSleepTimer = (minutes: number | null) => {
    if (sleepIntervalRef.current) {
      clearInterval(sleepIntervalRef.current);
      sleepIntervalRef.current = null;
    }
    if (minutes === null) {
      setSleepRemaining(null);
      return;
    }

    let remaining = minutes * 60;
    setSleepRemaining(remaining);

    sleepIntervalRef.current = setInterval(() => {
      remaining -= 1;
      if (remaining <= 0) {
        clearInterval(sleepIntervalRef.current!);
        sleepIntervalRef.current = null;
        setSleepRemaining(null);
        audioRef.current?.pause();
        saveProgress();
      } else {
        setSleepRemaining(remaining);
      }
    }, 1000);
  };

  const stopPlayer = () => {
    saveProgress();
    if (sleepIntervalRef.current) {
      clearInterval(sleepIntervalRef.current);
      sleepIntervalRef.current = null;
    }
    setSleepRemaining(null);
    const audio = audioRef.current;
    if (audio) {
      audio.pause();
      audio.src = "";
    }
    setCurrentBook(null);
    setIsPlaying(false);
    setCurrentTime(0);
    setDuration(0);
  };

  return (
    <PlayerContext.Provider
      value={{
        currentBook,
        currentFileIndex,
        isPlaying,
        currentTime,
        duration,
        volume,
        playbackRate,
        sleepRemaining,
        playBook,
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
      }}
    >
      {children}
    </PlayerContext.Provider>
  );
};

export const usePlayer = () => {
  const context = useContext(PlayerContext);
  if (context === undefined) {
    throw new Error("usePlayer must be used within a PlayerProvider");
  }
  return context;
};
