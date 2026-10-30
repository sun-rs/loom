import { useAgentStore } from "../upstream/web-1.21.23/packages/web/src/store/agentStore.ts";
import { useChannelStore } from "../upstream/web-1.21.23/packages/web/src/store/channelStore.ts";
import { useMachineStore } from "../upstream/web-1.21.23/packages/web/src/store/machineStore.ts";
import { useMessageStore } from "../upstream/web-1.21.23/packages/web/src/store/messageStore.ts";
import { installReadRecovery } from "./read-recovery.ts";
// Native view caches are projections. Kernel owns unread and each Room's sequence.
async function read() {
  const id = useMessageStore.getState().currentChannelId;
  const reads = [
    useChannelStore.getState().loadChannels(),
    useChannelStore.getState().loadDMChannels(),
    useAgentStore.getState().loadAgents(),
    useMachineStore.getState().loadMachines(),
    useMessageStore.getState().loadUnreadCounts(),
  ];
  if (id) reads.push(useMessageStore.getState().syncGap(id));
  await Promise.all(reads);
}
let flight: Promise<void> | undefined;
function refresh() {
  return (flight ??= read().finally(() => {
    flight = undefined;
  }));
}
export const mainLayoutRealtimeBridgeDriver = {
  bootstrap: () => {
    void refresh();
  },
  install: () =>
    installReadRecovery(refresh, {
      visible: () => document.visibilityState === "visible",
      every: (fn) => {
        const timer = setInterval(fn, 5000);
        return () => clearInterval(timer);
      },
      listen: (name, fn) => {
        const target = name === "visibilitychange" ? document : window;
        target.addEventListener(name, fn);
        return () => target.removeEventListener(name, fn);
      },
    }),
};
