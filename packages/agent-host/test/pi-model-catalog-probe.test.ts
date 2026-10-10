import assert from "node:assert/strict";
import { mkdtempSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import {
  parsePiModelCatalog,
  probePiModelCatalog,
} from "../src/pi-model-catalog-probe.ts";

const model = {
  id: "some/model",
  provider: "configured",
  name: "Configured model",
  reasoning: true,
  apiKey: "SECRET",
  headers: { Authorization: "SECRET" },
};
function frames(levels: unknown = ["off", "low", "high"], selected = model) {
  return (
    [
      {
        id: "catalog",
        command: "get_available_models",
        data: { models: [model, { id: "unselected", provider: "other" }] },
      },
      {
        id: "state",
        command: "get_state",
        data: {
          model: selected,
          thinkingLevel: "low",
          isStreaming: false,
          isCompacting: false,
          messageCount: 0,
          pendingMessageCount: 0,
        },
      },
      {
        id: "levels",
        command: "get_available_thinking_levels",
        data: { levels },
      },
    ]
      .map((x) => JSON.stringify({ type: "response", success: true, ...x }))
      .join("\n") + "\n"
  );
}
test("Pi publishes only current exact configured model with native effort evidence, without secret fields", () => {
  const bindings = parsePiModelCatalog(frames());
  assert.equal(bindings.length, 1);
  assert.equal(
    bindings[0]?.modelBindingId,
    "local:pi-cli/v1:configured/some/model",
  );
  assert.deepEqual(bindings[0]?.supportedReasoning, ["off", "low", "high"]);
  assert.equal(bindings[0]?.defaultReasoning, "low");
  assert.ok(!JSON.stringify(bindings).includes("SECRET"));
});
test("Pi rejects unproved model or effort and duplicate response identities", () => {
  assert.deepEqual(parsePiModelCatalog(frames(["default"])), []);
  assert.deepEqual(parsePiModelCatalog(frames([null])), []);
  assert.deepEqual(parsePiModelCatalog(frames(["bad level"])), []);
  assert.deepEqual(
    parsePiModelCatalog(frames(["low", "native-new-level"]))[0]
      ?.supportedReasoning,
    ["low", "native-new-level"],
  );
  assert.deepEqual(
    parsePiModelCatalog(frames([], { ...model, id: "not-available" })),
    [],
  );
  assert.deepEqual(parsePiModelCatalog(frames() + frames()), []);
  assert.deepEqual(
    parsePiModelCatalog(
      frames().replace('"messageCount":0', '"messageCount":1'),
    ),
    [],
  );
});
async function fake(script: string) {
  const directory = mkdtempSync(join(tmpdir(), "loom-pi-catalog-"));
  const executablePath = join(directory, "pi");
  writeFileSync(executablePath, `#!/usr/bin/env node\n${script}`);
  chmodSync(executablePath, 0o700);
  return {
    cwd: directory,
    executablePath,
    cleanup: () => rmSync(directory, { recursive: true, force: true }),
  };
}
test("Pi offline probe sends only read-only catalog RPCs and preserves configured provider environment", async () => {
  const f = await fake(
    `let input='';process.stdin.on('data',b=>input+=b);process.stdin.on('end',()=>{const a=process.argv.slice(2);for(const flag of ['--offline','--no-session','--no-extensions','--no-skills','--no-context-files','--no-prompt-templates','--no-mcp','--no-approve'])if(!a.includes(flag))process.exit(2);if(a.includes('--model')||a.includes('--provider'))process.exit(3);const q=input.trim().split('\\n').map(JSON.parse);if(JSON.stringify(q.map(x=>x.type))!==JSON.stringify(['get_available_models','get_state','get_available_thinking_levels']))process.exit(4);process.stdout.write(${JSON.stringify(frames())});});`,
  );
  try {
    assert.equal((await probePiModelCatalog(f)).length, 1);
  } finally {
    f.cleanup();
  }
});
test("Pi timeout and oversized catalog terminate and fail closed", async () => {
  for (const script of [
    "setInterval(()=>{},1000)",
    "process.stdout.write('x'.repeat(4*1024*1024+1));setInterval(()=>{},1000)",
  ]) {
    const f = await fake(script);
    try {
      await assert.rejects(probePiModelCatalog({ ...f, timeoutMs: 200 }));
    } finally {
      f.cleanup();
    }
  }
});

test("Pi streaming catalog preserves UTF-8 names across pipe chunks", async () => {
  const text = frames().replaceAll("Configured model", "模型");
  const f = await fake(
    `const b=Buffer.from(${JSON.stringify(text)});const i=b.indexOf(Buffer.from('模'))+1;process.stdin.resume();process.stdout.write(b.subarray(0,i));setTimeout(()=>{process.stdout.write(b.subarray(i));},30);`,
  );
  try {
    assert.equal((await probePiModelCatalog(f))[0]?.displayName, "模型");
  } finally {
    f.cleanup();
  }
});
