import pathlib,json,statistics,hashlib,re
from summarize import summarize
from study import ROOT,dump
summarize()
rows=json.loads((ROOT/'summary.json').read_text()); reviews=json.loads((ROOT/'reviews.json').read_text())
groups=[]
for arm in ['pi','opencode','dsh']:
 rs=[r for r in rows if r['arm']==arm]; scores=[sum(reviews[f"{r['task']}-{r['rep']}-{arm}"]['scores'].values()) for r in rs if f"{r['task']}-{r['rep']}-{arm}" in reviews]
 if not rs:continue
 known=[r for r in rs if r['usage_coverage_complete']]
 groups.append({'usage_complete_runs':len(known),'known_only_mean_input':round(statistics.mean(r['input'] for r in known)) if known else None,'known_only_mean_output':round(statistics.mean(r['output'] for r in known)) if known else None,'known_only_mean_peak_usd':round(statistics.mean(r['estimated_peak_usd'] for r in known),5) if known else None,'partial_usage_fields_are_lower_bounds':len(known)!=len(rs),'arm':arm,'runs':len(rs),'complete':sum(r['complete'] for r in rs),'mean_input':round(statistics.mean(r['input'] for r in rs)),'mean_output':round(statistics.mean(r['output'] for r in rs)),'mean_seconds':round(statistics.mean(r['seconds'] for r in rs),1),'mean_requests':round(statistics.mean(r['provider_requests'] for r in rs),1),'mean_peak_usd':round(statistics.mean(r['estimated_peak_usd'] for r in rs),5),'mean_manual_score':round(statistics.mean(scores),1) if scores else None,'score_n':len(scores),'subagent_calls':sum(r['subagent_calls'] for r in rs)})
account=[]
for folder in ['runs','calibration','configuration-audit','directory-invalid','preflight']:
 requests=[];unsealed=0
 for d in (ROOT/folder).iterdir():
  if d.is_dir():
   logged=len(json.loads((d/'requests.json').read_text())) if (d/'requests.json').exists() else 0
   unsealed+=max(0,len(list(d.glob('request-*.json')))-logged)
 for f in (ROOT/folder).glob('*/requests.json'):
  for x in json.loads(f.read_text()):requests.append(x)
 paid=[x for x in requests if not x.get('rejected')]
 known=[x['usage'] for x in paid if x.get('usage')]
 inp=sum(x['input'] for x in known);out=sum(x['output'] for x in known);cache=sum(x['cache_read'] for x in known)
 account.append({'cohort':folder,'runs_with_request_logs':len(list((ROOT/folder).glob('*/requests.json'))),'forwarded_requests':len(paid),'local_rejections':len(requests)-len(paid),'unknown_forwarded_usage':len(paid)-len(known),'unsealed_request_files':unsealed,'known_input_lower_bound':inp,'known_output_lower_bound':out,'known_peak_usd_lower_bound':round(((inp-cache)*.3+cache*.006+out*1.2)/1e6,6)})
hashes=json.loads((ROOT/'source-hashes.json').read_text());changed=[n for n,h in hashes.items() if not (ROOT/'source'/n).exists() or hashlib.sha256((ROOT/'source'/n).read_bytes()).hexdigest()!=h]
violations=[]
for f in (ROOT/'runs').glob('*/stdout.jsonl'):
 for line in f.read_text().splitlines():
  try:x=json.loads(line)
  except:continue
  if x.get('type')=='tool_use':
   state=x.get('part',{}).get('state',{});inp=state.get('input',{})
   if '/Users/sun/Code/repos' in json.dumps(inp):violations.append({'run':f.parent.name,'input':inp})
report={'study':'2026-10-27 DeepSeek V4.1 Flash 1017 native harness pilot','results':groups,'accounting':account,'review':'Manual rubric review against exact code/tests; not blind or independent. Scores are descriptive aids, not calibrated accuracy percentages.','scope':'Two read-only backend analysis tasks, three repeats each. No implementation/fix test, no Loom dispatch, no Loom/native ratio.','limitations':['OpenCode initial six samples used wrong source root; excluded and retained. Replacement follows other arms, so strict Latin-square balance lost.','Provider cache is not flushed. Actual input and cache hits reported separately; cost estimates are not billing invoices.','Alias deepseek-flash served version is documented, not immutable server revision attestation.','Pi bundled subagent plugin available; actual fan-out must be checked, no plugin ablation.','Different native system prompts, protocols and harness capabilities retained; this compares configurations, not a pure tool-loop variable.','Calibrations and interrupted setup samples retained; unknown usage is never zero.'],'source_integrity':{'files':len(hashes),'changed':changed},'original_workspace_tool_input_violations':violations}
dump(ROOT/'report.json',report)
print(json.dumps(report,ensure_ascii=False,indent=2))
