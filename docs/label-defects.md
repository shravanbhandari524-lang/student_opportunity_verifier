# Label Defects Audit Report: Missing Scam Payloads

**Generated:** 2026-10-27 22:57:09 UTC  
**Target Dataset:** `/home/shreyas_95/Documents/PROJECTS/MY PROJECTS/DEM/services/classifier/data/maindataset.csv`  
**Total Defective Rows Identified:** 3  

## Overview
This audit scans all rows labeled `suspicious` (or scam) to verify the presence of an active scam payload:
- **Fee / Deposit / Money Demand:** Upfront fee, registration fee, deposit, transfer, or currency terms.
- **Link / URL:** Web links, forms, or APK download links.
- **Credentials / OTP:** Requests for OTP, portal password, PIN, or login credentials.
- **Bank / ATM / SIM / Mule:** Requests to rent bank accounts, share ATM/SIM cards, or transfer commissions.

Rows lacking any of these mechanisms are defective false positives. They teach the model to flag normal, benign notifications simply based on neutral words like 'contest', 'hackathon', or 'onboarding'.

## Defective Rows Listing

### 1. [DATA-065] (Line 66)
- **Text:** `Eastern Technology Consortium: Cloud trainee technical onboarding details candidate portal par Friday shaam se pehle check karein.`
- **Scam Type:** `internship` | **Language:** `hinglish` | **Channel:** `email`
- **Group ID:** `GRP-B02-05`
- **Generator Notes:** `topic=internship; campaign=ambassador_kit_scam; batch=B02; surface=stipend,upi; pair_id=P036`
- **Defect Analysis:** The message contains neutral institutional or contest registration language with **no scam payload** (no fee requested, no link provided, no OTP or credentials demanded, no bank or account rental solicitation). Mislabeled as `suspicious` due to generator omission.
- **Recommendation:** Relabel as `benign`, rewrite to include the intended payload as specified in generator notes, or quarantine from training.

### 2. [DATA-116] (Line 117)
- **Text:** `Daily Gig Registry: Remote data verification work start karne ke liye candidate verification slip official portal par submit karein to begin work.`
- **Scam Type:** `task_job` | **Language:** `hinglish` | **Channel:** `email`
- **Group ID:** `GRP-B03-05`
- **Generator Notes:** `topic=task_job; campaign=prepaid_merchant_task; batch=B03; surface=deadline,stipend,upi; pair_id=P058`
- **Defect Analysis:** The message contains neutral institutional or contest registration language with **no scam payload** (no fee requested, no link provided, no OTP or credentials demanded, no bank or account rental solicitation). Mislabeled as `suspicious` due to generator omission.
- **Recommendation:** Relabel as `benign`, rewrite to include the intended payload as specified in generator notes, or quarantine from training.

### 3. [DATA-243] (Line 244)
- **Text:** `Inter-Collegiate Coding Contest: Hackathon final stage registration details contest portal par Friday night tak register karein.`
- **Scam Type:** `competition` | **Language:** `hinglish` | **Channel:** `instagram`
- **Group ID:** `GRP-B05-13`
- **Generator Notes:** `topic=competition; campaign=debate_league_scam; batch=B05; surface=link,deadline,stipend; theme=identity_theft; mapped_from=identity_theft`
- **Defect Analysis:** The message contains neutral institutional or contest registration language with **no scam payload** (no fee requested, no link provided, no OTP or credentials demanded, no bank or account rental solicitation). Mislabeled as `suspicious` due to generator omission.
- **Recommendation:** Relabel as `benign`, rewrite to include the intended payload as specified in generator notes, or quarantine from training.

## Summary & Impact
- Total scanned suspicious samples: 300
- Total defective samples: 3 (1.00% of suspicious class)
- **Action Item:** In accordance with PRD and ARCHITECTURE guidelines, do not auto-fix silently. Preserve data lineage and address through curated patch files or dataset version bump.
