import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { generateMemberFlow } from "./generate-member-flow.mjs";
test("member presentation is generated from locked official strip, page and picker source", () => {
  assert.equal(
    readFileSync(
      "frontends/raft/loom/OfficialMemberFlow.generated.tsx",
      "utf8",
    ),
    generateMemberFlow(),
  );
  const host = readFileSync("frontends/raft/loom/ChannelMembers.tsx", "utf8");
  assert.match(host, /MembersStrip/);
  assert.match(host, /MemberPage/);
  assert.match(host, /MemberPicker/);
  assert.doesNotMatch(host, /useAgentStore|useChannelStore/);
  const control=readFileSync("frontends/raft/loom/ChannelControl.tsx","utf8");
  assert.match(control,/channel-overflow-title-text/);
});
