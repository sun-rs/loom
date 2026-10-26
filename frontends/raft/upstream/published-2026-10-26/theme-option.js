// Official SettingsPanel 1.21.34 qa/Ja; formatting only. Import/export bindings are Loom glue.
import * as Q from "react";
import * as $ from "react/jsx-runtime";
import {RadioGroupItem as Fi,Card as Y,Badge as q} from "raft-ui";
import {Check as zr} from "lucide-react";
function qa({
  theme: e,
  mode: t,
  label: n,
  selected: r,
  hint: i,
  proBadge: a,
  onSelect: o,
}) {
  let s = (0, Q.useCallback)(() => o(e), [o, e]);
  return (0, $.jsxs)(`div`, {
    className: `group min-w-0`,
    "data-testid": `server-theme-${e}`,
    children: [
      (0, $.jsx)(Fi, {
        appearance: `none`,
        value: e,
        "aria-label": n,
        className: `peer`,
      }),
      (0, $.jsxs)(Y, {
        onClick: s,
        className: [
          `h-full gap-2 p-2`,
          `hover:overlay-subtle active:overlay-medium`,
          `peer-focus-visible:shadow-focus`,
          `peer-data-checked:border-[1.5px] peer-data-checked:border-line-strong peer-data-checked:p-[7.5px]`,
        ].join(` `),
        children: [
          (0, $.jsx)(Ja, { theme: e, mode: t }),
          (0, $.jsxs)(`div`, {
            className: `flex min-w-0 items-center gap-1.5 px-1 pb-0.5`,
            children: [
              (0, $.jsx)(`span`, {
                className: `min-w-0 truncate text-callout font-semibold text-foreground`,
                children: n,
              }),
              i
                ? (0, $.jsx)(`span`, {
                    className: `shrink-0 text-footnote text-foreground-hint`,
                    children: i,
                  })
                : null,
              a ? (0, $.jsx)(q, { className: `shrink-0`, children: a }) : null,
              r
                ? (0, $.jsx)(zr, {
                    size: 16,
                    className: `ml-auto shrink-0 text-foreground`,
                    "aria-hidden": `true`,
                  })
                : null,
            ],
          }),
        ],
      }),
    ],
  });
}
function Ja({ theme: e, mode: t }) {
  return (0, $.jsxs)(`div`, {
    className: `${t} flex aspect-[16/10] flex-col overflow-hidden rounded-control border border-line-seam bg-layer-frame`,
    "data-theme": e === `raft` ? void 0 : e,
    "aria-hidden": `true`,
    "data-testid": `server-theme-preview-${e}`,
    children: [
      (0, $.jsx)(`div`, {
        className: `h-3 shrink-0 border-b border-line-seam bg-layer-frame`,
      }),
      (0, $.jsxs)(`div`, {
        className: `flex min-h-0 flex-1`,
        children: [
          (0, $.jsx)(`div`, {
            className: `w-3 shrink-0 border-r border-line-seam bg-layer-frame`,
          }),
          (0, $.jsxs)(`div`, {
            className: `flex w-1/3 shrink-0 flex-col gap-1 border-r border-line-seam bg-layer-sidebar p-1.5`,
            children: [
              (0, $.jsx)(`div`, {
                className: `h-1.5 w-3/4 rounded-[2px] bg-foreground/30`,
              }),
              (0, $.jsx)(`div`, {
                className: `h-2.5 rounded-[3px] border border-sticker-ink bg-brand`,
              }),
              (0, $.jsx)(`div`, {
                className: `h-1.5 w-2/3 rounded-[2px] bg-foreground/15`,
              }),
            ],
          }),
          (0, $.jsxs)(`div`, {
            className: `flex min-w-0 flex-1 flex-col gap-1.5 bg-layer-canvas p-2`,
            children: [
              (0, $.jsx)(`div`, {
                className: `h-1.5 w-1/2 rounded-[2px] bg-foreground/40`,
              }),
              (0, $.jsx)(`div`, {
                className: `h-1.5 w-3/4 rounded-[2px] bg-foreground/15`,
              }),
              (0, $.jsx)(`div`, {
                className: `h-1.5 w-2/3 rounded-[2px] bg-foreground/15`,
              }),
            ],
          }),
        ],
      }),
    ],
  });
}

export {qa as OfficialThemeOption};
