import test from 'node:test';import assert from 'node:assert/strict';import {readFileSync,existsSync} from 'node:fs';
test('migration inventory covers every navigation destination and only cites existing implementation owners',()=>{
 const inventory=JSON.parse(readFileSync('frontends/raft/loom/dependency-migration.json','utf8'));
 const nav=readFileSync('frontends/raft/loom/Navigation.tsx','utf8').split('export const destinations = [')[1].split('] as const')[0];
 const ids=[...nav.matchAll(/id: "([^"]+)"/g)].map(m=>m[1]).sort();
 assert.deepEqual(inventory.surfaces.map(s=>s.id).sort(),ids);
 for(const entry of [...inventory.surfaces,...inventory.crossCutting]){
  assert.ok(['mixed','loom-native-composition'].includes(entry.status));
  assert.ok(entry.remaining.length>0);assert.ok(entry.sources.length>0);
  for(const path of entry.sources)assert.ok(existsSync('frontends/raft/'+path),path);
 }
 assert.equal(inventory.wholeSiteDependencyComplete,false);
});
