/** Initial content loading only; background reconciliation keeps existing content. */
export function LoadingState({ inline = false }: { inline?: boolean }) {
  const Tag = inline ? "span" : "div";
  return (
    <Tag
      className={`rah-loading-state${inline ? " is-inline" : ""}`}
      role="status"
      aria-live="polite"
    >
      <span className="rah-loading-spinner" aria-hidden="true" />
      <span>加载中…</span>
    </Tag>
  );
}
