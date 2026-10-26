import type {ComponentType} from 'react';
export type CurrentColumn = 'sidebar'|'list'|'thread'|'detail'|'sideCards'|'workspaceTree'|'side';
export const CurrentColumnResize: ComponentType<{
 column:CurrentColumn; edge:'left'|'right'; visibleFrom?:'sm'|'md'|'lg'; maxWidth?:number;
 className?:string; label?:string; 'data-testid'?:string;
 snap?:{kind:'focus'|'collapse';snapped:boolean;onSnappedChange:(value:boolean,origin:'pointer'|'keyboard')=>boolean|void};
}>;
export function useCurrentColumnWidth(column:CurrentColumn):number;
export function measuredColumnMax(column:CurrentColumn,current:number,main:number,min?:number):number;
