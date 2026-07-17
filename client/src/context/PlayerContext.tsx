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
  isPreviewMode: boolean;
  playBook: (book: Book, startTime?: number) => void;
  playPreviewBook: (book: Book, startTime?: number) => void;
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
  const [isPreviewMode, setIsPreviewMode] = useState(false);

  const audioRef = useRef<HTMLAudioElement | null>(null);
  const syncTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const sleepIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const bookRef = useRef<Book | null>(null);
  const fileIndexRef = useRef(0);
  const timeRef = useRef(0);
  const playbackRateRef = useRef(1);
  const previewModeRef = useRef(false);

  // Session tracking
  const sessionIdRef = useRef<string | null>(null);
  const sessionStartPositionRef = useRef(0);

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
    if (previewModeRef.current) return;
    const book = bookRef.current;
    if (!book) return;
    const total = getElapsedBeforeIndex(book, fileIndexRef.current) + timeRef.current;
    if (total > 0) {
      void api.post(`/progress/${book.id}`, { currentTime: total, isFinished: false });
    }
  };

  const openSession = async (book: Book) => {
    if (previewModeRef.current || sessionIdRef.current) return;
    try {
      const res = await api.post<{ id: string }>("/sessions", { bookId: book.id });
      sessionIdRef.current = res.data.id;
      sessionStartPositionRef.current =
        getElapsedBeforeIndex(book, fileIndexRef.current) + timeRef.current;
    } catch {
      // non-fatal
    }
  };

  const closeSession = (ended: boolean) => {
    const id = sessionIdRef.current;
    if (!id || previewModeRef.current) return;
    const book = bookRef.current;
    const currentPos = book
      ? getElapsedBeforeIndex(book, fileIndexRef.current) + timeRef.current
      : 0;
    const secondsListened = Math.max(0, Math.round(currentPos - sessionStartPositionRef.current));

    // Use fetch with keepalive so the request survives page close. The
    // HttpOnly auth cookie is sent with credentials and cannot be read here.
    void fetch(`${api.defaults.baseURL ?? ""}/sessions/${id}`, {
      method: "POST",
      keepalive: true,
      credentials: "include",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ secondsListened, ended }),
    });

    sessionIdRef.current = null;
    sessionStartPositionRef.current = 0;
  };

  const heartbeatSession = () => {
    const id = sessionIdRef.current;
    if (!id || previewModeRef.current) return;
    const book = bookRef.current;
    const currentPos = book
      ? getElapsedBeforeIndex(book, fileIndexRef.current) + timeRef.current
      : 0;
    const secondsListened = Math.max(0, Math.round(currentPos - sessionStartPositionRef.current));
    void api.patch(`/sessions/${id}`, { secondsListened, ended: false });
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
    audio.onplay = () => {
      setIsPlaying(true);
      const book = bookRef.current;
      if (book) void openSession(book);
    };
    audio.onpause = () => {
      setIsPlaying(false);
      closeSession(true);
    };
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
        if (!previewModeRef.current) {
          void api.post(`/progress/${book.id}`, { currentTime: book.duration, isFinished: true });
        }
      }

      setIsPlaying(false);
    };

    const handleUnload = () => closeSession(true);
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      audio.pause();
      audio.src = "";
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
      if (sleepIntervalRef.current) clearInterval(sleepIntervalRef.current);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, []);

  useEffect(() => {
    if (audioRef.current) audioRef.current.volume = volume;
  }, [volume]);

  useEffect(() => {
    if (!isPlaying || !currentBook) return;

    syncTimerRef.current = setInterval(() => {
      const book = bookRef.current;
      if (previewModeRef.current) return;
      if (!book) return;
      const total = getElapsedBeforeIndex(book, fileIndexRef.current) + timeRef.current;
      void api.post(`/progress/${book.id}`, { currentTime: total, isFinished: false });
      heartbeatSession();
    }, 10000);

    return () => {
      if (syncTimerRef.current) clearInterval(syncTimerRef.current);
    };
  }, [isPlaying, currentBook]);

  const playBookInternal = (book: Book, startTime = 0, preview = false) => {
    // Close any open session before switching books
    if (sessionIdRef.current) closeSession(true);
    previewModeRef.current = preview;
    setIsPreviewMode(preview);
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

  const playBook = (book: Book, startTime = 0) => {
    playBookInternal(book, startTime, false);
  };

  const playPreviewBook = (book: Book, startTime = 0) => {
    playBookInternal(book, startTime, true);
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
    previewModeRef.current = false;
    setIsPreviewMode(false);
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
        isPreviewMode,
        playBook,
        playPreviewBook,
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
