import type { ConsoleContext } from "./context.ts";
import { el } from "./dom.ts";

export type Shell = { connection: HTMLElement; main: HTMLElement };

export function createShell(root: HTMLElement): Shell {
  const connection = el("div", {
    attrs: { id: "connection", role: "status" },
    className: "connection is-connecting",
    text: "连接中…",
  });
  const main = el("main", { attrs: { id: "console-main" } });
  root.replaceChildren(
    el("header", { className: "console-header" }, [
      el("div", { className: "console-title" }, [
        el("h1", { text: "Loom 控制台" }),
        el("span", {
          className: "console-badge",
          text: "evo 临时 · 只读",
        }),
      ]),
      connection,
      el(
        "nav",
        { attrs: { "aria-label": "控制台导航" }, className: "console-nav" },
        [
          el("a", { attrs: { href: "#/channels" }, text: "频道" }),
          el("a", { attrs: { href: "#/usage" }, text: "用量" }),
          el("a", { attrs: { href: "#/settings" }, text: "运行设置" }),
        ],
      ),
    ]),
    main,
  );
  return { connection, main };
}

export function renderConnection(
  element: HTMLElement,
  context: ConsoleContext,
): void {
  const { connection, identity } = context;
  if (connection.kind === "connected" && identity !== undefined) {
    element.className = "connection is-connected";
    element.textContent = `已连接 · ${identity.displayName} · 工作区 ${identity.workspaceName}`;
  } else if (connection.kind === "disconnected") {
    element.className = "connection is-disconnected";
    element.textContent = `未连接：${connection.reason}`;
  } else {
    element.className = "connection is-connecting";
    element.textContent = "连接中…";
  }
}
