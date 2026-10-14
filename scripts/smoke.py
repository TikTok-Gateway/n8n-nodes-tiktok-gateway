"""Install the packed artifact in real n8n; use only an isolated mock gateway."""
import json, os, pathlib, secrets, subprocess, tempfile, time, urllib.request, urllib.error, sqlite3
ROOT=pathlib.Path(__file__).resolve().parents[1]
IMAGE=os.environ.get('N8N_TEST_IMAGE','docker.n8n.io/n8nio/n8n@sha256:c34ee9107a42b837e25cec0c8a927ab90a45b776aa2ccbf15e5b9cda466fad2c')
def run(*args): return subprocess.check_output(args,text=True,stderr=subprocess.STDOUT).strip()
def request(base,path,body=None,auth=None):
 req=urllib.request.Request(base+path,data=json.dumps(body).encode() if body is not None else None,headers={'Content-Type':'application/json',**({'Authorization':'Bearer '+auth} if auth else {})})
 with urllib.request.urlopen(req,timeout=10) as r:
  data=r.read();return json.loads(data) if data else None
def until(fn,seconds=100):
 end=time.monotonic()+seconds
 while time.monotonic()<end:
  try:
   result=fn()
   if result:return result
  except (OSError,ValueError):pass
  time.sleep(.5)
 raise AssertionError('Timed out waiting for isolated smoke condition')
with tempfile.TemporaryDirectory(prefix='tiktok-package-smoke-') as directory:
 d=pathlib.Path(directory);d.chmod(0o755)
 name='tiktok-package-'+secrets.token_hex(4);gateway=name+'-mock';n8n=name+'-n8n'
 version=json.loads((ROOT/'package.json').read_text())['version']
 tarball=ROOT/f'n8n-nodes-tiktok-gateway-{version}.tgz'
 if not tarball.exists():raise RuntimeError('Run npm pack first')
 import shutil
 shutil.copy(tarball,d/'package.tgz');shutil.copy(ROOT/'test/mock-gateway.cjs',d/'mock.cjs')
 w=json.loads((ROOT/'examples/welcome.json').read_text());w['id']='package-smoke';w['settings'].update({'saveDataSuccessExecution':'all','saveDataErrorExecution':'all'})
 for node in w['nodes']:
  if node['type'].startswith('n8n-nodes-tiktok-gateway.'):
   node['credentials']={'tikTokGatewayApi':{'id':'smoke-credential','name':'Synthetic gateway'}}
  if node['type'].endswith('.tikTokSticker'):node['parameters']['stickerId']='1'
  # Mock only configuration storage; the live Data Table integration is verified separately.
  if node['name']=='Shared Welcome':
   node.update(type='n8n-nodes-base.set',typeVersion=3.4,parameters={'mode':'raw','jsonOutput':'{"message":"Synthetic welcome"}','options':{}})
  if node['type']=='n8n-nodes-base.wait':node['parameters']['amount']='={{ $json.eventId === "wait-restart" ? 65 : 0.1 }}'
 (d/'workflow.json').write_text(json.dumps(w))
 # A separate isolated workflow exercises discovery of BOTH new nodes.
 incoming={'id':'incoming-smoke','name':'Incoming smoke','active':False,'settings':{'executionOrder':'v1'},'nodes':[
  {'id':'events','name':'Events','type':'n8n-nodes-tiktok-gateway.tikTokEvents','typeVersion':1,'position':[0,0],'parameters':{},'webhookId':'tiktok-events-gateway'},
  {'id':'history','name':'History','type':'n8n-nodes-tiktok-gateway.tikTokGetMessages','typeVersion':1,'position':[200,0],'parameters':{'recipient':'={{ $json.userId }}','maxPages':3}},
  {'id':'reply','name':'Reply','type':'n8n-nodes-tiktok-gateway.tikTokText','typeVersion':1,'position':[400,0],'parameters':{'recipient':'={{ $json.userId }}','text':'Synthetic reply','options':{'actionKey':'welcome-first-reply-v1'}}},
 ],'connections':{'Events':{'main':[[],[{'node':'History','type':'main','index':0}]]},'History':{'main':[[{'node':'Reply','type':'main','index':0}]]}}}
 for node in incoming['nodes']:node['credentials']={'tikTokGatewayApi':{'id':'smoke-credential','name':'Synthetic gateway'}}
 gate=next(n for n in json.loads((ROOT/'examples/welcome-reply.json').read_text())['nodes'] if n['name']=='Welcome Reply Gate')
 gate['parameters']['jsCode']="const synthetic = $input.all().map(item => ({...item, json:{...item.json, settings:{welcomeText:'Welcome?'}}}));\n"+gate['parameters']['jsCode'].replace('$input.all()', 'synthetic')
 incoming['nodes'].append(gate)
 incoming['connections']['History']={'main':[[{'node':'Welcome Reply Gate','type':'main','index':0}]]}
 incoming['connections']['Welcome Reply Gate']={'main':[[{'node':'Reply','type':'main','index':0}]]}
 (d/'incoming.json').write_text(json.dumps(incoming))
 (d/'credentials.json').write_text(json.dumps([{'id':'smoke-credential','name':'Synthetic gateway','type':'tikTokGatewayApi','data':{'url':'http://gateway:8080','apiToken':'smoke-api','webhookToken':'smoke-hook'}}]))
 try:
  run('docker','network','create',name)
  run('docker','run','-d','--name',gateway,'--network',name,'--network-alias','gateway','-v',str(d)+':/fixture:ro','-p','127.0.0.1::8080','--entrypoint','node',IMAGE,'/fixture/mock.cjs')
  gurl='http://'+run('docker','port',gateway,'8080/tcp');until(lambda:request(gurl,'/inspect'))
  run('docker','run','-d','--name',n8n,'--network',name,'-v',str(d)+':/fixture:ro','-p','127.0.0.1::5678','-e','N8N_DIAGNOSTICS_ENABLED=false','-e','N8N_VERSION_NOTIFICATIONS_ENABLED=false','-e','N8N_ENCRYPTION_KEY=synthetic-smoke-only-key','--entrypoint','/bin/sh',IMAGE,'-c',
   'set -eu; if [ ! -f /home/node/.n8n/smoke-ready ]; then mkdir -p /home/node/.n8n/nodes && cd /home/node/.n8n/nodes && npm install --offline --ignore-scripts --legacy-peer-deps --no-audit --no-fund /fixture/package.tgz && n8n import:credentials --input=/fixture/credentials.json && n8n import:workflow --input=/fixture/workflow.json && n8n publish:workflow --id=package-smoke && n8n import:workflow --input=/fixture/incoming.json && n8n publish:workflow --id=incoming-smoke && touch /home/node/.n8n/smoke-ready; fi; exec n8n start')
  nurl='http://'+run('docker','port',n8n,'5678/tcp');until(lambda:request(nurl,'/healthz/readiness'))
  def emit(event,auth='smoke-hook',**overrides):
   return request(nurl,'/webhook/tiktok-follower-gateway',{'schemaVersion':'1','type':'follower.created','eventId':event,'accountId':'100','occurredAt':'2026-01-01T00:00:00Z','detectedAt':'2026-01-01T00:00:01Z','data':{'userId':'200','username':'synthetic'},**overrides},auth)
  def webhook_ready():
   try: emit('readiness-probe', auth='wrong')
   except urllib.error.HTTPError as e:
    if e.code == 401: return True
    if e.code == 404: return False
    raise
   raise AssertionError('Webhook accepted an unauthorized readiness probe')
  until(webhook_ready)
  for kwargs,code in [({'auth':'wrong'},401),({'data':{'userId':200}},400),({'accountId':None},400)]:
   try:emit('invalid',**kwargs)
   except urllib.error.HTTPError as e:assert e.code==code,(e.code,code)
   else:raise AssertionError('Invalid webhook accepted')
  def ops(event):return [o for o in request(gurl,'/inspect')['operations'] if o['key'].startswith(event+':')]
  def complete(event):return len(ops(event))==2 and all(o['state']=='succeeded' for o in ops(event))
  def emit_message(user,event):
   message={'messageId':'30','senderId':user,'direction':'incoming','type':'text','text':'yes','sentAt':'2026-01-01T00:01:00Z'}
   return request(nurl,'/webhook/tiktok-events-gateway',{'schemaVersion':'1','type':'message.received','eventId':event,'accountId':'100','occurredAt':message['sentAt'],'detectedAt':'2026-01-01T00:01:01Z','data':{'userId':user,'conversationId':'0:1:100:'+user,'messageId':'30','message':message}},'smoke-hook')
  emit_message('201','incoming-good');until(lambda:len(ops('incoming-good'))==1 and ops('incoming-good')[0]['state']=='succeeded')
  emit_message('201','incoming-good');emit_message('202','incoming-ordinary');time.sleep(3)
  assert len(ops('incoming-good'))==1
  assert len(ops('incoming-ordinary'))==0
  assert any('/v1/conversations/202/messages?cursor=10'==c['path'] for c in request(gurl,'/inspect')['calls'])
  emit('normal');until(lambda:complete('normal'));emit('normal');time.sleep(3);assert len(ops('normal'))==2
  for event in ['failed','uncertain']:
   emit(event);until(lambda:ops(event) and ops(event)[0]['state']==event);time.sleep(2);assert len(ops(event))==1
  for event in ['recipient-7202','recipient-7409']:
   emit(event);until(lambda:ops(event) and ops(event)[0]['state']=='failed');time.sleep(2);assert len(ops(event))==1
  emit('restart');until(lambda:ops('restart') and ops('restart')[0]['polls']>=1)
  run('docker','kill',n8n);run('docker','start',n8n);nurl='http://'+run('docker','port',n8n,'5678/tcp');until(lambda:request(nurl,'/healthz/readiness'));until(webhook_ready)
  emit('restart');until(lambda:complete('restart'));assert len(ops('restart'))==2
  emit('wait-restart');time.sleep(3);assert not ops('wait-restart')
  run('docker','restart','-t','3',n8n);nurl='http://'+run('docker','port',n8n,'5678/tcp');until(lambda:request(nurl,'/healthz/readiness'))
  until(lambda:complete('wait-restart'),100)
  inspection=request(gurl,'/inspect');assert all('/control/' not in c['path'] for c in inspection['calls'])
  run('docker','stop','-t','5',n8n)
  run('docker','cp',n8n+':/home/node/.n8n/database.sqlite',str(d/'database.sqlite'))
  # Copy the WAL when present so all committed execution data is included.
  for suffix in ['-wal','-shm']:
   subprocess.run(['docker','cp',n8n+':/home/node/.n8n/database.sqlite'+suffix,str(d/('database.sqlite'+suffix))],capture_output=True)
  db=sqlite3.connect(d/'database.sqlite')
  statuses=dict(db.execute('SELECT status, count(*) FROM execution_entity GROUP BY status'))
  assert statuses.get('success',0)>=4,statuses
  rows='\n'.join(str(row) for row in db.execute('SELECT data FROM execution_data'))
  assert 'tiktok_rejected_send' in rows and '7170' in rows and 'send_result_unknown' in rows
  for event in ['recipient-7202','recipient-7409']:
   matches=list(db.execute("SELECT e.status,d.data FROM execution_entity e JOIN execution_data d ON e.id=d.executionId WHERE d.data LIKE ?",('%'+event+'%',)))
   assert len(matches)==1 and matches[0][0]=='success',matches
   assert 'skipped' in matches[0][1] and 'recipient_unavailable' in matches[0][1]
  assert 'smoke-api' not in rows and 'smoke-hook' not in rows
  print('PASS: Events + Get Messages discovery; incoming pagination, ordinary-chat block and duplicate reply; npm tarball discovery; webhook 401/400; text + sticker; duplicate keys; failed/uncertain block; active-poll crash + replay; persisted Wait restart; no resume; saved execution diagnostics; no tokens. Statuses:',statuses)
 except Exception as e:
  if isinstance(e,subprocess.CalledProcessError):print(e.output[-4000:])
  try: print('Mock operations:',request(gurl,'/inspect')['operations'])
  except Exception: pass
  logs=subprocess.run(['docker','logs','--tail=45',n8n],capture_output=True,text=True);print(logs.stdout[-6000:]);print(logs.stderr[-2000:]);raise
 finally:
  subprocess.run(['docker','rm','-f',gateway,n8n],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
  subprocess.run(['docker','network','rm',name],stdout=subprocess.DEVNULL,stderr=subprocess.DEVNULL)
