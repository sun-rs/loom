import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
const read = (p) => readFileSync("frontends/raft/" + p, "utf8");
test("task and activity source views are reproducible with explicit Loom slots", async () => {
  const { generateCloseout } =
    await import("./generate-discovery-task-closeout.mjs");
  for (const [name, source] of Object.entries(generateCloseout()))
    assert.equal(read("loom/" + name), source, name);
  for (const [path, pattern] of [
    ["loom/TaskFilterPicker.tsx", /OfficialTaskFilter/],
    ["loom/TaskDetail.tsx", /OfficialTaskSurface/],
    ["loom/TasksPage.tsx", /OfficialTaskToolbar/],
    ["loom/TaskProperties.tsx", /OfficialTaskProperties/],
    ["loom/TaskHistory.tsx", /OfficialTaskHistoryFrame/],
    ["loom/ActivityHeader.tsx", /OfficialActivityHeader/],
    [
      "packages/web/src/components/task/CreateTaskDialog.tsx",
      /OfficialTaskCreate.generated/,
    ],
  ])
    assert.match(read(path), pattern);
  assert.doesNotMatch(
    read("loom/vite.config.ts"),
    /adaptTaskCreation|loom-task-create/,
  );
  assert.doesNotMatch(read("loom/TaskFilterPicker.tsx"), /className=/);
  assert.doesNotMatch(
    read("loom/TaskDetail.tsx"),
    /rounded-lg|shadow-raft-xl|<ArrowLeft|<CloseButton/,
  );
});
test("creation preserves frozen batch, disabled form and unknown-write verification", () => {
  const s = read("loom/OfficialTaskCreate.generated.tsx");
  assert.match(s, /useTaskCreation/);
  assert.match(s, /<fieldset disabled=\{submitting\}/);
  assert.match(s, /\{verification\}/);
  assert.match(read("loom/TaskCreate.tsx"), /createTaskBatch/);
});
test("discovery failure keeps true local cause and uses native warning surface", () => {
  const s = read("loom/DiscoveryPage.tsx");
  assert.match(s, /<DiscoveryNotice/);
  assert.doesNotMatch(s, /<div role="alert" className="p-[34]">/);
});

test('activity counts never send unknown strings into ICU numeric plural formatting',async()=>{
 const ts=(await import('typescript')).default;
 const vm=await import('node:vm');
 const source=read('loom/OfficialActivityHeader.generated.tsx');
 const module={exports:{}};
 const numericFormatter=({id},values)=>{
   if(id==='thread.header.subtitle'){
     assert.equal(typeof values.activeCount,'number');
     assert.equal(typeof values.unreadCount,'number');
     return `${values.activeCount}/${values.unreadCount}`;
   }
   return id;
 };
 vm.runInNewContext(ts.transpileModule(source,{compilerOptions:{module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText,{
   exports:module.exports,require:(id)=>id==='react/jsx-runtime'?{jsx:(type,props)=>({type,props}),jsxs:(type,props)=>({type,props})}:id==='react-intl'?{useIntl:()=>({formatMessage:numericFormatter})}:{}
 });
 const header=module.exports.OfficialActivityHeader;
 assert.equal(header({totalCount:undefined,totalUnreadCount:undefined,unknownSubtitle:'—'}).props.subtitle,'—');
 assert.equal(header({totalCount:4,totalUnreadCount:2}).props.subtitle,'4/2');
});
