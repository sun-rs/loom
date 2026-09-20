import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  splitSearchText,
  tokenizeMessageText,
} from "../src/message-rich-text.ts";

const references = {
  agents: [
    {
      agentId: "agent-alice",
      handle: "Alice",
      principalId: "participant-alice",
      readState: "read" as const,
    },
  ],
  computers: [{ hostId: "host-mac", names: ["host-mac", "Mac-Studio"] }],
  principals: [
    {
      kind: "human" as const,
      handle: "Hakase",
      principalId: "human-owner",
      self: true,
    },
    {
      directRoomId: "room-bob-dm",
      kind: "human" as const,
      handle: "Bob",
      principalId: "human-bob",
      self: false,
    },
  ],
  rooms: [
    {
      kind: "channel" as const,
      names: ["agent-council", "Agent Council"],
      roomId: "room-council",
    },
    {
      kind: "direct" as const,
      names: ["dm-alice", "Alice DM"],
      peerNames: ["Alice"],
      roomId: "room-alice-dm",
    },
  ],
  tasks: [
    {
      roomId: "room-council",
      rootMessageId: "message-task-2",
      taskId: "task-2",
      taskNumber: 2,
      threadId: "thread-task-2",
    },
  ],
  threads: [
    {
      roomId: "room-council",
      roomKind: "channel" as const,
      roomName: "agent-council",
      rootMessageId: "message-root-channel",
      threadId: "thread-abcdef",
    },
    {
      peerNames: ["Alice"],
      roomId: "room-alice-dm",
      roomKind: "direct" as const,
      rootMessageId: "message-root-dm",
      threadId: "thread-fedcba",
    },
  ],
};

test("Raft-style rich text only promotes resolvable Agent, Task and Room references", () => {
  assert.deepEqual(
    tokenizeMessageText(
      "请 @Alice 看 task #9、#2 和 #agent-council；@Ghost 与 #404 保持文字。",
      references,
    ),
    [
      { kind: "text", value: "请 " },
      {
        agentId: "agent-alice",
        kind: "agent",
        principalId: "participant-alice",
        readState: "read",
        self: false,
        value: "@Alice",
      },
      { kind: "text", value: " 看 " },
      {
        candidateKind: "task",
        kind: "unresolved",
        taskNumber: 9,
        value: "task #9",
      },
      { kind: "text", value: "、" },
      {
        kind: "task",
        roomId: "room-council",
        rootMessageId: "message-task-2",
        taskId: "task-2",
        taskNumber: 2,
        threadId: "thread-task-2",
        value: "#2",
      },
      { kind: "text", value: " 和 " },
      {
        kind: "room",
        roomId: "room-council",
        roomKind: "channel",
        value: "#agent-council",
      },
      { kind: "text", value: "；@Ghost 与 #404 保持文字。" },
    ],
  );
});

test("Raft typed-reference grammar covers self/human, DM, Thread, Computer, App and exact messages", () => {
  const tokens = tokenizeMessageText(
    [
      "@Hakase @Bob @Alice",
      "#agent-council #agent-council:abcdef",
      "dm:@Alice dm:@Alice:fedcba",
      "computer:host-mac app:com.example.calendar",
      "#agent-council msg=message-1",
      "#agent-council:abcdef msg=message-2",
      "dm:@Alice msg=message-3",
      "dm:@Alice:fedcba msg=message-4",
    ].join(" "),
    references,
  ).filter((token) => token.kind !== "text");

  assert.deepEqual(
    tokens.map((token) => token.kind),
    [
      "human",
      "human",
      "agent",
      "room",
      "thread",
      "room",
      "thread",
      "computer",
      "app",
      "message",
      "message",
      "message",
      "message",
    ],
  );
  assert.deepEqual(tokens[0], {
    kind: "human",
    principalId: "human-owner",
    self: true,
    value: "@Hakase",
  });
  assert.deepEqual(tokens[2], {
    agentId: "agent-alice",
    kind: "agent",
    principalId: "participant-alice",
    readState: "read",
    self: false,
    value: "@Alice",
  });
  assert.deepEqual(tokens[4], {
    kind: "thread",
    roomId: "room-council",
    roomKind: "channel",
    rootMessageId: "message-root-channel",
    threadId: "thread-abcdef",
    value: "#agent-council:abcdef",
  });
  assert.deepEqual(tokens[8], {
    appId: "com.example.calendar",
    kind: "app",
    value: "app:com.example.calendar",
  });
  assert.deepEqual(tokens.at(-1), {
    kind: "message",
    messageId: "message-4",
    roomId: "room-alice-dm",
    roomKind: "direct",
    rootMessageId: "message-root-dm",
    threadId: "thread-fedcba",
    value: "dm:@Alice:fedcba msg=message-4",
  });
});

test("unknown typed candidates degrade without inventing a canonical target", () => {
  assert.deepEqual(
    tokenizeMessageText(
      "@Ghost #unknown #agent-council:nope dm:@Ghost computer:missing app:not-valid task #99",
      references,
    ),
    [
      {
        kind: "text",
        value: "@Ghost #unknown ",
      },
      {
        candidateKind: "thread",
        kind: "unresolved",
        value: "#agent-council:nope",
      },
      { kind: "text", value: " " },
      {
        candidateKind: "room",
        kind: "unresolved",
        value: "dm:@Ghost",
      },
      { kind: "text", value: " " },
      {
        candidateKind: "computer",
        kind: "unresolved",
        value: "computer:missing",
      },
      { kind: "text", value: " app:not-valid " },
      {
        candidateKind: "task",
        kind: "unresolved",
        taskNumber: 99,
        value: "task #99",
      },
    ],
  );
});

test("canonical handles only promote when they resolve to one identity", () => {
  const conflicted = {
    ...references,
    agents: [
      ...references.agents,
      {
        agentId: "agent-other-alice",
        handle: "alice",
        principalId: "participant-other-alice",
      },
    ],
    rooms: [
      { ...references.rooms[0], names: ["agent-council", "shared"] },
      references.rooms[1],
      {
        kind: "channel" as const,
        names: ["other-room", "shared"],
        roomId: "room-other",
      },
    ],
  };
  assert.deepEqual(tokenizeMessageText("@Alice #shared", conflicted), [
    ...tokenizeMessageText("@Alice", references),
    { kind: "text", value: " #shared" },
  ]);
  assert.equal(
    tokenizeMessageText("#agent-council", conflicted).at(0)?.kind,
    "room",
  );
});

test("Agent display names are not routing aliases", () => {
  assert.deepEqual(tokenizeMessageText("@Alice Agent", references), [
    {
      agentId: "agent-alice",
      kind: "agent",
      principalId: "participant-alice",
      readState: "read",
      self: false,
      value: "@Alice",
    },
    { kind: "text", value: " Agent" },
  ]);
  assert.deepEqual(tokenizeMessageText("@Assistant", references), [
    { kind: "text", value: "@Assistant" },
  ]);
});

test("structured candidates require a complete ending boundary", () => {
  assert.deepEqual(
    tokenizeMessageText(
      "#agent-council.extra computer:host-mac.extra task #2abc",
      references,
    ),
    [
      {
        kind: "text",
        value: "#agent-council.extra computer:host-mac.extra task #2abc",
      },
    ],
  );
});

test("schema-invalid display candidates remain literal text instead of crashing render", () => {
  const oversizedApp = `app:${["com", "x".repeat(301)].join(".")}`;
  assert.deepEqual(tokenizeMessageText(oversizedApp, references), [
    { kind: "text", value: oversizedApp },
  ]);
});

test("rich references respect word boundaries and do not mistake email addresses for mentions", () => {
  assert.deepEqual(
    tokenizeMessageText("mail Alice@example.com x@Alice foo#2 /#2", references),
    [{ kind: "text", value: "mail Alice@example.com x@Alice foo#2 /#2" }],
  );
});

test("thread search highlighting is case-insensitive and preserves source spelling", () => {
  assert.deepEqual(splitSearchText("Agent agent AGENT", "agent"), [
    { highlighted: true, value: "Agent" },
    { highlighted: false, value: " " },
    { highlighted: true, value: "agent" },
    { highlighted: false, value: " " },
    { highlighted: true, value: "AGENT" },
  ]);
});

test("Task references keep Raft's measured 40 percent rest and solid hover colors", () => {
  const css = readFileSync(
    new URL("../src/product.css", import.meta.url),
    "utf8",
  );
  assert.match(
    css,
    /\.rah-rich-task-reference\s*\{[^}]*color-mix\(in srgb, var\(--yellow\) 40%, transparent\)/su,
  );
  assert.match(
    css,
    /\.rah-rich-task-reference:hover,[\s\S]*?\{[^}]*background: var\(--yellow\)/u,
  );
  assert.match(
    css,
    /\.rah-rich-self-reference\s*\{[^}]*background: var\(--yellow\)/su,
  );
  assert.match(
    css,
    /\.rah-rich-thread-reference\s*\{[^}]*color-mix\(in srgb, var\(--cyan\) 30%, transparent\)/su,
  );
  assert.match(css, /\.rah-rich-unresolved-reference\s*\{[^}]*opacity: 0\.6/su);
});

test("historical mentions stay bound to the deleted identity after account reuse", () => {
  const catalog = {
    agents: [
      { agentId: "old", principalId: "old-person", handle: "Kimi" },
      { agentId: "new", principalId: "new-person", handle: "Kimi" },
    ],
    mentions: [
      {
        handle: "Kimi",
        principalId: "old-person",
        agentId: "old",
        start: 0,
        end: 5,
      },
    ],
  };
  const token = tokenizeMessageText("@Kimi", catalog)[0];
  assert.equal(token?.kind, "agent");
  if (token?.kind === "agent") assert.equal(token.agentId, "old");
  assert.deepEqual(tokenizeMessageText("@Kimi", { ...catalog, mentions: [] }), [
    { kind: "text", value: "@Kimi" },
  ]);
});
