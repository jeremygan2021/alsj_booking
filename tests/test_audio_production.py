"""Offline regression tests: no MiniMax requests and no paid job creation."""
from pathlib import Path
import copy
import importlib.util
import json
import sys
import tempfile
import unittest
from unittest.mock import patch
import io

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT/'scripts'))
from audio_production import atomic_json, digest, fingerprint, payload_for, synthesize
import audio_production


def module(filename, name):
    spec = importlib.util.spec_from_file_location(name, ROOT/'scripts'/filename)
    value = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(value)
    return value


build = module('build-clue-audio.py', 'build_clue_audio')
prepare = module('prepare-clue-audio.py', 'prepare_clue_audio')
transcripts = module('verify-audio-transcripts.py', 'verify_audio_transcripts')


class AudioJobTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.cache = Path(self.temp.name)
        self.config = dict(model='speech-2.8-hd', voices={'诺拉':['existing-voice', 'label', .99, 0, 'direction']})
        self.line = dict(role='诺拉', text='核对已取得的完整记录。', emotion='calm')
        self.calls = []

    def tearDown(self):
        self.temp.cleanup()

    def api(self, path, key, payload=None):
        self.calls.append(path)
        if path == '/v1/t2a_async_v2':
            return dict(task_id='task-123', usage_characters=10)
        return dict(status='Success', file_id='file-123')

    def download(self, result, key, destination, job_dir, **kwargs):
        destination.write_bytes(b'offline-test-mp3')

    def generate(self, **kwargs):
        return synthesize(self.config, self.line, self.cache, 'fake-not-a-key',
                          api_fn=kwargs.pop('api_fn', self.api), download_fn=self.download,
                          poll_seconds=0, **kwargs)

    def test_task_queries_bypass_a_cached_processing_response_without_reposting(self):
        requests = []
        def response(request, timeout):
            requests.append(request)
            return io.BytesIO(b'{"status":"Success","base_resp":{"status_code":0}}')
        with patch('audio_production.urllib.request.urlopen', side_effect=response):
            for _ in range(2):
                self.assertEqual(audio_production.api('/v1/query/t2a_async_query_v2?task_id=123', 'test-key')['status'], 'Success')
        self.assertNotEqual(requests[0].full_url, requests[1].full_url)
        self.assertTrue(all(request.get_method() == 'GET' for request in requests))
        self.assertTrue(all(request.get_header('Cache-control') == 'no-cache' for request in requests))

    def test_second_run_reuses_verified_cached_payload(self):
        first = self.generate()
        second = self.generate()
        self.assertEqual(first, second)
        self.assertEqual(self.calls.count('/v1/t2a_async_v2'), 1)
        self.assertEqual(len(self.calls), 2)
        state = json.loads((first.parent/'state.json').read_text())
        self.assertEqual(state['audioHash'], digest(first.read_bytes()))

    def test_unknown_post_outcome_is_never_recreated(self):
        calls = []
        def disconnected(path, key, payload=None):
            calls.append(path)
            raise TimeoutError('network disconnect after provider may have received POST')
        with self.assertRaisesRegex(RuntimeError, 'unknown'):
            self.generate(api_fn=disconnected)
        with self.assertRaisesRegex(RuntimeError, 'reconciliation'):
            self.generate(api_fn=disconnected)
        self.assertEqual(calls, ['/v1/t2a_async_v2'])

    def test_interrupted_submitting_intent_requires_reconciliation(self):
        sha = fingerprint(payload_for(self.config, self.line))
        atomic_json(self.cache/'jobs'/sha/'state.json', dict(payloadHash=sha, status='submitting'))
        with self.assertRaisesRegex(RuntimeError, 'reconciliation'):
            self.generate()
        self.assertEqual(self.calls, [])

    def test_query_error_resumes_existing_id_without_post(self):
        def interrupted(path, key, payload=None):
            if path == '/v1/t2a_async_v2':
                return self.api(path, key, payload)
            raise TimeoutError('query timeout')
        with self.assertRaises(TimeoutError):
            self.generate(api_fn=interrupted)
        self.generate()
        self.assertEqual(self.calls.count('/v1/t2a_async_v2'), 1)
        self.assertIn('task_id=task-123', self.calls[-1])

    def test_failed_task_does_not_create_another_task(self):
        sha = fingerprint(payload_for(self.config, self.line))
        atomic_json(self.cache/'jobs'/sha/'state.json', dict(payloadHash=sha, task_id='already-paid', status='failed'))
        def failed(path, key, payload=None):
            self.calls.append(path)
            return dict(status='Failed')
        with self.assertRaisesRegex(RuntimeError, 'no automatic paid retry'):
            self.generate(api_fn=failed)
        self.assertEqual(len(self.calls), 1)
        self.assertIn('already-paid', self.calls[0])

    def test_corrupted_cached_audio_is_not_silently_reused(self):
        path = self.generate()
        path.write_bytes(b'corrupted')
        with self.assertRaisesRegex(RuntimeError, 'hash mismatch'):
            self.generate()
        self.assertEqual(self.calls.count('/v1/t2a_async_v2'), 1)

    def test_text_voice_and_parameters_all_change_job_fingerprint(self):
        base = fingerprint(payload_for(self.config, self.line))
        variants = []
        for change in ['voice', 'speed', 'model', 'text', 'emotion']:
            config, line = copy.deepcopy(self.config), copy.deepcopy(self.line)
            if change == 'voice': config['voices']['诺拉'][0] = 'other'
            if change == 'speed': config['voices']['诺拉'][2] = 1.1
            if change == 'model': config['model'] = 'other-model'
            if change == 'text': line['text'] += '新增事实。'
            if change == 'emotion': line['emotion'] = 'sad'
            variants.append(fingerprint(payload_for(config, line)))
        self.assertNotIn(base, variants)
        self.assertEqual(len(set(variants)), 5)

    def test_changed_source_cannot_reuse_old_finished_audio(self):
        config = dict(kind='clues', baselineDir=str(self.cache), performanceDir=str(self.cache))
        track = dict(id='E-01', part='body', sourceHash='new', renditionHash='new', legacyCompatible=False)
        prior = dict(id='E-01', part='body', sourceHash='old', filename='e-01-body.mp3', sha256='old')
        self.assertIsNone(build.compatible_file(self.cache, config, track, prior))

    def test_reused_performance_refreshes_only_allowed_stage_metadata(self):
        old = dict(id='A10', trigger='old trigger', notes='old notes', retired=True,
                   filename='a10.mp3', sha256='media-hash', sourceHash='source-hash',
                   renditionHash='render-hash', duration=220, events=[{'time':10, 'cue':'door'}])
        current = dict(id='A10', title='当前标题', stage='终局绝密', trigger='new trigger',
                       notes='new notes', spoiler=True, evidence=None,
                       filename='must-not-overwrite.mp3', sha256='wrong', duration=1, events=[])
        merged = build.merge_track_metadata(old, current, 'performance')
        self.assertEqual(merged['trigger'], 'new trigger')
        self.assertEqual(merged['notes'], 'new notes')
        self.assertNotIn('retired', merged)
        for key in ['filename', 'sha256', 'sourceHash', 'renditionHash', 'duration', 'events']:
            self.assertEqual(merged[key], old[key])
        self.assertEqual(old['trigger'], 'old trigger')
        self.assertEqual(build.merge_track_metadata(old, current, 'clues'), old)

    def test_subtitle_normalization_ignores_only_formatting(self):
        self.assertEqual(transcripts.normalized('“E－１９，八点五十八分。”'),
                         transcripts.normalized('e-19 八点五十八分'))
        self.assertNotEqual(transcripts.normalized('八点五十八分'),
                            transcripts.normalized('八点五十九分'))

    def test_subtitle_segments_keep_all_text_in_order(self):
        self.assertEqual(transcripts.subtitle_text([{'text':'第一句。'}, {'text':'第二句。'}]), '第一句。第二句。')
        with self.assertRaises(ValueError):
            transcripts.subtitle_text({'unrecognized':'not proof of spoken text'})

    def test_gm_directions_are_rejected_before_synthesis(self):
        text = '演员不能否认已确认纤维关联。'
        track = dict(id='E-17', part='detail', sourceText=text, sourceHash=digest(text),
                     lines=[dict(role='诺拉', text=text)])
        with self.assertRaisesRegex(ValueError, 'GM execution direction'):
            prepare.validate_track(track, self.config)


if __name__ == '__main__':
    unittest.main()
