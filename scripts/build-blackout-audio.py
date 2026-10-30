r"""Mix B06 fixed-voice drama and B07 pure looping background music for GM playback.

Download Controlled Chaos and Volatile Reaction from incompetech.com, then run:
  python3 scripts/build-blackout-audio.py --music /absolute/path/to/Controlled\ Chaos.mp3 --action-music /absolute/path/to/Volatile\ Reaction.mp3
No credentials or signed download URLs are retained. --prepare-only builds foley.
"""
from pathlib import Path
import argparse
import csv
import hashlib
import json
import re
import shutil
import subprocess
import numpy as np

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT / '交付包_阿拉斯加之夜/现场演绎音频'
CACHE = ROOT / 'output/performance-audio/blackout'
SR, SECONDS = 48000, 100
EVENTS = [
    dict(time=0, cue='blackout', instruction='现场摔杯声结束、主灯熄灭后立即手动启动本段；保持应急通道照明。音频不重复摔杯声。'),
    dict(time=7, cue='sound', instruction='第一声枪响与急促脚步：仅作宴会混乱的舞台音效，不作为死因或案发时间证据。'),
    dict(time=18.4, cue='sound', instruction='短促连续枪响与门响；演员原地做惊慌反应。'),
    dict(time=40, cue='sound', instruction='脚步与碰撞逐渐密集，危险感上升；不增加角色对白或身份信息。'),
    dict(time=70, cue='sound', instruction='混乱进入高潮，保持暗场；枪声不对应索恩受伤。'),
    dict(time=88, cue='sound', instruction='混乱退去，留下冰冷悬念；音控准备下一环节。'),
    dict(time=99, cue='sound', instruction='等待尾音结束；不自动连播，灯光及A05由GM另行给口令。'),
]


def decode(path, filters=None):
    cmd = ['ffmpeg', '-v', 'error', '-i', str(path)]
    if filters:
        cmd += ['-af', filters]
    return np.frombuffer(subprocess.check_output(cmd + [
        '-ar', str(SR), '-ac', '2', '-f', 'f32le', 'pipe:1'
    ]), dtype='<f4').reshape(-1, 2).copy()


def encode(audio, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        'ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR),
        '-ac', '2', '-i', 'pipe:0', '-c:a', 'pcm_s24le', str(path)
    ], input=audio.astype('<f4').tobytes(), check=True)


def foley():
    rng = np.random.default_rng(20261030)
    result = np.zeros((SECONDS * SR, 2), np.float32)

    def place(audio, when, level, pan=0):
        mono = audio.mean(axis=1) if audio.ndim == 2 else audio
        mono = mono / max(float(np.max(np.abs(mono))), .001)
        stereo = mono[:, None] * np.sqrt(np.array([1-pan, 1+pan])[None, :] / 2)
        start = int(when * SR)
        end = min(len(result), start + len(stereo))
        result[start:end] += stereo[:end-start] * level

    sfx = ROOT / 'output/performance-audio/sfx'
    steps = [decode(sfx / f'rpg-audio/footstep{i:02d}.ogg') for i in range(10)]
    for start, end, pan in [(2, 14, -.65), (9, 26, .7), (34, 58, -.5), (60, 84, .5)]:
        cursor = start
        while cursor < end:
            place(steps[int(rng.integers(10))], cursor, float(rng.uniform(.055, .14)), pan)
            cursor += float(rng.uniform(.22, .4))
    for when, name in [(11, 'doorClose_1.ogg'), (23, 'doorClose_3.ogg'), (55, 'metalPot2.ogg'), (78, 'doorClose_2.ogg')]:
        place(decode(sfx / 'rpg-audio' / name), when, .19, float(rng.uniform(-.7, .7)))
    woods = sorted((sfx / 'impact-sounds').glob('impactWood_medium_*.ogg'))
    for when in [3, 12.8, 20, 35, 42.8, 52, 65, 71, 79.3, 83]:
        place(decode(woods[int(rng.integers(len(woods)))]), when, .15, float(rng.uniform(-.8, .8)))
    result[-12*SR:] *= np.linspace(1, 0, 12*SR)[:, None]
    return result


def music_credit(title, isrc):
    return dict(title=title, artist='Kevin MacLeod',
                source=f'https://incompetech.com/music/royalty-free/index.html?isrc={isrc}',
                license='CC BY 4.0')


def install(music_path, action_path):
    from audio_production import fingerprint, payload_for
    import importlib.util
    spec = importlib.util.spec_from_file_location("verify_audio_transcripts", ROOT/"scripts/verify-audio-transcripts.py")
    verifier = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(verifier)
    normalized, subtitle_text = verifier.normalized, verifier.subtitle_text
    scene = json.loads((ROOT/'scripts/blackout-scene.json').read_text())
    manifest_path = ROOT/'server/audio/performance-audio.json'
    manifest = json.loads(manifest_path.read_text())
    voices = {v['role']: [v['voiceId'], v['label'], v['speed'], v['pitch'], v['direction']] for v in manifest['voices']}
    voices.update(scene.get('extraVoices', {}))
    config = dict(model=scene['model'], voices=voices)
    music = decode(music_path, 'loudnorm=I=-22:TP=-4:LRA=10')[30*SR:130*SR]
    action = decode(action_path, 'loudnorm=I=-23:TP=-4:LRA=10')[20*SR:120*SR]
    if len(music) != SECONDS*SR or len(action) != SECONDS*SR:
        raise ValueError('Source music is too short for selected passages.')
    gain = np.interp(np.arange(SECONDS*SR)/SR, [0, 15, 24, 80, 89, 100], [0, 0, 1, 1, 0, 0])
    score = music*(1-gain[:,None]) + action*gain[:,None]
    score[:int(.08*SR)] *= np.linspace(0, 1, int(.08*SR))[:,None]
    score[-12*SR:] *= np.linspace(1, 0, 12*SR)[:,None]
    speech = np.zeros_like(score)
    duck = np.ones(len(score), np.float32)
    audit = []
    lines = []
    for line in scene['lines']:
        sha = fingerprint(payload_for(config, line))
        job = CACHE/'tts/jobs'/sha
        actual = subtitle_text(json.loads((job/'response.titles').read_text()))
        if normalized(actual) != normalized(line['text']):
            raise ValueError(f"Provider subtitle differs: {line['role']}")
        # Dialogue lives inside the room, with softer diction and audible distance.
        pan=float(line.get('pan',0)); distant=line.get('distance')=='far'
        cutoff=2900 if distant else 4300
        voice=decode(job/'speech.mp3',f'highpass=f=170,lowpass=f={cutoff},loudnorm=I=-22:TP=-6:LRA=10')
        mono=voice.mean(axis=1)
        voice=mono[:,None]*np.sqrt(np.array([1-pan,1+pan])[None,:]/2)
        voice*=.52 if distant else .78
        dry=voice.copy()
        # Diffuse early reflections, rather than three obvious slapback echoes.
        for delay,level in [(.023,.16),(.037,.12),(.053,.10),(.071,.08),(.097,.06),(.131,.045),(.179,.032),(.233,.022)]:
            n=round(delay*SR)
            voice[n:]+=dry[:-n,::-1]*level*(1.3 if distant else 1)
        start = round(line['start']*SR)
        end = start+len(voice)
        if end > 99*SR:
            raise ValueError(f"Line extends into final tail: {line['role']}")
        speech[start:end] += voice
        lo, hi = max(0,start-int(.18*SR)), min(len(score),end+int(.5*SR))
        duck[lo:start] = np.minimum(duck[lo:start],np.linspace(1,.68,start-lo))
        duck[start:end] = np.minimum(duck[start:end],.68)
        duck[end:hi] = np.minimum(duck[end:hi],np.linspace(.68,1,hi-end))
        lines.append(dict(line,end=round(end/SR,3)))
        audit.append(dict(role=line['role'],voiceId=voices[line['role']][0],payloadHash=sha,subtitleMatch=True,duration=round(len(voice)/SR,3)))
    archive = OUT/'制作分轨/熄灯惊变'
    archive.mkdir(parents=True,exist_ok=True)
    encode(speech,archive/'B06_固定角色对白.wav')
    encode(score,archive/'B06_背景配乐.wav')
    # Downloaded crowd bed supplies natural overlapping reactions without extra dialogue.
    crowd_source=decode(CACHE/'crowd-491405.mp3','highpass=f=220,lowpass=f=2600,loudnorm=I=-29:TP=-8:LRA=10')
    cross=2*SR
    crowd=crowd_source.copy()
    while len(crowd)<len(score):
        blend=np.linspace(0,1,cross)[:,None]
        crowd=np.concatenate([crowd[:-cross],crowd[-cross:]*(1-blend)+crowd_source[:cross]*blend,crowd_source[cross:]])
    crowd=crowd[:len(score)]
    envelope=np.interp(np.arange(len(score))/SR,[0,5,7,8,20,35,46,49,60,70,75,82,89,94,100],[.08,.18,.25,.85,.8,.45,.35,.9,.55,.3,.8,.55,.2,.08,0])
    crowd*=envelope[:,None]
    effects=decode(CACHE/'B06_混乱音效分轨.wav')
    # Downloaded real indoor gunshot: native speed, full natural room tail, no added echo.
    source=decode(CACHE/'indoor-gunshot-chris81.mp3')[round(.12*SR):round(1.95*SR)]
    source/=max(float(np.max(np.abs(source))),.001)
    guns=np.zeros_like(score)
    gun_duck=np.ones(len(score),np.float32)
    speech_duck=np.ones(len(score),np.float32)
    shot_audit=[]
    for moment,pan,level in [(7,-.16,.85),(18.4,.12,.76),(18.78,.10,.84),(48,-.10,.72),(74.2,.14,.67)]:
        a=round(moment*SR);shot=source.mean(axis=1)[:,None]*np.sqrt(np.array([1-pan,1+pan])[None,:]/2)
        guns[a:a+len(shot)]+=shot*level
        lo=max(0,a-round(.06*SR));hi=min(len(score),a+round(1.15*SR))
        envelope=np.interp(np.arange(lo,hi)/SR,[lo/SR,moment,moment+.20,hi/SR],[1,.65,.65,1])
        gun_duck[lo:hi]=np.minimum(gun_duck[lo:hi],envelope)
        hi_voice=min(len(score),a+round(.16*SR))
        speech_duck[a:hi_voice]=np.minimum(speech_duck[a:hi_voice],.75)
    crowd[-12*SR:]*=np.linspace(1,0,12*SR)[:,None]
    backing=score*duck[:,None]*gun_duck[:,None]+speech*speech_duck[:,None]+(effects+crowd)*gun_duck[:,None]
    for moment in [7,18.4,18.78,48,74.2]:
        a=round(moment*SR);b=a+round(.08*SR)
        gun_rms=float(np.sqrt(np.mean(guns[a:b]**2)))
        bed_rms=float(np.sqrt(np.mean(backing[a:b]**2)))
        margin=20*np.log10(max(gun_rms,1e-9)/max(bed_rms,1e-9))
        if margin<2:raise ValueError(f'Gunshot masked at {moment}: {margin:.1f} dB')
        shot_audit.append(dict(time=moment,gunAboveBackingDb=round(margin,2)))
    (archive/'枪声可辨识核验.json').write_text(json.dumps(shot_audit,indent=2)+'\n')
    shutil.copy2(CACHE/'indoor-gunshot-chris81.mp3',archive/'gunshot indoors_chris81_CC0原始素材.mp3')
    (archive/'枪声来源.json').write_text(json.dumps(dict(author='chris_81',license='CC0',source='https://freesound.org/people/chris_81/sounds/388051/',download='https://cdn.freesound.org/previews/388/388051_82256-hq.mp3',excerpt=[.12,1.95],speed=1,note='使用第一声原速实录，保留室内自然尾响，不采用第二声50%慢放版本'),ensure_ascii=False,indent=2)+'\n')
    encode(guns,archive/'B06_实录枪声分轨.wav')
    shutil.copy2(CACHE/'crowd-491405.mp3',archive/'Crowd in panic_ienba_CC0.mp3')
    (archive/'人群来源.json').write_text(json.dumps(dict(author='ienba',license='CC0',source='https://freesound.org/people/ienba/sounds/491405/',note='下载的群众惊慌声作为环境层，交叉淡化及距离滤波，不添加新对白'),ensure_ascii=False,indent=2)+'\n')
    encode(crowd,archive/'B06_普通宾客人群底声.wav')
    drama=backing+guns
    # Pure background: one cue, no dialogue/foley, two-second wrap crossfade.
    cross=2*SR
    blend=np.linspace(0,1,cross)[:,None]
    background=np.concatenate([music[cross:-cross],music[-cross:]*(1-blend)+music[:cross]*blend])
    descriptions = [
        dict(id='B06',title='熄灯惊变·剧情版',duration=100,kind='drama',loop=False,
             speakers=list(dict.fromkeys(l['role'] for l in lines)),
             trigger='A04结束后、A05之前；现场摔杯→熄主灯→点击“从头播放”。',
             notes='1:40环境声主导版；新下载的室内枪声保留原速和自然尾响，仅15条零星短对白与惊叫。FBI仅三处短口令，人声带距离与遮挡，不逐句解释剧情。索恩此时已遇害，不新增其现场发言；枪声属于舞台氛围，不改变奖杯致伤设定。对白为舞台改编，不作为推理证据。',
             events=sorted(EVENTS+[dict(time=l['start'],cue='dialogue',role=l['role'],instruction=l['text']) for l in lines],key=lambda e:e['time']),
             music=music_credit('Controlled Chaos','USUAN1200059'),
             additionalMusic=[music_credit('Volatile Reaction','USUAN1400039')]),
        dict(id='B07',title='凶险暗流·纯BGM循环版',duration=len(background)/SR,kind='background',loop=True,
             speakers=[],trigger='宴会、暗场或调查阶段需要持续背景氛围时手动启动；默认单曲循环，可取消循环。',
             notes='只有背景音乐，无角色对白、枪声、尖叫、脚步或其他音效。循环边界已交叉淡化；播放剧情段落时自动暂停本段。',
             events=[],music=music_credit('Controlled Chaos','USUAN1200059')),
    ]
    for track,audio in zip(descriptions,[drama,background]):
        if track['id']=='B07':
            old=next(t for t in manifest['tracks'] if t['id']=='B07')
            track.update(old)
            previous=json.loads((OUT/'播放清单.json').read_text())
            offline=next(t for t in previous['tracks'] if t['id']=='B07')
            track.update(offlineFile=offline['file'],offlineWav=offline['wav'])
            continue
        name=track['id']+'_'+track['title']
        raw=CACHE/(track['id']+'-premaster.wav');encode(audio,raw)
        master=OUT/'无损母带_WAV'/(name+'.wav')
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(raw),'-af','loudnorm=I=-18:TP=-2:LRA=14','-ar',str(SR),'-c:a','pcm_s24le',str(master)],check=True)
        dest=OUT/'现场播放版_MP3'/(name+'.mp3')
        subprocess.run(['ffmpeg','-v','error','-y','-i',str(master),'-c:a','libmp3lame','-b:a','256k','-metadata','title='+track['title'],'-metadata','comment=Music: Kevin MacLeod (incompetech.com), CC BY 4.0. B06 voices: MiniMax speech-2.8-hd; SFX: Kenney CC0; indoor gunshot by chris_81 (Freesound 388051), CC0. B07: music only.',str(dest)],check=True)
        track.update(filename=track['id'].lower()+'.mp3',stage='案发氛围' if track['id']=='B06' else '循环背景',spoiler=False,evidence=None,sha256=hashlib.sha256(dest.read_bytes()).hexdigest())
        shutil.copy2(dest,ROOT/'server/audio/performance-files'/track['filename'])
        track['offlineFile']='现场播放版_MP3/'+dest.name
        track['offlineWav']='无损母带_WAV/'+master.name
    manifest['tracks']=[t for t in manifest['tracks'] if t['id'] not in ['B06','B07']]
    index=next(i for i,t in enumerate(manifest['tracks']) if t['id']=='A05')
    manifest['tracks'][index:index]=[{k:v for k,v in t.items() if not k.startswith('offline')} for t in descriptions]
    manifest['version']='2026-10-30-blackout-sparse-v4'
    manifest_path.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    offline_path=OUT/'播放清单.json';offline=json.loads(offline_path.read_text())
    offline['tracks']=[t for t in offline['tracks'] if t['id'] not in ['B06','B07']]
    index=next(i for i,t in enumerate(offline['tracks']) if t['id']=='A05')
    offline['tracks'][index:index]=[dict(t,file=t['offlineFile'],wav=t['offlineWav'],retired=False,lines=lines if t['id']=='B06' else [],musicSource=t['music']['title']) for t in descriptions]
    offline['version']=manifest['version'];offline_path.write_text(json.dumps(offline,ensure_ascii=False,indent=2)+'\n')
    with (OUT/'播放清单.csv').open('w',encoding='utf-8-sig',newline='') as f:
        writer=csv.writer(f,lineterminator='\n');writer.writerow(['编号','段落','时长','阶段','播放触发','限制与演员动作','文件'])
        for t in offline['tracks']:writer.writerow([t['id'],t['title'],f"{int(t['duration'])//60:02}:{int(t['duration'])%60:02}",t['stage'],t['trigger'],t['notes'],t['file']])
    player_path=OUT/'现场播放台.html';player=player_path.read_text()
    active=[t for t in offline['tracks'] if not t.get('retired')]
    player=re.sub(r'const tracks=.*?;const \$',lambda _:'const tracks='+json.dumps(active,ensure_ascii=False).replace('</','<\\/')+';const $',player,count=1,flags=re.S)
    player=player.replace('const stage={','const stage={B07:0,') if 'B07:0' not in player else player
    player=player.replace('audio.pause();current=t;','audio.pause();audio.loop=Boolean(t.loop);current=t;')
    player_path.write_text(player)
    def stamp(seconds):
        ms=round(seconds*1000)
        return f"{ms//3600000:02}:{ms//60000%60:02}:{ms//1000%60:02},{ms%1000:03}"
    subtitles='\n\n'.join(f"{i+1}\n{stamp(l['start'])} --> {stamp(l['end'])}\n{l['role']}：{l['text']}" for i,l in enumerate(lines))+'\n'
    (OUT/'字幕与走位/B06_熄灯惊变·剧情版.srt').write_text(subtitles)
    (archive/'对白与音色核验.json').write_text(json.dumps(dict(model=scene['model'],audit=audit,lines=lines),ensure_ascii=False,indent=2)+'\n')
    print('Installed B06 dialogue (100s) and B07 pure looping music (98s).')


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--music', type=Path)
    parser.add_argument('--action-music', type=Path)
    parser.add_argument('--prepare-only', action='store_true')
    args = parser.parse_args()
    if not args.prepare_only and (not args.music or not args.action_music):
        parser.error('--music and --action-music are required unless --prepare-only is set')
    CACHE.mkdir(parents=True, exist_ok=True)
    encode(foley(), CACHE / 'B06_混乱音效分轨.wav')
    print('Foley ready: 100 seconds. No live cup smash duplicated.')
    if not args.prepare_only:
        install(args.music.resolve(), args.action_music.resolve())
