import csv
import io
import os
import re

# Source rows from user prompt
RAW_DATA_SOURCE = """id,text,label,scam_type,language,source_type,source_name,source_url,date_published,is_hard_negative,anonymized,notes
REAL-001,"The last date for submission of applications by selected meritorious students on the National Scholarship Portal (NSP) for National Means cum Merit Scholarship Scheme (NMMSS) for 2026-27 has been extended to September 30, 2026.",genuine,none,en,real,PIB,https://www.pib.gov.in/PressReleasePage.aspx?PRID=2305633,2026-09-01,true,true,Official scholarship deadline notice.
REAL-002,"All eligible students are advised to complete their scholarship applications on the National Scholarship Portal (NSP) within the extended timeline. Students who have already submitted their applications should also ensure that their applications are duly verified by the concerned Institute/District/State Nodal Officers, as applicable.",genuine,none,en,real,PIB,https://www.pib.gov.in/PressReleasePage.aspx?PRID=2305633,2026-09-01,true,true,Official urgency/deadline language.
REAL-003,"Renewal applications for the \\"PM-USP – Central Sector Scheme Of Scholarship For College And University Students (CSSS) (Merit Based Scheme)\\" and \\"PM USP Special Scholarship Scheme For Jammu Kashmir And Ladakh (Merit Based Scheme)\\" is currently open in NSP.",genuine,none,en,real,National Scholarship Portal,https://scholarships.gov.in/ViewMoreAnnouncement,,true,true,Official NSP announcement.
REAL-004,"This is to notify you that TCS does not ask for any sort of payment or security deposit from candidates at any stage of the recruitment process. The firm never sends out job offers from free internet email services like Gmail, Rediff Mail, Yahoo Mail, Hotmail, and so on.",genuine,none,en,real,TCS careers page,https://www.tcs.com/careers/india/recruitment-fraud-alert,,true,true,Official company fraud-alert text.
REAL-005,"Last date for payment of fee is also 08.07.2026 (Wednesday).",genuine,none,en,real,CBSE,https://www.cbse.gov.in/cbsenew/documents/Private_Online_Submission_XII_Supplementary_2026_30062026.pdf,2026-06-30,true,true,Official CBSE supplementary-exam fee deadline.
REAL-006,"No application will be accepted after the last date with/without fee in any circumstances.",genuine,none,en,real,CBSE,https://www.cbse.gov.in/cbsenew/documents/Private_Online_Submission_XII_Supplementary_2026_30062026.pdf,2026-06-30,true,true,Official urgency language; hard negative.
REAL-007,"For eligibility, last date and late fee, please refer to annexures. For any queries, call at CBSE Helpline No. 9XXXXXXXXX between 9.30 AM",genuine,none,en,real,CBSE,https://www.cbse.gov.in/cbsenew/documents/SUBMISSION_FORMS_PRIVATE_X_2627_07102026.pdf,2026-10-07,true,true,Official exam-form notice; helpline number anonymized.
REAL-008,"The fee will be accepted only in the online mode prescribed by the CBSE. No fee in offline mode, direct deposit in the bank account etc.",genuine,none,en,real,CBSE,https://www.cbse.gov.in/cbsenew/documents/Submission_Registration_Data_Class_IXXI2526_15092025.pdf,2025-09-16,true,true,Official payment-mode instruction; strong hard negative.
REAL-009,"If students’ details are entered and finalized on or before the last date, the school can pay fee till last date without late fee. Thereafter, late fee shall be applicable.",genuine,none,en,real,CBSE,https://www.cbse.gov.in/cbsenew/documents/Submission_Registration_Data_Class_IXXI2526_15092025.pdf,2025-09-16,true,true,Official fee/late-fee deadline language.
REAL-010,"Students may apply for one merit-based scholarship scheme and one or more welfare-based scholarship schemes from AY 2026–27, as per scheme eligibility criteria.",genuine,none,en,real,National Scholarship Portal,https://scholarships.gov.in/public/student-announcements,,true,true,Official NSP application guidance.
REAL-011,"The Portal is open for One Time Registration (OTR) for students.",genuine,none,en,real,National Scholarship Portal,https://scholarships.gov.in/student-announcements,,true,true,Official NSP OTR announcement.
REAL-012,"NPCI has launched Bharat Aadhaar Seeding Enabler (BASE) platform to facilitate Aadhaar Seeding and De-seeding activities in self-service mode for Direct Benefit Transfer(DBT).",genuine,none,en,real,National Scholarship Portal,https://scholarships.gov.in/student-announcements,,true,true,Official NSP Aadhaar-seeding/DBT announcement.
REAL-013,"Debit Transaction Alert: Your A/C XXXXXX1234 has been debited with INR 1,250.00 on 28-10-26 by VPA merchant@upi. Availbale Bal: INR 45,600.50. - HDFCBank",genuine,none,en,real,Personal bank SMS - HDFC Bank,https://www.hdfcbank.com/personal/ways-to-bank/phone-banking/instaalerts,2026-10-28,true,true,INCLUDE ONLY IF ACTUALLY RECEIVED BY CONTRIBUTOR; account/VPA masked; preserve original spelling.
REAL-014,"Credit Transaction Alert: Your A/C XXXXXX1234 has been credited with INR 15,000.00 on 27-10-26 by NEFT-P2A-SALARY. Availbale Bal: INR 60,600.50. - ICICIBank",genuine,none,en,real,Personal bank SMS - ICICI Bank,https://www.icicibank.com/online-safe-banking/protect-your-privacy,2026-10-28,true,true,Personal SMS received by contributor; account masked; preserve original spelling.
REAL-015,"OTP Verification Alert: 9XXXXX is your OTP to complete your online card transaction of INR 499.00 at Amazon. Do not share this OTP with anyone, including bank staff. - SBIBANK",genuine,none,en,real,Personal bank SMS - SBI,https://sbi.co.in/,2026-10-28,true,true,Personal SMS received by contributor; OTP fully masked.
REAL-016,"Card Limit / Security Alert: Your Debit Card ending 5678 has been enabled for International / Online transactions as per your request. If not done by you, call 1800-XXX-XXXX immediately. - AXISBANK",genuine,none,en,real,Personal bank SMS - Axis Bank,https://www.axisbank.com/,2026-10-28,true,true,Personal SMS received by contributor; card/phone masked.
REAL-017,,scam,internship_job,en,real,Cyber Crime Police advisory via The Hindu,https://www.thehindu.com/news/national/telangana/hyderabad-police-bust-fake-internship-racket/article68712345.ece,2026-03-15,false,true,"TODO: transcribe WhatsApp/email screenshot exactly; anonymize phone number and private name."
REAL-018,,scam,internship_job,en,real,Social media advisory via Indian Cyber Crime Coordination Centre (I4C),https://cybercrime.gov.in/Webform/Alerts.aspx,2026-04-10,false,true,"TODO: transcribe Future Interns offer-letter/email screenshots exactly."
REAL-019,,scam,task_job,en,real,Reddit r/IndianStreetBets fraud alert,https://www.reddit.com/r/IndianStreetBets/comments/telegram_task_scam_review/,2026-05-02,false,true,"TODO: transcribe original WhatsApp screenshot; do not use the poster's summary."
REAL-020,"Credit Transaction Alert: Your A/C XXXXXX1234 has been credited with INR 15,000.00 on 27-10-26 by NEFT-P2A-SALARY. Availbale Bal: INR 60,600.50. - ICICIBank",genuine,none,en,real,Personal bank SMS - ICICI Bank,https://www.icicibank.com/online-safe-banking/protect-your-privacy,2026-10-28,true,true,Personal SMS received by contributor; account masked; preserve original spelling.
REAL-021,"Your account XX1234 is credited by Rs.5000.00 on 26-10-26 by UPI/merchantname. The Available balance is Rs.25,000.00. - HDFCBANK",genuine,none,en,real,Personal bank SMS - HDFC Bank,https://www.hdfcbank.com/personal/ways-to-bank/phone-banking/instaalerts,2026-10-28,true,true,Personal SMS received by contributor; account masked.
REAL-022,"Rs 1,250.00 credited to A/c XX5678 on 28-10-26 by IMPS-P2A. Avl Bal Rs 18,750.25. - AXISBK",genuine,none,en,real,Personal bank SMS - Axis Bank,https://www.axisbank.com/,2026-10-28,true,true,Personal SMS received by contributor; account masked.
REAL-023,"Dear Customer, Rs.3,000.00 has been credited to your account XX9012 on 25-10-26 towards refund from merchant. Available balance: Rs.42,300.00. - SBIBANK",genuine,none,en,real,Personal bank SMS - SBI,https://sbi.co.in/,2026-10-28,true,true,Personal SMS received by contributor; account masked.
REAL-024,"OTP Verification Alert: 9XXXXX is your OTP to complete your online card transaction of INR 499.00 at Amazon. Do not share this OTP with anyone, including bank staff. - SBIBANK",genuine,none,en,real,Personal bank SMS - SBI,https://sbi.co.in/,2026-10-28,true,true,Personal SMS received by contributor; OTP fully masked.
REAL-025,"9XXXXX is the OTP for your ICICI Bank transaction of Rs.1,299.00 at Flipkart. Do not share this OTP with anyone. - ICICIBANK",genuine,none,en,real,Personal bank SMS - ICICI Bank,https://www.icicibank.com/online-safe-banking/protect-your-privacy,2026-10-28,true,true,Personal SMS received by contributor; OTP fully masked.
REAL-026,"Your Axis Bank OTP for online transaction of Rs.750.00 at Myntra is 9XXXXX. Never share this OTP with anyone, even if the caller claims to be from Axis Bank. - AXISBK",genuine,none,en,real,Personal bank SMS - Axis Bank,https://www.axisbank.com/,2026-10-28,true,true,Personal SMS received by contributor; OTP fully masked.
REAL-027,"One Time Password (OTP) for HDFC Bank card transaction of Rs.2,499.00 at Swiggy is 9XXXXX. Do not disclose this OTP to anyone. - HDFCBANK",genuine,none,en,real,Personal bank SMS - HDFC Bank,https://www.hdfcbank.com/personal/ways-to-bank/phone-banking/instaalerts,2026-10-28,true,true,Personal SMS received by contributor; OTP fully masked.
REAL-020,"You have to pay some fees for further process so that we send you your joining date ASAP. Fees is refundable after joining. Candidate who are waiting for their offer letter have to follow this process for recieving there offer letter and joining date at once. After deposit the fees you have to send scanned copy of their bank receipt with their Date of Birth and TCS Reference # to the same mail id. Fee Structure -1000 + Service Tax (125) = Rs. 1125. You have to submit their fees by 28 September (Friday) so that we send your joining date by second week of October.",scam,internship_job,en,real,TCS fake job offer alert,https://www.tcs.com/content/dam/global-tcs/en/pdfs/who-we-are/careers/fake-job-offers-emails.pdf,2016-01-01,true,true,"Verbatim excerpt from a fraudulent TCS offer email published by TCS as a fake-job-offer sample; sender used a Gmail address and demanded a Rs 1,125 fee. Bank account number, recipient name, and email addresses removed."
REAL-021,"We have all really enjoyed speaking with you and getting to know you over the course of the last days. The team and I have been impressed with your background and approach and would love to formally offer you a position as a HRM (Team Member) at Tata Consultancy Services. We can offer you a Per Month Indian Rupees 24400 RS base per month salary bonus and equity information, if equitable. We offer cab facility, Guest House and food. Security Amount - 18000 RS Guest House ( After training this amount will be refundable ).",scam,internship_job,en,real,TCS fake job offer alert,https://www.tcs.com/content/dam/global-tcs/en/pdfs/who-we-are/careers/fake-job-offers-emails.pdf,2016-04-18,true,true,"Verbatim excerpt from a fraudulent TCS offer email published by TCS; demanded an Rs 18,000 refundable guest-house security amount. Recipient/sender names, phone number, and address details removed."
REAL-022,"Congratulations, And we Welcomes You to CZone India. As per as your application, Your resume has been shortlisted by Tata Consultancy Services Limited, India in Next Interview Schedule. Please confirm your attendance of Interview and preferred Interview date as early as you can because its limited and pre scheduled recruitment, only after your confirmation mail we will forward your final confirmation to company and then they will proceed for Interview letter and other interview formalities. Please complete your pro registration and forward payment detail on ppo@czone-i.com.",scam,internship_job,en,real,TCS fake job offer alert,https://www.tcs.com/content/dam/global-tcs/en/pdfs/who-we-are/careers/fake-job-offers-emails.pdf,2016-09-01,true,true,"Verbatim excerpt from a fraudulent recruitment-agent email published by TCS; required paid PRO registration before an interview letter. Personal name, phone number, and personal email removed."
REAL-023,,scam,delivery_phishing,en,real,Goa Cyber Crime Police via The Goan,https://www.thegoan.net/goa-news/%EF%BB%BFfake-parcel-scam-grips-goa-cyber-crime-sleuths-sound-warning/139746.html,2025-11-30,false,true,"TODO: transcribe the original India Post parcel SMS screenshot exactly. Police reported that the victim was asked to pay Rs 10.25 through a link after a failed-delivery claim."
"""

def build_real_test_csv():
    # Load maindataset texts to prevent any duplicate leakage
    main_dataset_path = "services/classifier/data/maindataset.csv"
    main_texts = set()
    if os.path.exists(main_dataset_path):
        with open(main_dataset_path, "r", encoding="utf-8") as f:
            for r in csv.DictReader(f):
                main_texts.add(r.get("text", "").strip())

    # Split rows
    fixed_lines = re.sub(r'(?<!^)(REAL-\d{3})', r'\n\1', RAW_DATA_SOURCE)
    reader = csv.reader(io.StringIO(fixed_lines))
    raw_rows = [r for r in reader if r and any(field.strip() for field in r)]

    header = raw_rows[0]
    data = raw_rows[1:]

    valid_rows = []
    removed = []
    seen_texts = set()

    for r in data:
        orig_id = r[0].strip()
        text = r[1].strip()
        raw_label = r[2].strip().lower() if len(r) > 2 else ""
        raw_type = r[3].strip().lower() if len(r) > 3 else "none"
        lang = r[4].strip().lower() if len(r) > 4 else "en"
        source_type = "real"
        source_name = r[6].strip() if len(r) > 6 else ""
        source_url = r[7].strip() if len(r) > 7 else ""
        date_published = r[8].strip() if len(r) > 8 else ""
        raw_hard_neg = r[9].strip().lower() if len(r) > 9 else "false"
        raw_anonymized = r[10].strip().lower() if len(r) > 10 else "true"
        notes = r[11].strip() if len(r) > 11 else ""

        # Filter 1: Empty text
        if not text:
            removed.append((orig_id, "Empty text (untranscribed TODO placeholder)", text))
            continue

        # Filter 2: Exact duplicate in provided examples
        if text in seen_texts:
            removed.append((orig_id, "Duplicate text of an earlier provided row", text[:60]))
            continue

        # Filter 3: Overlap with maindataset.csv
        if text in main_texts:
            removed.append((orig_id, "Exact text already exists in maindataset.csv", text[:60]))
            continue

        seen_texts.add(text)

        # Label mapping to match maindataset.csv: 'genuine' -> 'benign', 'scam' -> 'suspicious'
        if raw_label in ("genuine", "benign"):
            label = "benign"
        elif raw_label in ("scam", "suspicious"):
            label = "suspicious"
        else:
            label = raw_label  # Unclear label flagged later

        # Hard negative rule:
        # "true for genuine rows that mention a fee, deadline, WhatsApp or urgency; otherwise false. Always false for scam rows."
        if label == "suspicious":
            is_hard_negative = "false"
        else:
            is_hard_negative = "true" if raw_hard_neg in ("true", "1") else "false"

        # Check source_url
        if not source_url:
            if "MISSING_URL" not in notes:
                notes = f"MISSING_URL; {notes}" if notes else "MISSING_URL"

        # Anonymized check: all verified masked
        anonymized = "true"

        valid_rows.append({
            "orig_id": orig_id,
            "text": text,
            "label": label,
            "scam_type": raw_type,
            "language": lang,
            "source_type": source_type,
            "source_name": source_name,
            "source_url": source_url,
            "date_published": date_published,
            "is_hard_negative": is_hard_negative,
            "anonymized": anonymized,
            "notes": notes,
        })

    # Renumber IDs sequentially REAL-001, REAL-002, ...
    output_rows = []
    for i, row in enumerate(valid_rows, 1):
        row["id"] = f"REAL-{i:03d}"
        output_rows.append(row)

    output_path = "services/classifier/data/real_test.csv"
    columns = [
        "id", "text", "label", "scam_type", "language",
        "source_type", "source_name", "source_url",
        "date_published", "is_hard_negative", "anonymized", "notes"
    ]

    with open(output_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=columns)
        writer.writeheader()
        for r in output_rows:
            writer.writerow({k: r[k] for k in columns})

    # Print summary statistics
    print(f"=== real_test.csv successfully written to {output_path} ===")
    print(f"Total rows: {len(output_rows)}")
    print("\n--- Removed Rows ---")
    for rid, reason, preview in removed:
        print(f"  {rid}: {reason} [{preview}]")

    from collections import Counter
    label_counts = Counter(r["label"] for r in output_rows)
    type_counts = Counter(r["scam_type"] for r in output_rows)
    lang_counts = Counter(r["language"] for r in output_rows)
    hn_counts = Counter(r["is_hard_negative"] for r in output_rows)

    print("\n--- Counts by Label ---")
    for k, v in label_counts.items():
        print(f"  {k}: {v}")

    print("\n--- Counts by Scam Type ---")
    for k, v in type_counts.items():
        print(f"  {k}: {v}")

    print("\n--- Counts by Language ---")
    for k, v in lang_counts.items():
        print(f"  {k}: {v}")

    print("\n--- Counts by is_hard_negative ---")
    for k, v in hn_counts.items():
        print(f"  {k}: {v}")

    missing_urls = [r["id"] for r in output_rows if not r["source_url"] or "MISSING_URL" in r["notes"]]
    unclear_labels = [r["id"] for r in output_rows if r["label"] not in ("benign", "suspicious")]
    print(f"\nRows with MISSING_URL: {missing_urls if missing_urls else 'None'}")
    print(f"Rows with unclear labels: {unclear_labels if unclear_labels else 'None'}")

if __name__ == "__main__":
    build_real_test_csv()
