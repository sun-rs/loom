import ssl,urllib.request,time,json,statistics
from pathlib import Path
ctx=ssl.create_default_context(cafile='/Users/sun/.loom/evo/tls/local-ca.crt')
rows=[]
for i in range(12):
 for scheme,port in ([('https',4178),('http',4176)] if i%2 else [('http',4176),('https',4178)]):
  start=time.perf_counter()
  with urllib.request.urlopen(f'{scheme}://192.168.1.86:{port}/',context=ctx,timeout=10) as r:
   ttfb=(time.perf_counter()-start)*1000;b=r.read();status=r.status
  rows.append({'i':i,'scheme':scheme,'status':status,'ttfbMs':ttfb,'totalMs':(time.perf_counter()-start)*1000,'bytes':len(b)})
Path('/Users/sun/.loom/reviews/2026-10-23-browser-metrics/tls.json').write_text(json.dumps(rows,indent=2))
for scheme in ['http','https']:
 z=[x['totalMs'] for x in rows if x['scheme']==scheme];print(scheme,'n',len(z),'median',statistics.median(z),'max',max(z))
