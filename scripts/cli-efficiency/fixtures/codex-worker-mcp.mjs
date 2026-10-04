// Minimal response_item fixtures from the installed Codex + real Worker/free
// local fake-provider probe, /tmp/loom-real-worker-mcp-tFVYAg/result.json.
// Corresponding rollout ...01a1065f-a926-7ad0-8483-ee06855ae359.jsonl lines 11/26.
// Exact input/name/type retained; native identities omitted, not authorization
// evidence. This is zero-paid-call transport evidence, not model behavior.
export const workerMcpEvents = [
  {
    timestamp: "2026-10-04T10:04:55.191Z",
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "exec",
      input:
        'text(await tools.mcp__loom_worker__loom_reply({body:"SYNTHETIC_REAL_WORKER_ROUND_1",final:false}));',
    },
  },
  {
    timestamp: "2026-10-04T10:04:55.274Z",
    type: "response_item",
    payload: {
      type: "custom_tool_call",
      name: "exec",
      input:
        'text(await tools.mcp__loom_worker__loom_reply({body:"SYNTHETIC_REAL_WORKER_ROUND_2",final:true}));',
    },
  },
];
