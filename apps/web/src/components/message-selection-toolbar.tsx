import { Icon } from "./icon.tsx";

export function MessageSelectionToolbar({
  allSelected,
  error,
  onCancel,
  onCopyLinks,
  onCopyMarkdown,
  onForward,
  onSelectAll,
  selectedCount,
}: {
  allSelected: boolean;
  error?: string | undefined;
  onCancel: () => void;
  onCopyLinks: () => void;
  onCopyMarkdown: () => void;
  onForward?: (() => void) | undefined;
  onSelectAll: () => void;
  selectedCount: number;
}) {
  const actionable = selectedCount > 0;
  return (
    <section
      className="rah-message-selection-toolbar"
      aria-label="消息选择工具栏"
    >
      <strong>已选择 {selectedCount} 条</strong>
      <div>
        <button onClick={onSelectAll} type="button">
          <Icon name="check" />
          {allSelected ? "取消全选" : "全选"}
        </button>
        {onForward === undefined ? null : (
          <button disabled={!actionable} onClick={onForward} type="button">
            <Icon name="send" />
            转发
          </button>
        )}
        <button disabled={!actionable} onClick={onCopyLinks} type="button">
          <Icon name="link-2" />
          复制链接
        </button>
        <button disabled={!actionable} onClick={onCopyMarkdown} type="button">
          <Icon name="copy" />
          复制 Markdown
        </button>
        <button onClick={onCancel} type="button">
          <Icon name="x" />
          取消
        </button>
      </div>
      {error === undefined ? null : <p role="alert">{error}</p>}
    </section>
  );
}
