import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { uiActionProps } from "../../frontends/raft/loom/ui-action-props.ts";
test("scenario bindings use native parameters without a parallel geometry or component recipe", () => {
  assert.deepEqual(uiActionProps.formSave, {
    size: "md",
    variant: "accent",
    "data-loom-action": "formSave",
  });
  assert.deepEqual(uiActionProps.confirmDelete, {
    size: "sm",
    variant: "danger",
    "data-loom-action": "confirmDelete",
  });
  assert.deepEqual(uiActionProps.menuIcon, {
    size: "icon-sm",
    variant: "ghost",
    "data-loom-action": "menuIcon",
  });
  for (const binding of Object.values(uiActionProps))
    assert.deepEqual(Object.keys(binding).sort(), [
      "data-loom-action",
      "size",
      "variant",
    ]);
  const source = readFileSync(
    "frontends/raft/packages/web/src/components/ConfirmDialog.tsx",
    "utf8",
  );
  assert.ok(source.includes('actionSize = "sm"'));
  assert.ok(source.includes('variant="outline"'));
  assert.ok(source.includes('?? "danger"'));
  const agent = readFileSync(
    "frontends/raft/packages/web/src/components/agent/AgentDetailPanel.tsx",
    "utf8",
  );
  assert.ok(agent.includes('<Button variant="accent" size="md"'));
});
test("save and destructive actions opt into explicit native scenario bindings", () => {
  for (const [file, key] of [
    ["RoleEditor.tsx", "formSave"],
    ["MemoryEditor.tsx", "formSave"],
    ["MemoryPolicyDialog.tsx", "formSave"],
    ["TaskPermissionDialog.tsx", "formSave"],
    ["AgentPage.tsx", "confirmDelete"],
    ["ChannelSidebar.tsx", "confirmDelete"],
    ["ManagementUi.tsx", "menuIcon"],
  ]) {
    assert.ok(
      readFileSync("frontends/raft/loom/" + file, "utf8").includes(
        "uiActionProps." + key,
      ),
      file,
    );
  }
});

test("all action bindings have upstream provenance and cannot be overridden locally", async () => {
  const { readdirSync, existsSync } = await import("node:fs");
  const { default: ts } = await import("typescript");
  const base = "frontends/raft/loom/";
  const registry = JSON.parse(
    readFileSync(base + "ui-contract.json", "utf8"),
  ).actionBindings;
  assert.deepEqual(
    Object.keys(registry).sort(),
    Object.keys(uiActionProps).sort(),
  );
  for (const entry of Object.values(registry) as { source: string }[])
    assert.ok(existsSync(entry.source));
  let count = 0;
  for (const file of readdirSync(base).filter((f) => f.endsWith(".tsx"))) {
    const sf = ts.createSourceFile(
      file,
      readFileSync(base + file, "utf8"),
      ts.ScriptTarget.Latest,
      true,
      ts.ScriptKind.TSX,
    );
    assert.equal(sf.parseDiagnostics.length, 0, file);
    function walk(n: import("typescript").Node) {
      if (ts.isJsxOpeningElement(n) || ts.isJsxSelfClosingElement(n)) {
        const attrs = n.attributes.properties;
        const bindings = attrs
          .filter(ts.isJsxSpreadAttribute)
          .filter((a) => a.expression.getText(sf).includes("uiActionProps."));
        if (bindings.length) {
          count++;
          assert.equal(n.tagName.getText(sf), "Button", file);
          assert.ok(
            !attrs.some(
              (a) =>
                ts.isJsxAttribute(a) &&
                ["size", "variant", "style"].includes(a.name.getText(sf)),
            ),
            file + " overrides native binding",
          );
          for (const binding of bindings)
            for (const match of binding.expression
              .getText(sf)
              .matchAll(/uiActionProps\.(\w+)/g))
              assert.ok(registry[match[1]], file);
        }
      }
      ts.forEachChild(n, walk);
    }
    walk(sf);
  }
  assert.ok(count > 0);
});
