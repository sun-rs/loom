import { useEffect, useState } from "react";
import {
  readSidebarDisclosure,
  writeSidebarDisclosure,
  type SidebarDisclosure,
} from "./sidebar-disclosure.ts";

function storage() {
  try {
    return window.sessionStorage;
  } catch {
    return undefined;
  }
}

export function useSidebarDisclosure(
  scope: string,
  instanceId: string | undefined,
) {
  const [state, setState] = useState(() => ({
    scope,
    instanceId,
    choices: instanceId
      ? readSidebarDisclosure(storage(), scope, instanceId)
      : ({} as SidebarDisclosure),
  }));
  let current = state;
  if (state.scope !== scope || state.instanceId !== instanceId) {
    const saved = instanceId
      ? readSidebarDisclosure(storage(), scope, instanceId)
      : {};
    // A click before the initial inventory response still belongs to this boot.
    const choices =
      state.scope === scope && state.instanceId === undefined
        ? { ...saved, ...state.choices }
        : saved;
    current = { scope, instanceId, choices };
    setState(current);
  }
  useEffect(() => {
    if (current.instanceId)
      writeSidebarDisclosure(
        storage(),
        current.scope,
        current.instanceId,
        current.choices,
      );
  }, [current]);
  return {
    disclosure: current.choices,
    setDisclosure(section: string, open: boolean) {
      const choices = { ...current.choices, [section]: open };
      setState({ scope, instanceId, choices });
    },
  };
}
