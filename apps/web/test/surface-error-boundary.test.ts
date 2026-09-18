import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { pathToFileURL } from "node:url";
import test from "node:test";
import { createElement, type ReactNode } from "react";
import { renderToStaticMarkup } from "react-dom/server";

import { readUiSource } from "./ui-source.ts";
import {
  boundaryStateForProps,
  boundaryStateFromError,
  SURFACE_RECOVERY_RELOAD_LABEL,
  SURFACE_RECOVERY_RETRY_LABEL,
  sanitizeSurfaceDiagnostic,
} from "../src/components/surface-error-boundary-diagnostic.ts";

type BoundaryProps = {
  surface: string;
  resetKey?: string;
  children: ReactNode;
};
type BoundaryClass = {
  new (props: BoundaryProps): { state: unknown; render(): ReactNode };
  getDerivedStateFromError(error: unknown): unknown;
};

/** Loads the JSX owner through the app's own bundler transform, so the test
 *  observes the rendered recovery panel instead of only its source text.
 *  react-dom/server does not run class error boundaries, so the failure path is
 *  driven through the component's real getDerivedStateFromError + render. */
async function loadBoundary(): Promise<BoundaryClass> {
  const { transformWithOxc } = await import("vite");
  const url = new URL(
    "../src/components/surface-error-boundary.tsx",
    import.meta.url,
  );
  const require_ = createRequire(url);
  const { code } = await transformWithOxc(
    await import("node:fs/promises").then((fs) => fs.readFile(url, "utf8")),
    url.pathname,
    { lang: "tsx", jsx: { runtime: "automatic" } },
  );
  const linked = code.replace(
    /(\bfrom\s*)"([^"]+)"/g,
    (whole: string, prefix: string, specifier: string) =>
      `${prefix}"${pathToFileURL(require_.resolve(specifier)).href}"`,
  );
  const module_ = (await import(
    `data:text/javascript;base64,${Buffer.from(linked).toString("base64")}`
  )) as Record<string, unknown>;
  return module_.SurfaceErrorBoundary as BoundaryClass;
}

function Exploding(): never {
  throw new Error("timeline render failed with bearer sk-live-4711abcdefgh");
}

test("渲染异常显示可恢复面板而不是白屏", async () => {
  const SurfaceErrorBoundary = await loadBoundary();
  let thrown: unknown;
  try {
    Exploding();
  } catch (error) {
    thrown = error;
  }
  const state = SurfaceErrorBoundary.getDerivedStateFromError(thrown);
  const instance = new SurfaceErrorBoundary({
    surface: "会话",
    children: createElement(Exploding),
  });
  instance.state = state;
  const markup = renderToStaticMarkup(instance.render());
  assert.notEqual(markup.trim(), "");
  assert.match(markup, /会话/);
  assert.match(markup, new RegExp(SURFACE_RECOVERY_RETRY_LABEL));
  assert.match(markup, new RegExp(SURFACE_RECOVERY_RELOAD_LABEL));
  assert.match(markup, /timeline render failed/);
  assert.doesNotMatch(markup, /sk-live-4711abcdefgh/);
  assert.doesNotMatch(markup, /at Exploding|\.tsx:\d+/);
});

test("边界正常时透明渲染子内容，不额外包裹元素", async () => {
  const SurfaceErrorBoundary = await loadBoundary();
  const markup = renderToStaticMarkup(
    createElement(
      SurfaceErrorBoundary as never,
      { surface: "会话" },
      createElement("main", { className: "channel" }, "内容"),
    ),
  );
  assert.equal(markup, '<main class="channel">内容</main>');
});

test("脱敏诊断只保留名称与消息，并抹掉凭据样式片段", () => {
  const error = new Error("fetch failed: Authorization: Bearer abc.def.ghi");
  assert.equal(
    sanitizeSurfaceDiagnostic(error),
    "Error: fetch failed: Authorization: [已脱敏]",
  );
  assert.equal(
    sanitizeSurfaceDiagnostic(new Error("bad token=9f8e7d6c5b4a3f2e1d0c")),
    "Error: bad token=[已脱敏]",
  );
  assert.equal(
    sanitizeSurfaceDiagnostic(
      new Error("jwt eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxIn0.sig"),
    ),
    "Error: jwt [已脱敏]",
  );
  assert.equal(
    sanitizeSurfaceDiagnostic(new Error("secret: hunter2")),
    "Error: secret: [已脱敏]",
  );
  const long = sanitizeSurfaceDiagnostic(new Error("界".repeat(400)));
  assert.ok(long.length <= 200, long.length.toString());
  assert.match(long, /…$/);
  assert.equal(
    sanitizeSurfaceDiagnostic("plain string"),
    "Error: plain string",
  );
  assert.equal(sanitizeSurfaceDiagnostic(undefined), "Error: 未知渲染错误");
  assert.doesNotMatch(
    sanitizeSurfaceDiagnostic(new Error("multi\nline\tmessage")),
    /[\n\t]/,
  );
  const named = new Error("render failed");
  named.name = "token=canary-secret";
  assert.doesNotMatch(sanitizeSurfaceDiagnostic(named), /canary-secret/);
});

test("边界状态只由错误与 props 决定，重试与 props 变化都回到子内容", () => {
  const errored = boundaryStateFromError(new Error("boom"));
  assert.equal(errored.diagnostic, "Error: boom");
  // 同一 resetKey 下不得自行复位：否则失败会无限重渲染。
  assert.equal(
    boundaryStateForProps({ ...errored, resetKey: "room-1" }, "room-1"),
    null,
  );
  assert.deepEqual(
    boundaryStateForProps({ ...errored, resetKey: "room-1" }, "room-2"),
    { diagnostic: undefined, resetKey: "room-2" },
  );
  assert.deepEqual(
    boundaryStateForProps({ resetKey: "room-1" }, "room-1"),
    null,
  );
});

test("边界不持有消息/草稿/选择状态，也不直连 client", () => {
  const source = readUiSource("components/surface-error-boundary.tsx");
  assert.doesNotMatch(
    source,
    /useState|useReducer|localStorage|client-sdk|client-core/,
  );
  assert.doesNotMatch(
    source,
    /\b(messages|draftText|selectedMessageIds|readThrough|MessageSession|MessageSocial)\b/,
  );
  assert.match(source, /static getDerivedStateFromError/);
  assert.match(source, /static getDerivedStateFromProps/);
  // 恢复面板自带样式：样式表本身失效时仍要可见可点。
  assert.match(source, /style=\{\{/);
  assert.match(source, /window\.location\.reload\(\)/);
});

test("壳与主要页面都有边界，导航不会被单个页面拖垮", () => {
  const mount = readUiSource("mount-app.tsx");
  assert.match(mount, /createRoot\(root, SURFACE_ROOT_ERROR_OPTIONS\)/);
  assert.match(
    mount,
    /<SurfaceErrorBoundary[\s\S]*<App \/>[\s\S]*<\/SurfaceErrorBoundary>/,
  );
  const app = readUiSource("App.tsx");
  for (const surface of [
    "会话",
    "话题",
    "全局发现",
    "设置",
    "成员目录",
    "成员浮层",
    "Room 列表",
    "收藏消息",
    "Computer 运行时",
  ])
    assert.match(
      app,
      new RegExp(`<SurfaceErrorBoundary\\s+surface="${surface}"`),
      `${surface} 缺少错误边界`,
    );
  // 导航壳不在任何页面边界内部,页面失败后仍可切换。
  assert.match(app, /<WorkspaceNavigation\n/, "导航仍由 shell 直接渲染");
});

test("viewport 诊断按查询开关启用，只读不改布局", () => {
  const shell = readUiSource("components/workspace-navigation-shell.tsx");
  assert.match(shell, /rahViewportDebug/);
  assert.match(shell, /visualViewport/);
  assert.match(shell, /console\.info/);
  assert.doesNotMatch(shell, /scrollTo|preventDefault|style\.|classList/);
});
