import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import ts from "typescript";
import vm from "node:vm";
function setup() {
  let state,
    effect,
    disposed = false;
  const published = [];
  const react = {
    lazy: () => () => null,
    Suspense: "Suspense",
    createElement: (type, props) => ({ type, props }),
    useState: (initial) => {
      state ??= typeof initial === "function" ? initial() : initial;
      return [
        state,
        (value) => {
          state = typeof value === "function" ? value(state) : value;
          published.push(state);
        },
      ];
    },
    useEffect: (f) => {
      effect = f;
    },
  };
  const exports = {};
  const recovery = {};
  vm.runInNewContext(
    ts.transpileModule(
      readFileSync(
        "frontends/raft/packages/web/src/utils/dynamicImportRecovery.ts",
        "utf8",
      ),
      { compilerOptions: { module: ts.ModuleKind.CommonJS } },
    ).outputText,
    { exports: recovery, Error },
  );
  const js = ts.transpileModule(
    readFileSync("frontends/raft/loom/LazyPages.tsx", "utf8") +
      "\nexport {nativePage};",
    {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        jsx: ts.JsxEmit.ReactJSX,
      },
    },
  ).outputText;
  vm.runInNewContext(js, {
    exports,
    require: (id) =>
      id.endsWith("dynamicImportRecovery.ts")
        ? recovery
        : id.endsWith("PageLoadRecovery.tsx")
          ? { default: "PageLoadRecovery" }
          : id === "react"
            ? react
            : id === "react-intl"
              ? { useIntl: () => ({ formatMessage: () => "加载中…" }) }
              : id === "react/jsx-runtime"
                ? { jsx: (type, props) => ({ type, props }) }
                : null,
  });
  return {
    nativePage: exports.nativePage,
    runEffect: () => effect?.(),
    published,
    reset: () => {
      state = undefined;
    },
  };
}
test("page module is demand-loaded once and rendered immediately on resolution without a timed Suspense fallback", async () => {
  const h = setup();
  let resolve,
    calls = 0;
  const p = new Promise((r) => (resolve = r));
  const Page = () => null,
    View = h.nativePage(() => {
      calls++;
      return p;
    });
  View({ id: "latest" });
  const dispose = h.runEffect();
  assert.equal(calls, 1);
  resolve({ default: Page });
  await p;
  await Promise.resolve();
  const output = View({ id: "latest" }).props.children;
  assert.equal(output.type, Page);
  assert.equal(output.props.id, "latest");
  dispose();
  h.reset();
  assert.equal(View({}).props.children.type, Page);
  assert.equal(calls, 1);
});
test("departed page never publishes its late module completion", async () => {
  const h = setup();
  let resolve;
  const p = new Promise((r) => (resolve = r));
  const View = h.nativePage(() => p);
  View({});
  const dispose = h.runEffect();
  assert.equal(typeof dispose, "function");
  dispose();
  resolve({ default: () => null });
  await p;
  await Promise.resolve();
  assert.equal(h.published.length, 0);
});
test("failed imports reach the existing error boundary instead of an endless loader", async () => {
  const h = setup();
  const failure = new Error("offline");
  const View = h.nativePage(() => Promise.reject(failure));
  View({});
  h.runEffect();
  await Promise.resolve();
  await Promise.resolve();
  assert.throws(() => View({}), /offline/);
});

test("a module resolving between remount and effect still becomes visible", async () => {
  const h = setup();
  let resolve;
  const p = new Promise((r) => (resolve = r)),
    Page = () => null;
  const View = h.nativePage(() => p);
  View({});
  const cleanup = h.runEffect();
  cleanup();
  h.reset();
  View({});
  resolve({ default: Page });
  await p;
  await Promise.resolve();
  h.runEffect();
  assert.equal(View({}).props.children.type, Page);
  assert.equal(h.published.length, 1);
});

test("stale deployed imports render recovery without throwing away the mounted application", async () => {
  const h = setup();
  const failure = new Error(
    "Failed to fetch dynamically imported module: /assets/old.js",
  );
  const View = h.nativePage(() => Promise.reject(failure));
  View({});
  h.runEffect();
  await Promise.resolve();
  await Promise.resolve();
  let output;
  assert.doesNotThrow(() => {
    output = View({});
  });
  assert.equal(output.props.error, failure);
});

test("refresh confirmation is above the search overlay and retains native confirmation", () => {
  const source = readFileSync(
    "frontends/raft/loom/PageLoadRecovery.tsx",
    "utf8",
  );
  assert.match(source, /<ConfirmDialog\s+layer=\{1\}/);
});

test("warming page code shares one import with a later navigation without mounting the page", async () => {
  const h = setup();
  let resolve,
    imports = 0,
    mounts = 0;
  const promise = new Promise((done) => (resolve = done));
  const Page = () => {
    mounts++;
    return null;
  };
  const View = h.nativePage(() => {
    imports++;
    return promise;
  });
  assert.equal(imports, 0);
  const warming = View.preload();
  assert.equal(View.preload(), warming);
  assert.equal(imports, 1);
  View({ id: "current" });
  h.runEffect();
  assert.equal(imports, 1);
  resolve({ default: Page });
  await warming;
  await Promise.resolve();
  assert.equal(mounts, 0);
  assert.equal(View({ id: "current" }).props.children.type, Page);
  h.reset();
  assert.equal(View({}).props.children.type, Page);
});

test("a failed background import remains visible through the existing recovery when navigated", async () => {
  const h = setup();
  const failure = new Error(
    "Failed to fetch dynamically imported module: /assets/old.js",
  );
  const View = h.nativePage(() => Promise.reject(failure));
  await assert.rejects(View.preload(), failure);
  View({});
  h.runEffect();
  await new Promise((done) => setImmediate(done));
  assert.equal(View({}).props.error, failure);
});

test("a transient speculative failure cannot poison a later real navigation", async () => {
  const h = setup();
  const Page = () => null;
  let attempts = 0;
  const View = h.nativePage(() =>
    ++attempts === 1
      ? Promise.reject(new Error("fixture transient transport failure"))
      : Promise.resolve({ default: Page }),
  );
  await assert.rejects(View.preload(), /transient/);
  View({});
  h.runEffect();
  await new Promise((done) => setImmediate(done));
  assert.equal(attempts, 2);
  assert.equal(View({}).props.children.type, Page);
});
