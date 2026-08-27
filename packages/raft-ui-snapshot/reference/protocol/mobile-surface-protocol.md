# Mobile surface evidence protocol

Last calibrated: 2026-08-26. Official Web build:
`666bab60d8658d9e382e2c286ce1e423231e8f31`.

## Evidence ownership

Mobile is one product protocol with two renderers, not one screenshot scaled into
another renderer:

1. **Web/PWA pixels and behavior** come from the published Raft CSS/JS bundle,
   live Web DOM/computed styles and live Web interaction captures. These sources
   own CSS dimensions, fonts, colors, borders, shadows, hover/focus/press states,
   safe-area handling and `visualViewport` keyboard behavior.
2. **Native iOS screenshots** own native information architecture, navigation
   order, native-only state and safe-area intent. They do not own Web viewport
   dimensions, OS status-bar pixels, native font rasterization or Web CSS.
3. **Local fixture content** exists only to exercise the reference UI. It cannot
   introduce a second interaction or data protocol and never becomes backend
   truth.

`slack.html` is the current responsive Web/PWA reference route. `mobile.html` is
an early component gallery and is not a release-bearing application route.

## Source-backed Web/PWA contract

- Root viewport: fixed shell using `top: var(--vv-offset-top, 0px)` and
  `height: var(--vv-height, 100dvh)`; editable focus plus a visual viewport loss
  greater than 100px activates the variables.
- Channel header: 62px high, 20px inline padding, 12px gap, 2px bottom border.
- Channel tabs: each tab is 76×28px; tablist total height is 30px including its
  2px bottom border.
- Mobile notification: `flex-wrap`, 8px gap/padding, 2px border, 16px icon,
  28px close control and a full-width 28px CTA. The resulting fixed fixture card
  is 90px high.
- Composer form: 2px top border, 12px top/inline padding and 16px plus safe-area
  bottom padding. Mobile textarea is 16px/20px with a 20px minimum height; the
  fixed fixture composer box is 76px and its form is 106px before a non-zero
  device safe area.
- Disabled Send keeps the official pink fill, 2px border and hard shadow and
  applies only 30% opacity plus pointer-event suppression.

These claims are enforced in both Chromium and Firefox by
`scripts/raft-ui-mobile-check.py` and are independent from a `rah_os` adapter.

## Existing native iOS evidence inventory

The local authorized set already contains 15 screenshots:

| Image | Evidence captured |
| --- | --- |
| 83 | Home/workspace navigation |
| 84 | Channel conversation |
| 85 | Channel members overlay |
| 86 | Agent direct-message surface |
| 87 | Agent profile/detail |
| 88 | Agent runtime activity/diagnostics |
| 89 | Agent profile information and runtime configuration |
| 90 | Empty channel-task state and bottom navigation |
| 91 | Member list and presence states |
| 92 | Settings information architecture |
| 93 | Activity list and filters |
| 94 | Direct-message loading state and composer |
| 95 | Channel task list |
| 96 | Channel file list |
| 97 | Channel edit modal |

This is sufficient for the current structural pass. Additional screenshots are
useful only as state sequences, preferably before/action/after at the same device
size: software keyboard open and dismissed; long composer growth; overscroll and
return-to-bottom; successful and failed form validation; loading-to-content and
error transitions; context menus/sheets; and rotation or Dynamic Type if those
are intended product requirements.

