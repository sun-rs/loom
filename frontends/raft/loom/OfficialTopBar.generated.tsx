// GENERATED from locked db5e399 AppTopBar. Native frame/regions/search; Loom supplies workspace, notification and route slots.
// Explicit compatibility: v1.21.26 adaptive search width remains a Loom port; no account/workspace switching.
import type {ReactNode,Ref} from "react";
import {useIntl} from "react-intl";
import {SearchTrigger,SearchTriggerLabel,SearchTriggerShortcut} from "raft-ui";
import {Search} from "lucide-react";
function edgeBalance(titleBar: boolean) {
  const start = `(var(--raft-titlebar-inset-start, 0px) + ${titleBar ? "0px" : "16px"})`;
  const end = `(var(--raft-titlebar-inset-end, 0px) + ${titleBar ? "24px" : "16px"})`;
  return {
    leading: { marginRight: `max(0px, calc(${end} - ${start}))` },
    trailing: { marginLeft: `max(0px, calc(${start} - ${end}))` },
  };
}
const EDGE_BALANCE = { web: edgeBalance(false), titleBar: edgeBalance(true) };
const BAR_FRAME =
  "relative flex h-12 w-full shrink-0 items-center border-b border-line-seam bg-layer-frame text-foreground-on-frame";
export function OfficialTopBar({identity,trailing,shortcut,leadingRef,trailingRef,searchFieldRef,searchWidth,openSearch}:{identity:ReactNode;trailing:ReactNode;shortcut:ReactNode;leadingRef:Ref<HTMLDivElement>;trailingRef:Ref<HTMLDivElement>;searchFieldRef:Ref<HTMLButtonElement>;searchWidth?:number;openSearch:()=>void}){
 const titleBar=false,edges=EDGE_BALANCE.web,leadingEnd=null;
 const {formatMessage}=useIntl();
 return (<div {...(titleBar ? { "data-raft-titlebar": "" } : {})} data-testid="app-top-bar" className={`${BAR_FRAME} frame-decor-top`}>
      {/* Web: the same 8px side padding as the right region, so the two flex-1
          regions are equal and the search field is centred on the window. */}
      <div ref={leadingRef} className={`flex min-w-0 flex-1 items-center ${titleBar ? "" : "px-2"}`} style={edges.leading}>
        {identity}
        
        {/* The left region's last item: the strip fills up to it and no further. */}
        <div data-topbar-leading-end className={`ml-auto flex shrink-0 items-center gap-0.5 pl-2 ${titleBar ? "pr-2" : ""}`}>
          {leadingEnd}
        </div>
      </div>

      {/* Raft DS › top bar search (`rf-topbar__search`): raft-ui SearchTrigger,
          a button drawn as the field (36 tall, the 1.5px ink line, an 18px
          glyph, the placeholder in ink-3). It opens search rather than taking
          input itself. Its width follows the window (32vw) and never
          animates: the strip measures the side regions on every resize. */}
      <SearchTrigger
        ref={searchFieldRef} style={searchWidth === undefined ? undefined : {width:searchWidth}}
        onClick={openSearch}
        data-testid="app-top-bar-search"
      >
        <Search aria-hidden />
        <SearchTriggerLabel>{formatMessage({ id: "layout.leftRail.tabSearch" })}</SearchTriggerLabel>
        <SearchTriggerShortcut>{shortcut}</SearchTriggerShortcut>
      </SearchTrigger>

      <div ref={trailingRef} className={`flex min-w-0 flex-1 items-center justify-end gap-1 ${titleBar ? "pl-3 pr-3" : "px-2"}`} style={edges.trailing}>
        {trailing}
      </div>
    </div>);
}
