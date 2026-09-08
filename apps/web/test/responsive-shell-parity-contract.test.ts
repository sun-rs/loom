import assert from "node:assert/strict";
import { iconName } from "../../../packages/ui-web/src/neo-brutalist/icon-name.ts";
import { readFileSync } from "node:fs";
import test from "node:test";

import { readUiSource as readWeb } from "./ui-source.ts";
const readRaftBundle = () =>
  readFileSync(
    new URL(
      "../../../docs/evidence/raft-web-20260831-current/index-BoAC7nSE.js",
      import.meta.url,
    ),
    "utf8",
  );

test("responsive shell follows Raft's single 767px mobile boundary", () => {
  const raft = readRaftBundle();
  const product = readWeb("product.css");
  const discovery = readWeb("global-discovery.css");

  assert.match(raft, /Oet="\(max-width: 767px\)"/u);
  assert.match(
    product,
    /@media \(max-width: 767px\)[\s\S]*?\.app\.rah-product-shell \{/u,
  );
  assert.match(
    discovery,
    /@media \(max-width: 767px\)[\s\S]*?\.app\.rah-global-shell/u,
  );
  assert.doesNotMatch(product, /@media \(max-width: 700px\)/u);
  assert.doesNotMatch(discovery, /@media \(max-width: 760px\)/u);
});

test("short desktop shells use Raft's compact rail geometry", () => {
  const raft = readRaftBundle();
  const product = readWeb("panel-layout.css");

  assert.match(raft, /md:\[@media\(max-height:600px\)\]:w-\[50px\]/u);
  assert.match(raft, /md:\[@media\(max-height:600px\)\]:size-9/u);
  assert.match(product, /@media \(max-height: 600px\)/u);
  assert.match(
    product,
    /@media \(max-height: 600px\)[\s\S]*?--rail-w:\s*50px/u,
  );
  assert.match(
    product,
    /@media \(max-height: 600px\)[\s\S]*?\.rail-btn[\s\S]*?height:\s*36px[\s\S]*?width:\s*36px/u,
  );
});

test("mobile root navigation and detail visibility match Raft", () => {
  const raft = readRaftBundle();
  const navigation = readWeb("components/workspace-navigation.tsx");
  const app = readWeb("App.tsx");

  for (const id of [
    "layout.mobileTabBar.home",
    "layout.mobileTabBar.tasks",
    "layout.mobileTabBar.members",
    "layout.mobileTabBar.settings",
  ]) {
    assert.match(raft, new RegExp(id.replaceAll(".", "\\."), "u"));
  }
  assert.match(
    navigation,
    /label="主页"[\s\S]*?label="任务"[\s\S]*?label="成员"[\s\S]*?label="设置"/u,
  );
  assert.doesNotMatch(
    navigation.slice(navigation.indexOf("export function MobileNavigation")),
    /label="(?:搜索|动态|Rooms|聊天|Agents|Inbox)"/u,
  );
  assert.match(app, /showMobileNavigation=/u);
  assert.match(app, /onHome=/u);
});

test("mobile Tasks start in Raft's board presentation", () => {
  const tasks = readWeb("components/global-discovery.tsx");
  assert.doesNotMatch(
    tasks,
    /matchMedia\("\(max-width: 767px\)"\)\.matches \? "list" : "board"/u,
  );
  assert.match(tasks, /const defaultView = "board"/u);
});

test("Room Tasks toolbar wraps whole controls and grows like Raft", () => {
  const raft = readRaftBundle();
  const product = readWeb("product.css");
  assert.match(
    raft,
    /className:"shrink-0 border-b-2 border-black bg-white px-4 py-3",children:i\.jsxs\("div",\{className:"flex flex-wrap items-center gap-2"/u,
  );
  assert.match(
    raft,
    /className:"btn-brutal-sm inline-flex items-center gap-1 bg-brutal-pink px-2 py-1 text-xs font-bold",children:\[i\.jsx\(Us,\{size:12\}\)/u,
  );
  assert.match(
    product,
    /\.tasks-toolbar\s*\{[^}]*height:\s*auto;[^}]*min-height:\s*var\(--raft-tasks-toolbar-height\);/u,
  );
  assert.match(product, /\.tasks-toolbar-row\s*\{[^}]*flex-wrap:\s*wrap;/u);
  assert.match(
    product,
    /\.rah-task-create\s*\{[^}]*flex:\s*none;[^}]*font-size:\s*12px;[^}]*gap:\s*4px;[^}]*height:\s*auto;[^}]*line-height:\s*16px;[^}]*padding:\s*4px 8px;[^}]*white-space:\s*nowrap;/u,
  );
  assert.match(
    product,
    /\.rah-task-create svg\s*\{[^}]*height:\s*12px;[^}]*width:\s*12px;/u,
  );
});

test("mobile Home renders the actual Raft house glyph, not a missing SVG reference", () => {
  const raft = readRaftBundle();
  const icon = readWeb("components/icon.tsx");
  const sprite = readFileSync(
    new URL(
      "../../../packages/ui-tokens/src/interaction-icons.svg",
      import.meta.url,
    ),
    "utf8",
  );
  assert.equal(iconName("home"), "house");
  assert.match(icon, /\[[^\]]*"house"[^\]]*\]\.includes\(mappedName\)/u);
  const symbol = sprite.match(
    /<symbol id="raft-icon-house"[^>]*>([\s\S]*?)<\/symbol>/u,
  )?.[1];
  assert.ok(symbol, "Home must resolve to a packaged SVG symbol");
  const upstream = raft.match(
    /const y3e=(\[\[.*?\]\]),x3e=Et\("house",y3e\)/u,
  )?.[1];
  assert.ok(upstream);
  const paths = [...symbol.matchAll(/d="([^"]+)"/gu)].map((match) => match[1]);
  assert.equal(paths.length, 2);
  for (const path of paths) assert.ok(upstream.includes(`d:"${path}"`));
});

test("channel topbar actions use Raft's small icon-button geometry", () => {
  const raft = readRaftBundle();
  const navigation = readWeb("components/workspace-navigation.tsx");
  const product = readWeb("panel-foundations.css");

  assert.match(
    raft,
    /sm:\{icon:"size-7 text-xs"[\s\S]*?function T8\([\s\S]*?shape:"icon"/u,
  );
  assert.match(
    navigation,
    /<PanelHeaderAction[\s\S]*?className="rah-channel-options"[\s\S]*?aria-label="频道详情与设置"/u,
  );
  assert.doesNotMatch(
    navigation,
    /className="sq-btn members"[\s\S]*?aria-label="频道详情与设置"/u,
  );
  assert.match(
    product,
    /\.rah-panel-header-action \{[\s\S]*?height:\s*28px;[\s\S]*?width:\s*28px;/u,
  );
  assert.match(
    product,
    /\.rah-panel-header-action > svg \{[\s\S]*?height:\s*14px;[\s\S]*?width:\s*14px;/u,
  );
});
