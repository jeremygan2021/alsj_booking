#!/usr/bin/env python3
"""Archive the five existing background originals in private OSS with credits."""
import argparse, base64, concurrent.futures, hashlib, importlib.util, json
from pathlib import Path

parser = argparse.ArgumentParser()
parser.add_argument('source', type=Path, help='Directory containing the five MP3s and 配乐来源.json')
parser.add_argument('--output', type=Path, required=True)
args = parser.parse_args()
spec = importlib.util.spec_from_file_location('oss_upload', Path(__file__).with_name('upload-oss-assets.py'))
oss = importlib.util.module_from_spec(spec)
spec.loader.exec_module(oss)
source = args.source.resolve()
tracks = json.loads((source/'配乐来源.json').read_text())
expected = {'USUAN1100783','USUAN1100748','USUAN1100574','USUAN1100546','USUAN1100418'}
assert len(tracks) == 5 and {x['isrc'] for x in tracks} == expected

def upload(track):
    filename = track['filename']
    assert Path(filename).name == filename and filename.endswith('.mp3')
    _, entry = oss.upload(source/filename, 'background-music/'+filename)
    return {'title':track['title'],'filename':filename,'artist':'Kevin MacLeod',
        'composer':'Camille Saint-Saëns' if track['isrc']=='USUAN1100546' else 'Kevin MacLeod',
        'source':f"https://incompetech.com/music/royalty-free/index.html?isrc={track['isrc']}",
        'license':'https://creativecommons.org/licenses/by/4.0/', 'changes':'原曲，未作修改',**entry}

with concurrent.futures.ThreadPoolExecutor(max_workers=3) as pool:
    results = list(pool.map(upload, tracks))
catalog = {'version':1,'bucket':oss.BUCKET,'endpoint':oss.ENDPOINT,'private':True,'tracks':results}
data = (json.dumps(catalog,ensure_ascii=False,indent=2)+'\n').encode()
sha = hashlib.sha256(data).hexdigest()
key = 'alsj/background-music/v1/'+sha+'.json'
with oss.request('PUT',key,data,{'Content-Type':'application/json','Content-MD5':base64.b64encode(hashlib.md5(data).digest()).decode(),'x-oss-object-acl':'private','x-oss-meta-sha256':sha}) as r:
    assert r.status == 200
with oss.request('GET',key) as r:
    assert hashlib.sha256(r.read()).hexdigest() == sha
catalog['catalogObject'] = key
args.output.parent.mkdir(parents=True,exist_ok=True)
temp = args.output.with_suffix('.tmp')
temp.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
temp.replace(args.output)
print(json.dumps({'verifiedBackgroundTracks':len(results),'bytes':sum(x['bytes'] for x in results),'catalogObject':key}))
