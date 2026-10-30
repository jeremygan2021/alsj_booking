"""Rebuild the six independent entrances and Nora's male performances, resumably."""
from pathlib import Path
import argparse
import concurrent.futures
import copy
import importlib.util
import json
import os
import shutil
import time
import subprocess
from audio_production import api, atomic_json, digest, download_task, fingerprint, payload_for, rendition_hash, synthesize

ROOT = Path(__file__).resolve().parents[1]
OUT = ROOT/'交付包_阿拉斯加之夜/现场演绎音频'
CACHE = ROOT/'output/performance-audio/casting-20261031'
VERSION = '2026-10-31-independent-entrances-male-nora-female-theodore'
NORA_VOICE = ['Chinese (Mandarin)_Male_Announcer', '播报男声', .99, 0,
              '36岁男性FBI特别探员，冷静、清楚、果断；全剧统一男声。']
HOST_VOICE = ['Chinese (Mandarin)_Radio_Host', '电台男主播', .98, 0,
              '独立男性主持人，只报幕及收尾，不代替六位角色自我介绍。']
THEODORE_VOICE = ['Chinese (Mandarin)_Mature_Woman', '成熟女拍卖师', 1.0, 0,
                  '39岁女性拍卖师，优雅、干练、善于控场；全剧统一女声。']
NAMES = {'索恩':'阿德里安·索恩', '伊芙琳':'伊芙琳·维尔', '里昂':'里昂·默瑟',
         '克拉拉':'克拉拉·沃克', '诺拉':'诺拉·里德', '西奥多':'西奥多·布莱克'}


def load_module(filename, name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def entrance_lines():
    def line(role, text, entrance=False):
        result = dict(role=role, text=text, emotion='calm', gap=1.2)
        if entrance:
            result['cue'] = 'entrance'
        return result
    return [
        line('主持人', '各位晚上好，欢迎来到阿拉斯加之夜。接下来，请六位人物依次介绍自己。'),
        line('索恩', '我是阿德里安·索恩，艾迪艾斯的创始人，也是这座庄园的主人。欢迎各位来到这里。今晚，请先尽情享受宴会。', True),
        line('伊芙琳', '我是伊芙琳·维尔，伊寇的首席人格架构师。索恩负责提出问题，我负责让机器给出回答。希望今晚，你们也会提出好问题。', True),
        line('里昂', '我是里昂·默瑟，艾迪艾斯的财务总监。索恩先生擅长创造未来，而我负责让未来能够付得起账单。很高兴认识各位。', True),
        line('克拉拉', '我是克拉拉·沃克，一名策展人。墙上的照片，是我和瑟琳娜一起挑选的。若你对画里的人感兴趣，晚些时候来找我。', True),
        line('诺拉', '我是诺拉·里德，FBI，联邦调查局特别探员。今晚由我关注现场安全与秩序。请佩戴好身份卡，遇到异常，及时告诉我。', True),
        line('西奥多', '我是西奥多·布莱克，庄园的私人拍卖师。今晚的拍品由我介绍。无论是旧物还是秘密，真正的价值，往往藏在故事里。', True),
        line('主持人', '六位已经到齐。现在，请自由交谈。一个名字，也许就是今晚第一条有用的线索。'),
    ]


def prepare():
    CACHE.mkdir(parents=True, exist_ok=True)
    baseline = CACHE/'baseline-config.json'
    if not baseline.exists():
        shutil.copy2(ROOT/'output/clue-audio/performance-config.json', baseline)
        shutil.copy2(ROOT/'server/audio/performance-audio.json', CACHE/'baseline-manifest.json')
    old = json.loads(baseline.read_text())
    config = copy.deepcopy(old)
    config['exportProduction'] = str(OUT)
    config['performanceDir'] = str(OUT)
    config['version'] = VERSION
    config['voices']['诺拉'] = NORA_VOICE
    config['voices']['主持人'] = HOST_VOICE
    config['voices']['西奥多'] = THEODORE_VOICE
    known = {}
    for track in old['tracks']:
        for index, line in enumerate(track['lines'], 1):
            path = OUT/'制作分轨/原始台词'/f'{track["id"]}_{index:02d}_{line["role"]}.mp3'
            cached = ROOT/'output/clue-audio/jobs'/fingerprint(payload_for(old, line))/'speech.mp3'
            if line.get('reuse') and path.exists():
                known[fingerprint(payload_for(old, line))] = str(path)
            elif cached.exists():
                known[fingerprint(payload_for(old, line))] = str(cached)
            elif path.exists():
                known[fingerprint(payload_for(old, line))] = str(path)
    selected = []
    prior_manifest={t['id']:t for t in json.loads((CACHE/'baseline-manifest.json').read_text())['tracks']}
    prior_offline={t['id']:t for t in json.loads((OUT/'播放清单.json').read_text())['tracks']}
    for track in config['tracks']:
        if track['id'] == 'B03':
            track.update(lines=entrance_lines(), intro=3, outro=3,
                trigger='B02结束后，约19:06；男主持报幕，六位真人NPC依序独立入场。',
                notes='独立男主持报幕和收尾。六人各自报全名；西奥多有独立自介，不承担本段报幕。诺拉为男性FBI特别探员，登场即公开身份。演员随各自声音走位。')
        changed = track['id'] == 'B03'
        for line in track['lines']:
            before = line['text']
            line['text'] = line['text'].replace('先去查她，别来查我的后台', '先去查他，别来查我的后台')
            if line['role'] in ('诺拉','西奥多') or line['text'] != before:
                changed = True
            line.pop('reuse', None)
            line.pop('start', None)
            line.pop('end', None)
            reuse = known.get(fingerprint(payload_for(config, line)))
            if reuse:
                line['reusePath'] = reuse
        if track['id'] == 'A05':
            track['notes'] = track['notes'].replace('发现尸体与身份揭露', '发现尸体与保护现场；FBI身份已在B03公开')
        if changed:
            track['mixVersion']=3
            track['bitrate']='256k'
            if not prior_manifest[track['id']].get('renditionHash'):
                track['legacyMix']=True
                prior=prior_offline.get(track['id'],{})
                track['musicOffset']=prior.get('musicOffset',0)
                if track['id']!='B03':
                    track.setdefault('intro',3)
                    track.setdefault('outro',4)
            track['legacyCompatible'] = False
            track['sourceText'] = '\n'.join(l['role']+'：'+l['text'] for l in track['lines'])
            track['sourceHash'] = digest(track['sourceText'])
            track['renditionHash'] = rendition_hash(config, track)
            selected.append(track)
    config['tracks'] = selected
    # B06 has a separate fixed-timeline mixing pipeline; retain its exact timings.
    scene = json.loads((ROOT/'scripts/blackout-scene.json').read_text())
    config['blackoutLines'] = [l for l in scene['lines'] if l['role'] in ('诺拉','西奥多')]
    atomic_json(CACHE/'performance-config.json', config)
    plan = {'tracks':[t['id'] for t in selected], 'newLines':sum(not l.get('reusePath') for t in selected for l in t['lines'])+len(config['blackoutLines']),
            'characters':sum(len(l['text']) for t in selected for l in t['lines'] if not l.get('reusePath'))+sum(len(l['text']) for l in config['blackoutLines'])}
    print(json.dumps(plan, ensure_ascii=False), flush=True)
    return config


def generate(config):
    # Read credentials without exporting them into arguments, logs or delivery files.
    env = {}
    for text in (ROOT/'.env').read_text().splitlines():
        if '=' in text and not text.startswith('#'):
            key, value = text.split('=', 1)
            env[key] = value.strip().strip('\"').strip("'")
    key = os.environ.get('MINIMAX_API_KEY') or env['MINIMAX_API_KEY']
    work = [l for t in config['tracks'] for l in t['lines'] if not l.get('reusePath')] + config.get('blackoutLines', [])
    unique = {fingerprint(payload_for(config, l)):l for l in work}
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        for path in pool.map(lambda l:synthesize(config, l, CACHE, key, poll_seconds=4, poll_limit=900), unique.values()):
            print('READY', path.parent.name[:12], flush=True)


def render(config):
    build = load_module('build-clue-audio.py', 'casting_build')
    verifier = load_module('verify-audio-transcripts.py', 'casting_verify')
    manifest_path = ROOT/'server/audio/performance-audio.json'
    manifest = json.loads(manifest_path.read_text())
    audit = []
    for track in config['tracks']:
        paths = []
        for line in track['lines']:
            if line.get('reusePath'):
                path = Path(line['reusePath'])
            else:
                job = CACHE/'jobs'/fingerprint(payload_for(config, line))
                actual = verifier.subtitle_text(json.loads((job/'response.titles').read_text()))
                if verifier.normalized(actual) != verifier.normalized(line['text']):
                    raise ValueError('Subtitle mismatch: '+line['role'])
                path = job/'speech.mp3'
                audit.append(dict(role=line['role'],text=line['text'],subtitleMatch=True,payloadHash=job.name))
            paths.append(path)
        original = ROOT/'server/audio/performance-files'/f'{track["id"].lower()}.mp3'
        backup = CACHE/'originals'/original.name
        backup.parent.mkdir(exist_ok=True)
        if not backup.exists():
            shutil.copy2(original, backup)
        for folder,suffix in [('无损母带_WAV','.wav'),('制作分轨/人声','_人声.mp3'),('制作分轨/配乐音效','_配乐音效.mp3')]:
            prior=OUT/folder/(track['id']+'_'+track['title']+suffix)
            archived=CACHE/'originals/production'/folder/prior.name
            if prior.exists() and not archived.exists():
                archived.parent.mkdir(parents=True,exist_ok=True)
                shutil.copy2(prior,archived)
        entry = build.mix(ROOT, config, track, paths)
        prior = next(t for t in manifest['tracks'] if t['id']==entry['id'])
        for event in entry['events']:
            if event['cue'] != 'entrance':
                instruction = next((e['instruction'] for e in prior.get('events',[]) if e['cue']==event['cue']), None)
                if instruction:
                    event['instruction'] = instruction
        manifest['tracks'] = [entry if t['id']==entry['id'] else t for t in manifest['tracks']]
        shutil.copy2(original, OUT/'现场播放版_MP3'/f'{track["id"]}_{track["title"]}.mp3')
        if track['id'] == 'B03':
            separate = OUT/'B03_独立登场'
            separate.mkdir(exist_ok=True)
            for index, (line, path) in enumerate(zip(track['lines'], paths)):
                name = NAMES.get(line['role'], '男主持_'+('开场' if index==0 else '收尾'))
                shutil.copy2(path, separate/f'{index:02d}_{name}.mp3')
                if line['role'] == '西奥多':
                    build.save_audio(build.decode(path), separate/'西奥多·布莱克_独立登场.mp3')
            shutil.copy2(original, separate/'B03_六位人物登场_完整混音.mp3')
    manifest['version'] = VERSION
    voices = {v['role']:v for v in manifest['voices']}
    for role, values in [('诺拉', NORA_VOICE), ('主持人', HOST_VOICE), ('西奥多', THEODORE_VOICE)]:
        voice, label, speed, pitch, direction = values
        voices[role] = dict(role=role,voiceId=voice,label=label,speed=speed,pitch=pitch,direction=direction)
    manifest['voices'] = list(voices.values())
    atomic_json(manifest_path, manifest)
    atomic_json(CACHE/'performance-config.json', config)
    atomic_json(CACHE/'transcript-audit.json', dict(jobs=audit,matched=len(audit),limitation='供应商字幕与台词核对，非人工逐句听审'))
    atomic_json(OUT/'音频映射与验收清单.json', manifest)
    print('Rendered', len(config['tracks']), 'tracks; preserved all other catalog entries.', flush=True)


def prepare_clues():
    old = json.loads((ROOT/'output/clue-audio/config.json').read_text())
    atomic_json(CACHE/'baseline-clue-config.json', old)
    config = copy.deepcopy(old)
    config['kind'] = 'clues'
    config['performanceDir'] = str(OUT)
    config['voices']['诺拉'] = NORA_VOICE
    config['voices']['西奥多'] = THEODORE_VOICE
    config['version'] = VERSION
    config['tracks'] = [t for t in config['tracks'] if any(l['role'] in ('诺拉','西奥多') for l in t['lines'])]
    prepare = load_module('prepare-clue-audio.py', 'casting_prepare_clues')
    canonical = prepare.canonical_sources()
    sources = {item['id']: item for item in canonical['clues'] + canonical['nodes']}
    for track in config['tracks']:
        item = sources[track['id']]
        text = item[track['part']]
        if track['sourceHash'] != digest(text):
            role = '诺拉' if track['part']=='detail' or track['id'].startswith('AR-') else track['lines'][0]['role']
            track.update(title=item['title'], sourceText=text, sourceHash=digest(text),
                lines=[dict(role=role, text=prepare.spoken(item['title'])+'。'+
                    ('鉴定补充说明。' if track['part']=='detail' else '')+prepare.spoken(text), emotion='calm')])
        track['legacyCompatible'] = False
        track['renditionHash'] = rendition_hash(config, track)
        for line in track['lines']:
            line.pop('reuse', None)
    atomic_json(CACHE/'clue-config.json', config)
    print('Current Nora and Theodore clue recordings:', len(config['tracks']), 'tracks;', sum(len(l['text']) for t in config['tracks'] for l in t['lines']), 'characters')


def render_clues(config):
    build = load_module('build-clue-audio.py', 'casting_clue_build')
    verifier = load_module('verify-audio-transcripts.py', 'casting_clue_verify')
    manifest_path = ROOT/'server/audio/clue-audio.json'
    manifest = json.loads(manifest_path.read_text())
    original_config_path = ROOT/'output/clue-audio/config.json'
    original_config = json.loads(original_config_path.read_text())
    audited = []
    for track in config['tracks']:
        paths = []
        for line in track['lines']:
            job = CACHE/'jobs'/fingerprint(payload_for(config, line))
            actual = verifier.subtitle_text(json.loads((job/'response.titles').read_text()))
            if verifier.normalized(actual) != verifier.normalized(line['text']):
                raise ValueError('Clue subtitle mismatch: '+track['id'])
            paths.append(job/'speech.mp3')
        entry = build.mix(ROOT, config, track, paths)
        key = track['id'], track.get('part')
        manifest['tracks'] = [entry if (t['id'], t.get('part'))==key else t for t in manifest['tracks']]
        original_config['tracks'] = [track if (t['id'], t.get('part'))==key else t for t in original_config['tracks']]
        audited.append(dict(id=track['id'],part=track.get('part'),subtitleMatch=True,sha256=entry['sha256']))
        atomic_json(manifest_path, manifest)
    manifest['version'] = original_config['version'] = VERSION
    original_config['voices']['诺拉'] = NORA_VOICE
    original_config['voices']['西奥多'] = THEODORE_VOICE
    atomic_json(manifest_path, manifest)
    atomic_json(original_config_path, original_config)
    atomic_json(CACHE/'clue-transcript-audit.json', audited)
    print('All selected clue performances match current text and character casting.')


def collect():
    """Query already submitted tasks only; never create replacement paid jobs."""
    env = dict(line.split('=', 1) for line in (ROOT/'.env').read_text().splitlines()
               if '=' in line and not line.startswith('#'))
    key = env['MINIMAX_API_KEY'].strip().strip('\"').strip("'")
    expected = set()
    for name in ['performance-config.json','clue-config.json']:
        current = json.loads((CACHE/name).read_text())
        for line in [l for t in current['tracks'] for l in t['lines'] if not l.get('reusePath')] + current.get('blackoutLines', []):
            expected.add(fingerprint(payload_for(current, line)))
    while True:
        complete = 0
        paths = [CACHE/'jobs'/sha/'state.json' for sha in sorted(expected)]
        failures = []
        for path in paths:
            state = json.loads(path.read_text())
            if state.get('downloaded'):
                complete += 1
                continue
            result = api('/v1/query/t2a_async_query_v2?task_id='+state['task_id'], key)
            state.update(status=str(result.get('status', '')).lower(), checkedAt=int(time.time()))
            if result.get('file_id'):
                state['file_id'] = str(result['file_id'])
            if state['status'] == 'success':
                destination = path.parent/'speech.mp3'
                download_task(result, key, destination, path.parent)
                state.update(downloaded=True, audioHash=digest(destination.read_bytes()))
                complete += 1
                print('DOWNLOADED', path.parent.name[:12], flush=True)
            elif state['status'] in ('failed','expired'):
                failures.append(state['task_id'])
            atomic_json(path, state)
            time.sleep(.15)
        print(json.dumps(dict(completed=complete,total=len(paths),failed=failures)), flush=True)
        if complete == len(paths):
            return
        if failures:
            raise RuntimeError('Existing provider tasks failed; retain IDs for reconciliation')
        time.sleep(45)


def render_blackout(config):
    """Replace two isolated character cues; preserve the other thirteen cues."""
    import numpy as np
    build = load_module('build-clue-audio.py', 'casting_blackout_audio')
    blackout = load_module('build-blackout-audio.py', 'casting_blackout_wav')
    verifier = load_module('verify-audio-transcripts.py', 'casting_blackout_verify')
    original = ROOT/'server/audio/performance-files/b06.mp3'
    backup = CACHE/'originals/b06.mp3'
    backup.parent.mkdir(exist_ok=True)
    if not backup.exists():
        shutil.copy2(original, backup)
    sr = build.SR
    audio = build.decode(backup)
    song = build.decode(CACHE/'Controlled Chaos.mp3', 'loudnorm=I=-22:TP=-4:LRA=10')
    score = song[30*sr:30*sr+len(audio)].copy()
    action = build.decode(CACHE/'Volatile Reaction.mp3', 'loudnorm=I=-23:TP=-4:LRA=10')[20*sr:20*sr+len(audio)]
    clock = np.arange(len(score))/sr
    blend = np.interp(clock,[0,15,24,80,89,100],[0,0,1,1,0,0])[:,None]
    score = score*(1-blend)+action*blend
    score *= np.clip((100-clock)/12, 0, 1)[:,None]
    audits=[]
    for line in config['blackoutLines']:
        job = CACHE/'jobs'/fingerprint(payload_for(config, line))
        actual = verifier.subtitle_text(json.loads((job/'response.titles').read_text()))
        if verifier.normalized(actual) != verifier.normalized(line['text']):
            raise ValueError('B06 subtitle mismatch: '+line['role'])
        moment = line['start']
        a, b = round((moment-1)*sr), round((moment-.3)*sr)
        x, y = score[a:b].reshape(-1), audio[a:b].reshape(-1)
        correlation = float(np.corrcoef(x, y)[0,1])
        if correlation < .75:
            raise ValueError(f'B06 source score mismatch at {moment}: {correlation:.3f}')
        gain = float(np.dot(x, y)/np.dot(x, x))
        lo, hi = round((moment-.2)*sr), round((moment+3.8)*sr)
        replacement = score[lo:hi]*gain
        voice = build.decode(job/'speech.mp3','highpass=f=100,lowpass=f=6500').mean(axis=1)
        if len(voice)/sr > 3.5:
            raise ValueError('New cue exceeds its isolated dialogue window')
        frame = round(.02*sr)
        blocks = np.pad(voice,(0,(-len(voice))%frame)).reshape(-1,frame)
        energy = np.sqrt(np.mean(blocks*blocks,axis=1))
        active = np.repeat(energy>max(float(energy.max())*.15,1e-5),frame)[:len(voice)]
        rms = float(np.sqrt(np.mean(voice[active]**2)))
        voice *= min(.16/rms,.70/max(float(np.max(np.abs(voice))),1e-6))
        pan=line.get('pan',0)
        voice=voice[:,None]*np.sqrt(np.array([1-pan,1+pan])[None,:]/2)*1.10*gain
        dry=voice.copy()
        for delay,level in [(.023,.16),(.037,.12),(.053,.10),(.071,.08),(.097,.06),(.131,.045),(.179,.032),(.233,.022)]:
            n=round(delay*sr);voice[n:]+=dry[:-n,::-1]*level*1.3
        start=round(moment*sr)-lo
        replacement[start:start+len(voice)]+=voice
        fade=round(.15*sr);ramp=np.linspace(0,1,fade)[:,None]
        replacement[:fade]=audio[lo:lo+fade]*(1-ramp)+replacement[:fade]*ramp
        replacement[-fade:]=replacement[-fade:]*(1-ramp)+audio[hi-fade:hi]*ramp
        audio[lo:hi]=replacement
        audits.append(dict(role=line['role'],patchSeconds=[moment-.2,moment+3.8],voiceStart=moment,
                           voiceEnd=moment+len(voice)/sr,sourceScoreCorrelation=correlation,masterGain=gain,subtitleMatch=True))
    premaster = CACHE/'B06_male_nora_premaster.wav'
    blackout.encode(audio, premaster)
    output = CACHE/'B06_诺拉男声_西奥多女声修订.mp3'
    subprocess.run(['python3','/home/ai/.codex/skills/ffmpeg-skill/scripts/loudness.py',str(premaster),
                    '-o',str(output),'-I','-18','--tp','-2','--lra','14','--json-brief','--overwrite'],check=True)
    master=OUT/'无损母带_WAV/B06_熄灯惊变·剧情版.wav'
    subprocess.run(['python3','/home/ai/.codex/skills/ffmpeg-skill/scripts/loudness.py',str(premaster),
                    '-o',str(master),'-I','-18','--tp','-2','--lra','14','--json-brief','--overwrite'],check=True)
    shutil.copy2(output, original)
    manifest_path = ROOT/'server/audio/performance-audio.json'
    manifest = json.loads(manifest_path.read_text())
    track = next(t for t in manifest['tracks'] if t['id']=='B06')
    track['sha256'] = digest(original.read_bytes())
    track['notes'] += ' 诺拉统一男性FBI音色，西奥多统一女性拍卖师音色；29秒和90秒处短句已重制，其他十三条台词及枪声时间保持原编排。'
    track['castingRevision'] = VERSION
    track['noraVoiceId'] = NORA_VOICE[0]
    track['theodoreVoiceId'] = THEODORE_VOICE[0]
    manifest['version'] = VERSION
    atomic_json(manifest_path, manifest)
    shutil.copy2(output, OUT/'现场播放版_MP3'/f'B06_{track["title"]}.mp3')
    atomic_json(CACHE/'blackout-casting-audit.json',dict(patches=audits,otherDialogueCuesPreserved=13,sha256=track['sha256']))


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare','generate','render','prepare-clues','generate-clues','render-clues','collect','render-blackout'])
    args = parser.parse_args()
    if args.action == 'collect':
        collect()
    elif args.action == 'prepare-clues':
        prepare_clues()
    elif args.action == 'prepare':
        prepare()
    else:
        config = json.loads((CACHE/('clue-config.json' if args.action.endswith('-clues') else 'performance-config.json')).read_text())
        (generate if args.action.startswith('generate') else render_clues if args.action=='render-clues' else render_blackout if args.action=='render-blackout' else render)(config)
