"""Build a self-contained GM/NPC briefing with verified links to the live clue site."""
from pathlib import Path
import json
from bs4 import BeautifulSoup
from PIL import Image

ROOT=Path(__file__).resolve().parents[1]
BASE=ROOT/'交付包_阿拉斯加之夜'
OUT=BASE/'导演速览'/'案情与NPC速览.html'
live=json.loads((BASE/'导演速览'/'线上线索索引_2026-10-18.json').read_text())
groups={
 '时间诡计':['E-05','E-08','E-11','E-15','E-16','E-22'],
 '现场与通行':['E-03','E-04','E-06','E-13','E-14','E-17','E-19','E-20','E-23'],
 '动机与关系':['E-01','E-07','E-10','E-12','E-18'],
 '其他嫌疑与排除':['E-02','E-09','E-21','E-24','E-25'],
 '终局':['E-26'],
}
purpose={
 'E-01':'索恩要暂停未授权模拟，构成冲突', 'E-02':'里昂有夺权动机，但不等于杀人',
 'E-03':'20:48索恩正常刷卡入室', 'E-04':'20:51—21:02无需普通刷卡',
 'E-05':'20:41已导出，21:07本地播放', 'E-06':'奖杯新破损，提示凶器',
 'E-07':'瑟琳娜生前反对商业复制', 'E-08':'伊芙琳21:03在舞台；不是20:58不在场证明',
 'E-09':'拍卖背景信息，不证明谁杀人', 'E-10':'索恩死前未确认则冻结90天',
 'E-11':'西奥多见伊芙琳约21:02到舞台', 'E-12':'索恩约伊芙琳20:55见面',
 'E-13':'头部钝伤，排除枪击', 'E-14':'创伤与奖杯底座相符',
 'E-15':'现场听到的索恩声音；不能单独证明存活', 'E-16':'21:07数字发言、21:13本人登台的原计划',
 'E-17':'奖杯纤维与伊芙琳披巾相连', 'E-18':'数字莉娅是伊芙琳真正牵挂',
 'E-19':'临时通行模式有正式审批', 'E-20':'东侧影像不覆盖西侧路线',
 'E-21':'西奥多有非法数据交易疑点', 'E-22':'21:09回复由自动代理发送',
 'E-23':'设备异常帮助校准死亡时间', 'E-24':'里昂20:58有视频不在场证明',
 'E-25':'克拉拉20:59在摄影区', 'E-26':'终局遗言；现场以A11音频替代',
}
index={e['id']:e for e in live['clues']}
assert set(index)==set(purpose)=={x for values in groups.values() for x in values}
evidence=[{**index[id], 'group':group,'purpose':purpose[id], 'url':f'https://alsj.luna.ski/ar?clue={id}'} for group,ids in groups.items() for id in ids]
data=json.dumps(evidence,ensure_ascii=False).replace('<','\\u003c').replace('</','<\\/')

html=r'''<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<meta name="color-scheme" content="dark"><title>阿拉斯加之夜｜案情与 NPC 速览</title>
<style>
:root{--bg:#081319;--panel:#101f28;--panel2:#142934;--line:#29434c;--text:#ecede8;--muted:#a9bac0;--gold:#deb977;--teal:#79c4c4;--red:#f2a99d}
*{box-sizing:border-box}html{scroll-behavior:smooth}body{margin:0;background:var(--bg);color:var(--text);font:16px/1.72 -apple-system,BlinkMacSystemFont,"PingFang SC","Microsoft YaHei",sans-serif}a{color:var(--gold)}button,input{font:inherit}button{cursor:pointer}body[data-mode="public"] [data-spoiler]{display:none!important}
.shell{width:min(1180px,calc(100% - 40px));margin:auto}.top{position:sticky;top:0;z-index:30;border-bottom:1px solid #395059;background:#09171de9;backdrop-filter:blur(15px)}.top-inner{display:flex;align-items:center;gap:24px;min-height:64px}.brand{font-family:Georgia,"Times New Roman",serif;font-size:19px;letter-spacing:.1em;color:var(--gold);white-space:nowrap}.top nav{display:flex;gap:16px;overflow:auto;scrollbar-width:none;flex:1}.top nav a{color:#bfd0cf;text-decoration:none;white-space:nowrap;font-size:13px}.top nav a:hover{color:#fff}.mode{display:flex;gap:4px;border:1px solid #45616b;border-radius:999px;padding:3px;white-space:nowrap}.mode button{border:0;border-radius:999px;background:transparent;color:#b4c5ca;padding:5px 12px;font-size:12px}.mode button[aria-pressed="true"]{background:var(--gold);color:#10212a;font-weight:750}
.hero{min-height:420px;display:flex;align-items:end;background:linear-gradient(90deg,#07131be8 0%,#08171cb8 45%,#08171c60 100%),url('../现场演绎音频/万圣节图文/画面/01_极光庄园.png') center 47%/cover;border-bottom:1px solid #34515a}.hero-inner{padding:70px 0 48px}.eyebrow{color:var(--gold);font-size:12px;letter-spacing:.22em;text-transform:uppercase;font-weight:750}.hero h1{font-family:Georgia,"Songti SC","STSong",serif;font-size:clamp(36px,5vw,64px);line-height:1.16;letter-spacing:.06em;max-width:790px;margin:14px 0 18px}.hero p{max-width:720px;color:#d2dedf;font-size:18px}.hero-actions{display:flex;flex-wrap:wrap;gap:10px;margin-top:25px}.btn{display:inline-flex;align-items:center;justify-content:center;gap:7px;border:1px solid #5f7e86;border-radius:8px;padding:10px 15px;background:#0e252e;color:#eaf4f1;text-decoration:none;font-size:14px}.btn.primary{background:var(--gold);color:#12202a;border-color:var(--gold);font-weight:750}.btn:hover{filter:brightness(1.13)}.notice{border-left:3px solid var(--gold);background:#15262c;padding:14px 18px;margin:24px 0 0;color:#d0dfdc}.notice strong{color:#fff}
main{padding:24px 0 90px}section{scroll-margin-top:86px;margin:38px 0 66px}.section-head{display:flex;align-items:baseline;justify-content:space-between;gap:20px;border-bottom:1px solid var(--line);padding-bottom:12px;margin-bottom:20px}.section-head h2{font-size:26px;line-height:1.3;margin:0;letter-spacing:.03em}.section-head small{color:var(--gold);font-size:12px;letter-spacing:.1em}.lede{font-size:19px;line-height:1.78;max-width:920px;color:#dce5e2}.muted{color:var(--muted)}.grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:14px}.card{background:linear-gradient(155deg,var(--panel2),var(--panel));border:1px solid var(--line);border-radius:12px;padding:20px;min-width:0}.card h3{margin:3px 0 9px;font-size:18px;color:#fff}.card p{margin:5px 0}.card .num{font-size:12px;color:var(--gold);letter-spacing:.15em;font-weight:750}.card .key{color:var(--teal);font-weight:700}.compact p{font-size:14px}.pill{display:inline-block;border-radius:999px;border:1px solid #607983;color:#d4e4e3;padding:2px 9px;font-size:12px;margin:0 5px 5px 0}.pill.alert{border-color:#8f6264;color:#ffc4b8}.pill.gold{border-color:#9e8150;color:#f4d49a}
.strip{display:flex;gap:12px;flex-wrap:wrap}.strip .card{flex:1 1 180px}.strip strong{color:var(--gold);display:block}.map-wrap{overflow:auto;border:1px solid var(--line);border-radius:14px;background:radial-gradient(circle at 50% 40%,#183641,#0b1b23 70%)}.map-svg{width:100%;min-width:880px;height:auto;display:block}.map-svg line{stroke:#689ca0;stroke-width:2}.map-svg line.secret{stroke:#c98a7d;stroke-width:2;stroke-dasharray:7 6}.map-svg .node rect{fill:#142c35;stroke:#5a878c;stroke-width:1.3;rx:12}.map-svg .node.gold rect{fill:#3a2e23;stroke:#c39b5f}.map-svg .node.red rect{fill:#3c2428;stroke:#bd827e}.map-svg .node text{fill:#f4f0e8;font-size:17px;font-weight:700;text-anchor:middle}.map-svg .node .sub{fill:#b7cbd0;font-size:12px;font-weight:400}.map-svg .edge-label{fill:#b8cbc9;font-size:12px;text-anchor:middle}.map-svg .edge-label.secret{fill:#f2b6a9}.legend{font-size:13px;color:#afc2c1;margin-top:10px}.line-example{display:inline-block;width:25px;border-top:2px solid #689ca0;vertical-align:middle;margin:0 5px 0 12px}.line-example.secret{border-color:#c98a7d;border-top-style:dashed}
.table-wrap{overflow:auto;border:1px solid var(--line);border-radius:12px}table{border-collapse:collapse;width:100%;min-width:720px;background:#0e2029}th,td{padding:12px 15px;text-align:left;vertical-align:top;border-bottom:1px solid #25414a}th{background:#19313a;color:var(--gold);font-size:13px}td{font-size:14px}tr:last-child td{border-bottom:0}tr:hover td{background:#17303a}.time{color:var(--gold);white-space:nowrap;font-variant-numeric:tabular-nums}.secret-copy{color:#f1c7bb}.truth{padding:24px;border:1px solid #8c625c;border-radius:12px;background:#2c2225}.truth strong{color:#ffcfbb}.truth p{margin:9px 0}.role-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.role-head{display:flex;justify-content:space-between;gap:12px;align-items:start}.role-head h3{margin:0}.role-grid .card{min-height:205px}.role-grid .private{border-top:1px dashed #73575a;margin-top:13px;padding-top:12px;color:#f0c9bf}.role-grid small{color:var(--gold)}.role-grid p{font-size:14px}.callout{padding:16px 20px;border:1px solid #466a71;border-radius:10px;background:#12303a;color:#d8e7e5}
.red-grid{display:grid;grid-template-columns:repeat(2,minmax(0,1fr));gap:14px}.red-grid .card{border-color:#6d4e4d}.red-grid b{color:#ffc2b3}.red-grid .fix{color:#a7ddd4}.evidence-toolbar{display:flex;flex-wrap:wrap;gap:10px;align-items:center;margin-bottom:18px}.evidence-toolbar input{background:#0e242d;color:#fff;border:1px solid #56727a;border-radius:8px;padding:10px 13px;min-width:250px;flex:1}.filters{display:flex;flex-wrap:wrap;gap:6px}.filters button{border:1px solid #52717a;background:#152f39;color:#d6e7e4;border-radius:999px;padding:7px 11px;font-size:12px}.filters button.active{background:var(--gold);color:#10212a;border-color:var(--gold)}.evidence-grid{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:10px}.evidence{display:block;text-decoration:none;background:#102631;border:1px solid #36535b;border-radius:10px;padding:13px 15px;color:#edf0eb}.evidence:hover{border-color:var(--gold);transform:translateY(-2px)}.evidence .id{font-size:12px;color:var(--gold);font-weight:750}.evidence .title{font-size:15px;font-weight:750;margin-top:3px}.evidence .area{font-size:12px;color:#adc0c3}.evidence .purpose{font-size:13px;color:#bed0ce;margin-top:6px}.evidence .arrow{float:right;color:var(--gold)}#count{color:var(--muted);font-size:13px}.footer{border-top:1px solid var(--line);padding:30px 0 55px;color:#a6b9bb;font-size:13px}.footer a{color:var(--gold)}
@media(max-width:850px){.top-inner{flex-wrap:wrap;padding:9px 0}.top nav{order:3;width:100%;flex-basis:100%}.mode{margin-left:auto}.grid,.evidence-grid{grid-template-columns:repeat(2,minmax(0,1fr))}.hero{min-height:360px}}@media(max-width:620px){.shell{width:min(100% - 28px,1180px)}.hero h1{font-size:34px}.hero p{font-size:16px}.grid,.role-grid,.red-grid,.evidence-grid{grid-template-columns:1fr}.section-head h2{font-size:23px}.top nav{gap:12px}.top nav a{font-size:12px}}
@media print{.top,.hero-actions,.evidence-toolbar{display:none!important}body{background:#fff;color:#111}.hero{background:none;min-height:0;color:#111}.hero h1{color:#111}.hero p{color:#333}.card,.truth,.table-wrap{break-inside:avoid}}
</style></head><body data-mode="public">
<header class="top"><div class="shell top-inner"><div class="brand">THORNE / NPC BRIEF</div><nav aria-label="章节导航"><a href="#story">故事</a><a href="#map">关系</a><a href="#roles">人物</a><a href="#timeline">时间线</a><a href="#misdirection" data-spoiler>误导线索</a><a href="#evidence" data-spoiler>线上证据</a><a href="#run">现场流程</a></nav><div class="mode" aria-label="信息层级"><button id="publicMode" type="button" aria-pressed="true">公开速览</button><button id="gmMode" type="button" aria-pressed="false">GM 全案</button></div></div></header>
<div class="hero"><div class="shell hero-inner"><div class="eyebrow">阿拉斯加之夜 · 最后的遗嘱 / 内部导览</div><h1>先看懂故事，再演好每个角色。</h1><p>一份给 GM 与 NPC 排练用的结构化案情文件。公开速览只显示开场可说的信息；切换“GM 全案”后显示真相、误导线索和 26 条线上证据。</p><div class="hero-actions"><a class="btn primary" href="#story">从故事开始 ↓</a><a class="btn" href="../现场演绎音频/现场播放台.html">打开音频播控台 ↗</a><a class="btn" href="https://alsj.luna.ski/" target="_blank" rel="noopener noreferrer">打开活动网站 ↗</a></div><div class="notice"><strong>使用边界：</strong>本页是内部培训资料。NPC 按本人角色卡掌握秘密，不向玩家分享此页；公开介绍可使用页面末尾的话术。</div></div></div>
<main class="shell">
<section id="story"><div class="section-head"><h2>01 · 故事从哪里开始</h2><small>基础故事 / 四个动作</small></div><p class="lede">万圣节夜，受邀宾客来到阿拉斯加深处的索恩庄园。主人阿德里安·索恩创办的 ADS 公司研发了 ECHO：一种能用逝者资料模拟其声音和回答的系统。他承诺在午夜前说明一件重要的事。晚宴先有拍卖、交谈与秘密委托；随后一宗命案把每位来客卷入调查。</p><div class="strip"><div class="card"><span class="num">01 / 来到庄园</span><strong>认识人</strong><p>万圣节、面具、ECHO、索恩与瑟琳娜的过去。</p></div><div class="card"><span class="num">02 / 拍卖晚宴</span><strong>争取资源</strong><p>竞价、交谈、积累各自的关系和疑点。</p></div><div class="card"><span class="num">03 / 命案调查</span><strong>拼证据</strong><p>六组搜证、验尸、核对时间、质询 NPC。</p></div><div class="card"><span class="num">04 / 庭审与结尾</span><strong>给出判断</strong><p>指认凶手后，讨论数字人格的未来。</p></div></div><div class="truth" data-spoiler style="margin-top:18px"><span class="num">GM 核心真相</span><p><strong>伊芙琳是唯一凶手。</strong>她为保护亡女莉娅的数字人格，于约20:58在档案室用《极光之眼》奖杯袭击索恩。21:07的“索恩发言”是索恩自己事先安排的 ECHO 演示，不能证明他那时还活着。门禁在20:51—21:02临时免刷卡，所谓密室也只是误读。</p><p>索恩原要公开 ECHO 的技术局限与未授权数据问题，并暂停相关模拟。按故事中的 ADS 内部协议，他若在最终确认前死亡，处置程序冻结90天；伊芙琳因此获得保住数字莉娅的机会。<strong>凶手没有临时伪造21:07录音，她利用了原有演出安排。</strong></p></div></section>
<section id="map"><div class="section-head"><h2>02 · 人物关系图谱</h2><small>先看公开关系，再看隐藏冲突</small></div><div class="map-wrap"><svg class="map-svg" viewBox="0 0 1060 530" role="img" aria-label="庄园人物与ECHO的关系图">
<line x1="531" y1="174" x2="531" y2="108"/><line x1="459" y1="220" x2="210" y2="117"/><line x1="155" y1="138" x2="145" y2="380"/><line x1="600" y1="74" x2="845" y2="108"/><line x1="498" y1="263" x2="340" y2="390"/><line x1="552" y1="275" x2="540" y2="395"/><line x1="604" y1="257" x2="760" y2="390"/>
<g data-spoiler><line class="secret" x1="920" y1="140" x2="930" y2="370"/><line class="secret" x1="839" y1="139" x2="610" y2="200"/><line class="secret" x1="518" y1="265" x2="340" y2="390"/></g>
<text class="edge-label" x="405" y="150">恋人</text><text class="edge-label" x="168" y="265">好友</text><text class="edge-label" x="692" y="67">研发</text><text class="edge-label" x="610" y="342">主持</text><g data-spoiler><text class="edge-label secret" x="763" y="183">最终冲突</text><text class="edge-label secret" x="956" y="265">母女</text></g>
<g class="node" transform="translate(435 20)"><rect width="190" height="82"/><text x="95" y="33">ADS / ECHO</text><text class="sub" x="95" y="57">数字人格项目</text></g>
<g class="node" transform="translate(55 65)"><rect width="190" height="78"/><text x="95" y="32">瑟琳娜</text><text class="sub" x="95" y="56">已故摄影师</text></g>
<g class="node gold" transform="translate(435 180)"><rect width="190" height="90"/><text x="95" y="36">索恩</text><text class="sub" x="95" y="62">庄园主人 / 创始人</text></g>
<g class="node red" transform="translate(815 65)"><rect width="190" height="78"/><text x="95" y="32">伊芙琳</text><text class="sub" x="95" y="56">首席人格架构师</text></g>
<g class="node" transform="translate(45 380)"><rect width="185" height="78"/><text x="92" y="32">克拉拉</text><text class="sub" x="92" y="56">策展人 / 瑟琳娜好友</text></g>
<g class="node" transform="translate(255 390)"><rect width="180" height="78"/><text x="90" y="32">里昂</text><text class="sub" x="90" y="56">财务总监</text></g>
<g class="node" transform="translate(450 395)"><rect width="180" height="78"/><text x="90" y="32">西奥多</text><text class="sub" x="90" y="56">拍卖师 / 主持</text></g>
<g class="node" transform="translate(650 390)"><rect width="180" height="78"/><text x="90" y="32">诺拉</text><text class="sub" x="90" y="56">合规顾问</text></g>
<g class="node" data-spoiler transform="translate(845 370)"><rect width="175" height="78"/><text x="87" y="32">莉娅</text><text class="sub" x="87" y="56">伊芙琳的女儿</text></g>
</svg></div><div class="legend"><span class="line-example"></span>开场可说的关系 <span data-spoiler><span class="line-example secret"></span>隐藏关系／冲突</span></div><p class="muted">记忆主线是<strong>索恩—瑟琳娜—克拉拉</strong>；商业主线是<strong>索恩—ADS—伊芙琳／里昂</strong>；调查与控场由<strong>诺拉、西奥多</strong>推进。</p><p data-spoiler class="callout"><strong>真正的对立：</strong>索恩和伊芙琳都因失去亲人依赖 ECHO。索恩因瑟琳娜的生前意愿决定停止未经授权的模拟，伊芙琳因数字莉娅不能接受。其他人的秘密制造嫌疑，但不改变唯一凶手。</p></section>
<section id="roles"><div class="section-head"><h2>03 · 六位 NPC 速记卡</h2><small>公开身份 / 本人秘密 / 演法</small></div><div class="role-grid">
<article class="card"><div class="role-head"><h3>阿德里安·索恩</h3><small>主人 / 死者</small></div><p><span class="key">公开：</span>ADS创始人、庄园主人，瑟琳娜的旧爱；承诺当晚回答 ECHO 的问题。</p><p><span class="key">演法：</span>先自信迎宾，谈到“保存声音”时流露疲惫；20:48离开人群，21:13以已经倒地的状态被发现。</p><p class="private" data-spoiler><b>本人秘密：</b>准备承认未经授权数据问题、暂停部分模拟；21:07演示由自己事先安排。不能在21:13作为活人突然倒下。</p></article>
<article class="card"><div class="role-head"><h3>伊芙琳·维尔</h3><small>ECHO架构师</small></div><p><span class="key">公开：</span>项目技术负责人，与索恩合作密切；重视数字人格的价值。</p><p><span class="key">演法：</span>冷静、专业，质询时要求别人拿出可核对的时间与物证。</p><p class="private" data-spoiler><b>本人秘密：</b>唯一凶手；为保住数字莉娅，20:55进档案室，约20:58用奖杯袭击索恩，21:01离开。最初可强调自己21:03在舞台，但不能声称有20:58的不在场证明。</p></article>
<article class="card"><div class="role-head"><h3>诺拉·里德</h3><small>合规顾问</small></div><p><span class="key">公开：</span>外聘安全合规顾问，关注权限和现场秩序。</p><p><span class="key">演法：</span>前段低调；发现遗体后控制现场、引导六组按证据调查。</p><p class="private" data-spoiler><b>本人秘密：</b>真实身份是 FBI 特别探员。她知道20:51—21:02的安全通行设置，但不是凶手身份的全知证人；按阶段公开身份和门禁事实。</p></article>
<article class="card"><div class="role-head"><h3>里昂·默瑟</h3><small>财务总监</small></div><p><span class="key">公开：</span>替 ADS 处理资本与财务，与索恩存在商业分歧。</p><p><span class="key">演法：</span>被怀疑时承认利益冲突，但坚持“想夺权不等于杀人”。</p><p class="private" data-spoiler><b>本人秘密：</b>筹划董事会夺权；20:55—21:04在交易室参加视频会议，20:58有可核对的不在场证明。E-02制造嫌疑，E-24排除直接行凶。</p></article>
<article class="card"><div class="role-head"><h3>西奥多·布莱克</h3><small>拍卖师 / 主持</small></div><p><span class="key">公开：</span>主持拍卖与晚宴，善于把物品和秘密变成交易。</p><p><span class="key">演法：</span>保持场面节奏；庭审时限制陈述时间，让问题回到证据。</p><p class="private" data-spoiler><b>本人秘密：</b>知道21:07声音是预制演示，约21:02见伊芙琳到舞台；另有私人数据交易。害怕后台记录暴露，所以不会轻易主动交代全部。</p></article>
<article class="card"><div class="role-head"><h3>克拉拉·沃克</h3><small>策展人</small></div><p><span class="key">公开：</span>瑟琳娜的朋友，负责庄园照片展；希望来宾认真看待瑟琳娜的作品。</p><p><span class="key">演法：</span>在艺术与记忆问题上有情绪，但回答行踪时保持具体。</p><p class="private" data-spoiler><b>本人秘密：</b>保管瑟琳娜的生前录音和拒绝商业复制的授权声明；20:56经过东侧走廊，20:59在摄影区有记录，并非杀人者。</p></article>
</div></section>
<section id="timeline"><div class="section-head"><h2>04 · 当晚时间线</h2><small>用统一时钟记，不要临场改动</small></div><div class="table-wrap"><table><thead><tr><th>时间</th><th>玩家可见的活动</th><th data-spoiler>GM 真实事件</th><th data-spoiler>关键线上线索</th></tr></thead><tbody>
<tr><td class="time">19:00</td><td>签到、背景故事、万圣节投屏、人物登场</td><td data-spoiler>六名 NPC 与玩家建立关系</td><td data-spoiler>开场不释放案发结论</td></tr>
<tr><td class="time">19:40</td><td>私人拍卖开始</td><td data-spoiler>西奥多主持，商业与私人矛盾浮现</td><td data-spoiler><a href="https://alsj.luna.ski/ar?clue=E-09" target="_blank" rel="noopener noreferrer">E-09 拍卖档案</a></td></tr>
<tr><td class="time">20:28</td><td>索恩登台，承诺稍后给答案</td><td data-spoiler>他准备公开ECHO问题</td><td data-spoiler><a href="https://alsj.luna.ski/ar?clue=E-01" target="_blank" rel="noopener noreferrer">E-01 处置声明</a></td></tr>
<tr><td class="time">20:41—20:48</td><td>索恩离开主要活动区域</td><td data-spoiler>20:41语音文件导出；20:45约伊芙琳；20:48索恩刷卡入档案室</td><td data-spoiler><a href="https://alsj.luna.ski/ar?clue=E-05" target="_blank" rel="noopener noreferrer">E-05</a> / <a href="https://alsj.luna.ski/ar?clue=E-12" target="_blank" rel="noopener noreferrer">E-12</a> / <a href="https://alsj.luna.ski/ar?clue=E-03" target="_blank" rel="noopener noreferrer">E-03</a></td></tr>
<tr><td class="time">20:51—21:02</td><td>后台区域看似平静</td><td data-spoiler class="secret-copy">档案室临时安全通行。伊芙琳20:55进入，约20:58袭击索恩，21:01离开</td><td data-spoiler><a href="https://alsj.luna.ski/ar?clue=E-04" target="_blank" rel="noopener noreferrer">E-04</a> / <a href="https://alsj.luna.ski/ar?clue=E-17" target="_blank" rel="noopener noreferrer">E-17</a></td></tr>
<tr><td class="time">21:02—21:05</td><td>宾客等待演示</td><td data-spoiler>西奥多约21:02见伊芙琳；21:03舞台照片拍到她；21:05档案室静默锁闭</td><td data-spoiler><a href="https://alsj.luna.ski/ar?clue=E-11" target="_blank" rel="noopener noreferrer">E-11</a> / <a href="https://alsj.luna.ski/ar?clue=E-08" target="_blank" rel="noopener noreferrer">E-08</a></td></tr>
<tr><td class="time">21:07</td><td>全场听见索恩说话</td><td data-spoiler class="secret-copy">预制 ECHO 文件播放，不是实时发言</td><td data-spoiler><a href="https://alsj.luna.ski/ar?clue=E-05" target="_blank" rel="noopener noreferrer">E-05</a> / <a href="https://alsj.luna.ski/ar?clue=E-16" target="_blank" rel="noopener noreferrer">E-16</a></td></tr>
<tr><td class="time">21:13—22:40</td><td>发现遗体；六组调查、问证人</td><td data-spoiler>还原死亡时间、破除门禁与语音误读</td><td data-spoiler><a href="https://alsj.luna.ski/ar?clue=E-13" target="_blank" rel="noopener noreferrer">E-13</a> / <a href="https://alsj.luna.ski/ar?clue=E-14" target="_blank" rel="noopener noreferrer">E-14</a></td></tr>
<tr><td class="time">22:40—23:15</td><td>六组庭审：陈述、质询、辩论</td><td data-spoiler>每组解释凶手、时间、语音、门禁、动机</td><td data-spoiler>完整证据链</td></tr>
<tr><td class="time">23:15 以后</td><td>公布真相、遗言、讨论 ECHO 去留</td><td data-spoiler>谋杀答案与伦理选择分开收束</td><td data-spoiler><a href="https://alsj.luna.ski/ar?clue=E-26" target="_blank" rel="noopener noreferrer">E-26 终局资料</a>（仅终局开放）</td></tr>
</tbody></table></div></section>
<section id="misdirection" data-spoiler><div class="section-head"><h2>05 · 虚假线索与误导点</h2><small>证据真实，错误来自解释</small></div><p class="lede">这里的“假线索”主要是<strong>真实资料被误读</strong>，或其他人物确有秘密却没有杀人。NPC 不必编造新证据；让玩家用另一条客观记录纠偏。</p><div class="red-grid">
<div class="card"><span class="num">误导 01 / 听见声音</span><h3>“索恩21:07还活着”</h3><p><b>表象：</b><a href="https://alsj.luna.ski/ar?clue=E-15" target="_blank" rel="noopener noreferrer">E-15</a>让全场听到他的声音。</p><p class="fix"><b>纠偏：</b>E-05证明20:41已导出并在21:07本地播放；E-16写着原定“数字发言后本人登台”。</p></div>
<div class="card"><span class="num">误导 02 / 门禁空白</span><h3>“没人刷卡，所以没人进出”</h3><p><b>表象：</b>E-03只记录索恩20:48入室。</p><p class="fix"><b>纠偏：</b>E-04、E-19说明20:51—21:02为免刷卡安全通行，东侧影像E-20也拍不到西侧通道。</p></div>
<div class="card"><span class="num">误导 03 / 舞台照片</span><h3>“伊芙琳有不在场证明”</h3><p><b>表象：</b>E-08显示她21:03站在西奥多旁边。</p><p class="fix"><b>纠偏：</b>死亡约在20:58；E-11还说明她约21:02才抵达舞台。照片不覆盖死亡时刻。</p></div>
<div class="card"><span class="num">误导 04 / 自动回复</span><h3>“21:09索恩还在发消息”</h3><p><b>表象：</b>索恩账户后来有文字回复。</p><p class="fix"><b>纠偏：</b>E-22指向ECHO自动代理，不是本人实时输入。</p></div>
<div class="card"><span class="num">误导 05 / 商业动机</span><h3>“里昂夺权，所以他杀人”</h3><p><b>表象：</b>E-02确实显示股权收购计划。</p><p class="fix"><b>纠偏：</b>E-24的交易室视频支持20:58不在场。动机不能代替作案机会。</p></div>
<div class="card"><span class="num">误导 06 / 其他秘密</span><h3>“克拉拉／西奥多隐瞒事实，就是凶手”</h3><p><b>表象：</b>克拉拉有瑟琳娜的声明；西奥多知晓预制演示且有数据交易。</p><p class="fix"><b>纠偏：</b>E-25支持克拉拉20:59在摄影区；西奥多的秘密解释沉默，却无法推翻伊芙琳的纤维、会面及时间证据。</p></div>
</div></section>
<section id="evidence" data-spoiler><div class="section-head"><h2>06 · 网站线索直达</h2><small>已核对 26 条线上编号</small></div><p>下方每条都打开 <a href="https://alsj.luna.ski/" target="_blank" rel="noopener noreferrer">alsj.luna.ski</a> 的公开 AR 线索入口。<strong>网站用 E-01～E-26；原手册／原始资料部分写 EV-001 等编号，顺序不同，现场请以这里的 E 编号为准。</strong>线索可见性与释放时机仍由 GM 控制，特别是 E-26。</p><div class="evidence-toolbar"><input id="evidenceSearch" type="search" aria-label="搜索线索编号或名称" placeholder="搜索 E-05、奖杯、伊芙琳…"><div class="filters" id="filters"></div></div><p id="count" aria-live="polite"></p><div class="evidence-grid" id="evidenceGrid"></div></section>
<section id="run"><div class="section-head"><h2>07 · NPC 现场该怎样配合</h2><small>流程与边界</small></div><div class="grid compact"><div class="card"><span class="num">开场</span><h3>只说公开身份</h3><p>B01交代来由、B02投屏讲背景、B03用固定音色介绍六位 NPC。真人随配音走位即可。</p></div><div class="card"><span class="num">拍卖与宴会</span><h3>有冲突，但不剧透</h3><p>19:40 B04介绍拍卖规则；20:28 A02索恩正式登台撒游戏券。让玩家从交谈察觉关系裂缝。</p></div><div class="card"><span class="num">命案之后</span><h3>以证据回答</h3><p>21:07 A04数字声音、21:13 A05发现遗体。六组轮换调查；NPC只说本人知道的事。</p></div><div class="card"><span class="num">庭审</span><h3>五问构成完整指控</h3><p>22:40 B05讲规则。各组陈述代表与质询代表上台，回答凶手、死亡时间与方式、语音、门禁、动机。</p></div><div class="card"><span class="num">评分</span><h3>总分 8 分</h3><p>凶手2、时间与死法1、语音2、门禁1、动机2。不要用单纯投票代替证据推理。</p></div><div class="card"><span class="num">终局</span><h3>真相后再谈伦理</h3><p data-spoiler>A10只在庭审封存后重建行凶；A11是原遗言视频环节的音频替代；A12引导选择 ECHO 去留。</p><p>所有音频按阶段手动触发，不连播。</p></div></div>
<div class="callout" style="margin-top:18px"><b>可对玩家直接说的开场：</b>今晚，你们受邀来到阿拉斯加深处的索恩庄园，参加万圣节晚宴与私人拍卖。庄园主人索恩承诺，在午夜前回答一个关于 ECHO 数字人格的重要问题。请认识在场人物，利用拍卖和交谈争取信息；当意外发生，你们将分成六组调查，并在最后的庭审中用证据说明自己的结论。</div><div class="hero-actions"><a class="btn" href="../现场演绎音频/使用说明_先读.md">音频执行说明</a><a class="btn" href="../现场演绎音频/人物出场走位卡_GM.md">NPC 走位卡</a><a class="btn" href="../演员与主持执行手册.md">完整主持手册</a><a class="btn" href="一页读懂_案情与游戏剧情_GM剧透.md">原案情 MD</a><a class="btn" href="人物关系图谱_GM剧透.md">原关系 MD</a></div></section>
</main><footer class="footer"><div class="shell">《阿拉斯加之夜：最后的遗嘱》内部速览 · 根据本地故事资料和2026-10-18实际可访问的线上线索整理。现场统一以GM确定的剧情时间线和证据释放为准。网站线索链接需联网；本页的故事、图谱和表格可离线阅读。</div></footer>
<script>
const evidence=__EVIDENCE_DATA__;
const body=document.body, pub=document.getElementById('publicMode'), gm=document.getElementById('gmMode');
function mode(value){body.dataset.mode=value;pub.setAttribute('aria-pressed',String(value==='public'));gm.setAttribute('aria-pressed',String(value==='gm'));if(value==='gm')renderEvidence();}
pub.onclick=()=>mode('public');gm.onclick=()=>mode('gm');
const grid=document.getElementById('evidenceGrid'),filters=document.getElementById('filters'),search=document.getElementById('evidenceSearch'),count=document.getElementById('count');
let group='全部';const groups=['全部',...new Set(evidence.map(x=>x.group))];
function renderEvidence(){filters.innerHTML=groups.map(x=>`<button type="button" data-group="${x}" class="${x===group?'active':''}">${x}</button>`).join('');for(const b of filters.querySelectorAll('button'))b.onclick=()=>{group=b.dataset.group;renderEvidence()};const q=search.value.trim().toLowerCase();const items=evidence.filter(x=>(group==='全部'||x.group===group)&&(!q||[x.id,x.title,x.area,x.purpose].join(' ').toLowerCase().includes(q)));grid.innerHTML=items.map(x=>`<a class="evidence" href="${x.url}" target="_blank" rel="noopener noreferrer"><span class="arrow">↗</span><div class="id">${x.id} · ${x.group}</div><div class="title">${x.title}</div><div class="area">${x.area}</div><div class="purpose">${x.purpose}</div></a>`).join('');count.textContent=`显示 ${items.length} / ${evidence.length} 条线索`;}
search.oninput=renderEvidence;renderEvidence();
</script></body></html>'''
OUT.write_text(html.replace('__EVIDENCE_DATA__',data))
print(OUT)

# The deployed route is authenticated. Generate separate bytes for GM and NPC:
# a visual toggle alone would leave spoilers in the NPC page source.
WEB=ROOT/'server'/'reading'
WEB.mkdir(parents=True,exist_ok=True)
with Image.open(BASE/'现场演绎音频'/'万圣节图文'/'画面'/'01_极光庄园.png') as image:
 image.thumbnail((1440,900));image.save(WEB/'hero.webp',quality=78,method=6)
for role in ('gm','npc'):
 soup=BeautifulSoup(OUT.read_text(),'html.parser')
 style=soup.find('style')
 style.string=style.string.replace("url('../现场演绎音频/万圣节图文/画面/01_极光庄园.png')","url('/reading/hero.webp')")
 for a in list(soup.find_all('a',href=True)):
  href=a['href']
  if href.startswith('../') or href.endswith('.md'):a.decompose()
 if role=='npc':
  for item in list(soup.select('[data-spoiler]')):item.decompose()
  for item in list(soup.find_all('script')):item.decompose()
  mode_box=soup.select_one('.mode')
  if mode_box:
   mode_box.clear();mode_box.string='NPC 公开速览'
  intro=soup.select_one('.hero-inner > p')
  intro.string='给 NPC 排练用的公开故事、人物关系、时间线和现场流程。你的个人秘密与专属任务请到管理后台查看本人角色卡。'
  for card in soup.select('.role-grid .card .private'):card.decompose()
  # A staff member can return to their own role card without gaining GM facts.
  link=soup.new_tag('a',href='/admin');link['class']='btn';link.string='查看本人角色卡 ↗'
  soup.select_one('.hero-actions').append(link)
  soup.title.string='阿拉斯加之夜｜NPC 公开速览'
 (WEB/f'brief-{role}.html').write_text(str(soup))
print('Deployed GM and NPC variants generated.')
