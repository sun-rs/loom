import { createPortal } from "react-dom";
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { useDialogProtocol } from "../dialog-protocol.ts";
import { MessageMarkdown } from "./message-markdown.tsx";
export function MessageTextDialog({
  body,
  onClose,
}: {
  body: string;
  onClose: () => void;
}) {
  const ref = useDialogProtocol({ blocked: false, onClose });
  return createPortal(
    <section
      className="rah-message-text-dialog"
      role="dialog"
      aria-modal="true"
      aria-label="复制文本"
      ref={ref}
      tabIndex={-1}
      // A portal still bubbles through the originating message in React.
      // Isolate its gestures without cancelling native text selection/menu.
      onContextMenu={(event) => event.stopPropagation()}
      onTouchStart={(event) => event.stopPropagation()}
      onTouchMove={(event) => event.stopPropagation()}
      onTouchEnd={(event) => event.stopPropagation()}
      onTouchCancel={(event) => event.stopPropagation()}
      onPointerDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onKeyDown={(event) => {
        if (event.key !== "Escape" && event.key !== "Tab")
          event.stopPropagation();
      }}
    >
      <header>
        <button
          type="button"
          className="sq-btn"
          aria-label="关闭复制文本"
          onClick={onClose}
        >
          <Icon name="x" />
        </button>
      </header>
      <div
        className="msg-body"
        role="textbox"
        aria-label="消息文本"
        aria-readonly="true"
        aria-multiline="true"
        contentEditable
        suppressContentEditableWarning
        inputMode="none"
        spellCheck={false}
        onBeforeInput={(event) => event.preventDefault()}
        onPaste={(event) => event.preventDefault()}
        onDrop={(event) => event.preventDefault()}
        onCut={(event) => event.preventDefault()}
      >
        <MessageMarkdown source={body} />
      </div>
    </section>,
    document.body,
  );
}
