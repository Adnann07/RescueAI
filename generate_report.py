#!/usr/bin/env python3
import sys, json
from datetime import datetime
from reportlab.lib.pagesizes import A4
from reportlab.lib.units import cm
from reportlab.lib import colors
from reportlab.lib.styles import getSampleStyleSheet, ParagraphStyle
from reportlab.lib.enums import TA_CENTER, TA_LEFT, TA_RIGHT
from reportlab.platypus import (
    SimpleDocTemplate, Paragraph, Spacer, Table, TableStyle,
    HRFlowable, KeepTogether
)

C_RED    = colors.HexColor("#c8192b")
C_ORANGE = colors.HexColor("#c96a00")
C_YELLOW = colors.HexColor("#a16207")
C_GREEN  = colors.HexColor("#15803d")
C_BLUE   = colors.HexColor("#1d4ed8")
C_BDG    = colors.HexColor("#006a4e")
C_BDR    = colors.HexColor("#d42638")
C_GREY   = colors.HexColor("#64615a")
C_LGREY  = colors.HexColor("#f2f0eb")
C_BORDER = colors.HexColor("#dedad2")
C_TEXT   = colors.HexColor("#17160e")

def sev_color(s):
    if s>=8: return C_RED
    if s>=6: return C_ORANGE
    if s>=4: return C_YELLOW
    return C_GREEN

def sev_label(s):
    if s>=8: return "VERY HIGH"
    if s>=6: return "HIGH"
    if s>=4: return "MEDIUM"
    if s>=2: return "LOW"
    return "VERY LOW"

def S(name, parent, **kw):
    return ParagraphStyle(name, parent=parent, **kw)

TIPS = {
    "flood":[
        ("Move to higher ground immediately","Do not wait for official orders. Go upstairs or to the roof if needed."),
        ("Never walk through floodwater","15 cm of fast-moving water can knock you off your feet. 30 cm sweeps a car."),
        ("Switch off electricity at the mains","Avoid contact with water near submerged electrical equipment."),
        ("Clean wounds from floodwater","Floodwater carries sewage. Clean all cuts with clean water and soap immediately."),
        ("Oral Rehydration Therapy for diarrhoea","1L water + 6 tsp sugar + 0.5 tsp salt. Seek care for children under 5."),
        ("Emergency contacts","Bangladesh Emergency: 999  |  BDRCS: 01713-038989  |  BWDB Hotline: 16122"),
    ],
    "drought":[
        ("Drink water every 20 minutes","Do not wait until thirsty. Aim for 3+ litres per day."),
        ("Boil or treat all drinking water","Boil 1 full minute or use 1 chlorine tablet per 20L, wait 30 min."),
        ("Identify severe dehydration","Signs: sunken eyes, dark urine, dizziness. Give ORS immediately."),
        ("Screen children for malnutrition","MUAC below 11.5 cm = emergency. Seek hospital care immediately."),
        ("Contact relief services","DGHS Nutrition: 16000  |  Dept. of Agriculture Extension: 16123"),
    ],
    "overall":[
        ("Stay tuned to official alerts","Follow Bangladesh Meteorological Dept and DDM for updates."),
        ("Prepare your emergency kit","Documents, medicine, 3-day water, food, torch, phone charger."),
        ("Know your cyclone shelter","Locate the nearest shelter or multi-storey building now."),
        ("Emergency contacts","Police/Fire/Ambulance: 999  |  DDM: 01938-524500  |  BDRCS: 01713-038989"),
    ],
}

def bar_row(label, baseline, boost, base_styles):
    total = min(10.0, baseline + boost)
    bar_w = 9.0 * cm
    bp = min(1.0, baseline/10.0)
    xp = min(1.0-bp, boost/10.0)
    ep = max(0.0, 1.0 - bp - xp)
    cols, data_row = [], [""]
    fill_data = [[]]
    fill_cols = []
    if bp > 0:
        fill_data[0].append("")
        fill_cols.append(bp * bar_w)
    if xp > 0:
        fill_data[0].append("")
        fill_cols.append(xp * bar_w)
    if ep > 0:
        fill_data[0].append("")
        fill_cols.append(ep * bar_w)

    bar_style = [
        ("TOPPADDING",(0,0),(-1,-1),0),("BOTTOMPADDING",(0,0),(-1,-1),0),
        ("GRID",(0,0),(-1,-1),0,colors.white),
    ]
    if bp > 0:
        bar_style.append(("BACKGROUND",(0,0),(0,0), sev_color(baseline)))
    if xp > 0:
        idx = 1 if bp>0 else 0
        bar_style.append(("BACKGROUND",(idx,0),(idx,0), C_RED))
    if ep > 0:
        idx = sum([1 if bp>0 else 0, 1 if xp>0 else 0])
        bar_style.append(("BACKGROUND",(idx,0),(idx,0), C_LGREY))

    bar_t = Table(fill_data, colWidths=fill_cols, rowHeights=[10])
    bar_t.setStyle(TableStyle(bar_style))

    sc_txt = "{:.1f}".format(total)
    if boost > 0.1:
        sc_txt += " (+{:.1f})".format(boost)

    lbl_p  = Paragraph("<b>"+label+"</b>",
                        ParagraphStyle("lb", parent=base_styles["Normal"], fontSize=9))
    sc_p   = Paragraph(sc_txt,
                        ParagraphStyle("sc", parent=base_styles["Normal"], fontSize=9,
                                       fontName="Helvetica-Bold", textColor=sev_color(total)))
    lvl_p  = Paragraph(sev_label(total),
                        ParagraphStyle("lv", parent=base_styles["Normal"], fontSize=7,
                                       textColor=sev_color(total)))
    row = Table([[lbl_p, bar_t, sc_p, lvl_p]],
                colWidths=[4.2*cm, bar_w, 2*cm, 2.0*cm], rowHeights=[18])
    row.setStyle(TableStyle([
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(-1,-1),2),("RIGHTPADDING",(0,0),(-1,-1),2),
        ("TOPPADDING",(0,0),(-1,-1),3),("BOTTOMPADDING",(0,0),(-1,-1),3),
    ]))
    return row

def build_pdf(data, out_path):
    district = data.get("district","Unknown")
    division = data.get("division","")
    scores   = data.get("scores",{})
    boosts   = data.get("boosts",{})
    events   = data.get("events",[])
    infra    = data.get("infraNearby",[])
    gen_time = datetime.now().strftime("%d %B %Y, %H:%M")

    doc = SimpleDocTemplate(out_path, pagesize=A4,
                            topMargin=1.4*cm, bottomMargin=1.6*cm,
                            leftMargin=1.8*cm, rightMargin=1.8*cm,
                            title="CrisisMap BD - "+district+" Risk Report")
    st = getSampleStyleSheet()
    story = []

    # Header banner
    hdr = Table([[
        Paragraph("<font color=white><b>CrisisMap BD</b>  District Risk Assessment Report</font>",
                  ParagraphStyle("hdr",parent=st["Normal"],fontSize=13,textColor=colors.white,leading=18)),
        Paragraph("<font color=white>"+gen_time+"</font>",
                  ParagraphStyle("hdrt",parent=st["Normal"],fontSize=8,textColor=colors.white,
                                 alignment=TA_RIGHT)),
    ]], colWidths=[12*cm, 5.67*cm], rowHeights=[30])
    hdr.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1),C_BDG),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(0,-1),10),
        ("RIGHTPADDING",(1,0),(1,-1),10),
    ]))
    story.append(hdr)
    story.append(Spacer(1,0.25*cm))

    # District title
    story.append(Paragraph(district,
        ParagraphStyle("dt",parent=st["Normal"],fontSize=24,fontName="Helvetica-Bold",
                       textColor=C_TEXT,spaceAfter=2)))
    div_txt = (division+" Division  |  " if division else "")+"Source: INFORM 2022 + GDACS Live + Crowd Reports"
    story.append(Paragraph(div_txt,
        ParagraphStyle("ds",parent=st["Normal"],fontSize=8,textColor=C_GREY,spaceAfter=6)))
    story.append(HRFlowable(width="100%",thickness=1,color=C_BDR,spaceAfter=8))

    # Overall risk badge
    ov = min(10.0, scores.get("ov",5) + boosts.get("overall",0))
    badge = Table([[
        Paragraph("OVERALL INFORM RISK SCORE",
                  ParagraphStyle("bl",parent=st["Normal"],fontSize=8,textColor=C_GREY,fontName="Helvetica-Bold")),
        Paragraph("{:.1f} / 10".format(ov),
                  ParagraphStyle("bs",parent=st["Normal"],fontSize=26,fontName="Helvetica-Bold",
                                 textColor=sev_color(ov),alignment=TA_CENTER)),
        Paragraph(sev_label(ov),
                  ParagraphStyle("bd",parent=st["Normal"],fontSize=11,fontName="Helvetica-Bold",
                                 textColor=sev_color(ov),alignment=TA_CENTER)),
    ]], colWidths=[5*cm,5.5*cm,7.17*cm], rowHeights=[38])
    badge.setStyle(TableStyle([
        ("BACKGROUND",(0,0),(-1,-1),C_LGREY),
        ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
        ("LEFTPADDING",(0,0),(-1,-1),10),("RIGHTPADDING",(0,0),(-1,-1),10),
    ]))
    story.append(badge)
    story.append(Spacer(1,0.35*cm))

    # Score bars
    story.append(Paragraph("Hazard & Vulnerability Scores",
        ParagraphStyle("h2",parent=st["Normal"],fontSize=11,fontName="Helvetica-Bold",
                       textColor=C_TEXT,spaceBefore=4,spaceAfter=5)))
    rows = [
        ("Flood Hazard",        scores.get("fl",0), boosts.get("flood",0)),
        ("Drought Hazard",      scores.get("dr",0), boosts.get("drought",0)),
        ("Overall INFORM Risk", scores.get("ov",0), boosts.get("overall",0)),
        ("Vulnerability",       scores.get("vu",0), 0),
        ("Lack of Coping Cap.", scores.get("cp",0), 0),
    ]
    for lbl, base, boost in rows:
        story.append(bar_row(lbl, base, boost, st))
        story.append(Spacer(1,2))

    if any(b > 0 for _,_,b in rows):
        story.append(Paragraph(
            "* Live boost from active GDACS events or crowd reports — shown in parentheses.",
            ParagraphStyle("note",parent=st["Normal"],fontSize=7,textColor=C_GREY,
                           fontStyle="italic",spaceAfter=4)))

    story.append(Spacer(1,0.3*cm))
    story.append(HRFlowable(width="100%",thickness=0.5,color=C_BORDER,spaceAfter=6))

    # Active events
    if events:
        story.append(Paragraph("Active Events Affecting This District",
            ParagraphStyle("h2",parent=st["Normal"],fontSize=11,fontName="Helvetica-Bold",
                           textColor=C_TEXT,spaceAfter=5)))
        ev_rows = [["Source","Event","Level","Date"]]
        for ev in events[:8]:
            ev_rows.append([
                "GDACS" if ev.get("source")=="gdacs" else "Crowd",
                (ev.get("title",""))[:55],
                ev.get("alertLevel") or ev.get("severity","—"),
                (ev.get("time",""))[:10],
            ])
        ev_t = Table(ev_rows, colWidths=[1.8*cm,9.8*cm,2*cm,2.07*cm])
        ev_t.setStyle(TableStyle([
            ("BACKGROUND",(0,0),(-1,0),C_BDG),("TEXTCOLOR",(0,0),(-1,0),colors.white),
            ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),
            ("FONTSIZE",(0,0),(-1,-1),8),
            ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,C_LGREY]),
            ("GRID",(0,0),(-1,-1),0.3,C_BORDER),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
            ("LEFTPADDING",(0,0),(-1,-1),5),
        ]))
        story.append(ev_t)
        story.append(Spacer(1,0.3*cm))
        story.append(HRFlowable(width="100%",thickness=0.5,color=C_BORDER,spaceAfter=6))

    # Infrastructure
    if infra:
        story.append(Paragraph("Critical Infrastructure in District",
            ParagraphStyle("h2",parent=st["Normal"],fontSize=11,fontName="Helvetica-Bold",
                           textColor=C_TEXT,spaceAfter=5)))
        inf_rows = [["Facility","Type","Address","Phone"]]
        for f in infra[:10]:
            inf_rows.append([
                (f.get("name","Unnamed"))[:40],
                (f.get("type","")).title(),
                (f.get("addr","—"))[:28],
                f.get("phone","—"),
            ])
        inf_t = Table(inf_rows, colWidths=[5.5*cm,2.2*cm,5*cm,3.67*cm])
        inf_t.setStyle(TableStyle([
            ("BACKGROUND",(0,0),(-1,0),C_BLUE),("TEXTCOLOR",(0,0),(-1,0),colors.white),
            ("FONTNAME",(0,0),(-1,0),"Helvetica-Bold"),
            ("FONTSIZE",(0,0),(-1,-1),8),
            ("ROWBACKGROUNDS",(0,1),(-1,-1),[colors.white,C_LGREY]),
            ("GRID",(0,0),(-1,-1),0.3,C_BORDER),
            ("VALIGN",(0,0),(-1,-1),"MIDDLE"),
            ("TOPPADDING",(0,0),(-1,-1),4),("BOTTOMPADDING",(0,0),(-1,-1),4),
            ("LEFTPADDING",(0,0),(-1,-1),5),
        ]))
        story.append(inf_t)
        story.append(Spacer(1,0.3*cm))
        story.append(HRFlowable(width="100%",thickness=0.5,color=C_BORDER,spaceAfter=6))

    # First aid tips
    fl = scores.get("fl",0) + boosts.get("flood",0)
    dr = scores.get("dr",0) + boosts.get("drought",0)
    hazard = "flood" if fl >= dr else "drought"
    tips = TIPS.get(hazard, TIPS["overall"])
    story.append(KeepTogether([
        Paragraph("First Aid & Safety — "+hazard.title()+" (Primary Hazard)",
            ParagraphStyle("h2",parent=st["Normal"],fontSize=11,fontName="Helvetica-Bold",
                           textColor=C_TEXT,spaceAfter=5)),
    ]))
    tip_rows = []
    for i,(t,b) in enumerate(tips):
        tip_rows.append([
            Paragraph("<b>"+str(i+1)+"</b>",
                      ParagraphStyle("tn",parent=st["Normal"],fontSize=10,textColor=C_BDR)),
            Paragraph("<b>"+t+"</b><br/><font size=8 color=#64615a>"+b+"</font>",
                      ParagraphStyle("tt",parent=st["Normal"],fontSize=9,leading=13)),
        ])
    tip_t = Table(tip_rows, colWidths=[0.7*cm,17.0*cm])
    tip_t.setStyle(TableStyle([
        ("VALIGN",(0,0),(-1,-1),"TOP"),
        ("TOPPADDING",(0,0),(-1,-1),5),("BOTTOMPADDING",(0,0),(-1,-1),5),
        ("LEFTPADDING",(0,0),(-1,-1),4),
        ("ROWBACKGROUNDS",(0,0),(-1,-1),[colors.white,C_LGREY]),
        ("GRID",(0,0),(-1,-1),0.3,C_BORDER),
    ]))
    story.append(tip_t)
    story.append(Spacer(1,0.4*cm))

    # Footer
    story.append(HRFlowable(width="100%",thickness=0.5,color=C_BORDER))
    story.append(Spacer(1,0.12*cm))
    story.append(Paragraph(
        "CrisisMap BD  |  Data: INFORM Subnational Risk Index 2022 (EU JRC / UN OCHA / MoDMR Bangladesh) + GDACS Live Feed  |  "+gen_time,
        ParagraphStyle("ft",parent=st["Normal"],fontSize=7,textColor=C_GREY,alignment=TA_CENTER)))
    story.append(Paragraph(
        "Auto-generated for field use. Verify with local authorities before deployment. Emergency: 999",
        ParagraphStyle("ft2",parent=st["Normal"],fontSize=7,textColor=C_GREY,
                       alignment=TA_CENTER,fontStyle="italic")))

    doc.build(story)

if __name__ == "__main__":
    if len(sys.argv) < 3:
        print("Usage: python3 generate_report.py <input.json> <output.pdf>")
        sys.exit(1)
    with open(sys.argv[1]) as f:
        data = json.load(f)
    build_pdf(data, sys.argv[2])
    print("OK")
