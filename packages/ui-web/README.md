# RAH Neo-Brutalist UI — components and templates

This package retains its existing typed view-model exports and owns shared
browser primitives under `src/neo-brutalist`. It is not a second application,
transport or store. Read the [standard](../../docs/design/neo-brutalist-ui.md)
and [catalog](../ui-tokens/neo-brutalist-library.json).

## Controlled composition

```tsx
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { PanelTabs } from "@rah-os/ui-web/neo-brutalist/panel-tabs";

// Load @rah-os/ui-tokens/neo-brutalist.css once in the app entry.
// State and callbacks come from the existing product owner.
<>
  <PanelHeader kind="conversation">
    <h1>Project room</h1>
    <PanelHeaderAction aria-label="Room settings" onClick={openSettings}>
      <Icon name="settings" />
    </PanelHeaderAction>
  </PanelHeader>
  <PanelTabs
    label="Room views"
    value={view}
    onSelect={selectView}
    items={[
      { id: "chat", label: "Chat", icon: "chat" },
      { id: "tasks", label: "Tasks", icon: "task", disabled: !canReadTasks },
    ]}
  />
</>;
```

The `kind` slot carries geometry, not business meaning. Header actions retain
native button props/ref and expose `pending`. Tabs do not determine capabilities
or route state. PanelResizer receives bounds, clamp/key policies and change/commit
callbacks from the existing panel owner.

## Executable templates

The catalog points to production `ChannelHeader`, `AgentDetailHeader/AgentTabList`
and the integrated resizable workspace. Examples in
`apps/web/test/ui-foundations.tsx` are exercised by `npm run test:web:foundations`.
They import these primitives directly; there are no copied demo components.

Keep browser subpaths separate from the bare package entry so headless view-model
consumers do not acquire DOM/React requirements. Never import `apps/web` into
these primitives. Translation, authorization, SDK requests, width persistence
and canonical state remain caller-owned.
