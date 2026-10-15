import { useEffect, useLayoutEffect, useRef } from "react";
import { useSearchParams } from "react-router-dom";
import type { WriteIntentSlot } from "@rah-os/client-core/write-intent";
// Presentation lifetime only: refer to existing slots, never copy their state.
// Chat send slots already survive navigation in ChannelApp's bridge map.
const routeOwners = new Set<WriteIntentSlot>();
export function useRouteIntentOwner(slot: WriteIntentSlot) {
  useEffect(() => {
    routeOwners.add(slot);
    return () => {
      routeOwners.delete(slot);
    };
  }, [slot]);
}
export function hasRouteBoundIntent() {
  return [...routeOwners].some((slot) => slot.state !== "idle");
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
