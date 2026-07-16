from reportlab.lib import colors
from reportlab.lib.enums import TA_LEFT
from reportlab.lib.pagesizes import letter
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.units import inch
from reportlab.platypus import SimpleDocTemplate, Paragraph, Spacer, PageBreak, Table, TableStyle

out = 'output/pdf/license_hunter_explanation.pdf'
doc = SimpleDocTemplate(out, pagesize=letter, rightMargin=.65*inch, leftMargin=.65*inch, topMargin=.55*inch, bottomMargin=.55*inch)
styles = getSampleStyleSheet()
title = ParagraphStyle('TitleX', parent=styles['Title'], fontName='Helvetica-Bold', fontSize=21, leading=25, textColor=colors.HexColor('#101828'), spaceAfter=8)
subtitle = ParagraphStyle('SubtitleX', parent=styles['Normal'], fontSize=10.5, leading=14, textColor=colors.HexColor('#475467'), spaceAfter=15)
h1 = ParagraphStyle('H1X', parent=styles['Heading1'], fontName='Helvetica-Bold', fontSize=14, leading=18, textColor=colors.HexColor('#155EEF'), spaceBefore=12, spaceAfter=7)
h2 = ParagraphStyle('H2X', parent=styles['Heading2'], fontName='Helvetica-Bold', fontSize=11, leading=14, textColor=colors.HexColor('#101828'), spaceBefore=8, spaceAfter=4)
body = ParagraphStyle('BodyX', parent=styles['BodyText'], fontName='Helvetica', fontSize=9.4, leading=13.2, textColor=colors.HexColor('#344054'), spaceAfter=7)
small = ParagraphStyle('SmallX', parent=body, fontSize=8.2, leading=11)
code = ParagraphStyle('CodeX', parent=body, fontName='Courier', fontSize=7.8, leading=10.2, backColor=colors.HexColor('#F2F4F7'), borderPadding=6, spaceBefore=3, spaceAfter=8)
quote = ParagraphStyle('QuoteX', parent=body, fontName='Helvetica-Oblique', fontSize=10.2, leading=14, textColor=colors.HexColor('#175CD3'), leftIndent=12, borderColor=colors.HexColor('#84CAFF'), borderWidth=2, borderPadding=8, spaceBefore=5, spaceAfter=10)

def P(t, style=body): return Paragraph(t, style)

story = [
    P('License Hunter: How It Actually Gets the License', title),
    P('A practical explanation of how an agent can turn a natural-language request into a real, verifiable purchase - not an invented license or a generic recommendation.', subtitle),
    P('The question', h1),
    P('“How can one get the license and stuff? How will it know the license is available? The user saying this and that is just text - if it is not feasible, how will it work?”', quote),
    P('The short answer', h1),
    P('The user’s text is only the request. It is not evidence that a license exists. The actual marketplace or rights-holder must be the authority. License Hunter only recommends and purchases licenses when a connected provider returns a real asset ID, current license terms, current price, and a successful purchase response.', body),
    P('The workflow', h1),
    P('1. Convert the request into requirements', h2),
    P('The user says: “Find music for a worldwide paid YouTube ad, perpetual use, under $50, no attribution.” The system converts that into structured requirements:', body),
    P('{"asset_type":"music", "commercial_use":true, "paid_ads":true, "territory":"worldwide", "duration":"perpetual", "attribution":false, "budget":50}', code),
    P('The important fields are commercial use, paid advertising, territory, duration, number of projects, modification rights, redistribution rights, exclusivity, attribution, and AI-training restrictions.', body),
    P('2. Search real provider catalogs', h2),
    P('The agent calls connected providers, rather than inventing search results. Each provider connector returns a normalized asset record with a real provider ID, price, available license types, and source URL.', body),
    P('{"asset_id":"track_88421", "title":"Future Motion", "price":29, "available_license_types":["commercial","advertising"], "license_url":"provider.com/license/track_88421"}', code),
    P('3. Ask the provider what license is actually available', h2),
    P('For every candidate, License Hunter calls the provider’s license-information endpoint. The response should identify the exact license type, price, territories, duration, paid-advertising permission, and attribution requirement.', body),
    P('If the provider does not return this information, the agent must mark the candidate as “needs review” or reject it. It should never infer permission from a title or a vague description.', body),
    P('4. Match the license against the requirements', h2),
    P('Use deterministic rules for the final decision. The language model can extract terms from messy text, but a rules engine decides whether the terms satisfy the request.', body),
    P('Example: a $9 personal-use license is rejected when the user requires paid advertising, even if the asset itself looks perfect.', body),
    P('5. Re-check immediately before purchase', h2),
    P('Availability and price can change. The purchase sequence is: search -> inspect license options -> user approves asset and budget -> re-check price and availability -> purchase -> download receipt and asset.', body),
    P('The asset is not considered secured until the provider returns a successful purchase response with a purchase ID, license type, amount paid, license document URL, and download URL.', body),
    P('6. Store proof in a rights vault', h2),
    P('The final deliverable is a rights package, not just an MP3 or image:', body),
    P('project-rights-pack/<br/>- asset file<br/>- purchase receipt<br/>- license certificate<br/>- license terms snapshot<br/>- attribution.txt<br/>- rights-summary.json', code),
    P('The terms snapshot is important because a provider can change its website terms later. The customer needs proof of what they purchased at the time.', body),
    PageBreak(),
    P('How the agent can purchase', h1),
    P('Option A: real provider API', h2),
    P('This is the best option. Integrate with a provider that allows your application to search, license, and download assets. Adobe Stock, Shutterstock, and MotionElements all document API-based licensing capabilities. For references, see the Adobe Stock licensing API, Shutterstock API reference, and MotionElements API.', body),
    P('Option B: checkout handoff', h2),
    P('If a provider allows search but not programmatic checkout, the agent returns the exact asset and purchase link. The user completes payment, uploads the receipt, and License Hunter verifies and stores the license. This is less autonomous but still completely feasible.', body),
    P('Option C: your own licensed catalog', h2),
    P('For a hackathon, this may be the smartest route. Partner with 10-20 independent musicians, photographers, designers, or footage creators. Each contributor uploads the asset, price, permitted uses, territories, duration, attribution requirement, and prohibited uses. Your agent owns the checkout and issues the license instantly.', body),
    P('The realistic hackathon MVP', h1),
    P('Do not support music, photos, fonts, video, datasets, and software all at once. Build License Hunter for commercial music in video ads.', body),
    P('A good demo:', h2),
    P('1. User asks for music for a paid global ad.<br/>2. Agent searches a real catalog.<br/>3. It shows three tracks and their exact license terms.<br/>4. It rejects one because paid advertising is prohibited.<br/>5. User approves one.<br/>6. Agent pays.<br/>7. Provider returns the asset and license certificate.<br/>8. Agent produces a rights pack.', body),
    P('The core rule', h1),
    P('“The agent may interpret the request, but only the licensor can prove that the license exists.”', quote),
    P('Do not claim that the system guarantees legal safety. Position it as procurement assistance that matches assets against explicit license terms, records the transaction, and flags conflicts for human review.', body),
]

def footer(canvas, doc):
    canvas.saveState()
    canvas.setStrokeColor(colors.HexColor('#D0D5DD'))
    canvas.line(doc.leftMargin, .38*inch, letter[0]-doc.rightMargin, .38*inch)
    canvas.setFont('Helvetica', 7.5)
    canvas.setFillColor(colors.HexColor('#667085'))
    canvas.drawString(doc.leftMargin, .22*inch, 'License Hunter concept - OKX.AI Genesis')
    canvas.drawRightString(letter[0]-doc.rightMargin, .22*inch, f'Page {doc.page}')
    canvas.restoreState()

doc.build(story, onFirstPage=footer, onLaterPages=footer)
print(out)
