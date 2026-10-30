// GENERATED from complete pinned Web1.21.40. Native declarations/JSX; explicit data and capability slots only.
import * as K from "react";
import * as q from "react/jsx-runtime";
import { useIntl } from "react-intl";
import {
  ChevronRight as R,
  List as Rt,
  LayoutGrid as Er,
  Monitor as ht,
  RefreshCw as bn,
  Plus as gn,
} from "lucide-react";
import {
  Popover as us,
  PopoverTrigger as uc,
  PopoverContent as As,
  PanelNotice as Zl,
  PanelNoticeContent as ml,
  Spinner as ba,
  SegmentedControl as Iu,
  SegmentedControlItem as $i,
  SegmentedControlLabel as Hi,
  Separator as Ao,
  Card as tu,
  CardHeader as xc,
  CardLeading as ms,
  CardTitle as Jr,
  CardTrailing as $c,
  CardDescription as bc,
  CardContent as Xa,
  Button as G,
  SidebarItem as $s,
  SidebarItemIcon as no,
} from "raft-ui";
import kv from "../packages/web/src/components/ui/AvatarSlot.tsx";
import kP from "../packages/web/src/components/ui/PanelHeader.tsx";
import XP from "@loom/raft-web-source/EmptyState";
const captions = {
  "emptyState.noComputersTitle": "还没有计算机",
  "machine.mobile.title": "计算机",
  "machine.mobile.retry": "重试",
  "machine.mobile.refreshErrorSaved": "无法刷新 Computer。正在显示已保存结果。",
  "machine.mobile.loadErrorTitle": "无法加载 Computer",
  "machine.mobile.loadErrorDescription": "请检查连接后重试。",
  "machine.mobile.emptyDescription": "连接一台机器，即可从这里运行 Agent。",
  "machine.mobile.noAttentionTitle": "没有需要关注的计算机",
  "machine.mobile.noAttentionDescription":
    "所有已连接的 Computer 均为最新状态。",
  "machine.mobile.addComputer": "添加 Computer",
  "machine.rack.computerCount": "{count, plural, other {# 台 Computer}}",
  "machine.rack.onlineCount": "{count} 台在线",
  "machine.rack.agentCount": "{count, plural, other {# 个 Agent}}",
  "machine.rack.version": "v{version}",
  "machine.rack.usageMeter": "{runtime} 账户：{usage}",
  "machine.rack.usageMeterStale": "{runtime} 账户：{usage} · 最后已知值",
  "machine.rack.viewAria": "计算机视图",
  "machine.rack.viewList": "列表",
  "machine.rack.viewCards": "卡片",
  "machine.rack.colComputer": "计算机",
  "machine.rack.colAgents": "Agent",
  "machine.rack.colOther": "其他",
  "machine.rack.otherRuntimes": "其他运行时",
  "machine.rack.percentUsed": "已用 {percent}%",
  "machine.rack.usedUp": "已用完",
  "machine.rack.usageUnavailable": "{runtime}：无法获取用量",
  "agent.migration.target.diskUsed": "磁盘已用 {percent}%",
  "agent.migration.target.memoryUsed": "内存已用 {percent}%",
  "agent.migration.target.memory": "内存",
  "agent.migration.target.usedDetail":
    "已用 {percent}% · 剩 {free}，共 {total}",
  "agent.migration.target.memoryUnknown": "暂未上报",
  "agent.migration.target.memoryOffline": "离线，没有内存数据",
  "agent.migration.target.memoryOfflineFor": "离线 {duration}，没有内存数据",
  "agent.migration.target.agents":
    "{count, plural, =0 {没有 Agent} other {# 个 Agent}}",
  "agent.migration.target.agentsHeading": "Agent",
  "agent.migration.target.details": "{name} 的详情",
  "agent.migration.target.disk": "磁盘",
  "agent.migration.target.diskDetail": "剩 {free}，共 {total}",
  "agent.migration.target.diskUnknown": "暂未上报",
  "agent.migration.target.offline": "离线",
  "agent.migration.target.lastReported": "上次上报 {time}",
  "agent.migration.target.diskOffline": "离线，没有磁盘数据",
  "agent.migration.target.diskOfflineFor": "离线 {duration}，没有磁盘数据",
  "agent.migration.target.durationMinutes": "{count} 分钟",
  "agent.migration.target.durationHours": "{count} 小时",
  "agent.migration.target.durationDays": "{count} 天",
  "layout.workingNow.title": "工作中",
  "layout.workingNow.summary": "{count} 个 Agent 工作中",
  "layout.sidebar.staleCountsNotice":
    "未读数可能不是最新的，Raft 恢复后会自动更新。",
  "layout.sidebar.computersOverview": "概览",
};
const loomCaptions = {
  "layout.sidebar.staleCountsNotice": captions[
    "layout.sidebar.staleCountsNotice"
  ].replace("Raft", "Loom"),
  "layout.workingNow.summary": captions["layout.workingNow.summary"].replace(
    "Agent",
    "实例",
  ),
  "machine.rack.agentCount": captions["machine.rack.agentCount"]?.replace(
    "Agent",
    "实例",
  ),
  "machine.rack.colAgents": "实例",
};
function H() {
  const intl = useIntl();
  return {
    formatMessage: (d, v) =>
      intl.formatMessage(
        { ...d, defaultMessage: loomCaptions[d.id] ?? captions[d.id] },
        v,
      ),
  };
}
const WorkingData = K.createContext({
  items: [],
  enabled: true,
  onOpen: () => {},
});
const kq = (select) => select(K.useContext(WorkingData));
const cw = (select) =>
  select({ showLiveAgentActivityBar: K.useContext(WorkingData).enabled });
function FV() {
  const data = K.useContext(WorkingData);
  return K.useMemo(() => ({ toAgent: data.onOpen }), [data.onOpen]);
}
// Loom items carry observed text, never provider transcripts/descriptors.
function XA() {
  throw Error("Unexpected upstream activity descriptor");
}
function Aq({ variant: e = `count`, onFrame: t = !1, className: n = `` }) {
  let r = kq((e) => e.items),
    i = cw((e) => e.showLiveAgentActivityBar),
    { formatMessage: a } = H(),
    [o, s] = (0, K.useState)(!1),
    c = (0, K.useCallback)(() => s(!1), []);
  if (!i || r.length === 0) return null;
  let l = a({ id: `layout.workingNow.summary` }, { count: r.length });
  return (0, q.jsxs)(us, {
    open: o,
    onOpenChange: s,
    children: [
      (0, q.jsxs)(uc, {
        "data-testid": `working-now-summary`,
        "aria-label": l,
        className: [
          `relative inline-flex min-h-8 shrink-0 items-center gap-1.5 rounded-control px-1.5`,
          t
            ? `text-foreground-on-frame transition-colors hover:bg-fill-frame-medium active:bg-fill-frame-medium data-popup-open:bg-fill-frame-medium`
            : `text-foreground transition-colors hover:bg-fill-medium active:bg-fill-medium data-popup-open:bg-fill-medium`,
          `outline-none focus-visible:shadow-focus`,
          `after:absolute after:inset-x-0 after:-inset-y-1.5`,
          e === `full`
            ? `gap-2 pr-2 text-footnote font-semibold`
            : `font-mono text-mono-meta`,
          n,
        ].join(` `),
        children: [
          (0, q.jsx)(jq, { items: r }),
          e === `full` ? l : r.length,
          e === `full`
            ? (0, q.jsx)(R, {
                size: 14,
                "aria-hidden": `true`,
                className: `text-foreground-hint`,
              })
            : null,
        ],
      }),
      o
        ? (0, q.jsx)(As, {
            align: `end`,
            role: `dialog`,
            "aria-label": a({ id: `layout.workingNow.title` }),
            className: `w-[300px] p-0`,
            "data-testid": `working-now-list`,
            children: (0, q.jsx)(BWe, { items: r, onNavigate: c }),
          })
        : null,
    ],
  });
}
function BWe({ items: e, onNavigate: t }) {
  let { formatMessage: n } = H(),
    r = FV(),
    i = (0, K.useCallback)(
      (e) => {
        let n = e.currentTarget.dataset.agentId;
        n && (t(), r.toAgent(n));
      },
      [r, t],
    );
  return (0, q.jsxs)(`div`, {
    className: `flex flex-col`,
    children: [
      (0, q.jsx)(`div`, {
        className: `flex min-h-11 items-center border-b border-line-seam px-4 text-headline`,
        children: n({ id: `layout.workingNow.title` }),
      }),
      (0, q.jsx)(`ul`, {
        className: `flex max-h-[min(60vh,420px)] flex-col overflow-y-auto py-1.5`,
        children: e.map((e) => {
          let t = e.textDescriptor ? XA(n, e.textDescriptor) : e.text;
          return (0, q.jsx)(
            `li`,
            {
              children: (0, q.jsxs)(`button`, {
                type: `button`,
                "data-agent-id": e.agentId,
                onClick: i,
                className: `flex w-full items-start gap-3 px-4 py-2 text-left outline-none hover:bg-brand-soft focus-visible:bg-brand-soft`,
                children: [
                  (0, q.jsx)(kv, {
                    context: `compact-row`,
                    type: `agent`,
                    agentAvatarUrl: e.agentAvatarUrl,
                    presence: e.activity === `error` ? `error` : `busy`,
                  }),
                  (0, q.jsxs)(`span`, {
                    className: `flex min-w-0 flex-1 flex-col`,
                    children: [
                      (0, q.jsx)(`span`, {
                        className: `truncate text-callout font-bold text-foreground`,
                        children: e.agentName,
                      }),
                      (0, q.jsx)(`span`, {
                        className: `line-clamp-2 text-footnote text-foreground-muted`,
                        children: t,
                      }),
                    ],
                  }),
                ],
              }),
            },
            e.agentId,
          );
        }),
      }),
    ],
  });
}
function jq({ items: e, still: t = !1, testId: n = `working-faces` }) {
  return (0, q.jsx)(`span`, {
    className: `flex shrink-0 items-center -stack-x-[5px]`,
    "aria-hidden": `true`,
    "data-testid": n,
    children: e
      .slice(0, RWe)
      .map((e) =>
        (0, q.jsx)(
          `span`,
          {
            className: t
              ? `flex`
              : `flex motion-safe:transition-[opacity,translate] motion-safe:duration-200 motion-safe:ease-slide motion-safe:starting:-translate-x-1 motion-safe:starting:opacity-0`,
            children: (0, q.jsx)(kv, {
              context: `face-stack`,
              type: `agent`,
              agentAvatarUrl: e.agentAvatarUrl,
            }),
          },
          e.agentId,
        ),
      ),
  });
}
const RWe = 3;
const flt = `\0`;
const plt = (0, K.memo)(function ({ agentIdKey: e, description: t }) {
  let { formatMessage: n } = H(),
    r = kq((e) => e.items),
    i = cw((e) => e.showLiveAgentActivityBar),
    a = (0, K.useMemo)(() => {
      if (!i || !e || r.length === 0) return [];
      let t = new Set(e.split(flt));
      return r.filter((e) => t.has(e.agentId));
    }, [e, r, i]),
    o = t ? (0, q.jsx)(Ist, { description: t }) : null;
  return a.length === 0
    ? o
    : (0, q.jsxs)(`span`, {
        className: `flex min-w-0 items-center gap-1.5`,
        "data-testid": `channel-header-working`,
        children: [
          (0, q.jsx)(jq, { items: a }),
          (0, q.jsx)(`span`, {
            className: `shrink-0`,
            children: n(
              { id: `layout.workingNow.summary` },
              { count: a.length },
            ),
          }),
          o
            ? (0, q.jsxs)(q.Fragment, {
                children: [
                  (0, q.jsx)(`span`, { "aria-hidden": `true`, children: `·` }),
                  o,
                ],
              })
            : null,
        ],
      });
});
function Ist({ description: e }) {
  return (0, q.jsx)(`span`, {
    className: `block min-w-0 truncate`,
    "data-testid": `channel-header-description`,
    children: Fst(e).map((e, t) =>
      e.kind === `link`
        ? (0, q.jsx)(
            `a`,
            {
              href: e.value,
              target: `_blank`,
              rel: `noopener noreferrer`,
              className: `rounded-[2px] underline decoration-[1.5px] decoration-foreground-hint underline-offset-[3px] outline-none transition-colors hover:text-foreground hover:decoration-current focus-visible:text-foreground focus-visible:shadow-focus`,
              children: e.value,
            },
            `${t}-${e.value}`,
          )
        : (0, q.jsx)(`span`, { children: e.value }, `${t}-${e.value}`),
    ),
  });
}
function Fst(e) {
  let t = [],
    n = 0;
  for (let r of e.matchAll(kst)) {
    let i = r.index,
      a = r[0];
    l7(t, e.slice(n, i));
    let o = Nst(a);
    (o && Pst(o)
      ? (t.push({ kind: `link`, value: o }), l7(t, a.slice(o.length)))
      : l7(t, a),
      (n = i + a.length));
  }
  return (l7(t, e.slice(n)), t);
}
function l7(e, t) {
  if (!t) return;
  let n = e.at(-1);
  n?.kind === `text` ? (n.value += t) : e.push({ kind: `text`, value: t });
}
function Pst(e) {
  try {
    let t = new URL(e);
    return (
      (t.protocol === `http:` || t.protocol === `https:`) &&
      /[a-z\d]/iu.test(t.hostname)
    );
  } catch {
    return !1;
  }
}
function Nst(e) {
  let t = e.replace(Ast, ``);
  for (; t;) {
    let e = t.at(-1),
      n = e ? jst.get(e) : void 0;
    if (!e || !n || Mst(t, e) <= Mst(t, n)) break;
    t = t.slice(0, -e.length);
  }
  return t;
}
function Mst(e, t) {
  let n = 0;
  for (let r of e) r === t && (n += 1);
  return n;
}
const kst = /https?:\/\/[a-z\d\-._~:/?#@!$&'()*+,;=%\x5b\x5d]+/gi;
const Ast = /[.,!?;:。，！？；：'"“”‘’]+$/u;
const jst = new Map([
  [`)`, `(`],
  [`]`, `[`],
  [`}`, `{`],
  [`）`, `（`],
  [`】`, `【`],
  [`》`, `《`],
]);
function Cft({ testId: e, children: t }) {
  let n = (0, K.useRef)(null),
    [r, i] = (0, K.useState)({ start: !1, end: !1 }),
    a = (0, K.useCallback)(() => {
      let e = n.current;
      if (!e) return;
      let t = e.scrollLeft > 1,
        r = e.scrollLeft + e.clientWidth < e.scrollWidth - 1;
      i((e) => (e.start === t && e.end === r ? e : { start: t, end: r }));
    }, []);
  (0, K.useEffect)(() => {
    let e = n.current;
    if (!e || (a(), typeof ResizeObserver > `u`)) return;
    let t = new ResizeObserver(a);
    return (t.observe(e), () => t.disconnect());
  }, [a]);
  let o = K.Children.count(t);
  (0, K.useLayoutEffect)(a, [a, o]);
  let s =
    r.start && r.end ? `both` : r.start ? `start` : r.end ? `end` : void 0;
  return (0, q.jsx)(`div`, {
    ref: n,
    onScroll: a,
    className: `-m-1 flex min-w-0 items-center gap-1 overflow-x-auto overflow-y-hidden p-1 mask-fade-x [scrollbar-width:thin]`,
    "data-testid": e,
    "data-overflow": s,
    children: t,
  });
}
function Fft({ children: e, ...t }) {
  return (0, q.jsx)(`h3`, { ...t, children: e });
}
const Oft = `w-[252px]`;
const Aft = `w-[184px]`;
const y9 = `w-20`;
const kft = `w-10`;
const _9 = 12;
const Dft = 184;
function Nft(e) {
  let t = [v9, v9];
  (e.usage.length > 0 || e.other.length > 0) && t.push(1);
  for (let n = 0; n < e.usage.length; n++) t.push(v9);
  return (
    e.other.length > 0 && t.push(Eft),
    t.reduce((e, t) => e + t, 0) + _9 * (t.length - 1)
  );
}
function Pft(e) {
  let t = [252, Mft, Nft(e), Dft, 32];
  return t.reduce((e, t) => e + t, 0) + _9 * (t.length - 1) + 40;
}
function Wft({ variant: e, columns: t }) {
  let { formatMessage: n } = H(),
    r = e === `desktop`,
    i = (0, q.jsxs)(q.Fragment, {
      children: [
        t.usage.map((e) =>
          (0, q.jsx)(
            aft,
            {
              runtimeId: e.runtimeId,
              role: r ? `columnheader` : void 0,
              className: r ? `${y9} shrink-0` : ``,
            },
            e.provider,
          ),
        ),
        t.other.length > 0
          ? (0, q.jsx)(`span`, {
              role: r ? `columnheader` : void 0,
              className: `${r ? `${kft} shrink-0` : ``} truncate`,
              children: n({ id: `machine.rack.colOther` }),
            })
          : null,
      ],
    });
  return r
    ? (0, q.jsx)(`div`, {
        className: `sticky top-0 z-[2] border-b border-line-hairline bg-layer-canvas`,
        "data-testid": `computers-rack-header`,
        children: (0, q.jsxs)(`div`, {
          role: `row`,
          className: `flex h-7 items-center gap-3 px-5 font-mono text-mono-meta text-foreground-hint`,
          children: [
            (0, q.jsx)(`span`, {
              role: `columnheader`,
              className: `${Oft} shrink-0`,
              children: n({ id: `machine.rack.colComputer` }),
            }),
            (0, q.jsx)(`span`, {
              role: `columnheader`,
              className: `min-w-0 flex-1`,
              children: n({ id: `machine.rack.colAgents` }),
            }),
            (0, q.jsxs)(`div`, {
              className: `flex shrink-0 items-center gap-3`,
              children: [
                (0, q.jsx)(`span`, {
                  role: `columnheader`,
                  className: `${y9} shrink-0 truncate`,
                  children: n({ id: `agent.migration.target.disk` }),
                }),
                (0, q.jsx)(`span`, {
                  role: `columnheader`,
                  className: `${y9} shrink-0 truncate`,
                  children: n({ id: `agent.migration.target.memory` }),
                }),
                t.usage.length > 0 || t.other.length > 0
                  ? (0, q.jsx)(Ao, {
                      orientation: `vertical`,
                      className: `h-4`,
                    })
                  : null,
                i,
              ],
            }),
            (0, q.jsx)(`span`, {
              role: `columnheader`,
              className: `${Aft} shrink-0`,
            }),
            (0, q.jsx)(`span`, {
              role: `columnheader`,
              className: `size-8 shrink-0`,
            }),
          ],
        }),
      })
    : t.usage.length === 0 && t.other.length === 0
      ? null
      : (0, q.jsx)(`div`, {
          className: `sticky top-0 z-[2] border-b border-line-seam bg-layer-card`,
          "data-testid": `computers-rack-header`,
          children: (0, q.jsx)(`div`, {
            className: `flex h-7 items-center px-4 font-mono text-mono-meta text-foreground-hint`,
            children: (0, q.jsx)(`div`, {
              className: `w-full`,
              style: jft(t),
              children: i,
            }),
          }),
        });
}
const v9 = 80;
const Eft = 40;
const Mft = 96;
function G5(e, t = !1) {
  return `w-full ${!e && t ? `before:bg-fill-cell-hover` : ``}`;
}
export function NativeWorkingSummary({
  items,
  enabled = true,
  onOpen,
  onFrame = false,
  variant = "count",
}) {
  const data = K.useMemo(
    () => ({ items, enabled, onOpen }),
    [items, enabled, onOpen],
  );
  return q.jsx(WorkingData.Provider, {
    value: data,
    children: q.jsx(Aq, { onFrame, variant }),
  });
}
export function NativeChannelWorking({
  items,
  enabled = true,
  memberIds,
  description,
}) {
  const data = K.useMemo(() => ({ items, enabled }), [items, enabled]);
  return q.jsx(WorkingData.Provider, {
    value: data,
    children: q.jsx(plt, { agentIdKey: memberIds.join(flt), description }),
  });
}
export function NativeSidebarFreshness({ visible }) {
  const { formatMessage: r } = H(),
    t = "layout.sidebar.staleCountsNotice",
    n = "sidebar-stale-notice";
  return visible
    ? (0, q.jsxs)(Zl, {
        status: `info`,
        role: `status`,
        "data-testid": n,
        children: [
          (0, q.jsx)(ba, { "aria-hidden": `true` }),
          (0, q.jsx)(ml, { children: r({ id: t }) }),
        ],
      })
    : null;
}
export function NativeComputerOverviewEntry({ active: gi, onClick: vi }) {
  const { formatMessage: r } = H();
  return (0, q.jsxs)($s, {
    active: gi,
    onClick: vi,
    className: G5(gi),
    "data-testid": `sidebar-computers-overview`,
    children: [
      (0, q.jsx)(no, { children: (0, q.jsx)(Er, {}) }),
      r({ id: `layout.sidebar.computersOverview` }),
    ],
  });
}
export function NativeComputerView({ view: t, onChange: n }) {
  const { formatMessage: e } = H();
  return (0, q.jsxs)(Iu, {
    value: t,
    onValueChange: n,
    "aria-label": e({ id: `machine.rack.viewAria` }),
    iconsOnlyBelow: `auto`,
    "data-testid": `computers-rack-view`,
    children: [
      (0, q.jsxs)($i, {
        value: `list`,
        "data-testid": `computers-rack-view-list`,
        children: [
          (0, q.jsx)(Rt, { size: 16, "aria-hidden": `true` }),
          (0, q.jsx)(Hi, { children: e({ id: `machine.rack.viewList` }) }),
        ],
      }),
      (0, q.jsxs)($i, {
        value: `cards`,
        "data-testid": `computers-rack-view-cards`,
        children: [
          (0, q.jsx)(Er, { size: 16, "aria-hidden": `true` }),
          (0, q.jsx)(Hi, { children: e({ id: `machine.rack.viewCards` }) }),
        ],
      }),
    ],
  });
}
export function NativeComputerCounts({
  count,
  online,
  instances,
  className: e = "",
}) {
  const { formatMessage: t } = H(),
    n = Array(count),
    i = online,
    a = instances;
  return (0, q.jsx)(`span`, {
    className: `truncate font-mono text-mono-meta text-foreground-hint ${e}`,
    "data-testid": `computers-rack-counts`,
    children: [
      t({ id: `machine.rack.computerCount` }, { count: n.length }),
      t({ id: `machine.rack.onlineCount` }, { count: i }),
      t({ id: `machine.rack.agentCount` }, { count: a }),
    ].join(` · `),
  });
}
const ComputerData = K.createContext({});
function qft() {
  return K.useContext(ComputerData).titleSuffix;
}
function x9() {
  return K.useContext(ComputerData).viewControl;
}
function b9() {
  return K.useContext(ComputerData).children;
}
function ComputerOverviewFrame() {
  const {
      count: i,
      loading: n,
      error,
      view: t,
      onRetry: l,
    } = K.useContext(ComputerData),
    { formatMessage: e } = H(),
    r = error ? "error" : "loaded",
    s = { registerMachines: false };
  return (0, q.jsxs)(`div`, {
    className: `flex min-h-0 min-w-0 flex-1 flex-col font-sans`,
    "data-testid": `computers-rack-overview`,
    children: [
      (0, q.jsx)(kP, {
        title: e({ id: `machine.mobile.title` }),
        titleSuffix: i > 0 ? (0, q.jsx)(qft, { className: `ml-2` }) : void 0,
        actions: (0, q.jsxs)(q.Fragment, {
          children: [
            i > 0 ? (0, q.jsx)(x9, {}) : null,
            s.registerMachines
              ? (0, q.jsxs)(G, {
                  size: `md`,
                  variant: `accent`,
                  onClick: c,
                  "data-testid": `computers-rack-add`,
                  children: [
                    (0, q.jsx)(gn, { size: 16 }),
                    e({ id: `machine.mobile.addComputer` }),
                  ],
                })
              : null,
          ],
        }),
      }),
      (0, q.jsx)(`div`, {
        className: `flex-1 overflow-auto bg-layer-canvas`,
        children:
          !n && r === `error` && i === 0
            ? (0, q.jsx)(XP, {
                className: `flex flex-col items-center justify-center py-16`,
                icon: (0, q.jsx)(ht, { size: 36 }),
                title: e({ id: `machine.mobile.loadErrorTitle` }),
                description: e({ id: `machine.mobile.loadErrorDescription` }),
                action: (0, q.jsxs)(G, {
                  size: `md`,
                  variant: `outline`,
                  onClick: l,
                  "data-testid": `computers-rack-retry`,
                  children: [
                    (0, q.jsx)(bn, { size: 16 }),
                    e({ id: `machine.mobile.retry` }),
                  ],
                }),
              })
            : !n && r === `loaded` && i === 0
              ? (0, q.jsx)(XP, {
                  className: `flex flex-col items-center justify-center py-16`,
                  icon: (0, q.jsx)(ht, { size: 36 }),
                  title: e({ id: `emptyState.noComputersTitle` }),
                  description: e({ id: `machine.mobile.emptyDescription` }),
                })
              : (0, q.jsx)(b9, { variant: `desktop`, view: t }),
      }),
    ],
  });
}
export function NativeComputerOverview(props) {
  return q.jsx(ComputerData.Provider, {
    value: props,
    children: q.jsx(ComputerOverviewFrame, {}),
  });
}
export function NativeComputerRack({ view: t, children: T }) {
  const { formatMessage: n } = H(),
    e = "desktop",
    c = { usage: [], other: [] },
    h = null;
  return (0, q.jsxs)(`div`, {
    "data-testid": `computers-rack`,
    "data-variant": e,
    "data-view": t,
    children: [
      t === `cards`
        ? (0, q.jsx)(`div`, {
            className:
              e === `desktop`
                ? `grid grid-cols-[repeat(auto-fill,minmax(250px,1fr))] gap-3 p-5`
                : `grid grid-cols-1 gap-3`,
            children: T,
          })
        : e === `desktop`
          ? (0, q.jsxs)(`div`, {
              role: `table`,
              "aria-label": n({ id: `machine.mobile.title` }),
              style: { minWidth: Pft(c) },
              children: [(0, q.jsx)(Wft, { variant: e, columns: c }), T],
            })
          : (0, q.jsxs)(q.Fragment, {
              children: [(0, q.jsx)(Wft, { variant: e, columns: c }), T],
            }),
      h &&
        (0, q.jsx)(Gft, { agent: h.agent, targetId: h.targetId, onClose: w }),
    ],
  });
}
const aft = () => null,
  jft = () => ({});
// No local disk/memory/quota observations exist. Native unknown metrics remain empty;
// remote registration, migration, cloud billing and remote machine controls are omitted.
export function NativeComputerRow({
  machine: e,
  view: r,
  icon: z,
  name: B,
  instances: ne,
  facts: R,
  version: F,
  platform: P,
  instanceCount,
}) {
  const t = Array(instanceCount),
    n = "desktop",
    i = { usage: [], other: [] },
    S = e.status !== "online",
    ae = S ? "bg-fill-subtle" : "",
    N = {},
    te = q.jsxs("div", {
      className: "flex min-w-0 items-center gap-2",
      children: [z, B],
    }),
    L = null,
    T = null,
    ee = null,
    ie = null,
    re = null,
    ue = null;
  const oe = (layout) =>
      layout === "cell"
        ? q.jsx("div", {
            role: "cell",
            className: y9 + " shrink-0",
            "aria-label": "磁盘状态未知",
          })
        : null,
    se = (layout) =>
      layout === "cell"
        ? q.jsx("div", {
            role: "cell",
            className: y9 + " shrink-0",
            "aria-label": "内存状态未知",
          })
        : null;
  const Qdt = () => ({ usage: [], other: [] }),
    Sft = () => null,
    p5 = () => F;
  if (r === "cards") {
    const n = Qdt([e]);
    return (0, q.jsxs)(tu, {
      className: `h-full transition-colors ${ae}`,
      "data-testid": `rack-row-${e.id}`,
      "data-layout": `card`,
      ...N,
      children: [
        (0, q.jsxs)(xc, {
          children: [
            (0, q.jsx)(ms, { children: z }),
            (0, q.jsxs)(Jr, {
              render: (0, q.jsx)(Fft, {}),
              className: `flex min-w-0 items-center gap-2`,
              children: [B, ee],
            }),
            (0, q.jsx)($c, { children: ie }),
            (0, q.jsx)(bc, {
              className: `col-span-2 font-mono text-mono-meta text-foreground-hint`,
              "data-testid": `rack-row-facts-${e.id}`,
              children: S
                ? R
                : (0, q.jsxs)(q.Fragment, {
                    children: [
                      L
                        ? (0, q.jsxs)(q.Fragment, {
                            children: [
                              (0, q.jsx)(`span`, {
                                className: `whitespace-nowrap`,
                                children: L,
                              }),
                              ` `,
                              (0, q.jsxs)(`span`, {
                                className: `whitespace-nowrap`,
                                children: [`· `, P],
                              }),
                            ],
                          })
                        : (0, q.jsx)(`span`, {
                            className: `whitespace-nowrap`,
                            children: P,
                          }),
                      ` `,
                      (0, q.jsx)(`span`, {
                        className: `whitespace-nowrap`,
                        children: (0, q.jsx)(p5, {
                          machine: e,
                          availableVersion: T,
                          arrowClassName: `font-bold text-foreground`,
                          chipClassName: `font-bold text-warning-strong`,
                        }),
                      }),
                    ],
                  }),
            }),
          ],
        }),
        (0, q.jsxs)(Xa, {
          className: `flex flex-1 flex-col gap-3`,
          children: [
            t.length > 0
              ? (0, q.jsx)(`div`, {
                  className: `-m-1 flex flex-wrap items-center gap-1 p-1`,
                  "data-testid": `rack-slots-${e.id}`,
                  children: ne,
                })
              : null,
            S
              ? null
              : (0, q.jsxs)(`div`, {
                  className: `grid grid-cols-[76px_minmax(0,1fr)_auto] items-center gap-x-2 gap-y-2`,
                  "data-testid": `rack-card-meters-${e.id}`,
                  children: [
                    oe(`line`),
                    se(`line`),
                    n.usage.length > 0
                      ? (0, q.jsx)(Ao, { className: `col-span-3` })
                      : null,
                    n.usage.map((t) =>
                      (0, q.jsx)(
                        xft,
                        { machine: e, column: t, results: w, serverId: C },
                        t.provider,
                      ),
                    ),
                  ],
                }),
            S
              ? null
              : (0, q.jsx)(Sft, { machineId: e.id, runtimeIds: n.other }),
            (0, q.jsx)(`div`, {
              className: `mt-auto empty:hidden ${S ? `` : `flex justify-end`}`,
              children: re,
            }),
          ],
        }),
      ],
    });
  }
  const de =
      t.length > 0
        ? q.jsx(Cft, { testId: "rack-slots-" + e.id, children: ne })
        : null,
    fe = Nft(i) + _9 + Dft,
    pe = { minWidth: fe, maxWidth: Math.max(520, fe) },
    me = 2 + i.usage.length + +(i.other.length > 0) + 1;
  return (0, q.jsxs)(`div`, {
    role: `row`,
    className: `flex min-h-12 items-center gap-3 border-b border-line-hairline px-5 py-1 transition-colors ${ae}`,
    "data-testid": `rack-row-${e.id}`,
    ...N,
    children: [
      (0, q.jsxs)(`div`, {
        role: `cell`,
        className: S
          ? `min-w-[252px] max-w-[400px] shrink-0`
          : `${Oft} shrink-0`,
        children: [
          te,
          (0, q.jsx)(`div`, {
            className: `mt-0.5 truncate whitespace-nowrap pl-[28px] font-mono text-mono-meta text-foreground-hint`,
            "data-testid": `rack-row-facts-${e.id}`,
            children: R,
          }),
        ],
      }),
      (0, q.jsx)(`div`, {
        role: `cell`,
        className: `min-w-0 flex-1`,
        children: de,
      }),
      S
        ? (0, q.jsx)(`div`, {
            role: `cell`,
            "aria-colspan": me,
            className: `flex shrink-0 items-center justify-end`,
            style: pe,
            children: re,
          })
        : (0, q.jsxs)(q.Fragment, {
            children: [
              (0, q.jsxs)(`div`, {
                className: `flex shrink-0 items-center gap-3`,
                "data-testid": `rack-metrics-${e.id}`,
                children: [
                  oe(`cell`),
                  se(`cell`),
                  i.usage.length > 0 || i.other.length > 0
                    ? (0, q.jsx)(`span`, {
                        className: `w-px self-stretch`,
                        "aria-hidden": `true`,
                      })
                    : null,
                  ue,
                ],
              }),
              (0, q.jsx)(`div`, {
                role: `cell`,
                className: `flex shrink-0 items-center justify-end ${Aft}`,
                "data-testid": `rack-action-${e.id}`,
                children: re,
              }),
            ],
          }),
      (0, q.jsx)(`div`, {
        role: `cell`,
        className: `flex shrink-0`,
        children: ie,
      }),
    ],
  });
}
export { Cft as NativeComputerAvatarStrip };
