import { useState } from "react";
import type { RoomMessageView } from "@rah-os/ui-web";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useMobileLayout } from "../use-mobile-layout.ts";
import { MessageImagePreview } from "./message-image-preview.tsx";
import { useSelectionToolbarFit } from "../use-selection-toolbar-fit.ts";
export function MessageSelectionToolbar({
  allSelected,
  error,
  onCancel,
  onCopyMarkdown,
  onSelectAll,
  selectedCount,
  messages,
  unresolvedCount,
}: {
  allSelected: boolean;
  error?: string | undefined;
  onCancel: () => void;
  onCopyMarkdown: () => void;
  onSelectAll: () => void;
  selectedCount: number;
  messages: readonly RoomMessageView[];
  unresolvedCount: number;
}) {
  const mobile = useMobileLayout();
  const [preview, setPreview] = useState(false);
  const actionable = selectedCount > 0;
  const { ref, collapsed } = useSelectionToolbarFit(
    mobile ? 3 : 4,
    selectedCount,
  );
  const compact = (index: number) => collapsed >= (mobile ? 3 : 4) - index;
  const allLabel = allSelected ? "取消全选" : "全选";
  return (
    <>
      <section
        className="rah-message-selection-toolbar"
        aria-label="消息选择工具栏"
      >
        <strong>已选 {selectedCount} 条</strong>
        <div ref={ref}>
          <button
            onClick={onSelectAll}
            type="button"
            aria-label={allLabel}
            title={allLabel}
            data-icon-only={compact(0) || undefined}
          >
            <Icon name="list-checks" />
            {!compact(0) && <span>{allLabel}</span>}
          </button>
          <button
            onClick={onCancel}
            type="button"
            aria-label="取消"
            title="取消"
            data-icon-only={compact(1) || undefined}
          >
            <Icon name="x" />
            {!compact(1) && <span>取消</span>}
          </button>
          <button
            disabled={!actionable}
            onClick={onCopyMarkdown}
            type="button"
            aria-label="复制 Markdown"
            title="复制 Markdown"
            data-icon-only={compact(2) || undefined}
          >
            <Icon name="copy" />
            {!compact(2) && <span>复制 Markdown</span>}
          </button>
          {!mobile ? (
            <button
              disabled={!actionable || unresolvedCount > 0}
              title={unresolvedCount ? "部分已选消息尚未载入" : "生成图片"}
              aria-label="生成图片"
              data-icon-only={compact(3) || undefined}
              onClick={() => setPreview(true)}
              type="button"
            >
              <Icon name="image" />
              {!compact(3) && <span>生成图片</span>}
            </button>
          ) : null}
        </div>
        {error ? <p role="alert">{error}</p> : null}
      </section>
      {preview ? (
        <MessageImagePreview
          messages={messages}
          onClose={() => setPreview(false)}
        />
      ) : null}
    </>
  );
}
