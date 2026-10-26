import { readFileSync } from "node:fs";
import { resolve } from "node:path";
const app = "compose/shared/src/commonMain/kotlin/build/raft/app/";
const core =
  "compose/core/src/commonMain/kotlin/build/raft/app/data/AdaptiveListPaneWidth.kt";
export function readAdaptiveContract(
  root,
  read = (p) => readFileSync(resolve(root, p), "utf8"),
) {
  const pane = read(app + "RaftAdaptivePane.kt"),
    shell = read(app + "RaftAppShell.kt"),
    widths = read(core),
    side = read(app + "data/AdaptiveSideThread.kt"),
    prefs = read(app + "data/LocalPreferences.kt");
  const match = (s, re, label) => {
    const m = s.match(re);
    if (!m) throw Error("Native adaptive contract changed: " + label);
    return m;
  };
  const number = (s, name) =>
    Number(
      match(
        s,
        new RegExp("(?:const val|val) " + name + " = (\\d+)(?:f)?\\b"),
        name,
      )[1],
    );
  const requireShape = (s, re, label) => {
    match(s, re, label);
    return true;
  };
  const bounds = (name) => {
    const m = match(
      widths,
      new RegExp(name + "\\((\\d+)f, (\\d+)f, (\\d+)f,"),
      name,
    );
    return { default: +m[1], min: +m[2], max: +m[3] };
  };
  return {
    dualPaneMinimum: number(pane, "DualPaneMinimumWidthDp"),
    densityNormalized: requireShape(
      pane,
      /val widthDp = event.widthPx \/ event.density/,
      "width normalization",
    ),
    defaultDesktopMode:
      match(
        prefs,
        /const val DEFAULT_DESKTOP_MODE_ON_LARGE_SCREEN = (true|false)/,
        "desktop default",
      )[1] === "true",
    railRequiresDualPane: requireShape(
      shell,
      /desktopModeEnabled && paneState.layout == RaftAdaptivePaneLayout.DualPane/,
      "rail admission",
    ),
    sidebar: bounds("Sidebar"),
    list: bounds("List"),
    detailMinimum: number(widths, "RAFT_LIST_PANE_MAIN_MIN_DP"),
    sideThread: {
      windowMinimum: number(side, "RAFT_SIDE_THREAD_MIN_WINDOW_DP"),
      mainMinimum: number(side, "RAFT_SIDE_THREAD_MAIN_MIN_DP"),
      column: number(side, "RAFT_SIDE_THREAD_COLUMN_DP"),
      divider: number(side, "RAFT_SIDE_THREAD_DIVIDER_DP"),
      requiresMeasuredDetail: requireShape(
        side,
        /detailPaneWidthDp != null &&\s*detailPaneWidthDp >=\s*RAFT_SIDE_THREAD_MAIN_MIN_DP \+ RAFT_SIDE_THREAD_DIVIDER_DP \+ RAFT_SIDE_THREAD_COLUMN_DP/,
        "measured detail admission",
      ),
    },
  };
}
export function compareAdaptiveContracts(before, after) {
  return Object.keys(before)
    .filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k]))
    .map((rule) => ({ rule, before: before[rule], after: after[rule] }));
}
