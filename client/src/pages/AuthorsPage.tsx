import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Search, User, X } from "lucide-react";
import api from "../api/axios";
import { coverUrl } from "../utils/covers";

interface Author {
  id: string;
  name: string;
  bookCount: number;
  reviewCount: number;
  coverPath: string | null;
}

export default function AuthorsPage() {
  const navigate = useNavigate();
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState("");

  useEffect(() => {
    api.get<Author[]>("/authors")
      .then((res) => setAuthors(res.data))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const filtered = search.trim()
    ? authors.filter((a) =>
        a.name.toLowerCase().includes(search.trim().toLowerCase()),
      )
    : authors;

  return (
    <div className="authors-page">
      <div className="authors-page-header">
        <div className="authors-page-title-row">
          <h1 className="authors-page-title">Authors</h1>
          {!loading && (
            <span className="authors-page-count">{authors.length.toLocaleString()}</span>
          )}
        </div>
        <div className="authors-search-wrap">
          <Search size={15} className="authors-search-icon" />
          <input
            className="authors-search-input"
            type="search"
            placeholder="Filter authors…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
          />
          {search && (
            <button className="authors-search-clear" onClick={() => setSearch("")} aria-label="Clear">
              <X size={14} />
            </button>
          )}
        </div>
      </div>

      {loading ? (
        <div className="authors-grid">
          {Array.from({ length: 24 }).map((_, i) => (
            <div key={i} className="author-card-skeleton">
              <div className="author-avatar-skeleton" />
              <div className="skeleton author-name-skeleton" />
              <div className="skeleton author-count-skeleton" />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="authors-empty">
          <User size={40} className="authors-empty-icon" />
          <p>{search ? "No authors match your search." : "No authors found."}</p>
        </div>
      ) : (
        <div className="authors-grid">
          {filtered.map((author) => (
            <button
              key={author.id}
              className="author-card"
              onClick={() =>
                navigate(`/library?authorId=${author.id}&authorName=${encodeURIComponent(author.name)}`)
              }
            >
              <div className="author-avatar">
                {author.coverPath ? (
                  <img src={coverUrl(author.coverPath, 180)} alt={author.name} loading="lazy" decoding="async" />
                ) : (
                  <div className="author-avatar-placeholder">
                    <User size={28} />
                  </div>
                )}
              </div>
              <div className="author-card-name">{author.name}</div>
              <div className="author-card-count">
                {author.bookCount} {author.bookCount === 1 ? "book" : "books"}
              </div>
              {author.reviewCount > 0 && (
                <div className="author-card-review">
                  {author.reviewCount} under review
                </div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
