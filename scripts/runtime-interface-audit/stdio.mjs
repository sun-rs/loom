// Bounded research-only JSONL transport; no provider/session/business policy.
import { spawn } from "node:child_process";
import { StringDecoder } from "node:string_decoder";
import { setTimeout as delay } from "node:timers/promises";

export class JsonLinesProcess {
  frames = [];
  stderr = "";
  unparsed = [];
  pending = new Map();
  sequence = 0;
  protocolError = null;
  constructor(executable, args, options = {}) {
    this.process = spawn(executable, args, {
      ...options,
      detached: true,
      stdio: ["pipe", "pipe", "pipe"],
    });
    this.exit = new Promise((resolve) => {
      this.process.once("error", (e) => {
        this.protocolError = String(e);
        resolve({ error: String(e) });
      });
      this.process.once("close", (code, signal) => resolve({ code, signal }));
    });
    this.process.stdin.on("error", (e) => {
      this.protocolError = String(e);
    });
    this.process.stderr.on("data", (b) => {
      this.stderr = (this.stderr + b).slice(-32000);
    });
    const decoder = new StringDecoder("utf8");
    let tail = "",
      bytes = 0;
    this.process.stdout.on("data", (b) => {
      bytes += b.length;
      tail += decoder.write(b);
      if (
        bytes > 32 * 1024 * 1024 ||
        tail.length > 4 * 1024 * 1024 ||
        this.frames.length > 10000
      ) {
        this.protocolError = "Research protocol bound exceeded";
        this.process.kill("SIGTERM");
        return;
      }
      let n;
      while ((n = tail.indexOf("\n")) >= 0) {
        const line = tail.slice(0, n).replace(/\r$/, "");
        tail = tail.slice(n + 1);
        if (!line.trim()) continue;
        let frame;
        try {
          frame = JSON.parse(line);
        } catch {
          this.unparsed.push(line.slice(0, 1000));
          continue;
        }
        this.frames.push(frame);
        if (frame.id !== undefined && !frame.method) {
          const p = this.pending.get(frame.id);
          if (p) {
            this.pending.delete(frame.id);
            p.resolve(frame);
          }
        }
      }
    });
  }
  send(frame) {
    this.process.stdin.write(JSON.stringify(frame) + "\n");
  }
  request(frame, timeoutMs = 15000) {
    const id = ++this.sequence;
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(
          Error("Protocol request timeout: " + (frame.method ?? frame.type)),
        );
      }, timeoutMs);
      this.pending.set(id, {
        resolve: (response) => {
          clearTimeout(timer);
          resolve(response);
        },
      });
      this.send({ ...frame, id });
    });
  }
  rpc(method, params, timeoutMs) {
    return this.request({ jsonrpc: "2.0", method, params }, timeoutMs);
  }
  pi(type, params = {}, timeoutMs) {
    return this.request({ type, ...params }, timeoutMs);
  }
  async wait(predicate, { after = 0, timeoutMs = 20000 } = {}) {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const frame = this.frames.slice(after).find(predicate);
      if (frame) return frame;
      if (this.protocolError) throw Error(this.protocolError);
      if (this.process.exitCode !== null || this.process.signalCode)
        throw Error("Native process exited before event");
      await delay(10);
    }
    throw Error("Native event timeout");
  }
  async waitForExit(timeoutMs) {
    let timer;
    try {
      return await Promise.race([
        this.exit,
        new Promise((resolve) => {
          timer = setTimeout(() => resolve(null), timeoutMs);
        }),
      ]);
    } finally {
      clearTimeout(timer);
    }
  }
  async close({ graceMs = 2500 } = {}) {
    this.process.stdin.end();
    let outcome = await this.waitForExit(graceMs);
    if (!outcome) {
      this.process.kill("SIGTERM");
      outcome = await this.waitForExit(2500);
    }
    if (!outcome) {
      try {
        process.kill(-this.process.pid, "SIGKILL");
      } catch {}
      outcome = await this.exit;
    }
    return outcome;
  }
}
