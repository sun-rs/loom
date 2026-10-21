import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateAppearance,extractDeclarations} from './generate-appearance.mjs';
test('appearance page is generated from official declarations with only explicit Loom bindings',()=>{
 const actual=readFileSync('frontends/raft/loom/OfficialAppearance.generated.tsx','utf8');
 assert.equal(actual,generateAppearance());
 assert.doesNotMatch(actual,/useServerStore|useAuthStore|billing|fetch\(/);
 assert.match(readFileSync('frontends/raft/loom/SettingsPage.tsx','utf8'),/\.\/OfficialAppearance.generated/);
});
test('source extraction fails closed on changed or missing declaration boundaries',()=>{
 assert.throws(()=>extractDeclarations('const different = 1;',['AppearanceSection']),/AppearanceSection/);
 assert.deepEqual(extractDeclarations('const a = 1;\nfunction x() { return a; }',['x']),['function x() { return a; }']);
});
