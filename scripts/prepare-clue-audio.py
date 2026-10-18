"""Export canonical player text and prepare reviewed, tier-specific MiniMax scripts."""
from pathlib import Path
import argparse
import copy
import json
import re
import subprocess
from audio_production import MODEL, atomic_json, digest, rendition_hash, read_json

ROOT = Path(__file__).resolve().parents[1]
DEFAULT_CLUES = Path('/home/ai/下载/alsj/线索配乐音频_完整交付包/线索配乐音频')
DEFAULT_PERFORMANCE = Path('/home/ai/下载/alsj/现场演绎音频_完整制作交付包/现场演绎音频')
GM_PATTERN = re.compile(r'演员|GM|不能否认|保底|供认触发|触发条件|向全组公开|不得提前|玩家取得.*后')


def spoken(text):
    nums = '零一二三四五六七八九'
    def number(value):
        value = int(value)
        return nums[value] if value < 10 else ('十' + (nums[value % 10] if value % 10 else '')) if value < 20 else nums[value // 10] + '十' + (nums[value % 10] if value % 10 else '')
    def clock(match):
        return number(match[1]) + '点' + ('零' if int(match[2]) < 10 else '') + number(match[2]) + '分' + (number(match[3]) + '秒' if match[3] else '')
    text = re.sub(r'(\d{2}):(\d{2})(?::(\d{2}))?', clock, text)
    text = re.sub(r'\b(20\d{2})\b', lambda m: ''.join('〇' if d == '0' else nums[int(d)] for d in m[1]), text)
    for old, new in [('THORNE_ECHO_DEMO_V7', '索恩，伊寇演示，第七版'), ('LIA_VALE_014', '莉娅·维尔，零一四号档案'), ('EVELYN VALE', '伊芙琳·维尔'), ('UNDER REVIEW', '待审查'), ('ACTIVE', '运行中'), ('ECHO', '伊寇'), ('ADS', '艾迪艾斯'), ('90', '九十')]:
        text = text.replace(old, new)
    return text.replace('——', '，').replace('—', '至').replace('/', '或')


def canonical_sources(root=ROOT):
    script = "import {evidence} from './server/content.js'; import {publicInvestigationNodes as nodes} from './server/public-investigation.js'; console.log(JSON.stringify({clues:evidence.map(e=>({id:e[0],title:e[1],body:e[5],detail:e[6]})),nodes}));"
    return json.loads(subprocess.check_output(['node', '--input-type=module', '-e', script], cwd=root, text=True))


def validate_track(track, config):
    for line in track['lines']:
        if not line.get('text', '').strip() or line.get('role') not in config['voices']:
            raise ValueError('Invalid voice line: ' + track['id'])
        if GM_PATTERN.search(line['text']):
            raise ValueError('GM execution direction in spoken text: ' + track['id'] + ':' + track.get('part', 'performance'))
    if track['sourceHash'] != digest(track['sourceText']):
        raise ValueError('Source hash mismatch: ' + track['id'])


def prepare_clues(sources, baseline, performance):
    config = dict(version='2026-10-18-story-v5', model=MODEL,
                  voices=copy.deepcopy(performance['voices']), tracks=[])
    previous = {(t['id'], t['part']): t for t in baseline['tracks']}
    for item in sources['clues'] + sources['nodes']:
        for part in ('body', 'detail') if 'detail' in item else ('body',):
            old = previous.get((item['id'], part))
            text = item[part]
            unchanged = old and old['sourceHash'] == digest(text)
            if unchanged:
                track = copy.deepcopy(old)
                for line in track['lines']:
                    line.pop('start', None)
                    line.pop('end', None)
            else:
                role = '诺拉' if part == 'detail' or item['id'].startswith('AR-') else '旁白'
                track = dict(id=item['id'], part=part, title=item['title'], lines=[dict(role=role,
                    text=spoken(item['title']) + '。' + ('鉴定补充说明。' if part == 'detail' else '') + spoken(text), emotion='calm')],
                    music='At Rest.mp3' if item['id'] in ('E-07', 'E-18', 'E-26') else 'Darkest Child.mp3' if item['id'] in ('E-02', 'E-09', 'E-21') else 'Long Note One.mp3')
            # This old introduction read a release instruction aloud; keep it out of playback.
            if item['id'] == 'E-26' and part == 'body':
                for line in track['lines']:
                    line['text'] = line['text'].replace('完整遗言由主持人在终局开放。', '')
            track.update(title=item['title'], sourceText=text, sourceHash=digest(text), kind='clues')
            track['legacyCompatible'] = bool(unchanged and track['lines'] == [
                {k:v for k,v in line.items() if k not in ('start', 'end')} for line in old['lines']]
                and config['model'] == baseline['model'] and config['voices'] == baseline['voices'])
            validate_track(track, config)
            track['renditionHash'] = rendition_hash(config, track)
            config['tracks'].append(track)
    return config


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--baseline-dir', type=Path, default=DEFAULT_CLUES)
    parser.add_argument('--performance-dir', type=Path, default=DEFAULT_PERFORMANCE)
    parser.add_argument('--cache-dir', type=Path, default=ROOT/'output/clue-audio')
    parser.add_argument('--output-dir', type=Path, default=ROOT/'交付包_阿拉斯加之夜/线索配乐音频')
    args = parser.parse_args()
    sources = canonical_sources()
    baseline = read_json(args.baseline_dir/'分层配音源稿_GM保密.json')
    performance = read_json(args.performance_dir/'演绎制作源稿.json')
    config = prepare_clues(sources, baseline, performance)
    config.update(baselineDir=str(args.baseline_dir.resolve()), performanceDir=str(args.performance_dir.resolve()))
    atomic_json(args.cache_dir/'sources.json', sources)
    atomic_json(args.cache_dir/'config.json', config)
    atomic_json(args.output_dir/'分层配音源稿_GM保密.json', config)
    changed = [t['id']+':'+t['part'] for t in config['tracks'] if not t['legacyCompatible']]
    print(json.dumps(dict(tracks=len(config['tracks']), changed=changed,
                         characters=sum(len(l['text']) for t in config['tracks'] if not t['legacyCompatible'] for l in t['lines'])), ensure_ascii=False, indent=2))


if __name__ == '__main__':
    main()
