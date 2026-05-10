import { useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { BookOpen, Mic, Search, User, X } from "lucide-react";
import api from "../api/axios";

interface SuggestionBook {
  id: string;
  title: string;
  coverPath?: string | null;
  author: { name: string };
}

interface SuggestionPerson {
  id: string;
  name: string;
  _count: { books: number };
}

interface Suggestions {
  books: SuggestionBook[];
  authors: SuggestionPerson[];
  series: SuggestionPerson[];
  narrators: string[];
}

type FlatItem =
  | { kind: "book"; id: string; title: string; coverPath?: string | null; authorName: string }
  | { kind: "author"; id: string; name: string; count: number }
  | { kind: "series"; id: string; name: string; count: number }
  | { kind: "narrator"; name: string };

const SearchBox = ({
  value,
  onChange,
}: {
  value: string;
  onChange: (v: string) => void;
}) => {
  const navigate = useNavigate();
  const location = useLocation();
  const [suggestions, setSuggestions] = useState<Suggestions | null>(null);
  const [open, setOpen] = useState(false);
  const [activeIdx, setActiveIdx] = useState(-1);
  const containerRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const returnTo = `${location.pathname}${location.search}`;

  // "/" shortcut to focus search
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const tag = (e.target as HTMLElement).tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (e.key === "/") {
        e.preventDefault();
        inputRef.current?.focus();
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  // Close dropdown on outside click
  useEffect(() => {
    const onDown = (e: MouseEvent) => {
      if (!containerRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    return () => document.removeEventListener("mousedown", onDown);
  }, []);

  // Fetch suggestions with a short debounce
  useEffect(() => {
    const q = value.trim();
    if (!q) {
      setSuggestions(null);
      setOpen(false);
      return;
    }
    const t = setTimeout(async () => {
      try {
        const res = await api.get<Suggestions>("/library/search/suggestions", { params: { q } });
        setSuggestions(res.data);
        setOpen(true);
        setActiveIdx(-1);
      } catch {
        // silent
      }
    }, 150);
    return () => clearTimeout(t);
  }, [value]);

  const flat = useMemo<FlatItem[]>(() => {
    if (!suggestions) return [];
    return [
      ...suggestions.books.map((b) => ({
        kind: "book" as const,
        id: b.id,
        title: b.title,
        coverPath: b.coverPath,
        authorName: b.author.name,
      })),
      ...suggestions.authors.map((a) => ({
        kind: "author" as const,
        id: a.id,
        name: a.name,
        count: a._count.books,
      })),
      ...suggestions.series.map((s) => ({
        kind: "series" as const,
        id: s.id,
        name: s.name,
        count: s._count.books,
      })),
      ...suggestions.narrators.map((n) => ({ kind: "narrator" as const, name: n })),
    ];
  }, [suggestions]);

  const select = (item: FlatItem) => {
    setOpen(false);
    onChange("");
    switch (item.kind) {
      case "book":
        navigate(`/book/${item.id}`, { state: { from: returnTo } });
        break;
      case "author":
        navigate(`/?authorId=${item.id}&authorName=${encodeURIComponent(item.name)}`);
        break;
      case "series":
        navigate(`/?seriesId=${item.id}&seriesName=${encodeURIComponent(item.name)}`);
        break;
      case "narrator":
        navigate(`/?narrator=${encodeURIComponent(item.name)}`);
        break;
    }
  };

  const flatIdxOf = (kind: string, idOrName: string) =>
    flat.findIndex((item) =>
      item.kind === kind &&
      ("id" in item ? item.id === idOrName : item.name === idOrName),
    );

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (!open || flat.length === 0) return;
    if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIdx((i) => Math.min(i + 1, flat.length - 1));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIdx((i) => Math.max(i - 1, -1));
    } else if (e.key === "Escape") {
      setOpen(false);
      setActiveIdx(-1);
    } else if (e.key === "Enter") {
      if (activeIdx >= 0) {
        e.preventDefault();
        select(flat[activeIdx]);
      } else {
        setOpen(false);
      }
    }
  };

  const clear = () => {
    onChange("");
    setSuggestions(null);
    setOpen(false);
    inputRef.current?.focus();
  };

  const hasAny = flat.length > 0;

  return (
    <div className="search-box" ref={containerRef}>
      <Search size={18} className="search-icon" />
      <input
        ref={inputRef}
        type="text"
        placeholder="Search your library…"
        className="form-control search-input"
        value={value}
        autoComplete="off"
        onChange={(e) => onChange(e.target.value)}
        onFocus={() => {
          if (value.trim() && hasAny) setOpen(true);
        }}
        onKeyDown={onKeyDown}
        aria-label="Search library"
        aria-autocomplete="list"
        aria-expanded={open && hasAny}
      />
      {value && (
        <button className="search-clear" onClick={clear} aria-label="Clear search">
          <X size={14} />
        </button>
      )}

      {open && hasAny && suggestions && (
        <div className="search-suggestions" role="listbox">
          {suggestions.books.length > 0 && (
            <div className="search-suggestion-section">
              <div className="search-suggestion-label">Books</div>
              {suggestions.books.map((book) => {
                const idx = flatIdxOf("book", book.id);
                return (
                  <button
                    key={book.id}
                    className={`search-suggestion-item${idx === activeIdx ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select({ kind: "book", id: book.id, title: book.title, coverPath: book.coverPath, authorName: book.author.name });
                    }}
                    onMouseEnter={() => setActiveIdx(idx)}
                    role="option"
                    aria-selected={idx === activeIdx}
                  >
                    <div className="search-suggestion-cover">
                      {book.coverPath ? (
                        <img src={book.coverPath} alt="" />
                      ) : (
                        <BookOpen size={13} />
                      )}
                    </div>
                    <div className="search-suggestion-copy">
                      <span className="search-suggestion-title">{book.title}</span>
                      <span className="search-suggestion-sub">{book.author.name}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {suggestions.authors.length > 0 && (
            <div className="search-suggestion-section">
              <div className="search-suggestion-label">Authors</div>
              {suggestions.authors.map((author) => {
                const idx = flatIdxOf("author", author.id);
                return (
                  <button
                    key={author.id}
                    className={`search-suggestion-item${idx === activeIdx ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select({ kind: "author", id: author.id, name: author.name, count: author._count.books });
                    }}
                    onMouseEnter={() => setActiveIdx(idx)}
                    role="option"
                    aria-selected={idx === activeIdx}
                  >
                    <div className="search-suggestion-icon">
                      <User size={13} />
                    </div>
                    <div className="search-suggestion-copy">
                      <span className="search-suggestion-title">{author.name}</span>
                      <span className="search-suggestion-sub">
                        {author._count.books} {author._count.books === 1 ? "book" : "books"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {suggestions.series.length > 0 && (
            <div className="search-suggestion-section">
              <div className="search-suggestion-label">Series</div>
              {suggestions.series.map((s) => {
                const idx = flatIdxOf("series", s.id);
                return (
                  <button
                    key={s.id}
                    className={`search-suggestion-item${idx === activeIdx ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select({ kind: "series", id: s.id, name: s.name, count: s._count.books });
                    }}
                    onMouseEnter={() => setActiveIdx(idx)}
                    role="option"
                    aria-selected={idx === activeIdx}
                  >
                    <div className="search-suggestion-icon">
                      <BookOpen size={13} />
                    </div>
                    <div className="search-suggestion-copy">
                      <span className="search-suggestion-title">{s.name}</span>
                      <span className="search-suggestion-sub">
                        {s._count.books} {s._count.books === 1 ? "book" : "books"}
                      </span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}

          {suggestions.narrators.length > 0 && (
            <div className="search-suggestion-section">
              <div className="search-suggestion-label">Narrators</div>
              {suggestions.narrators.map((narrator) => {
                const idx = flatIdxOf("narrator", narrator);
                return (
                  <button
                    key={narrator}
                    className={`search-suggestion-item${idx === activeIdx ? " active" : ""}`}
                    onMouseDown={(e) => {
                      e.preventDefault();
                      select({ kind: "narrator", name: narrator });
                    }}
                    onMouseEnter={() => setActiveIdx(idx)}
                    role="option"
                    aria-selected={idx === activeIdx}
                  >
                    <div className="search-suggestion-icon">
                      <Mic size={13} />
                    </div>
                    <div className="search-suggestion-copy">
                      <span className="search-suggestion-title">{narrator}</span>
                    </div>
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default SearchBox;
