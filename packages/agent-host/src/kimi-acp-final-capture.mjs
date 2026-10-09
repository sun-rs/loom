import { createHash } from "node:crypto";
import {
  openSync,
  closeSync,
  readSync,
  fstatSync,
  lstatSync,
  constants,
  existsSync,
  writeFileSync,
} from "node:fs";
import { dirname, isAbsolute } from "node:path";
import { createKimiAcpFinalOutput } from "./kimi-acp-final-output.js";
import { kimiMainWirePath } from "./kimi-wire-usage.js";

function readSnapshot(path, prior) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile()) throw new Error("Kimi wire is not a regular file");
    const offset = prior?.offset ?? stat.size;
    if (
      prior &&
      (String(stat.dev) !== prior.device ||
        String(stat.ino) !== prior.inode ||
        stat.size < offset)
    )
      throw new Error("Kimi wire identity changed or truncated");
    if (stat.size - offset > 16 * 1024 * 1024)
      throw new Error("Kimi wire suffix exceeds bound");
    const hash = createHash("sha256");
    const chunk = Buffer.alloc(64 * 1024);
    let pos = 0;
    while (pos < offset) {
      const n = readSync(
        fd,
        chunk,
        0,
        Math.min(chunk.length, offset - pos),
        pos,
      );
      if (!n) throw new Error("Kimi prefix short read");
      hash.update(chunk.subarray(0, n));
      pos += n;
    }
    const prefixSha256 = hash.digest("hex");
    if (prior && prefixSha256 !== prior.prefixSha256)
      throw new Error("Kimi wire prefix changed");
    const suffix = Buffer.alloc(stat.size - offset);
    let read = 0;
    while (read < suffix.length) {
      const n = readSync(fd, suffix, read, suffix.length - read, offset + read);
      if (!n) throw new Error("Kimi suffix short read");
      read += n;
    }
    const after = fstatSync(fd);
    if (after.size !== stat.size || after.mtimeMs !== stat.mtimeMs)
      throw new Error("Kimi wire changed while reading");
    return {
      path,
      device: String(stat.dev),
      inode: String(stat.ino),
      offset,
      prefixSha256,
      suffix: new TextDecoder("utf-8", { fatal: true }).decode(suffix),
    };
  } finally {
    closeSync(fd);
  }
}
export function captureKimiWire(path) {
  const { suffix, ...baseline } = readSnapshot(path);
  return baseline;
}
export function readKimiWireSuffix(baseline) {
  return readSnapshot(baseline.path, baseline);
}

export function createKimiFinalCapture(options, wake, environment) {
  const selected =
    options.nativeFinal === true &&
    wake.includes(
      "Reply transport: native-final-text for this delivery's single target.",
    );
  if (!selected) return undefined;
  if (
    !options.launchId ||
    !isAbsolute(options.proofPath ?? "") ||
    !options.model ||
    !options.thinkingLevel
  )
    throw new Error(
      "Kimi native final requires exact launch/model/effort/proof binding",
    );
  const parent = lstatSync(dirname(options.proofPath));
  if (
    existsSync(options.proofPath) ||
    !parent.isDirectory() ||
    parent.isSymbolicLink() ||
    (parent.mode & 0o077) !== 0 ||
    parent.uid !== process.getuid?.()
  )
    throw new Error("Kimi proof must be fresh in owner-private directory");
  let binding, collector, terminal;
  return {
    start(sessionId, promptText) {
      const path = kimiMainWirePath(sessionId, environment);
      if (!path) throw new Error("Kimi native wire unavailable before prompt");
      binding = {
        launchId: options.launchId,
        sessionId,
        promptText,
        model: options.model,
        effort: options.thinkingLevel,
        wire: captureKimiWire(path),
      };
    },
    sent(promptId) {
      collector = createKimiAcpFinalOutput({ ...binding, promptId });
      binding.promptId = promptId;
    },
    observe(sessionId, update) {
      collector?.observe(sessionId, update);
    },
    settle(stopReason, cancelled) {
      terminal = { stopReason, cancelled };
    },
    write(cancelled) {
      const candidate = collector?.settle({
        ...terminal,
        launchId: binding.launchId,
        sessionId: binding.sessionId,
        promptId: binding.promptId,
        wire: readKimiWireSuffix(binding.wire),
      });
      if (cancelled || !candidate)
        throw new Error("Kimi native final evidence unavailable");
      writeFileSync(options.proofPath, JSON.stringify(candidate) + "\n", {
        flag: "wx",
        mode: 0o600,
      });
    },
  };
}
