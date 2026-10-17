import { RouteIntentOwners } from "./intent-route-owners.ts";
import { useEffect, useLayoutEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { WriteIntentSlot } from "@rah-os/client-core/write-intent";
// Presentation lifetime only: refer to existing slots, never copy their state.
// Chat send slots already survive navigation in ChannelApp's bridge map.
const routeOwners = new RouteIntentOwners();
export function useRouteIntentOwner(
  slot: WriteIntentSlot,
  onlyAction?: string | readonly string[],
) {
  useEffect(
    () =>
      routeOwners.register(
        slot,
        typeof onlyAction === "string" ? [onlyAction] : onlyAction,
      ),
    [slot, onlyAction],
  );
}
export function hasRouteBoundIntent() {
  return routeOwners.blocked();
}
/** Keep route-local owners mounted during unresolved in-app history navigation. */
export function useIntentRoute(): ReturnType<typeof useSearchParams> {
  const [requested, setParams] = useSearchParams();
  const accepted = useRef(requested);
  const blocked = hasRouteBoundIntent();
  const effective = blocked ? accepted.current : requested;
  useLayoutEffect(() => {
    if (blocked && requested.toString() !== accepted.current.toString())
      setParams(accepted.current, { replace: true });
    else if (!blocked) accepted.current = requested;
  }, [requested, blocked, setParams]);
  return [effective, setParams];
}
