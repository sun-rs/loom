// Offline JSON-body accounting for the audited Codex 0.160.0 controlled-channel
// layout. No provider calls, token estimates, cache claims or efficiency verdict.
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const encode = JSON.stringify;
const bytes = (value) => Buffer.byteLength(encode(value), "utf8");
// Preserve BOM for JSON rejection; never hash a replacement-decoded capture.
const readUtf8 = (path) =>
  new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(
    readFileSync(path),
  );
const fixedCategories = [
  "toolDefinitions",
  "baseInstructions",
  "runtimePolicy",
  "teamInstructions",
  "delegationPolicy",
  "workspaceContext",
];
const contentText = (item) =>
  Array.isArray(item?.content)
    ? item.content.map((part) => part?.text ?? "").join("\n")
    : "";

function parseBody(body) {
  let value;
  try {
    value = JSON.parse(body);
  } catch {
    throw new Error("Invalid captured JSON body");
  }
  if (typeof body !== "string" || encode(value) !== body)
    throw new Error("Expected a compact UTF-8 JSON body");
  const items = value?.input;
  if (
    value.tools !== undefined ||
    !Array.isArray(items) ||
    items.length < 7 ||
    items[0]?.type !== "additional_tools" ||
    items[0]?.role !== "developer" ||
    !Array.isArray(items[0]?.tools) ||
    !items
      .slice(1, 5)
      .every((x) => x?.type === "message" && x.role === "developer") ||
    items[5]?.type !== "message" ||
    items[5]?.role !== "user" ||
    !contentText(items[5]).startsWith("# AGENTS.md instructions for ") ||
    !items.slice(6).some((x) => x?.type === "message" && x.role === "user")
  )
    throw new Error("Unsupported captured request prefix/layout");
  return items;
}

export function accountCodexRequest(body, previousBody) {
  const items = parseBody(body);
  const previous =
    previousBody === undefined ? undefined : parseBody(previousBody);
  const categories = {};
  const add = (category, item) => {
    categories[category] = (categories[category] ?? 0) + bytes(item);
  };
  for (let i = 0; i < fixedCategories.length; i++)
    add(fixedCategories[i], items[i]);
  const lastUser = items.findLastIndex(
    (x) => x?.type === "message" && x.role === "user",
  );
  let unclassifiedItems = 0;
  for (const [offset, item] of items.slice(6).entries()) {
    let category;
    if (item?.type === "message" && item.role === "user")
      category = offset + 6 === lastUser ? "currentWake" : "historicalWakes";
    else if (item?.type === "custom_tool_call")
      category = "historicalToolCalls";
    else if (item?.type === "custom_tool_call_output")
      category = "historicalToolResults";
    else if (
      item?.type === "message" &&
      item.role === "developer" &&
      contentText(item).startsWith("<turn_aborted>")
    )
      category = "historicalInterruptions";
    else if (item?.type === "message" && item.role === "assistant")
      category = "historicalNativeAnswers";
    else {
      category = "unclassifiedInput";
      unclassifiedItems++;
    }
    add(category, item);
  }
  const inputBytes = bytes(items);
  const bodyBytes = Buffer.byteLength(body, "utf8");
  categories.inputArraySyntax = items.length + 1;
  categories.requestOutsideInput = bodyBytes - inputBytes;
  return {
    bodyBytes,
    inputBytes,
    categories,
    unclassifiedItems,
    classificationComplete: unclassifiedItems === 0,
    prefixStable:
      previous === undefined
        ? null
        : encode(items.slice(0, 6)) === encode(previous.slice(0, 6)),
    historyPreserved:
      previous === undefined
        ? null
        : encode(items.slice(6, previous.length)) === encode(previous.slice(6)),
    bodySha256: createHash("sha256").update(body, "utf8").digest("hex"),
  };
}

export function accountCapturedRequests(records) {
  if (!Array.isArray(records) || records.length === 0)
    throw new Error("Capture manifest is empty");
  const previous = new Map();
  const arms = {};
  const rows = records.map(({ arm, session, round, body }) => {
    if (
      !["product", "native"].includes(arm) ||
      typeof session !== "string" ||
      !/^[a-z][a-z0-9_-]{0,31}$/u.test(session)
    )
      throw new Error("Unsupported arm/session label");
    const key = `${arm}:${session}`;
    const old = previous.get(key);
    if (!Number.isSafeInteger(round) || round !== (old?.round ?? 0) + 1)
      throw new Error(
        "Capture round must start at 1 and advance by one per session",
      );
    const row = {
      arm,
      session,
      round,
      ...accountCodexRequest(body, old?.body),
    };
    previous.set(key, { round, body });
    const totals = (arms[arm] ??= {
      requests: 0,
      bodyBytes: 0,
      inputBytes: 0,
      categories: {},
    });
    totals.requests++;
    totals.bodyBytes += row.bodyBytes;
    totals.inputBytes += row.inputBytes;
    for (const [category, n] of Object.entries(row.categories))
      totals.categories[category] = (totals.categories[category] ?? 0) + n;
    return row;
  });
  return {
    format: "codex-0.160.0-controlled-channel-json-bytes-v1",
    classificationComplete: rows.every((row) => row.classificationComplete),
    arms,
    rows,
    limits: [
      "JSON body bytes only; excludes HTTP framing and provider-internal prompt transformations.",
      "Fixed-prefix category meanings rely on the audited controlled-channel layout, not arbitrary CLI sessions.",
      "No token, cache, model-quality, price, paid-call or efficiency conclusions.",
      "Continuity flags compare only supplied requests; they do not prove session identity or capture completeness.",
    ],
  };
}

// Manifest: [{arm: "product"|"native", session: "a", round: 1,
// bodyPath: "request-001.private.json"}, ...]. Paths resolve beside manifest.
if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(resolve(process.argv[1])).href
) {
  try {
    if (process.argv.length !== 3)
      throw new Error("Expected one capture manifest path");
    const path = resolve(process.argv[2]);
    const manifest = JSON.parse(readUtf8(path));
    if (!Array.isArray(manifest)) throw new Error("Expected capture records");
    const records = manifest.map(({ arm, session, round, bodyPath }) => ({
      arm,
      session,
      round,
      body: readUtf8(resolve(dirname(path), bodyPath)),
    }));
    process.stdout.write(
      JSON.stringify(accountCapturedRequests(records), null, 2) + "\n",
    );
  } catch {
    // Filesystem/JSON errors may include private paths or prompt fragments.
    process.stderr.write(
      "Request accounting failed: check the manifest, bodies, supported layout and round order.\n",
    );
    process.exitCode = 1;
  }
}
