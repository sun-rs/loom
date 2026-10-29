// GENERATED from Web1.21.38; unchanged menu-row and manual unread-marker declaration bodies.
import * as Z from "react/jsx-runtime";
var HXe=[`flex min-h-9 w-full items-center gap-2.5 rounded-chip px-2.5 py-1.5 text-left [@media(max-height:600px)]:min-h-8 [@media(max-height:600px)]:py-1`,`font-sans text-callout font-medium text-foreground`,`outline-none transition-colors enabled:hover:bg-brand-soft enabled:focus-visible:bg-brand-soft`,`[&>svg]:shrink-0 [&>svg:first-child]:size-4 [&>svg:first-child]:text-foreground-muted`,`disabled:cursor-not-allowed disabled:text-foreground-disabled disabled:[&>svg:first-child]:text-foreground-disabled`].join(` `);
function l1({icon:e,trailing:t,className:n=``,type:r=`button`,role:i=`menuitem`,children:a,...o}){return(0,Z.jsxs)(`button`,{type:r,role:i,"data-slot":`menu-item`,className:`${HXe} ${n}`.trim(),...o,children:[e,(0,Z.jsx)(`span`,{className:`min-w-0 flex-1 truncate`,children:a}),t]})}
var Pdt=`size-1.5 shrink-0 rounded-[2px] bg-foreground-hint`;
function r5({className:e,...t}){return(0,Z.jsx)(`span`,{role:`img`,...t,className:e?`${Pdt} ${e}`:Pdt})}
export {l1 as OfficialMenuItem,r5 as OfficialMarkedUnread};
