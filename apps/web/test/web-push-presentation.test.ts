import assert from "node:assert/strict";
import test from "node:test";
import type { BrowserPushStatus } from "../src/web-push-client.ts";
import { pushSettingsPresentation } from "../src/web-push-presentation.ts";

const state: BrowserPushStatus = {
  browserSubscribed: false,
  permission: "default" as const,
  supported: true,
};
test("unknown and failed Push reads never imply unsupported iOS or zero devices", () => {
  for (const ios of [false, true]) {
    const loading = pushSettingsPresentation({
      desired: true,
      checking: true,
      ios,
    });
    assert.equal(loading.label, "正在检查");
    assert.equal(loading.hint, undefined);
    assert.equal(loading.subscription, "未知");
    assert.equal(loading.deviceCount, "未知");
    const failed = pushSettingsPresentation({
      desired: true,
      checking: false,
      error: "Error retrieving push subscription",
      ios,
    });
    assert.equal(failed.label, "无法检查");
    assert.equal(failed.hint, undefined);
  }
});
test("Push availability, permission and explicit device opt-out remain distinct", () => {
  const view = (status: typeof state, extra = {}) =>
    pushSettingsPresentation({
      desired: true,
      checking: false,
      ios: false,
      status,
      ...extra,
    });
  assert.equal(view(state).label, "未决定");
  assert.equal(view({ ...state, permission: "denied" }).label, "已拒绝");
  assert.equal(
    view({ ...state, permission: "granted", browserSubscribed: true }).label,
    "已启用",
  );
  assert.equal(view(state, { desired: false }).label, "已停用");
  assert.equal(view({ ...state, permission: "granted" }).label, "未订阅");
  assert.equal(view({ ...state, supported: false }).label, "不可用");
  assert.equal(
    view({ ...state, supported: false }).hint,
    "本机服务尚未配置推送通知。",
  );
  const unsupported: BrowserPushStatus = {
    ...state,
    supported: false,
    permission: "unsupported",
  };
  assert.equal(view(unsupported).label, "不支持");
  assert.doesNotMatch(view(unsupported).hint!, /iPhone|iPad/);
  assert.match(view(unsupported, { ios: true }).hint!, /iPhone\/iPad/);
});
