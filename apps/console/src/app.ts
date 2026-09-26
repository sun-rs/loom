/** Console application; loaded by main.ts after Zod is made jitless. */
import { createConsoleClient, errorText, isAbort } from "./api.ts";
import { notify, type ConsoleContext } from "./context.ts";
import { el } from "./dom.ts";
import { loadIdentity } from "./model.ts";
import { Poller } from "./poll.ts";
import { parseRoute } from "./route.ts";
import { mountChannel } from "./view-channel.ts";
import { mountChannelList } from "./view-channels.ts";
import { mountDirect } from "./view-direct.ts";
import { mountRoles } from "./view-roles.ts";
import { mountSettings } from "./view-settings.ts";
import { createShell, renderConnection } from "./view-shell.ts";
import { mountUsage } from "./view-usage.ts";

const LIST_POLL_MS = 15_000;

const root = document.getElementById("console-root");
if (root === null) throw new Error("console root is missing");
const shell = createShell(root);
const context: ConsoleContext = {
  client: createConsoleClient(),
  connection: { kind: "connecting" },
  identity: undefined,
  listeners: new Set(),
  refreshRooms: () => undefined,
  rooms: [],
  roomsLoaded: false,
};
context.listeners.add(() => renderConnection(shell.connection, context));

const listPoller = new Poller(LIST_POLL_MS, async (signal) => {
  try {
    const identity = await loadIdentity(context.client, { signal });
    const rooms = await context.client.request(
      "room.list",
      { workspaceId: identity.workspaceId },
      { signal },
    );
    if (signal.aborted) return;
    context.identity = identity;
    context.rooms = rooms.rooms;
    context.roomsLoaded = true;
    context.connection = { kind: "connected" };
  } catch (error) {
    if (signal.aborted || isAbort(error)) return;
    context.connection = { kind: "disconnected", reason: errorText(error) };
  }
  notify(context);
});
context.refreshRooms = () => listPoller.runNow();
listPoller.start();

let unmount: (() => void) | undefined;
function route(): void {
  unmount?.();
  unmount = undefined;
  const hash = window.location.hash.replace(/^#/u, "");
  const current = parseRoute(hash);
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    ".console-nav a",
  )) {
    const target = link.getAttribute("href")?.slice(1) ?? "";
    const active =
      hash === target ||
      (target === "/channels" &&
        (current.kind === "channel" ||
          current.kind === "direct" ||
          hash === "" ||
          hash === "/"));
    if (active) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  switch (current.kind) {
    case "channel":
      unmount = mountChannel(shell.main, context, current.roomId);
      break;
    case "direct":
      unmount = mountDirect(shell.main, context, current.roomId);
      break;
    case "roles":
      unmount = mountRoles(shell.main, context);
      break;
    case "usage":
      unmount = mountUsage(shell.main, context);
      break;
    case "settings":
      unmount = mountSettings(shell.main, context);
      break;
    case "invalid":
      shell.main.replaceChildren(
        el("section", { className: "panel" }, [
          el("h2", { attrs: { id: "invalid-route" }, text: "无效路由" }),
          el("p", {
            className: "muted",
            text: `地址中的编码无效：#${current.hash}`,
          }),
          el("a", { attrs: { href: "#/channels" }, text: "返回频道列表" }),
        ]),
      );
      break;
    default:
      unmount = mountChannelList(shell.main, context);
  }
}
window.addEventListener("hashchange", route);
route();
