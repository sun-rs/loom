import { constants, readFileSync } from "node:fs";
import { access } from "node:fs/promises";

const announcementPrefix = "RAH_MULTI_AGENT_FIXTURE ";

export function parseFixtureAnnouncement(output) {
  const line = output
    .split(/\r?\n/u)
    .find((candidate) => candidate.startsWith(announcementPrefix));
  if (line === undefined) {
    throw new Error("fixture announcement is missing");
  }
  let value;
  try {
    value = JSON.parse(line.slice(announcementPrefix.length));
  } catch {
    throw new Error("fixture announcement is malformed");
  }
  if (
    value === null ||
    typeof value !== "object" ||
    !Array.isArray(value.lanOrigins) ||
    !value.lanOrigins.every((origin) => typeof origin === "string") ||
    !["daemonOrigin", "listenHost", "roomId", "webOrigin", "workspaceId"].every(
      (key) => typeof value[key] === "string" && value[key].length > 0,
    )
  ) {
    throw new Error("fixture announcement is malformed");
  }
  return {
    daemonOrigin: value.daemonOrigin,
    lanOrigins: value.lanOrigins,
    listenHost: value.listenHost,
    roomId: value.roomId,
    webOrigin: value.webOrigin,
    workspaceId: value.workspaceId,
    ...(typeof value.stateDirectory === "string"
      ? { stateDirectory: value.stateDirectory }
      : {}),
  };
}

export async function findChromeExecutable() {
  const configured = process.env.RAH_BROWSER_EXECUTABLE?.trim();
  const candidates = [
    configured,
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
    "/Applications/Chromium.app/Contents/MacOS/Chromium",
    "/usr/bin/google-chrome",
    "/usr/bin/google-chrome-stable",
    "/usr/bin/chromium",
    "/usr/bin/chromium-browser",
  ].filter((candidate) => candidate !== undefined && candidate !== "");
  for (const candidate of candidates) {
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Keep looking for an installed real Chromium browser.
    }
  }
  throw new Error(
    "Chrome/Chromium was not found; set RAH_BROWSER_EXECUTABLE to an executable path",
  );
}

export async function waitForDevToolsPort(
  path,
  processHandle,
  timeoutMs = 10_000,
) {
  const deadline = Date.now() + timeoutMs;
  while (true) {
    if (processHandle.exitCode !== null) {
      throw new Error("Chrome exited before opening its DevTools endpoint");
    }
    try {
      const [portLine] = readFileSync(path, "utf8").split(/\r?\n/u);
      const port = Number(portLine);
      if (Number.isInteger(port) && port > 0 && port <= 65_535) return port;
    } catch {
      // Chrome creates DevToolsActivePort after the profile is initialized.
    }
    if (Date.now() >= deadline) {
      throw new Error("Chrome DevTools endpoint startup timed out");
    }
    await delay(25);
  }
}

export class CdpConnection {
  static async open(url) {
    const socket = new WebSocket(url);
    await new Promise((resolve, reject) => {
      const onError = () => reject(new Error("CDP WebSocket failed to open"));
      socket.addEventListener("error", onError, { once: true });
      socket.addEventListener(
        "open",
        () => {
          socket.removeEventListener("error", onError);
          resolve();
        },
        { once: true },
      );
    });
    return new CdpConnection(socket);
  }

  #listeners = new Map();
  #nextId = 1;
  #pending = new Map();
  #socket;

  constructor(socket) {
    this.#socket = socket;
    socket.addEventListener("message", (event) => {
      const message = JSON.parse(String(event.data));
      if (message.id !== undefined) {
        const pending = this.#pending.get(message.id);
        if (pending === undefined) return;
        this.#pending.delete(message.id);
        if (message.error === undefined) pending.resolve(message.result);
        else pending.reject(new Error(message.error.message));
        return;
      }
      const listeners = this.#listeners.get(message.method) ?? [];
      for (const listener of listeners) listener(message.params ?? {});
    });
    socket.addEventListener("close", () => {
      for (const { reject } of this.#pending.values()) {
        reject(new Error("CDP WebSocket closed"));
      }
      this.#pending.clear();
    });
  }

  async command(method, params = {}) {
    const id = this.#nextId++;
    const result = new Promise((resolve, reject) => {
      this.#pending.set(id, { reject, resolve });
    });
    this.#socket.send(JSON.stringify({ id, method, params }));
    return result;
  }

  on(method, listener) {
    const listeners = this.#listeners.get(method) ?? [];
    listeners.push(listener);
    this.#listeners.set(method, listeners);
  }

  close() {
    this.#socket.close();
  }
}

export async function evaluate(connection, expression) {
  const result = await connection.command("Runtime.evaluate", {
    awaitPromise: true,
    expression,
    returnByValue: true,
    userGesture: true,
  });
  if (result.exceptionDetails !== undefined) {
    const description =
      result.exceptionDetails.exception?.description ??
      result.exceptionDetails.text ??
      "browser evaluation failed";
    throw new Error(description);
  }
  return result.result?.value;
}

export async function waitForBrowserValue(
  connection,
  expression,
  { description = expression, timeoutMs = 10_000 } = {},
) {
  const deadline = Date.now() + timeoutMs;
  let latest;
  while (true) {
    latest = await evaluate(connection, expression);
    if (latest) return latest;
    if (Date.now() >= deadline) {
      throw new Error(`timed out waiting for ${description}`);
    }
    await delay(50);
  }
}

export function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}
