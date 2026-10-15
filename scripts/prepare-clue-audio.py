"""Prepare tier-specific fictional evidence performances from canonical clue text."""
from pathlib import Path
import hashlib,json
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'交付包_阿拉斯加之夜'/'线索配乐音频'
OUT.mkdir(parents=True,exist_ok=True)
S=json.loads((ROOT/'output/clue-audio/sources.json').read_text())
V=json.loads((ROOT/'交付包_阿拉斯加之夜/现场演绎音频/演绎制作源稿.json').read_text())['voices']
tracks=[]
def line(role,text,emotion='calm',reuse=None):
 d=dict(role=role,text=text,emotion=emotion)
 if reuse:d['reuse']=reuse
 return d
def title(n):return n['title'].replace('21:07','二十一点零七分').replace('21:03','二十一点零三分').replace('21:09','二十一点零九分').replace('90','九十')
def spoken(s):
 # Read compact log timestamps explicitly; keep the exact original text for fingerprinting.
 import re
 nums=['零','一','二','三','四','五','六','七','八','九']
 def number(n):
  n=int(n)
  return nums[n] if n<10 else ('十'+(nums[n%10] if n%10 else '')) if n<20 else nums[n//10]+'十'+(nums[n%10] if n%10 else '')
 def time(m):return number(m[1])+'点'+('零' if int(m[2])<10 else '')+number(m[2])+'分'+(number(m[3])+'秒' if m[3] else '')
 s=re.sub(r'(\d{2}):(\d{2})(?::(\d{2}))?',time,s)
 for a,b in [('THORNE_ECHO_DEMO_V7','索恩，伊寇演示，第七版'),('LIA_VALE_014','莉娅·维尔，零一四号档案'),('EVELYN VALE','伊芙琳·维尔'),('UNDER REVIEW','待审查'),('ACTIVE','运行中'),('ECHO','伊寇'),('ADS','艾迪艾斯'),('2024','二〇二四'),('2022','二〇二二年'),('2026','二〇二六年'),('90','九十'),('20:58','二十点五十八分')]:s=s.replace(a,b)
 return s.replace('——','，').replace('—','至').replace('/','或')
overrides={
 'E-02':[
  line('旁白','股权收购协议。根据协议内容进行角色演绎。'),
  line('里昂','我已经秘密联络投资人，准备启动董事会改选与股权收购。'),
 ],
 'E-07':[
  line('克拉拉','瑟琳娜生前授权声明。她生前明确表达过自己的意愿。'),
  line('瑟琳娜','我不同意在我死后，把我的私人记忆用于商业化复制我的人格。'),
 ],
 'E-09':[
  line('西奥多','拍卖物品档案。拍卖登记记载了一件古董手枪舞台模型。'),
 ],
 'E-11':[
  line('诺拉','西奥多，关于伊芙琳抵达舞台区域的时间，请补充。'),
  line('西奥多','我补充一下，伊芙琳大约在晚上九点零二分，才抵达舞台区域。'),
 ],
 'E-12':[
  line('旁白','索恩私人会面通知。晚上八点四十五分，索恩向伊芙琳发出通知。'),
  line('索恩','八点五十五分，到档案室来找我。十一点半之前，我会完成所有确认。关于莉娅，我很抱歉。',emotion='sad'),
 ],
 'E-15':[
  line('旁白','晚上九点零七分，主宴会厅音响中，响起了索恩的声音。以下为声音内容的演绎。'),
  line('索恩','西奥多，我知道你们都在等我。也知道今晚在座的许多人，都希望我说，是的。我们可以留下声音，留下一个人的习惯，留下他曾经讲过的故事。',reuse='A04_02_索恩.mp3'),
  line('索恩','可是，当你听见一个熟悉的声音，你真正听见的，究竟是那个人，还是自己最不愿放手的愿望？',reuse='A04_03_索恩.mp3'),
 ],
 'E-16':[
  line('旁白','数字人格演出脚本。'),
  line('西奥多','演出单上的安排是，晚上九点零七分，数字人格发言。九点十三分，索恩本人登台揭晓。'),
 ],
 'E-19':[
  line('旁白','安保例外审批单。按审批内容进行角色演绎。'),
  line('诺拉','我按演示要求，确认了晚上八点五十一分至九点零二分的临时安全通行。'),
 ],
 'E-20':[
  line('旁白','东侧走廊影像。晚上八点五十六分，克拉拉经过东侧走廊。影像未拍到她进入档案室。'),
 ],
 'E-21':[
  line('旁白','私人数据交易合同。依照合同所记内容，演绎如下陈述。'),
  line('西奥多','我从部分艾迪艾斯员工那里购买私人数据，再向富豪客户出售资料。'),
 ],
 'E-24':[
  line('旁白','里昂交易室视频记录。晚上八点五十五分至九点零四分，投资人视频会议进行中。'),
  line('诺拉','交易室影像和参会者证言，支持里昂在八点五十八分，仍然在室内。'),
 ],
 'E-25':[
  line('诺拉','克拉拉摄影区记录。记录中，克拉拉在什么时间出现在摄影区？'),
  line('旁白','晚上八点五十九分，克拉拉已经在摄影区，并留下可供核对的记录。'),
 ],
 'E-26':[
  line('旁白','索恩真实遗言视频，线索内容配音。该资料为预先录制的本人遗言，说明伊寇的局限、瑟琳娜的意愿，以及数字人格处置的动机。完整遗言由主持人在终局开放。'),
 ],
}
role_for={'E-01':'诺拉','E-04':'诺拉','E-10':'诺拉','E-13':'诺拉','E-14':'诺拉','E-17':'诺拉','E-23':'诺拉'}
for n in S['clues']:
 for part in ['body','detail']:
  lines=overrides.get(n['id']) if part=='body' else None
  if lines is None:
   role=role_for.get(n['id'],'旁白') if part=='body' else '诺拉'
   lines=[line(role,title(n)+'。'+('鉴定补充说明。' if part=='detail' else '')+spoken(n[part]))]
  track=dict(id=n['id'],part=part,title=n['title'],sourceText=n[part],sourceHash=hashlib.sha256(n[part].encode()).hexdigest(),lines=lines,
   music='At Rest.mp3' if n['id'] in ['E-07','E-18','E-26'] else 'Darkest Child.mp3' if n['id'] in ['E-02','E-09','E-21'] else 'Long Note One.mp3')
  tracks.append(track)
for n in S['nodes']:
 tracks.append(dict(id=n['id'],part='body',title=n['title'],sourceText=n['body'],sourceHash=hashlib.sha256(n['body'].encode()).hexdigest(),lines=[line('诺拉',n['title']+'。'+spoken(n['body']))],music='Long Note One.mp3'))
cfg=dict(version='2026-10-15',model='speech-2.8-hd',voices=V,tracks=tracks)
(OUT/'分层配音源稿_GM保密.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
(ROOT/'output/clue-audio/config.json').write_text(json.dumps(cfg,ensure_ascii=False,indent=2))
print(len(tracks),'tracks',sum(len(t['lines']) for t in tracks),'lines',sum(len(l['text']) for t in tracks for l in t['lines']),'characters')
