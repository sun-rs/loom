import os,json,pathlib,subprocess,time,threading,http.server,urllib.request,urllib.error,signal,hashlib,sys,shutil
ROOT=pathlib.Path('/tmp/loom-kimi-study-20261027'); SRC=ROOT/'source'
PI=pathlib.Path('/opt/homebrew/lib/node_modules/@earendil-works/pi-coding-agent')
MODEL='k3.1-pro'
TASKS={
'return': '请只读分析此 Loom 代码快照：频道内实例 A 明确请求 B 后，B 普通最终回复不再写 @A，系统是否一定自动交回 A？请追踪真正调用链和数据库条件，说明至少 8 个成立/不成立边界（特别是实际交付、多个来源、消息列、附件、会话代际、已回复、自动回传链），给出文件路径和精确行号，引用相应测试。区分实现事实、测试证据和待验证假设。不要强凑缺陷。中文报告最多1800字。',
'roles': '请只读分析此 Loom 代码快照：Tom Role 有运行中实例，删除 Tom 再新建同名 Tom，再恢复旧 Tom 会怎样？请追踪 Role/Revision/Instance/Session 身份与权限、名称冲突、幂等、过期修订、现有实例配置和执行状态。说明重启时保留配置与采用最新配置的边界，并用实际代码文件路径和精确行号、相应测试支持结论。区分实现事实和推测。不要修改代码。中文报告最多1800字。'}
COMMON='你在固定的 Loom 源码快照中。仅阅读当前快照，不访问主项目工作区、个人目录、网络、过去会话或外部记忆，不运行模型CLI或外部agent。允许使用本Harness的原生子代理，但只能用同一 k3.1-pro / low，最多2个。不要写文件或执行构建。任务目的是证据准确的分析，不是字数或发现问题的数量。最终报告必须包含关键结论、证据和不确定性。\n'
def dump(p,d): p.parent.mkdir(parents=True,exist_ok=True);p.write_text(json.dumps(d,ensure_ascii=False,indent=2)+'\n')
def usage_from(raw,anthropic):
 u={}; model=None
 for line in raw.decode(errors='replace').splitlines():
  if not line.startswith('data:'):continue
  try:d=json.loads(line[5:])
  except:continue
  m=d.get('message',{});model=d.get('model',m.get('model',model))
  for x in [m.get('usage'),d.get('usage')]:
   if x:
    if 'cached_tokens' in (x.get('prompt_tokens_details') or {}):u['prompt_cache_hit_tokens']=max(u.get('prompt_cache_hit_tokens',0),x['prompt_tokens_details']['cached_tokens'])
    for k,v in x.items():
     if isinstance(v,(int,float)):u[k]=max(u.get(k,0),v)
 if not u:return None
 if anthropic:
  inp=u.get('input_tokens',0)+u.get('cache_read_input_tokens',0)+u.get('cache_creation_input_tokens',0); out=u.get('output_tokens',0);cached=u.get('cache_read_input_tokens',0)
 else:inp=u.get('prompt_tokens',0);out=u.get('completion_tokens',0);cached=u.get('prompt_cache_hit_tokens',0)
 return dict(input=inp,output=out,cache_read=cached,model=model,raw=u)
class Relay(http.server.BaseHTTPRequestHandler):
 def log_message(self,*args):pass
 def do_POST(self):
  s=self.server;raw=self.rfile.read(int(self.headers.get('Content-Length',0)))
  try:d=json.loads(raw)
  except:self.send_error(400);return
  effort=d.get('reasoning_effort',d.get('output_config',{}).get('effort')); cap=d.get('max_tokens',d.get('max_completion_tokens'));anth='/messages' in self.path
  with s.lock:
   n=len(s.records)+1;r=dict(request=n,model=d.get('model'),effort=effort,max_tokens=cap,path=self.path,request_bytes=len(raw),thinking=d.get('thinking'),tools=len(d.get('tools',[])),status=None,usage=None);s.records.append(r)
   (s.run/f'request-{n}.json').write_bytes(raw)
  reason=None
  if d.get('model')!=MODEL:reason='wrong-model'
  elif effort!='low':reason='wrong-effort'
  elif not isinstance(cap,int) or cap>16384:reason='output-cap'
  elif n>60:reason='request-budget'
  elif sum((x.get('usage') or {}).get('input',0) for x in s.records)>2500000:reason='run-input-budget'
  elif sum((x.get('usage') or {}).get('output',0) for x in s.records)>50000:reason='run-output-budget'
  if s.fake: reason=reason or 'preflight-no-paid-request'
  if reason:
   r['rejected']=reason;self.send_response(400);self.send_header('Content-Type','application/json');self.end_headers();self.wfile.write(json.dumps({'error':{'message':reason,'type':'invalid_request_error'}}).encode());dump(s.run/'requests.json',s.records);return
  endpoint='https://api.kimi.com/coding/v1/messages' if anth else 'https://api.kimi.com/coding/v1/chat/completions'
  headers={'Content-Type':'application/json','Accept':'text/event-stream'}
  if anth:
   headers['x-api-key']=s.key;headers['anthropic-version']=self.headers.get('anthropic-version','2023-06-01')
   if self.headers.get('anthropic-beta'):headers['anthropic-beta']=self.headers['anthropic-beta']
  else:headers['Authorization']='Bearer '+s.key
  start=time.monotonic();chunks=[]
  try:
   response=urllib.request.urlopen(urllib.request.Request(endpoint,data=raw,headers=headers),timeout=180)
   r['status']=response.status;self.send_response(response.status);self.send_header('Content-Type',response.headers.get('Content-Type','text/event-stream'));self.end_headers()
   while True:
    b=response.read1(65536)
    if not b:break
    chunks.append(b)
    try:self.wfile.write(b);self.wfile.flush()
    except (BrokenPipeError,ConnectionResetError):pass
  except urllib.error.HTTPError as e:
   r['status']=e.code;body=e.read();chunks.append(body);self.send_response(e.code);self.end_headers();self.wfile.write(body)
  except Exception as e:
   r['error']=type(e).__name__
   try:self.send_error(502,type(e).__name__)
   except:pass
  finally:
   data=b''.join(chunks);(s.run/f'response-{n}.sse').write_bytes(data);r['usage']=usage_from(data,anth);r['seconds']=time.monotonic()-start;dump(s.run/'requests.json',s.records)
def setup(arm,run,port):
 env={k:v for k,v in os.environ.items() if not any(t in k.upper() for t in ['API_KEY','AUTH_TOKEN','ACCESS_TOKEN','SECRET'])}
 env['NO_PROXY']='127.0.0.1,localhost'; env['DEEPSEEK_API_KEY']='study-local-relay';env['PI_TELEMETRY']='0';env['PI_OFFLINE']='1'
 cfg=run/'config';cfg.mkdir(parents=True,exist_ok=True)
 if arm=='pi':
  env['PI_CODING_AGENT_DIR']=str(cfg)
  dump(cfg/'models.json',{'providers':{'moonshotai':{'baseUrl':f'http://127.0.0.1:{port}','apiKey':'DEEPSEEK_API_KEY','api':'openai-completions','models':[{'id':MODEL,'name':'Kimi K3.1 Pro','reasoning':True,'input':['text'],'contextWindow':262144,'maxTokens':16384,'cost':{'input':0,'output':0,'cacheRead':0,'cacheWrite':0},'thinkingLevelMap':{'low':'low','high':'high'},'compat':{'supportsStore':False,'supportsDeveloperRole':False,'supportsReasoningEffort':True,'maxTokensField':'max_tokens','requiresReasoningContentOnAssistantMessages':True,'thinkingFormat':'openai'}}]}}})
  dump(cfg/'settings.json',{'defaultProvider':'moonshotai','defaultModel':MODEL,'defaultThinkingLevel':'low','cacheWarming':'off','retry':{'enabled':False},'compaction':{'enabled':False}})
  ext=cfg/'extensions'/'subagent';shutil.copytree(PI/'examples/extensions/subagent',ext,dirs_exist_ok=True)
  (cfg/'agents').mkdir(exist_ok=True)
  for name in ['scout','reviewer']:
   (cfg/'agents'/f'{name}.md').write_text(f'---\nname: {name}\ndescription: Read-only code evidence review\ntools: read, grep, find, ls, bash\n---\nRead the assigned source files and report exact evidence with line numbers. Never modify files.\n')
  args=['pi','--offline','--no-skills','--no-prompt-templates','--no-mcp','--provider','moonshotai','--model',MODEL,'--thinking','low','--tools','read,grep,find,ls,bash,subagent','--mode','json','--session-dir',str(run/'sessions'),'-p']
 elif arm=='opencode':
  env['PWD']=str(SRC.resolve())
  env.update(XDG_CONFIG_HOME=str(cfg/'xdg-config'),XDG_DATA_HOME=str(cfg/'xdg-data'),XDG_CACHE_HOME=str(cfg/'xdg-cache'),OPENCODE_DISABLE_PROJECT_CONFIG='true',OPENCODE_DISABLE_CLAUDE_CODE='true',OPENCODE_DISABLE_CLAUDE_CODE_PROMPT='true',OPENCODE_DISABLE_CLAUDE_CODE_SKILLS='true',OPENCODE_DISABLE_DEFAULT_PLUGINS='true',OPENCODE_DISABLE_AUTOUPDATE='true')
  conf={'$schema':'https://opencode.ai/config.json','model':'moonshotai/'+MODEL,'small_model':'moonshotai/'+MODEL,'enabled_providers':['moonshotai'],'instructions':[str(SRC/'AGENTS.md')],'provider':{'moonshotai':{'npm':'@ai-sdk/openai-compatible','options':{'baseURL':f'http://127.0.0.1:{port}','apiKey':'study-local-relay'},'models':{MODEL:{'limit':{'context':262144,'output':16384},'options':{'reasoningEffort':'low','thinking':{'type':'enabled'}},'variants':{'low':{'reasoningEffort':'low'}}}}}},'permission':{'*':'allow','edit':'deny','bash':'allow','webfetch':'deny','websearch':'deny','external_directory':'deny'},'agent':{'build':{'options':{'reasoningEffort':'low'}},'explore':{'model':'moonshotai/'+MODEL,'options':{'reasoningEffort':'low'}},'general':{'model':'moonshotai/'+MODEL,'options':{'reasoningEffort':'low'}}}}
  dump(cfg/'opencode.json',conf);env['OPENCODE_CONFIG']=str(cfg/'opencode.json');args=['opencode','run','--dir',str(SRC.resolve()),'--pure','--format','json','--model','moonshotai/'+MODEL,'--variant','low']
 else:
  env['DSH_HOME']=str(cfg/'dsh');env['DEEPSEEK_BASE_URL']=f'http://127.0.0.1:{port}/anthropic'
  patch=cfg/'dsh.patch.yml';patch.write_text('- id: agent-default-model\n  config:\n    provider: deepseek-official\n    model: deepseek-flash\n    reasoningEffort: low\n- id: llm-deepseek\n  config:\n    apiKeyEnv: DEEPSEEK_API_KEY\n    reasoningEffort: low\n    maxTokens: 16384\n- id: session-title-llm\n  disabled: true\n')
  args=[str(ROOT/'tools/node_modules/.bin/dsh'),'--profile','headless','--patch',str(patch),'--json']
 return args,env

def run_one(arm,task,rep,fake=False):
 run=ROOT/('preflight' if fake else 'runs')/f'{task}-{rep}-{arm}';run.mkdir(parents=True,exist_ok=False)
 srv=http.server.ThreadingHTTPServer(('127.0.0.1',0),Relay);srv.run=run;srv.records=[];srv.lock=threading.Lock();srv.fake=fake
 if not fake:
  auth=json.loads((pathlib.Path.home()/'.local/share/opencode/auth.json').read_text());srv.key=auth['kimi-for-coding']['key']
 else:srv.key='not-used'
 threading.Thread(target=srv.serve_forever,daemon=True).start()
 args,env=setup(arm,run,srv.server_port)
 prompt=COMMON+TASKS[task] if not fake else 'Only reply READY. Do not use tools.'
 (run/'prompt.txt').write_text(prompt);start=time.monotonic()
 with (run/'stdout.jsonl').open('w') as out,(run/'stderr.log').open('w') as err:
  p=subprocess.Popen(args+[prompt],cwd=SRC,env=env,stdout=out,stderr=err,start_new_session=True)
  try:code=p.wait(timeout=45 if fake else 900);timed=False
  except subprocess.TimeoutExpired:
   os.killpg(p.pid,signal.SIGTERM)
   try:p.wait(timeout=5)
   except:os.killpg(p.pid,signal.SIGKILL);p.wait()
   code=p.returncode;timed=True
 srv.shutdown();srv.server_close()
 result={'arm':arm,'task':task,'rep':rep,'exit':code,'timeout':timed,'seconds':round(time.monotonic()-start,2),'requests':len(srv.records),'usage_known':all(r.get('usage') for r in srv.records) and bool(srv.records),'input':sum((r.get('usage') or {}).get('input',0) for r in srv.records),'output':sum((r.get('usage') or {}).get('output',0) for r in srv.records),'wire_rejections':[r.get('rejected') for r in srv.records if r.get('rejected')]}
 dump(run/'summary.json',result);print(json.dumps(result),flush=True);return result
if __name__=='__main__':
 if sys.argv[1]=='preflight':
  for a in sys.argv[2:] or ['pi','opencode']:run_one(a,'return',int(time.time()),True)
 elif sys.argv[1]=='run':
  results=[]
  for task in TASKS:
   for rep in range(3):
    for a in (['pi','opencode'][rep:]+['pi','opencode'][:rep]):
     if sum(x['input'] for x in results)>24000000 or sum(x['output'] for x in results)>300000 or sum(x['requests'] for x in results)>600:raise SystemExit('batch budget reached')
     results.append(run_one(a,task,rep));dump(ROOT/'results.json',results)
