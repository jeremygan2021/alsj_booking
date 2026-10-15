"""Update the production handoff for the evidence narration assets."""
from pathlib import Path
import csv,hashlib,html,json,shutil,zipfile
ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'交付包_阿拉斯加之夜'
OUT=BASE/'线索配乐音频'
cfg=json.loads((ROOT/'output/clue-audio/config.json').read_text())
manifest=json.loads((ROOT/'server/audio/clue-audio.json').read_text())
tracks=manifest['tracks']
lookup={(t['id'],t['part']):t for t in cfg['tracks']}
def fmt(s):return f'{int(s)//60:02d}:{int(s)%60:02d}'
rows=[];script='# 线索分层配音台本（GM保密）\n\n本文件同时包含基础证据与鉴定内容，不向玩家公开分发。角色对话是依据相应层级文字改编的AI演绎，不作为新的证言或新证据。\n\n'
for t in tracks:
 s=lookup[t['id'],t['part']];folder='基础线索' if t['part']=='body' else '鉴定补充_GM保密'
 rows.append([t['id'],s['title'],'基础' if t['part']=='body' else '鉴定补充',fmt(t['duration']),'、'.join(t['speakers']),t['music']['title'],folder+'/'+t['filename']])
 script+=f'## {t["id"]} {s["title"]} · {rows[-1][2]} · {fmt(t["duration"])}\n\n对应文字：{s["sourceText"]}\n\n'
 for l in s['lines']:script+=f'- {l["role"]}：{l["text"]}\n'
 script+='\n'
(OUT/'线索配音台本_GM保密.md').write_text(script)
with (OUT/'线索配音清单.csv').open('w',encoding='utf-8-sig',newline='') as f:
 w=csv.writer(f);w.writerow(['编号','名称','层级','时长','角色','配乐','相对路径']);w.writerows(rows)
readme='''# 线索配乐音频使用说明

新增58段：26条基础线索、26条鉴定补充、6个AR观察节点。所有录音由MiniMax speech-2.8-hd固定角色音色生成，已混入下载配乐。沿用现场演绎里的角色声音，会面通知、西奥多证言、瑟琳娜声明及演出脚本等采用角色配音或对话。

## 网页使用

玩家扫码识别对应3D证物后，在AR画面中该证物的操作区点击播放按钮，可暂停、继续、从头播放并查看进度，不必先展开文字。AR主页面不显示线索播放器；玩家已打开的线索卡、3D物证弹层及墙面AR发现结果也可聆听。

只在主动点击后请求并播放录音。切换线索、关闭相机/弹层或离开搜证页会停止旧录音；同一时刻只播放一段线索声音。录音自带配乐，播放期间原氛围音乐临时暂停，结束/暂停后按原偏好恢复。网络故障可重试，文字线索始终可查看。

## 基础与鉴定的边界

- 原有二维码入口公开对应基础文字及基础配音，不附赠鉴定内容。
- 玩家须先取得证物，按原规则通过区域鉴定，才显示相应补充文字及录音。修改音频网址也不能绕过权限。
- 对话是依据可见文字制作的AI演绎，不构成额外证言；以文字记录为准。
- E-15声音内容不解释预录来源，须结合E-05与E-16调查；E-26基础配音只说明该线索内容，完整遗言仍使用现场A11终局播放，不提前揭露。
- GM修改线索正文后，旧配音会隐藏，避免听到已过期或不一致的内容。需要为修改后的文字重新制作配音再更新。

## 文件与分发

“基础线索”内有32段公开层级成片；“鉴定补充_GM保密”内有26段受控内容。完整包、试听页、台本和映射均由GM保管，不直接给玩家分发；玩家在正式网页按权限聆听。

音频为48kHz双声道128kbps MP3，包含人声和配乐。角色音色沿用“现场演绎音频/角色音色与制作说明.md”。网页音频不需要也不包含MiniMax密钥。

上线时媒体存放在server/audio/files，由应用按当前文字与权限提供，不可整体映射为公开静态目录。原二维码不变，无需重印。各条时长、音色和文件映射见“线索配音清单.csv”；制作源稿和文字指纹见保密JSON。

## 配乐

配乐来自Kevin MacLeod官网的Long note One、Darkest Child、At Rest，CC BY 4.0。已作截取、淡化、音量调整及对白混音。网页播放器可展开查看来源及授权；原配乐文件在现场演绎交付目录中。请在活动节目单/片尾和后续公开发布说明中保留署名及授权链接。

Music by Kevin MacLeod (incompetech.com). Licensed under Creative Commons Attribution 4.0: https://creativecommons.org/licenses/by/4.0/

- Long note One：https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100418
- Darkest Child：https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100783
- At Rest：https://incompetech.com/music/royalty-free/index.html?isrc=USUAN1100748

开演前仍需完整人工试听和真实场地调音。机器验收只覆盖字幕/源稿一致、媒体解码、响度峰值及网页控制和权限，不替代主观听审。
'''
(OUT/'使用说明_先读.md').write_text(readme)
cards=''
for t in tracks:
 s=lookup[t['id'],t['part']];folder='基础线索' if t['part']=='body' else '鉴定补充_GM保密'
 cards+=f'<article class="{t["part"]}"><small>{t["id"]} · {"基础" if t["part"]=="body" else "鉴定补充"} · {fmt(t["duration"])}</small><h2>{html.escape(s["title"])}</h2><p>{"、".join(t["speakers"])}</p><audio controls preload="none" src="{folder}/{t["filename"]}"></audio></article>'
page='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>线索配音 · GM试听</title><style>body{background:#101c23;color:#eee6d5;margin:0;font:16px/1.6 system-ui}main{max-width:1100px;margin:auto;padding:28px}h1{color:#d8b67b}h2{font-size:17px;margin:7px 0}small,p{color:#aebfc6}#grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}article{border:1px solid #40525c;border-radius:8px;padding:18px}audio{width:100%}.detail{display:none}body.show .detail{display:block}label{display:block;padding:16px 0 24px}@media(max-width:650px){#grid{grid-template-columns:1fr}main{padding:18px}}</style><main><h1>线索配音 · GM试听</h1><p>58段固定角色音色与配乐。此目录含隐藏鉴定内容，仅供GM；玩家请使用正式搜证网页。所有声音为AI演绎，以文字证据为准。</p><label><input type="checkbox" id="gm"> 我是GM，显示26段鉴定补充录音</label><div id="grid">__CARDS__</div><p>Music: Long note One, Darkest Child, At Rest by Kevin MacLeod (incompetech.com), CC BY 4.0, https://creativecommons.org/licenses/by/4.0/ . Edited and mixed with MiniMax speech.</p></main><script>document.querySelectorAll('audio').forEach(a=>a.addEventListener('play',()=>document.querySelectorAll('audio').forEach(b=>{if(a!==b)b.pause()})));document.getElementById('gm').onchange=e=>{document.body.classList.toggle('show',e.target.checked);if(!e.target.checked)document.querySelectorAll('.detail audio').forEach(a=>a.pause())};</script></html>'''
(OUT/'GM试听台_请勿发给玩家.html').write_text(page.replace('__CARDS__',cards))
update='''# 线索音频与网页搜证更新（2026-10-15）

本次新增58段线索配乐音频：26条基础、26条鉴定补充、6个AR节点。播放器放在扫码后对应3D模型的AR操作区，主页面不显示；玩家已打开的线索卡、3D弹层与墙面AR结果也可聆听。原二维码链接不变，无需重印。

对话采用固定人物音色；音频自带配乐。切换/关闭自动停止、录音互斥、暂停/继续/重播、进度与加载失败重试均已接入。鉴定音频沿用文字权限；GM修改对应正文会自动隐藏旧录音。

完整资产、台本、清单和GM试听台在“线索配乐音频”目录，压缩包为“线索配乐音频_完整交付包.zip”。仅向GM交付完整目录，玩家在正式网页按权限播放。

现场12段演绎音频仍使用上一轮独立交付包；本次新增线索包与网页应用，不将其并入旧NPC/3D压缩包。
'''
(BASE/'本次交付更新_线索音频.md').write_text(update)
print('Clue audio documents, CSV and GM audition page prepared.')
