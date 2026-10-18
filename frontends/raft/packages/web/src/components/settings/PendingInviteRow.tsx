import { Button } from "raft-ui";
import Tooltip from "../ui/Tooltip";
import { useCallback } from "react";
import { X } from "lucide-react";
import { useIntl } from "react-intl";
import type { PendingInvite } from "./SettingsPanel";

export function PendingInviteRow({
  invite,
  onRequestRevoke,
}: {
  invite: PendingInvite;
  onRequestRevoke: (invite: PendingInvite) => void;
}) {
  const { formatDate, formatMessage } = useIntl();
  const handleRequestRevoke = useCallback(() => onRequestRevoke(invite), [invite, onRequestRevoke]);

  return (
    <div className="flex items-center gap-2 border border-line-muted   px-3 py-2">
      <span className="flex-1 font-mono text-xs text-foreground-strong  truncate">
        {invite.invitedEmail}
      </span>
      <span className="text-[10px] text-foreground-muted  font-mono shrink-0">
        {formatDate(invite.createdAt, {
          month: "short",
          day: "numeric",
        })}
      </span>
      <Tooltip content={formatMessage({ id: "settings.invites.revokeInviteTitle" })}>
      <Button
        variant="outline" size="icon-sm" type="button"
        onClick={handleRequestRevoke}
        className="shrink-0"
        aria-label={formatMessage({ id: "settings.invites.revokeInviteTitle" })}
        data-slot="button"
      >
        <X size={12} />
      </Button>
      </Tooltip>
    </div>
  );
}
