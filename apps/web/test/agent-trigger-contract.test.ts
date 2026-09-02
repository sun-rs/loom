import assert from "node:assert/strict";
import test from "node:test";
import { readFileSync } from "node:fs";
import {
  RAFT_AVATAR_PREVIEW,
  placePreview,
  permissionRoleLabel,
} from "../src/agent-trigger-contract.ts";

test("Raft avatar call-site timing and collision geometry are frozen, not inferred from pixels", () => {
  assert.deepEqual(RAFT_AVATAR_PREVIEW, {
    delay: 200,
    closeDelay: 120,
    width: 280,
    sideOffset: 6,
    collisionPadding: 6,
  });
  assert.deepEqual(
    placePreview(
      { left: 900, top: 650, bottom: 686 },
      { width: 280, height: 200 },
      { width: 1000, height: 720 },
    ),
    { left: 714, top: 444 },
  );
});
test("permission role cannot display a persona prompt as an authority", () => {
  assert.equal(permissionRoleLabel(undefined), "未获取");
  assert.equal(permissionRoleLabel("member"), "成员");
  assert.equal(permissionRoleLabel("admin"), "管理员");
});

test("workspace hidden-file state uses Raft's distinct eye-off glyph", () => {
  const source = readFileSync(
    new URL("../src/components/agent-workspace-browser.tsx", import.meta.url),
    "utf8",
  );
  const icons = readFileSync(
    new URL(
      "../../../packages/ui-tokens/src/interaction-icons.svg",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(source, /name=\{hidden \? "eye" : "eye-off"\}/);
  assert.match(icons, /id="raft-icon-eye-off"/);
  assert.match(icons, /M14\.084 14\.158a3 3 0 0 1-4\.242-4\.242/);
});

test("Agent activity Room navigation delegates to the canonical deep-link owner", () => {
  const app = readFileSync(new URL("../src/App.tsx", import.meta.url), "utf8");
  assert.match(
    app,
    /openDiscoveryLocation\(\{\s*target: \{ kind: "room", roomId \},/,
    "reset old message/thread focus through the existing navigation owner",
  );
});
