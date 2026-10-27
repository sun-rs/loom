import json,pathlib,statistics,collections
from study import ROOT,dump
from summarize import summarize
summarize();rows=json.loads((ROOT/'summary.json').read_text());reviews=json.loads((ROOT/'reviews.json').read_text());groups=[]
for arm in ['pi','opencode']:
 rs=[r for r in rows if r['arm']==arm];known=[r for r in rs if r['usage_coverage_complete']]
 if not rs:continue
 scores=[sum(reviews[f"{r['task']}-{r['rep']}-{arm}"]['scores'].values()) for r in rs if "scores" in reviews.get(f"{r['task']}-{r['rep']}-{arm}",{})]
 groups.append({'arm':arm,'attempts':len(rs),'complete_reports':sum(r['complete'] for r in rs),'usage_complete':len(known),'known_only_mean_input':round(statistics.mean(r['input'] for r in known)) if known else None,'known_only_mean_output':round(statistics.mean(r['output'] for r in known)) if known else None,'mean_seconds_all_attempts':round(statistics.mean(r['seconds'] for r in rs),1),'mean_requests_all_attempts':round(statistics.mean(r['provider_requests'] for r in rs),1),'manual_score_n':len(scores),'manual_score_mean':round(statistics.mean(scores),1) if scores else None,'observed_parent_subagent_calls':sum(r['subagent_calls'] for r in rs)})
account=[]
for folder in ['runs','latency-calibration','preflight']:
 requests=[];unsealed=0
 for d in (ROOT/folder).iterdir():
  if not d.is_dir():continue
  rec=json.loads((d/'requests.json').read_text()) if (d/'requests.json').exists() else []
  requests.extend(rec);unsealed+=max(0,len(list(d.glob('request-*.json')))-len(rec))
 forwarded=[x for x in requests if not x.get('rejected')];known=[x['usage'] for x in forwarded if x.get('usage')]
 account.append({'cohort':folder,'forwarded':len(forwarded),'local_rejections':len(requests)-len(forwarded),'unknown_usage':len(forwarded)-len(known),'unsealed_request_files':unsealed,'known_input_lower_bound':sum(x['input'] for x in known),'known_output_lower_bound':sum(x['output'] for x in known),'response_models':sorted(set(x.get('model') or 'unknown' for x in known))})
report={'results':groups,'accounting':account,'billing':'Existing Kimi Code subscription, not Moonshot Open Platform PAYG. Token usage is not a monetary invoice or exact subscription-quota percentage.','model':'k3.1-pro / low, exact requested and returned model checked','review':'Manual source/test rubric, not independent blinded evaluation or population accuracy estimate.','limits':['Two read-only backend tasks, not code writing/repair or multimodal evaluation.','Three repeats planned per task/arm; unsuccessful attempts retained, not replaced.','Warm provider cache and runtime variability remain; sequential alternating order reduces but cannot remove them.','Different native prompts and actual delegation retained; both use official OpenAI Chat Completions directly with byte-observing relay, no protocol translation.','DeepSeek previous run used 300s cap, Kimi formal uses 900s after calibration; only completed samples support cross-model token comparison, not equal-deadline success rates.','Native subagent requests included in relay totals; parent-only tool events are not all descendant tool usage.'],'entitlement_probe':{'input':90,'output':43,'model':'k3.1-pro','status':200},'evidence':'audit.json has unique tool-call/result counts and source integrity; manifest.json freezes configuration and calibration history.'}
report['limits'] += ['Pi retry disabled; OpenCode retains native retry behavior. Failure rates are not a clean controlled harness-reliability comparison.', 'Pi bundled subagent tool description did not enumerate installed scout/reviewer names. return-2 had two invalid default calls, then two successful children; no plugin ablation.', 'A timed-out CLI may leave an already-forwarded HTTP request draining; late usage counted, deadline failure not converted to success.', 'Input totals include cached tokens and cumulative context across requests, not unique document size or billable uncached input.']
report['successful_report_groups']=[]
for task in ['return','roles']:
 for arm in ['pi','opencode']:
  rs=[r for r in rows if r['arm']==arm and r['task']==task and r['complete'] and r['usage_coverage_complete']]
  report['successful_report_groups'].append({'task':task,'arm':arm,'n':len(rs),'mean_input':round(statistics.mean(r['input'] for r in rs)),'input_range':[min(r['input'] for r in rs),max(r['input'] for r in rs)],'mean_output':round(statistics.mean(r['output'] for r in rs)),'mean_seconds':round(statistics.mean(r['seconds'] for r in rs),1)})
for g in report['results']:
 g.pop('known_only_mean_input');g.pop('known_only_mean_output')
 rs=[r for r in rows if r['arm']==g['arm']]
 g['all_attempts_known_input_lower_bound']=sum(r['input'] for r in rs)
 g['all_attempts_known_output_lower_bound']=sum(r['output'] for r in rs)
report['recommendation']='OpenCode practical default for existing multi-provider workflow; Pi lightweight alternative. Neither demonstrated universal correctness/cost superiority; DSH deprioritized for this workload. Kimi Code key works with k3.1-pro/low; no PAYG conclusion from subscription usage.'
dump(ROOT/'report.json',report);print(json.dumps(report,ensure_ascii=False,indent=2))
