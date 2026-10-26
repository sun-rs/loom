/** Current native ThreadOverflowMenu composition, v1.21.22; see page-adoption.json.
 * Unsupported search/split/location commands omitted; controller belongs to Loom. */
import { useState } from "react";
import { useIntl } from "react-intl";
import {
  EllipsisVertical,
  Minimize2,
  Maximize2,
  MessageCircleOff,
  MessageCirclePlus,
} from "lucide-react";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
  PanelAction,
} from "raft-ui";
import Tooltip from "../packages/web/src/components/ui/Tooltip.tsx";
export default function ThreadFollowMenu({
  focused = false,
  onToggleFocus,
  canToggleFocus,
  followed,
  followBusy,
  onFollow,
}: {
  focused?: boolean;
  onToggleFocus?: () => void;
  canToggleFocus?: () => boolean;
  followed: boolean;
  followBusy: boolean;
  onFollow: () => void;
}) {
  const { formatMessage } = useIntl();
  const handleFollowAction = onFollow;
  const [showFocus, setShowFocus] = useState(false);
  return (
    <DropdownMenu
      onOpenChange={(open) => {
        if (open) setShowFocus(canToggleFocus?.() ?? false);
      }}
    >
      <Tooltip
        content={formatMessage({ id: "message.threadPanel.overflow.open" })}
      >
        <DropdownMenuTrigger
          render={
            <PanelAction
              aria-label={formatMessage({
                id: "message.threadPanel.overflow.open",
              })}
              data-testid="thread-overflow-trigger"
            >
              <EllipsisVertical />
            </PanelAction>
          }
        />
      </Tooltip>
      <DropdownMenuContent
        side="bottom"
        align="end"
        sideOffset={4}
        aria-label={formatMessage({ id: "message.threadPanel.overflow.open" })}
        data-testid="thread-overflow-menu"
      >
        {onToggleFocus && showFocus && (
          <DropdownMenuItem
            onClick={onToggleFocus}
            data-testid="thread-overflow-maximize"
          >
            {focused ? <Minimize2 /> : <Maximize2 />}
            {focused ? "显示频道" : "隐藏频道"}
          </DropdownMenuItem>
        )}
        {
          <DropdownMenuItem
            onClick={handleFollowAction}
            disabled={followBusy}
            data-testid="thread-overflow-follow-action"
          >
            {followed ? <MessageCircleOff /> : <MessageCirclePlus />}
            {formatMessage({
              id: followed
                ? "message.messageItem.unfollowThread"
                : "message.messageItem.followThread",
            })}
          </DropdownMenuItem>
        }
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
