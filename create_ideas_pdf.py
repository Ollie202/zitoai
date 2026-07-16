from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import landscape, letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Table, TableStyle, Paragraph, Spacer

out = 'output/pdf/okx_ai_agent_ideas.pdf'
doc = SimpleDocTemplate(out, pagesize=landscape(letter), rightMargin=0.42*inch, leftMargin=0.42*inch, topMargin=0.35*inch, bottomMargin=0.3*inch)
styles = getSampleStyleSheet()
title = ParagraphStyle('TitleX', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=20, leading=24, textColor=colors.HexColor('#101828'), alignment=TA_LEFT, spaceAfter=4)
sub = ParagraphStyle('SubX', parent=styles['Normal'], fontName='Helvetica', fontSize=9.5, leading=12, textColor=colors.HexColor('#475467'), spaceAfter=10)
head = ParagraphStyle('HeadX', parent=styles['Normal'], fontName='Helvetica-Bold', fontSize=8.5, leading=10, textColor=colors.white)
cell = ParagraphStyle('CellX', parent=styles['Normal'], fontName='Helvetica', fontSize=7.7, leading=9.5, textColor=colors.HexColor('#344054'))
cell_bold = ParagraphStyle('CellBoldX', parent=cell, fontName='Helvetica-Bold', textColor=colors.HexColor('#101828'))

rows = [
    ['Agent', 'What it actually does', 'Real problem solved'],
    ['License Hunter', 'Finds and purchases commercial licenses for images, music, fonts, datasets, APIs, stock footage, and software based on project requirements.', 'People waste days figuring out what they are legally allowed to use.'],
    ['Refund Recovery Agent', 'Tracks late shipments, failed services, duplicate charges, subscription renewals, and files refund or chargeback requests automatically.', 'Consumers and businesses lose money because recovering it takes too much effort.'],
    ['Freight Backhaul Booker', 'Finds empty truck, container, or warehouse capacity and books it at a discount.', 'Logistics companies have expensive unused capacity.'],
    ['Permit Runner', 'Determines which permits a project needs, fills forms, pays fees, schedules inspections, and tracks status.', 'Small businesses struggle with local bureaucracy.'],
    ['API/Cloud Buyer', 'Compares and purchases API credits, GPU time, proxies, storage, RPC access, and software seats, then configures them.', 'Agents and startups need infrastructure, but procurement is manual.'],
    ['Event Resale Agent', 'Finds tickets, verifies them, buys them, and resells or transfers them when plans change.', 'Ticket buying and resale are fragmented and risky.'],
    ['Import Agent', 'Finds suppliers, requests quotes, negotiates, pays deposits, prepares customs paperwork, and tracks shipping.', 'Small businesses cannot easily import small quantities.'],
    ['Unclaimed Money Agent', 'Searches government, court, tax, pension, insurance, and corporate registries for money owed, then files the claim.', 'Money remains unclaimed because the paperwork is painful.'],
    ['Cancellation Agent', 'Watches for flight cancellations, visa appointments, restaurant tables, hotel price drops, or tickets and books immediately.', 'Valuable openings disappear before humans can react.'],
    ['Digital Cleanup Executor', 'Cancels unused subscriptions, closes old SaaS accounts, removes stale domains, rotates exposed API keys, and requests data deletion.', 'Companies accumulate costly digital clutter and security liabilities.'],
    ['Local Opportunity Agent', 'Finds vacant shops, unused offices, abandoned equipment, and distressed inventory, then contacts owners and negotiates.', 'Valuable local assets are invisible unless someone actively hunts for them.'],
    ['Contract Renewal Negotiator', 'Monitors recurring contracts, contacts vendors before renewal, requests competing quotes, and renegotiates pricing.', 'Companies silently overpay because nobody renegotiates small contracts.'],
]

data = [[Paragraph(x, head) for x in rows[0]]]
for r in rows[1:]:
    data.append([Paragraph(r[0], cell_bold), Paragraph(r[1], cell), Paragraph(r[2], cell)])

table = Table(data, colWidths=[1.55*inch, 5.35*inch, 3.35*inch], repeatRows=1)
table.setStyle(TableStyle([
    ('BACKGROUND', (0,0), (-1,0), colors.HexColor('#155EEF')),
    ('VALIGN', (0,0), (-1,-1), 'TOP'),
    ('GRID', (0,0), (-1,-1), 0.35, colors.HexColor('#D0D5DD')),
    ('ROWBACKGROUNDS', (0,1), (-1,-1), [colors.white, colors.HexColor('#F8FAFC')]),
    ('LEFTPADDING', (0,0), (-1,-1), 6), ('RIGHTPADDING', (0,0), (-1,-1), 6),
    ('TOPPADDING', (0,0), (-1,-1), 5), ('BOTTOMPADDING', (0,0), (-1,-1), 5),
]))

story = [Paragraph('OKX.AI Genesis: Agent Ideas That Take Real-World Action', title), Paragraph('Concrete services that buy, book, file, negotiate, recover, or configure something for a person or another agent.', sub), table, Spacer(1, 8), Paragraph('<b>Strongest hackathon picks:</b> License Hunter, Refund Recovery Agent, and API/Cloud Buyer. Each has a clear transaction, measurable value, and an easy live demo.', cell)]
doc.build(story)
print(out)
