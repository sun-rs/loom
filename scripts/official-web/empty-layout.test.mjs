import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import ts from "typescript";

function load(file) {
  const exports = {};
  const stub = new Proxy(
    { __esModule: true },
    { get: (value, key) => value[key] ?? key },
  );
  const react = {
    useState: (value) => [
      typeof value === "function" ? value() : value,
      () => {},
    ],
    useEffect: () => {},
    useRef: () => ({ current: null }),
  };
  vm.runInNewContext(
    ts.transpileModule(readFileSync("frontends/raft/loom/" + file, "utf8"), {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        jsx: ts.JsxEmit.ReactJSX,
      },
    }).outputText,
    {
      exports,
      window: { matchMedia: () => ({ matches: false }) },
      require: (id) =>
        id === "react"
          ? react
          : id === "react/jsx-runtime"
            ? {
                jsx: (type, props) => ({ type, props }),
                jsxs: (type, props) => ({ type, props }),
              }
            : id.includes("MobilePageNavigation")
              ? { useMobilePageBack: () => undefined }
              : stub,
    },
  );
  return exports;
}

test("empty sidebar body allocates remaining height while populated lists retain ordinary scrolling", () => {
  const Frame = load("ChatSidebarFrame.tsx").default;
  const props = {
    title: "Fixture",
    testIdPrefix: "fixture",
    scrollTestId: "body",
  };
  for (const fillContent of [false, true]) {
    const body = Frame({ ...props, fillContent }).props.children.find(
      (n) => n?.props?.["data-testid"] === "body",
    );
    assert.ok(body.props.className.includes("min-h-0 flex-1"));
    assert.equal(body.props.className.includes("flex flex-col"), fillContent);
  }
});

test("empty context-menu surface fills remaining body without a full-height minimum that displaces headers", () => {
  const Menu = load("SidebarMenus.tsx").SidebarContextMenu;
  const trigger = Menu({ surface: true, fillContent: true, items: [] }).props
    .children[0];
  assert.match(trigger.props.className, /flex.*min-h-0.*flex-1.*flex-col/);
  assert.doesNotMatch(trigger.props.className, /min-h-full/);
  assert.equal(typeof trigger.props.onContextMenu, "function");
});

test("ordinary row and nonempty blank-space menus preserve their native layout", () => {
  const Menu = load("SidebarMenus.tsx").SidebarContextMenu;
  assert.equal(
    Menu({ surface: false, fillContent: true, items: [] }).props.children[0]
      .props.className,
    "min-w-0 flex-1",
  );
  assert.equal(
    Menu({ surface: true, items: [] }).props.children[0].props.className,
    "min-h-full min-w-0",
  );
});

test("whole mobile list empty states do not position themselves with a fixed top-padding substitute", () => {
  for (const file of ["ChannelSidebar.tsx", "RoleWorkspace.tsx"]) {
    const source = ts.createSourceFile(
      file,
      readFileSync("frontends/raft/loom/" + file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    let checked = 0;
    function visit(node) {
      if (
        (ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) &&
        node.tagName.getText(source) === "PageEmpty"
      ) {
        checked++;
        for (const attr of node.attributes.properties)
          if (
            ts.isJsxAttribute(attr) &&
            attr.name.getText(source) === "className"
          )
            assert.doesNotMatch(
              attr.initializer.getText(source),
              /\bpy-\d/,
              file,
            );
      }
      ts.forEachChild(node, visit);
    }
    visit(source);
    assert.ok(checked, file);
  }
});

test("unselected desktop conversation has no extra header while mobile retains its back path", () => {
  const source = readFileSync("frontends/raft/loom/ChannelApp.tsx", "utf8");
  const emptyHeader = source.slice(
    source.indexOf("{!savedOpen && !selected && ("),
    source.indexOf(
      "{privateNotice}",
      source.indexOf("{!savedOpen && !selected && ("),
    ),
  );
  assert.match(emptyHeader, /containerProps=\{\{ className: "md:hidden" \}\}/);
  assert.match(emptyHeader, /onMobileBack=\{showChatList\}/);
});
