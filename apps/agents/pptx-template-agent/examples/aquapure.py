"""Hypothetical IC deck spec for "Project AquaPure" — a modular industrial
water purification platform, demonstrating template-driven deck composition.

This is a worked example specific to the IC template under templates/. The
agent itself is template-agnostic; this file simply hard-codes the shape names
that the IC template happens to expose."""

from __future__ import annotations

from pathlib import Path

from pptx_template_agent.models import DeckSpec, SlideUpdate

TEMPLATE = "templates/ic-template-v3.pptx"


def build() -> DeckSpec:
    return DeckSpec(
        deal_name="Project AquaPure",
        template=TEMPLATE,
        metadata={
            "sector": "Industrial Water / Cleantech",
            "deal_owner": "MS / RS",
            "advisor": "Lazard MidCap",
            "hq": "Manchester, UK",
            "ic_date": "30 May 2026",
        },
        slides=[
            # ---- Cover ----
            SlideUpdate(
                slide_index=0,
                fields={
                    "Text Placeholder 1": "Project AquaPure",
                    "Text Placeholder 2": "30 May 2026",
                },
            ),
            # ---- Slide 2: Actions from last IC ----
            SlideUpdate(
                slide_index=1,
                fields={
                    "Text Placeholder 4": (
                        "Actions from last IC | Follow-ups closed since kick-off"
                    ),
                    "Rectangle 14": (
                        "Site visit done at Manchester HQ and Rotterdam pilot"
                    ),
                    "Rectangle 15": (
                        "Commercial DD: Bain validated £4.2bn TAM, 9% CAGR"
                    ),
                    "Rectangle 16": (
                        "FDD: KPMG confirms £18.4m FY25A, 31% adj. EBITDA"
                    ),
                    "Rectangle 17": (
                        "Mgmt: Andersen cleared founder reinvest structure"
                    ),
                },
            ),
            # ---- Slide 3: Executive summary ----
            SlideUpdate(
                slide_index=2,
                fields={
                    "Text Placeholder 2": (
                        "Exec summary | Founder-led modular water platform with clear VCP"
                    ),
                    "Content Placeholder 2": [
                        [  # slot 1 — Market
                            "Market: £4.2bn EU industrial water, 9% CAGR",
                            "Drivers: PFAS regulation, water scarcity, ESG, data centres",
                        ],
                        [  # slot 2 — Business
                            "Business: 70% project + 30% recurring revenue",
                            "87% FY26F coverage; 31% adj. EBITDA margin",
                        ],
                        [  # slot 3 — Returns
                            "Returns: 8.5x entry on FY26F £6m EBITDA",
                            "3.4x MoM, 28% IRR base; downside protected by recurring base",
                        ],
                        [  # slot 4 — Risk
                            "Risk: Top-5 customers = 41% FY25A revenue",
                            "Mitigated by long-term frameworks + growing SME pipeline",
                        ],
                    ],
                },
            ),
            # ---- Slide 4: Company overview (4-quadrant) ----
            SlideUpdate(
                slide_index=3,
                fields={
                    "Text Placeholder 3": (
                        "Company overview | Modular water skids + IoT monitoring across Europe"
                    ),
                    "TextBox 18": [
                        "AquaPure designs, builds and services modular water purification "
                        "skids for industrial customers — pharma, food & beverage, semis, "
                        "data centres",
                        "Founded 2008 in Manchester (UK), 142 FTEs across UK, NL and Germany",
                        "100% owned by founder-CEO (Dr. R. Singh, ex-Suez); wants 50% cash "
                        "out and 5-year continued involvement",
                    ],
                    "TextBox 23": [
                        "Modular skids — 4-week install vs. 6 months bespoke",
                        "Proprietary membrane stack: 18% lower OPEX",
                        "IoT layer ('AquaSense') drives stickiness + upsell",
                    ],
                    "TextBox 25": [
                        "TAM £4.2bn EU industrial water, 9% CAGR",
                        "240+ customers; top-5 = 41% (AZN, Heineken, Equinix)",
                        "70% direct, 30% via Veolia / engineering partners",
                    ],
                    "TextBox 27": [
                        "Project (£0.6-2.5m ASP, 32% GM) + service (58% GM)",
                        "FY25A: £18.4m revenue, £5.7m EBITDA (31% margin)",
                        "FY26F: £24m revenue, £6m EBITDA, 92% cash conv.",
                    ],
                },
            ),
            # ---- Slide 5: Thesis (4 pillars) ----
            SlideUpdate(
                slide_index=4,
                fields={
                    "Text Placeholder 3": (
                        "Thesis | Build the European modular water leader via service + M&A"
                    ),
                    "Rectangle 25": "Service scale-up",
                    "Rectangle 27": "DACH + Nordics expansion",
                    "Rectangle 29": "Bolt-on M&A",
                    "Rectangle 30": "Operating model professionalisation",
                    "Rectangle 36": (
                        "Convert installed base of 1,400+ skids into recurring service "
                        "contracts; lift recurring mix from 30% → 50% by FY29"
                    ),
                    "Rectangle 37": (
                        "Open Frankfurt sales hub and acquire local service partner; "
                        "follow strategic customers (Heineken, GSK) into new geographies"
                    ),
                    "Rectangle 38": (
                        "5-7 bolt-ons identified across UK, NL, DE — fragmented service "
                        "businesses at 4-6x EBITDA, accretive at deal-close"
                    ),
                    "Rectangle 39": (
                        "Upgrade ERP (D365), institutionalise pipeline mgmt, hire CFO / "
                        "VP Service; founder transitions to Chair within 24 months"
                    ),
                    # Clear the [xxxx] header/footer placeholders on the
                    # thesis slide — the template ships with them as visual
                    # spacers, not content slots. The linter would otherwise
                    # flag them as unfilled stock patterns.
                    "Rounded Rectangle 31": "",
                },
            ),
            # ---- Slide 6: VCP table ----
            SlideUpdate(
                slide_index=5,
                fields={
                    "Text Placeholder 2": (
                        "VCP | Levers quantified — metric, today vs. target, actions"
                    ),
                    "Text Placeholder 3": "Value creation levers",
                },
                tables={
                    "Tabelle 3": [
                        ["VC lever", "Target", "Upside Target", "Today", "Driver", "Actions"],
                        ["Recurring service mix",
                         "50% by FY29", "55%", "30% (FY25A)",
                         "Installed base monetisation",
                         "Tiered service tiers / SLA bundles"],
                        ["DACH expansion",
                         "€8m revenue", "€11m", "€1.5m (FY25A)",
                         "Frankfurt hub + local M&A",
                         "Open hub Q1 FY27; acquire German service co."],
                        ["EBITDA margin",
                         "36% by FY30", "38%", "31% (FY25A)",
                         "Service mix + procurement",
                         "Restructure supplier base; SaaS-tier pricing"],
                        ["Bolt-on M&A",
                         "5 deals", "7", "Pipeline live",
                         "Fragmented service market",
                         "Live DD on UK target; 4 more in advanced pipeline"],
                        ["Exit multiple",
                         "12.0x EBITDA", "14.0x", "8.5x (entry)",
                         "Scale + recurring mix + ESG halo",
                         "Position as 'European water platform' to PE/trade"],
                    ],
                },
            ),
            # ---- Slide 7: Key risks ----
            SlideUpdate(
                slide_index=6,
                fields={
                    "Text Placeholder 3": (
                        "Key risks | DD findings, mitigants and 100-day plan owners"
                    ),
                },
                tables={
                    "Tabelle 3": [
                        ["Workstream", "RAG", "Key findings", "Mitigants / Actions"],
                        ["Customer concentration", "",
                         "Top-5 customers = 41% FY25A revenue; AstraZeneca 14% alone",
                         "Long-term frameworks (3-5y); broaden SME book; KAM hire"],
                        ["Founder dependency", "",
                         "CEO is principal commercial relationship for top accounts",
                         "Founder reinvest 25%; 2-yr earn-out tied to retention; COO promotion"],
                        ["Supply chain — membranes", "",
                         "Single-source from Toray (JP); 14-week lead time in FY24",
                         "Qualifying Suez (FR) as second source; building 90-day buffer"],
                        ["Regulation upside risk", "",
                         "EU PFAS rules driving demand but also tightening discharge limits",
                         "Compliance lab in place; advisory board incl. ex-Environment Agency"],
                        ["FX / GBP-EUR", "",
                         "60% revenue EUR, 50% costs GBP — natural mismatch",
                         "Hedging programme to cover 80% of 12-month forward net EUR exposure"],
                        ["ESG / reputational", "",
                         "Greenwashing scrutiny in cleantech; PFAS exposure liabilities",
                         "Big-4 ESG DD clean; D&O policy + run-off cover at completion"],
                    ],
                },
                rag={
                    "Tabelle 3!1,1": "amber",
                    "Tabelle 3!2,1": "amber",
                    "Tabelle 3!3,1": "amber",
                    "Tabelle 3!4,1": "green",
                    "Tabelle 3!5,1": "green",
                    "Tabelle 3!6,1": "green",
                },
            ),
            # ---- Slide 8: Blixt primary DD ----
            SlideUpdate(
                slide_index=7,
                fields={
                    "Text Placeholder 2": (
                        "Blixt primary DD | Thesis validation via 5 operator interviews"
                    ),
                    "Text Placeholder 3": "Thesis validation by operator",
                },
                tables={
                    "Tabelle 3": [
                        ["Thesis", "Op1 (ex-Veolia)", "Op2 (ex-Suez)",
                         "Op3 (ex-Pall)", "Op4 (Heineken)", "Op5 (DC ops)"],
                        ["Modular > bespoke",
                         "Confirmed — speed wins",
                         "Confirmed — modular share +200bps/yr",
                         "Agreed — but custom still 60%",
                         "Strong preference for modular",
                         "Critical for DC build pace"],
                        ["Service mix shift",
                         "Recurring is the unlock",
                         "Achievable; needs FSE hire",
                         "Yes — sticky once installed",
                         "We sign 3-yr service contracts",
                         "24/7 SLAs required"],
                        ["DACH demand growth",
                         "Driven by EU PFAS",
                         "Confirmed — fastest in EU",
                         "Yes; underpenetrated mid-market",
                         "Heineken DE: 4 plants in plan",
                         "Frankfurt is the hub"],
                        ["Bolt-on availability",
                         "Fragmented; 5+ targets",
                         "Confirmed; 3 priced",
                         "M&A market is open",
                         "n/a (customer)",
                         "n/a (customer)"],
                    ],
                },
            ),
            # ---- Slide 9: People ----
            SlideUpdate(
                slide_index=8,
                fields={
                    "Text Placeholder 2": (
                        "People | Strong founder-led core; CFO + VP Service to recruit"
                    ),
                    "Text Placeholder 3": "Existing team",
                    "Rectangle 9": "New hires required",
                },
                tables={
                    "Table 7": [
                        ["Role / Name", "RAG", "Performance Review", "Action"],
                        ["CEO — Dr. R. Singh",
                         "",
                         "Founder; 20+ yrs water sector (ex-Suez)",
                         "Retain; 2-yr earn-out + Chair transition"],
                        ["COO — Lisa Chen",
                         "",
                         "Operations strength; light commercial",
                         "Promote to MD; KAM hire to support"],
                        ["CTO — Mark Patel",
                         "",
                         "AquaSense product owner; well regarded",
                         "Retain; equity participation in MIP"],
                        ["CFO — vacant",
                         "",
                         "Interim finance director only",
                         "Backfill with PE-experienced CFO"],
                    ],
                    "Table 10": [
                        ["Role", "RAG", "Description", "Action"],
                        ["CFO",
                         "",
                         "PE-grade reporting + financing",
                         "Search via Eric Salmon; close Q1"],
                        ["VP Service",
                         "",
                         "Drive recurring mix to 50% by FY29",
                         "Internal promotion or external hire"],
                        ["Sales Director DACH",
                         "",
                         "Open Frankfurt hub + key accounts",
                         "Local search; co-hire with bolt-on"],
                    ],
                },
                rag={
                    "Table 7!1,1": "green",
                    "Table 7!2,1": "amber",
                    "Table 7!3,1": "green",
                    "Table 7!4,1": "red",
                    "Table 10!1,1": "amber",
                    "Table 10!2,1": "green",
                    "Table 10!3,1": "amber",
                },
            ),
            # ---- Slide 10: Market ----
            SlideUpdate(
                slide_index=9,
                fields={
                    "Text Placeholder 2": (
                        "Market | £4.2bn EU industrial water, 9% CAGR, regulation-driven"
                    ),
                    "Text Placeholder 3": "Market summary",
                    "Rectangle 23": (
                        "EU industrial water treatment: £4.2bn (2025), 9% CAGR to 2030 — "
                        "modular skid sub-segment growing 14% on bespoke replacement"
                    ),
                    "Rectangle 24": (
                        "Drivers: PFAS regulation (EU directive 2024), water scarcity "
                        "(c.40% of EU regions stressed by 2030), corporate ESG mandates, "
                        "data centre boom"
                    ),
                    "Rectangle 25": (
                        "Ecosystem: 3 large incumbents (Veolia, Suez, Xylem) focused on "
                        "bespoke plants; 100+ regional specialists serve mid-market with "
                        "limited service offering"
                    ),
                    "Rectangle 26": (
                        "Competition: AquaPure is #2 modular specialist in UK/NL; "
                        "competes with Pall (US), Berghof (DE), Memcor (XYL). Differentiated "
                        "on speed-to-install + IoT layer"
                    ),
                    "Rectangle 27": (
                        "Primary research: 22 customer interviews (NPS 67), 8 ex-Veolia "
                        "operators confirmed modular is taking 200-300bps share/year from "
                        "bespoke incumbents"
                    ),
                },
            ),
            # ---- Slide 11: Historical financials ----
            SlideUpdate(
                slide_index=10,
                fields={
                    "Text Placeholder 3": (
                        "Historical financials | Accelerating growth, margin expansion"
                    ),
                    # Rectangle 6 is the "Comments" header label (37c × 1) —
                    # not a content area. Leave the takeaways unwritten and
                    # rely on the inset table; agents can author a follow-up
                    # version with a dedicated comments shape if required.
                },
                tables={
                    "Table 7": [
                        ["£k (y/e Dec)", "FY21A", "FY22A", "FY23A", "FY24A", "FY25A"],
                        ["P&L", "", "", "", "", ""],
                        ["Revenue", "8,300", "10,900", "13,400", "15,800", "18,400"],
                        ["  Project revenue", "6,700", "8,600", "10,300", "11,700", "12,900"],
                        ["  Service revenue", "1,600", "2,300", "3,100", "4,100", "5,500"],
                        ["Growth %", "—", "31%", "23%", "18%", "16%"],
                        ["Cost of sales", "(5,980)", "(7,520)", "(8,840)", "(9,950)", "(11,240)"],
                        ["Gross profit", "2,320", "3,380", "4,560", "5,850", "7,160"],
                        ["Gross margin %", "28%", "31%", "34%", "37%", "39%"],
                        ["Opex", "(820)", "(1,090)", "(1,360)", "(1,580)", "(1,460)"],
                        ["Adj. EBITDA", "1,500", "2,290", "3,200", "4,270", "5,700"],
                        ["EBITDA margin %", "18%", "21%", "24%", "27%", "31%"],
                        ["D&A", "(180)", "(220)", "(260)", "(310)", "(360)"],
                        ["EBIT", "1,320", "2,070", "2,940", "3,960", "5,340"],
                        ["", "", "", "", "", ""],
                        ["Cash flow", "", "", "", "", ""],
                        ["OCF", "1,460", "2,180", "2,650", "3,990", "5,180"],
                        ["Capex", "(220)", "(310)", "(380)", "(440)", "(520)"],
                        ["FCF", "1,240", "1,870", "2,270", "3,550", "4,660"],
                        ["Cash conversion %", "97%", "95%", "83%", "94%", "91%"],
                        ["", "", "", "", "", ""],
                        ["Working capital", "", "", "", "", ""],
                        ["WC % revenue", "12%", "11%", "14%", "11%", "10%"],
                    ],
                },
            ),
            # ---- Slide 13: S&U + Valuation ----
            SlideUpdate(
                slide_index=12,
                fields={
                    "Text Placeholder 3": (
                        "S&U | Founder reinvest + thin senior debt; £36m sponsor cheque"
                    ),
                    # Rectangle 6 is the "Comments" header (32c × 1); skip.
                },
                tables={
                    "Table 11": [
                        ["Sources", "£m", "xEBITDA (Day 1)", "xEBITDA (Day 2)",
                         "", "Uses", "£m", "xEBITDA / (Day 1)", "xEBITDA  / (Day 2)"],
                        ["Senior debt (TLB)", "18.0", "3.0x", "2.6x",
                         "", "Equity purchase", "47.6", "7.9x", "6.9x"],
                        ["Founder reinvest", "5.4", "0.9x", "0.8x",
                         "", "Refinance net debt", "(3.1)", "(0.5x)", "(0.5x)"],
                        ["Sponsor equity (Blixt)", "30.6", "5.1x", "4.4x",
                         "", "Transaction fees", "2.4", "0.4x", "0.3x"],
                        ["MIP", "0.0", "—", "—",
                         "", "MIP funding", "0.0", "—", "—"],
                        ["Total", "54.0", "9.0x", "7.8x",
                         "", "Total", "46.9", "7.8x", "6.8x"],
                    ],
                    "Table 12": [
                        ["  Valuation", "", "£m"],
                        ["Enterprise value", "", "51.0"],
                        ["EV / FY26F EBITDA", "", "8.5x"],
                        ["EV / FY26F Revenue", "", "2.1x"],
                        ["Less: net debt", "", "(3.1)"],
                        ["Equity value (100%)", "", "47.9"],
                        ["Less: founder reinvest (25%)", "", "(12.0)"],
                        ["Sponsor equity (Blixt)", "", "30.6"],
                        ["Cum. fees / MIP", "", "(2.4)"],
                        ["Net Blixt equity", "", "28.2"],
                        ["Implied entry multiple (Day 2)", "", "7.8x"],
                    ],
                },
            ),
            # ---- Slide 15: Forecast + Returns ----
            SlideUpdate(
                slide_index=14,
                fields={
                    "Text Placeholder 3": (
                        "Forecast | 23% CAGR to FY30, 36% margin, 3.4x MoM / 28% IRR"
                    ),
                    "Rectangle 14": [
                        "Revenue: £24m → £55m (23% CAGR to FY30)",
                        "EBITDA: £6m → £19.8m; margin 25% → 36%",
                        "Bolt-ons add £8m revenue / £2.5m EBITDA",
                        "Exit 12.0x FY30 → £238m EV; £56m proceeds",
                        "3.4x MoM, 28% IRR base; 2.2x downside",
                    ],
                },
                tables={
                    "Table 11": [
                        ["€m", "FY25", "FY26", "FY27", "FY28", "FY29", "FY30"],
                        ["Revenue", "18.4", "24.0", "30.5", "38.0", "46.5", "55.0"],
                        ["  Project", "12.9", "16.0", "19.4", "23.0", "26.5", "30.0"],
                        ["  Service", "5.5", "8.0", "11.1", "15.0", "20.0", "25.0"],
                        ["Growth %", "16%", "30%", "27%", "25%", "22%", "18%"],
                        ["", "", "", "", "", "", ""],
                        ["Gross profit", "7.2", "9.6", "12.5", "15.9", "20.0", "23.7"],
                        ["GP margin %", "39%", "40%", "41%", "42%", "43%", "43%"],
                        ["", "", "", "", "", "", ""],
                        ["Adj. EBITDA", "5.7", "6.0", "8.2", "11.0", "15.0", "19.8"],
                        ["EBITDA margin %", "31%", "25%", "27%", "29%", "32%", "36%"],
                        ["", "", "", "", "", "", ""],
                        ["D&A", "(0.4)", "(0.5)", "(0.6)", "(0.7)", "(0.8)", "(0.9)"],
                        ["EBIT", "5.3", "5.5", "7.6", "10.3", "14.2", "18.9"],
                        ["", "", "", "", "", "", ""],
                        ["FCF (post-tax)", "4.7", "4.4", "5.9", "8.0", "11.0", "14.5"],
                        ["Cum. FCF", "—", "4.4", "10.3", "18.3", "29.3", "43.8"],
                        ["", "", "", "", "", "", ""],
                        ["Net debt", "(3.1)", "13.6", "7.7", "(0.3)", "(11.3)", "(25.8)"],
                        ["Leverage (xEBITDA)", "(0.5)x", "2.3x", "0.9x", "—", "—", "—"],
                        ["", "", "", "", "", "", ""],
                    ],
                    "Table 12": [
                        ["€m", "FY26", "FY27", "FY28", "FY29", "FY30"],
                        ["Exit EBITDA", "6.0", "8.2", "11.0", "15.0", "19.8"],
                        ["Exit Multiple", "8.5x", "9.5x", "10.5x", "11.5x", "12.0x"],
                        ["Exit EV", "51", "78", "116", "173", "238"],
                        ["Less: net debt", "(14)", "(8)", "0", "11", "26"],
                        ["Equity value", "37", "70", "116", "184", "264"],
                        ["", "", "", "", "", ""],
                        ["Sponsor equity (66%)", "24", "46", "77", "121", "174"],
                        ["MoM", "0.9x", "1.6x", "2.7x", "4.3x", "6.2x"],
                        ["", "", "", "", "", ""],
                        ["Base case (12.0x, FY30)", "", "", "", "", ""],
                        ["  Sponsor proceeds", "", "", "", "", "56"],
                        ["  MoM", "", "", "", "", "3.4x"],
                        ["  IRR", "", "", "", "", "28%"],
                        ["", "", "", "", "", ""],
                        ["Downside (8.5x, FY30 -20%)", "", "", "", "", ""],
                        ["  MoM / IRR", "", "", "", "", "2.2x / 18%"],
                    ],
                },
            ),
            # ---- Slide 12: Trading KPIs ----
            SlideUpdate(
                slide_index=11,
                fields={
                    "Text Placeholder 2": (
                        "Trading KPIs | Recurring base, pipeline coverage, retention"
                    ),
                    "Rectangle 7": [
                        "Installed base: 1,400+ skids across 240+ customers",
                        "Recurring mix: 30% FY25A → target 50% by FY29",
                        "Customer NPS: 67 (Q4 FY25); 92% retention",
                        "Pipeline: £45m weighted, 87% FY26F revenue coverage",
                        "Sales productivity: £1.2m revenue / FTE (top quartile)",
                        "Win rate: 38% of qualified opportunities (FY25)",
                        "Average contract length: 4.2 yrs (service); 0.6 yrs (project)",
                        "Membrane stack lead time: 14w (Toray) → 6w (Suez qualification)",
                    ],
                },
            ),
            # ---- Slide 14: Financing ----
            SlideUpdate(
                slide_index=13,
                fields={
                    "Text Placeholder 2": (
                        "Financing | £18m TLB at SONIA+575, 3.0x opening leverage"
                    ),
                    "Rectangle 5": [
                        "Facility: £18m senior TLB; 5-year bullet maturity",
                        "Pricing: SONIA + 5.75%; 1% OID; arrangement fee 2.5%",
                        "Leverage: 3.0x EBITDA opening, 2.6x by Day 2",
                        "Covenants: leverage 4.0x with 35% headroom; LTV 65%",
                        "Lender: Barclays-led; clubbed with Investec, Beechbrook",
                        "Amortisation: 1% p.a.; 50% excess cash sweep above 2.5x",
                        "Use of proceeds: equity purchase + transaction fees",
                        "Conditions precedent: clean FDD, ESG sign-off, W&I bind",
                    ],
                },
            ),
            # ---- Slide 19: Transaction Fees ----
            SlideUpdate(
                slide_index=18,
                fields={
                    "Text Placeholder 3": (
                        "Transaction fees | £2.8m total — 5.5% of EV"
                    ),
                },
                tables={
                    "Table 7": [
                        ["Workstream", "Advisor", "Cost (£k)", "Additional Notes"],
                        ["M&A advisory", "Lazard MidCap", "850",
                         "Success fee 1.5% of EV, retainer credit"],
                        ["Buy-side legal", "Travers Smith", "420",
                         "SPA, ancillaries, W&I co-ordination"],
                        ["Financial DD", "KPMG", "380", "Confirmatory FDD + tax structuring"],
                        ["Commercial DD", "Bain & Co", "320",
                         "Custom UK/EU market study, NPS"],
                        ["ESG DD", "ERM", "95", "Light DD; PFAS exposure scope"],
                        ["Tax structuring", "Andersen", "110", "UK + NL + DE step plan"],
                        ["Insurance / W&I", "Aon", "245",
                         "25% policy cap, 3-yr; broker fee inc."],
                        ["Bank legal", "A&O Shearman", "250", "Facilities + security docs"],
                        ["Pension review", "Mercer", "45", "Defined-contribution scheme"],
                        ["Operational DD", "Internal", "0", "Done by Blixt portfolio team"],
                        ["IT / cyber DD", "PwC", "60", "Light DD; AquaSense platform"],
                        ["Sundry / data room", "—", "20", "Translations, secure VDR"],
                        ["Total", "", "2,795", "≈ 5.5% of £51m EV"],
                    ],
                },
            ),
            # ---- Slide 21: Exit ----
            SlideUpdate(
                slide_index=20,
                fields={
                    "Text Placeholder 3": (
                        "Exit | 'European water platform' to strategic / larger PE at 12.0x"
                    ),
                    "Rectangle 5": [
                        "Target exit: FY30 at 12.0x EBITDA (£238m EV, £56m sponsor proceeds)",
                        "Equity story: European modular water platform with 50% recurring "
                        "service mix and proven bolt-on integration playbook",
                        "Likely buyer universe — TRADE: Veolia, Suez, Xylem, Pentair, "
                        "Ecolab; strategic interest in modular + IoT capability",
                        "Likely buyer universe — PE: EMK Capital, Livingbridge, Inflexion, "
                        "Bridgepoint Growth (current cleantech mandates)",
                        "Validation: 3 inbound approaches to Blixt in last 12 months for "
                        "comparable assets; pricing in 10-13x range",
                        "Process: dual-track preferred — IM to trade Q1 FY30, parallel PE "
                        "outreach; Lazard / Rothschild as advisor",
                    ],
                },
            ),
        ],
    )


if __name__ == "__main__":
    import logging
    import sys

    from pptx_template_agent.injection import fill_deck

    logging.basicConfig(level=logging.INFO, format="%(message)s")
    spec = build()
    out_path = Path(sys.argv[1]) if len(sys.argv) > 1 else Path("output/aquapure.pptx")
    path, report = fill_deck(spec, out_path)
    print(f"\nWrote {path}")
    print(f"  fields applied: {report.fields_applied}")
    print(f"  tables applied: {report.tables_applied}")
    print(f"  rag applied:    {report.rag_applied}")
    if not report.is_clean:
        print(f"\n  missing fields: {report.fields_missing}")
        print(f"  missing tables: {report.tables_missing}")
        print(f"  missing rag:    {report.rag_missing}")
