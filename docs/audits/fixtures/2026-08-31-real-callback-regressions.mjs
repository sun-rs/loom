// Independent audit harness. Extracts actual TS/TSX callbacks; never mounts a
// browser, builds, calls a server, or writes production data.
// Run from the repository: node --test docs/audits/fixtures/2026-08-31-real-callback-regressions.mjs
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import ts from "typescript";
import * as React from "react";
import { renderToStaticMarkup } from "react-dom/server";
import {
  agentPresencePresentation,
  visibleNavigationDot,
} from "../../../apps/web/src/attention-presentation.ts";
import { createLatestRequest } from "../../../apps/web/src/latest-request.ts";
import { pendingInputRequestsForHuman } from "../../../apps/web/src/human-inbox-projection.ts";
import { discoveryLocation } from "../../../apps/web/src/global-discovery-model.ts";
import { navigationPresentation } from "../../../apps/web/src/navigation-target.ts";
import { globalTaskDetailFromSearch } from "../../../apps/web/src/global-task-detail-route.ts";
import { normalizeDiscoveryParams } from "../../../apps/web/src/raft-discovery-controls.ts";

const app = "apps/web/src/App.tsx";
const activity = "apps/web/src/components/global-discovery.tsx";
const diagnostic = "apps/web/src/components/diagnostic-references.tsx";
const files = "apps/web/src/components/agent-workspace-browser.tsx";
const noop = () => {};
function find(path, predicate) {
  const text = readFileSync(
    new URL(`../../../${path}`, import.meta.url),
    "utf8",
  );
  const source = ts.createSourceFile(
    path,
    text,
    ts.ScriptTarget.Latest,
    true,
    ts.ScriptKind.TSX,
  );
  const matches = [];
  function visit(node) {
    if (predicate(node, source)) matches.push(node);
    ts.forEachChild(node, visit);
  }
  visit(source);
  assert.equal(
    matches.length,
    1,
    `expected exactly one callback in ${path}, got ${matches.length}`,
  );
  return { node: matches[0], source };
}
function evaluate(expression, scope) {
  const output = ts.transpileModule(`const extracted = ${expression};`, {
    compilerOptions: {
      target: ts.ScriptTarget.ES2022,
      module: ts.ModuleKind.ESNext,
      jsx: ts.JsxEmit.React,
    },
  }).outputText;
  return new Function(...Object.keys(scope), `${output}; return extracted;`)(
    ...Object.values(scope),
  );
}
function declaration(path, name, scope) {
  const { node, source } = find(
    path,
    (n) => ts.isFunctionDeclaration(n) && n.name?.text === name,
  );
  return evaluate(node.getText(source).replace(/^export\s+/, ""), scope);
}
function callback(name, scope) {
  const { node, source } = find(
    app,
    (n, s) => ts.isVariableDeclaration(n) && n.name.getText(s) === name,
  );
  return evaluate(node.initializer.arguments[0].getText(source), scope);
}
function effect(path, contains, scope) {
  const { node, source } = find(
    path,
    (n, s) =>
      ts.isCallExpression(n) &&
      n.expression.getText(s) === "useEffect" &&
      n.arguments[0]?.getText(s).includes(contains),
  );
  return evaluate(node.arguments[0].getText(source), scope);
}
function jsx(path, name, contains, scope) {
  const { node, source } = find(
    path,
    (n, s) =>
      ts.isJsxAttribute(n) &&
      n.name.getText(s) === name &&
      n.initializer?.getText(s).includes(contains),
  );
  return evaluate(node.initializer.expression.getText(source), scope);
}
function deferred() {
  let resolve, reject;
  const promise = new Promise((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}

test("profile conflict refreshes canonical revision without pretending the draft was saved", async () => {
  const old = {
    definition: { agentDefinitionId: "alice" },
    currentRevision: { revision: 1 },
  };
  const latest = { ...old, currentRevision: { revision: 2 } };
  let catalog = [old];
  const conflict = new Error("revision changed");
  const save = callback("saveAgentProfile", {
    activeWorkspace: { controlRoomId: "control" },
    canManageCurrentWorkspaceAgent: true,
    client: {
      request: async (operation) => {
        assert.equal(operation, "agent.get");
        return { agent: latest };
      },
    },
    consumerPrefix: "test",
    sessions: { current: new Map() },
    roomSessionFor: () => ({}),
    runRoomMutationAtLatest: async () => {
      throw conflict;
    },
    setAgentCatalog: (update) => {
      catalog = update(catalog);
    },
  });
  await assert.rejects(
    save({
      agentDefinitionId: "alice",
      expectedRevisionId: "revision-1",
      field: "displayName",
      value: "draft",
    }),
    /revision changed/,
  );
  assert.deepEqual(catalog, [latest]);
});

test("offline Agent renders a persistent gray presence marker instead of removing it", () => {
  const Avatar = declaration(
    "apps/web/src/components/agent-avatar.tsx",
    "AgentAvatar",
    {
      React,
      agentPresencePresentation,
      AgentStatusDot: declaration(
        "packages/ui-web/src/neo-brutalist/status-dot.tsx",
        "AgentStatusDot",
        { React },
      ),
      agentAvatarPixels: () => ({ background: "white", grid: ["1"] }),
      isUploadedProfileImageKey: () => false,
      profileImageContentPath: () => "/unused-profile-image",
      OFFICIAL_AVATAR_PACK: {
        presets: { test: { background: "white", grid: ["1"] } },
        palette: { 1: "black" },
      },
    },
  );
  const html = renderToStaticMarkup(
    React.createElement(Avatar, {
      size: "sidebar",
      agent: {
        displayName: "Alice",
        state: "enabled",
        runtimeAvailable: true,
        connectionStatus: "offline",
      },
    }),
  );
  assert.match(html, /rah-agent-avatar-presence/);
  assert.match(html, /data-online="false"/);
  assert.match(html, /data-size="sm"/);
  assert.match(html, /title="离线"/);
});

test("Agent presence does not inherit navigation-dot absolute positioning", () => {
  const Dot = declaration(
    "packages/ui-web/src/neo-brutalist/status-dot.tsx",
    "AgentStatusDot",
    { React },
  );
  const html = renderToStaticMarkup(
    React.createElement(Dot, {
      activity: "thinking",
      label: "思考中",
      className: "rah-agent-profile-presence",
    }),
  );
  assert.match(html, /rah-agent-status-dot/);
  assert.doesNotMatch(html, /\brah-status-dot\b/);
  assert.match(html, /data-pulse="true"/);
  assert.match(html, /data-size="md"/);
  const external = renderToStaticMarkup(
    React.createElement(Dot, {
      activity: "thinking",
      label: "External",
      className: "test",
      external: true,
    }),
  );
  assert.match(external, /data-activity="external"/);
  assert.match(external, /data-pulse="false"/);
});

test("system notification attention stays visible while the bell is open on desktop and mobile", () => {
  for (const name of ["RailButton", "MobileNavigationButton"]) {
    const Button = declaration(
      "apps/web/src/components/workspace-navigation.tsx",
      name,
      {
        React,
        visibleNavigationDot,
        Icon: () => React.createElement("svg"),
      },
    );
    const html = renderToStaticMarkup(
      React.createElement(Button, {
        active: true,
        dot: true,
        keepDotWhileActive: true,
        icon: "bell",
        label: "通知",
        onClick: noop,
      }),
    );
    assert.match(html, /rah-status-dot/, name);
  }
});
function navigation() {
  const generation = { current: 0 };
  const requests = { current: createLatestRequest() };
  const state = {
    surface: "room",
    selected: "original-room",
    thread: undefined,
    peek: undefined,
    rooms: [{ roomId: "original-room" }],
  };
  const invalidateNavigation = callback("invalidateNavigation", {
    navigationGeneration: generation,
    diagnosticNavigation: requests,
  });
  return {
    state,
    generation,
    requests,
    invalidateNavigation,
    scope: {
      // These regressions exercise ordinary Room/Activity Threads. Task modal
      // callbacks now share the navigation owner, so supply their real route
      // parser and inactive state without weakening the original assertions.
      globalTaskDetailFromSearch,
      setGlobalTaskDetail: noop,
      taskModalOpen: false,
      navigationGeneration: generation,
      diagnosticNavigation: requests,
      invalidateNavigation,
      navigationEpoch: () => generation.current,
      setSurface: (value) => {
        invalidateNavigation();
        state.surface = value;
      },
    },
  };
}
function activityScope() {
  const nav = navigation();
  const a = deferred(),
    b = deferred();
  const state = {
    pending: undefined,
    error: undefined,
    refreshed: 0,
    opened: [],
  };
  const window = { location: { href: "http://isolated/?surface=activity" } };
  const actionGate = { current: createLatestRequest() };
  const old = { key: "old-a", roomId: "a", latestSeq: 10 };
  const next = {
    key: "new-b",
    roomId: "b",
    latestSeq: 20,
    latestMessage: { messageId: "message-b" },
    target: { kind: "message", roomId: "b", messageId: "message-b" },
  };
  const scope = {
    window,
    actionGate,
    navigationEpoch: () => nav.generation.current,
    beginNavigation: nav.invalidateNavigation,
    setPending: (value) => {
      state.pending = value;
    },
    setError: (value) => {
      state.error = value;
    },
    onOpen: (value) => state.opened.push(value),
    client: {
      request: (operation) =>
        operation === "activity.mark" ? a.promise : b.promise,
    },
    result: { data: { items: [old] }, refresh: () => state.refreshed++ },
  };
  const changeFilter = () => {
    window.location.href += "&filter=mentions";
    effect(activity, "setPending(undefined)", scope)();
  };
  return { a, b, state, scope, next, changeFilter };
}

test("Activity context becomes stale before effect cleanup and filter change releases pending", async () => {
  const f = activityScope();
  const p = declaration(activity, "mark", f.scope)(f.next, "read", true);
  f.scope.window.location.href += "&filter=mentions";
  f.b.resolve({});
  await p;
  assert.deepEqual(f.state.opened, []);
  effect(activity, "setPending(undefined)", f.scope)();
  assert.equal(f.state.pending, undefined);
});

for (const outcome of ["resolve", "reject"])
  test(`old all-read ${outcome} cannot clear new context pending or overwrite its status`, async () => {
    const f = activityScope();
    const p = declaration(activity, "readVisible", f.scope)();
    f.changeFilter();
    const next = declaration(activity, "mark", f.scope)(f.next, "read", true);
    f.a[outcome](outcome === "reject" ? new Error("old failed") : {});
    await p;
    assert.equal(f.state.pending, "new-b");
    assert.equal(f.state.error, undefined);
    assert.equal(f.state.refreshed, 0);
    f.b.resolve({});
    await next;
  });

test("separate diagnostic rows share latest navigation intent even if older transport resolves first", async () => {
  const nav = navigation(),
    a = deferred(),
    b = deferred(),
    opened = [];
  const context = {
    navigationEpoch: () => nav.generation.current,
    beginNavigation: nav.invalidateNavigation,
    requestGate: nav.requests.current,
    client: {
      request: (_, input) => (input.messageId === "a" ? a.promise : b.promise),
    },
    onOpen: (value) => {
      opened.push(value.target.messageId);
      nav.invalidateNavigation();
      return Promise.resolve(true);
    },
  };
  const scope = () => ({
    context,
    window: { location: { href: "http://isolated/" } },
    gate: { current: createLatestRequest() },
    ownRequest: { current: undefined },
    setError: noop,
  });
  const firstScope = scope(),
    secondScope = scope();
  const first = declaration(
    diagnostic,
    "open",
    firstScope,
  )({ roomId: "r", messageId: "a" });
  const second = declaration(
    diagnostic,
    "open",
    secondScope,
  )({ roomId: "r", messageId: "b" });
  a.resolve({ message: { roomId: "r", messageId: "a" } });
  await first;
  assert.deepEqual(opened, []);
  b.resolve({ message: { roomId: "r", messageId: "b" } });
  await second;
  assert.deepEqual(opened, ["b"]);
});

function diagnosticScope(nav, response) {
  const opened = [],
    errors = [];
  return {
    opened,
    errors,
    context: {
      navigationEpoch: () => nav.generation.current,
      beginNavigation: nav.invalidateNavigation,
      requestGate: nav.requests.current,
      client: { request: () => response.promise },
      onOpen: (request) => {
        opened.push(request);
        nav.state.selected = request.target.roomId;
        nav.scope.setSurface("room");
        return Promise.resolve(true);
      },
    },
    window: { location: { href: "http://isolated/" } },
    ownRequest: { current: undefined },
    setError: (error) => errors.push(error),
  };
}

test("cleanup or late failure of an older diagnostic row cannot cancel or report over the newest row", async () => {
  const nav = navigation(),
    a = deferred(),
    b = deferred();
  const firstScope = diagnosticScope(nav, a),
    secondScope = diagnosticScope(nav, b);
  const first = declaration(
    diagnostic,
    "open",
    firstScope,
  )({ roomId: "a", messageId: "a" });
  const second = declaration(
    diagnostic,
    "open",
    secondScope,
  )({ roomId: "b", messageId: "b" });
  effect(diagnostic, "ownRequest.current", firstScope)()();
  a.reject(new Error("old error"));
  await first;
  assert.deepEqual(firstScope.errors.filter(Boolean), []);
  b.resolve({ message: { roomId: "b", messageId: "b" } });
  await second;
  assert.equal(nav.state.selected, "b");
});

function mutationScope() {
  const nav = navigation(),
    response = deferred();
  const scope = {
    ...nav.scope,
    directRoomOpenRequests: { current: new Map() },
    activeWorkspace: { workspaceId: "workspace-a", controlRoomId: "control-a" },
    health: { capabilities: { roomWrite: true, threadRead: true } },
    workspaceMembershipRole: "owner",
    canCreateCurrentWorkspaceRoom: true,
    roomSessionFor: noop,
    sessions: { current: new Map() },
    client: {
      request: async (operation, input) => {
        assert.equal(operation, "navigation.resolve");
        return { target: input.target };
      },
    },
    consumerPrefix: "audit",
    runRoomMutationAtLatest: () => response.promise,
    browserOpaqueId: () => "audit",
    setFocusedMessageId: noop,
    setRooms: (value) => {
      nav.state.rooms =
        typeof value === "function" ? value(nav.state.rooms) : value;
    },
    setPeekAgentId: (value) => {
      nav.state.peek =
        typeof value === "function" ? value(nav.state.peek) : value;
    },
    setNavigationError: noop,
    setRoomMembersOpen: noop,
    setThreadMessages: noop,
    setThreadHasEarlierReplies: noop,
    setRoomData: noop,
    consecutivePollFailures: { current: 0 },
    setActiveRoomId: (value) => {
      nav.state.selected = value;
    },
    setActiveThreadRootMessageId: (value) => {
      nav.state.thread = value;
    },
    setTab: noop,
    setMobileRoomsOpen: noop,
    setRoomCreateOpen: noop,
  };
  return { nav, response, scope };
}
for (const name of ["openDirectRoom", "createRoom"])
  test(`${name} may complete but cannot navigate after a newer Settings choice`, async () => {
    const f = mutationScope();
    const p = callback(
      name,
      f.scope,
    )(
      name === "openDirectRoom"
        ? "peer"
        : {
            name: "Room",
            slug: "room",
            visibility: "public",
            initialAgentParticipantIds: [],
          },
    );
    f.nav.scope.setSurface("settings");
    f.nav.state.thread = "new-user-thread";
    f.response.resolve({ room: { roomId: "late-room" } });
    await p;
    assert.equal(f.nav.state.surface, "settings");
    assert.equal(f.nav.state.selected, "original-room");
    assert.equal(f.nav.state.thread, "new-user-thread");
    assert.equal(
      f.nav.state.rooms.some((room) => room.roomId === "late-room"),
      true,
      "completed mutation still reconciles its own canonical Room",
    );
  });

test("repeated same-peer DM clicks share one mutation but the most recent click receives navigation", async () => {
  const f = mutationScope();
  let calls = 0;
  f.scope.runRoomMutationAtLatest = () => {
    calls++;
    return f.response.promise;
  };
  const open = callback("openDirectRoom", f.scope);
  const first = open("peer");
  f.nav.scope.setSurface("settings");
  const second = open("peer");
  assert.equal(calls, 1);
  f.response.resolve({ room: { roomId: "same-peer-room" } });
  await Promise.all([first, second]);
  assert.equal(f.nav.state.surface, "room");
  assert.equal(f.nav.state.selected, "same-peer-room");
  assert.equal(f.scope.directRoomOpenRequests.current.size, 0);
});

for (const crossWorkspace of [false, true])
  test(`latest DM wins across ${crossWorkspace ? "Workspaces with the same peer" : "different peers"} when older result arrives first`, async () => {
    const f = mutationScope(),
      a = deferred(),
      b = deferred();
    let calls = 0;
    f.scope.runRoomMutationAtLatest = () =>
      ++calls === 1 ? a.promise : b.promise;
    const first = callback("openDirectRoom", f.scope)("peer-a");
    const newerScope = crossWorkspace
      ? {
          ...f.scope,
          activeWorkspace: {
            workspaceId: "workspace-b",
            controlRoomId: "control-b",
          },
        }
      : f.scope;
    const second = callback(
      "openDirectRoom",
      newerScope,
    )(crossWorkspace ? "peer-a" : "peer-b");
    assert.equal(
      calls,
      2,
      "only identical Workspace+peer mutations may be shared",
    );
    a.resolve({ room: { roomId: "room-a" } });
    await first;
    assert.equal(f.nav.state.selected, "original-room");
    b.resolve({ room: { roomId: "room-b" } });
    await second;
    assert.equal(f.nav.state.selected, "room-b");
    assert.deepEqual(f.nav.state.rooms.map((room) => room.roomId).sort(), [
      "original-room",
      "room-a",
      "room-b",
    ]);
  });

for (const latest of ["diagnostic", "DM"])
  test(`DM and diagnostic clicks share navigation intent; ${latest} clicked last wins`, async () => {
    const f = mutationScope(),
      response = deferred();
    const diagnosticState = diagnosticScope(f.nav, response);
    const openDiagnostic = declaration(diagnostic, "open", diagnosticState);
    const openDM = callback("openDirectRoom", f.scope);
    let direct, target;
    if (latest === "diagnostic") {
      direct = openDM("peer");
      target = openDiagnostic({
        roomId: "diagnostic-room",
        messageId: "target",
      });
      f.response.resolve({ room: { roomId: "dm-room" } });
      await direct;
      assert.equal(f.nav.state.selected, "original-room");
      response.resolve({
        message: { roomId: "diagnostic-room", messageId: "target" },
      });
      await target;
      assert.equal(f.nav.state.selected, "diagnostic-room");
    } else {
      target = openDiagnostic({
        roomId: "diagnostic-room",
        messageId: "target",
      });
      direct = openDM("peer");
      response.resolve({
        message: { roomId: "diagnostic-room", messageId: "target" },
      });
      await target;
      assert.equal(f.nav.state.selected, "original-room");
      f.response.resolve({ room: { roomId: "dm-room" } });
      await direct;
      assert.equal(f.nav.state.selected, "dm-room");
    }
  });

test("a new avatar panel selection invalidates an older pending DM instead of being closed by it", async () => {
  const f = mutationScope();
  const direct = callback("openDirectRoom", f.scope)("peer");
  await callback("openAgentPeek", f.scope)("new-agent");
  f.response.resolve({ room: { roomId: "late-dm" } });
  await direct;
  assert.equal(f.nav.state.selected, "original-room");
  assert.equal(f.nav.state.peek, "new-agent");
});

test("opening and closing Thread synchronously invalidate an earlier diagnostic request", async () => {
  const f = mutationScope();
  const scope = {
    ...f.scope,
    activeRoom: { roomId: "r" },
    roomData: {},
    view: { messages: [{ messageId: "root" }] },
    setError: noop,
    errorMessage: String,
    setReload: noop,
    messageContext: undefined,
    activeThreadRootMessageId: "root",
    rememberThreadFocus: noop,
    restoreThreadFocus: noop,
  };
  const first = f.nav.requests.current.begin();
  await callback("openThread", scope)("root");
  assert.equal(first.current(), false);
  const second = f.nav.requests.current.begin();
  jsx(app, "onClose", "messageContext?.message.threadId", scope)();
  assert.equal(second.current(), false);
});

test("late direct-room wrapper completion does not close a subsequently selected Agent panel", async () => {
  const nav = navigation(),
    response = deferred();
  let selectedPeek = "first-agent";
  const { node, source } = find(
    app,
    (n, s) =>
      ts.isPropertyAssignment(n) &&
      n.name.getText(s) === "onOpenDirectRoom" &&
      n.initializer.getText(s).includes("await openDirectRoom"),
  );
  const open = evaluate(node.initializer.getText(source), {
    ...nav.scope,
    openDirectRoom: () => response.promise,
    peekAgentId: "first-agent",
    setPeekAgentId: (value) => {
      selectedPeek = typeof value === "function" ? value(selectedPeek) : value;
    },
  });
  const p = open("first-agent");
  nav.invalidateNavigation();
  selectedPeek = "second-agent";
  response.resolve(false);
  await p;
  assert.equal(selectedPeek, "second-agent");
});

test("copy success followed by rejected retry does not retain permanent copied feedback", async () => {
  let copied = false,
    attempt = 0,
    timerId = 0,
    copyError;
  const timers = new Map();
  const copy = jsx(files, "onClick", "navigator.clipboard", {
    copyGeneration: { current: 0 },
    copyTimer: { current: undefined },
    root: { rootPath: "/isolated/agent" },
    clearTimeout: (id) => timers.delete(id),
    setTimeout: (fn) => {
      timers.set(++timerId, fn);
      return timerId;
    },
    navigator: {
      clipboard: {
        writeText: () =>
          ++attempt === 1
            ? Promise.resolve()
            : Promise.reject(new Error("denied")),
      },
    },
    setCopy: (value) => {
      copied = value;
    },
    setError: noop,
    setCopyError: (value) => {
      copyError = value;
    },
  });
  copy();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(copied, true);
  copy();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(copied, false);
  assert.equal(timers.size, 0);
  assert.equal(copyError, "无法复制路径");
});

async function flushMicrotasks() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}

function inboxFixture(request) {
  let now = 0,
    serial = 0;
  const timers = new Map(),
    windowEvents = new Map(),
    documentEvents = new Map();
  const state = { requests: [], error: undefined, loading: false };
  const setTimeout = (fn, ms) => {
    timers.set(++serial, { fn, at: now + ms });
    return serial;
  };
  const clearTimeout = (id) => timers.delete(id);
  const document = {
    visibilityState: "visible",
    addEventListener: (event, fn) => documentEvents.set(event, fn),
    removeEventListener: (event) => documentEvents.delete(event),
  };
  const window = {
    setTimeout,
    clearTimeout,
    addEventListener: (event, fn) => windowEvents.set(event, fn),
    removeEventListener: (event) => windowEvents.delete(event),
  };
  const scope = {
    health: { capabilities: { inputRequestRead: true } },
    currentPrincipal: { principalId: "human" },
    rooms: [{ roomId: "room" }],
    client: { request },
    pendingInputRequestsForHuman,
    errorMessage: String,
    setHumanInputRequests: (value) => {
      state.requests = value;
    },
    setHumanInboxError: (value) => {
      state.error = value;
    },
    setHumanInboxLoading: (value) => {
      state.loading = value;
    },
    window,
    document,
    setTimeout,
    clearTimeout,
  };
  scope.refreshHumanInbox = callback("refreshHumanInbox", scope);
  return {
    state,
    scope,
    timers,
    windowEvents,
    documentEvents,
    start: () => effect(app, "refreshHumanInbox(", scope)(),
    async advance(ms) {
      const target = now + ms;
      while (true) {
        const next = [...timers]
          .filter(([, timer]) => timer.at <= target)
          .sort((a, b) => a[1].at - b[1].at)[0];
        if (!next) break;
        now = next[1].at;
        timers.delete(next[0]);
        next[1].fn();
        await flushMicrotasks();
      }
      now = target;
      await flushMicrotasks();
    },
  };
}
const pendingQuestion = {
  inputRequestId: "question",
  state: "pending",
  responderId: "human",
  createdAt: "2026-08-31T00:00:00.000Z",
};

function presenceReadFixture(request) {
  const f = inboxFixture(request);
  let state, cleanup;
  const hook = declaration(
    "apps/web/src/use-reconciled-query.ts",
    "useReconciledQuery",
    {
      ...f.scope,
      AbortController,
      useState: () => [
        undefined,
        (value) => {
          state = typeof value === "function" ? value(state) : value;
        },
      ],
      useEffect: (run) => {
        cleanup = run();
      },
    },
  );
  hook({ request }, "agent.presence.list", { controlRoomId: "control" });
  return { ...f, read: () => state, cleanup: () => cleanup() };
}

test("presence retries a hung transport, ignores its late result, and polls visible pages once per second", async () => {
  const hung = deferred();
  let calls = 0,
    signal;
  const f = presenceReadFixture((_, __, options) => {
    if (++calls === 1) {
      signal = options.signal;
      return hung.promise;
    }
    return Promise.resolve({ agents: [{ activity: "working" }] });
  });
  await f.advance(15000);
  assert.equal(signal.aborted, true);
  assert.match(f.read().error, /超时/);
  await f.advance(1000);
  assert.equal(calls, 2);
  assert.equal(f.read().data.agents[0].activity, "working");
  hung.resolve({ agents: [{ activity: "thinking" }] });
  await flushMicrotasks();
  assert.equal(f.read().data.agents[0].activity, "working");
  f.cleanup();
  assert.equal(f.timers.size, 0);
});

test("presence scope cleanup cancels its in-flight deadline and prevents late application", async () => {
  const hung = deferred();
  const f = presenceReadFixture(() => hung.promise);
  f.cleanup();
  assert.equal(
    f.timers.size,
    0,
    "unmounted/scope-switched query must not retain a deadline",
  );
  hung.resolve({ agents: [{ activity: "online" }] });
  await flushMicrotasks();
  assert.equal(f.read(), undefined);
  assert.equal(f.windowEvents.size, 0);
  assert.equal(f.documentEvents.size, 0);
});

test("hung Inbox read times out, retries, and cannot later overwrite the retry", async () => {
  const hung = deferred();
  let calls = 0,
    oldSignal;
  const f = inboxFixture((_, __, options) => {
    calls++;
    if (calls === 1) {
      oldSignal = options.signal;
      return hung.promise;
    }
    return Promise.resolve({ inputRequests: [pendingQuestion] });
  });
  const cleanup = f.start();
  try {
    await f.advance(15000);
    assert.equal(oldSignal.aborted, true);
    assert.match(f.state.error, /超时/);
    await f.advance(5000);
    assert.equal(calls, 2);
    assert.equal(f.state.requests.length, 1);
    hung.resolve({ inputRequests: [] });
    await flushMicrotasks();
    assert.equal(f.state.requests.length, 1);
  } finally {
    cleanup();
  }
});

test("Activity exact Thread callback keeps the list background and opens the requested identity", async () => {
  const nav = navigation();
  const scope = {
    ...nav.scope,
    surface: "activity",
    rooms: [
      { roomId: "r", kind: "channel" },
      { roomId: "room", kind: "channel" },
    ],
    window: {
      location: { search: "?surface=activity&filter=mentions" },
      history: { pushState: noop },
    },
    discoveryLocation: () =>
      "?surface=activity&room=r&thread=r:root&message=reply",
    navigationPresentation,
    client: {
      request: async (_, input) => ({ target: input.target }),
    },
    setNavigationError: noop,
    setFocusedMessageId: noop,
    setActiveThreadRootMessageId: (value) => {
      nav.state.thread = value;
    },
    setActiveRoomId: (value) => {
      nav.state.selected = value;
    },
    setRoomMembersOpen: noop,
    setMobileRoomsOpen: noop,
    setPeekAgentId: noop,
    setTab: noop,
  };
  await callback(
    "openDiscoveryLocation",
    scope,
  )({
    surface: "activity",
    target: {
      kind: "message",
      roomId: "r",
      rootMessageId: "root",
      messageId: "reply",
    },
  });
  assert.equal(nav.state.surface, "activity");
  assert.equal(nav.state.selected, "r");
  assert.equal(nav.state.thread, "root");
});

function activityRouteFixture(search = "?surface=activity&filter=mentions") {
  const nav = navigation();
  const location = new URL(search, "http://isolated/");
  const window = {
    location,
    history: {
      pushState: (_, __, next) => {
        location.href = new URL(next, location).href;
      },
      replaceState: (_, __, next) => {
        location.href = new URL(next, location).href;
      },
    },
    addEventListener: noop,
    removeEventListener: noop,
  };
  const scope = {
    ...nav.scope,
    surface: "activity",
    rooms: [
      { roomId: "r", kind: "channel" },
      { roomId: "room", kind: "channel" },
    ],
    window,
    discoveryLocation,
    navigationPresentation,
    client: {
      request: async (_, input) => ({ target: input.target }),
    },
    setNavigationError: noop,
    setFocusedMessageId: (value) => {
      nav.state.focus = value;
    },
    setActiveThreadRootMessageId: (value) => {
      nav.state.thread = value;
    },
    setActiveRoomId: (value) => {
      nav.state.selected = value;
    },
    setRoomMembersOpen: noop,
    setMobileRoomsOpen: noop,
    setPeekAgentId: noop,
    setTab: noop,
  };
  return { nav, window, scope, open: callback("openDiscoveryLocation", scope) };
}

test("Activity mark opening a Thread releases pending despite its own route invalidation", async () => {
  const f = activityRouteFixture();
  const request = deferred();
  const state = { pending: undefined, error: undefined };
  const mark = declaration(activity, "mark", {
    ...f.scope,
    beginNavigation: f.nav.invalidateNavigation,
    actionGate: { current: createLatestRequest() },
    setPending: (value) => {
      state.pending = value;
    },
    setError: (value) => {
      state.error = value;
    },
    onOpen: f.open,
    client: { request: () => request.promise },
    result: { refresh: noop },
  });
  const opening = mark(
    {
      key: "thread-card",
      roomId: "room",
      rootMessageId: "root",
      latestMessage: { messageId: "reply" },
      target: {
        kind: "message",
        roomId: "room",
        rootMessageId: "root",
        messageId: "reply",
      },
    },
    "read",
    true,
  );
  assert.equal(state.pending, "thread-card");
  request.resolve({});
  await opening;
  assert.equal(f.nav.state.surface, "activity");
  assert.equal(f.nav.state.thread, "root");
  assert.equal(
    state.pending,
    undefined,
    "the still-mounted Activity must not remain disabled after its own successful navigation",
  );
});

test("closing the current Thread invalidates an Activity target without stranding its pending state", async () => {
  const f = activityRouteFixture(
    "?surface=activity&room=room&thread=room%3Aprevious&message=previous-reply",
  );
  f.nav.state.thread = "previous";
  const request = deferred();
  const state = { pending: undefined, opened: 0 };
  const mark = declaration(activity, "mark", {
    ...f.scope,
    beginNavigation: f.nav.invalidateNavigation,
    actionGate: { current: createLatestRequest() },
    setPending: (value) => {
      state.pending = value;
    },
    setError: noop,
    onOpen: (value) => {
      state.opened++;
      f.open(value);
    },
    client: { request: () => request.promise },
    result: { refresh: noop },
  });
  const opening = mark(
    {
      key: "next-thread",
      roomId: "room",
      rootMessageId: "next",
      latestMessage: { messageId: "next-reply" },
      target: {
        kind: "message",
        roomId: "room",
        rootMessageId: "next",
        messageId: "next-reply",
      },
    },
    "read",
    true,
  );
  jsx(app, "onClose", "messageContext?.message.threadId", {
    ...f.scope,
    activeThreadRootMessageId: "previous",
    messageContext: { message: { threadId: "previous" } },
    restoreThreadFocus: noop,
  })();
  request.resolve({});
  await opening;
  assert.equal(state.opened, 0);
  assert.equal(f.nav.state.thread, undefined);
  assert.equal(
    state.pending,
    undefined,
    "an invalid target still needs to release its own action status without clearing a newer action",
  );
});

test("changing Activity filters after a Thread opens preserves the current exact route, not its pre-open snapshot", async () => {
  const f = activityRouteFixture();
  const filters = declaration(activity, "useFilters", {
    window: f.window,
    normalizeDiscoveryParams,
    useState: (initial) => [
      typeof initial === "function" ? initial() : initial,
      noop,
    ],
    useEffect: noop,
  })("activity");
  await f.open({
    surface: "activity",
    target: {
      kind: "message",
      roomId: "room",
      rootMessageId: "root",
      messageId: "reply",
    },
  });
  filters.change("filter", ["unread"]);
  assert.equal(f.window.location.searchParams.get("filter"), "unread");
  assert.equal(f.window.location.searchParams.get("room"), "room");
  assert.equal(f.window.location.searchParams.get("thread"), "room:root");
  assert.equal(f.window.location.searchParams.get("message"), "reply");
});

test("changing Activity filters after Thread close cannot resurrect stale route identities", () => {
  const f = activityRouteFixture(
    "?surface=activity&filter=mentions&room=room&thread=room%3Aroot&message=reply",
  );
  const filters = declaration(activity, "useFilters", {
    window: f.window,
    normalizeDiscoveryParams,
    useState: (initial) => [
      typeof initial === "function" ? initial() : initial,
      noop,
    ],
    useEffect: noop,
  })("activity");
  f.window.history.replaceState(
    null,
    "",
    "?surface=activity&filter=mentions&room=room",
  );
  filters.change("filter", ["unread"]);
  assert.equal(f.window.location.searchParams.get("room"), "room");
  assert.equal(f.window.location.searchParams.get("thread"), null);
  assert.equal(f.window.location.searchParams.get("message"), null);
});

test("clearing Activity filters preserves a currently open exact Thread route", async () => {
  const f = activityRouteFixture();
  const filters = declaration(activity, "useFilters", {
    window: f.window,
    normalizeDiscoveryParams,
    useState: (initial) => [
      typeof initial === "function" ? initial() : initial,
      noop,
    ],
    useEffect: noop,
  })("activity");
  await f.open({
    surface: "activity",
    target: {
      kind: "message",
      roomId: "room",
      rootMessageId: "root",
      messageId: "reply",
    },
  });
  filters.clear();
  assert.equal(f.window.location.searchParams.get("filter"), null);
  assert.equal(f.window.location.searchParams.get("room"), "room");
  assert.equal(f.window.location.searchParams.get("thread"), "room:root");
  assert.equal(f.window.location.searchParams.get("message"), "reply");
});

test("Inbox cleanup clears the active deadline even when the transport never settles", async () => {
  let signal,
    calls = 0;
  const f = inboxFixture((_, __, options) => {
    calls++;
    signal = options.signal;
    return new Promise(() => {});
  });
  const cleanup = f.start();
  assert.equal(f.timers.size, 1);
  cleanup();
  assert.equal(signal.aborted, true);
  assert.equal(f.windowEvents.size + f.documentEvents.size, 0);
  assert.equal(
    f.timers.size,
    0,
    "unmount must cancel the active deadline as well as the periodic timer",
  );
  await f.advance(30000);
  assert.equal(calls, 1);
  assert.deepEqual(f.state.requests, []);
  assert.equal(f.state.error, undefined);
});

test("Inbox reconciles a later asynchronous InputRequest within five visible seconds without reload", async () => {
  let requests = [],
    calls = 0;
  const f = inboxFixture(async () => {
    calls++;
    return { inputRequests: requests };
  });
  const cleanup = f.start();
  try {
    await flushMicrotasks();
    assert.equal(calls, 1);
    assert.deepEqual(f.state.requests, []);
    requests = [pendingQuestion];
    await f.advance(5000);
    assert.deepEqual(
      f.state.requests.map((item) => item.inputRequestId),
      ["question"],
    );
    assert.equal(calls, 2);
  } finally {
    cleanup();
  }
  await f.advance(30000);
  assert.equal(calls, 2, "cleanup stops periodic and focus reconciliation");
  assert.equal(f.windowEvents.size + f.documentEvents.size, 0);
});

test("aborted old Inbox refresh cannot repopulate state after its Room/client scope is replaced", async () => {
  const response = deferred(),
    controller = new AbortController();
  const f = inboxFixture(() => response.promise);
  const old = f.scope.refreshHumanInbox(controller.signal);
  controller.abort();
  response.resolve({ inputRequests: [pendingQuestion] });
  await old;
  assert.deepEqual(
    f.state.requests,
    [],
    "late success cannot write an old Human's pending requests",
  );
  assert.equal(f.state.error, undefined);
});

test("Inbox refresh is single-flight, uses the hidden interval, and wakes on visible focus", async () => {
  const response = deferred();
  let calls = 0;
  const f = inboxFixture(() => {
    calls++;
    return calls === 1
      ? response.promise
      : Promise.resolve({ inputRequests: [pendingQuestion] });
  });
  const cleanup = f.start();
  try {
    f.windowEvents.get("focus")?.();
    f.windowEvents.get("focus")?.();
    await f.advance(5000);
    assert.equal(
      calls,
      1,
      "focus and timers must not overlap an in-flight read",
    );
    f.scope.document.visibilityState = "hidden";
    response.resolve({ inputRequests: [] });
    await flushMicrotasks();
    await f.advance(14999);
    assert.equal(calls, 1);
    await f.advance(1);
    assert.equal(calls, 2, "hidden reconciliation must eventually run");
    f.scope.document.visibilityState = "visible";
    f.documentEvents.get("visibilitychange")?.();
    f.windowEvents.get("focus")?.();
    await flushMicrotasks();
    assert.equal(
      calls,
      3,
      "visibility/focus burst produces one immediate refresh",
    );
    assert.deepEqual(
      f.state.requests.map((item) => item.inputRequestId),
      ["question"],
    );
  } finally {
    cleanup();
  }
  assert.equal(f.timers.size, 0);
  assert.equal(f.windowEvents.size + f.documentEvents.size, 0);
});

test("Inbox transient failure recovers without reload and clears only read-model error state", async () => {
  let calls = 0;
  const f = inboxFixture(async () => {
    if (++calls === 1) throw new Error("temporary list failure");
    return { inputRequests: [pendingQuestion] };
  });
  const cleanup = f.start();
  try {
    await flushMicrotasks();
    assert.match(f.state.error, /temporary list failure/);
    await f.advance(5000);
    assert.equal(calls, 2);
    assert.equal(f.state.error, undefined);
    assert.deepEqual(
      f.state.requests.map((item) => item.inputRequestId),
      ["question"],
    );
  } finally {
    cleanup();
  }
});
