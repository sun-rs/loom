import { request } from "node:http";
import { Readable } from "node:stream";

// Raft 1.0.32 waits on `opencode run`; our existing native-server adapter waits
// on HTTP instead. Node fetch has a separate five-minute headers timeout even
// without AbortSignal. The Host owns the execution deadline and cancellation.
export async function fetchOpenCodePrompt(url, init) {
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1")
    throw new Error("OpenCode prompt transport requires the local server");
  if (init.body !== undefined && typeof init.body !== "string")
    throw new Error("OpenCode prompt body must be JSON text");
  return await new Promise((resolve, reject) => {
    const req = request(
      url,
      {
        agent: false,
        method: init.method,
        headers: Object.fromEntries(new Headers(init.headers)),
        signal: init.signal ?? undefined,
      },
      (response) => {
        const headers = new Headers();
        for (const [name, value] of Object.entries(response.headers))
          for (const item of Array.isArray(value)
            ? value
            : value === undefined
              ? []
              : [value])
            headers.append(name, item);
        const status = response.statusCode ?? 500;
        const body = [204, 205, 304].includes(status)
          ? null
          : Readable.toWeb(response);
        if (body === null) response.resume();
        resolve(new Response(body, { status, headers }));
      },
    );
    req.once("error", (error) =>
      reject(
        new Error(
          `OpenCode prompt transport failed (${transportErrorCode(error)})`,
          { cause: error },
        ),
      ),
    );
    req.end(init.body);
  });
}

function transportErrorCode(error) {
  return typeof error.code === "string" && /^[A-Z0-9_]{1,64}$/.test(error.code)
    ? error.code
    : "NETWORK_ERROR";
}
