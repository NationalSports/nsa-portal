#!/usr/bin/env python3
"""
Generate the Encinitas Express club stock sheet as a co-branded PDF.

This is a CUSTOMER-FACING sheet: it shows quantities only. NSA cost is
deliberately absent — the club sees this document, and `products.nsa_cost` is
our margin basis. Retail is omitted too; add both only for an internal copy.

The counts below are a SNAPSHOT of `product_inventory` for the club's
`p-exp-*` products, taken 2026-08-26 (see COUNTED_AS_OF). To refresh, re-run
this query and update D / Y / O:

    select p.sku, p.available_sizes,
           (select jsonb_object_agg(i.size, i.quantity)
              from product_inventory i where i.product_id = p.id) as inv
      from products p where p.id like 'p-exp-%' order by p.sku;

`counted` per row is the date that row was last physically counted in the
house-inventory sheet's `Express` tab — NOT the generation date. Rows with
recount=1 are stale and render with a "*" flag.

Usage:  python3 docs/stock-sheets/gen_express_stock_sheet.py
Requires: reportlab, pillow.  Outputs the PDF next to this script.
"""
import os

HERE = os.path.dirname(os.path.abspath(__file__))
REPO = os.path.abspath(os.path.join(HERE, '..', '..'))
NSA_LOGO = os.path.join(REPO, 'public', 'NEW NSA Logo on white.png')
EXP_LOGO = os.path.join(HERE, 'express-logo.png')
OUT_PDF  = os.path.join(HERE, 'Encinitas_Express_Stock_On_Hand_2026-08-27.pdf')
COUNTED_AS_OF = 'Aug 26 2026'

from reportlab.lib.pagesizes import letter, landscape
from reportlab.lib.units import inch
from reportlab.lib import colors
from reportlab.lib.styles import ParagraphStyle
from reportlab.platypus import (BaseDocTemplate, PageTemplate, Frame, Paragraph,
                                Spacer, Table, TableStyle, Image, KeepTogether)
from reportlab.lib.enums import TA_LEFT, TA_RIGHT
from PIL import Image as PILImage

NAVY   = colors.HexColor('#1B2C54')
RED    = colors.HexColor('#A62B2B')
GOLD   = colors.HexColor('#C4B382')
GOLD_D = colors.HexColor('#8A7A45')   # gold darkened for text on white
BLUE   = colors.HexColor('#5178C2')
INK    = colors.HexColor('#1F2733')
MUTED  = colors.HexColor('#6B7684')
FAINT  = colors.HexColor('#AAB2BD')
RULE   = colors.HexColor('#D8DDE4')
ZEBRA  = colors.HexColor('#F5F7FA')
ZEROBG = colors.HexColor('#FBEDED')

PAGE = landscape(letter)          # 792 x 612
LM = RM = 34
TOP_H = 92                        # header band height
BOT_H = 30

ADULT = ['XS','S','M','L','XL','2XL']
YOUTH = ['YXS','YS','YM','YL','YXL']

# sku, item, color, category, retail, {size: qty}, [scale], counted, needs_recount
D = [
 ('JD7371-EXP-N','Adult Jersey','Navy','Jersey',55,{'S':34,'M':17,'L':6,'XL':4},['S','M','L','XL'],'Aug 26',0),
 ('JD7371-EXP-W','Adult Jersey','White','Jersey',55,{'S':47,'M':8,'L':9,'XL':3},['S','M','L','XL'],'Aug 26',0),
 ('JD7370-EXP-N',"Women's Jersey",'Navy','Jersey',55,{'XS':14,'S':8,'M':10,'L':8},['XS','S','M','L'],'Aug 26',0),
 ('JD7370-EXP-W',"Women's Jersey",'White','Jersey',55,{'XS':12,'S':3,'M':11,'L':8,'XL':4},['XS','S','M','L','XL'],'Aug 26',0),
 ('JF2881-EXP','GK Jersey LS — Adult','Red','Jersey',75,{'S':7,'M':3,'L':5},['S','M','L'],'May 5',1),
 ('JF2875-EXP','GK Jersey SS — Adult','Red','Jersey',75,{'S':3,'XL':2},['S','XL'],'Aug 20',0),
 ('JF2871-EXP',"GK Jersey LS — Women's",'Red','Jersey',75,{'S':7,'M':7,'L':3},['S','M','L'],'May 5',1),
 ('JF2880-EXP',"GK Jersey SS — Women's",'Red','Jersey',75,{'S':2,'M':2},['S','M'],'Aug 18',0),
 ('AE152-EXP-CB','Astra Tee','Columbia Blue','Tees',None,{'XS':1,'S':18,'M':13,'L':9},['XS','S','M','L'],'Aug 10',0),
 ('AE152-EXP-N','Astra Tee','Navy','Tees',None,{'M':13,'L':7},['M','L'],'Aug 10',0),
 ('AE152-EXP-R','Astra Tee','Red','Tees',None,{'L':2},['L'],'Aug 10',0),
 ('KB4029-EXP','Adult Shorts','Navy','Shorts',40,{'M':11,'L':4,'XL':1},['M','L','XL'],'Aug 26',0),
 ('KB4032-EXP',"Women's Shorts",'Navy','Shorts',40,{'XS':0,'S':5,'M':52,'L':9,'XL':3},['XS','S','M','L','XL'],'Aug 26',0),
 ('JP0179-EXP','GK Shorts — Adult','Red','Shorts',50,{'S':4,'M':8,'L':8,'XL':2},['S','M','L','XL'],'Jul 27',0),
 ('JJ4162-EXP',"GK Shorts — Women's",'Red','Shorts',50,{'S':4,'M':4,'L':5,'XL':2},['S','M','L','XL'],'Jul 27',0),
 ('KB4042-EXP','Adult Jacket','Navy','Outerwear',65,{'S':50,'M':30,'L':12,'XL':2,'2XL':5},['S','M','L','XL','2XL'],'Aug 26',0),
 ('KB4037-EXP',"Women's Jacket",'Navy','Outerwear',65,{'S':7,'M':9,'L':0,'XL':2},['S','M','L','XL'],'Aug 26',0),
 ('KB3914-EXP','All Weather Jacket — Adult','Navy','Outerwear',85,{'L':3,'XL':1,'2XL':1},['L','XL','2XL'],'Jul 27',0),
 ('KE9910-EXP','Adult Pant','Navy','Pants',60,{'S':20,'M':13,'L':1,'XL':3,'2XL':5},['S','M','L','XL','2XL'],'Aug 26',0),
 ('JY5389-EXP',"Women's Pant",'Navy','Pants',60,{'S':2,'M':5,'L':2,'XL':3},['S','M','L','XL'],'Aug 26',0),
 ('JW6705-EXP-N','Team Sock','Navy','Socks',25,{'S':12,'M':53,'L':90},['S','M','L'],'Jul 27',0),
 ('JW6705-EXP-R','Team Sock','Red','Socks',25,{'XS':6,'S':11},['XS','S'],'Jul 27',0),
]
Y = [
 ('JD7373-EXP-N','Youth Jersey','Navy','Jersey',50,{'YXS':2,'YS':20,'YM':6,'YL':24,'YXL':25},['YXS','YS','YM','YL','YXL'],'Aug 26',0),
 ('JD7373-EXP-W','Youth Jersey','White','Jersey',50,{'YXS':2,'YS':23,'YM':7,'YL':27,'YXL':25},['YXS','YS','YM','YL','YXL'],'Aug 26',0),
 ('JF2887-EXP','GK Jersey LS — Youth','Red','Jersey',70,{'YXL':2},['YXL'],'May 5',1),
 ('JD7358-EXP','GK Jersey SS — Youth','Red','Jersey',70,{'YS':4,'YM':2,'YL':4,'YXL':5},['YS','YM','YL','YXL'],'Aug 18',0),
 ('AE153Y-EXP','Astra Tee','Columbia Blue','Tees',None,{'YS':2,'YM':1,'YL':19,'YXL':13},['YS','YM','YL','YXL'],'Aug 10',0),
 ('KB4028-EXP','Youth Shorts','Navy','Shorts',35,{'YXS':10,'YS':40,'YM':37,'YL':3,'YXL':29},['YXS','YS','YM','YL','YXL'],'Aug 26',0),
 ('JF2872-EXP','GK Shorts — Youth','Red','Shorts',50,{'YS':3,'YL':16,'YXL':1},['YS','YL','YXL'],'Jul 30',0),
 ('JY5390-EXP','Youth Jacket','Navy','Outerwear',60,{'YM':2,'YL':50,'YXL':28},['YM','YL','YXL'],'Aug 26',0),
 ('JY5395-EXP','Youth Pant','Navy','Pants',55,{'YXS':13,'YS':21,'YM':35,'YL':30,'YXL':15},['YXS','YS','YM','YL','YXL'],'Aug 26',0),
]
O = [
 ('5159406-EXP','Stadium 4 Backpack','Navy','Bags',65,64,'Jul 27',0),
 ('HT6546-EXP','Team Sleeve Sock','Navy','Accessories',16,158,'Jul 27',0),
]

def st(**kw):
    base = dict(fontName='Helvetica', fontSize=8.2, leading=10, textColor=INK)
    base.update(kw); return ParagraphStyle('s%d' % id(kw), **base)

S_ITEM  = st(fontName='Helvetica-Bold', fontSize=8.4)
S_SUB   = st(fontSize=7.4, textColor=MUTED)
S_CELL  = st(alignment=TA_LEFT)

def logo(path, h):
    iw, ih = PILImage.open(path).size
    return Image(path, width=h * iw / ih, height=h, mask='auto')

def header(canv, doc):
    canv.saveState()
    W, H = PAGE
    y = H - 30
    nsa = logo(NSA_LOGO, 34);  nsa.drawOn(canv, LM, y - 30)
    exp = logo(EXP_LOGO, 20);  exp.drawOn(canv, W - RM - exp.drawWidth, y - 24)
    # tri-tone rule: navy | red tick | gold | blue tick
    ry = y - 40
    canv.setLineWidth(2.2)
    canv.setStrokeColor(NAVY); canv.line(LM, ry, LM + 200, ry)
    canv.setStrokeColor(RED);  canv.line(LM + 200, ry, LM + 226, ry)
    canv.setStrokeColor(RULE); canv.line(LM + 226, ry, W - RM - 226, ry)
    canv.setStrokeColor(BLUE); canv.line(W - RM - 226, ry, W - RM - 200, ry)
    canv.setStrokeColor(GOLD); canv.line(W - RM - 200, ry, W - RM, ry)
    # footer
    canv.setFont('Helvetica', 7.2); canv.setFillColor(MUTED)
    canv.drawString(LM, 20, 'Prepared by National Sports Apparel for Encinitas Express Soccer Club')
    canv.drawRightString(W - RM, 20, 'Page %d' % doc.page)
    canv.setStrokeColor(RULE); canv.setLineWidth(0.5); canv.line(LM, 32, W - RM, 32)
    canv.restoreState()

def tile(label, value, accent, textcol=None):
    t = Table([[Paragraph('<font size=15 color="%s"><b>%s</b></font>' % ("#" + (textcol or accent).hexval()[2:], value), st(leading=17))],
               [Paragraph(label.upper(), st(fontSize=6.4, textColor=MUTED, leading=8))]],
              colWidths=[104], rowHeights=[19, 10])
    t.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),9), ('RIGHTPADDING',(0,0),(-1,-1),6),
                           ('TOPPADDING',(0,0),(-1,-1),1), ('BOTTOMPADDING',(0,0),(-1,-1),1),
                           ('BACKGROUND',(0,0),(-1,-1), ZEBRA),
                           ('LINEBEFORE',(0,0),(0,-1), 2.4, accent),
                           ('VALIGN',(0,0),(-1,-1),'MIDDLE')]))
    return t

def grid(rows, scale, label):
    """Build one size-grid table. rows = tuples matching D/Y shape."""
    head = ['Item', 'Color', 'SKU', 'Counted'] + scale + ['Total']
    data = [head]
    spans = []
    zeros = []
    cat = None
    for r in rows:
        sku, item, color, category, retail, inv, carried, counted, recount = r
        if category != cat:
            cat = category
            spans.append(len(data))
            data.append([Paragraph(category.upper(), st(fontName='Helvetica-Bold', fontSize=7.2,
                                                        textColor=NAVY, leading=9))] + [''] * (len(head) - 1))
        nm = item + ('  ·  needs recount' if recount else '')
        cells = [Paragraph(item, S_ITEM),
                 Paragraph(color, S_CELL),
                 Paragraph(sku, st(fontName='Helvetica', fontSize=7.6, textColor=MUTED)),
                 Paragraph(counted + (' *' if recount else ''), st(fontSize=7.4,
                           textColor=(RED if recount else MUTED)))]
        for s in scale:
            if s not in carried:
                cells.append(Paragraph('–', st(fontSize=8, textColor=FAINT)))
            else:
                q = inv.get(s, 0)
                if q == 0:
                    zeros.append((4 + scale.index(s), len(data)))
                    cells.append(Paragraph('0', st(fontSize=8.4, textColor=RED, fontName='Helvetica-Bold')))
                else:
                    cells.append(Paragraph(str(q), st(fontSize=8.6, fontName='Helvetica-Bold')))
        cells.append(Paragraph(str(sum(inv.values())), st(fontSize=8.8, fontName='Helvetica-Bold',
                                                          textColor=NAVY)))
        data.append(cells)

    sw = 34 if scale is ADULT else 40
    widths = [176, 74, 76, 52] + [sw] * len(scale) + [42]
    t = Table(data, colWidths=widths, repeatRows=1, hAlign='LEFT')
    style = [
        ('BACKGROUND',(0,0),(-1,0), NAVY),
        ('TEXTCOLOR',(0,0),(-1,0), colors.white),
        ('FONT',(0,0),(-1,0),'Helvetica-Bold',7.4),
        ('ALIGN',(4,0),(-1,-1),'CENTER'),
        ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
        ('TOPPADDING',(0,0),(-1,-1),4), ('BOTTOMPADDING',(0,0),(-1,-1),4),
        ('LEFTPADDING',(0,0),(-1,-1),6), ('RIGHTPADDING',(0,0),(-1,-1),6),
        ('LINEBELOW',(0,0),(-1,-1), 0.4, RULE),
        ('LINEAFTER',(3,1),(3,-1), 0.4, RULE),
        ('BOX',(0,0),(-1,-1), 0.6, RULE),
    ]
    for i in spans:
        style += [('SPAN',(0,i),(-1,i)), ('BACKGROUND',(0,i),(-1,i), colors.HexColor('#EDF1F6')),
                  ('TOPPADDING',(0,i),(-1,i),5), ('BOTTOMPADDING',(0,i),(-1,i),3),
                  ('NOSPLIT',(0,i),(-1,i + 1))]   # band travels with its first row
    band = [i for i in range(1, len(data)) if i not in spans]
    for n, i in enumerate(band):
        if n % 2 == 1:
            style.append(('BACKGROUND',(0,i),(-1,i), ZEBRA))
    for c, r in zeros:
        style.append(('BACKGROUND',(c,r),(c,r), ZEROBG))
    t.setStyle(TableStyle(style))
    cap = Paragraph(label, st(fontName='Helvetica-Bold', fontSize=10, textColor=NAVY, leading=14))
    return [cap, Spacer(1, 5), t]

def build(path):
    W, H = PAGE
    doc = BaseDocTemplate(path, pagesize=PAGE, leftMargin=LM, rightMargin=RM,
                          topMargin=TOP_H, bottomMargin=BOT_H,
                          title='Encinitas Express Soccer Club — Team Stock on Hand',
                          author='National Sports Apparel',
                          subject='In-house stock on hand, physical count 26 Aug 2026')
    frame = Frame(LM, BOT_H, W - LM - RM, H - TOP_H - BOT_H, id='body',
                  leftPadding=0, rightPadding=0, topPadding=0, bottomPadding=0)
    doc.addPageTemplates([PageTemplate(id='p', frames=[frame], onPage=header)])

    units = sum(sum(r[5].values()) for r in D) + sum(sum(r[5].values()) for r in Y) + sum(r[5] for r in O)
    nzero = sum(1 for r in D+Y for sz in r[6] if r[5].get(sz,0)==0)
    styles_out = []
    styles_out.append(Paragraph('Team Stock on Hand',
                      st(fontName='Helvetica-Bold', fontSize=19, textColor=NAVY, leading=22)))
    styles_out.append(Paragraph('Encinitas Express Soccer Club &nbsp;·&nbsp; club-owned inventory held at National Sports Apparel',
                      st(fontSize=9, textColor=MUTED, leading=13)))
    styles_out.append(Spacer(1, 12))

    tiles = Table([[tile('Units on hand', f'{units:,}', NAVY),
                    tile('Items', str(len(D) + len(Y) + len(O)), BLUE),
                    tile('Full count', COUNTED_AS_OF, GOLD, GOLD_D),
                    tile('Sizes at zero', str(nzero), RED)]],
                  colWidths=[112] * 4, hAlign='LEFT')
    tiles.setStyle(TableStyle([('LEFTPADDING',(0,0),(-1,-1),0), ('RIGHTPADDING',(0,0),(-1,-1),8),
                               ('TOPPADDING',(0,0),(-1,-1),0), ('BOTTOMPADDING',(0,0),(-1,-1),0)]))
    styles_out.append(tiles)
    styles_out.append(Spacer(1, 16))

    styles_out += grid(D, ADULT, "Adult &amp; Women's")
    styles_out.append(Spacer(1, 16))
    styles_out += grid(Y, YOUTH, 'Youth')
    styles_out.append(Spacer(1, 16))

    # one-size table
    head = ['Item', 'Color', 'SKU', 'Counted', 'On hand']
    rows = [head] + [[Paragraph(i, S_ITEM), Paragraph(c, S_CELL),
                      Paragraph(s, st(fontSize=7.6, textColor=MUTED)),
                      Paragraph(d, st(fontSize=7.4, textColor=MUTED)),
                      Paragraph(str(q), st(fontSize=8.8, fontName='Helvetica-Bold', textColor=NAVY))]
                     for s, i, c, cat, r, q, d, _ in O]
    t = Table(rows, colWidths=[176, 74, 76, 52, 76], hAlign='LEFT')
    t.setStyle(TableStyle([('BACKGROUND',(0,0),(-1,0), NAVY), ('TEXTCOLOR',(0,0),(-1,0), colors.white),
                           ('FONT',(0,0),(-1,0),'Helvetica-Bold',7.4),
                           ('ALIGN',(4,0),(-1,-1),'CENTER'), ('VALIGN',(0,0),(-1,-1),'MIDDLE'),
                           ('TOPPADDING',(0,0),(-1,-1),4), ('BOTTOMPADDING',(0,0),(-1,-1),4),
                           ('LEFTPADDING',(0,0),(-1,-1),6), ('RIGHTPADDING',(0,0),(-1,-1),6),
                           ('LINEBELOW',(0,0),(-1,-1), 0.4, RULE),
                           ('BACKGROUND',(0,2),(-1,2), ZEBRA),
                           ('BOX',(0,0),(-1,-1), 0.6, RULE)]))
    styles_out += [Paragraph('One Size', st(fontName='Helvetica-Bold', fontSize=10,
                                            textColor=NAVY, leading=14)), Spacer(1, 5), t]

    styles_out.append(Spacer(1, 18))
    notes = ('<b>Reading this sheet.</b> &nbsp;A dash (–) means the size is not carried in that item; '
             'a red <b>0</b> means it is carried but out of stock. <b>Counted</b> is the date that row was '
             'last physically counted — rows flagged * were last counted in May and are due for a recount. '
             'Youth sizes are shown on their own grid (YXS–YXL).')
    styles_out.append(Paragraph(notes, st(fontSize=7.8, textColor=MUTED, leading=11)))
    doc.build(styles_out)
    return units

if __name__ == '__main__':
    u = build(OUT_PDF)
    print('wrote %s  (%d units)' % (OUT_PDF, u))
