"""Mix downloaded music/foley with MiniMax speech. Does not synthesize music."""
from pathlib import Path
import argparse, concurrent.futures, csv, hashlib, json, re, shutil, subprocess
import numpy as np

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'交付包_阿拉斯加之夜'/'现场演绎音频'
CACHE=ROOT/'output'/'performance-audio'
CFG=json.loads((OUT/'演绎制作源稿.json').read_text())
SR=48000
MUSIC={
 'snow':('Long Note One.mp3',10), 'gala':('Danse Macabre.mp3',85),
 'intrigue':('Darkest Child.mp3',0), 'echo':('Long Note One.mp3',80),
 'discovery':('Awkward Meeting.mp3',5), 'memory':('At Rest.mp3',0),
 'investigation':('Long Note One.mp3',125), 'trial':('Darkest Child.mp3',80),
 'murder':('Awkward Meeting.mp3',0), 'farewell':('At Rest.mp3',0), 'dawn':('At Rest.mp3',60),
}
SFX={
 'door':('rpg-audio','doorOpen_1.ogg'),
 'money':('casino-audio','card-shuffle.ogg'),
 'impact':('impact-sounds','impactSoft_heavy_000.ogg'),
 'terminal':('interface-sounds','confirmation_001.ogg'),
 'recorder':('rpg-audio','metalClick.ogg'),
 'gavel':('impact-sounds','impactWood_medium_000.ogg'),
}
for d in ['现场播放版_MP3','无损母带_WAV','字幕与走位','制作分轨/人声','制作分轨/配乐音效','证据纯人声','配乐与音效/音效']:(OUT/d).mkdir(parents=True,exist_ok=True)
for key,(pack,file) in SFX.items():
 src=CACHE/'sfx'/pack/file
 assert src.exists(),src
 shutil.copy2(src,OUT/'配乐与音效'/'音效'/file)
for pack in ['rpg-audio','impact-sounds','casino-audio','interface-sounds']:
 p=CACHE/'sfx'/pack/'License.txt'
 if p.exists():shutil.copy2(p,OUT/'配乐与音效'/f'Kenney_{pack}_License.txt')

def decode(p,filter=None):
 cmd=['ffmpeg','-v','error','-i',str(p)]
 if filter:cmd+=['-af',filter]
 cmd+=['-ar',str(SR),'-ac','2','-f','f32le','pipe:1']
 return np.frombuffer(subprocess.check_output(cmd),dtype='<f4').reshape(-1,2).copy()
def encode(arr,p,master=False):
 cmd=['ffmpeg','-v','error','-y','-f','f32le','-ar',str(SR),'-ac','2','-i','pipe:0']
 if master:cmd+=['-af','loudnorm=I=-16:TP=-1.5:LRA=11','-ar',str(SR)]
 if p.suffix=='.mp3':cmd+=['-c:a','libmp3lame','-b:a','256k','-id3v2_version','3','-metadata','artist=阿拉斯加之夜演绎制作','-metadata','comment=AI角色语音：MiniMax；Music: Kevin MacLeod (incompetech.com), CC BY 4.0; SFX: Kenney CC0']
 else:cmd+=['-c:a','pcm_s16le']
 subprocess.run(cmd+[str(p)],input=arr.astype('<f4').tobytes(),check=True)
def add(dest,src,seconds,gain=1):
 start=int(seconds*SR);length=min(len(src),len(dest)-start)
 if length>0:dest[start:start+length]+=src[:length]*gain
def clean(text):return re.sub(r'\([^)]*\)','',text).replace('艾迪艾斯','ADS').replace('伊寇','ECHO')
def stamp(t):
 ms=round(t*1000);return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'
def fmt(t):return f'{int(t)//60:02d}:{int(t)%60:02d}'

def mix(t):
 ident=t['id']; name=ident+'_'+t['title']
 segments=[];cursor=t.get('intro',3.0);events=[];subs=[]
 for i,l in enumerate(t['lines']):
  k=f'{ident}_{i+1:02d}';p=OUT/'制作分轨'/'原始台词'/f'{k}_{l["role"]}.mp3'
  filters='highpass=f=70,loudnorm=I=-18:TP=-3:LRA=11'
  if t.get('voiceTempo'):filters+=f',atempo={t["voiceTempo"]}'
  voice=decode(p,filters)
  duration=len(voice)/SR
  segments.append((cursor,voice))
  l['start']=round(cursor,3);l['end']=round(cursor+duration,3)
  titles=json.loads((CACHE/(k+'.titles')).read_text())
  for a in titles:subs.append((cursor+a['time_begin']/1000,min(cursor+a['time_end']/1000,cursor+duration),l['role']+'：'+clean(a['text'])))
  cue=l.get('cue')
  if cue:
   ct=cursor+duration+0.1
   if cue=='entrance':ct=cursor
   if cue=='money':ct=cursor+5.1
   if cue=='terminal':ct=cursor+duration+0.3
   events.append(dict(time=round(ct,3),cue=cue))
  cursor+=duration+l['gap']
 total=cursor+4;n=int(total*SR)
 speech=np.zeros((n,2),np.float32)
 for start,v in segments:add(speech,v,start)
 musicfile,offset=MUSIC[t['music']]
 bgsource=decode(OUT/'配乐与音效'/musicfile,'loudnorm=I=-25:TP=-4:LRA=11')
 # Repeat existing audio with a 2-second crossfade if the passage is longer than its source.
 bgsource=bgsource[int(offset*SR):]
 while len(bgsource)<n:
  cross=min(2*SR,len(bgsource)//4)
  original=decode(OUT/'配乐与音效'/musicfile,'loudnorm=I=-25:TP=-4:LRA=11')
  ramp=np.linspace(0,1,cross,dtype=np.float32)[:,None]
  bgsource=np.concatenate([bgsource[:-cross],bgsource[-cross:]*(1-ramp)+original[:cross]*ramp,original[cross:]])
 music=bgsource[:n].copy()
 # Smooth music ducking across each speech passage, including breaths and short pauses.
 gain=np.ones(n,np.float32)
 for start,v in segments:
  a=int(start*SR);b=a+len(v);attack=int(0.35*SR);release=int(0.9*SR)
  gain[a:b]=np.minimum(gain[a:b],0.40)
  lo=max(0,a-attack);gain[lo:a]=np.minimum(gain[lo:a],np.linspace(1,.4,a-lo))
  hi=min(n,b+release);gain[b:hi]=np.minimum(gain[b:hi],np.linspace(.4,1,hi-b))
 gain[:int(2*SR)]*=np.linspace(0,1,int(2*SR))
 fade=min(int(4*SR),n);gain[-fade:]*=np.linspace(1,0,fade)
 music*=gain[:,None]
 for ev in events:
  if ev['cue'] in SFX:
   pack,file=SFX[ev['cue']];effect=decode(OUT/'配乐与音效'/'音效'/file)
   peak=max(float(np.max(np.abs(effect))),.001)
   target=.13 if ev['cue']=='impact' else .08
   add(music,effect,ev['time'],target/peak)
   if ev['cue']=='money':
    for delay in [.7,1.5,2.3]:add(music,effect,ev['time']+delay,.6*target/peak)
  if ev['cue']=='money':ev['instruction']='撒钱窗口：听到“接住”开始轻抛游戏券；随后8秒停顿可完成动作。'
  elif ev['cue']=='impact':ev['instruction']='错位举杯、灯闪、索恩安全倒地；不得真击打。'
  elif ev['cue']=='applause':ev['instruction']='引导现场观众鼓掌，索恩走至灯区。'
  elif ev['cue']=='glass':ev['instruction']='索恩举杯，演员配合，声音留给现场。'
  elif ev['cue']=='door':ev['instruction']='配合开门/进入动作。'
  elif ev['cue']=='entrance':ev['instruction']='该角色真人NPC入场定点，保持静默，随自己的配音做表情和动作。'
  elif ev['cue']=='gavel':ev['instruction']='拍卖师落槌，第一件拍品亮灯。'
  else:ev['instruction']='音效已混入，演员按台词继续。'
 # In the fatal beat, pull the score down briefly to expose the one non-graphic impact.
 if ident=='A10':
  moment=next(e['time'] for e in events if e['cue']=='impact')
  lo=int((moment+.3)*SR);hi=min(n,int((moment+1.9)*SR));music[lo:hi]*=.18
 encode(speech,OUT/'制作分轨'/'人声'/(name+'_人声.mp3'))
 encode(music,OUT/'制作分轨'/'配乐音效'/(name+'_配乐音效.mp3'))
 wav=OUT/'无损母带_WAV'/(name+'.wav');encode(speech+music,wav,True)
 mp3=OUT/'现场播放版_MP3'/(name+'.mp3')
 subprocess.run(['ffmpeg','-v','error','-y','-i',str(wav),'-c:a','libmp3lame','-b:a','256k','-metadata','title='+t['title'],'-metadata','artist=阿拉斯加之夜','-metadata','comment=Music by Kevin MacLeod (incompetech.com), CC BY 4.0. SFX by Kenney CC0. AI voices by MiniMax.',str(mp3)],check=True)
 srt='\n\n'.join(f'{i+1}\n{stamp(a)} --> {stamp(b)}\n{txt}' for i,(a,b,txt) in enumerate(subs))+'\n'
 (OUT/'字幕与走位'/(name+'.srt')).write_text(srt)
 t.update(duration=round(total,3),file='现场播放版_MP3/'+mp3.name,wav='无损母带_WAV/'+wav.name,events=events,musicSource=musicfile,musicOffset=offset,sha256=hashlib.sha256(mp3.read_bytes()).hexdigest())
 # These are AI-acted fictional evidence substitutes; keep them dry, without added foley/music.
 if ident in ['A04','A06','A11']:
  chosen=[v for (start,v),l in zip(segments,t['lines']) if (l['role']=='瑟琳娜' if ident=='A06' else l['role']=='索恩')]
  pieces=[]
  for v in chosen:pieces.extend([v,np.zeros((int(.65*SR),2),np.float32)])
  encode(np.concatenate(pieces),OUT/'证据纯人声'/({'A04':'E-15_21点07分索恩数字演示','A06':'E-07_瑟琳娜生前声明_剧情录音演绎','A11':'E-26_索恩真实遗言_音频替代版'}[ident]+'.mp3'))
 print(ident,fmt(total),'mixed',flush=True)
 return t

if __name__=='__main__':
 p=argparse.ArgumentParser();p.add_argument('--prefix',default='');args=p.parse_args()
 selected=[t for t in CFG['tracks'] if t['id'].startswith(args.prefix)]
 with concurrent.futures.ThreadPoolExecutor(max_workers=3) as ex:new=list(ex.map(mix,selected))
 previous=OUT/'播放清单.json'
 old={t['id']:t for t in json.loads(previous.read_text())['tracks']} if previous.exists() else {}
 old.update({t['id']:t for t in new})
 tracks=[]
 for t in CFG['tracks']:
  result=old.get(t['id'])
  if result is None:raise RuntimeError(f'Missing mix for {t["id"]}; run without --prefix to mix all tracks')
  result['retired']=bool(t.get('retired'))
  tracks.append(result)
 (OUT/'播放清单.json').write_text(json.dumps(dict(version=CFG['version'],model=CFG['model'],voices=CFG['voices'],tracks=tracks),ensure_ascii=False,indent=2))
 with (OUT/'播放清单.csv').open('w',encoding='utf-8-sig',newline='') as f:
  w=csv.writer(f);w.writerow(['编号','段落','时长','阶段','播放触发','限制与演员动作','文件'])
  for t in tracks:w.writerow([t['id'],t['title'],fmt(t['duration']),t['stage'],t['trigger'],t['notes'],t['file']])
 print('All mixes ready; active total',fmt(sum(t['duration'] for t in tracks if not t.get('retired'))),flush=True)
