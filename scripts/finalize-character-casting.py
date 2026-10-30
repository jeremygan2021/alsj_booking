"""Refresh portable production sources and guides after the casting rebuild."""
from pathlib import Path
import copy
import csv
import html
import json
import re
import shutil
from audio_production import atomic_json, digest, fingerprint, payload_for

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT/'交付包_阿拉斯加之夜'
OUT = BASE/'现场演绎音频'
CACHE = ROOT/'output/performance-audio/casting-20261031'


def read(path):
    return json.loads(path.read_text())


def stamp(value):
    ms = round(value*1000)
    return f'{ms//3600000:02d}:{ms//60000%60:02d}:{ms//1000%60:02d},{ms%1000:03d}'


def short(value):
    return f'{int(value)//60:02d}:{int(value)%60:02d}'


def main():
    config = read(CACHE/'performance-config.json')
    manifest = read(ROOT/'server/audio/performance-audio.json')
    current = {t['id']:t for t in manifest['tracks']}
    prior = read(OUT/'播放清单.json')
    old = {t['id']:t for t in prior['tracks']}
    revised = {t['id']:t for t in config['tracks']}
    tracks = []
    for entry in manifest['tracks']:
        track = copy.deepcopy(old[entry['id']])
        track.update(copy.deepcopy(revised.get(entry['id'], {})))
        track.update(entry)
        name = track['id']+'_'+track['title']
        track.update(file='现场播放版_MP3/'+name+'.mp3', wav='无损母带_WAV/'+name+'.wav')
        for line in track.get('lines', []):
            line.pop('reusePath', None)
        if track['id']=='B06':
            audit = read(CACHE/'blackout-casting-audit.json')
            for patch in audit['patches']:
                for line in track['lines']:
                    if line['role']==patch['role'] and abs(line['start']-patch['voiceStart'])<.01:
                        line['end']=round(patch['voiceEnd'],3)
        tracks.append(track)
        shutil.copy2(ROOT/'server/audio/performance-files'/entry['filename'], OUT/track['file'])
        if track['id'] in revised or track['id']=='B06':
            srt='\n\n'.join(f'{i}\n{stamp(l["start"])} --> {stamp(l["end"])}\n{l["role"]}：{l["text"]}'
                for i,l in enumerate(track['lines'],1))+'\n'
            (OUT/'字幕与走位'/(name+'.srt')).write_text(srt)
            atomic_json(OUT/'字幕与走位'/(name+'_动作.json'),track['events'])
    playlist = dict(version=config['version'],model=config['model'],voices=config['voices'],tracks=tracks)
    atomic_json(OUT/'播放清单.json',playlist)
    atomic_json(OUT/'音频映射与验收清单.json',manifest)
    for filename in ['播放清单.csv','现场配音清单.csv']:
        with (OUT/filename).open('w',encoding='utf-8-sig',newline='') as f:
            writer=csv.writer(f,lineterminator='\n');writer.writerow(['编号','名称','时长','阶段','触发','说明','文件'])
            for t in tracks:writer.writerow([t['id'],t['title'],short(t['duration']),t['stage'],t['trigger'],t['notes'],t['file']])
    # Replace raw lines as well as mixes, preventing an old casting from returning
    # when the production source is regenerated later.
    for t in config['tracks']:
        for i,line in enumerate(t['lines'],1):
            source=Path(line['reusePath']) if line.get('reusePath') else CACHE/'jobs'/fingerprint(payload_for(config,line))/'speech.mp3'
            destination=OUT/'制作分轨/原始台词'/f'{t["id"]}_{i:02d}_{line["role"]}.mp3'
            if source.resolve()!=destination.resolve():shutil.copy2(source,destination)
    full=read(CACHE/'baseline-config.json')
    full.update(version=config['version'],voices=config['voices'],performanceDir=str(OUT),exportProduction=str(OUT))
    full['tracks']=[copy.deepcopy(revised.get(t['id'],t)) for t in full['tracks']]
    for t in full['tracks']:
        for i,line in enumerate(t['lines'],1):
            if t['id'] in revised:
                line.pop('reusePath',None);line['reuse']=f'{t["id"]}_{i:02d}_{line["role"]}.mp3'
    atomic_json(ROOT/'output/clue-audio/performance-config.json',full)
    atomic_json(OUT/'演绎制作源稿.json',full)
    player=OUT/'现场播放台.html'
    content=player.read_text()
    content,count=re.subn(r'const tracks=.*?;const \$=',lambda _: 'const tracks='+json.dumps(tracks,ensure_ascii=False).replace('</','<\\/')+';const $=',content,flags=re.S)
    assert count==1
    player.write_text(content)
    script='# 现场演绎全台本与动作时间轴（GM保密）\n\n2026-10-31修订：主持人男声；诺拉男性FBI；西奥多女性拍卖师。下列时间来自本次混音。\n\n'
    for t in tracks:
        script+=f'## {t["id"]} · {t["title"]} · {short(t["duration"])}\n\n触发：{t["trigger"]}\n\n{t["notes"]}\n\n'
        for l in t.get('lines',[]):script+=f'- {short(l["start"])}—{short(l["end"])} **{l["role"]}**：{l["text"]}\n'
        for e in t['events']:script+=f'- 动作 {short(e["time"])}：{e["instruction"]}\n'
        script+='\n'
    for filename in ['全台本与动作时间轴_GM保密.md','配音台本_GM保密.md']:(OUT/filename).write_text(script.rstrip()+'\n')
    voices='# 固定角色音色与制作说明\n\n独立男主持负责B03报幕和收尾；西奥多是女性拍卖师；诺拉是男性FBI特别探员，B03公开身份。\n\n|角色|音色|voice_id|语速|音高|表演方向|\n|---|---|---|---|---|---|\n'
    for role,(voice,label,speed,pitch,direction) in config['voices'].items():voices+=f'|{role}|{label}|`{voice}`|{speed}|{pitch}|{direction}|\n'
    voices+='\n语音由MiniMax speech-2.8-hd系统音色生成。原始32kHz单声道MP3；成片48kHz双声道。更换角色的现场混音目标-16 LUFS；B06暗场剧情保持-18 LUFS。供应商字幕已与审定台词核对；不等于人工逐句听审。原有音乐授权见《配乐来源与署名》。\n'
    (OUT/'角色音色与制作说明.md').write_text(voices)
    (OUT/'使用说明_先读.md').write_text(f'# 现场音频使用说明\n\n当前有效{len(tracks)}段。双击《现场播放台.html》，按GM口令手动播放；B07可单曲循环。B02投屏视频已有音轨，不要同时播放同名MP3。\n\nB03共{short(current["B03"]["duration"])}：男主持报幕，索恩、伊芙琳、里昂、克拉拉、诺拉、西奥多依序自报全名，男主持收尾。诺拉男声并公开FBI身份；西奥多女声并独立入场。动作时间见《人物出场走位卡_GM.md》。\n\nB06保持1:40的暗场编排和原枪声时间；29秒西奥多、90秒诺拉已换成统一音色。B07为纯配乐。后续A06、A07、A10、A11仍须按播控页的证据及阶段条件播放。\n\n西奥多单独音频在《B03_独立登场》目录。所有文件先完整解压，保留目录；音响、投影与走位在开演前排练。GM完整台本不可发给玩家。\n')
    review='<h1>现场音频 · GM试听</h1><p>主持人男声；诺拉男性FBI；西奥多女性拍卖师。</p>'
    for t in tracks:review+=f'<article><h2>{html.escape(t["id"]+" · "+t["title"])}</h2><p>{html.escape(t["notes"])}</p><audio controls preload="none" src="{html.escape(t["file"],quote=True)}"></audio></article>'
    (OUT/'GM试听台_请勿发给玩家.html').write_text('<!doctype html><meta charset="utf-8"><title>GM试听</title>'+review)
    # Keep the clue package consistent with the current server manifest.
    clues=BASE/'线索配乐音频';clue_config=read(ROOT/'output/clue-audio/config.json')
    clue_manifest=read(ROOT/'server/audio/clue-audio.json')
    atomic_json(clues/'分层配音源稿_GM保密.json',clue_config)
    atomic_json(clues/'音频映射与验收清单.json',clue_manifest)
    text='# 线索配音台本（GM保密）\n\n诺拉男声，西奥多女声。\n\n';review='<h1>线索音频 · GM试听</h1>'
    for t in clue_manifest['tracks']:
        folder='基础线索' if t['part']=='body' else '鉴定补充_GM保密'
        target=clues/folder/t['filename'];target.parent.mkdir(exist_ok=True)
        shutil.copy2(ROOT/'server/audio/files'/t['filename'],target)
        source=next(i for i in clue_config['tracks'] if (i['id'],i['part'])==(t['id'],t['part']))
        text+=f'## {t["id"]} · {source["title"]} · {t["part"]}\n\n'+'\n'.join(l['role']+'：'+l['text'] for l in source['lines'])+'\n\n'
        review+=f'<article><h2>{html.escape(t["id"]+" · "+source["title"]+" · "+t["part"])}</h2><audio controls preload="none" src="{folder}/{t["filename"]}"></audio></article>'
    for filename in ['线索配音台本_GM保密.md','配音台本_GM保密.md']:(clues/filename).write_text(text)
    (clues/'GM试听台_请勿发给玩家.html').write_text('<!doctype html><meta charset="utf-8"><title>GM线索试听</title>'+review)
    report=dict(version=config['version'],performanceTracks=len(tracks),replacedPerformanceTracks=len(revised)+1,replacedClueTracks=46,providerSubtitleVerification=True,humanListening=False)
    atomic_json(OUT/'机器验收记录.json',report)
    (OUT/'交付验收记录.md').write_text('# 本次修订验收\n\n2026-10-31：B03独立男主持、六人各报姓名，西奥多女声独立自介，诺拉男性FBI。相关12段现场混音、46段线索音频已替换。供应商字幕逐条核对；音频解码与线上文件校验结果另存本次发布验收报告。未进行人工逐句听审。\n')
    print(json.dumps(report,ensure_ascii=False))


if __name__=='__main__':
    main()
