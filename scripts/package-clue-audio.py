"""Verify current player/script hashes and media, then package GM-only audio handoffs."""
from pathlib import Path
import argparse
import csv
import html
import importlib.util
import json
import os
import shutil
import subprocess
import zipfile
from audio_production import atomic_json, digest, fingerprint, payload_for, read_json, rendition_hash

ROOT = Path(__file__).resolve().parents[1]
BASE = ROOT/'交付包_阿拉斯加之夜'
CACHE = ROOT/'output/clue-audio'


def load_module(filename, name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    result = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(result)
    return result


prepare = load_module('prepare-clue-audio.py', 'prepare_clue_audio')


def verify(kind, decode=True):
    config = read_json(CACHE/('config.json' if kind=='clues' else 'performance-config.json'))
    manifest = read_json(ROOT/'server/audio'/('clue-audio.json' if kind=='clues' else 'performance-audio.json'))
    expected = {(t['id'], t.get('part')):t for t in config['tracks']}
    actual = {(t['id'], t.get('part')):t for t in manifest['tracks']}
    if set(actual) != set(expected):
        raise RuntimeError(kind + ' manifest IDs do not match prepared scripts')
    if kind == 'clues':
        sources = prepare.canonical_sources()
        canonical = {(n['id'], part):n[part] for n in sources['clues']+sources['nodes']
                     for part in ('body', 'detail') if part in n}
    else:
        canonical = {key:'\n'.join(line['role']+'：'+line['text'] for line in track['lines'])
                     for key, track in expected.items()}
    checked = []
    for key, source in expected.items():
        track = actual[key]
        prepare.validate_track(source, config)
        if source['sourceText'] != canonical[key] or source['sourceHash'] != digest(canonical[key]):
            raise RuntimeError('Prepared script is stale: ' + str(key))
        if track.get('sourceHash') != source['sourceHash']:
            # Unchanged legacy performance files predate sourceHash; compare reviewed source instead.
            if not (kind=='performance' and source.get('legacyCompatible') and not track.get('sourceHash')):
                raise RuntimeError('Manifest sourceHash is stale: ' + str(key))
        if source['renditionHash'] != rendition_hash(config, source):
            raise RuntimeError('Voice/script/parameter fingerprint changed: '+str(key))
        if track.get('renditionHash') != source['renditionHash']:
            if not (source.get('legacyCompatible') and track.get('renditionHash') is None):
                raise RuntimeError('Finished rendition fingerprint differs: '+str(key))
        folder = 'files' if kind=='clues' else 'performance-files'
        path = ROOT/'server/audio'/folder/track['filename']
        if not path.is_file() or digest(path.read_bytes()) != track['sha256']:
            raise RuntimeError('Media hash mismatch or missing: ' + str(key))
        if decode:
            subprocess.run(['ffmpeg', '-v', 'error', '-i', str(path), '-f', 'null', '-'], check=True,
                           stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
        checked.append(dict(id=source['id'], part=source.get('part'), sourceHash=source['sourceHash'],
                            renditionHash=source['renditionHash'], sha256=track['sha256'],
                            decoded=decode, reusedLegacy=bool(source.get('legacyCompatible'))))
    return config, manifest, checked


def fmt(seconds):
    return f'{int(seconds)//60:02d}:{int(seconds)%60:02d}'


def package(kind, config, manifest, checked):
    output = BASE/('线索配乐音频' if kind=='clues' else '现场演绎音频')
    output.mkdir(parents=True, exist_ok=True)
    lookup = {(t['id'], t.get('part')):t for t in config['tracks']}
    script = '# '+('线索分层配音台本' if kind=='clues' else '现场演绎配音台本')+'（GM保密）\n\n'
    script += '只有lines中的台词进入语音。trigger、notes、舞台动作、供认条件与鉴定开放规则均不朗读。语音为AI剧情演绎，以已核实的文字证据为准。\n\n'
    rows, cards = [], []
    for track in manifest['tracks']:
        source = lookup[track['id'], track.get('part')]
        if kind == 'clues':
            folder = '基础线索' if track['part']=='body' else '鉴定补充_GM保密'
            label = '基础' if track['part']=='body' else '鉴定补充'
            media = ROOT/'server/audio/files'/track['filename']
        else:
            folder, label = '现场播放版_MP3', source['stage']
            media = ROOT/'server/audio/performance-files'/track['filename']
        (output/folder).mkdir(exist_ok=True)
        shutil.copy2(media, output/folder/track['filename'])
        relative = folder+'/'+track['filename']
        rows.append([track['id'], source['title'], label, fmt(track['duration']), '、'.join(track['speakers']), track['music']['title'], relative])
        script += f'## {track["id"]} {source["title"]} · {label} · {fmt(track["duration"])}\n\n'
        if kind=='clues':
            script += '对应正文：'+source['sourceText']+'\n\n'
        else:
            script += '**仅供GM读，不进入配音：**\n\n'+source.get('trigger','')+'\n\n'+source.get('notes','')+'\n\n'
        for line in source['lines']:
            script += '- '+line['role']+'：'+line['text']+'\n'
        script += '\n'
        cards.append('<article><small>'+html.escape(track['id']+' · '+label+' · '+fmt(track['duration']))+'</small><h2>'+html.escape(source['title'])+'</h2><audio controls preload="none" src="'+html.escape(relative, quote=True)+'"></audio></article>')
    (output/'配音台本_GM保密.md').write_text(script, encoding='utf-8')
    if kind=='clues':
        (output/'线索配音台本_GM保密.md').write_text(script, encoding='utf-8')
    with (output/'线索配音清单.csv' if kind=='clues' else output/'现场配音清单.csv').open('w', encoding='utf-8-sig', newline='') as file:
        writer = csv.writer(file)
        writer.writerow(['编号', '名称', '层级/阶段', '时长', '角色', '配乐', '相对路径'])
        writer.writerows(rows)
    atomic_json(output/'音频映射与验收清单.json', manifest)
    atomic_json(output/('分层配音源稿_GM保密.json' if kind=='clues' else '演绎制作源稿.json'), config)
    atomic_json(output/'机器验收记录.json', dict(version=config['version'], tracks=checked,
                scope='当前正文SHA256、台词/音色/参数指纹、完整MP3哈希与解码；未声称人工逐句听审'))
    (output/'使用说明_先读.md').write_text('''# 音频使用说明（GM保密）

本包含当前版本音频、配音台本、映射及机器验收记录。使用MiniMax speech-2.8-hd和原固定角色音色；仅正文或舞台台词有变化的内容重新制作，其他成片或原始台词复用。原编号与二维码不变。

网页线索录音遵循当前幕次、已取得证据与鉴定权限。body只读基础正文；detail只读该条鉴定正文。系统每次核对sourceHash，正文变化会停用旧音频。无法播放时仍可阅读文字。请勿把完整包、试听页、GM台本或鉴定补充目录作为玩家公共静态资源。

现场演绎由GM按trigger手动播放。notes、供认条件、演员动作不属于对白。新版B01、A05、A07、A10、A12替换对应旧录音；A07仅供已取得全部相关证据后的复核。A10只在真相宣布后播放。动作按新版events时间，不沿用旧版时间轴；新版重制段使用现有配乐重新混音。

90天为故事中的公司内部应急规则；当晚暂停方案不等于删除。投票仅提交审查建议，不能绕过冻结程序。裁切的私人材料属于待核验指控，应允许玩家免费核对完整原件。

人声为虚构角色AI演绎，48kHz双声道128kbps MP3。机器验收覆盖正文、台词/音色参数指纹、文件哈希与完整解码；活动前仍需人工完整试听及场地调音。

Music by Kevin MacLeod (incompetech.com), CC BY 4.0: https://creativecommons.org/licenses/by/4.0/ . 已截取、循环、淡入淡出、调节音量并与对白混音。来源逐条列在映射清单，公开播放与二次分发须保留署名及授权链接。未在网页、源码或交付包保存MiniMax密钥。
''', encoding='utf-8')
    page = '<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>GM音频试听</title><style>body{max-width:1000px;margin:24px auto;padding:16px;background:#101c23;color:#eee;font:16px/1.6 system-ui}article{padding:16px;border:1px solid #40525c;margin:12px 0}audio{width:100%}h2{font-size:18px}</style><h1>GM音频试听</h1><p>含鉴定与终局剧透，请勿分发给玩家。全部台词为AI演绎。</p>'+''.join(cards)+'</html>'
    (output/'GM试听台_请勿发给玩家.html').write_text(page, encoding='utf-8')
    hashes = []
    for file in sorted(output.rglob('*')):
        if file.is_file() and file.name != 'SHA256SUMS.txt':
            hashes.append(digest(file.read_bytes())+'  '+str(file.relative_to(output)))
    (output/'SHA256SUMS.txt').write_text('\n'.join(hashes)+'\n', encoding='utf-8')
    archive = BASE/(output.name+'_完整交付包_20261018.zip')
    temporary = archive.with_suffix('.zip.tmp')
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED) as zipfile_out:
        for file in sorted(output.rglob('*')):
            if file.is_file():
                zipfile_out.write(file, output.name+'/'+str(file.relative_to(output)))
    os.replace(temporary, archive)
    print(str(archive), len(checked), 'verified tracks')


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--kind', choices=['clues', 'performance', 'all'], default='clues')
    parser.add_argument('--verify-only', action='store_true')
    parser.add_argument('--skip-decode', action='store_true', help='Skip MP3 decode only; hashes are always checked')
    args = parser.parse_args()
    for kind in ['clues', 'performance'] if args.kind=='all' else [args.kind]:
        config, manifest, checked = verify(kind, decode=not args.skip_decode)
        if args.verify_only:
            print(kind, len(checked), 'tracks verified')
        else:
            package(kind, config, manifest, checked)


if __name__ == '__main__':
    main()
