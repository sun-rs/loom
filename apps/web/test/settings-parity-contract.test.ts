import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");

test("settings navigation exposes the applicable Raft contract and omits cloud commerce", () => {
  const surface = read("components/settings-surface.tsx");
  for (const section of [
    "account",
    "appearance",
    "notifications",
    "server",
    "administration",
    "managed-mcp",
    "lan-devices",
    "about",
    "docs",
    "feedback",
    "release-notes",
  ])
    assert.match(surface, new RegExp(`\"${section}\"`, "u"), section);
  assert.doesNotMatch(surface, /套餐|账单|Plan|Billing/u);
  assert.doesNotMatch(surface, /language-region|语言与区域/u);
  assert.doesNotMatch(surface, /label:\s*["']应用["']/u);
  const primitives = read("components/settings-primitives.tsx");
  assert.match(primitives, /SettingsPageHeader/u);
  assert.match(primitives, /data-slock-settings-tab/u);
});

test("profile and appearance settings expose the full local Raft contract", () => {
  const pages = read("components/settings-pages.tsx");
  assert.match(pages, /principal\.update/u);
  assert.match(pages, /显示名称/u);
  assert.match(pages, /aria-label="上传图片"/u);
  assert.match(pages, /type="file"/u);
  assert.match(
    pages,
    /accept="image\/jpeg,image\/png,image\/gif,image\/webp"/u,
  );
  assert.match(pages, /profileImages\.upload/u);
  assert.doesNotMatch(pages, />\s*选择头像\s*</u);
  assert.doesNotMatch(pages, />\s*标识\s*</u);
  for (const sample of ["Cindy", "@Joy", "#proj-uiux", "git pull"])
    assert.match(
      pages,
      new RegExp(sample.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&"), "u"),
    );
});

test("settings shell uses the measured Raft geometry and one shared visual protocol", () => {
  const surface = read("components/settings-surface.tsx");
  const primitives = read("components/settings-primitives.tsx");
  const css = read("product.css");
  assert.doesNotMatch(surface, /rah-settings-mobile-tabs/u);
  assert.match(surface, /rah-settings-mobile-index/u);
  assert.match(surface, /settingsSectionFromSearch/u);
  assert.match(primitives, /SettingsMobileBackProvider/u);
  assert.match(primitives, /rah-settings-mobile-back/u);
  assert.match(primitives, /返回设置/u);
  assert.match(css, /--rah-settings-sidebar-width:\s*240px/u);
  assert.match(css, /--rah-settings-header-height:\s*62px/u);
  assert.match(
    css,
    /\.rah-settings-navigation section > button\.is-active\s*\{[^}]*background:\s*var\(--pink\)/su,
  );
  assert.match(
    css,
    /\.rah-settings-page-icon\s*\{[^}]*height:\s*36px[^}]*width:\s*36px/su,
  );
  assert.match(
    css,
    /\.rah-settings-page-icon > svg\s*\{[^}]*height:\s*18px[^}]*width:\s*18px/su,
  );
  assert.match(
    css,
    /\.rah-settings-card\s*\{[^}]*box-shadow:\s*var\(--shadow-s\)/su,
  );
  assert.match(css, /\.rah-settings-mobile-back\s*\{[^}]*display:\s*none/su);
  assert.match(
    css,
    /@media \(max-width:\s*700px\)[\s\S]*\.rah-settings-mobile-back\s*\{[^}]*display:\s*inline-flex/su,
  );
});

test("notification settings use the Raft push card contract with local diagnostics secondary", () => {
  const push = read("components/web-push-settings.tsx");
  assert.match(push, /私信、直接提及以及已关注消息列的回复/u);
  assert.match(push, /静音此协作空间/u);
  assert.match(push, /rah-settings-card/u);
  assert.match(push, /rah-settings-secondary/u);
  assert.doesNotMatch(push, /rah-push-card/u);
});

test("the web entry configures Zod before dynamically loading protocol modules", () => {
  const entry = read("main.tsx");
  const configIndex = entry.indexOf("__zod_globalConfig");
  const mountIndex = entry.indexOf('import("./mount-app.tsx")');
  assert.ok(configIndex >= 0, "missing pre-import Zod CSP configuration");
  assert.ok(
    mountIndex > configIndex,
    "application loaded before Zod CSP configuration",
  );
  assert.doesNotMatch(entry, /from ["']zod["']/u);
  assert.doesNotMatch(entry, /^import .*push-navigation/mu);
  assert.ok(
    entry.indexOf('import("./push-navigation.ts")') > configIndex,
    "push protocol loaded before Zod CSP configuration",
  );
  assert.match(entry, /jitless:\s*true/u);
});
