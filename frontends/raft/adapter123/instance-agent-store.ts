import { useAgentStore as native } from "../upstream/web-1.21.23/packages/web/src/store/agentStore.ts";
import { bridge } from "./api.ts";
import { createAgentFacet } from "./agent-facets.ts";
export * from "../upstream/web-1.21.23/packages/web/src/store/agentStore.ts";
const rows = createAgentFacet("instance", (id) => bridge.kind(id));
export const useAgentStore = Object.assign(
  ((selector: any = (s: any) => s) =>
    native((state) =>
      selector({ ...state, agents: rows(state.agents) }),
    )) as typeof native,
  native,
);
