import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { createHash } from "node:crypto";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
const read = (n) => readFileSync("frontends/raft/loom/" + n, "utf8");
test("official mobile swipe arbitrates edge/scroll, distance and fling without a page-back gesture", () => {
  const s = read("OfficialActivitySwipe.generated.js");
  const context = {};
  vm.createContext(context);
  vm.runInContext(
    ["Lt", "Rt", "zt"].map((n) => extractDeclaration(s, n)).join("\n") +
      ";this.decide=Lt;this.full=Rt;this.settle=zt;",
    context,
  );
  assert.equal(context.decide(-80, 1, true), "release");
  assert.equal(context.decide(-10, 40), "release");
  assert.equal(context.decide(-19, 0), "undecided");
  assert.equal(context.decide(-40, 5), "claim");
  assert.equal(context.decide(40, 0), "release");
  assert.equal(context.full(233, 390), false);
  assert.equal(context.full(234, 390), true);
  assert.equal(context.settle(234, 0, 390, 72), "full");
  assert.equal(context.settle(35, 0, 390, 72), "close");
  assert.equal(context.settle(36, 0, 390, 72), "open");
  assert.equal(context.settle(10, 800, 390, 72), "open");
  const m = JSON.parse(
    readFileSync(
      "frontends/raft/upstream/published-2026-10-26/activity-swipe-manifest.json",
      "utf8",
    ),
  );
  for (const { name, sha256 } of m.declarations)
    assert.equal(
      createHash("sha256").update(extractDeclaration(s, name)).digest("hex"),
      sha256,
    );
});
test("row gesture uses the existing durable action and is limited to touch narrow screens", () => {
  assert.match(read("ActivityMessageRow.tsx"), /useOfficialRowSwipe/);
  assert.match(read("ActivityMessageRow.tsx"), /onFullSwipe: done/);
  assert.match(read("ActivityMessageRow.tsx"), /swipeDoneClass/);
  assert.match(read("useActivitySwipe.ts"), /\(pointer: coarse\)/);
  assert.match(read("useActivitySwipe.ts"), /max-width: 767px/);
  assert.match(read("DiscoveryPage.tsx"), /useActivitySwipe/);
});
test("native touch handlers cancel safely, suppress post-swipe click and commit full swipe once", () => {
  const source = read("OfficialActivitySwipe.generated.js")
    .replace(/^import .*$/gm, "")
    .replace(/export \{[^}]+\};/, "");
  function setup() {
    const timers = new Map(),
      cleanups = [],
      changes = [];
    let count = 0,
      tid = 0;
    const scope = {
      q: {
        useRef: (v) => ({ current: v }),
        useCallback: (fn) => fn,
        useEffect: (fn) => {
          const clean = fn();
          if (clean) cleanups.push(clean);
        },
      },
      _t: { flushSync: (fn) => fn() },
      window: {
        matchMedia: () => ({ matches: false }),
        setTimeout: (fn) => {
          timers.set(++tid, fn);
          return tid;
        },
        clearTimeout: (id) => timers.delete(id),
      },
      navigator: {},
      Element: class {},
      Date,
    };
    vm.createContext(scope);
    vm.runInContext(source + "\nthis.hook=Ht;", scope);
    const hook = scope.hook({
      enabled: true,
      actionsWidth: 72,
      open: false,
      onOpenChange: (v) => changes.push(v),
      onFullSwipe: () => count++,
    });
    const attributes = new Map();
    const element = {
      getBoundingClientRect: () => ({ left: 0, right: 390, width: 390 }),
      setPointerCapture() {},
      style: { setProperty: (k, v) => attributes.set(k, v) },
      setAttribute: (k, v) => attributes.set(k, v),
      removeAttribute: (k) => attributes.delete(k),
    };
    hook.ref(element);
    const event = (x, y = 0, type = "touch") => ({
      currentTarget: element,
      target: element,
      pointerType: type,
      isPrimary: true,
      pointerId: 1,
      clientX: x,
      clientY: y,
      timeStamp: 400 - x,
    });
    return {
      hook,
      element,
      attributes,
      event,
      changes,
      cleanups,
      timers,
      count: () => count,
      flush() {
        for (const [id, fn] of [...timers]) {
          timers.delete(id);
          fn();
        }
      },
    };
  }
  const a = setup();
  a.hook.handlers.onPointerDown(a.event(300, 0, "mouse"));
  a.hook.handlers.onPointerMove(a.event(0));
  a.hook.handlers.onPointerUp(a.event(0));
  a.flush();
  assert.equal(a.count(), 0);
  a.hook.handlers.onPointerDown(a.event(300));
  a.hook.handlers.onPointerMove(a.event(260));
  a.hook.handlers.onPointerMove(a.event(0));
  a.hook.handlers.onPointerCancel(a.event(0));
  a.flush();
  assert.equal(a.count(), 0);
  assert.equal(a.attributes.get("--row-swipe-reveal"), "0px");
  const b = setup();
  b.hook.handlers.onPointerDown(b.event(300));
  b.hook.handlers.onPointerMove(b.event(260));
  b.hook.handlers.onPointerMove(b.event(0));
  b.hook.handlers.onPointerUp(b.event(0));
  assert.equal(b.count(), 0);
  b.flush();
  assert.equal(b.count(), 1);
  for (const fn of b.cleanups) fn();
  assert.equal(b.count(), 1);
  let prevented = 0;
  b.hook.handlers.onClickCapture({
    preventDefault: () => prevented++,
    stopPropagation: () => prevented++,
  });
  assert.equal(prevented, 2);
});
