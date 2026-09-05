# RAH Neo-Brutalist UI — components and templates

This package retains its existing typed view-model exports and owns shared
browser primitives under `src/neo-brutalist`. It is not a second application,
transport or store. Read the [standard](../../docs/design/neo-brutalist-ui.md)
and [catalog](../ui-tokens/neo-brutalist-library.json).

## Controlled composition

```tsx
import { Icon } from "@rah-os/ui-web/neo-brutalist/icon";
import { PanelHeader } from "@rah-os/ui-web/neo-brutalist/panel-header";
import { PanelHeaderIcon } from "@rah-os/ui-web/neo-brutalist/panel-header-icon";
import { PanelHeaderAction } from "@rah-os/ui-web/neo-brutalist/panel-header-action";
import { PanelTabs } from "@rah-os/ui-web/neo-brutalist/panel-tabs";

// Load @rah-os/ui-tokens/neo-brutalist.css once in the app entry.
// State and callbacks come from the existing product owner.
<>
  <PanelHeader kind="conversation">
    <PanelHeaderIcon name="hash" glyphSize={14} />
    <h1 className="rah-panel-title">Project room</h1>
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

Use `kind="sidebar"` for navigation and `kind="surface"` for page headers.
They share the 62px / compact-height 48px track. `PanelHeaderIcon` is a 36px
non-interactive identity tile, not an Agent avatar. Back actions use the official
arrow-left glyph; do not rotate a chevron or add page-specific SVG sizing.
`PanelHeaderAction size="compact"` provides the source-backed 24px/12px clear
action used inside Search's title slot. The default remains the 28px/14px header
action. Neither variant owns query state or navigation.

## Executable templates

The catalog points to production `ChannelHeader`, `AgentDetailHeader/AgentTabList`
and the integrated resizable workspace, including Saved/Search title slots.
Examples in
`apps/web/test/ui-foundations.tsx` are exercised by `npm run test:web:foundations`.
They import these primitives directly; there are no copied demo components.

`EntityCard` owns the bordered identity row (name/runtime/trailing state) with
native click/disabled behavior. The app's `AgentEntityCard` binds the existing
authorized Agent view and shared presence projector. `EmptyState` exposes named
`search`/`profile` contexts and `fill`/`section` placement. Loading and errors are
caller states, never interpreted by a presentation component. Their production
combinations are exercised by `scripts/ui-body-browser-scenarios.mjs`.

Keep browser subpaths separate from the bare package entry so headless view-model
consumers do not acquire DOM/React requirements. Never import `apps/web` into
these primitives. Translation, authorization, SDK requests, width persistence
and canonical state remain caller-owned.
