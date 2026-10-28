import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function setup({
  mobile = true,
  touch = false,
  hidden = false,
  saveData = false,
  effectiveType = "4g",
  idle = true,
} = {}) {
  const calls = [],
    scheduled = new Map();
  const window = {
    matchMedia: (query) => ({
      matches: query === "fixture touch density" ? mobile || touch : mobile,
    }),
    setTimeout: (f) => {
      scheduled.set(1, f);
      return 1;
    },
    clearTimeout: (id) => scheduled.delete(id),
    ...(idle
      ? {
          requestIdleCallback: (f) => {
            scheduled.set(1, f);
            return 1;
          },
          cancelIdleCallback: (id) => scheduled.delete(id),
        }
      : {}),
  };
  const document = { hidden };
  const pages = Object.fromEntries(
    ["Settings", "Agent", "Tasks", "Memory", "Discovery", "Computers"].map(
      (name) => [
        `Lazy${name}Page`,
        {
          preload: () => {
            calls.push(name);
            return Promise.resolve();
          },
        },
      ],
    ),
  );
  const exports = {};
  const js = ts.transpileModule(
    readFileSync("frontends/raft/loom/page-preload.ts", "utf8"),
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
      },
    },
  ).outputText;
  vm.runInNewContext(js, {
    exports,
    window,
    document,
    navigator: { connection: { saveData, effectiveType } },
    require: (id) =>
      id.includes("LazyPages")
        ? pages
        : {
            layoutQueries: {
              single: "fixture mobile query",
              compactDensity: "fixture touch density",
            },
          },
  });
  return {
    ...exports,
    calls,
    document,
    pages,
    fire: () => {
      const f = scheduled.get(1);
      scheduled.delete(1);
      f?.();
    },
  };
}

test("mobile idle warming is bounded to the two primary page modules and cancellation prevents work", () => {
  const h = setup();
  const cancel = h.scheduleMobilePageWarmup();
  assert.deepEqual(h.calls, []);
  cancel();
  h.fire();
  assert.deepEqual(h.calls, []);
  h.scheduleMobilePageWarmup();
  h.fire();
  assert.deepEqual(h.calls, ["Discovery", "Tasks"]);
});

test("wide touch foldables retain mobile warming without changing wide mouse desktops", () => {
  const h = setup({ mobile: false, touch: true });
  h.scheduleMobilePageWarmup();
  h.fire();
  assert.deepEqual(h.calls, ["Discovery", "Tasks"]);
});

test("wide touch rail intent does not replace the official drag pointer listener", () => {
  const source = readFileSync("frontends/raft/loom/Navigation.tsx", "utf8");
  const rail = source.slice(
    source.indexOf("<RailTabButton"),
    source.indexOf("  const tabs = mobilePrimaryDestinations"),
  );
  assert.match(rail, /onPointerDownCapture=/);
  assert.doesNotMatch(rail, /\bonPointerDown=/);
  assert.match(rail, /binding\?\.dragProps/);
});

test("desktop, hidden and data-saving connections perform no speculative work", () => {
  for (const policy of [
    { mobile: false },
    { hidden: true },
    { saveData: true },
    { effectiveType: "2g" },
    { effectiveType: "slow-2g" },
  ]) {
    const h = setup(policy);
    h.scheduleMobilePageWarmup();
    h.preloadMorePages();
    h.preloadDestination("tasks");
    h.fire();
    assert.deepEqual(h.calls, [], JSON.stringify(policy));
  }
});

test("navigation intent warms only its destination and More warms only its four entries", async () => {
  const h = setup();
  h.preloadDestination("settings");
  h.preloadDestination("channels");
  assert.deepEqual(h.calls, ["Settings"]);
  h.calls.length = 0;
  h.preloadMorePages();
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(h.calls, ["Agent", "Computers", "Settings", "Memory"]);
});

test("More warms one module at a time and closing it cancels the remaining speculative work", async () => {
  const h = setup();
  let resolve;
  h.pages.LazyAgentPage.preload = () => {
    h.calls.push("Agent");
    return new Promise((done) => (resolve = done));
  };
  const cancel = h.preloadMorePages();
  assert.deepEqual(h.calls, ["Agent"]);
  cancel();
  resolve();
  await new Promise((done) => setImmediate(done));
  assert.deepEqual(h.calls, ["Agent"]);
});

test("hidden-after-scheduling and failed speculative loads do not publish or reject globally", async () => {
  const h = setup({ idle: false });
  h.scheduleMobilePageWarmup();
  h.document.hidden = true;
  h.fire();
  assert.deepEqual(h.calls, []);
  h.document.hidden = false;
  h.pages.LazyTasksPage.preload = () =>
    Promise.reject(new Error("fixture offline"));
  h.preloadDestination("tasks");
  await Promise.resolve();
});
