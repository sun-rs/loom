import pathlib,json,re,statistics,hashlib
from study import ROOT,dump

def extract(d):
 texts=[];errors=[];tools=[];terminal=False
 for line in (d/'stdout.jsonl').read_text().splitlines():
  try:x=json.loads(line)
  except:continue
  t=x.get('type')
  if t=='error':errors.append(x)
  if t=='message_end' and x.get('message',{}).get('role')=='assistant':
   msg=x['message'];parts=msg.get('content',[]);text=''.join(p.get('text','') for p in parts if p.get('type')=='text')
   tools.extend(p.get('name') for p in parts if p.get('type')=='toolCall')
   if text:texts.append(text)
   if msg.get('stopReason')=='stop':terminal=True
   if msg.get('stopReason') in ['error','aborted']:errors.append({'stopReason':msg.get('stopReason')})
  if t=='text' and x.get('part',{}).get('text'):texts.append(x['part']['text'])
  if t=='step_finish' and x.get('part',{}).get('reason')=='stop':terminal=True
  if t=='final':
   if x.get('text'):texts.append(x['text']);terminal=True
  if t=='tool_call':tools.append(x.get('tool',x.get('name',x.get('toolName','unknown'))))
  if t=='tool_use':tools.append(x.get('part',{}).get('tool','unknown'))
 text=texts[-1] if texts else ''
 if text:(d/'answer.txt').write_text(text)
 return text,terminal,errors,tools

def summarize():
 rows=[]
 for d in sorted((ROOT/'runs').glob('*')):
  if not (d/'summary.json').exists():continue
  base=json.loads((d/'summary.json').read_text());req=json.loads((d/'requests.json').read_text()) if (d/'requests.json').exists() else []
  text,terminal,errors,tools=extract(d)
  # Rejections at our local guard never reach provider and cost exactly zero.
  forwarded=[r for r in req if not r.get('rejected')]
  known=bool(forwarded) and all(r.get('usage') for r in forwarded)
  inp=sum((r.get('usage') or {}).get('input',0) for r in forwarded);out=sum((r.get('usage') or {}).get('output',0) for r in forwarded);cached=sum((r.get('usage') or {}).get('cache_read',0) for r in forwarded)
  cost=((inp-cached)*.3+cached*.006+out*1.2)/1000000
  citations=[]
  for path,line in re.findall(r'((?:packages|docs)/[\w./-]+\.(?:ts|md|js)):(\d+)',text):
   p=ROOT/'source'/path;valid=p.is_file() and 0<int(line)<=len(p.read_text().splitlines());citations.append({'path':path,'line':int(line),'exists_in_snapshot':valid})
  base.update(complete=base['exit']==0 and bool(text) and terminal and not errors and not base['timeout'],answer_chars=len(text),provider_requests=len(forwarded),local_guard_rejections=len(req)-len(forwarded),usage_coverage_complete=known,input=inp,output=out,cache_read=cached,estimated_peak_usd=round(cost,6),estimated_offpeak_usd=round(cost/2,6),tool_calls=len(tools),subagent_calls=sum(1 for t in tools if t and ('subagent' in t or t=='task')),citations=citations,answer_file=str(d/'answer.txt') if text else None)
  rows.append(base)
 dump(ROOT/'summary.json',rows)
 grouped=[]
 for task in ['return','roles']:
  for arm in ['pi','opencode','dsh']:
   rs=[r for r in rows if r['task']==task and r['arm']==arm]
   if not rs:continue
   grouped.append(dict(task=task,arm=arm,runs=len(rs),completed=sum(r['complete'] for r in rs),mean_input=round(statistics.mean(r['input'] for r in rs)),mean_output=round(statistics.mean(r['output'] for r in rs)),mean_seconds=round(statistics.mean(r['seconds'] for r in rs),1),mean_requests=round(statistics.mean(r['provider_requests'] for r in rs),1),mean_peak_usd=round(statistics.mean(r['estimated_peak_usd'] for r in rs),5),all_usage_known=all(r['usage_coverage_complete'] for r in rs)))
 dump(ROOT/'aggregate.json',grouped)
 return grouped
if __name__=='__main__':print(json.dumps(summarize(),ensure_ascii=False,indent=2))
