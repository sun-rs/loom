// GENERATED exact official declarations, with explicit presentation-only type/import bindings.
import type {ReactNode} from "react";
import {useIntl} from "react-intl";
import {Pencil} from "lucide-react";
import {DescriptionItem,DescriptionTerm,DescriptionDetails,PanelTitle} from "raft-ui";
import Tooltip from "@loom/raft-web-source/Tooltip";
// The original helper reads only these fields; this is a view projection, not a Raft Agent.
type Agent = {displayName?: string; name: string};

function InfoRow({ label, actions, children, testId }: { label: ReactNode; actions?: ReactNode; children: ReactNode; testId?: string }) {
  return (
    <DescriptionItem data-testid={testId}>
      <DescriptionTerm>
        <span className="truncate">{label}</span>
        {actions}
      </DescriptionTerm>
      <DescriptionDetails>{children}</DescriptionDetails>
    </DescriptionItem>
  );
}

const PROFILE_AVATAR_BUTTON_CLASS = "group/avatar-edit relative shrink-0 rounded-sticker outline-none focus-visible:shadow-focus";

const RUNTIME_CHIP_CLASS = "font-mono text-mono-meta font-normal";

const INFO_ICON_BUTTON_CLASS = "shrink-0 rounded-sticker text-foreground-muted transition-colors hover:bg-fill-pressed hover:text-foreground";

function AgentHeaderName({ agent, onEdit }: { agent: Agent; onEdit?: () => void }) {
  const { formatMessage } = useIntl();
  return (
    <>
      <Tooltip content={agent.displayName || agent.name}>
        {/* PanelTitle source (cindyz 2026-10-10): the detail-block name follows the
            panel-title spec (17 / selected weight / heading family) so the same
            name reads identically in the header and the body. */}
        <PanelTitle className="min-w-0">{agent.displayName || agent.name}</PanelTitle>
      </Tooltip>
      {onEdit && (
        <Tooltip content={formatMessage({ id: "agent.detail.editDisplayName" })}>
          <button
            type="button"
            aria-label={formatMessage({ id: "agent.detail.editDisplayName" })}
            onClick={onEdit}
            className={INFO_ICON_BUTTON_CLASS}
          >
            <Pencil size={14} />
          </button>
        </Tooltip>
      )}
    </>
  );
}
export {InfoRow,PROFILE_AVATAR_BUTTON_CLASS,RUNTIME_CHIP_CLASS,INFO_ICON_BUTTON_CLASS,AgentHeaderName};
