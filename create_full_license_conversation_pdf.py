import html
import re
from reportlab.lib import colors
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, Preformatted, PageBreak

src = r'C:\Users\HP\.codex\attachments\8f1c48d5-00e0-4ab7-8000-4ac933c09cd3\pasted-text.txt'
out = 'output/pdf/license_hunter_full_conversation.pdf'
with open(src, 'r', encoding='utf-8') as f:
    text = f.read().replace('\r\n', '\n')

doc = SimpleDocTemplate(out, pagesize=letter, rightMargin=.65*inch, leftMargin=.65*inch, topMargin=.55*inch, bottomMargin=.55*inch)
styles = getSampleStyleSheet()
title = ParagraphStyle('TitleX', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=20, leading=24, textColor=colors.HexColor('#102A43'), spaceAfter=8)
subtitle = ParagraphStyle('SubtitleX', parent=styles['Normal'], fontSize=9.5, leading=13, textColor=colors.HexColor('#52606D'), spaceAfter=12)
h1 = ParagraphStyle('H1X', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=colors.HexColor('#155EEF'), spaceBefore=12, spaceAfter=6)
h2 = ParagraphStyle('H2X', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11.5, leading=15, textColor=colors.HexColor('#0E7490'), spaceBefore=9, spaceAfter=4)
body = ParagraphStyle('BodyX', parent=styles['BodyText'], fontName='Helvetica', fontSize=9.2, leading=13, textColor=colors.HexColor('#243B53'), spaceAfter=6)
bullet = ParagraphStyle('BulletX', parent=body, leftIndent=15, firstLineIndent=-9, bulletIndent=3, spaceAfter=3)
quote = ParagraphStyle('QuoteX', parent=body, leftIndent=12, rightIndent=7, borderColor=colors.HexColor('#84CAFF'), borderWidth=1.5, borderPadding=7, backColor=colors.HexColor('#EFF8FF'), textColor=colors.HexColor('#175CD3'), spaceBefore=4, spaceAfter=8)
code = ParagraphStyle('CodeX', parent=body, fontName='Courier', fontSize=7.8, leading=10.2, backColor=colors.HexColor('#F2F4F7'), borderColor=colors.HexColor('#D0D5DD'), borderWidth=.5, borderPadding=7, textColor=colors.HexColor('#344054'), spaceBefore=3, spaceAfter=8)
link = ParagraphStyle('LinkX', parent=body, textColor=colors.HexColor('#6941C6'))

def inline(s):
    s = html.escape(s, quote=False)
    s = re.sub(r'\*\*(.+?)\*\*', r'<b>\1</b>', s)
    s = re.sub(r'`([^`]+)`', r'<font name="Courier" color="#475467">\1</font>', s)
    s = re.sub(r'\[([^\]]+)\]\(([^)]+)\)', r'<font color="#6941C6"><u>\1</u></font> <font size="7" color="#667085">(\2)</font>', s)
    return s

story = [Paragraph('License Hunter - Full Conversation', title), Paragraph('The complete implementation discussion, preserved from the supplied conversation text and color-coded for sharing.', subtitle)]
lines = text.split('\n')
i = 0
while i < len(lines):
    line = lines[i]
    if not line.strip():
        i += 1; continue
    if line.strip().startswith('```'):
        buf = []; i += 1
        while i < len(lines) and not lines[i].strip().startswith('```'):
            buf.append(lines[i]); i += 1
        if i < len(lines): i += 1
        story.append(Preformatted('\n'.join(buf), code)); continue
    if line.startswith('### '):
        story.append(Paragraph(inline(line[4:]), h2)); i += 1; continue
    if line.startswith('## '):
        story.append(Paragraph(inline(line[3:]), h1)); i += 1; continue
    if line.startswith('# '):
        story.append(Paragraph(inline(line[2:]), h1)); i += 1; continue
    if line.startswith('> '):
        story.append(Paragraph(inline(line[2:]), quote)); i += 1; continue
    if re.match(r'^\s*[-*] ', line):
        story.append(Paragraph('• ' + inline(re.sub(r'^\s*[-*] ', '', line)), bullet)); i += 1; continue
    if re.match(r'^\s*\d+\. ', line):
        story.append(Paragraph(inline(line.strip()), bullet)); i += 1; continue
    # Merge ordinary wrapped lines into one paragraph, preserving the full text.
    buf = [line.strip()]; i += 1
    while i < len(lines) and lines[i].strip() and not lines[i].startswith(('# ', '## ', '### ', '> ', '```')) and not re.match(r'^\s*[-*] ', lines[i]) and not re.match(r'^\s*\d+\. ', lines[i]):
        buf.append(lines[i].strip()); i += 1
    story.append(Paragraph(inline(' '.join(buf)), body))

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#D0D5DD'))
    canvas.line(doc.leftMargin, .38*inch, letter[0]-doc.rightMargin, .38*inch)
    canvas.setFont('Helvetica', 7.5); canvas.setFillColor(colors.HexColor('#667085'))
    canvas.drawString(doc.leftMargin, .22*inch, 'License Hunter - full conversation transcript')
    canvas.drawRightString(letter[0]-doc.rightMargin, .22*inch, f'Page {doc.page}')
    canvas.restoreState()

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(out)
