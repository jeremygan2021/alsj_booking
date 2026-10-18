"""MiniMax async TTS: resumable jobs, no API keys or temporary download URLs in delivery."""
from pathlib import Path
import argparse, concurrent.futures, hashlib, io, json, os, tarfile, time, urllib.request

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'交付包_阿拉斯加之夜'/'现场演绎音频'
CACHE=ROOT/'output'/'performance-audio'
CACHE.mkdir(parents=True,exist_ok=True)
CONFIG=json.loads((OUT/'演绎制作源稿.json').read_text())
P=argparse.ArgumentParser();P.add_argument('--key-file');P.add_argument('--prefix',default='');ARGS=P.parse_args()
KEY=Path(ARGS.key_file).read_text().strip() if ARGS.key_file else os.environ['MINIMAX_API_KEY']
BASE='https://api.minimax.cn'
def api(path,payload=None):
 req=urllib.request.Request(BASE+path,data=None if payload is None else json.dumps(payload).encode(),headers={'Authorization':'Bearer '+KEY,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=60) as f:d=json.load(f)
 if d.get('base_resp',{}).get('status_code',0)!=0:raise RuntimeError(str(d['base_resp']))
 return d
def job(t,i,l):
 ident=f'{t["id"]}_{i+1:02d}'
 folder=OUT/'制作分轨'/'原始台词';folder.mkdir(parents=True,exist_ok=True)
 dest=folder/f'{ident}_{l["role"]}.mp3'
 voice,name,speed,pitch,_=CONFIG['voices'][l['role']]
 payload=dict(model=CONFIG['model'],text=l['text'],language_boost='Chinese',voice_setting=dict(voice_id=voice,speed=speed,vol=1,pitch=pitch,emotion=l['emotion']),audio_setting=dict(audio_sample_rate=32000,bitrate=128000,format='mp3',channel=1))
 digest=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
 statepath=CACHE/f'{ident}.json'
 state=json.loads(statepath.read_text()) if statepath.exists() else {}
 if state.get('sha256') and state['sha256']!=digest:raise RuntimeError(f'{ident}: source changed; review before paid regeneration')
 if dest.exists() and state.get('downloaded'):return ident
 if not state.get('task_id'):
  d=api('/v1/t2a_async_v2',payload)
  state=dict(id=ident,task_id=str(d['task_id']),file_id=str(d['file_id']),sha256=digest,usage_characters=d.get('usage_characters'),voice_id=voice)
  statepath.write_text(json.dumps(state,ensure_ascii=False,indent=2))
  print(ident,'submitted',flush=True)
 for attempt in range(80):
  d=api('/v1/query/t2a_async_query_v2?task_id='+state['task_id'])
  status=d.get('status','').lower()
  if status=='success':
   file=api('/v1/files/retrieve?file_id='+str(d['file_id']))['file']
   with urllib.request.urlopen(file['download_url'],timeout=90) as f:blob=f.read()
   with tarfile.open(fileobj=io.BytesIO(blob),mode='r:*') as tar:
    for member in tar.getmembers():
     if member.isfile() and Path(member.name).suffix in ['.mp3','.titles','.extra']:
      data=tar.extractfile(member).read()
      target=dest if member.name.endswith('.mp3') else CACHE/(ident+Path(member.name).suffix)
      target.write_bytes(data)
   if not dest.exists():raise RuntimeError(f'{ident}: no audio in downloaded archive')
   state['downloaded']=True;statepath.write_text(json.dumps(state,ensure_ascii=False,indent=2))
   print(ident,'downloaded',flush=True);return ident
  if status in ['failed','expired']:raise RuntimeError(f'{ident}: {status}; task retained, no automatic resubmit')
  time.sleep(8)
 raise TimeoutError(f'{ident}: still processing; resume with same command')

if __name__=='__main__':
 work=[(t,i,l) for t in CONFIG['tracks'] if t['id'].startswith(ARGS.prefix) for i,l in enumerate(t['lines'])]
 failed=[]
 with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
  futures={pool.submit(job,*args):f'{args[0]["id"]}_{args[1]+1:02d}' for args in work}
  for f in concurrent.futures.as_completed(futures):
   try:f.result()
   except Exception as e: failed.append(futures[f]);print(futures[f],type(e).__name__,str(e)[:300],flush=True)
 if failed:raise SystemExit('Incomplete: '+','.join(failed))
 print('ALL VOICES COMPLETE',flush=True)
