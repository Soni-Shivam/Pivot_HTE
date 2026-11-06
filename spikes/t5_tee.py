import json, urllib.request, time
env = dict(l.strip().split('=',1) for l in open('.env') if '=' in l and not l.startswith('#'))
BASE, KEY = env['ZG_ROUTER_URL'].rstrip('/'), env['ZG_API_KEY']
body={"model":"0gm-1.0-35b-a3b","messages":[{"role":"user","content":"Reply with JSON only: {\"action\":\"MAINTAIN\"}"}],"temperature":0,"max_tokens":30,"verify_tee":True,"chat_template_kwargs":{"enable_thinking":False}}
for path in ['/chat/completions','/chat/completions?verify_tee=true']:
    req=urllib.request.Request(BASE+path,data=json.dumps(body).encode(),method='POST',headers={'Content-Type':'application/json','Authorization':'Bearer '+KEY,'X-0G-Provider-Trust-Mode':'private'})
    with urllib.request.urlopen(req,timeout=60) as r: j=json.loads(r.read()); h=dict(r.headers)
    print(path, '| trace keys:', sorted(j.get('x_0g_trace',{}).keys()), '| tee_verified:', j.get('x_0g_trace',{}).get('tee_verified'), '| top-level keys:', sorted(k for k in j if k not in ('choices','usage')), '| ZG-Res-Key:', h.get('Zg-Res-Key'), '| provider:', j['x_0g_trace']['provider'])
open('/tmp/claude-1000/-home-sedrica-w-shivam-eth-hackathon/b6e6b690-5f11-48bd-aef0-ce045381ee64/scratchpad/last_chat.json','w').write(json.dumps({'provider':j['x_0g_trace']['provider'],'chatId':h.get('Zg-Res-Key'),'content':j['choices'][0]['message']['content']}))
