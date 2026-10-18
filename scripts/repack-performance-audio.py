"""Package complete production files and a smaller GM playback kit."""
from pathlib import Path
import csv, hashlib, io, json, zipfile

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'交付包_阿拉斯加之夜'
OUT=BASE/'现场演绎音频'
guides=[BASE/'先看这里_剧情与人物关系.md']+sorted(p for p in (BASE/'导演速览').iterdir() if p.suffix in {'.md','.html'})
manifest=json.loads((OUT/'播放清单.json').read_text())
active=[t for t in manifest['tracks'] if not t.get('retired')]
files=sorted(p for p in OUT.rglob('*') if p.is_file() and p.name not in {'.DS_Store','SHA256SUMS.txt'})
checks=''.join(f'{hashlib.sha256(p.read_bytes()).hexdigest()}  {p.relative_to(OUT).as_posix()}\n' for p in files)
(OUT/'SHA256SUMS.txt').write_text(checks)

def add(z,p):
 arc=(Path('现场演绎音频')/p.relative_to(OUT)).as_posix()
 method=zipfile.ZIP_STORED if p.suffix.lower() in {'.mp3','.mp4','.png','.ogg','.wav','.zip'} else zipfile.ZIP_DEFLATED
 z.write(p,arc,compress_type=method)

complete=BASE/'现场演绎音频_完整制作交付包.zip'
with zipfile.ZipFile(complete,'w',allowZip64=True) as z:
 for p in files:add(z,p)
 add(z,OUT/'SHA256SUMS.txt')
 for p in guides:z.write(p,p.relative_to(BASE).as_posix(),compress_type=zipfile.ZIP_DEFLATED)
assert zipfile.ZipFile(complete).testzip() is None
print('complete',complete,complete.stat().st_size,flush=True)

docs=['使用说明_先读.md','人物出场走位卡_GM.md','交付验收记录.md','全台本与动作时间轴_GM保密.md','角色音色与制作说明.md','配乐来源与署名.md','现场播放台.html']
portable=[OUT/name for name in docs]
portable += sorted((OUT/'万圣节图文').rglob('*'))
portable += [OUT/t['file'] for t in active]
portable += [OUT/'字幕与走位'/f'{t["id"]}_{t["title"]}.srt' for t in active]
portable += sorted((OUT/'证据纯人声').glob('*.mp3'))
portable=[p for p in portable if p.is_file()]
portable_manifest={**manifest,'tracks':active}
buff=io.StringIO();writer=csv.writer(buff);writer.writerow(['编号','段落','时长','阶段','播放触发','限制与演员动作','文件'])
for t in active:writer.writerow([t['id'],t['title'],f'{int(t["duration"])//60:02d}:{int(t["duration"])%60:02d}',t['stage'],t['trigger'],t['notes'],t['file']])
portable_zip=BASE/'现场演绎音频_现场播放包.zip'
with zipfile.ZipFile(portable_zip,'w',allowZip64=True) as z:
 for p in portable:add(z,p)
 for p in guides:z.write(p,p.relative_to(BASE).as_posix(),compress_type=zipfile.ZIP_DEFLATED)
 z.writestr('现场演绎音频/播放清单.json',json.dumps(portable_manifest,ensure_ascii=False,indent=2),compress_type=zipfile.ZIP_DEFLATED)
 z.writestr('现场演绎音频/播放清单.csv','\ufeff'+buff.getvalue(),compress_type=zipfile.ZIP_DEFLATED)
assert zipfile.ZipFile(portable_zip).testzip() is None
print('portable',portable_zip,portable_zip.stat().st_size,flush=True)
