"""Assemble the six generated stills with the finished B02 narration and music."""
from pathlib import Path
import json, subprocess, tempfile

ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'交付包_阿拉斯加之夜'/'现场演绎音频'
track=next(t for t in json.loads((OUT/'播放清单.json').read_text())['tracks'] if t['id']=='B02')
folder=OUT/'万圣节图文'
images=[folder/'画面'/name for name in track['images']]
times=[0]+[line['start'] for line in track['lines'][1:]]+[track['duration']]
assert len(images)==len(times)-1
for image in images:assert image.is_file(),image

with tempfile.TemporaryDirectory() as tmp:
 playlist=Path(tmp)/'images.ffconcat'
 rows=['ffconcat version 1.0']
 for image,start,end in zip(images,times,times[1:]):
  rows.extend(["file '"+str(image).replace("'","'\\''")+"'",f'duration {end-start:.3f}'])
 rows.append("file '"+str(images[-1]).replace("'","'\\''")+"'")
 playlist.write_text('\n'.join(rows)+'\n')
 target=folder/'B02_阿拉斯加万圣节之夜_投屏版.mp4'
 subprocess.run(['ffmpeg','-v','error','-y','-safe','0','-f','concat','-i',str(playlist),'-i',str(OUT/track['file']),'-vf','fps=25,scale=1920:1080:force_original_aspect_ratio=decrease,pad=1920:1080:(ow-iw)/2:(oh-ih)/2,format=yuv420p','-c:v','libx264','-preset','veryfast','-crf','19','-c:a','aac','-b:a','192k','-t',str(track['duration']),'-movflags','+faststart',str(target)],check=True)
 print(target)
