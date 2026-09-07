export function SearchResultSkeleton() {
  return (
    <div
      aria-busy="true"
      aria-label="正在搜索"
      className="rah-search-result-skeleton"
      role="status"
    >
      {Array.from({ length: 5 }, (_, index) => (
        <div className="rah-search-result-skeleton-card" key={index}>
          <div className="rah-search-result-skeleton-meta">
            <span className="is-24" />
            <span className="is-20" />
            <span className="is-16" />
          </div>
          <span className="is-full" />
          <span className="is-four-fifths" />
        </div>
      ))}
    </div>
  );
}
