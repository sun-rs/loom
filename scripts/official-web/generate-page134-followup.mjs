import { writeFileSync } from "node:fs";
// Structural ports of the bounded published excerpts in page-audit/source-excerpts.md.
// No upstream state/store imports; identity/query/actions remain Loom bindings.
const source = `// GENERATED: Web 1.21.34 MessageSearchPage scoped-search subtree structural port.
// Chinese text from the same release's zh-cn resource; source hashes in page-audit/sources.json.
import {Search} from 'lucide-react';
import {SearchResultsList, SearchEntityResult, SearchEntityResultLeading, SearchEntityResultIcon, SearchEntityResultContent, SearchEntityResultHeader, SearchEntityResultTitle, SearchEntityResultDescription} from 'raft-ui';
import AppEmptyState from '@loom/raft-web-source/EmptyState';
export function OfficialScopedSearchEntry({query,onOpen,selected=false}:{query:string;onOpen:()=>void;selected?:boolean}){return <SearchResultsList className="pt-2"><SearchEntityResult type="button" data-testid="search-everywhere" data-search-rail-id="$everywhere" selected={selected} onClick={onOpen}><SearchEntityResultLeading><SearchEntityResultIcon><Search size={14} aria-hidden="true"/></SearchEntityResultIcon></SearchEntityResultLeading><SearchEntityResultContent><SearchEntityResultHeader><SearchEntityResultTitle>{query.trim()?\`在全部内容中搜索“\${query.trim()}”\`:'搜索全部'}</SearchEntityResultTitle></SearchEntityResultHeader><SearchEntityResultDescription>用同样的关键词打开搜索标签页</SearchEntityResultDescription></SearchEntityResultContent></SearchEntityResult></SearchResultsList>}
export function OfficialScopedSearchEmpty({conversation}:{conversation:string}){return <AppEmptyState className="py-16" icon={<Search size={36} aria-hidden="true"/>} title={\`搜索 \${conversation}\`} description="只搜索这个会话里的消息。"/>}
`;
writeFileSync("frontends/raft/loom/OfficialScopedSearch.generated.tsx", source);
