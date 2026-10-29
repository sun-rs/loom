import { useIntl } from "react-intl";
import { Copy, Link } from "lucide-react";
import MenuItem from "../packages/web/src/components/ui/MenuItem";
import { copyTextWithFeedback } from "./copy-text";
import { localMessagePermalink } from "./message-links";
/** Retained native Copy link / Copy markdown menu section; only URL/data owner changes. */
export default function MessageCopyItems({
  roomId,
  messageId,
  rootMessageId,
  markdown,
  close,
}: {
  roomId: string;
  messageId: string;
  rootMessageId?: string;
  markdown: string;
  close: () => void;
}) {
  const { formatMessage } = useIntl();
  const copy = (text: string) =>
    void copyTextWithFeedback(text).then((ok) => {
      if (ok) close();
    });
  return (
    <>
      <MenuItem
        icon={<Link size={14} />}
        onClick={() =>
          copy(
            localMessagePermalink(
              location.origin,
              roomId,
              messageId,
              rootMessageId,
            ),
          )
        }
      >
        {formatMessage({ id: "message.messageItem.copyLink" })}
      </MenuItem>
      <MenuItem icon={<Copy size={14} />} onClick={() => copy(markdown)}>
        {formatMessage({ id: "message.messageItem.copyMarkdown" })}
      </MenuItem>
    </>
  );
}
