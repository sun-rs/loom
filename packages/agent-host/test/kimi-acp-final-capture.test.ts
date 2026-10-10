import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  writeFileSync,
  appendFileSync,
  renameSync,
  symlinkSync,
  rmSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  captureKimiWire,
  readKimiWireSuffix,
} from "../src/kimi-acp-final-capture.mjs";
test("wire capture rejects replacement, prefix rewrite, truncation and symlink", () => {
  const d = mkdtempSync(join(tmpdir(), "kimi-final-"));
  try {
    const p = join(d, "wire");
    writeFileSync(p, '{"old":true}\n');
    const b = captureKimiWire(p);
    appendFileSync(p, '{"new":true}\n');
    assert.equal(readKimiWireSuffix(b).suffix, '{"new":true}\n');
    writeFileSync(p, '{"old":evil}\n{"new":true}\n');
    assert.throws(() => readKimiWireSuffix(b));
    writeFileSync(p, "");
    assert.throws(() => readKimiWireSuffix(b));
    renameSync(p, p + ".old");
    writeFileSync(p, '{"old":true}\n');
    assert.throws(() => readKimiWireSuffix(b));
    symlinkSync(p, p + ".link");
    assert.throws(() => captureKimiWire(p + ".link"));
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";

function mutateAtStats(mutate: (call: number) => void, run: () => void) {
  const original = fs.fstatSync;
  let calls = 0;
  fs.fstatSync = ((fd: number) => {
    mutate(++calls);
    return original(fd);
  }) as typeof fs.fstatSync;
  syncBuiltinESMExports();
  try {
    run();
  } finally {
    fs.fstatSync = original;
    syncBuiltinESMExports();
  }
}

test("baseline tolerates bounded append during snapshot but pins every observed prefix", () => {
  const d = mkdtempSync(join(tmpdir(), "kimi-baseline-race-"));
  const p = join(d, "wire");
  try {
    writeFileSync(p, '{"old":true}\n');
    mutateAtStats(
      (call) => {
        if (call === 2 || call === 4) appendFileSync(p, '{"config":true}\n');
      },
      () => {
        const baseline = captureKimiWire(p);
        assert.equal(baseline.offset, fs.statSync(p).size);
        appendFileSync(p, '{"prompt":true}\n');
        assert.equal(readKimiWireSuffix(baseline).suffix, '{"prompt":true}\n');
      },
    );
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("baseline retry rejects rewrite, shrink, replacement and endless append", () => {
  const d = mkdtempSync(join(tmpdir(), "kimi-baseline-negative-"));
  const p = join(d, "wire");
  try {
    for (const mode of [
      "rewrite",
      "shrink",
      "replace",
      "endless",
      "later-prefix",
    ] as const) {
      writeFileSync(p, '{"old":true}\n');
      let calls = 0;
      mutateAtStats(
        (call) => {
          calls = call;
          if (mode === "later-prefix" && call === 5)
            writeFileSync(
              p,
              fs
                .readFileSync(p, "utf8")
                .replace('"config":true', '"config":evil'),
            );
          if (call % 2 !== 0) return;
          if (mode === "endless") appendFileSync(p, '{"config":true}\n');
          else if (call === 2 && mode === "rewrite")
            writeFileSync(p, '{"old":evil}\n');
          else if (call === 2 && mode === "shrink") writeFileSync(p, "");
          else if (call === 2 && mode === "replace") {
            renameSync(p, p + ".old");
            writeFileSync(p, '{"old":true}\n');
          } else if (mode === "later-prefix" && call === 2)
            appendFileSync(p, '{"config":true}\n');
          else if (mode === "later-prefix" && call === 4)
            appendFileSync(p, '{"later":true}\n');
          else if (mode === "later-prefix" && call === 6)
            writeFileSync(
              p,
              fs
                .readFileSync(p, "utf8")
                .replace('"config":true', '"config":evil'),
            );
        },
        () => assert.throws(() => captureKimiWire(p), mode),
      );
      assert.ok(calls <= 6, "bounded three attempts");
      if (mode === "later-prefix")
        assert.equal(calls, 5, "expanded prefix must be pinned on retry");
    }
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("an observed shrink cannot be hidden by restoring the file before retry", () => {
  const d = mkdtempSync(join(tmpdir(), "kimi-shrink-race-"));
  const p = join(d, "wire");
  const body = '{"old":true}\n';
  let calls = 0;
  try {
    writeFileSync(p, body);
    mutateAtStats(
      (call) => {
        calls = call;
        if (call === 2) writeFileSync(p, "");
        if (call === 3) writeFileSync(p, body);
      },
      () => assert.throws(() => captureKimiWire(p)),
    );
    assert.equal(calls, 2, "already observed truncation must not retry");
  } finally {
    rmSync(d, { recursive: true, force: true });
  }
});

test("path identity stat cannot hide an observed same-inode shrink", () => {
  const d = mkdtempSync(join(tmpdir(), "kimi-path-shrink-"));
  const p = join(d, "wire");
  const original = fs.lstatSync;
  try {
    writeFileSync(p, '{"old":true}\n');
    Object.defineProperty(fs, "lstatSync", {
      value: (path: string) => {
        if (path === p) writeFileSync(p, "");
        return original(path);
      },
    });
    syncBuiltinESMExports();
    assert.throws(() => captureKimiWire(p));
  } finally {
    Object.defineProperty(fs, "lstatSync", { value: original });
    syncBuiltinESMExports();
    rmSync(d, { recursive: true, force: true });
  }
});
