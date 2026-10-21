// GENERATED from immutable Raft db5e399 source. Explicit Loom data/authority bindings; do not edit.
import {JointPeerBadge} from "../packages/web/src/components/agent/ChannelMembers";
import { useLoomFollowerProfile } from "./ThreadFollowers";
import { Button } from "raft-ui";
import { X } from "lucide-react";
import { useCallback } from "react";
import { useIntl } from "react-intl";
import type { ThreadAgentFollower } from "../packages/web/src/store/threadAgentFollowerStore";


import { ChannelMemberRow } from "../packages/web/src/components/channel/ChannelMemberList";
import type { Agent } from "../packages/web/src/store/agentStore";

import Tooltip from "../packages/web/src/components/ui/Tooltip";

/** The follower endpoint reports transport-ish statuses (for example
 *  "online"); normalize to the shared AgentStatus union the activity stores
 *  and profiles speak (task #701). */
function followerAgentStatus(status: string | null | undefined): Agent["status"] {
  return status === "active" || status === "online"
    ? "active"
    : status === "stopped" ? "stopped" : "inactive";
}

export function ThreadAgentFollowerRow({ agent, canManage, removing, currentServerId, onRemove }: {
  agent: ThreadAgentFollower;
  canManage: boolean | undefined;
  removing: boolean;
  currentServerId: string | undefined;
  onRemove: (agentId: string, agentLabel: string) => Promise<void>;
}) {
  const { formatMessage } = useIntl();
  const openProfile = useLoomFollowerProfile();
  const agentLabel = agent.displayName || agent.name;
  const canRemoveAgent = canManage && agent.canRemove !== false;
  const serverLabel = agent.serverName || agent.serverSlug;
  const removeLabel = canRemoveAgent
    ? formatMessage({ id: "thread.followers.remove" }, { agent: agentLabel })
    : formatMessage({ id: "thread.followers.peerRemoveUnavailable" }, {
      agent: agentLabel,
      server: serverLabel || formatMessage({ id: "thread.followers.peerServer" }),
    });

  const openAgentProfile = useCallback(() => {
    openProfile("agent", agent.id);
  }, [agent, currentServerId, openProfile]);

  const handleRemoveClick = useCallback(() => {
    if (!canRemoveAgent) return;
    void onRemove(agent.id, agentLabel);
  }, [agent.id, agentLabel, canRemoveAgent, onRemove]);

  return (
    // artin (task #701): reuse the members list's row wholesale, so
    // the avatar's activity badge and the status sub-line stay
    // structurally identical to that surface.
    <div data-testid="thread-follower-row">
      <ChannelMemberRow
        type="agent"
        agentAvatarUrl={agent.avatarUrl}
        name={(
          <span className="flex min-w-0 items-center gap-1.5">
            <span className="min-w-0 truncate">{agentLabel}</span>
            {agent.isCurrentServer === false && serverLabel ? (
              <span className="max-w-1/2 shrink-0">
                <JointPeerBadge label={serverLabel} />
              </span>
            ) : null}
          </span>
        )}
        secondary={undefined}
        onRowClick={openAgentProfile}
        trailing={canManage ? (
          <Tooltip content={removeLabel}>
            <Button
              type="button"
              size="icon-sm"
              variant="ghost"
              className={canRemoveAgent ? undefined : "cursor-not-allowed"}
              disabled={!canRemoveAgent || removing}
              onClick={handleRemoveClick}
              aria-label={removeLabel}
              data-testid="thread-follower-remove"
            >
              <X size={14} />
            </Button>
          </Tooltip>
        ) : undefined}
      />
    </div>
  );
}
