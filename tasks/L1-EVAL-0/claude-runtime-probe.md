# claude-runtime-probe

Native ID `829f3da3-2283-4895-851c-c595760ce84b` · claude · 3 turns

Source native TUI transcript

Transcript `/Users/sun/Code/exp-relay/claude-tui-rt-0/probe-profile/projects/-Users-sun-Code-exp-relay-claude-tui-rt-0-probe/829f3da3-2283-4895-851c-c595760ce84b.jsonl`

Working directory `/Users/sun/Code/exp-relay/claude-tui-rt-0/probe`

| View | UTF-8 bytes | Approx. tokens | Share of transcript |
| --- | ---: | ---: | ---: |
| Native transcript | 95472 | 23868 | 100.00% |
| Native final replies | 44 | 11 | 0.05% |
| L1 with fact rows | 1256 | 314 | 1.32% |
| Activity digest | 466 | 117 | 0.49% |
| Filtered L2 | 1606 | 402 | 1.68% |
| Diff output | 556 | 139 | 0.58% |
| Loom evidence cards | — | — | — |

Approximate tokens are UTF-8 bytes divided by four, rounded up. Counts cover payloads only.

## A. Native final replies

#### Turn 1 · native line 25

~~~text
PROBE_SONNET_OK
~~~

#### Turn 2 · native line 47

~~~text
PROBE_STEER_A PROBE_STEER_B
~~~

#### Turn 3

Native line 55 records "[Request interrupted by user for tool use]". No final reply.

## B. Loom hist L1

Read-only replay through Loom’s history reader and native adapter.

~~~text
829f3da3-2283-4895-851c-c595760ce84b L1

事实 退出码 — · 改动文件 未知 · claims —
第 1 轮 已完成
任务 <hc from="t2zr claudetuirt0">Reply with exactly PROBE_SONNET_O…
工具 0 次
非零退出 0 条
回复 PROBE_SONNET_OK
原件 /Users/sun/Code/exp-relay/claude-tui-rt-0/probe-profile/projects/-Users-sun-Code-exp-relay-claude-tui-rt-0-probe/829f3da3-2283-4895-851c-c595760ce84b.jsonl:6

事实 退出码 0 · 改动文件 未知 · claims —
第 2 轮 已完成
任务 Use Bash to run exactly: sleep 12; printf PROBE_TOOL_DONE. The…
工具 1 次 Bash×1
非零退出 0 条
命令 sleep 12; printf PROBE_TOOL_DONE
回复 PROBE_STEER_A PROBE_STEER_B
原件 /Users/sun/Code/exp-relay/claude-tui-rt-0/probe-profile/projects/-Users-sun-Code-exp-relay-claude-tui-rt-0-probe/829f3da3-2283-4895-851c-c595760ce84b.jsonl:30

事实 退出码 — · 改动文件 未知 · claims —
第 3 轮 已中断
任务 Use Bash to run exactly: sleep 15; printf PROBE_INTERRUPT_DONE…
工具 1 次 Bash×1
非零退出 0 条
命令 sleep 15; printf PROBE_INTERRUPT_DONE
回复 —
原件 /Users/sun/Code/exp-relay/claude-tui-rt-0/probe-profile/projects/-Users-sun-Code-exp-relay-claude-tui-rt-0-probe/829f3da3-2283-4895-851c-c595760ce84b.jsonl:51
~~~

### Activity digest

~~~text
Turn 1 · completed · native transcript
Reply PROBE_SONNET_OK
Files read —
Files written/edited —
Commands —
Tests —

Turn 2 · completed · native transcript
Reply PROBE_STEER_A PROBE_STEER_B
Files read —
Files written/edited —
Commands
  [exit 0] sleep 12; printf PROBE_TOOL_DONE
Tests —

Turn 3 · interrupted · native transcript
Reply —
Files read —
Files written/edited —
Commands
  [exit ?] sleep 15; printf PROBE_INTERRUPT_DONE
Tests —
~~~

## C. Filtered L2 · turn 3

Filters `--turn 3 --tool shell --cmd '^sleep' --tail 2 --outcome aborted`

~~~json
{
  "index": 3,
  "id": "5748b3e7-0c13-4d73-b635-067fc2c79f08",
  "startedAt": "2026-11-24T18:26:25.245Z",
  "endedAt": "2026-11-24T18:26:26.733Z",
  "status": "interrupted",
  "reply": null,
  "usage": {
    "calls": 1,
    "inputTokens": 8271,
    "cachedInputTokens": 8210,
    "cacheWriteInputTokens": 57,
    "outputTokens": 99,
    "reasoningOutputTokens": 0
  },
  "calls": [
    {
      "id": "msg_011ChNDw9ewztXopfVDHC9M8",
      "timestamp": "2026-11-24T18:26:26.536Z",
      "inputTokens": 8271,
      "cachedInputTokens": 8210,
      "cacheWriteInputTokens": 57,
      "outputTokens": 99,
      "reasoningOutputTokens": 0
    }
  ],
  "prompts": [
    "Use Bash to run exactly: sleep 15; printf PROBE_INTERRUPT_DONE. Then say PROBE_UNINTERRUPTED."
  ],
  "transcriptPath": "/Users/sun/Code/exp-relay/claude-tui-rt-0/probe-profile/projects/-Users-sun-Code-exp-relay-claude-tui-rt-0-probe/829f3da3-2283-4895-851c-c595760ce84b.jsonl",
  "lineOffset": 50,
  "startLine": 51,
  "endLine": 58,
  "facts": {
    "exitCodes": [],
    "changedFiles": null,
    "claims": []
  },
  "outcomes": [
    "aborted"
  ],
  "heads": {
    "start": null,
    "end": null
  },
  "tools": [
    {
      "tool": "shell",
      "name": "Bash",
      "command": "sleep 15; printf PROBE_INTERRUPT_DONE",
      "paths": [],
      "exitCode": null,
      "output": "The user doesn't want to proceed with this tool use. The tool use was rejected (eg. if it was a file edit, the new_string was NOT written to the file). STOP what you are doing and wait for the user to tell you how to proceed."
    }
  ],
  "errors": []
}
~~~

## D. Diff output

#### Turn 1

~~~json
{
  "turn": {
    "status": "missing-boundary",
    "base": null,
    "candidate": null
  },
  "task": {
    "status": "missing-boundary",
    "base": null,
    "candidate": null
  }
}
~~~

#### Turn 2

~~~json
{
  "turn": {
    "status": "missing-boundary",
    "base": null,
    "candidate": null
  },
  "task": {
    "status": "missing-boundary",
    "base": null,
    "candidate": null
  }
}
~~~

#### Turn 3

~~~json
{
  "turn": {
    "status": "missing-boundary",
    "base": null,
    "candidate": null
  },
  "task": {
    "status": "missing-boundary",
    "base": null,
    "candidate": null
  }
}
~~~

## E. Evidence

No Loom evidence card is attached to this session’s own turns.
