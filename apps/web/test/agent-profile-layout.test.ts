import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path: string) =>
  readFileSync(new URL(`../src/${path}`, import.meta.url), "utf8");
const css = readFileSync(
  new URL(
    "../../../packages/ui-tokens/src/neo-brutalist/profile.css",
    import.meta.url,
  ),
  "utf8",
);
const rule = (selector: string) => {
  const start = css.indexOf(`${selector} {`);
  assert.notEqual(start, -1, `missing ${selector}`);
  return css.slice(start, css.indexOf("}", start));
};

test("profile uses existing Raft color tokens, including model/member lavender", () => {
  for (const file of [
    "agent-directory.css",
    "computer-directory.css",
    "product.css",
    "room-member-pages.css",
  ])
    assert.doesNotMatch(read(file), /var\(--purple\)/u, file);
  assert.match(
    rule(".rah-agent-runtime-chips strong.is-lavender"),
    /var\(--lavender\)/u,
  );
});

test("profile actions retain Raft's 40px/8px stack without extra spacers or a sticky footer", () => {
  assert.doesNotMatch(
    rule(".rah-agent-profile-actions"),
    /margin-top:\s*(?:29|24)px/u,
  );
  assert.match(rule(".rah-agent-profile-actions"), /gap: 8px/u);
  assert.doesNotMatch(
    rule(".rah-agent-profile-actions button.is-red"),
    /margin-top/u,
  );
  assert.match(
    rule(".rah-agent-profile-actions button"),
    /var\(--raft-members-action-button-height\)/u,
  );
  assert.doesNotMatch(
    css,
    /\.rah-agent-actions-section\s*\{[^}]*position:\s*(?:fixed|sticky)/u,
  );
});

test("narrow profile does not inflate its hero or force creation metadata into one column", () => {
  assert.doesNotMatch(
    css,
    /\.rah-agent-profile-hero\s*\{[^}]*min-height: 136px/u,
  );
  assert.doesNotMatch(
    css,
    /\.rah-agent-info-grid\s*\{[^}]*grid-template-columns: 1fr;/u,
  );
  assert.match(rule(".rah-agent-profile-heading"), /display: flex/u);
  assert.match(rule(".rah-agent-profile-hero h3"), /text-overflow: ellipsis/u);
});

test("execution reset and local issue report remain capability-gated", () => {
  const source = read("components/agent-directory-pane.tsx");
  const buttons = [
    ...source.matchAll(/<button\b[^>]*>[\s\S]*?<\/button>/gu),
  ].map(([value]) => value);
  const reset = buttons.find((value) => value.includes("重启 / 重置"));
  assert.ok(reset);
  assert.match(reset, /onResetExecution === undefined/u);
  assert.match(reset, /onClick=/u);
  assert.doesNotMatch(reset, /暂不可用/u);
  const report = buttons.find((value) => value.includes("报告问题"));
  assert.ok(report);
  assert.match(report, /disabled=\{!canManage\}/u);
  assert.match(report, /onClick=\{\(\) => setIssueReportOpen\(true\)\}/u);
  assert.match(report, /不会自动上传/u);
  assert.doesNotMatch(report, /暂不可用/u);
  const resetDialog = read("components/agent-execution-reset-dialog.tsx");
  assert.match(resetDialog, /mode: "restart"/u);
  assert.match(resetDialog, /mode: "session"/u);
  assert.match(resetDialog, /mode: "full"/u);
  assert.match(resetDialog, /fullResetEnabled/u);
  assert.match(resetDialog, /disabled=\{disabled\}/u);
  assert.match(resetDialog, /本机项目目录不会被删除/u);
  assert.doesNotMatch(source, /Agent 父子关系 canonical projection 尚未接入/u);
});
