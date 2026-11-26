# 首次派工策略

1. 示例与检查
2. 首派核对

## 示例与检查

```json
{
  "deny": [{"model": "luna"}],
  "roles": {
    "leader": {"maxActiveWorkers": 3, "preferred": [{"cli": "codex", "model": "MODEL", "effort": "high", "mode": "tui"}]},
    "auditor": {"preferred": [{"cli": "codex", "model": "MODEL", "effort": "high", "mode": "tui"}]},
    "worker": {"preferred": [{"cli": "codex", "model": "MODEL", "effort": "high", "mode": "headless"}]}
  }
}
```

按裁决填写 CLI、模型、effort、mode、全局及角色 deny、并发上限。角色额外禁止项放在该角色的 `deny`。

## 首派核对

保存为 `.project/policy.json`。读取首派回执中的 requested、effective、differences。
