// Official published registry supersedes the older Git source sidebar bounds.
import {officialPanelLayout} from "../../../../upstream/published-2026-10-22/panel-layout.ts";
export {THREAD_PANEL_MIN_WIDTH, THREAD_PANEL_DEFAULT_WIDTH, getThreadPanelDynamicMax} from "@loom/raft-web-source/panelBounds";
const {min,max,defaultWidth}=officialPanelLayout.sidebar;
export const SIDEBAR_PANEL_BOUNDS = {min,max,defaultWidth};
