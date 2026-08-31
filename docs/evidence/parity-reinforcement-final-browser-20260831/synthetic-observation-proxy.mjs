// Local synthetic API projection for real-App browser verification only.
// This does not stop a Host or edit Kernel/browser state. No credentials are logged.
import http from "node:http";
import net from "node:net";
import readline from "node:readline";

const upstreamPort = 4196;
const proxyPort = 4197;
let mode = "unknown";
let lastSeenAt = new Date().toISOString();
const fixtureHost = "independent-final-mobile-audit-20260831";

const server = http.createServer((req, res) => {
  const upstream = http.request(
    {
      hostname: "127.0.0.1",
      port: upstreamPort,
      method: req.method,
      path: req.url,
      headers: { ...req.headers, host: `127.0.0.1:${upstreamPort}` },
    },
    (response) => {
      if (req.url?.split("?")[0] !== "/v1/local/runtimes/list") {
        res.writeHead(response.statusCode ?? 502, response.headers);
        response.pipe(res);
        return;
      }
      const chunks = [];
      response.on("data", (chunk) => chunks.push(chunk));
      response.on("end", () => {
        try {
          const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
          if (payload.hostId !== fixtureHost || !payload.computer) {
            throw new Error("Unexpected upstream fixture inventory");
          }
          payload.computer = { ...payload.computer, status: mode, lastSeenAt };
          const headers = {
            ...response.headers,
            "content-type": "application/json",
          };
          delete headers["content-length"];
          delete headers["content-encoding"];
          res.writeHead(response.statusCode ?? 200, headers);
          res.end(JSON.stringify(payload));
        } catch {
          res.writeHead(502, { "content-type": "application/json" });
          res.end(
            JSON.stringify({
              error: "Synthetic fixture inventory validation failed",
            }),
          );
        }
      });
    },
  );
  upstream.on("error", () => {
    res.writeHead(502);
    res.end("Synthetic upstream unavailable");
  });
  req.pipe(upstream);
});

server.on("upgrade", (req, socket, head) => {
  const target = net.connect(upstreamPort, "127.0.0.1", () => {
    target.write(`${req.method} ${req.url} HTTP/${req.httpVersion}\r\n`);
    for (const [name, value] of Object.entries(req.headers)) {
      target.write(
        `${name}: ${Array.isArray(value) ? value.join(", ") : value}\r\n`,
      );
    }
    target.write("\r\n");
    if (head.length) target.write(head);
    socket.pipe(target);
    target.pipe(socket);
  });
  target.on("error", () => socket.destroy());
  socket.on("error", () => target.destroy());
});

readline.createInterface({ input: process.stdin }).on("line", (line) => {
  const next = line.trim();
  if (!["unknown", "offline", "online"].includes(next)) return;
  mode = next;
  lastSeenAt = new Date().toISOString();
  console.log(JSON.stringify({ syntheticObservation: mode, lastSeenAt }));
});
server.listen(proxyPort, "127.0.0.1", () => {
  console.log(
    JSON.stringify({
      url: `http://127.0.0.1:${proxyPort}`,
      syntheticObservation: mode,
      upstreamPort,
    }),
  );
});
process.on("SIGINT", () => {
  server.close();
  process.exit(0);
});
process.on("SIGTERM", () => {
  server.close();
  process.exit(0);
});
