import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const root = path.dirname(fileURLToPath(import.meta.url));
const read = (relative: string) =>
  readFileSync(path.resolve(root, relative), "utf8");

test("Room page consumes the internal UI contract and one canonical projection", () => {
  const page = read("./room/RoomPage.tsx");
  assert.match(page, /RoomProjectionController/);
  assert.match(page, /NeoTabs/);
  assert.match(page, /NeoEmptyState/);
  assert.match(page, /AgentAvatar/);
  assert.match(page, /roomTaskWorkflowStatus/);
  assert.match(page, /basedOnRoomSeq: (props\.)?state\.observedRoomSeq/);
  assert.doesNotMatch(
    page,
    /basedOnRoomSeq: (props\.)?state\.canonicalHeadSeq/,
  );
  assert.doesNotMatch(page, /rah_os|raft-ui|raft_ui/);
  assert.equal((page.match(/role="alert"/g) ?? []).length, 1);
  assert.doesNotMatch(page, /<option value="">Unassigned<\/option>/);
  assert.match(page, /agents\.length < 2/);
});

test("Room visual protocol declares bounded dividers and complete control states", () => {
  const page = read("./room/RoomPage.tsx");
  const css = read("./room-ui/room-neo.css");
  assert.match(page, /initial:\s*320,\s*min:\s*240,\s*max:\s*480/);
  assert.match(page, /initial:\s*380,\s*min:\s*300,\s*max:\s*640/);
  assert.match(page, /onKeyDown=\{directoryResize\.onKeyDown\}/);
  assert.match(page, /onKeyDown=\{profileResize\.onKeyDown\}/);
  assert.match(page, /onPointerCancel=\{directoryResize\.onPointerCancel\}/);
  assert.match(
    page,
    /onLostPointerCapture=\{directoryResize\.onLostPointerCapture\}/,
  );
  assert.match(page, /onPointerCancel=\{profileResize\.onPointerCancel\}/);
  assert.match(
    page,
    /onLostPointerCapture=\{profileResize\.onLostPointerCapture\}/,
  );
  assert.doesNotMatch(page, /<div style=\{\{ "--room-profile-width"/);
  for (const selector of [
    ":hover",
    ":focus-visible",
    ":disabled",
    "aria-selected",
    "max-width: 767px",
  ]) {
    assert.ok(css.includes(selector), `missing state contract ${selector}`);
  }
  assert.match(css, /\.room-scroll[^}]*overflow-x:\s*auto/);
  assert.match(css, /\.room-task-card h4[^}]*overflow-wrap:\s*anywhere/);
  for (const token of [
    "--room-yellow",
    "--room-pink",
    "--room-line",
    "--room-shadow",
  ]) {
    assert.ok(css.includes(token), `missing UI token ${token}`);
  }
});

test("Room tabs expose roving focus and the complete keyboard contract", () => {
  const primitives = read("./room-ui/NeoPrimitives.tsx");
  assert.match(primitives, /tabIndex=\{selected \? 0 : -1\}/);
  for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
    assert.ok(primitives.includes(`\"${key}\"`), `missing tab key ${key}`);
  }
});

test("Room navigation is lazy and switching page ownership closes prior inspectors", () => {
  const lazy = read("./app-lazy-components.ts");
  const controller = read("./hooks/useWorkbenchPageController.ts");
  assert.match(lazy, /import\("\.\/room\/RoomPage"\)/);
  assert.match(controller, /setMode\("room"\)/);
  assert.match(controller, /openRooms[\s\S]*closeRightPanels/);
});

test("pre-granted notifications still register the durable click target worker", () => {
  const notifications = read("./browser-notifications.ts");
  assert.match(
    notifications,
    /permission === "granted"[\s\S]*ensureRahNotificationServiceWorker/,
  );
  assert.match(
    notifications,
    /URLSearchParams\(\{ surface: "room", roomId: item\.roomId \}\)/,
  );
});

test("Room presentation acknowledgement is exact for Chat and Tasks", () => {
  const page = read("./room/RoomPage.tsx");
  assert.match(page, /documentVisibility !== "visible"/);
  assert.match(page, /!documentFocused/);
  assert.match(page, /state\.observedRoomSeq !== state\.canonicalHeadSeq/);
  assert.match(page, /tab === "chat" && !chatAtLatestEdge/);
  assert.match(page, /tab === "chat" && state\.viewingOlderMessages/);
  assert.match(page, /tab === "members"/);
  assert.match(page, /item\.aggregateType === "message"/);
  assert.match(page, /typeof item\.taskId === "string"/);
  assert.match(page, /presentedTaskIds\.has\(item\.taskId\)/);
  assert.match(page, /entry\.intersectionRatio >= 0\.5/);
  assert.match(page, /threshold: 0\.5/);
});

test("Room Task cards keep frozen evidence behind an explicit disclosure", () => {
  const page = read("./room/RoomPage.tsx");
  assert.match(page, /<details className="room-task-delivery">/);
  assert.match(page, /Delivery #\{submission\.submissionNumber\}/);
  assert.match(page, /className="room-task-delivery__detail"/);
  assert.doesNotMatch(page, /<div className="room-task-delivery">/);
});
