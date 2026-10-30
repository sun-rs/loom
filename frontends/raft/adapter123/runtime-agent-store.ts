import { useAgentStore as native } from "../upstream/web-1.21.23/packages/web/src/store/agentStore.ts";
import { commands } from "./api.ts";
import { observedAgentControls } from "./agent-controls.ts";
export * from "../upstream/web-1.21.23/packages/web/src/store/agentStore.ts";
const controls = observedAgentControls(
  (...args) => commands.write(...args),
  () => native.getState().loadAgents(),
  (message) => commands.notice(message),
);
const cache = new WeakMap<object, ReturnType<typeof native.getState>>();
const project = (state: ReturnType<typeof native.getState>) => {
  let value = cache.get(state);
  if (!value) {
    value = { ...state, ...controls };
    cache.set(state, value);
  }
  return value;
};
export const useAgentStore = Object.assign(
  ((selector: any = (s: any) => s) =>
    native((state) => selector(project(state)))) as typeof native,
  native,
  { getState: () => project(native.getState()) },
);
