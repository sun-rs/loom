import ts from "typescript";
import { readFileSync, writeFileSync } from "node:fs";
import { posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  adaptReactionToolbar,
  adaptThreadFollowers,
  adaptThreadFollowerRow,
} from "./chat-affordance-bindings.ts";
const root = "frontends/raft/upstream/raft-web-source/";
const components = "packages/web/src/components/";
const files = [
  "message/MessageHoverToolbar",
  "message/MentionLink",
  "thread/ThreadAgentFollowers",
  "thread/ThreadAgentFollowerRow",
];
function replace(s, a, b) {
  if (s.split(a).length !== 2) throw Error("Changed official boundary: " + a);
  return s.replace(a, b);
}
// Preserve module bodies; make every import/data substitution reviewable outside Vite.
function bindImports(source, path, drop = []) {
  const file = ts.createSourceFile(
    path,
    source,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const edits = [];
  for (const node of file.statements) {
    if (!ts.isImportDeclaration(node)) continue;
    const spec = node.moduleSpecifier.text;
    if (drop.includes(spec)) {
      edits.push([node.getStart(file), node.end, ""]);
      continue;
    }
    const name = spec.startsWith(".")
      ? "../" + posix.normalize(posix.join(posix.dirname(path), spec))
      : spec === "@botiverse/raft-ui"
        ? "raft-ui"
        : spec;
    if (name !== spec)
      edits.push([
        node.moduleSpecifier.getStart(file),
        node.moduleSpecifier.end,
        JSON.stringify(name),
      ]);
  }
  for (const [start, end, value] of edits.sort((a, b) => b[0] - a[0]))
    source = source.slice(0, start) + value + source.slice(end);
  return source;
}
export function generateChatAffordances() {
  const out = {};
  for (const name of files) {
    const path = components + name + ".tsx";
    let source = readFileSync(root + path, "utf8");
    if (name.endsWith("MessageHoverToolbar"))
      source = bindImports(adaptReactionToolbar(source), path);
    if (name.endsWith("MentionLink")) {
      source = replace(
        source,
        "const viewerUserId = useAuthStore((s) => s.user?.id ?? null);",
        "const viewerUserId = useMessageViewerId();",
      );
      source = replace(
        source,
        '"./ProfilePreviewCardContent"',
        '"loom-bound-profile"',
      );
      source =
        'import {useMessageViewerId} from "./ComposerDirectory";\n' +
        bindImports(source, path, ["../../store/authStore"]);
      source = replace(source, '"loom-bound-profile"', '"./MessageProfile"');
      source = replace(source, "          fallbackAgent={fallbackAgent}\n", "");
      source = replace(source, "          fallbackMember={fallbackMember}\n", "");
    }
    if (name.endsWith("ThreadAgentFollowers")) {
      source = bindImports(adaptThreadFollowers(source), path, [
        "../../api/socket",
        "../../store/threadAgentFollowerStore",
        "../../store/serverStore",
      ]);
      source = replace(
        source,
        '"loom-thread-followers"',
        '"./ThreadFollowers"',
      );
    }
    if (name.endsWith("ThreadAgentFollowerRow")) {
      source = bindImports(adaptThreadFollowerRow(source), path, [
        "../../store/profileStore",
        "../profile/profileFallbackCache",
        "../agent/ChannelMembers",
      ]);
      source =
        'import {JointPeerBadge} from "../packages/web/src/components/agent/ChannelMembers";\n' +
        replace(source, '"loom-thread-followers"', '"./ThreadFollowers"');
    }
    out["Official" + posix.basename(name) + ".generated.tsx"] =
      "// GENERATED from immutable Raft db5e399 source. Explicit Loom data/authority bindings; do not edit.\n" +
      source;
  }
  return out;
}
if (
  process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url)
)
  for (const [name, source] of Object.entries(generateChatAffordances()))
    writeFileSync("frontends/raft/loom/" + name, source);
