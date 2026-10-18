"""Build operator documents and an offline player from the completed audio manifest."""
from pathlib import Path
import csv, html, json, re, shutil, zipfile

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'交付包_阿拉斯加之夜'
OUT=BASE/'现场演绎音频'
cfg=json.loads((OUT/'播放清单.json').read_text())
tracks=cfg['tracks'];active=[t for t in tracks if not t.get('retired')];voices=cfg['voices']
def fmt(n):return f'{int(n)//60:02d}:{int(n)%60:02d}'
music=json.loads((OUT/'配乐与音效'/'配乐来源.json').read_text())
credits='# 配乐与音效来源及署名\n\n下载与核对日期：2026-10-15。以下配乐来自作者官网，采用页面提供的CC BY 4.0授权；音效来自Kenney官方CC0素材包。\n\n'
for m in music:
 credits+=f'## {m["title"]}\n\n- 作者/演绎：Kevin MacLeod（Danse Macabre 原作：Camille Saint-Saëns）\n- 官方曲目页：https://incompetech.com/music/royalty-free/index.html?isrc={m["isrc"]}\n- 官方目录：https://incompetech.com/music/royalty-free/pieces.json\n- 授权：https://creativecommons.org/licenses/by/4.0/\n- 本次改动：截取、循环与交叉淡化、音量调整、对白闪避、与剧情语音及音效混音。\n\n署名文字：\n\n> “{m["title"]}” Kevin MacLeod (incompetech.com). Licensed under Creative Commons: By Attribution 4.0 License. https://creativecommons.org/licenses/by/4.0/\n\n'
credits+='## Kenney音效\n\n使用RPG Audio、Impact Sounds、Casino Audio、Interface Sounds中的开门、纸牌翻动（代替游戏券撒落）、柔性钝击、木质落槌、终端确认及录音机点击音。均从官方包下载，保留所用原文件及原License.txt。\n\n'
for slug in ['rpg-audio','impact-sounds','casino-audio','interface-sounds']:credits+='- https://kenney.nl/assets/'+slug+'\n'
credits+='\n授权：https://creativecommons.org/publicdomain/zero/1.0/\n\n可选署名：SFX by Kenney (kenney.nl), CC0. 音效作裁切、叠加及音量调整。\n\n## 现场使用的署名方式\n\n播放页已显示完整音乐署名及授权链接；请同时在现场节目单、活动屏幕片尾或现场可查阅的活动说明中保留上述曲目署名与授权链接。后续公开发布音频/视频时，把署名复制到发布说明，并注明进行了剪辑混音。原配乐不因本次混音改变其CC BY授权。\n\n## 语音与虚构录音\n\n所有角色语音由MiniMax speech-2.8-hd系统音色生成，不克隆真人。瑟琳娜“生前真人录音”及索恩“本人预录遗言”属于剧中来源设定，现实文件均为AI演绎。E-26本次交付为音频替代版，不是新增真人视频。\n'
(OUT/'配乐来源与署名.md').write_text(credits)

script='# 现场演绎全台本与动作时间轴（仅GM/导演）\n\n本稿含全部真相，不交给玩家。以当前server/story-materials.json的唯一真相和时间线为准，新增撒钱和对白为舞台改编，不增设推理证据。ADS读作“艾迪艾斯”，ECHO读作“伊寇”。音频均由AI演员演绎。\n\n'
for t in tracks:
 script+=f'## {t["id"]} {t["title"]} · {fmt(t["duration"])}'+('（旧版留档，现场不用）' if t.get('retired') else '')+f'\n\n阶段：{t["stage"]}。触发：{t["trigger"]}\n\n导演说明：{t["notes"]}\n\n配乐：{t["musicSource"]}。\n\n'
 for l in t['lines']:script+=f'- **{fmt(l["start"])}—{fmt(l["end"])} {l["role"]}**：{l["text"]}\n'
 script+='\n动作/音效：\n\n'
 for e in t['events']:script+=f'- {fmt(e["time"])}：{e["instruction"]}\n'
 if not t['events']:script+='- 按对白表情、站位执行。\n'
 script+='\n'
(OUT/'全台本与动作时间轴_GM保密.md').write_text(script)
vdoc='# 固定角色音色表\n\n每个角色固定一个voice_id及音高，只按场景改变情绪；不通过变声替换人物。同一索恩音色贯穿真人开场、ECHO数字演示、档案室争执及真实遗言。旁白独立于角色。\n\n| 角色 | MiniMax音色 | voice_id | 语速 | 音高 | 表演方向 |\n|---|---|---|---|---|---|\n'
for role,(id,name,speed,pitch,direction) in voices.items():vdoc+=f'| {role} | {name} | `{id}` | {speed} | {pitch} | {direction} |\n'
vdoc+='\n模型：speech-2.8-hd；原始语音32kHz单声道128kbps MP3。现场成片48kHz双声道256kbps MP3；母带48kHz双声道16-bit WAV。对白居中、配乐保留立体声；有对白时自动降低配乐；成片统一响度目标-16 LUFS、真峰值-1.5 dBTP。实际测量见验收报告。\n\n官方调用参考：\n\n- https://platform.minimax.cn/docs/api-reference/speech-t2a-async-create\n- https://platform.minimax.cn/docs/api-reference/speech-t2a-async-query\n- https://platform.minimax.cn/docs/api-reference/voice-management-get\n- https://platform.minimax.cn/docs/api-reference/file-management-retrieve\n\n实际调用采用创建异步任务、查询成功、检索文件、下载后本地混音的流程。交付内容不含API密钥、任务token或临时下载链接。\n'
(OUT/'角色音色与制作说明.md').write_text(vdoc)
readme=f'''# 现场音频使用说明

当前播控共{len(active)}段，总时长{fmt(sum(t['duration'] for t in active))}。每段播放后自动停住。请手动按活动进度触发，不要把全套音频设为自动连播。

## 现场顺序

1. 入场依次播放B01《为什么来到阿拉斯加》（1:56）、B02《阿拉斯加万圣节之夜》（2:57）、B03《六位人物登场》（1:25），然后开放交谈。B02请在投影电脑播放`万圣节图文/B02_阿拉斯加万圣节之夜_投屏版.mp4`；视频已含同一配音与配乐，勿同时播放B02 MP3。
2. B03每个角色声音响起时，该真人NPC入场定点，按配音做动作和表情，不必开口。走位点见`人物出场走位卡_GM.md`。
3. B03后开放交谈。19:40首件拍品前播放B04《命运拍卖规则》（0:42）；20:28索恩正式登台时播A02撒游戏券段。21:07播放A04数字演示；21:13播放A05发现遗体。
4. 22:40六组到齐后播放B05《最后的庭审规则》（1:23）。各组选代表上台推凶、质疑证人。后续真相及遗言按播控页的阶段和勾选条件播放。

## 播控与文件

双击`现场播放台.html`，保持目录结构；该页只供GM与音控使用，不能投屏或发给玩家。所有MP3成片已合成固定角色配音、下载的背景音乐和音效，无需另放BGM。当前版本有效成片{len(active)}段；旧A01、A03、A09仅作留档，现场不用。`无损母带_WAV`、`制作分轨`、`字幕与走位`、`证据纯人声`和`配乐与音效`供排练、剪辑及核对。

A06须取得E-07；A07为证据齐备后的可选证言；A10须在庭审和指控结束后才可播，A11须在E-26开放后才可播。A11是剧情遗言的视频环节音频替代版。A04保持21:07的声音演示，A05保持21:13发现遗体，前段不得揭露预录或凶手。

开演前使用现场音响试听B02、B03、A02和A10，核对投影、演员走位与撒券动作。配乐作者、授权与现场署名要求见`配乐来源与署名.md`。
'''
(OUT/'使用说明_先读.md').write_text(readme)

player='''<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>阿拉斯加之夜 · 现场音控</title>
<style>*{box-sizing:border-box}body{margin:0;background:#10171c;color:#ece8dd;font:16px/1.65 system-ui,sans-serif}main{max-width:1180px;margin:auto;padding:46px 26px 220px}small,.dim{color:#9aabb2}h1{font-size:36px;letter-spacing:3px;margin:8px 0}h2{font-size:19px;margin:3px 0 8px}.gold{color:#d9b879}.intro{max-width:800px}label{display:block;margin:10px 0}select,button{font:inherit;border:1px solid #45606c;border-radius:7px;color:#f4eee2;background:#1c2b34;padding:10px 16px;cursor:pointer}select{min-width:240px}button.play{background:#d9b879;color:#15212a;border:0;font-weight:700}button:disabled{background:#29353b;color:#75828a;cursor:not-allowed}button:hover:enabled{filter:brightness(1.13)}.controls{background:#17232a;padding:20px;border-radius:10px;margin:26px 0}.grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:15px}.card{border:1px solid #33454e;border-radius:9px;padding:20px;background:#152129}.card.active{border-color:#d9b879}.card p{font-size:14px;margin:8px 0;color:#b5c1c5}.card .top{display:flex;justify-content:space-between}.card details{font-size:13px;color:#b8c0c3}.footer{padding:24px 0;font-size:13px;color:#96a5ab}.footer a{color:#d9b879}.dock{position:fixed;bottom:0;width:100%;background:#0e181fee;border-top:1px solid #57707c;padding:16px 26px;backdrop-filter:blur(10px)}.dockinner{max-width:1128px;margin:auto}.dockrow{display:flex;align-items:center;gap:14px;justify-content:space-between}audio{width:100%;height:38px;margin-top:8px}#status{color:#d9b879}#cue{font-size:14px;min-height:23px}#error{color:#ffc4b2}@media(max-width:700px){.grid{grid-template-columns:1fr}main{padding:24px 16px 240px}h1{font-size:26px}.dock{padding:12px 16px}.dockrow{flex-wrap:wrap}}</style>
<main><small class="gold">THORNE MANOR / 2026.10.31 / 仅供GM与音控</small><h1>阿拉斯加之夜 · 现场演绎</h1><p class="intro dim">每个声音都有来处，每一段剧情按现场节奏开启。选好阶段后点击对应段落；一段结束即停止，不自动播放下一段。完整目录含真相，请勿向玩家投屏或分发。</p>
<section class="controls"><label for="phase">当前流程</label><select id="phase"><option value="0">入场 / 宴会 / 案发</option><option value="1">第一、二轮调查</option><option value="2">深度调查（22:15）</option><option value="3">模拟庭审（22:40）</option><option value="4">真相与遗言（23:15之后）</option></select>
<label><input id="memory" type="checkbox"> 已取得E-07，允许播放瑟琳娜录音</label><label><input id="testimony" type="checkbox"> 已取得A07所列全部证据，启用可选证言演绎</label><label><input id="truth" type="checkbox"> 庭审、指控与投票已封存，GM允许真相重建</label><label><input id="will" type="checkbox"> 真相揭露已结束，E-26已开放，GM允许遗言</label></section>
<div id="tracks" class="grid"></div><section class="footer"><p>所有角色语音：MiniMax speech-2.8-hd系统音色。剧中“真人录音”为虚构来源设定，现实文件均为AI演绎。</p><p>Music: “Danse Macabre”, “Darkest Child”, “Awkward Meeting”, “Long note One”, “At Rest” by Kevin MacLeod (<a href="https://incompetech.com/">incompetech.com</a>). Licensed under <a href="https://creativecommons.org/licenses/by/4.0/">Creative Commons Attribution 4.0</a>. Edited, looped, faded and mixed with dialogue. Danse Macabre composed by Camille Saint-Saëns. SFX by <a href="https://kenney.nl/">Kenney</a>, CC0.</p><p>配乐来源、完整署名及使用说明随包附上。请在现场节目单或片尾保留署名。</p></section></main>
<aside class="dock"><div class="dockinner"><div class="dockrow"><div id="status">未播放 · 选择一段开始</div><div><button id="pause">播放 / 暂停</button> <button id="stop">立即停止</button></div></div><audio id="audio" controls preload="none"></audio><div id="cue">动作提示将在播放时出现。</div><div id="error" role="alert"></div></div></aside>
<script>const tracks=__TRACKS__;const $=id=>document.getElementById(id);const audio=$('audio');let current=null;const stage={B01:0,B02:0,B03:0,B04:0,A02:0,A04:0,A05:0,A06:2,A07:2,A08:2,B05:3,A10:4,A11:4,A12:4};const fmt=n=>Math.floor(n/60).toString().padStart(2,'0')+':'+Math.floor(n%60).toString().padStart(2,'0');
function permitted(t){return +$('phase').value>=stage[t.id]&&(t.id!=='A06'||$('memory').checked)&&(t.id!=='A07'||$('testimony').checked)&&(t.id!=='A10'||$('truth').checked)&&(t.id!=='A11'||($('truth').checked&&$('will').checked));}
function stop(){audio.pause();audio.currentTime=0;$('cue').textContent='已停止；每段均需手动启动。';$('status').textContent=current?current.id+' '+current.title+' · 已停止':'未播放';}
function render(){ $('tracks').innerHTML=tracks.map(t=>`<article class="card ${current?.id===t.id?'active':''}"><div class="top"><small class="gold">${t.id} · ${t.stage}</small><small>${fmt(t.duration)}</small></div><h2>${t.title}</h2><p>${t.trigger}</p><button class="play" data-id="${t.id}" ${permitted(t)?'':'disabled'}>${permitted(t)?'播放这一段':'等待阶段 / 条件解锁'}</button>${t.id==='B02'?'<p><a href="万圣节图文/B02_阿拉斯加万圣节之夜_投屏版.mp4" target="_blank" style="color:#d9b879">打开投屏视频（含同一配音和配乐）</a></p>':''}<details><summary>导演提示与配乐</summary><p>${t.notes}</p><p>配乐：${t.musicSource}</p></details></article>`).join('');document.querySelectorAll('[data-id]').forEach(b=>b.onclick=()=>play(tracks.find(t=>t.id===b.dataset.id)));}
async function play(t){if(!permitted(t))return;audio.pause();current=t;audio.src=new URL(t.file,document.baseURI).href;$('error').textContent='';render();try{await audio.play();$('status').textContent=t.id+' '+t.title+' · 播放中';}catch(e){$('error').textContent='未能开始播放，请使用下方音频控件，或直接打开对应MP3。';}}
for(const id of ['phase','memory','testimony','truth','will'])$(id).onchange=()=>{if(current&&!permitted(current)){stop();current=null;audio.removeAttribute('src');audio.load();$('status').textContent='阶段已调整 · 当前音频已停止';}render();};
$('stop').onclick=stop;$('pause').onclick=()=>{if(!current||!permitted(current))return;if(audio.paused)audio.play().catch(()=>{$('error').textContent='请用音频控件重试。';});else audio.pause();};
audio.onpause=()=>{if(current)$('status').textContent=current.id+' '+current.title+' · 已暂停';};audio.onplay=()=>{if(current)$('status').textContent=current.id+' '+current.title+' · 播放中';};audio.onended=()=>{$('status').textContent=current.id+' '+current.title+' · 播放完毕，等待下一次手动启动';};audio.onerror=()=>{$('error').textContent='音频未找到或无法播放。请先解压完整目录，并保持文件结构。';};
audio.ontimeupdate=()=>{if(!current)return;const next=current.events.find(e=>e.time>=audio.currentTime&&e.time<audio.currentTime+5);const active=current.events.find(e=>e.time<=audio.currentTime&&e.time>audio.currentTime-6);const cue=active||next;$('cue').textContent=cue?fmt(cue.time)+' '+cue.instruction:fmt(audio.currentTime)+' / '+fmt(current.duration)+' · 按台词与演员节奏执行';};render();</script></html>'''
player=player.replace('__TRACKS__',json.dumps(active,ensure_ascii=False).replace('</','<\\/'))
(OUT/'现场播放台.html').write_text(player)

intro='''# 本次交付更新：现场演绎音频（2026-10-15）

现场播控升级为14段有效成片，新增约两分钟的来由故事、约三分钟的万圣节六画面投屏视频、六位人物出场、拍卖规则和六组庭审规则。旧A01、A03、A09仅留档，不在播控页显示。所有新增成片均有固定角色音色、下载的配乐和音效混音。

先读“现场演绎音频/使用说明_先读.md”，音控双击“现场演绎音频/现场播放台.html”。便携分发版见“现场演绎音频_完整制作交付包.zip”。

本轮更新面向现场活动音频交付，未将终局音频放入玩家公开网站。原演员、3D、二维码等压缩包仍保留原有范围；现场音频使用本次独立音频包。

原手册“23:35真实遗言录像”环节，本轮可使用A11音频替代；未新增真人视频。A10为终局重建，严禁在调查前播放。A04维持21:07既定演示与时间误认诡计。B02投屏视频见“现场演绎音频/万圣节图文/”。
'''
(BASE/'本次交付更新_现场音频.md').write_text(intro)
manual=BASE/'演员与主持执行手册.md'
text=manual.read_text();marker='## 2026-10-15 现场音频执行补充'
if marker not in text:
 text+='\n\n'+marker+'\n\n新增12段现场演绎音频。音控先读`现场演绎音频/使用说明_先读.md`并打开`现场演绎音频/现场播放台.html`。A02配合索恩开场撒游戏券；A04在21:07播放，索恩不得真人出场；A05在21:13发现已倒地的索恩；A10仅在庭审结束后作行凶重建；A11为E-26真实遗言的音频替代版，安排于23:35。完整台词、实际播放时长及动作点详见音频目录，剧情时间线以`server/story-materials.json`为当前统一口径。每段结束自动停住，等待GM推进。\n'
 manual.write_text(text)
append='## 2026-10-15 扩展版演绎流程\n\n19:00左右按B01背景故事、B02万圣节六画面投屏、B03六位NPC入场；19:40首件拍品前播B04拍卖规则；20:28索恩正式登台时播A02撒游戏券；22:40六组到齐后播B05庭审规则。旧A01、A03、A09不再现场使用。B02投屏MP4已含旁白与配乐，不要与B02 MP3叠放；B03演员随固定角色配音走位和表演，不必开口。具体台词与动作点见现场音频目录。\n'
text=text.split('## 2026-10-15 扩展版演绎流程')[0].rstrip()
manual.write_text(text+'\n\n'+append)
print('Player, scripts, cue list, attribution and delivery notes written.')
