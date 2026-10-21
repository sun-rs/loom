import test from "node:test";
import assert from "node:assert/strict";
import {readFileSync} from "node:fs";
import {createHash} from "node:crypto";
const root="frontends/raft/upstream/raft-web-source/";
test("official source dependency preserves exact upstream bytes and import paths",()=>{
 const lock=JSON.parse(readFileSync(root+"source-lock.json","utf8"));
 assert.equal(lock.revision,"db5e399f017d584e49597e3a28757645d6807893");
 for(const [path,digest] of Object.entries(lock.files))assert.equal(createHash("sha256").update(readFileSync(root+path)).digest("hex"),digest,path);
 for(const name of ["Tooltip","CloseButton","EmptyState","SectionHeader","SectionEyebrow"]){
 const shim=readFileSync(`frontends/raft/packages/web/src/components/ui/${name}.tsx`,"utf8");
 assert.match(shim,new RegExp(`@loom/raft-web-source/${name}`));
 assert.doesNotMatch(shim,/className=|<div|<Button/);
 }
});
test("header adapter retains only approved mobile binding, not a second header recipe",()=>{
 const shim=readFileSync("frontends/raft/packages/web/src/components/ui/PanelHeader.tsx","utf8");
 assert.match(shim,/@loom\/raft-web-source\/PanelHeader/);
 assert.doesNotMatch(shim,/<PanelTitle|<PanelActions|<ArrowLeft|<h2/);
});
