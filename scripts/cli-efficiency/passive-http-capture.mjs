// Benchmark-only passive Undici diagnostics. Never replaces fetch or mutates
// requests, credentials, retry policy or response streams. Body files are private.
import dc from "node:diagnostics_channel";
import { mkdirSync, openSync, writeSync, closeSync } from "node:fs";
import { join } from "node:path";
import { createHash, randomUUID } from "node:crypto";

const root = process.env.LOOM_REQUEST_CAPTURE_DIR;
if (root) install(root);

function install(root) {
  const processId = randomUUID();
  const directory = join(root, processId);
  const limit = (name, fallback) => {
    const value = Number(process.env[name] ?? fallback);
    if (!Number.isSafeInteger(value) || value < 1)
      throw new Error("invalid capture limit");
    return value;
  };
  let events, maxBytes, maxAttempts;
  try {
    maxBytes = limit("LOOM_REQUEST_CAPTURE_MAX_BYTES", 512 * 1024 * 1024);
    maxAttempts = limit("LOOM_REQUEST_CAPTURE_MAX_ATTEMPTS", 1000);
    mkdirSync(root, { recursive: true, mode: 0o700 });
    mkdirSync(directory, { mode: 0o700 });
    events = openSync(join(directory, "events.jsonl"), "wx", 0o600);
  } catch {
    // No seal is written: a caller must not interpret absent evidence as zero.
    process.stderr.write(
      "Passive HTTP capture initialization failed; evidence unknown.\n",
    );
    return;
  }
  let fault = false,
    attempts = 0,
    writtenBytes = 0,
    ignoredAttempts = 0;
  const active = new Set(),
    requests = new WeakMap();
  const emit = (type, data = {}) => {
    try {
      writeSync(
        events,
        JSON.stringify({ type, time: new Date().toISOString(), ...data }) +
          "\n",
      );
    } catch {
      fault = true;
    }
  };
  const gap = (r, reason) => {
    fault = true;
    if (r) r.complete = false;
    // At most one record per reason/attempt; no unlimited error log.
    const reasons = r?.gaps ?? processGaps;
    if (!reasons.has(reason)) {
      reasons.add(reason);
      emit("gap", { id: r?.id, reason });
    }
  };
  const processGaps = new Set();
  emit("process-start", { processId, pid: process.pid, maxBytes, maxAttempts });
  const subscribe = (name, callback) =>
    dc.channel(`undici:request:${name}`).subscribe((event) => {
      try {
        callback(event);
      } catch {
        gap(requests.get(event.request), "observer-error");
      }
    });
  const makeSide = (id, suffix) => ({
    fd: openSync(join(directory, `${id}.${suffix}`), "wx", 0o600),
    hash: createHash("sha256"),
    bytes: 0,
    archivedBytes: 0,
  });
  subscribe("create", ({ request }) => {
    const url = new URL(request.path, request.origin);
    if (!url.pathname.endsWith("/chat/completions")) return;
    if (attempts >= maxAttempts) {
      ignoredAttempts++;
      gap(null, "attempt-limit");
      return;
    }
    const id = `${processId}-${++attempts}`;
    const roundValue = Number(process.env.LOOM_REQUEST_CAPTURE_ROUND);
    const r = {
      id,
      complete: true,
      sent: false,
      terminal: false,
      gaps: new Set(),
    };
    requests.set(request, r);
    active.add(r);
    emit("start", {
      id,
      arm: process.env.LOOM_REQUEST_CAPTURE_ARM ?? null,
      round: Number.isSafeInteger(roundValue) ? roundValue : null,
      method: request.method,
      origin: url.origin,
      endpoint: "chat/completions",
    });
    try {
      r.request = makeSide(id, "request");
      r.response = makeSide(id, "response");
    } catch {
      gap(r, "archive-open-failed");
    }
  });
  const chunk = (request, value, side) => {
    const r = requests.get(request);
    if (!r || r.terminal) return;
    const s = r[side];
    if (!s) {
      gap(r, "archive-missing");
      return;
    }
    const bytes = Buffer.isBuffer(value) ? value : Buffer.from(value);
    s.bytes += bytes.length;
    s.hash.update(bytes);
    const available = Math.max(0, maxBytes - writtenBytes);
    const take = Math.min(available, bytes.length);
    if (take) {
      // Synchronous callbacks serialize reservations across concurrent requests.
      writtenBytes += take;
      try {
        let offset = 0;
        while (offset < take) {
          const n = writeSync(s.fd, bytes, offset, take - offset);
          if (n <= 0) throw new Error("short archive write");
          offset += n;
          s.archivedBytes += n;
        }
      } catch {
        gap(r, "archive-write-failed");
      }
    }
    if (take !== bytes.length) gap(r, "byte-limit");
  };
  subscribe("bodyChunkSent", ({ request, chunk: bytes }) =>
    chunk(request, bytes, "request"),
  );
  subscribe("bodyChunkReceived", ({ request, chunk: bytes }) =>
    chunk(request, bytes, "response"),
  );
  subscribe("bodySent", ({ request }) => {
    const r = requests.get(request);
    if (r) r.sent = true;
  });
  subscribe("headers", ({ request, response }) => {
    const r = requests.get(request);
    if (!r) return;
    r.status = response.statusCode;
    const headers = response.headers ?? [];
    for (let i = 0; i < headers.length; i += 2) {
      if (String(headers[i]).toLowerCase() === "content-encoding") {
        const encoding = String(headers[i + 1])
          .trim()
          .toLowerCase();
        r.contentEncoding = [
          "identity",
          "gzip",
          "deflate",
          "br",
          "zstd",
        ].includes(encoding)
          ? encoding
          : "other";
      }
    }
    emit("response-headers", {
      id: r.id,
      status: r.status,
      contentEncoding: r.contentEncoding ?? null,
    });
  });
  const end = (request, errored) => {
    const r = requests.get(request);
    if (!r || r.terminal) return;
    r.terminal = true;
    active.delete(r);
    if (errored) gap(r, "transport-error");
    if (!r.sent) gap(r, "request-body-not-sealed");
    const data = {};
    for (const name of ["request", "response"]) {
      const s = r[name];
      if (!s) continue;
      data[`${name}Bytes`] = s.bytes;
      data[`${name}ArchivedBytes`] = s.archivedBytes;
      data[`${name}Sha256`] = s.hash.digest("hex");
      try {
        closeSync(s.fd);
      } catch {
        gap(r, "archive-close-failed");
      }
    }
    emit("end", {
      id: r.id,
      ...data,
      status: r.status ?? null,
      requestSent: r.sent,
      responseEnded: !errored,
      terminal: errored ? "error" : "trailers",
      contentEncoding: r.contentEncoding ?? null,
      captureComplete: r.complete && r.sent && !errored,
    });
  };
  subscribe("trailers", ({ request }) => end(request, false));
  subscribe("error", ({ request }) => end(request, true));
  process.on("exit", () => {
    if (active.size) gap(null, "active-at-exit");
    emit("process-exit", {
      processId,
      attempts,
      ignoredAttempts,
      active: [...active].map((r) => r.id),
      fault,
      writtenBytes,
    });
    try {
      closeSync(events);
    } catch {
      /* Missing durable seal is reader-owned. */
    }
  });
}
