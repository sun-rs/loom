import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {generateProfile} from './generate-profile.mjs';
test('profile helpers are exact official declarations and Role composition separates identity, prompt and configuration',()=>{
 assert.equal(readFileSync('frontends/raft/loom/OfficialProfile.generated.tsx','utf8'),generateProfile());
 const source=readFileSync('frontends/raft/loom/RoleProfile.tsx','utf8');
 for(const id of ['role-profile-hero','role-profile-identity','role-profile-prompt','role-profile-runtime'])assert.ok(source.includes(id));
 assert.match(source,/<AgentHeaderName/);assert.match(source,/<Separator/);
 assert.doesNotMatch(source,/field: "displayName"|field: "instructions"/);
});
