import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { BookOpen, CheckCircle2, Play } from "lucide-react";
import api from "../api/axios";
import { usePlayer } from "../context/PlayerContext";

interface FinishedRecord {
  bookId: string;
  lastUpdate: string;
  book: {
    id: string;
    title: string;
    duration: number;
    coverPath?: string | null;
    author: { name: string };
    series?: { id: string; title: string } | null;
    seriesOrder?: number | null;
  };
}

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });

export default function HistoryPage() {
  const navigate = useNavigate();
  const { playBook } = usePlayer();
  const [records, setRecords] = useState<FinishedRecord[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    api
      .get<FinishedRecord[]>("/progress/finished")
      .then((res) => setRecords(res.data))
      .catch(console.error)
      .finally(() => setLoading(false));
  }, []);

  const handlePlay = async (record: FinishedRecord) => {
    try {
      const bookRes = await api.get(`/library/${record.bookId}`);
      playBook(bookRes.data, 0);
    } catch (err) {
      console.error(err);
    }
  };

  return (
    <div className="history-page">
      <div className="history-header">
        <h1 className="history-title">Listening History</h1>
        <p className="history-subtitle">
          {loading ? "" : `${records.length} finished book${records.length !== 1 ? "s" : ""}`}
        </p>
      </div>

      {loading ? (
        <div className="history-loading">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="history-item-skeleton">
              <div className="history-item-cover-skeleton skeleton-pulse" />
              <div className="history-item-info-skeleton">
                <div className="skeleton-line skeleton-pulse" style={{ width: "60%", height: 14 }} />
                <div className="skeleton-line skeleton-pulse" style={{ width: "40%", height: 11, marginTop: 6 }} />
                <div className="skeleton-line skeleton-pulse" style={{ width: "30%", height: 10, marginTop: 8 }} />
              </div>
            </div>
          ))}
        </div>
      ) : records.length === 0 ? (
        <div className="history-empty">
          <div className="history-empty-icon">
            <CheckCircle2 size={44} />
          </div>
          <h2 className="history-empty-title">No finished books yet</h2>
          <p className="history-empty-sub">
            Books you finish will appear here.
          </p>
          <button className="btn btn-primary" onClick={() => navigate("/library")}>
            <BookOpen size={15} />
            Browse Library
          </button>
        </div>
      ) : (
        <div className="history-list">
          {records.map((record) => (
            <div
              key={record.bookId}
              className="history-item"
              onClick={() => navigate(`/book/${record.bookId}`)}
            >
              <div className="history-item-cover">
                {record.book.coverPath ? (
                  <img src={record.book.coverPath} alt={record.book.title} />
                ) : (
                  <div className="history-item-cover-placeholder">
                    <BookOpen size={20} />
                  </div>
                )}
              </div>
              <div className="history-item-info">
                <p className="history-item-title">{record.book.title}</p>
                <p className="history-item-author">{record.book.author.name}</p>
                {record.book.series && (
                  <p className="history-item-series">
                    {record.book.series.title}
                    {record.book.seriesOrder != null ? ` · Book ${record.book.seriesOrder}` : ""}
                  </p>
                )}
                <p className="history-item-date">Finished {fmtDate(record.lastUpdate)}</p>
              </div>
              <button
                className="history-item-play"
                onClick={(e) => {
                  e.stopPropagation();
                  void handlePlay(record);
                }}
                title="Play again from beginning"
              >
                <Play size={16} fill="currentColor" />
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
