import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("thread and side use current official measured resize instead of viewport fraction", () => {
  for (const name of ["ThreadWorkspace", "SideWorkspace"]) {
    const s = read("loom/" + name + ".tsx");
    assert.match(s, /<CurrentColumnResize/);
    assert.doesNotMatch(s, /getThreadPanelDynamicMax|useResizablePanel/);
  }
});
test("thread focus is host-owned, reversible and does not close or replace conversation", () => {
  assert.match(read("loom/ChannelApp.tsx"), /data-thread-maximized=/);
  assert.match(read("loom/ThreadWorkspace.tsx"), /kind: "focus"/);
  assert.match(read("loom/ThreadFollowMenu.tsx"), /thread-overflow-maximize/);
});
import vm from "node:vm";
import { createHash } from "node:crypto";
function harness() {
  const saved = new Map(),
    events = new Map(),
    previews = [],
    commits = [],
    snaps = [];
  const scope = {
    Map,
    Set,
    console,
    localStorage: {
      getItem: (k) => saved.get(k) ?? null,
      setItem: (k, v) => saved.set(k, v),
      removeItem: (k) => saved.delete(k),
    },
    window: {
      addEventListener: (k, v) => events.set(k, v),
      removeEventListener: (k) => events.delete(k),
    },
  };
  const layout = read("upstream/published-2026-10-26/panel-layout.js").replace(
    /export \{[^}]+\};/,
    "",
  );
  const body = read("upstream/published-2026-10-26/column-resize.js")
    .replace(/^import .*$/gm, "")
    .replace(/export \{[^}]+\};/, "");
  scope.Y = {
    useLayoutEffect: () => {},
    useEffect: () => {},
    useRef: (v) => ({ current: v }),
    useState: (v) => [v, () => {}],
    useId: () => ":test:",
    useSyncExternalStore: (_s, get) => get(),
  };
  scope.X = { jsx: (type, props) => ({ type, props }) };
  scope.W = () => ({ formatMessage: ({ id }) => id });
  vm.createContext(scope);
  vm.runInContext(
    layout + "\n" + body + "\nthis.handle=LF;this.max=oOe;",
    scope,
  );
  const main = {
    getBoundingClientRect: () => ({ width: 800 }),
    parentElement: null,
  };
  const parent = { getBoundingClientRect: () => ({ width: 400 }) };
  const currentTarget = { parentElement: parent, setPointerCapture: () => {} };
  const source = {
    width: 400,
    min: 360,
    get: () => 400,
    preview: (v) => previews.push(v),
    commit: (v) => commits.push(v),
    reset: () => commits.push(400),
  };
  const props = scope.handle({
    column: "thread",
    edge: "left",
    label: "test",
    source,
    mainColumn: () => main,
    snap: {
      kind: "focus",
      snapped: false,
      onSnappedChange: (v) => {
        snaps.push(v);
        return true;
      },
    },
  }).props;
  return { scope, props, events, previews, commits, snaps, currentTarget };
}
test("native resize uses measured main space, keyboard boundaries and reversible focus threshold", () => {
  const h = harness();
  assert.equal(h.scope.max("thread", 400, 800), 840);
  const key = (k) =>
    h.props.onKeyDown({
      key: k,
      currentTarget: h.currentTarget,
      preventDefault() {},
      shiftKey: false,
    });
  key("ArrowLeft");
  key("Home");
  key("End");
  assert.deepEqual(h.commits, [416, 360, 840]);
  h.props.onPointerDown({
    button: 0,
    clientX: 900,
    pointerId: 1,
    currentTarget: h.currentTarget,
    preventDefault() {},
  });
  h.events.get("pointermove")({ pointerId: 1, clientX: 419 });
  assert.deepEqual(h.snaps, [true]);
  assert.equal(h.previews.at(-1), 400);
  h.events.get("pointermove")({ pointerId: 1, clientX: 450 });
  assert.deepEqual(h.snaps, [true, false]);
  h.events.get("pointercancel")({ pointerId: 1 });
  assert.equal(h.events.size, 0);
  h.props.onDoubleClick();
  assert.equal(h.commits.at(-1), 400);
});
test("published resize and layout are pinned; current thread split uses 720px and 360px main minimum", () => {
  const manifest = JSON.parse(
    read("upstream/published-2026-10-26/manifest.json"),
  );
  for (const [entry, file] of [
    ["columnResize", "column-resize.js"],
    ["threadLayout", "thread-layout.css"],
  ])
    assert.equal(
      createHash("sha256")
        .update(read("upstream/published-2026-10-26/" + file))
        .digest("hex"),
      manifest[entry].extractedSha256,
    );
  assert.match(
    read("upstream/published-2026-10-26/thread-layout.css"),
    /max-width:calc\(100% - 360px\)/,
  );
});
test('focus is withheld when the parent channel is not visible or a profile covers it',()=>{
 const s=read('loom/ThreadWorkspace.tsx');
 assert.match(s,/getComputedStyle\(main\)\.display !== "none"/);
 assert.match(s,/if \(!canFocus \|\| !data\?\.thread \|\| covered\) return false/);
 assert.match(s,/canToggleFocus=\{canToggleFocus\}/);
 assert.match(read('loom/ThreadFollowMenu.tsx'),/onToggleFocus && showFocus/);
});
