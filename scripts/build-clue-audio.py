"""Generate MiniMax dialogue and mix existing downloaded music, with resumable jobs."""
from pathlib import Path
import argparse,concurrent.futures,hashlib,io,json,os,re,shutil,subprocess,tarfile,time,urllib.request
import numpy as np
ROOT=Path(__file__).resolve().parents[1]
CACHE=ROOT/'output/clue-audio'
OUT=ROOT/'交付包_阿拉斯加之夜/线索配乐音频'
CFG=json.loads((CACHE/'config.json').read_text())
MUSIC=ROOT/'交付包_阿拉斯加之夜/现场演绎音频/配乐与音效'
ASSETS=ROOT/'server/audio/files'
SR=48000
def api(path,key,payload=None):
 req=urllib.request.Request('https://api.minimax.cn'+path,data=None if payload is None else json.dumps(payload).encode(),headers={'Authorization':'Bearer '+key,'Content-Type':'application/json'})
 with urllib.request.urlopen(req,timeout=60) as r:d=json.load(r)
 if d.get('base_resp',{}).get('status_code',0)!=0:raise RuntimeError(str(d['base_resp']))
 return d
def synth(t,i,l,key):
 ident=f'{t["id"]}-{t["part"]}-{i+1:02d}'
 dest=CACHE/'raw'/(ident+'.mp3');dest.parent.mkdir(parents=True,exist_ok=True)
 if l.get('reuse'):
  shutil.copy2(ROOT/'交付包_阿拉斯加之夜/现场演绎音频/制作分轨/原始台词'/l['reuse'],dest)
  return
 voice,_,speed,pitch,_=CFG['voices'][l['role']]
 payload=dict(model=CFG['model'],text=l['text'],language_boost='Chinese',voice_setting=dict(voice_id=voice,speed=speed,vol=1,pitch=pitch,emotion=l['emotion']),audio_setting=dict(audio_sample_rate=32000,bitrate=128000,format='mp3',channel=1))
 sha=hashlib.sha256(json.dumps(payload,sort_keys=True).encode()).hexdigest()
 statepath=CACHE/(ident+'.json');state=json.loads(statepath.read_text()) if statepath.exists() else {}
 if state.get('sha256') and state['sha256']!=sha:raise RuntimeError(ident+' changed: explicit review required before new paid job')
 if dest.exists() and state.get('downloaded'):return
 if not state.get('task_id'):
  d=api('/v1/t2a_async_v2',key,payload)
  state=dict(task_id=str(d['task_id']),sha256=sha,usage_characters=d.get('usage_characters'))
  statepath.write_text(json.dumps(state));print(ident,'submitted',flush=True)
 for _ in range(80):
  d=api('/v1/query/t2a_async_query_v2?task_id='+state['task_id'],key)
  status=d.get('status','').lower()
  if status=='success':
   f=api('/v1/files/retrieve?file_id='+str(d['file_id']),key)['file']
   with urllib.request.urlopen(f['download_url'],timeout=90) as r:blob=r.read()
   with tarfile.open(fileobj=io.BytesIO(blob),mode='r:*') as tar:
    for m in tar.getmembers():
     if m.isfile() and Path(m.name).suffix in ['.mp3','.titles','.extra']:
      p=dest if m.name.endswith('.mp3') else CACHE/(ident+Path(m.name).suffix)
      p.write_bytes(tar.extractfile(m).read())
   if not dest.exists():raise RuntimeError('no audio in task archive')
   state['downloaded']=True;statepath.write_text(json.dumps(state));print(ident,'downloaded',flush=True);return
  if status in ['failed','expired']:raise RuntimeError(ident+': '+status)
  time.sleep(8)
 raise TimeoutError(ident+': task not finished; resume without resubmitting')
def decode(p,af=''):
 cmd=['ffmpeg','-v','error','-i',str(p)]
 if af:cmd+=['-af',af]
 return np.frombuffer(subprocess.check_output(cmd+['-ar',str(SR),'-ac','2','-f','f32le','pipe:1']),dtype='<f4').reshape(-1,2).copy()
def save(arr,p):
 subprocess.run(['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i','pipe:0','-af','loudnorm=I=-16:TP=-1.8:LRA=9','-ar',str(SR),'-c:a','libmp3lame','-b:a','128k','-metadata','comment=AI dramatization: MiniMax. Music by Kevin MacLeod (incompetech.com), CC BY 4.0. Edited and mixed.',str(p)],input=arr.astype('<f4').tobytes(),check=True)
def mix(t):
 parts=[];segments=[];cursor=1.25
 for i,l in enumerate(t['lines']):
  k=f'{t["id"]}-{t["part"]}-{i+1:02d}'
  v=decode(CACHE/'raw'/(k+'.mp3'),'highpass=f=70,loudnorm=I=-18:TP=-3:LRA=9')
  segments.append((cursor,v));l['start']=cursor;l['end']=cursor+len(v)/SR
  cursor=l['end']+.6
 n=int((cursor+2.5)*SR);speech=np.zeros((n,2),np.float32)
 for start,v in segments:speech[int(start*SR):int(start*SR)+len(v)]+=v
 bg=decode(MUSIC/t['music'],'loudnorm=I=-25:TP=-4:LRA=9')
 offset=0 if t['music']=='At Rest.mp3' else 20*SR
 bg=bg[offset:offset+n]
 if len(bg)<n:bg=np.tile(bg,(int(np.ceil(n/len(bg))),1))[:n]
 envelope=np.ones(n,np.float32)
 for start,v in segments:
  a=int(start*SR);b=a+len(v);lo=max(0,a-int(.25*SR));hi=min(n,b+int(.6*SR))
  envelope[a:b]=np.minimum(envelope[a:b],.38)
  envelope[lo:a]=np.minimum(envelope[lo:a],np.linspace(1,.38,a-lo))
  envelope[b:hi]=np.minimum(envelope[b:hi],np.linspace(.38,1,hi-b))
 envelope[:SR]*=np.linspace(0,1,SR);envelope[-2*SR:]*=np.linspace(1,0,2*SR)
 bg*=envelope[:,None]
 filename=t['id'].lower()+'-'+t['part']+'.mp3';p=ASSETS/filename
 save(speech+bg,p)
 (OUT/'基础线索' if t['part']=='body' else OUT/'鉴定补充_GM保密').mkdir(parents=True,exist_ok=True)
 shutil.copy2(p,(OUT/'基础线索' if t['part']=='body' else OUT/'鉴定补充_GM保密')/filename)
 isrc={'Long Note One.mp3':'USUAN1100418','At Rest.mp3':'USUAN1100748','Darkest Child.mp3':'USUAN1100783'}[t['music']]
 credit=dict(title=t['music'].removesuffix('.mp3'),artist='Kevin MacLeod',source='https://incompetech.com/music/royalty-free/index.html?isrc='+isrc,license='CC BY 4.0',licenseUrl='https://creativecommons.org/licenses/by/4.0/',changes='截取、淡入淡出、音量调整与对白混音')
 print(filename,round(n/SR,2),'mixed',flush=True)
 return dict(id=t['id'],part=t['part'],sourceHash=t['sourceHash'],filename=filename,duration=round(n/SR,3),speakers=list(dict.fromkeys(l['role'] for l in t['lines'])),music=credit,sha256=hashlib.sha256(p.read_bytes()).hexdigest())
def main():
 parser=argparse.ArgumentParser();parser.add_argument('--key-file');parser.add_argument('--mix-only',action='store_true');args=parser.parse_args()
 ASSETS.mkdir(parents=True,exist_ok=True)
 if not args.mix_only:
  key=Path(args.key_file).read_text().strip() if args.key_file else os.environ['MINIMAX_API_KEY']
  failed=[]
  with concurrent.futures.ThreadPoolExecutor(max_workers=8) as pool:
   futures={pool.submit(synth,t,i,l,key):f'{t["id"]}-{t["part"]}-{i}' for t in CFG['tracks'] for i,l in enumerate(t['lines'])}
   for f in concurrent.futures.as_completed(futures):
    try:f.result()
    except Exception as e:failed.append(futures[f]);print(futures[f],str(e)[:200],flush=True)
  if failed:raise SystemExit('Incomplete: '+str(failed))
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:tracks=list(pool.map(mix,CFG['tracks']))
 manifest=dict(version=CFG['version'],model=CFG['model'],tracks=tracks)
 (ROOT/'server/audio/clue-audio.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
 (OUT/'音频映射与验收清单.json').write_text(json.dumps(manifest,ensure_ascii=False,indent=2))
 (OUT/'分层配音源稿_GM保密.json').write_text(json.dumps(CFG,ensure_ascii=False,indent=2))
 print('ALL 58 CLUE AUDIO TRACKS READY',flush=True)
if __name__=='__main__':main()
