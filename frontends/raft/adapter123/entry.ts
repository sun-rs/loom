// Local host bootstrap only. The complete official main.tsx owns every UI root/provider.
import { useAuthStore } from "../upstream/web-1.21.23/packages/web/src/store/authStore.ts";
import { useServerStore } from "../upstream/web-1.21.23/packages/web/src/store/serverStore.ts";
import { useAgentStore } from "../upstream/web-1.21.23/packages/web/src/store/agentStore.ts";
import { useChannelStore } from "../upstream/web-1.21.23/packages/web/src/store/channelStore.ts";
import { useMachineStore } from "../upstream/web-1.21.23/packages/web/src/store/machineStore.ts";
import { bridge, commands } from "./api.ts";
import { toast } from "@botiverse/raft-ui";
async function start() {
  commands.notice = (message, retry) => {
    toast.error(message, {
      id: "loom-native-intent",
      timeout: 0,
      ...(retry
        ? {
            action: {
              label: "核实原请求",
              onClick: () => {
                void retry().then(() => {
                  if (commands.writes.state === "idle")
                    toast.dismiss("loom-native-intent");
                });
              },
            },
          }
        : {}),
    });
  };
  commands.changed = (action) => {
    if (action.startsWith("role-") || action === "instantiate")
      void useAgentStore.getState().loadAgents();
    if (action === "channel-create") {
      void useChannelStore.getState().loadChannels();
      void useChannelStore.getState().loadDMChannels();
    }
  };
  const { user, server } = await bridge.identity();
  localStorage.setItem("slock_locale", "zh-CN");
  useAuthStore.setState({
    user,
    loading: false,
    initialized: true,
    restoreState: "authenticated",
  } as any);
  useServerStore.setState({
    servers: [server],
    current: server,
    loading: false,
  } as any);
  void Promise.all([
    useChannelStore.getState().loadChannels(),
    useChannelStore.getState().loadDMChannels(),
    useAgentStore.getState().loadAgents(),
    useMachineStore.getState().loadMachines(),
    useServerStore.getState().loadMembers(),
  ]);
  await import("../upstream/web-1.21.23/packages/web/src/main.tsx");
}
void start().catch((error) => {
  console.error("Loom native123 bootstrap", error);
  document.getElementById("root")!.textContent =
    "无法连接 Loom：" + error.message;
});
