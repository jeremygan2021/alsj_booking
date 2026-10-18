"""Shared, secret-free audio fingerprints and conservative MiniMax job persistence."""
from pathlib import Path
import hashlib
import io
import json
import os
import tarfile
import time
import urllib.error
import urllib.parse
import urllib.request

API_ROOT = 'https://api.minimax.cn'
MODEL = 'speech-2.8-hd'


def digest(value):
    if isinstance(value, str):
        value = value.encode('utf-8')
    return hashlib.sha256(value).hexdigest()


def fingerprint(value):
    return digest(json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')))


def atomic_json(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(path.name + '.tmp')
    tmp.write_text(json.dumps(value, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    os.replace(tmp, path)


def read_json(path, default=None):
    path = Path(path)
    return json.loads(path.read_text(encoding='utf-8')) if path.exists() else default


def payload_for(config, line):
    voice, _, speed, pitch, _ = config['voices'][line['role']]
    return dict(model=config['model'], text=line['text'], language_boost='Chinese',
                voice_setting=dict(voice_id=voice, speed=speed, vol=1, pitch=pitch,
                                   emotion=line.get('emotion', 'calm')),
                audio_setting=dict(audio_sample_rate=32000, bitrate=128000, format='mp3', channel=1))


def rendition_hash(config, track):
    return fingerprint({'lines': [payload_for(config, line) for line in track['lines']],
                        'gaps': [line.get('gap', .6) for line in track['lines']],
                        'music': track['music'], 'intro': track.get('intro', 1.25),
                        'outro': track.get('outro', 2.5), 'mixVersion': 2})


def api(path, key, payload=None):
    req = urllib.request.Request(API_ROOT + path,
        data=None if payload is None else json.dumps(payload).encode('utf-8'),
        headers={'Authorization': 'Bearer ' + key, 'Content-Type': 'application/json'})
    try:
        with urllib.request.urlopen(req, timeout=60) as response:
            result = json.load(response)
    except urllib.error.HTTPError as exc:
        # Never echo request headers, payloads, or provider response bodies.
        raise RuntimeError('MiniMax HTTP ' + str(exc.code)) from None
    status = result.get('base_resp', {}).get('status_code', 0)
    if status:
        raise RuntimeError('MiniMax provider status ' + str(status))
    return result


def download_task(result, key, destination, job_dir, api_fn=api):
    file_id = result.get('file_id')
    if not file_id:
        raise RuntimeError('Successful task did not return file_id; query again without resubmitting')
    metadata = api_fn('/v1/files/retrieve?file_id=' + urllib.parse.quote(str(file_id)), key)['file']
    with urllib.request.urlopen(metadata['download_url'], timeout=90) as response:
        blob = response.read()
    destination = Path(destination)
    destination.parent.mkdir(parents=True, exist_ok=True)
    if blob[:3] == b'ID3' or blob[:2] in (b'\xff\xfb', b'\xff\xf3', b'\xff\xf2'):
        audio = blob
    else:
        audio = None
        with tarfile.open(fileobj=io.BytesIO(blob), mode='r:*') as archive:
            for member in archive.getmembers():
                suffix = Path(member.name).suffix
                if member.isfile() and suffix in ('.mp3', '.titles', '.extra'):
                    data = archive.extractfile(member).read()
                    if suffix == '.mp3':
                        if audio is not None:
                            raise RuntimeError('Ambiguous task archive: multiple MP3 files')
                        audio = data
                    else:
                        (Path(job_dir) / ('response' + suffix)).write_bytes(data)
    if not audio:
        raise RuntimeError('Task download contained no audio; resume query, never recreate task')
    tmp = destination.with_suffix('.mp3.tmp')
    tmp.write_bytes(audio)
    os.replace(tmp, destination)


def _synthesize_locked(config, line, cache, key, api_fn=api, download_fn=download_task,
               poll_seconds=8, poll_limit=80):
    """One paid POST per payload. Unknown outcomes require manual task reconciliation."""
    payload = payload_for(config, line)
    sha = fingerprint(payload)
    job_dir = Path(cache) / 'jobs' / sha
    job_dir.mkdir(parents=True, exist_ok=True)
    state_path = job_dir / 'state.json'
    audio_path = job_dir / 'speech.mp3'
    state = read_json(state_path, {})
    if state.get('payloadHash') not in (None, sha):
        raise RuntimeError('Job fingerprint mismatch')
    if state.get('downloaded') and audio_path.exists():
        if digest(audio_path.read_bytes()) != state.get('audioHash'):
            raise RuntimeError('Cached audio hash mismatch: ' + sha[:12])
        return audio_path
    if not state.get('task_id'):
        if state.get('status') in ('submitting', 'submission_unknown', 'provider_rejected'):
            raise RuntimeError('Submission outcome requires reconciliation: ' + sha[:12] +
                               '; do not recreate this paid task')
        # Persist intent BEFORE the POST, so interruption cannot lead to a second charge.
        state = dict(payloadHash=sha, status='submitting', createdAt=int(time.time()))
        atomic_json(state_path, state)
        try:
            result = api_fn('/v1/t2a_async_v2', key, payload)
            task_id = result.get('task_id')
            if not task_id:
                raise RuntimeError('Create response had no task_id')
        except Exception as exc:
            state.update(status='submission_unknown', errorType=type(exc).__name__)
            atomic_json(state_path, state)
            raise RuntimeError('Submission outcome unknown for ' + sha[:12] +
                               '; recorded for reconciliation, no automatic retry') from None
        state.update(task_id=str(task_id), status='submitted',
                     usage_characters=result.get('usage_characters'))
        atomic_json(state_path, state)
        print(sha[:12], 'submitted task', str(task_id), flush=True)
    for _ in range(poll_limit):
        result = api_fn('/v1/query/t2a_async_query_v2?task_id=' +
                        urllib.parse.quote(state['task_id']), key)
        status = str(result.get('status', '')).lower()
        state.update(status=status, checkedAt=int(time.time()))
        if result.get('file_id'):
            state['file_id'] = str(result['file_id'])
        atomic_json(state_path, state)
        if status == 'success':
            download_fn(result, key, audio_path, job_dir, api_fn=api_fn)
            state.update(downloaded=True, audioHash=digest(audio_path.read_bytes()))
            atomic_json(state_path, state)
            return audio_path
        if status in ('failed', 'expired'):
            raise RuntimeError('Existing task ' + state['task_id'] + ' is ' + status +
                               '; no automatic paid retry')
        if status != 'processing':
            raise RuntimeError('Unrecognized task state; query existing task on resume')
        time.sleep(poll_seconds)
    raise TimeoutError('Task still processing; resume queries without resubmitting')


def synthesize(config, line, cache, key, **kwargs):
    # Lock the fingerprint, not the track/index: identical dialogue must share one task.
    import fcntl
    sha = fingerprint(payload_for(config, line))
    job_dir = Path(cache) / 'jobs' / sha
    job_dir.mkdir(parents=True, exist_ok=True)
    with (job_dir / 'job.lock').open('a') as lock:
        fcntl.flock(lock.fileno(), fcntl.LOCK_EX)
        return _synthesize_locked(config, line, cache, key, **kwargs)
