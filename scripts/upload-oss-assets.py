#!/usr/bin/env python3
"""Upload immutable, private runtime assets; credentials come only from environment."""
import base64, concurrent.futures, email.utils, hashlib, hmac, json, os
from pathlib import Path
from urllib.request import Request, urlopen
from urllib.error import HTTPError
ROOT = Path(__file__).resolve().parents[1]
BUCKET = os.environ['OSS_BUCKET']
ENDPOINT = os.environ.get('OSS_ENDPOINT', 'oss-cn-shanghai.aliyuncs.com')
ACCESS_ID = os.environ['OSS_ACCESS_KEY_ID']
SECRET = os.environ['OSS_ACCESS_KEY_SECRET']
PREFIX = 'alsj/assets/v1/'

def request(method, key, body=None, headers=None):
    headers = dict(headers or {})
    headers['Date'] = email.utils.formatdate(usegmt=True)
    canonical = ''.join(f'{k.lower()}:{v}\n' for k,v in sorted(headers.items(),key=lambda x:x[0].lower()) if k.lower().startswith('x-oss-'))
    text = '\n'.join([method, headers.get('Content-MD5',''), headers.get('Content-Type',''), headers['Date'], canonical + '/' + BUCKET + '/' + key])
    signature = base64.b64encode(hmac.new(SECRET.encode(),text.encode(),hashlib.sha1).digest()).decode()
    headers['Authorization'] = 'OSS '+ACCESS_ID+':'+signature
    return urlopen(Request(f'https://{BUCKET}.{ENDPOINT}/{key}',data=body,headers=headers,method=method),timeout=90)

def upload(file, relative=None):
    relative = relative or str(file.relative_to(ROOT))
    data = file.read_bytes()
    sha = hashlib.sha256(data).hexdigest()
    key = PREFIX + sha + file.suffix
    mime = 'audio/mpeg' if file.suffix == '.mp3' else 'model/gltf-binary'
    try:
        with request('HEAD',key) as response:
            exists = response.headers.get('x-oss-meta-sha256') == sha and int(response.headers['Content-Length']) == len(data)
    except HTTPError as error:
        if error.code != 404: raise RuntimeError(f'OSS HEAD failed: {error.code}') from None
        exists = False
    if not exists:
        with request('PUT',key,data,{'Content-Type':mime,'Content-MD5':base64.b64encode(hashlib.md5(data).digest()).decode(),'x-oss-object-acl':'private','x-oss-meta-sha256':sha}) as response:
            assert response.status == 200
    with request('GET',key) as response:
        assert hashlib.sha256(response.read()).hexdigest() == sha, 'OSS checksum mismatch'
    print(f'{"verified" if exists else "uploaded"}: {relative}',flush=True)
    return relative, {'key':key,'sha256':sha,'bytes':len(data),'contentType':mime}

if __name__ == '__main__':
    files = sorted([*ROOT.glob('public/models/*.glb'),*ROOT.glob('public/ar-assets/models/*.glb'),*ROOT.glob('server/audio/files/*.mp3'),*ROOT.glob('server/audio/performance-files/*.mp3')])
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool: entries = dict(pool.map(upload,files))
    manifest = {'version':1,'bucket':BUCKET,'endpoint':ENDPOINT,'assets':entries}
    target = ROOT/'server/asset-storage.json'
    temp = target.with_suffix('.json.tmp')
    temp.write_text(json.dumps(manifest,ensure_ascii=False,indent=2)+'\n')
    temp.replace(target)
    print(json.dumps({'verifiedFiles':len(entries),'bytes':sum(x['bytes'] for x in entries.values()),'manifest':str(target)}))
