/** Console application; loaded by main.ts after Zod is made jitless. */
import { createConsoleClient, errorText, isAbort } from "./api.ts";
import { notify, type ConsoleContext } from "./context.ts";
import { loadIdentity } from "./model.ts";
import { Poller } from "./poll.ts";
import { mountChannel } from "./view-channel.ts";
import { mountChannelList } from "./view-channels.ts";
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
  rooms: [],
  roomsLoaded: false,
};
context.listeners.add(() => renderConnection(shell.connection, context));

new Poller(LIST_POLL_MS, async (signal) => {
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
}).start();

let unmount: (() => void) | undefined;
function route(): void {
  unmount?.();
  const hash = window.location.hash.replace(/^#/u, "");
  const channel = /^\/channel\/(.+)$/u.exec(hash);
  for (const link of document.querySelectorAll<HTMLAnchorElement>(
    ".console-nav a",
  )) {
    const target = link.getAttribute("href")?.slice(1) ?? "";
    const current =
      hash === target ||
      (target === "/channels" &&
        (channel !== null || hash === "" || hash === "/"));
    if (current) link.setAttribute("aria-current", "page");
    else link.removeAttribute("aria-current");
  }
  if (channel?.[1] !== undefined) {
    unmount = mountChannel(shell.main, context, decodeURIComponent(channel[1]));
  } else if (hash === "/usage") {
    unmount = mountUsage(shell.main, context);
  } else if (hash === "/settings") {
    unmount = mountSettings(shell.main, context);
  } else {
    unmount = mountChannelList(shell.main, context);
  }
}
window.addEventListener("hashchange", route);
route();
