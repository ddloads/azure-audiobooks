import { useState } from 'react';
import { X } from 'lucide-react';

export interface MobileFilterOptions {
  libraries: Array<{ id: string; name: string; _count: { books: number; sources: number } }>;
  authors: Array<{ id: string; name: string; _count?: { books: number } }>;
  series: Array<{ id: string; name: string; _count?: { books: number } }>;
  genres: string[];
  narrators: string[];
  years: string[];
}

export interface MobileFilters {
  libraryId: string;
  authorId: string;
  seriesId: string;
  genre: string;
  narrator: string;
  yearFrom: string;
  listeningStatus: string;
  matchStatus: string;
  cover: string;
  sortBy: string;
}

interface Props {
  filters: MobileFilters;
  filterOptions: MobileFilterOptions;
  onFilterChange: (key: keyof MobileFilters, value: string) => void;
  onClear: () => void;
  onClose: () => void;
  activeFilterCount: number;
}

const MobileFilterSheet = ({ filters, filterOptions, onFilterChange, onClear, onClose, activeFilterCount }: Props) => {
  const [activeTab, setActiveTab] = useState<'filters' | 'sort'>('filters');

  return (
    <>
      <div className="mobile-filter-backdrop" onClick={onClose} />
      <div className="mobile-filter-sheet">
        <div className="mobile-filter-sheet-handle">
          <div className="mobile-filter-sheet-handle-bar" />
        </div>
        <div className="mobile-filter-sheet-header">
          <span className="mobile-filter-sheet-title">Library Options</span>
          <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            {activeFilterCount > 0 && (
              <button className="mobile-filter-sheet-clear" onClick={onClear}>Clear all</button>
            )}
            <button className="mobile-filter-close-btn" onClick={onClose} aria-label="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="mobile-filter-tabs" role="tablist" aria-label="Filter and sort options">
          <button
            className={`mobile-filter-tab${activeTab === 'filters' ? ' active' : ''}`}
            onClick={() => setActiveTab('filters')}
            role="tab"
            aria-selected={activeTab === 'filters'}
          >
            Filters
          </button>
          <button
            className={`mobile-filter-tab${activeTab === 'sort' ? ' active' : ''}`}
            onClick={() => setActiveTab('sort')}
            role="tab"
            aria-selected={activeTab === 'sort'}
          >
            Sort
          </button>
        </div>

        <div className="mobile-filter-sheet-body">
          {activeTab === 'sort' ? (
            <div className="mobile-filter-group">
              <label className="mobile-filter-group-label">Sort by</label>
              <select
                className="mobile-filter-select"
                value={filters.sortBy}
                onChange={(e) => onFilterChange('sortBy', e.target.value)}
              >
                <option value="newest">Newest First</option>
                <option value="oldest">Oldest First</option>
                <option value="title_asc">Title (A-Z)</option>
                <option value="title_desc">Title (Z-A)</option>
                <option value="author_asc">Author (A-Z)</option>
                <option value="duration_desc">Longest First</option>
                <option value="duration_asc">Shortest First</option>
                <option value="year_desc">Year (Newest)</option>
              </select>
            </div>
          ) : (
            <>
              <div className="mobile-filter-group">
                <label className="mobile-filter-group-label">Listening Status</label>
                <select
                  className="mobile-filter-select"
                  value={filters.listeningStatus}
                  onChange={(e) => onFilterChange('listeningStatus', e.target.value)}
                >
                  <option value="all">Any status</option>
                  <option value="not_started">Not started</option>
                  <option value="in_progress">In progress</option>
                  <option value="finished">Finished</option>
                </select>
              </div>

              <div className="mobile-filter-group">
                <label className="mobile-filter-group-label">Match Status</label>
                <select
                  className="mobile-filter-select"
                  value={filters.matchStatus}
                  onChange={(e) => onFilterChange('matchStatus', e.target.value)}
                >
                  <option value="all">Any match status</option>
                  <option value="matched">Matched</option>
                  <option value="unmatched">Unmatched</option>
                  <option value="quick-matched">Quick matched</option>
                </select>
              </div>

              <div className="mobile-filter-group">
                <label className="mobile-filter-group-label">Cover Art</label>
                <select
                  className="mobile-filter-select"
                  value={filters.cover}
                  onChange={(e) => onFilterChange('cover', e.target.value)}
                >
                  <option value="all">Any cover status</option>
                  <option value="with">Has cover</option>
                  <option value="missing">Missing cover</option>
                </select>
              </div>

              {filterOptions.libraries.length > 1 && (
                <div className="mobile-filter-group">
                  <label className="mobile-filter-group-label">Library</label>
                  <select
                    className="mobile-filter-select"
                    value={filters.libraryId}
                    onChange={(e) => onFilterChange('libraryId', e.target.value)}
                  >
                    <option value="all">Any library</option>
                    {filterOptions.libraries.map(lib => (
                      <option key={lib.id} value={lib.id}>{lib.name} ({lib._count.books})</option>
                    ))}
                  </select>
                </div>
              )}

              {filterOptions.authors.length > 0 && (
                <div className="mobile-filter-group">
                  <label className="mobile-filter-group-label">Author</label>
                  <select
                    className="mobile-filter-select"
                    value={filters.authorId}
                    onChange={(e) => onFilterChange('authorId', e.target.value)}
                  >
                    <option value="all">Any author</option>
                    {filterOptions.authors.map(a => (
                      <option key={a.id} value={a.id}>{a.name}</option>
                    ))}
                  </select>
                </div>
              )}

              {filterOptions.series.length > 0 && (
                <div className="mobile-filter-group">
                  <label className="mobile-filter-group-label">Series</label>
                  <select
                    className="mobile-filter-select"
                    value={filters.seriesId}
                    onChange={(e) => onFilterChange('seriesId', e.target.value)}
                  >
                    <option value="all">Any series</option>
                    {filterOptions.series.map(series => (
                      <option key={series.id} value={series.id}>{series.name} ({series._count?.books ?? 0})</option>
                    ))}
                  </select>
                </div>
              )}

              {filterOptions.genres.length > 0 && (
                <div className="mobile-filter-group">
                  <label className="mobile-filter-group-label">Genre</label>
                  <select
                    className="mobile-filter-select"
                    value={filters.genre}
                    onChange={(e) => onFilterChange('genre', e.target.value)}
                  >
                    <option value="">Any genre</option>
                    {filterOptions.genres.map(g => (
                      <option key={g} value={g}>{g}</option>
                    ))}
                  </select>
                </div>
              )}

              {filterOptions.narrators.length > 0 && (
                <div className="mobile-filter-group">
                  <label className="mobile-filter-group-label">Narrator</label>
                  <select
                    className="mobile-filter-select"
                    value={filters.narrator}
                    onChange={(e) => onFilterChange('narrator', e.target.value)}
                  >
                    <option value="">Any narrator</option>
                    {filterOptions.narrators.map(n => (
                      <option key={n} value={n}>{n}</option>
                    ))}
                  </select>
                </div>
              )}

              {filterOptions.years.length > 0 && (
                <div className="mobile-filter-group">
                  <label className="mobile-filter-group-label">Published from year</label>
                  <select
                    className="mobile-filter-select"
                    value={filters.yearFrom}
                    onChange={(e) => onFilterChange('yearFrom', e.target.value)}
                  >
                    <option value="">Any year</option>
                    {[...filterOptions.years].reverse().map(y => (
                      <option key={y} value={y}>{y}</option>
                    ))}
                  </select>
                </div>
              )}
            </>
          )}
        </div>

        <div className="mobile-filter-sheet-footer">
          <button className="mobile-filter-apply-btn" onClick={onClose}>
            {activeFilterCount > 0
              ? `Show results - ${activeFilterCount} filter${activeFilterCount === 1 ? '' : 's'} active`
              : 'Done'
            }
          </button>
        </div>
      </div>
    </>
  );
};

export default MobileFilterSheet;
