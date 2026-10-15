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
      className="right-2 max-md:right-0.5 max-md:[[data-theme=brutal]_&]:-right-1.5 pointer-events-auto"
    >
      <MessageItemToolbarButton
        onClick={onReplyInThread}
        aria-label={formatMessage({ id: "message.messageItem.replyInThread" })}
        data-message-affordance="thread"
      >
        <ThreadIcon width={13} height={13} />
      </MessageItemToolbarButton>
    </MessageItemToolbar>
  );
}
