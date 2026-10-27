import pathlib,json,hashlib,collections
from study import ROOT,SRC,dump,MODEL
rows=[]
for d in sorted((ROOT/'runs').glob('*')):
 calls={};results=set();result_text={};context_errors=[];wire_errors=[]
 for p in d.glob('request-*.json'):
  x=json.loads(p.read_text())
  if x.get('model')!=MODEL or x.get('reasoning_effort')!='low':wire_errors.append(p.name)
  for m in x.get('messages',[]):
   if m.get('role')=='system' and 'Working directory: /Users/sun/Code/repos' in str(m.get('content','')):context_errors.append(p.name)
   for c in m.get('tool_calls',[]):calls[c['id']]=c.get('function',{}).get('name','unknown')
   if m.get('role')=='tool':
    results.add(m.get('tool_call_id'));result_text[m.get('tool_call_id')]=str(m.get('content',''))
 counts=collections.Counter(calls[k] for k in results if k in calls)
 errors=[{'call_id':k,'tool':calls.get(k),'error':v[:250]} for k,v in result_text.items() if calls.get(k) in ['task','subagent'] and ('Unknown agent:' in v or v.startswith('Agent failed:'))]
 rows.append({'run':d.name,'unique_tool_calls_seen':len(calls),'tool_results_returned':sum(counts.values()),'tools_with_results':dict(counts),'wire_errors':wire_errors,'context_errors':context_errors,'delegation_tool_errors':errors})
h=json.loads((ROOT/'source-hashes.json').read_text());changed=[n for n,v in h.items() if hashlib.sha256((SRC/n).read_bytes()).hexdigest()!=v];extra=[str(p.relative_to(SRC)) for p in SRC.rglob('*') if p.is_file() and str(p.relative_to(SRC)) not in h]
dump(ROOT/'audit.json',{'runs':rows,'source_files':len(h),'changed':changed,'extra':extra,'method':'Unique OpenAI tool_call IDs across captured request histories, paired with subsequent tool results; includes native child histories, not just parent stdout. Missing IDs are not fabricated.'})
print(json.dumps(rows,ensure_ascii=False))
