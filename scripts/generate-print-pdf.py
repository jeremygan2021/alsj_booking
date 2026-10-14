"""A4 six-card print PDF from verified QR exports (reportlab + PyMuPDF)."""
from pathlib import Path
import json
from reportlab.pdfgen import canvas
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import mm
from reportlab.lib.colors import HexColor
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.cidfonts import UnicodeCIDFont
ROOT=Path(__file__).resolve().parents[1]
OUT=ROOT/'交付包_阿拉斯加之夜/打印物料'
data=json.loads((OUT/'二维码清单.json').read_text())
pdfmetrics.registerFont(UnicodeCIDFont('STSong-Light'))
FONT='STSong-Light';W,H=A4
p=OUT/'线索与AR节点二维码_A4打印.pdf';c=canvas.Canvas(str(p),pagesize=A4)
c.setTitle('阿拉斯加之夜 - 线索与AR节点二维码打印物料')
page=0
for kind in ['证据','验尸节点']:
 items=[x for x in data['items'] if x['type']==kind]
 for offset in range(0,len(items),6):
  page+=1;c.setFont(FONT,14);c.setFillColor(HexColor('#17374a'));c.drawString(12*mm,H-14*mm,'阿拉斯加之夜 · 最后的遗嘱')
  c.setFont(FONT,9);c.drawRightString(W-12*mm,H-14*mm,kind+'二维码 · 原尺寸打印')
  c.setStrokeColor(HexColor('#84949d'));c.setLineWidth(.6)
  for index,item in enumerate(items[offset:offset+6]):
   x=12*mm+(index%2)*96*mm;y=H-29*mm-(index//2)*86*mm-82*mm;width=90*mm;height=82*mm
   c.setDash(2,3);c.rect(x,y,width,height);c.setDash()
   c.setFillColor(HexColor('#172b38'));c.setFont(FONT,11);c.drawString(x+4*mm,y+height-7*mm,item['id']);c.setFont(FONT,8);c.drawRightString(x+width-4*mm,y+height-7*mm,item['sourceId'])
   title=item['title'];size=12
   while pdfmetrics.stringWidth(title,FONT,size)>82*mm:size-=.5
   c.setFont(FONT,size);c.drawCentredString(x+width/2,y+height-16*mm,title)
   c.drawImage(str(OUT/item['path']),x+width/2-23*mm,y+18*mm,width=46*mm,height=46*mm,mask='auto')
   c.setFont(FONT,8);c.drawCentredString(x+width/2,y+12*mm,item['area']+' · '+('终局使用' if item['phase']==4 else '调查阶段'))
   c.setFont(FONT,8);c.drawCentredString(x+width/2,y+7*mm,'扫码查看3D证物与现场记录')
   c.setFont('Helvetica',5.5);c.setFillColor(HexColor('#657783'));c.drawCentredString(x+width/2,y+3*mm,item['url'])
  c.setFillColor(HexColor('#61727d'));c.setFont(FONT,7);c.drawString(12*mm,7*mm,'剧情活动物料 · 二维码白边请保留 · 终局标牌由GM发放')
  c.setFont('Helvetica',8);c.drawRightString(W-12*mm,7*mm,str(page));c.showPage()
c.save()
# Render actual PDF for layout review.
import pypdfium2 as pdfium
review=ROOT/'output/pdf/print-review';review.mkdir(parents=True,exist_ok=True)
doc=pdfium.PdfDocument(str(p))
assert len(doc)==6
for i in [0,len(doc)-1]:doc[i].render(scale=1.2).to_pil().save(str(review/f'page-{i+1}.png'))
print('Created and rendered',len(doc),'A4 PDF pages:',p)
try:
 from openpyxl import load_workbook
 from openpyxl.styles import Font,PatternFill,Alignment
 workbook=OUT.parent/'阿拉斯加之夜_制作管理表.xlsx';wb=load_workbook(workbook)
 if '打印二维码' in wb:del wb['打印二维码']
 s=wb.create_sheet('打印二维码');s.append(['类型','编号','原稿编号','标题','地点','阶段','网页链接','PNG文件'])
 for item in data['items']:s.append([item[k] for k in ['type','id','sourceId','title','area','phase','url','path']])
 s.freeze_panes='A2';s.auto_filter.ref=s.dimensions
 for letter,width in [('A',18),('B',15),('C',20),('D',35),('E',26),('F',12),('G',60),('H',65)]:s.column_dimensions[letter].width=width
 for cell in s[1]:cell.font=Font(bold=True,color='FFFFFF');cell.fill=PatternFill('solid',fgColor='17365D')
 for row in s:
  for cell in row:cell.alignment=Alignment(vertical='top',wrap_text=True)
 wb.save(workbook)
except ImportError:print('Workbook not updated: openpyxl unavailable')
