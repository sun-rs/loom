# Raft UI interaction protocol

`raft:ui-intent` is the single outbound integration seam. Its `detail` is a v1
intent envelope validated by `raft-ui-runtime.js`. Every accepted intent receives
one `pending` state followed by exactly one terminal `succeeded`, `failed`, or
`cancelled` state on `raft:ui-state`.

Protocol v1 is fail-closed: both the domain and action must exist in
`raft-ui-actions.json` and the runtime's locked registry. Adding an action is an
explicit contract change, not an arbitrary event name chosen by a page.

The static reference pages explicitly load `ui/raft-ui-reference-adapter.js`.
The transport-neutral runtime has no fixture fallback: without an adapter it
fails with `ADAPTER_REQUIRED`. A product host installs one typed adapter with
`RaftUI.setAdapter(handler, descriptor)`. The handler must resolve to a plain
JSON object (or `undefined`, which becomes `{}`). Any other value fails with
`INVALID_RESULT`. Throwing or rejecting moves the transaction to failure and
runs the registered optimistic rollback.

```js
const remove = RaftUI.setAdapter(
  async (intent, context) => rahClient.execute(mapIntent(intent), context),
  { kind: 'rah-client', name: 'rah-product-client' }
);
```

The adapter owns product state. Page scripts own only local presentation state.
Installing a `rah-client` adapter on a page marked as a reference surface is
rejected. Temporary test adapters restore the previous adapter when removed, so
tests cannot accidentally leave source comparison pages in product mode. Legacy
page-specific `raft:*` events remain during migration and are not part of the
versioned contract.

The optional bridge under `integrations/rah-os/` has no URL, credential or
command mapping. The product composition injects a `RahClient`, explicit
capability checks and `toCommand` bindings only after the backend schema exists.
`rah-ui-capability-inventory.json` records all 74 current UI intents and marks
which needs are local, readable today, provisional or blocked; those capability
names are requirements, not invented backend endpoints.

Secrets never enter the DOM event envelope. A page passes them through the
transaction's `sensitive` option; only the installed adapter receives the frozen
second argument, and the runtime clears its reference at the terminal state.
Rapidly replaceable requests such as Search use a stable transaction `key`; a
new request terminates the older pending request as `cancelled/SUPERSEDED` so a
late result cannot become the active projection. The adapter context also carries
an `AbortSignal`; cancellation aborts it so transports can stop obsolete work.

Controls declared by `control` or `controls` are transaction-owned while pending.
Native form controls are disabled; links, separators and other non-native controls
receive `aria-disabled`, `aria-busy` and `inert`. A second unrelated transaction
cannot claim the same control. The runtime restores the exact prior state at the
terminal transition. A route that needs a permanent success state uses `commit`;
it runs after that temporary control state has been restored. Permanent
business-state disabling remains the page projection's responsibility.
