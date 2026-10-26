import { createContext, useContext, useMemo } from "react";
import { useChannelMembers as useNativeChannelMembers } from "../packages/web/src/hooks/useChannelMembers";
import {
  composerMemberProjection,
  type ComposerMemberScope,
} from "./composer-member-projection";
export const ComposerMemberContext = createContext<ComposerMemberScope | null>(
  null,
);
/** Native rendering and filtering stay upstream; only the read owner changes. */
export function useChannelMembers(
  channelId: string,
  { enabled = true }: { enabled?: boolean } = {},
) {
  const scope = useContext(ComposerMemberContext);
  const fallback = useNativeChannelMembers(channelId, {
    enabled: enabled && scope === null,
  });
  const projected = useMemo(
    () => (scope ? composerMemberProjection(scope, channelId, enabled) : null),
    [scope, channelId, enabled],
  );
  return projected
    ? {
        channelAgents: projected.agents,
        channelHumans: projected.humans,
        channelExternalMembers: projected.externalMembers,
      }
    : fallback;
}
