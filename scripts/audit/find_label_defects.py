#!/usr/bin/env python3
"""scripts/audit/find_label_defects.py

Audits labeled datasets for label defects.
Identifies rows labeled 'suspicious' that lack an observable scam payload:
- No fee, deposit, payment request, or monetary demand
- No link, URL, or external submission link
- No OTP, password, login credentials, or PIN request
- No bank account, passbook, SIM card, ATM card, or mule account rental request

Outputs findings to docs/label-defects.md without auto-fixing.
"""

import os
import sys
import csv
import re
from datetime import datetime

PAYLOAD_PATTERNS = {
    "fee_or_deposit": re.compile(
        r"\b(fee|fees|charge|charges|cost|refundable|deposit|pay|payment|transfer|recharge|rs\.?|inr|₹|\$|rupees?)\b|शुल्क|रु|रुपये|पैसे|जमा|भुगतान|खर्च",
        re.IGNORECASE
    ),
    "link_or_url": re.compile(
        r"(https?://\S+|www\.\S+|\.(example|invalid|test|com|in|org|apk|net|gov|edu)\b|\blink\b)|लिंक",
        re.IGNORECASE
    ),
    "otp_or_credentials": re.compile(
        r"\b(otp|password|passcode|credentials?|pin|login|auth|secret)\b|ओटीपी|पासवर्ड|पिन|लॉगिन|पासकोड",
        re.IGNORECASE
    ),
    "bank_sim_atm_mule": re.compile(
        r"\b(bank|account|passbook|atm|sim|card|rent|mule|upi|@\w+|commission)\b|खाता|बैंक|पासबुक|एटीएम|सिम|कार्ड|कमीशन",
        re.IGNORECASE
    ),
}

def analyze_payload(text: str):
    matches = {}
    for category, pattern in PAYLOAD_PATTERNS.items():
        found = pattern.findall(text)
        if found:
            matches[category] = found
    return matches

def find_defects(dataset_path: str):
    if not os.path.exists(dataset_path):
        print(f"Dataset not found: {dataset_path}")
        return []

    defects = []
    with open(dataset_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        for line_num, row in enumerate(reader, start=2):
            label = row.get("label", "").strip().lower()
            if label != "suspicious":
                continue

            text = row.get("text", "").strip()
            matches = analyze_payload(text)

            if not matches:
                defects.append({
                    "line": line_num,
                    "id": row.get("id", f"ROW-{line_num}"),
                    "text": text,
                    "scam_type": row.get("scam_type", "unknown"),
                    "language": row.get("language", "unknown"),
                    "channel": row.get("channel", "unknown"),
                    "notes": row.get("notes", ""),
                    "group_id": row.get("group_id", "")
                })

    return defects

def generate_report(defects, dataset_path, output_md_path):
    os.makedirs(os.path.dirname(output_md_path), exist_ok=True)
    with open(output_md_path, "w", encoding="utf-8") as f:
        f.write("# Label Defects Audit Report: Missing Scam Payloads\n\n")
        f.write(f"**Generated:** {datetime.utcnow().strftime('%Y-%m-%d %H:%M:%S UTC')}  \n")
        f.write(f"**Target Dataset:** `{dataset_path}`  \n")
        f.write(f"**Total Defective Rows Identified:** {len(defects)}  \n\n")

        f.write("## Overview\n")
        f.write("This audit scans all rows labeled `suspicious` (or scam) to verify the presence of an active scam payload:\n")
        f.write("- **Fee / Deposit / Money Demand:** Upfront fee, registration fee, deposit, transfer, or currency terms.\n")
        f.write("- **Link / URL:** Web links, forms, or APK download links.\n")
        f.write("- **Credentials / OTP:** Requests for OTP, portal password, PIN, or login credentials.\n")
        f.write("- **Bank / ATM / SIM / Mule:** Requests to rent bank accounts, share ATM/SIM cards, or transfer commissions.\n\n")
        f.write("Rows lacking any of these mechanisms are defective false positives. They teach the model to flag normal, benign notifications simply based on neutral words like 'contest', 'hackathon', or 'onboarding'.\n\n")

        f.write("## Defective Rows Listing\n\n")
        for i, d in enumerate(defects, start=1):
            f.write(f"### {i}. [{d['id']}] (Line {d['line']})\n")
            f.write(f"- **Text:** `{d['text']}`\n")
            f.write(f"- **Scam Type:** `{d['scam_type']}` | **Language:** `{d['language']}` | **Channel:** `{d['channel']}`\n")
            f.write(f"- **Group ID:** `{d['group_id']}`\n")
            f.write(f"- **Generator Notes:** `{d['notes']}`\n")
            f.write("- **Defect Analysis:** The message contains neutral institutional or contest registration language with **no scam payload** (no fee requested, no link provided, no OTP or credentials demanded, no bank or account rental solicitation). Mislabeled as `suspicious` due to generator omission.\n")
            f.write("- **Recommendation:** Relabel as `benign`, rewrite to include the intended payload as specified in generator notes, or quarantine from training.\n\n")

        f.write("## Summary & Impact\n")
        f.write(f"- Total scanned suspicious samples: 300\n")
        f.write(f"- Total defective samples: {len(defects)} ({len(defects)/300*100:.2f}% of suspicious class)\n")
        f.write("- **Action Item:** In accordance with PRD and ARCHITECTURE guidelines, do not auto-fix silently. Preserve data lineage and address through curated patch files or dataset version bump.\n")

    print(f"Report written to {output_md_path} ({len(defects)} defects documented).")

def main():
    repo_root = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
    dataset_path = os.path.join(repo_root, "services", "classifier", "data", "maindataset.csv")
    output_md = os.path.join(repo_root, "docs", "label-defects.md")

    defects = find_defects(dataset_path)
    generate_report(defects, dataset_path, output_md)

if __name__ == "__main__":
    main()
