"""Compare returned MiniMax subtitles to every newly synthesized reviewed line."""
from pathlib import Path
import argparse
import json
import unicodedata
from audio_production import atomic_json, fingerprint, payload_for, read_json

ROOT = Path(__file__).resolve().parents[1]


def normalized(text):
    text = unicodedata.normalize('NFKC', text).casefold()
    return ''.join(char for char in text if unicodedata.category(char)[0] not in ('P', 'S', 'Z', 'C'))


def subtitle_text(value):
    if isinstance(value, list):
        return ''.join(subtitle_text(part) for part in value)
    if isinstance(value, dict):
        if isinstance(value.get('text'), str):
            return value['text']
        raise ValueError('Unrecognized subtitle object shape')
    raise ValueError('Unrecognized subtitle shape')


def audit(cache):
    configurations = [(cache/'config.json', True), (cache/'performance-config.json', True)]
    configurations += [(path, False) for path in sorted((cache/'audit').glob('*config*.json'))]
    expected = {}
    for path, current in configurations:
        config = read_json(path)
        if not config:
            continue
        for track in config['tracks']:
            for index, line in enumerate(track['lines'], 1):
                if line.get('reuse') or track.get('legacyCompatible'):
                    continue
                sha = fingerprint(payload_for(config, line))
                item = expected.setdefault(sha, dict(payloadHash=sha, text=line['text'], current=False, references=[]))
                item['current'] = item['current'] or current
                item['references'].append(dict(id=track['id'], part=track.get('part'), line=index,
                                               snapshot=not current))
    results = []
    problems = []
    for sha, item in expected.items():
        job = cache/'jobs'/sha
        state = read_json(job/'state.json', {})
        error = None
        actual = None
        if not state.get('downloaded'):
            error = 'Job is not downloaded'
        elif not (job/'response.titles').is_file():
            error = 'Provider subtitle file is missing'
        else:
            try:
                actual = subtitle_text(read_json(job/'response.titles'))
                if normalized(actual) != normalized(item['text']):
                    error = 'Normalized subtitle differs from reviewed speech text'
            except (ValueError, TypeError, KeyError) as exc:
                error = str(exc)
        result = dict(payloadHash=sha, current=item['current'], references=item['references'],
                      match=not error, usageCharacters=state.get('usage_characters'),
                      taskId=state.get('task_id'))
        if error:
            result.update(error=error, expected=item['text'], actual=actual)
            problems.append(result)
        results.append(result)
    all_states = [read_json(path) for path in sorted((cache/'jobs').glob('*/state.json'))]
    orphan_jobs = [state.get('payloadHash') for state in all_states if state.get('payloadHash') not in expected]
    report = dict(version='2026-10-18-story-v5', normalization='Unicode NFKC + casefold; remove punctuation, symbols, whitespace and control characters',
                  checkedNewUniqueJobs=len(results), currentUniqueJobs=sum(item['current'] for item in results),
                  supersededUniqueJobs=sum(not item['current'] for item in results),
                  matchingJobs=sum(item['match'] for item in results), differences=problems,
                  usageCharacters=sum(int(state.get('usage_characters') or 0) for state in all_states),
                  totalJobStates=len(all_states), unaccountedJobHashes=orphan_jobs, jobs=results,
                  limitation='字幕与审定台词的规范化比对，不替代人耳逐句听审')
    return report


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--cache-dir', type=Path, default=ROOT/'output/clue-audio')
    parser.add_argument('--report', type=Path, default=ROOT/'output/clue-audio/transcript-audit.json')
    args = parser.parse_args()
    report = audit(args.cache_dir)
    atomic_json(args.report, report)
    print(json.dumps({key:report[key] for key in ('checkedNewUniqueJobs', 'currentUniqueJobs', 'supersededUniqueJobs', 'matchingJobs', 'usageCharacters', 'totalJobStates', 'unaccountedJobHashes')}, ensure_ascii=False, indent=2))
    if report['differences'] or report['unaccountedJobHashes']:
        raise SystemExit('Transcript verification incomplete; inspect local report')


if __name__ == '__main__':
    main()
