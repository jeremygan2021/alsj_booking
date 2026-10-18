"""Resume MiniMax jobs, reuse unchanged finished tracks, and publish complete manifests."""
from pathlib import Path
import argparse
import concurrent.futures
import copy
import json
import os
import shutil
import subprocess
import numpy as np
from audio_production import (atomic_json, digest, fingerprint, payload_for, read_json,
                              rendition_hash, synthesize)

ROOT = Path(__file__).resolve().parents[1]
SR = 48000
MUSIC_IDS = {'Long Note One.mp3':'USUAN1100418', 'At Rest.mp3':'USUAN1100748',
             'Darkest Child.mp3':'USUAN1100783', 'Awkward Meeting.mp3':'USUAN1100574',
             'Danse Macabre.mp3':'USUAN1100546'}


def decode(path, af=''):
    command = ['ffmpeg', '-v', 'error', '-i', str(path)]
    if af:
        command += ['-af', af]
    return np.frombuffer(subprocess.check_output(command + ['-ar', str(SR), '-ac', '2', '-f', 'f32le', 'pipe:1']), dtype='<f4').reshape(-1, 2).copy()


def audio_file(root, kind, track):
    return root/'server/audio'/('files' if kind == 'clues' else 'performance-files')/track['filename']


def track_key(track):
    return track['id'] + (':' + track['part'] if track.get('part') else '')


def filename_for(track):
    return track['id'].lower() + ('-' + track['part'] if track.get('part') else '') + '.mp3'


def raw_reuse(config, line):
    if not line.get('reuse'):
        return None
    path = Path(config['performanceDir'])/'制作分轨/原始台词'/line['reuse']
    if not path.is_file():
        raise RuntimeError('Reviewed reusable dialogue is missing: ' + line['reuse'])
    return path


def line_status(config, line, cache):
    if raw_reuse(config, line):
        return 'reuse'
    sha = fingerprint(payload_for(config, line))
    state = read_json(cache/'jobs'/sha/'state.json', {})
    if state.get('downloaded') and (cache/'jobs'/sha/'speech.mp3').is_file():
        return 'cached'
    if state.get('task_id'):
        return 'query'
    if state.get('status') in ('submitting', 'submission_unknown', 'provider_rejected'):
        return 'reconcile'
    return 'submit'


def merge_track_metadata(prior, current, kind):
    """Refresh reviewed staging prose while preserving media hashes, events and timings."""
    entry = copy.deepcopy(prior)
    if kind == 'performance':
        for field in ('title', 'stage', 'trigger', 'notes', 'spoiler', 'evidence', 'retired'):
            if field in current:
                entry[field] = copy.deepcopy(current[field])
            else:
                entry.pop(field, None)
    return entry


def compatible_file(root, config, track, prior):
    if not prior:
        return None
    fresh = prior.get('sourceHash') == track['sourceHash'] and prior.get('renditionHash') == track['renditionHash']
    legacy = track.get('legacyCompatible') and not prior.get('renditionHash') and (
        prior.get('sourceHash') in (None, track['sourceHash']))
    if not (fresh or legacy):
        return None
    path = audio_file(root, config['kind'], prior)
    if not path.is_file():
        if config['kind'] == 'clues':
            folder = '基础线索' if track['part'] == 'body' else '鉴定补充_GM保密'
            path = Path(config['baselineDir'])/folder/prior['filename']
        else:
            options = list((Path(config['performanceDir'])/'现场播放版_MP3').glob(track['id']+'_*.mp3'))
            path = options[0] if len(options) == 1 else path
    if not path.is_file() or digest(path.read_bytes()) != prior.get('sha256'):
        return None
    return path


def save_audio(array, path):
    path.parent.mkdir(parents=True, exist_ok=True)
    temp = path.with_name(path.stem + '.new.mp3')
    subprocess.run(['ffmpeg', '-v', 'error', '-y', '-f', 'f32le', '-ar', str(SR), '-ac', '2', '-i', 'pipe:0',
        '-af', 'loudnorm=I=-16:TP=-1.8:LRA=9', '-ar', str(SR), '-c:a', 'libmp3lame', '-b:a', '128k',
        '-metadata', 'comment=AI dramatization: MiniMax. Music by Kevin MacLeod (incompetech.com), CC BY 4.0. Edited and mixed.', str(temp)],
        input=array.astype('<f4').tobytes(), check=True)
    os.replace(temp, path)


def mix(root, config, track, paths):
    segments = []
    cursor = track.get('intro', 1.25)
    events = []
    cue_instructions = {'door':'配合开门或进入动作。', 'impact':'错位表演举杯与安全倒地，不作真实击打。',
                        'terminal':'配合台词继续表演。', 'entrance':'对应角色走到定点。'}
    for line, path in zip(track['lines'], paths):
        voice = decode(path, 'highpass=f=70,loudnorm=I=-18:TP=-3:LRA=9')
        line['start'] = round(cursor, 3)
        line['end'] = round(cursor + len(voice)/SR, 3)
        segments.append((cursor, voice))
        if line.get('cue'):
            events.append(dict(time=round(cursor, 3), cue=line['cue'],
                               instruction=cue_instructions.get(line['cue'], '按当前台词配合动作。'), role=line['role']))
        cursor += len(voice)/SR + line.get('gap', .6)
    n = int((cursor + track.get('outro', 2.5))*SR)
    speech = np.zeros((n, 2), np.float32)
    for start, voice in segments:
        a = int(start*SR)
        speech[a:a+len(voice)] += voice
    music_path = Path(config['performanceDir'])/'配乐与音效'/track['music']
    background = decode(music_path, 'loudnorm=I=-25:TP=-4:LRA=9')
    offset = 0 if track['music'] == 'At Rest.mp3' else 20*SR
    background = background[offset:]
    if not len(background):
        raise RuntimeError('Empty background music')
    background = np.tile(background, (int(np.ceil(n/len(background))), 1))[:n]
    envelope = np.ones(n, np.float32)
    for start, voice in segments:
        a = int(start*SR); b = a+len(voice)
        low = max(0, a-int(.25*SR)); high = min(n, b+int(.6*SR))
        envelope[a:b] = np.minimum(envelope[a:b], .38)
        envelope[low:a] = np.minimum(envelope[low:a], np.linspace(1, .38, a-low))
        envelope[b:high] = np.minimum(envelope[b:high], np.linspace(.38, 1, high-b))
    fade = min(SR, n); end_fade = min(2*SR, n)
    envelope[:fade] *= np.linspace(0, 1, fade)
    envelope[-end_fade:] *= np.linspace(1, 0, end_fade)
    background *= envelope[:, None]
    filename = filename_for(track)
    destination = audio_file(root, config['kind'], {'filename':filename})
    save_audio(speech+background, destination)
    credit = dict(title=track['music'].removesuffix('.mp3'), artist='Kevin MacLeod',
                  source='https://incompetech.com/music/royalty-free/index.html?isrc='+MUSIC_IDS[track['music']],
                  license='CC BY 4.0', licenseUrl='https://creativecommons.org/licenses/by/4.0/',
                  changes='截取、淡入淡出、音量调整与对白混音')
    result = dict(id=track['id'], sourceHash=track['sourceHash'], renditionHash=track['renditionHash'],
                  filename=filename, duration=round(n/SR, 3),
                  speakers=list(dict.fromkeys(line['role'] for line in track['lines'])),
                  music=credit, sha256=digest(destination.read_bytes()))
    if track.get('part'):
        result['part'] = track['part']
    else:
        result.update({key:track.get(key) for key in ('title', 'stage', 'trigger', 'notes', 'spoiler', 'evidence', 'retired') if key in track})
        result['events'] = events
    print(track_key(track), 'mixed', result['duration'], 'seconds', flush=True)
    return result


def run_kind(args, kind, key):
    config_path = args.cache_dir/('config.json' if kind == 'clues' else 'performance-config.json')
    config = read_json(config_path)
    if not config:
        raise RuntimeError('Run prepare script first: ' + str(config_path))
    config['kind'] = kind
    manifest_path = ROOT/'server/audio'/('clue-audio.json' if kind == 'clues' else 'performance-audio.json')
    manifest = read_json(manifest_path, {'tracks':[]})
    old = {track_key(t):t for t in manifest['tracks']}
    targets = []
    skipped = []
    plans = []
    ids = set(filter(None, args.ids.split(','))) if args.ids else None
    for track in config['tracks']:
        ident = track_key(track)
        if ids and ident not in ids and track['id'] not in ids:
            continue
        previous = old.get(ident)
        reusable = compatible_file(ROOT, config, track, previous)
        if args.only_changed and reusable:
            old[ident] = merge_track_metadata(previous, track, kind)
            skipped.append(ident)
            continue
        statuses = [] if reusable else [line_status(config, line, args.cache_dir) for line in track['lines']]
        plans.append(dict(id=ident, action='reuse-finished' if reusable else 'mix', lines=statuses,
                          paidCharacters=sum(len(line['text']) for line, status in zip(track['lines'], statuses) if status=='submit')))
        targets.append((track, reusable))
    if args.plan:
        print(json.dumps(dict(kind=kind, selected=len(targets), skipped=skipped, tracks=plans,
                              paidCharacters=sum(p['paidCharacters'] for p in plans)), ensure_ascii=False, indent=2))
        return
    outputs = dict(old)
    pending = []
    for track, reusable in targets:
        ident = track_key(track)
        if reusable:
            target = audio_file(ROOT, kind, {'filename':filename_for(track)})
            target.parent.mkdir(parents=True, exist_ok=True)
            if reusable.resolve() != target.resolve():
                shutil.copy2(reusable, target)
            entry = merge_track_metadata(old[ident], track, kind)
            entry.update(sourceHash=track['sourceHash'], renditionHash=track['renditionHash'])
            outputs[ident] = entry
        else:
            pending.append(track)

    def produce(track):
        paths = []
        for line in track['lines']:
            path = raw_reuse(config, line)
            if not path:
                if args.mix_only:
                    sha = fingerprint(payload_for(config, line))
                    path = args.cache_dir/'jobs'/sha/'speech.mp3'
                    if not path.is_file():
                        raise RuntimeError('Missing cached dialogue for mix-only: '+track_key(track))
                else:
                    path = synthesize(config, line, args.cache_dir, key)
            paths.append(path)
        return mix(ROOT, config, track, paths)

    failures = []
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        futures = {pool.submit(produce, track):track_key(track) for track in pending}
        for future in concurrent.futures.as_completed(futures):
            ident = futures[future]
            try:
                outputs[ident] = future.result()
            except Exception as exc:
                failures.append(ident)
                print(ident, type(exc).__name__, str(exc)[:240], flush=True)
                continue
            # Save progress in the main thread without losing unrelated manifest entries.
            manifest['version'] = config['version']
            manifest['model'] = config['model']
            manifest['tracks'] = [outputs[track_key(t)] for t in config['tracks'] if track_key(t) in outputs]
            atomic_json(manifest_path, manifest)
    if failures:
        raise RuntimeError('Incomplete tracks: ' + ','.join(failures) + '; resume existing tasks, never clear job states')
    manifest['version'] = config['version']
    manifest['model'] = config['model']
    manifest['tracks'] = [outputs[track_key(t)] for t in config['tracks'] if track_key(t) in outputs]
    atomic_json(manifest_path, manifest)
    atomic_json(config_path, config)
    output_dir = ROOT/'交付包_阿拉斯加之夜'/('线索配乐音频' if kind=='clues' else '现场演绎音频')
    output_dir.mkdir(parents=True, exist_ok=True)
    if kind == 'clues':
        for entry in manifest['tracks']:
            source = audio_file(ROOT, kind, entry)
            folder = output_dir/('基础线索' if entry['part']=='body' else '鉴定补充_GM保密')
            folder.mkdir(exist_ok=True)
            if source.is_file(): shutil.copy2(source, folder/entry['filename'])
        atomic_json(output_dir/'音频映射与验收清单.json', manifest)
        atomic_json(output_dir/'分层配音源稿_GM保密.json', config)
    else:
        atomic_json(output_dir/'演绎制作源稿.json', config)
        atomic_json(output_dir/'音频映射与验收清单.json', manifest)
    print(kind, 'complete;', len(targets), 'processed;', len(skipped), 'unchanged finished tracks kept', flush=True)


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--key-file', type=Path)
    parser.add_argument('--cache-dir', type=Path, default=ROOT/'output/clue-audio')
    parser.add_argument('--kind', choices=['clues', 'performance', 'all'], default='clues')
    parser.add_argument('--mix-only', action='store_true')
    parser.add_argument('--only-changed', action='store_true')
    parser.add_argument('--ids', help='Comma-separated E-02,E-19:detail,B01,A10')
    parser.add_argument('--workers', type=int, choices=range(1, 7), default=4)
    parser.add_argument('--plan', action='store_true', help='Read-only cost and reuse plan; no provider requests')
    args = parser.parse_args()
    key = None
    if not args.plan and not args.mix_only:
        key = args.key_file.read_text().strip() if args.key_file else os.environ.get('MINIMAX_API_KEY')
        if not key:
            parser.error('Provide --key-file or MINIMAX_API_KEY, or use --plan/--mix-only')
    for kind in ['clues', 'performance'] if args.kind=='all' else [args.kind]:
        run_kind(args, kind, key)


if __name__ == '__main__':
    main()
