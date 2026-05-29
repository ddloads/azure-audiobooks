import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Search, User, X } from 'lucide-react';
import api from '../api/axios';

interface Author {
  id: string;
  name: string;
  bookCount: number;
  reviewCount: number;
  coverPath: string | null;
}

const MobileAuthors = () => {
  const navigate = useNavigate();
  const [authors, setAuthors] = useState<Author[]>([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');

  useEffect(() => {
    api.get<Author[]>('/authors')
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
    <div className="mobile-authors">
      <div className="mobile-authors-search">
        <Search size={15} className="mobile-library-search-icon" />
        <input
          className="mobile-library-search-input"
          type="search"
          placeholder="Filter authors…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        {search && (
          <button
            className="mobile-library-search-clear"
            onClick={() => setSearch('')}
            aria-label="Clear"
          >
            <X size={15} />
          </button>
        )}
      </div>

      {!loading && (
        <div className="mobile-authors-count">
          {search ? `${filtered.length} of ${authors.length}` : authors.length.toLocaleString()} authors
        </div>
      )}

      {loading ? (
        <div className="mobile-authors-grid">
          {Array.from({ length: 16 }).map((_, i) => (
            <div key={i} className="mobile-author-card-skeleton">
              <div className="mobile-author-avatar-skeleton" />
              <div className="mobile-skeleton-line" style={{ width: '70%', margin: '6px auto 3px' }} />
              <div className="mobile-skeleton-line" style={{ width: '40%', margin: '0 auto' }} />
            </div>
          ))}
        </div>
      ) : filtered.length === 0 ? (
        <div className="mobile-empty">
          <User size={40} className="mobile-empty-icon" />
          <h3>{search ? 'No results' : 'No authors found'}</h3>
        </div>
      ) : (
        <div className="mobile-authors-grid">
          {filtered.map((author) => (
            <button
              key={author.id}
              className="mobile-author-card"
              onClick={() =>
                navigate(`/library?authorId=${author.id}&authorName=${encodeURIComponent(author.name)}`)
              }
            >
              <div className="mobile-author-avatar">
                {author.coverPath ? (
                  <img src={author.coverPath} alt={author.name} loading="lazy" />
                ) : (
                  <div className="mobile-author-avatar-placeholder">
                    <User size={22} />
                  </div>
                )}
              </div>
              <div className="mobile-author-name">{author.name}</div>
              <div className="mobile-author-count">
                {author.bookCount} {author.bookCount === 1 ? 'book' : 'books'}
              </div>
              {author.reviewCount > 0 && (
                <div className="mobile-author-review">{author.reviewCount} under review</div>
              )}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default MobileAuthors;
