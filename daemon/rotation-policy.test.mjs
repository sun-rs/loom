import assert from 'node:assert/strict';
import { test } from 'node:test';
import { switchDensity } from './rotation-policy.mjs';
import { rotationSettings } from '../lib/rotation-settings.mjs';

test('v2 switching applies alternative thresholds and relaxes single-mainline dispatches', () => {
  const at = 100_000_000;
  const config = rotationSettings({ rotation: { mode: 'v2', densityRequiresCompaction: false,
    subsystemPrefixes: { 'src/api': 'api' } } });
  const usage = { compactions: 0, afterCompaction: [] };
  const cards = Array.from({ length: 11 }, (_, i) => ({ at, card: String(i), mainline: 'goal', paths: ['src/api/index.js'] }));
  assert.equal(switchDensity(cards, usage, config, 'codex', at).hit, false);
  assert.equal(switchDensity(cards.map((item, i) => ({ ...item, mainline: String(i) })), usage, config, 'codex', at).hit, true);
  assert.equal(switchDensity(cards.slice(0, 5).map((item, i) => ({ ...item, paths: [`unit-${i}/index.js`] })),
    usage, config, 'codex', at).hit, true);
  const afterCompaction = Array.from({ length: 5 }, (_, i) => ({ at: at - i }));
  assert.equal(switchDensity([], { compactions: 5, afterCompaction }, config, 'claude', at).hit, true);
  assert.equal(switchDensity([], { compactions: 5, afterCompaction }, config, 'codex', at).hit, true);
  assert.equal(switchDensity([], { compactions: null, afterCompaction: [] }, config, 'agy', at).compact, null);
  const docs = cards.slice(0, 5).map((item, i) => ({ ...item, paths: [`docs/unit-${i}/detail.md`, 'ledger/rulings.txt'] }));
  assert.equal(switchDensity(docs, usage, config, 'codex', at).subsystems, 0);
  assert.equal(switchDensity(cards, { compactions: 5, afterCompaction }, { ...config, densityRequiresCompaction: true },
    'codex', at).hit, false);
  assert.equal(switchDensity(cards.map((item, i) => ({ ...item, mainline: String(i) })),
    { compactions: 5, afterCompaction }, { ...config, densityRequiresCompaction: true }, 'codex', at).hit, true);
});
