import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (n) => readFileSync("frontends/raft/loom/" + n, "utf8");
test("activity uses independent collapse, native sidebar slot and the current rail trigger", () => {
  assert.match(read("sidebar-preference.ts"), /activityListHidden/);
  assert.match(read("SidebarLayout.tsx"), /"activityList"/);
  assert.match(read("DiscoveryPage.tsx"), /ActivityListSlot/);
  assert.match(
    read("DiscoveryPage.tsx"),
    /relative flex min-w-0 flex-1 bg-layer-canvas/,
  );
  assert.match(read("DiscoveryPage.tsx"), /data-testid="activity-main-host"/);
  assert.match(
    read("DiscoveryPage.tsx"),
    /<AppShellMainSlot className="bg-layer-canvas">/,
  );
  assert.match(read("DiscoveryPage.tsx"), /activityCollapseSnap/);
  assert.match(read("Navigation.tsx"), /CurrentSidebarToggle/);
});
import vm from "node:vm";
import { createHash } from "node:crypto";
import { extractDeclaration } from "./generate-navigation-leaves.mjs";
test("official collapse changes only the selected column and restores focus before hiding", () => {
  const source = read("CurrentSidebarToggle.generated.js");
  const manifest = JSON.parse(
    readFileSync(
      "frontends/raft/upstream/published-2026-10-26/activity-collapse-manifest.json",
      "utf8",
    ),
  );
  for (const { name, sha256 } of manifest.declarations)
    assert.equal(
      createHash("sha256")
        .update(extractDeclaration(source, name))
        .digest("hex"),
      sha256,
    );
  const events = [];
  const state = {
    sidebarHidden: false,
    activityListHidden: false,
    setSidebarHidden(v) {
      state.sidebarHidden = v;
      events.push("sidebar:" + v);
    },
    setActivityListHidden(v) {
      state.activityListHidden = v;
      events.push("activity:" + v);
    },
  };
  const focus = {};
  const doc = {
    activeElement: focus,
    getElementById(id) {
      return id === "app-sidebar"
        ? { contains: (e) => e === focus }
        : { focus: () => events.push("focus") };
    },
  };
  const context = { _E: { getState: () => state }, document: doc };
  vm.createContext(context);
  vm.runInContext(
    "const p$='app-sidebar',m$='app-sidebar-toggle';\n" +
      ["SKe", "h$", "CKe", "_$"]
        .map((n) => extractDeclaration(source, n))
        .join("\n") +
      "\nthis.toggle=CKe;",
    context,
  );
  context.toggle(doc, "activityList");
  assert.deepEqual(events, ["focus", "activity:true"]);
  assert.equal(state.sidebarHidden, false);
  context.toggle(doc, "activityList");
  assert.equal(state.activityListHidden, false);
  assert.deepEqual(events, ["focus", "activity:true", "activity:false"]);
  context.toggle(doc, "sidebar");
  assert.equal(state.sidebarHidden, true);
  assert.equal(state.activityListHidden, false);
});
