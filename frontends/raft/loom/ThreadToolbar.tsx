import {
  MessageItemToolbar,
  MessageItemToolbarButton,
  ThreadIcon,
} from "raft-ui";
import { useIntl } from "react-intl";
import { useMediaQuery } from "../packages/web/src/hooks/effectPrimitives.ts";
/** MessageHoverToolbar structural subset: only the connected thread action. */
export default function ThreadToolbar({
  onReplyInThread,
}: {
  onReplyInThread: () => void;
}) {
  const coarse = useMediaQuery("(pointer: coarse)");
  const { formatMessage } = useIntl();
  if (coarse) return null;
  return (
    <MessageItemToolbar
      data-message-affordance="toolbar"
      className="pointer-events-auto"
    >
      <MessageItemToolbarButton
        onClick={onReplyInThread}
        aria-label={formatMessage({ id: "message.messageItem.replyInThread" })}
        data-message-affordance="thread"
      >
        <ThreadIcon width={18} height={18} />
      </MessageItemToolbarButton>
    </MessageItemToolbar>
  );
}
