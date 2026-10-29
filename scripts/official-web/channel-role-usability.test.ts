import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import {
  buildRoleConfiguration,
  roleModelLabel,
} from "../../packages/client-core/src/role-form.ts";
import { AgentDefinitionRevisionSchema } from "@rah-os/protocol";
const read = (name: string) =>
  readFileSync("frontends/raft/loom/" + name, "utf8");
test("empty optional Role prompt survives form validation without manufactured instructions", () => {
  const result = buildRoleConfiguration(
    {
      displayName: "Tom",
      handle: "tom",
      role: "Tom",
      instructions: "  ",
      modelBindingId: "local:agy-cli/v1:gemini-low",
      runtimeOfferId: "offer",
      reasoning: "low",
    },
    [
      {
        runtimeOfferId: "offer",
        label: "AGY",
        bindings: [
          {
            label: "Gemini Low",
            modelBindingId: "local:agy-cli/v1:gemini-low",
            reasoning: ["low"],
          },
        ],
      },
    ],
  );
  assert.equal(result.ok, true);
  if (result.ok) assert.equal(result.value.instructions, "");
  assert.equal(
    AgentDefinitionRevisionSchema.shape.instructions.safeParse("").success,
    true,
  );
  for (const file of ["RoleEditor.tsx", "RoleFieldEditor.tsx"])
    assert.doesNotMatch(
      read(file),
      /aria-label="提示词"[\s\S]{0,150}\brequired\b/,
    );
});
test("model display removes transport prefix but preserves provider and opaque binding value", () => {
  const b = {
    label: "local:opencode-cli/v1:deepseek/deepseek-flash",
    modelBindingId: "local:opencode-cli/v1:deepseek/deepseek-flash",
    reasoning: ["low"],
  };
  assert.equal(roleModelLabel(b, [b]), "deepseek/deepseek-flash");
  assert.equal(
    b.modelBindingId,
    "local:opencode-cli/v1:deepseek/deepseek-flash",
  );
});
test("single-Human product omits Role filter and Channel visibility badges, retaining private-box boundaries", () => {
  assert.doesNotMatch(read("RoleWorkspace.tsx"), /筛选角色/);
  assert.doesNotMatch(read("ChannelControl.tsx"), /room\.visibility/);
});
test("Channel creation uses folder tree, description and optional Role members", () => {
  const source = read("CreateChannelDialog.tsx");
  assert.match(source, /ComputerFiles/);
  assert.match(source, /foldersOnly/);
  assert.match(source, /OfficialCreateChannelFields/);
  assert.match(source, /manager\.instance/);
  assert.doesNotMatch(read("ChannelSidebar.tsx"), /每行一个绝对路径/);
  const files = read("ComputerFiles.tsx");
  assert.match(files, /foldersOnly/);
  assert.match(files, /\.filter\([^\n]*isDirectory/);
});
test("fixed effort models retain published value without a redundant effort picker", () => {
  assert.match(
    read("RoleRuntimeFields.tsx"),
    /\(selectedModel\?\.reasoning\.length \?\? 0\) > 1/,
  );
});
test("Channel form generation preserves acquired source and explicit unsupported slots", async () => {
  const { generateChannelCreate } =
    await import("./generate-channel-create.mjs");
  const { createHash } = await import("node:crypto");
  const path = "frontends/raft/upstream/channel-create-2026-10-29/";
  const provenance = JSON.parse(readFileSync(path + "provenance.json", "utf8"));
  assert.equal(
    createHash("sha256")
      .update(readFileSync(path + "CreateChannelDialog.tsx"))
      .digest("hex"),
    provenance.sha256,
  );
  assert.equal(
    createHash("sha256")
      .update(readFileSync(path + "memberPickerClasses.ts"))
      .digest("hex"),
    provenance.companionSha256,
  );
  assert.equal(
    read("OfficialCreateChannelFields.generated.tsx"),
    generateChannelCreate(),
  );
  assert.doesNotMatch(
    read("OfficialCreateChannelFields.generated.tsx"),
    /setVisibility|SegmentedControl/,
  );
});
