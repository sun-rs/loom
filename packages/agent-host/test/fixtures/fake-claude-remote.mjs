#!/usr/bin/env node
// FAKE Claude Code stream-json process driven line by line by a test (no
// model, no script of its own): every stdin line is forwarded to the test over
// the TCP port in FAKE_CLAUDE_CONTROL_PORT, and every line the test sends back
// is written to stdout as a Claude frame. Used to pin frame orderings the
// scripted fakes never produce (seventh review P1-3, P2-1, Claude busy input).
import { connect } from "node:net";
import { createInterface } from "node:readline";

if (process.argv.includes("--version")) {
  process.stdout.write("2.1.282 (Claude Code)\n");
  process.exit(0);
}
const socket = connect(
  Number(process.env.FAKE_CLAUDE_CONTROL_PORT),
  "127.0.0.1",
);
socket.setEncoding("utf8");
createInterface({ input: socket }).on("line", (line) => {
  process.stdout.write(`${line}\n`);
});
createInterface({ input: process.stdin })
  .on("line", (line) => socket.write(`${line}\n`))
  .on("close", () => {
    socket.end();
    // FAKE_CLAUDE_EXIT_CODE: the real headless CLI exits 1 when its last
    // result had `is_error` (an interrupted turn's included).
    process.exit(Number(process.env.FAKE_CLAUDE_EXIT_CODE ?? 0));
  });
socket.on("error", () => process.exit(2));
