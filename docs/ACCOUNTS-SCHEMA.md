# `loom accounts --json` contract

The root object has an `accounts` array. Each entry describes one provider account and may have several quota windows. Accounts for the same CLI appear as separate entries. Multiple model-specific buckets can share a duration.

| Account field | JSON type | Meaning |
| --- | --- | --- |
| `cli` | string | Provider CLI short name, such as `codex`, `claude` or `agy` |
| `accountMasked` | string or null | One visible local-part character followed by three asterisks and the domain, such as `c***@example.test` |
| `plan` | string or null | Display label, such as `Pro`, `Max 5x` or `Google AI Ultra` |
| `active` | boolean or null | Whether the CLI is using the account |
| `resetCredits` | nonnegative integer or null | Available reset credits |
| `expiresAt` | timestamp or null | Account or plan expiry |
| `windows` | array | Latest snapshots per quota window. An empty array signals that the account has no quota snapshot. |

| Window field | JSON type | Meaning |
| --- | --- | --- |
| `id` | string | Stable bucket ID within an account |
| `label` | string | Display label, such as `5h`, `周` or `Fable 周` |
| `kind` | string | `5h`, `weekly` or `model` |
| `model` | string or null | Optional model or shared model group, such as `Claude/GPT` |
| `usedPercent` | number or null | Quota consumed as a percentage from 0 through 100 |
| `windowMinutes` | positive integer or null | Duration in minutes, such as 300 for 5 hours or 10080 for 7 days |
| `resetsAt` | timestamp or null | When the recorded window resets |
| `source` | string | Identifier for the source of the observation |
| `observedAt` | timestamp or null | When the source reported this value |

Use ISO 8601 timestamps with an explicit offset. Nullable fields can be omitted. Keep zero-valued observations and credits. Mask account identifiers before serializing them. Keep provider credentials out of the payload.

```json
{
  "accounts": [
    {
      "cli": "codex",
      "accountMasked": "c***@example.test",
      "plan": "Pro",
      "active": true,
      "resetCredits": 3,
      "expiresAt": "2026-11-28T14:00:00Z",
      "windows": [
        {
          "id": "primary",
          "label": "5h",
          "kind": "5h",
          "usedPercent": 59,
          "windowMinutes": 300,
          "resetsAt": "2026-11-26T16:22:00Z",
          "source": "fixture",
          "observedAt": "2026-11-26T13:56:00Z"
        }
      ]
    }
  ]
}
```

The TUI accepts this root object at `board.accounts`. The v1 fixture exercises it there. Before CELL-ACCT-1 connects the producer, the daemon can omit the field and the TUI displays a placeholder. The refresh key reloads the board snapshot.

The bar fill is used quota. The pace marker is the elapsed fraction of the current window, calculated from the current time, reset timestamp and window duration. The display marks a snapshot stale after two hours or once its recorded reset has passed. It shows the shortest upcoming reset per account.
