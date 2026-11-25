import assert from 'node:assert/strict';
import { test } from 'node:test';

const now = () => Date.parse('2026-01-15T12:00:00Z');
const root = 'a'.repeat(39) + '1';
const laterRoot = 'a'.repeat(39) + '2';
const rewrittenRoot = 'c'.repeat(40);
const checkout = '/fixtures/Atlas';
const linked = '/fixtures/Atlas-linked';
const moved = '/fixtures/Atlas-moved';
const commonDir = checkout + '/.git';
const remote = 'https://git.example.test:8443/Team/Atlas';
const fork = 'https://git.example.test:8443/Fork/Atlas';
const syntheticUser = 'fixture-url-user';
const syntheticPassword = 'fixture-url-password';

const git = (overrides = {}) => ({
  worktreeRoot: checkout, commonDir, roots: [laterRoot, root], remote, shallow: false, ...overrides,
});

function identifyWith(identifyProject, path, { canonical = path, repository = null, directoryId } = {}) {
  return identifyProject(path, {
    now,
    realpath: candidate => {
      assert.equal(candidate, path);
      return canonical;
    },
    inspectGit: candidate => {
      assert.equal(candidate, canonical);
      return repository;
    },
    directoryId: () => directoryId,
  });
}

test('U12 stable project keys across roots, remotes, subpaths and worktrees', async () => {
  const { identifyProject } = await import('./identity.mjs');
  const identify = (path, facts) => identifyWith(identifyProject, path, facts);
  const rawRemote = 'https://' + syntheticUser + ':' + syntheticPassword +
    '@GIT.Example.Test:8443/Team/Atlas.git/';
  const raw = await identify(checkout, { repository: git({ remote: rawRemote }) });
  const normalized = await identify(checkout, { repository: git({ roots: [root, laterRoot] }) });
  for (const result of [raw, normalized]) {
    assert.ok(result.key);
    assert.equal(result.rootSha, root);
    assert.equal(result.remote, remote);
    const receipt = JSON.stringify(result.receipt);
    assert.equal(typeof receipt, 'string');
    for (const credential of [syntheticUser, syntheticPassword]) {
      assert.equal(receipt.includes(credential), false, 'identity receipt exposes URL userinfo');
      assert.equal(JSON.stringify(result.key).includes(credential), false, 'project key exposes URL userinfo');
    }
  }
  assert.deepEqual(raw.key, normalized.key);

  for (const distinctRemote of [fork, remote.replace('/Team/', '/team/'), remote.replace(':8443', ':9443')]) {
    const distinct = await identify(checkout, { repository: git({ remote: distinctRemote }) });
    assert.ok(distinct.key);
    assert.equal(distinct.rootSha, root);
    assert.equal(distinct.remote, distinctRemote);
    assert.notDeepEqual(distinct.key, normalized.key);
  }

  const core = await identify(checkout + '/packages/core', { repository: git() });
  const cli = await identify(checkout + '/packages/cli', { repository: git() });
  assert.ok(core.key && cli.key);
  assert.notDeepEqual(core.key, normalized.key);
  assert.notDeepEqual(cli.key, core.key);
  const linkedGit = git({ worktreeRoot: linked });
  assert.deepEqual((await identify(linked, { repository: linkedGit })).key, normalized.key);
  assert.deepEqual((await identify(linked + '/packages/core', { repository: linkedGit })).key, core.key);

  const alias = await identify('/fixtures/staging/../Notes/', { canonical: '/fixtures/Notes' });
  const canonical = await identify('/fixtures/Notes');
  const other = await identify('/fixtures/Other');
  assert.ok(alias.key && other.key);
  assert.equal(alias.path, '/fixtures/Notes');
  assert.equal(alias.singleCell, true);
  assert.deepEqual(alias.key, canonical.key);
  assert.notDeepEqual(alias.key, other.key);
});

const oldMemory = { id: 'memory-old', revision: 3 };
const oldHistory = { id: 'history-old', memoryId: oldMemory.id, memoryRevision: oldMemory.revision };
const newMemory = { id: 'memory-new', revision: 1 };
const newHistory = { id: 'history-new', memoryId: newMemory.id, memoryRevision: newMemory.revision };

function identityStore(createIdentityStore, identity, extraBindings = [], pathExists = () => true) {
  const bindings = [{ path: checkout, key: identity.key, projectId: 'old', directoryId: identity.directoryId },
    ...extraBindings];
  const sessions = new Map([
    ['super', { role: 'Super' }],
    ['old-auditor', { role: 'Auditor', projectId: 'old' }],
  ]);
  const records = new Map([['old', { memory: [oldMemory], history: [oldHistory] }]]);
  return createIdentityStore({ bindings, now, pathExists, sessions, records: structuredClone(records) });
}

async function assertOldRecords(store) {
  assert.deepEqual(await store.readProject('old', { sessionId: 'old-auditor' }), {
    memory: [oldMemory], history: [oldHistory],
  });
}

test('U13 automatically migrates a unique in-place path-to-Git binding', async () => {
  const { identifyProject, createIdentityStore } = await import('./identity.mjs');
  const old = await identifyWith(identifyProject, checkout);
  const discovered = await identifyWith(identifyProject, checkout, { repository: git() });
  assert.notDeepEqual(old.key, discovered.key);
  const store = identityStore(createIdentityStore, old);
  await store.reconcile(discovered);
  const upgraded = await store.bindingAt(checkout);
  assert.deepEqual(upgraded.key, discovered.key);
  assert.equal(upgraded.projectId, 'old');
  await assertOldRecords(store);
});

const movedGit = git({ worktreeRoot: moved, commonDir: moved + '/.git' });
const transfers = [
  { name: 'competing old bindings', path: checkout, before: null, after: git(), competing: true, action: 'bind' },
  { name: 'absolute path move', path: moved, before: null, after: null, action: 'move' },
  { name: 'shallow clone', path: moved, before: git(), after: { ...movedGit, roots: [], shallow: true }, action: 'bind' },
  { name: 'fork', path: moved, before: git(), after: { ...movedGit, remote: fork }, action: 'split' },
  { name: 'history rewrite', path: checkout, before: git(), after: git({ roots: [rewrittenRoot] }), action: 'bind' },
];

for (const { name, path, before, after, competing, action } of transfers) {
  test('U13 requires a Super decision for ' + name, async () => {
    const { identifyProject, createIdentityStore } = await import('./identity.mjs');
    const directoryId = action === 'move' ? 'fixture-directory-id' : undefined;
    const old = await identifyWith(identifyProject, checkout, { repository: before, directoryId });
    const discovered = await identifyWith(identifyProject, path, { repository: after, directoryId });
    const extra = competing ? [{ path: linked, key: discovered.key, projectId: 'other' }] : [];
    const store = identityStore(createIdentityStore, old, extra, candidate => action !== 'move' || candidate !== checkout);
    const competingBinding = competing ? structuredClone(await store.bindingAt(linked)) : undefined;
    const unauthorized = await store.readProject('unknown', { sessionId: 'unbound' });
    assert.deepEqual(await store.readProject('old', { sessionId: 'unbound' }), unauthorized);

    const pending = await store.reconcile(discovered);
    assert.ok(['orphan', 'pending'].includes(pending.status));
    if (action === 'move') {
      assert.equal(pending.status, 'orphan');
      assert.ok(pending.candidates.some(candidate => candidate.projectId === 'old'));
      const reader = await store.bindSession({ role: 'Auditor', path });
      if (reader) {
        assert.deepEqual(await store.readProject('old', { sessionId: reader }), unauthorized);
      }
    }
    const decision = { action, projectId: 'old' };
    for (const options of [{ decision }, { decision, sessionId: 'old-auditor' }]) {
      const stillBound = await store.bindingAt(checkout);
      assert.deepEqual(stillBound.key, old.key);
      assert.equal(stillBound.projectId, 'old');
      if (path !== checkout) assert.equal(await store.bindingAt(path), undefined);
      if (competing) assert.deepEqual(await store.bindingAt(linked), competingBinding);
      assert.deepEqual(await store.readProject('old', { sessionId: 'unbound' }), unauthorized);
      await store.reconcile(discovered, options);
    }
    assert.deepEqual((await store.bindingAt(checkout)).key, old.key);
    if (path !== checkout) assert.equal(await store.bindingAt(path), undefined);
    assert.deepEqual(await store.readProject('old', { sessionId: 'unbound' }), unauthorized);
    await assertOldRecords(store);

    await store.reconcile(discovered, { decision, sessionId: 'super' });
    const confirmed = await store.bindingAt(path);
    if (action !== 'bind') assert.deepEqual(confirmed.key, discovered.key);
    await assertOldRecords(store);
    const sessionId = await store.bindSession({ role: 'Auditor', path });
    if (action === 'split') {
      assert.ok(confirmed.projectId);
      assert.notEqual(confirmed.projectId, 'old');
      assert.deepEqual(await store.readProject(confirmed.projectId, { sessionId }), { memory: [], history: [] });
      const newRecords = { memory: [newMemory], history: [newHistory] };
      await store.recordProjectData(confirmed.projectId, structuredClone(newRecords));
      assert.deepEqual(await store.readProject(confirmed.projectId, { sessionId }), newRecords);
      for (const [reader, foreign] of [[sessionId, 'old'], ['old-auditor', confirmed.projectId]]) {
        assert.deepEqual(await store.readProject(foreign, { sessionId: reader }),
          await store.readProject('unknown', { sessionId: reader }));
      }
      await assertOldRecords(store);
    } else {
      assert.equal(confirmed.projectId, 'old');
      assert.deepEqual(await store.readProject('old', { sessionId }), { memory: [oldMemory], history: [oldHistory] });
    }
  });
}

const codexKeys = ['features.memories', 'memories.generate_memories', 'memories.use_memories'];
const home = '/fixtures/home';
const knowledge = home + '/.gemini/antigravity-cli/knowledge';
const instructions = new Map([
  [checkout + '/CLAUDE.md', 'Claude project instruction fixture'],
  [checkout + '/AGENTS.md', 'Project agent instruction fixture'],
]);
const providers = ['claude', 'codex', 'agy', 'opencode'];
const userConfig = Object.freeze({
  autoMemoryEnabled: true,
  features: Object.freeze({ memories: true }),
  memories: Object.freeze({ generate_memories: true, use_memories: true }),
});

function codexOverrides(launch) {
  const effective = new Map([
    ['features.memories', userConfig.features.memories],
    ['memories.generate_memories', userConfig.memories.generate_memories],
    ['memories.use_memories', userConfig.memories.use_memories],
  ]);
  for (const [index, arg] of launch.argv.entries()) {
    const assignment = arg === '-c' || arg === '--config' ? launch.argv[index + 1] :
      arg.startsWith('--config=') ? arg.slice('--config='.length) : '';
    const match = /^(\S+?)\s*=\s*(true|false)$/.exec(assignment);
    if (match && effective.has(match[1])) effective.set(match[1], match[2] === 'true');
  }
  for (const key of codexKeys) {
    const [section, setting] = key.split('.');
    const value = launch.threadConfig?.[key] ?? launch.threadConfig?.[section]?.[setting];
    if (value !== undefined) effective.set(key, value);
  }
  return Object.fromEntries(effective);
}

for (const mode of ['tui', 'oar', 'resume', 'switch']) {
  test('U19 native memory launch overrides for ' + mode, async () => {
    const launchConfig = await import('./launch-config.mjs');
    const build = {
      tui: launchConfig.buildTuiLaunch, oar: launchConfig.buildOarLaunch,
      resume: launchConfig.buildResumeLaunch, switch: launchConfig.buildSwitchLaunch,
    }[mode];
    for (const provider of providers) {
      const launch = await build({
        provider, cwd: checkout, home, userConfig, sessionId: 'fixture-session',
        previousProvider: mode === 'switch' ? (provider === 'codex' ? 'claude' : 'codex') : provider,
      }, {
        now, readFile: path => instructions.get(path),
        readDir: path => path === knowledge ? ['fixture-item.md'] : [],
      });

      if (provider === 'claude') assert.equal(launch.env.CLAUDE_CODE_DISABLE_AUTO_MEMORY, '1');
      if (provider === 'codex') {
        const overrides = codexOverrides(mode === 'tui' ? { argv: launch.argv } : launch);
        assert.deepEqual(overrides, Object.fromEntries(codexKeys.map(key => [key, false])));
      }
      if (provider === 'agy' || provider === 'opencode') assert.equal(launch.coverage, 'not covered');
      if (provider === 'agy') {
        assert.ok(launch.warnings.some(warning => warning.path === knowledge && warning.recipient === 'Super'));
      }
      if (provider === 'opencode') assert.equal(launch.env.OPENCODE_DISABLE_CLAUDE_CODE_SKILLS, '1');
      const instruction = { claude: 'CLAUDE.md', codex: 'AGENTS.md', opencode: 'AGENTS.md' }[provider];
      if (instruction) assert.ok(launch.instructionFiles.includes(checkout + '/' + instruction));
    }
  });
}
