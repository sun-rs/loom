from study import *
results=[]
for task in TASKS:
 for rep in range(3):
  results.append(run_one('opencode',task,rep));dump(ROOT/'replacement-results.json',results)
