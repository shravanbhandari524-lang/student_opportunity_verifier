# Guides Review & Fact Verification Audit

This document records every claim asserted across the educational guides in `lib/guides/content.js`, its corresponding source identifier, and its verification status. This allows a human reviewer to audit each sentence against official records before public deployment.

## Guide Claims & Source Audit Table

| Guide Type | Claim Statement | Source ID(s) | Source Name & Stored URL | Verified by Human |
|---|---|---|---|---|
| `scholarship_scam` | Genuine government scholarship schemes are hosted on official government domains ending in .gov.in or .nic.in. | `national_scholarship_portal`<br>`known_domains_education` | National Scholarship Portal (`https://scholarships.gov.in`)<br>Ministry of Education (`https://www.education.gov.in`) | |
| `scholarship_scam` | Legitimate scholarships disburse funds directly to students and do not demand an upfront fee to release money. | `national_scholarship_portal` | National Scholarship Portal (`https://scholarships.gov.in`) | |
| `scholarship_scam` | Scanning a QR code or entering a UPI PIN authorizes a debit from your account, never a credit. | `pib_fact_check` | PIB Fact Check (`https://factcheck.pib.gov.in`) | |
| `internship_scam` | Legitimate corporate recruiters do not demand monetary deposits or training fees as a prerequisite for hiring. | `mca_portal`<br>`aicte_internship_portal` | Ministry of Corporate Affairs (`https://www.mca.gov.in`)<br>AICTE Internship Portal (`https://internship.aicte-india.org`) | |
| `internship_scam` | Corporate status and active legal existence can be verified in public company registries. | `mca_portal`<br>`gst_portal` | Ministry of Corporate Affairs (`https://www.mca.gov.in`)<br>GST Taxpayer Search (`https://www.gst.gov.in`) | |
| `task_scam` | Initial token payouts are a recognized social-engineering tactic used to lure victims into larger deposit traps. | `pib_fact_check` | PIB Fact Check (`https://factcheck.pib.gov.in`) | |
| `task_scam` | Promising guaranteed earnings for rating tasks with mandatory deposits is characteristic of organized online task scams. | `pib_fact_check`<br>`mca_portal` | PIB Fact Check (`https://factcheck.pib.gov.in`)<br>Ministry of Corporate Affairs (`https://www.mca.gov.in`) | |
| `mule_account` | Allowing your bank account to be used for routing third-party funds constitutes unauthorized money mule activity with severe consequences. | `pib_fact_check` | PIB Fact Check (`https://factcheck.pib.gov.in`) | |
| `mule_account` | Banks and official authorities never ask customers to share OTPs, net banking passwords, or ATM PINs. | `pib_fact_check` | PIB Fact Check (`https://factcheck.pib.gov.in`) | |
| `contest_fraud` | Unverifiable organizers frequently copy established institutional branding to collect unearned entry fees. | `mca_portal`<br>`known_domains_education` | Ministry of Corporate Affairs (`https://www.mca.gov.in`)<br>Ministry of Education (`https://www.education.gov.in`) | |
| `contest_fraud` | Authentic university competitions are announced through official institutional portals or established competition aggregators. | `known_domains_education` | Ministry of Education (`https://www.education.gov.in`) | |
| `overseas_agent` | Submitting forged academic or financial records to foreign embassies or universities leads to visa rejections; details to be confirmed with an official source. | `pib_fact_check`<br>`ugc_portal` | PIB Fact Check (`https://factcheck.pib.gov.in`)<br>University Grants Commission (`https://www.ugc.ac.in`) | |
| `overseas_agent` | Higher education regulatory advisories warn students against unaccredited institutions and unverified overseas consultants. | `ugc_portal`<br>`mca_portal` | University Grants Commission (`https://www.ugc.ac.in`)<br>Ministry of Corporate Affairs (`https://www.mca.gov.in`) | |

---

## Sentences & Nuances Flagged for Explicit Human / Subject-Matter Review
The following sentences reflect general fraud prevention knowledge in India and repository facts. They should receive formal subject-matter verification prior to public deployment:

1. **`overseas_agent` / Forgery consequences**:
   > *"Submitting forged academic or financial records to foreign embassies or universities leads to visa rejections; details to be confirmed with an official source."*
   - *Review note*: All specific statutory penalty or entry ban claims have been removed; specifics are marked for confirmation with official sources.

2. **`mule_account` / Account Holder Risk**:
   > *"Funds derived from illicit activity are routed through the student's account; details of account misuse should be verified with your bank."*
   - *Review note*: Specific criminal liability and statutory legal assertions have been replaced with direct bank verification directives.

3. **`task_scam` / Pre-condition deposit wording**:
   > *"Decline offers that require paying your own money to earn money or unlock work assignments."*
   - *Review note*: Accurate description of task deposit fraud in India; ensure clarity so legitimate freelance platforms with profile verification deposits are not conflated.

4. **Reporting Channel Status**:
   - Both National Cyber Crime Reporting Portal and Chakshu Portal are kept strictly with unverified advisory disclaimer (`url: null, helpline: null, verified: false`) and text `"verify on the official site"` until official helpline phone numbers and deep URLs are verified by humans.
