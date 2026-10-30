"""Generate the approved B06 dialogue with existing fixed voices and resumable jobs."""
from pathlib import Path
import argparse
import concurrent.futures
import json
import os
from audio_production import atomic_json, synthesize

ROOT = Path(__file__).resolve().parents[1]

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--key-file', type=Path)
    args = parser.parse_args()
    key = args.key_file.read_text().strip() if args.key_file else os.environ['MINIMAX_API_KEY']
    scene = json.loads((ROOT/'scripts/blackout-scene.json').read_text())
    manifest = json.loads((ROOT/'server/audio/performance-audio.json').read_text())
    config = {'model': scene['model'], 'voices': {
        v['role']: [v['voiceId'], v['label'], v['speed'], v['pitch'], v['direction']]
        for v in manifest['voices']}}
    config['voices'].update(scene.get('extraVoices', {}))
    cache = ROOT/'output/performance-audio/blackout/tts'

    def generate(item):
        index, line = item
        result = synthesize(config, line, cache, key, poll_seconds=3)
        print(f"READY {index+1}: {line['role']}", flush=True)
        return str(result)

    with concurrent.futures.ThreadPoolExecutor(max_workers=2) as pool:
        paths = list(pool.map(generate, enumerate(scene['lines'])))
    atomic_json(cache/'scene-files.json', {'paths': paths})
    print('All fixed-voice lines ready', flush=True)
