"""services/classifier/generate_formal_dataset.py

Generates 60 synthetic formal scam rows (hard positives) and 60 matched
synthetic formal genuine rows (hard negatives) in official government/ministry
letterhead style.
Also generates an independent held-out evaluation set of 30 formal scams
and 30 formal genuine notices.

All rows are strictly marked source_type="synthetic".
"""

import csv
import os
from pathlib import Path
from normalize import normalize_text

BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data"

# 60 Paired Formal Templates (Scam with fee/deposit vs Genuine with NO fee demand)
# Each pair covers a distinct department, scheme name, portal, and deadline.

PAIRED_FORMAL_DATA = [
    # 1. Higher Education Digital Aid
    (
        "Ministry of Education, Government of India. Central Sector Digital Study Subsidy Scheme 2026. Provisionally shortlisted candidates must deposit a refundable portal security verification charge of ₹850 to unlock the digital disbursement voucher before 12 November 2026. Failure to deposit will cancel the allocation.",
        "Ministry of Education, Government of India. Central Sector Digital Study Subsidy Scheme 2026. Provisionally shortlisted candidates must complete biometric identity verification at their institute nodal office before 12 November 2026. Direct benefit credit will be released with zero processing deductions.",
        "higher_education_fee_scam", "GRP-FORMAL-001"
    ),
    # 2. National Technical Education Council
    (
        "All India Council for Technical Education (AICTE) Circular No. 44/2026. Post Graduate Engineering Assistance Fellowship award notification. Selected scholars are instructed to remit mandatory document clearance stamp charges of ₹1,200 via the state student portal to validate bank account mandate.",
        "All India Council for Technical Education (AICTE) Circular No. 44/2026. Post Graduate Engineering Assistance Fellowship award notification. Selected scholars are instructed to submit physical copies of their GATE scorecard and college enrollment certificate to the institute registrar before 20 November 2026.",
        "scholarship_scam", "GRP-FORMAL-002"
    ),
    # 3. Department of Science & Technology INSPIRE
    (
        "Department of Science and Technology (DST) INSPIRE Scholarship for Higher Education (SHE). Provisionally approved recipients must remit ₹950 towards central document processing and enrollment dossier fees to release the annual fellowship amount.",
        "Department of Science and Technology (DST) INSPIRE Scholarship for Higher Education (SHE). Provisionally approved recipients must upload their end-semester mark sheet and performance appraisal report on the web portal to receive their annual fellowship renewal.",
        "scholarship_scam", "GRP-FORMAL-003"
    ),
    # 4. State Social Welfare Directorate
    (
        "State Directorate of Social Welfare & Empowerment. Post-Matric Merit Assistance 2026-27. Final merit list published. Selected beneficiaries are required to submit an upfront document verification security deposit of ₹750 on the clearance gateway to confirm scholarship seat allocation.",
        "State Directorate of Social Welfare & Empowerment. Post-Matric Merit Assistance 2026-27. Final merit list published. Selected beneficiaries may verify their application status on the official portal. All approved funds will be directly disbursed to Aadhaar-seeded accounts at no cost.",
        "scholarship_scam", "GRP-FORMAL-004"
    ),
    # 5. MeitY Digital Literacy Fellowship
    (
        "Ministry of Electronics and Information Technology (MeitY). National Student Cyber Fellowship Award 2026. Shortlisted students must remit an identity verification and server maintenance charge of ₹650 within 48 hours to activate the scholarship payout portal.",
        "Ministry of Electronics and Information Technology (MeitY). National Student Cyber Fellowship Award 2026. Shortlisted students are advised to review the final awardee gazette on the official portal. Caution: MeitY never demands any registration fee, security charge, or processing cost.",
        "scholarship_scam", "GRP-FORMAL-005"
    ),
    # 6. UGC Research Fellowship Allocation
    (
        "University Grants Commission (UGC) National Fellowship Desk. Selection Notice UGC/NF/2026. Candidates awarded Junior Research Stipends must submit ₹1,100 towards digital certificate issuance and portal ledger clearance prior to the final disbursement run.",
        "University Grants Commission (UGC) National Fellowship Desk. Selection Notice UGC/NF/2026. Candidates awarded Junior Research Stipends must submit their joining report counter-signed by the university head of department to initiate monthly direct benefit transfers.",
        "scholarship_scam", "GRP-FORMAL-006"
    ),
    # 7. National Skill Development Mission
    (
        "National Skill Development Corporation (NSDC) Apprenticeship Incentive Programme. Provisional allotment notice: You have been allocated a monthly stipend seat. A mandatory onboarding verification deposit of ₹800 is required by 5 December to confirm your seat.",
        "National Skill Development Corporation (NSDC) Apprenticeship Incentive Programme. Provisional allotment notice: You have been allocated a monthly stipend seat. Please report to your designated training center with original identification documents before 5 December.",
        "recruitment_fraud", "GRP-FORMAL-007"
    ),
    # 8. Prime Minister Special Scholarship Scheme (J&K and Ladakh)
    (
        "PM-USP Special Scholarship Scheme for UTs of Jammu, Kashmir and Ladakh. Verification Notice: Awardees must pay ₹1,400 central verification processing charges via online gateway to release tuition fee clearance letters to allocated colleges.",
        "PM-USP Special Scholarship Scheme for UTs of Jammu, Kashmir and Ladakh. Verification Notice: Awardees must ensure that their respective colleges upload the joining report and hostel verification certificates on the portal before the deadline.",
        "scholarship_scam", "GRP-FORMAL-008"
    ),
    # 9. Ministry of Tribal Affairs Fellowship
    (
        "Ministry of Tribal Affairs, Government of India. National Overseas Scholarship Scheme 2026. Shortlisted candidates are required to deposit a refundable administrative verification fee of ₹1,850 to validate candidate dossier and visa sponsorship clearance.",
        "Ministry of Tribal Affairs, Government of India. National Overseas Scholarship Scheme 2026. Shortlisted candidates are invited for document verification at Shastri Bhawan, New Delhi. Travel allowance will be reimbursed as per official ministry norms.",
        "scholarship_scam", "GRP-FORMAL-009"
    ),
    # 10. Central Board of Secondary Education Merit Wing
    (
        "Central Board of Secondary Education (CBSE) Single Girl Child Scholarship Scheme 2026. Candidate selection docket: A processing and bank validation charge of ₹500 must be remitted on the portal to confirm candidate eligibility before the cutoff date.",
        "Central Board of Secondary Education (CBSE) Single Girl Child Scholarship Scheme 2026. Candidate selection docket: The list of eligible candidates has been communicated to affiliated schools. Principals are requested to verify student enrollment records online.",
        "scholarship_scam", "GRP-FORMAL-010"
    ),
    # 11. Department of Biotechnology Fellowship
    (
        "Department of Biotechnology (DBT), Ministry of Science & Technology. Junior Research Fellowship Award 2026. Selected scholars must pay ₹900 towards dossier activation and smart card ledger generation to receive their quarterly stipend.",
        "Department of Biotechnology (DBT), Ministry of Science & Technology. Junior Research Fellowship Award 2026. Selected scholars are instructed to download their formal award letter from the DBT portal and submit joining forms through their host laboratory.",
        "scholarship_scam", "GRP-FORMAL-011"
    ),
    # 12. State Higher Education Council (Maharashtra)
    (
        "Maharashtra State Higher and Technical Education Department. Rajarshi Shahu Maharaj Scholarship 2026. Candidate shortlisted: Pay refundable verification fee of ₹799 via gateway to finalize candidate ledger allocation.",
        "Maharashtra State Higher and Technical Education Department. Rajarshi Shahu Maharaj Scholarship 2026. Candidate shortlisted: Verification of caste validity and income documents will be conducted at the district social welfare office without any charge.",
        "scholarship_scam", "GRP-FORMAL-012"
    ),
    # 13. State Higher Education Council (Karnataka)
    (
        "Government of Karnataka, Department of Collegiate Education. State Scholarship Portal (SSP) Merit Award 2026. Document verification fee of ₹600 is mandatory to approve pending e-attestation and disburse financial aid.",
        "Government of Karnataka, Department of Collegiate Education. State Scholarship Portal (SSP) Merit Award 2026. Document e-attestation is completely free. Students must contact their college e-attestation officers to verify uploaded records.",
        "scholarship_scam", "GRP-FORMAL-013"
    ),
    # 14. State Higher Education Council (Tamil Nadu)
    (
        "Government of Tamil Nadu, Higher Education Department. Moovalur Ramamirtham Ammaiyar Higher Education Assurance Scheme. Remit ₹450 card processing charge to activate monthly financial assistance debit mandate.",
        "Government of Tamil Nadu, Higher Education Department. Moovalur Ramamirtham Ammaiyar Higher Education Assurance Scheme. Beneficiary bank accounts will receive ₹1,000 monthly through direct electronic transfer. No fees are ever levied on students.",
        "scholarship_scam", "GRP-FORMAL-014"
    ),
    # 15. State Higher Education Council (Uttar Pradesh)
    (
        "Uttar Pradesh Scholarship and Fee Reimbursement Online System (Saksham). Mandatory Notice: Your fee reimbursement is on hold. Pay ₹850 document clearance duty on the state portal before 15 November to release funds.",
        "Uttar Pradesh Scholarship and Fee Reimbursement Online System (Saksham). Mandatory Notice: Institute verification status for all pending fee reimbursement applications can be tracked online. Students should report discrepancies to their college nodal desk.",
        "scholarship_scam", "GRP-FORMAL-015"
    ),
    # 16. State Higher Education Council (West Bengal)
    (
        "Government of West Bengal, Higher Education Directorate. Swami Vivekananda Merit-cum-Means Scholarship 2026. Shortlisted students must transfer ₹700 verification deposit to finalize scholarship clearance and issue allotment order.",
        "Government of West Bengal, Higher Education Directorate. Swami Vivekananda Merit-cum-Means Scholarship 2026. Students who secured above 60% marks in qualifying examinations should ensure their head of institution approves their dossier online.",
        "scholarship_scam", "GRP-FORMAL-016"
    ),
    # 17. National Apprenticeship Promotion Scheme (NAPS)
    (
        "Ministry of Skill Development and Entrepreneurship. National Apprenticeship Promotion Scheme (NAPS). Stipend approval notice: A refundable candidate security charge of ₹999 is required to authorize the central stipend reimbursement portal.",
        "Ministry of Skill Development and Entrepreneurship. National Apprenticeship Promotion Scheme (NAPS). Stipend approval notice: Establishments are reminded to credit apprentice stipends through the portal. The central subsidy share will be transferred automatically.",
        "recruitment_fraud", "GRP-FORMAL-017"
    ),
    # 18. Indian Council of Social Science Research (ICSSR)
    (
        "Indian Council of Social Science Research (ICSSR), New Delhi. Doctoral Fellowship Allotment 2026. Selected research scholars are instructed to remit ₹1,250 towards grant administrative review fees before release of the first fellowship tranche.",
        "Indian Council of Social Science Research (ICSSR), New Delhi. Doctoral Fellowship Allotment 2026. Selected research scholars are instructed to execute the prescribed grant agreement and submit their research proposal clearance through their affiliated university.",
        "scholarship_scam", "GRP-FORMAL-018"
    ),
    # 19. Ministry of Minority Affairs Pre-Matric & Post-Matric
    (
        "Ministry of Minority Affairs, Government of India. Merit-cum-Means Scholarship Allocation Notification. Approved candidates must deposit ₹650 on the verification clearance page to unlock their digital scholarship disbursement docket.",
        "Ministry of Minority Affairs, Government of India. Merit-cum-Means Scholarship Allocation Notification. Applicants are cautioned against unauthorized phone calls or websites claiming to fast-track scholarship payments against monetary deposits.",
        "scholarship_scam", "GRP-FORMAL-019"
    ),
    # 20. Council of Scientific and Industrial Research (CSIR)
    (
        "Council of Scientific and Industrial Research (CSIR) Human Resource Development Group. CSIR-UGC NET Junior Research Fellowship. Scholars must remit ₹800 towards digital dossier archiving charges prior to monthly stipend generation.",
        "Council of Scientific and Industrial Research (CSIR) Human Resource Development Group. CSIR-UGC NET Junior Research Fellowship. Qualified candidates must upload their self-attested educational documents and degree certificate on the CSIR portal for issuance of eligibility certificate.",
        "scholarship_scam", "GRP-FORMAL-020"
    ),
    # 21. Department of Atomic Energy Young Scientist Grant
    (
        "Department of Atomic Energy (DAE), Government of India. Young Scientist Research Grant 2026. Selected candidate must remit refundable technical evaluation bond fee of ₹1,500 to process the official sanction memorandum.",
        "Department of Atomic Energy (DAE), Government of India. Young Scientist Research Grant 2026. Sanction orders for approved collaborative research proposals have been forwarded to the finance offices of respective universities.",
        "scholarship_scam", "GRP-FORMAL-021"
    ),
    # 22. Indian Council of Medical Research (ICMR)
    (
        "Indian Council of Medical Research (ICMR) Biomedical Research Fellowship. Provisional allocation letter: Pay ₹1,350 medical ethics committee documentation fees through the candidate portal to confirm your research tenure.",
        "Indian Council of Medical Research (ICMR) Biomedical Research Fellowship. Provisional allocation letter: Scholars must present institutional ethics committee approval and supervisor consent letter during physical verification.",
        "scholarship_scam", "GRP-FORMAL-022"
    ),
    # 23. State Higher Education Council (Gujarat)
    (
        "Education Department, Government of Gujarat. Mukhymantri Yuva Swavalamban Yojana (MYSY) 2026. Your tuition assistance is approved. Please pay ₹750 document verification and processing fee to generate bank payment token.",
        "Education Department, Government of Gujarat. Mukhymantri Yuva Swavalamban Yojana (MYSY) 2026. Help center verification of original documents is conducted without any fee. Beware of fake links requesting payment.",
        "scholarship_scam", "GRP-FORMAL-023"
    ),
    # 24. State Higher Education Council (Rajasthan)
    (
        "Government of Rajasthan, Department of College Education. Medhavi Chhatra Scooty & Scholarship Scheme. Selected candidate is required to remit ₹899 registration and road transport documentation fee to confirm allotment.",
        "Government of Rajasthan, Department of College Education. Medhavi Chhatra Scooty & Scholarship Scheme. Final merit list has been declared. District nodal officers will coordinate physical delivery of awards to enrolled students.",
        "scholarship_scam", "GRP-FORMAL-024"
    ),
    # 25. State Higher Education Council (Madhya Pradesh)
    (
        "Government of Madhya Pradesh, Higher Education Department. Medhavi Vidyarthi Yojana (MMVY) 2026. Tuition fee grant allotment: Pay portal verification fee of ₹650 on the fee portal before the designated cutoff date.",
        "Government of Madhya Pradesh, Higher Education Department. Medhavi Vidyarthi Yojana (MMVY) 2026. The government reimburses academic fees directly to higher education institutions. Students are not required to pay any clearance charges.",
        "scholarship_scam", "GRP-FORMAL-025"
    ),
    # 26. State Higher Education Council (Telangana)
    (
        "Telangana State Council of Higher Education (TSCHE). Post-Graduate Engineering Common Entrance Fellowship. Candidate must deposit ₹1,050 verification security charge to activate monthly stipend payment profile.",
        "Telangana State Council of Higher Education (TSCHE). Post-Graduate Engineering Common Entrance Fellowship. Eligible candidates are advised to verify their college bank account and attendance reports before the 10th of every month.",
        "scholarship_scam", "GRP-FORMAL-026"
    ),
    # 27. State Higher Education Council (Andhra Pradesh)
    (
        "Government of Andhra Pradesh, Higher Education Department. Jagananna Vidya Deevena Scheme. Approved reimbursement voucher: Pay ₹800 electronic voucher activation fee to initiate bank transfer.",
        "Government of Andhra Pradesh, Higher Education Department. Jagananna Vidya Deevena Scheme. Full fee reimbursement vouchers are released directly into mothers' accounts through CFMS gateway without intermediary charges.",
        "scholarship_scam", "GRP-FORMAL-027"
    ),
    # 28. State Higher Education Council (Kerala)
    (
        "Kerala State Higher Education Council (KSHEC). Higher Education Scholarship Scheme 2026. Provisionally selected scholars are notified to pay ₹550 smart ledger maintenance fee to claim the first annual installment.",
        "Kerala State Higher Education Council (KSHEC). Higher Education Scholarship Scheme 2026. Selected scholars must submit their university study certificate and previous semester mark list for annual renewal verification.",
        "scholarship_scam", "GRP-FORMAL-028"
    ),
    # 29. State Higher Education Council (Odisha)
    (
        "Government of Odisha, Higher Education Department. e-Medhabruti Scholarship 2026. Application under review: Pay mandatory technical documentation fee of ₹700 to confirm candidate bank profile on the state portal.",
        "Government of Odisha, Higher Education Department. e-Medhabruti Scholarship 2026. The state scholarship portal never requests monetary deposits for document vetting or bank credential verification.",
        "scholarship_scam", "GRP-FORMAL-029"
    ),
    # 30. State Higher Education Council (Bihar)
    (
        "Bihar State Higher Education Council. Mukhymantri Kanya Utthan Yojana 2026. Selected graduate recipient must remit ₹600 registration verification fee to authorize treasury disbursement.",
        "Bihar State Higher Education Council. Mukhymantri Kanya Utthan Yojana 2026. Direct benefit transfer of ₹50,000 to eligible female graduates is executed through treasury portal after college certificate verification.",
        "scholarship_scam", "GRP-FORMAL-030"
    ),
    # 31. Ministry of Ports, Shipping and Waterways Maritime Cadet Grant
    (
        "Directorate General of Shipping, Ministry of Ports. National Maritime Student Cadets Stipend. Remit mandatory physical verification and uniform badge deposit of ₹1,450 to validate candidate allotment docket.",
        "Directorate General of Shipping, Ministry of Ports. National Maritime Student Cadets Stipend. Cadet sponsorship stipends are credited directly by participating shipping lines in compliance with DG Shipping guidelines.",
        "recruitment_fraud", "GRP-FORMAL-031"
    ),
    # 32. Ministry of Agriculture Krishi Vigyan Fellowship
    (
        "Indian Council of Agricultural Research (ICAR). National Agricultural Innovation Fellowship 2026. Candidates are instructed to remit ₹850 central processing charges to release student research funds.",
        "Indian Council of Agricultural Research (ICAR). National Agricultural Innovation Fellowship 2026. Agricultural university deans are requested to forward semester progress reports of selected scholars to the ICAR headquarters.",
        "scholarship_scam", "GRP-FORMAL-032"
    ),
    # 33. Ministry of Culture National Heritage Fellowship
    (
        "Ministry of Culture, Government of India. Scheme for Award of Fellowships to Outstanding Artistes and Scholars. Shortlisted applicants must transfer ₹1,100 document review deposit to confirm panel award.",
        "Ministry of Culture, Government of India. Scheme for Award of Fellowships to Outstanding Artistes and Scholars. Expert panel evaluations are conducted objectively; no application or review fees are charged to artists.",
        "scholarship_scam", "GRP-FORMAL-033"
    ),
    # 34. Ministry of AYUSH Student Research Award
    (
        "Ministry of AYUSH, Government of India. Student Under-Graduate Research Fellowship (SURF) 2026. Pay refundable ethics review fee of ₹950 to issue grant clearance certification.",
        "Ministry of AYUSH, Government of India. Student Under-Graduate Research Fellowship (SURF) 2026. Institutional ethics committee clearance must be uploaded through the college login. No financial deposits are required.",
        "scholarship_scam", "GRP-FORMAL-034"
    ),
    # 35. Ministry of Defence Ex-Servicemen Welfare Scholarship
    (
        "Department of Ex-Servicemen Welfare, Ministry of Defence. Prime Minister Scholarship Scheme (PMSS). Allotted applicant must pay ₹750 dossier verification and welfare stamp fee to release scholarship grant.",
        "Department of Ex-Servicemen Welfare, Ministry of Defence. Prime Minister Scholarship Scheme (PMSS). Armed forces personnel wards are cautioned that PMSS processing is strictly free of all administrative charges.",
        "scholarship_scam", "GRP-FORMAL-035"
    ),
    # 36. Ministry of New and Renewable Energy Fellowship
    (
        "Ministry of New and Renewable Energy (MNRE). National Renewable Energy Science Fellowship. Selected student must deposit ₹1,200 towards laboratory clearance and candidate insurance fee to activate grant.",
        "Ministry of New and Renewable Energy (MNRE). National Renewable Energy Science Fellowship. Selected candidates are required to submit their lab joining reports through their university research registrar.",
        "scholarship_scam", "GRP-FORMAL-036"
    ),
    # 37. Ministry of Earth Sciences Oceanography Grant
    (
        "Ministry of Earth Sciences, Government of India. National Oceanographic Research Fellowship. Pay ₹1,300 candidate vetting and portal registration fee to authorize research vessel trainee stipend.",
        "Ministry of Earth Sciences, Government of India. National Oceanographic Research Fellowship. Research vessel trainee placements are coordinated directly with certified marine research institutions.",
        "scholarship_scam", "GRP-FORMAL-037"
    ),
    # 38. Department of Pharmaceuticals Student Grant
    (
        "Department of Pharmaceuticals, Ministry of Chemicals & Fertilizers. NIPER Graduate Research Assistance Award. Pay ₹1,000 regulatory compliance document clearance fee to disburse quarterly research allowance.",
        "Department of Pharmaceuticals, Ministry of Chemicals & Fertilizers. NIPER Graduate Research Assistance Award. Research allowances are credited directly to student bank accounts following faculty guide endorsement.",
        "scholarship_scam", "GRP-FORMAL-038"
    ),
    # 39. Ministry of Tourism Hospitality Internship Fellowship
    (
        "Ministry of Tourism, Government of India. National Hospitality Apprentice Assistance Programme. Shortlisted candidate must remit ₹650 smart card issuance fee to unlock certified internship allowance.",
        "Ministry of Tourism, Government of India. National Hospitality Apprentice Assistance Programme. Training stipends are governed by government apprenticeship regulations with zero fees payable by apprentices.",
        "recruitment_fraud", "GRP-FORMAL-039"
    ),
    # 40. Ministry of Coal Geological Trainee Fellowship
    (
        "Ministry of Coal, Government of India. Student Mining & Geological Survey Stipend Scheme. Provisionally selected students must pay ₹900 field security clearance charge to confirm survey allocation.",
        "Ministry of Coal, Government of India. Student Mining & Geological Survey Stipend Scheme. Field survey allowances are released in partnership with government geological institutes after physical verification.",
        "scholarship_scam", "GRP-FORMAL-040"
    ),
    # 41. Ministry of Heavy Industries Automotive Tech Fellowship
    (
        "Ministry of Heavy Industries. Clean Mobility Student Research Grant 2026. Deposit ₹1,150 towards central project docket review charges to release project research equipment grant.",
        "Ministry of Heavy Industries. Clean Mobility Student Research Grant 2026. Institutional project research grants are transferred directly to authorized engineering college bank accounts.",
        "scholarship_scam", "GRP-FORMAL-041"
    ),
    # 42. Ministry of Communications Telecom Student Fellowship
    (
        "Department of Telecommunications (DoT), Ministry of Communications. 5G and Future Wireless Student Fellowship Award. Pay ₹850 testing portal access fee to confirm candidate fellowship profile.",
        "Department of Telecommunications (DoT), Ministry of Communications. 5G and Future Wireless Student Fellowship Award. Selected student innovators will receive laboratory access credentials via registered email without charge.",
        "scholarship_scam", "GRP-FORMAL-042"
    ),
    # 43. Ministry of Housing and Urban Affairs Smart City Fellowship
    (
        "Ministry of Housing and Urban Affairs (MoHUA). India Smart City Student Fellowship. Candidates are required to remit ₹950 urban mission registration fee to confirm city project allocation.",
        "Ministry of Housing and Urban Affairs (MoHUA). India Smart City Student Fellowship. All fellowship stipends and urban mission project costs are fully funded by the central government.",
        "scholarship_scam", "GRP-FORMAL-043"
    ),
    # 44. Ministry of Steel Metallurgical Student Grant
    (
        "Ministry of Steel, Government of India. National Metallurgical Student Merit Incentive Scheme. Deposit ₹800 administrative vetting fee to confirm recipient eligibility before the cutoff date.",
        "Ministry of Steel, Government of India. National Metallurgical Student Merit Incentive Scheme. Merit incentive awardees are selected based on academic performance verified by university authorities.",
        "scholarship_scam", "GRP-FORMAL-044"
    ),
    # 45. Ministry of Textiles Handloom & Handicrafts Student Fellowship
    (
        "Office of the Development Commissioner (Handicrafts), Ministry of Textiles. National Craft Student Design Award. Pay ₹600 certificate authentication charge to disburse student design grant.",
        "Office of the Development Commissioner (Handicrafts), Ministry of Textiles. National Craft Student Design Award. Design awards are presented during National Handloom Day celebrations without application fee.",
        "scholarship_scam", "GRP-FORMAL-045"
    ),
    # 46. Ministry of Corporate Affairs Young Professional Internship
    (
        "Ministry of Corporate Affairs, Government of India. Corporate Governance Student Internship Programme. Pay ₹1,200 background verification deposit on the portal to confirm internship joining date.",
        "Ministry of Corporate Affairs, Government of India. Corporate Governance Student Internship Programme. Selected interns must submit verification documents directly to the Ministry headquarters in New Delhi.",
        "recruitment_fraud", "GRP-FORMAL-046"
    ),
    # 47. National Disaster Management Authority Student Fellowship
    (
        "National Disaster Management Authority (NDMA), Ministry of Home Affairs. Disaster Resilience Student Research Stipend. Remit ₹1,000 emergency field kit security deposit to finalize grant sanction.",
        "National Disaster Management Authority (NDMA), Ministry of Home Affairs. Disaster Resilience Student Research Stipend. Approved research grants are administered through universities under standard MHA financial rules.",
        "scholarship_scam", "GRP-FORMAL-047"
    ),
    # 48. National Institute of Open Schooling Merit Grant
    (
        "National Institute of Open Schooling (NIOS), Ministry of Education. Meritorious Learner Educational Grant 2026. Deposit ₹450 registration token fee to activate monthly financial award.",
        "National Institute of Open Schooling (NIOS), Ministry of Education. Meritorious Learner Educational Grant 2026. Fee concessions and learner grants are adjusted directly against exam fees in the online dashboard.",
        "scholarship_scam", "GRP-FORMAL-048"
    ),
    # 49. State Higher Education Council (Punjab)
    (
        "Department of Higher Education, Government of Punjab. Post-Matric Scholarship Scheme for SC Students. Shortlisted student must pay ₹750 treasury verification duty to release fee reimbursement claim.",
        "Department of Higher Education, Government of Punjab. Post-Matric Scholarship Scheme for SC Students. The state government prohibits educational institutions from demanding fees from eligible scholarship applicants.",
        "scholarship_scam", "GRP-FORMAL-049"
    ),
    # 50. State Higher Education Council (Haryana)
    (
        "Higher Education Department, Haryana. Haryana Post-Matric Merit Assistance Portal. Notice: Pay ₹650 digital signature verification fee before 25 November to unlock student scholarship fund.",
        "Higher Education Department, Haryana. Haryana Post-Matric Merit Assistance Portal. All scholarship claims are processed through the centralized Parivar Pehchan Patra database without fee collection.",
        "scholarship_scam", "GRP-FORMAL-050"
    ),
    # 51. State Higher Education Council (Himachal Pradesh)
    (
        "Government of Himachal Pradesh, Department of Higher Education. Mukhya Mantri Protsahan Yojana. Shortlisted candidate must remit ₹700 document registration fee to approve scholarship ledger.",
        "Government of Himachal Pradesh, Department of Higher Education. Mukhya Mantri Protsahan Yojana. Merit incentive of ₹75,000 is directly credited to bank accounts of students admitted to national institutes.",
        "scholarship_scam", "GRP-FORMAL-051"
    ),
    # 52. State Higher Education Council (Uttarakhand)
    (
        "Uttarakhand State Higher Education Board. Gaura Devi Kanya Dhan & Higher Education Grant. Pay ₹550 identity card and portal processing fee to confirm student grant allotment.",
        "Uttarakhand State Higher Education Board. Gaura Devi Kanya Dhan & Higher Education Grant. Beneficiary eligibility lists are verified through Gram Panchayat and municipal authorities at zero cost.",
        "scholarship_scam", "GRP-FORMAL-052"
    ),
    # 53. State Higher Education Council (Jharkhand)
    (
        "Jharkhand e-Kalyan Welfare Portal. Post-Matric Scholarship Notification. Your application requires document re-verification: Deposit ₹800 verification penalty fee to reactivate pending claim.",
        "Jharkhand e-Kalyan Welfare Portal. Post-Matric Scholarship Notification. Applicants with rejected applications can re-upload corrected certificates on e-Kalyan portal without paying any fine or penalty.",
        "scholarship_scam", "GRP-FORMAL-053"
    ),
    # 54. State Higher Education Council (Chhattisgarh)
    (
        "Government of Chhattisgarh, Tribal and Scheduled Caste Development Department. State Post-Matric Scholarship Portal. Pay ₹700 central server verification fee to approve college fee waiver.",
        "Government of Chhattisgarh, Tribal and Scheduled Caste Development Department. State Post-Matric Scholarship Portal. College principals are required to forward verified student claims to district collectors.",
        "scholarship_scam", "GRP-FORMAL-054"
    ),
    # 55. State Higher Education Council (Assam)
    (
        "Directorate of Higher Education, Assam. Pragyan Bharati Scheme. Candidate selection order: Deposit ₹600 administrative clearance charge to activate textbook and admission allowance.",
        "Directorate of Higher Education, Assam. Pragyan Bharati Scheme. Free admission and textbook allowances are disbursed to verified provincialized colleges without candidate fee deduction.",
        "scholarship_scam", "GRP-FORMAL-055"
    ),
    # 56. State Higher Education Council (Goa)
    (
        "Government of Goa, Directorate of Higher Education. Bursary Scheme for Higher Education 2026. Approved beneficiary must pay ₹500 portal verification charge to authorize annual tuition refund.",
        "Government of Goa, Directorate of Higher Education. Bursary Scheme for Higher Education 2026. The bursary scheme reimburses eligible tuition fees directly to students' accounts after annual exam clearance.",
        "scholarship_scam", "GRP-FORMAL-056"
    ),
    # 57. State Higher Education Council (Delhi)
    (
        "Government of NCT of Delhi, Department of Higher Education. Merit-cum-Means Financial Assistance Scheme. Pay ₹850 verification deposit on Delhi e-District portal to clear pending scholarship dossier.",
        "Government of NCT of Delhi, Department of Higher Education. Merit-cum-Means Financial Assistance Scheme. Verification of family income certificates is completed by sub-divisional magistrates without fee.",
        "scholarship_scam", "GRP-FORMAL-057"
    ),
    # 58. State Higher Education Council (Jammu & Kashmir)
    (
        "Higher Education Department, Government of Jammu and Kashmir. Special Higher Education Incentive Award. Pay ₹950 candidate allotment clearance fee to issue final fellowship sanction order.",
        "Higher Education Department, Government of Jammu and Kashmir. Special Higher Education Incentive Award. All incentive awards are distributed transparently through the JK e-Governance service portal.",
        "scholarship_scam", "GRP-FORMAL-058"
    ),
    # 59. National Testing Agency Merit Scholarship Wing
    (
        "National Testing Agency (NTA) Merit Fellowship Board. CUET National Undergraduate Scholarship Allocation. Remit ₹1,000 score verification and seat confirmation deposit to approve scholarship grant.",
        "National Testing Agency (NTA) Merit Fellowship Board. CUET National Undergraduate Scholarship Allocation. NTA does not collect any fee or deposit for scholarship allocation after the entrance examination.",
        "scholarship_scam", "GRP-FORMAL-059"
    ),
    # 60. National Education Technology Forum
    (
        "National Educational Technology Forum (NETF), Ministry of Education. AI for Higher Education Student Grant 2026. Pay ₹1,200 cloud computing token clearance fee to disburse student research stipend.",
        "National Educational Technology Forum (NETF), Ministry of Education. AI for Higher Education Student Grant 2026. Student cloud computing credits and stipends are provided through verified institutional tie-ups.",
        "scholarship_scam", "GRP-FORMAL-060"
    ),
]

# 30 Independent Held-Out Formal Scams and 30 Independent Held-Out Formal Genuine Notices
# Written independently of the 60 training templates (different schemes, bodies, wording)
HELD_OUT_FORMAL_DATA = [
    # 1
    ("National Council of Educational Research and Training (NCERT). National Talent Search Student Assistance. Shortlisted candidate must remit refundable document validation deposit of ₹800 to issue fellowship grant.", "suspicious"),
    ("National Council of Educational Research and Training (NCERT). National Talent Search Student Assistance. State liaison officers are instructed to forward verified school student lists to NCERT headquarters before the deadline.", "benign"),
    # 2
    ("Central Sanskrit University, Ministry of Education. National Sanskrit Student Merit Stipend. Deposit ₹600 shastra verification processing charge on student gateway to confirm monthly award.", "suspicious"),
    ("Central Sanskrit University, Ministry of Education. National Sanskrit Student Merit Stipend. Merit awardees will receive monthly scholarship via direct bank transfer upon submission of annual marksheet.", "benign"),
    # 3
    ("National Board of Higher Mathematics (NBHM), Department of Atomic Energy. Mathematics Research Fellowship 2026. Remit ₹1,100 thesis clearance fee to release monthly research stipend.", "suspicious"),
    ("National Board of Higher Mathematics (NBHM), Department of Atomic Energy. Mathematics Research Fellowship 2026. Selected doctoral candidates must report to their respective university department to sign joining report.", "benign"),
    # 4
    ("Ministry of Law and Justice, Department of Legal Affairs. National Law Student Research Grant. Shortlisted students must deposit ₹950 verification charges to validate research intern allocation.", "suspicious"),
    ("Ministry of Law and Justice, Department of Legal Affairs. National Law Student Research Grant. Selected research interns will be assigned to law commission projects with zero onboarding fees.", "benign"),
    # 5
    ("National Institute of Rural Development (NIRDPR). Rural Governance Student Fellowship 2026. Remit ₹750 field verification security charge to confirm regional student posting.", "suspicious"),
    ("National Institute of Rural Development (NIRDPR). Rural Governance Student Fellowship 2026. Field allowances and student travel grants are processed directly by the institute finance department.", "benign"),
    # 6
    ("Sports Authority of India (SAI), Ministry of Youth Affairs. Khelo India Student Athlete Stipend. Pay ₹1,200 biometric sports clearance charge to unlock national athlete stipend voucher.", "suspicious"),
    ("Sports Authority of India (SAI), Ministry of Youth Affairs. Khelo India Student Athlete Stipend. Accredited academy athletes will receive quarterly out-of-pocket allowances directly into bank accounts.", "benign"),
    # 7
    ("Ministry of Information and Broadcasting. Satyajit Ray Film & Media Student Fellowship. Shortlisted candidate must pay ₹1,000 project screening fee on portal to disburse student production grant.", "suspicious"),
    ("Ministry of Information and Broadcasting. Satyajit Ray Film & Media Student Fellowship. Film project grants are sanctioned based on jury evaluations conducted without any candidate review fee.", "benign"),
    # 8
    ("Directorate of Hindi Implementation, Ministry of Education. Central Hindi Student Fellowship Award. Deposit ₹500 translation dossier fee to authorize monthly scholarship disbursement.", "suspicious"),
    ("Directorate of Hindi Implementation, Ministry of Education. Central Hindi Student Fellowship Award. University Hindi department heads must certify regular student attendance for monthly stipend release.", "benign"),
    # 9
    ("National Green Tribunal (NGT) Environmental Law Student Internship. Provisionally selected candidate must pay ₹1,300 environmental registry clearance fee to confirm internship desk.", "suspicious"),
    ("National Green Tribunal (NGT) Environmental Law Student Internship. The registry cautions that NGT never charges any fee, bond, or deposit from law students applying for internships.", "benign"),
    # 10
    ("Indian Council of Historical Research (ICHR). Post-Doctoral Historical Fellowship 2026. Shortlisted candidate must transfer ₹1,400 archival review charge to receive first grant installment.", "suspicious"),
    ("Indian Council of Historical Research (ICHR). Post-Doctoral Historical Fellowship 2026. Fellowship grants are released half-yearly following submission of verified research progress chapters.", "benign"),
    # 11
    ("National Commission for Women (NCW). Women Student Legal Literacy Fellowship. Pay ₹650 candidate ledger processing fee to activate monthly honorarium allocation.", "suspicious"),
    ("National Commission for Women (NCW). Women Student Legal Literacy Fellowship. Selected student fellows will be trained directly at state legal services authorities without fee.", "benign"),
    # 12
    ("National Book Trust (NBT), Ministry of Education. Young Author Student Fellowship Award. Shortlisted authors must deposit ₹900 manuscript evaluation duty on portal to release ₹50,000 award.", "suspicious"),
    ("National Book Trust (NBT), Ministry of Education. Young Author Student Fellowship Award. Prime Minister YUVA scheme mentorship and book royalties are disbursed as per NBT guidelines with zero fee.", "benign"),
    # 13
    ("Bureau of Police Research and Development (BPRD). Cyber Crime Student Research Stipend. Remit mandatory security verification fee of ₹1,500 to finalize research student badge issuance.", "suspicious"),
    ("Bureau of Police Research and Development (BPRD). Cyber Crime Student Research Stipend. Student research interns undergo background verification coordinated directly by home department authorities.", "benign"),
    # 14
    ("Khadi and Village Industries Commission (KVIC). Rural Entrepreneurship Student Grant. Deposit ₹700 khadi development clearance fee to unlock student project grant.", "suspicious"),
    ("Khadi and Village Industries Commission (KVIC). Rural Entrepreneurship Student Grant. Prime Minister Employment Generation Programme subsidies are sanctioned through designated nationalized banks.", "benign"),
    # 15
    ("National Institute of Design (NID). Innovation in Design Student Fellowship. Shortlisted student must remit ₹850 studio allocation fee to authorize monthly design grant.", "suspicious"),
    ("National Institute of Design (NID). Innovation in Design Student Fellowship. Design innovation grants are awarded strictly based on academic portfolio review with zero deposit.", "benign"),
    # 16
    ("National Productivity Council (NPC). Industrial Efficiency Student Internship 2026. Remit ₹1,100 field training clearance charge to confirm candidate registration.", "suspicious"),
    ("National Productivity Council (NPC). Industrial Efficiency Student Internship 2026. Stipendiary internship allocations are notified to respective college placement cells without charges.", "benign"),
    # 17
    ("Insolvency and Bankruptcy Board of India (IBBI). Student Research Fellowship Award. Deposit ₹1,250 regulatory dossier verification fee to disburse research stipend.", "suspicious"),
    ("Insolvency and Bankruptcy Board of India (IBBI). Student Research Fellowship Award. Selected research fellows must execute the official research code of conduct before joining.", "benign"),
    # 18
    ("National Institute of Educational Planning and Administration (NIEPA). Higher Education Policy Fellowship. Pay ₹750 digital record processing fee to activate fellowship account.", "suspicious"),
    ("National Institute of Educational Planning and Administration (NIEPA). Higher Education Policy Fellowship. Fellows will receive university accommodation and monthly grant via PFMS electronic portal.", "benign"),
    # 19
    ("Ministry of Jal Shakti, Department of Water Resources. National Groundwater Student Fellowship. Remit ₹950 hydrology station clearance fee to approve student research grant.", "suspicious"),
    ("Ministry of Jal Shakti, Department of Water Resources. National Groundwater Student Fellowship. Regional hydrology project grants are credited directly to authorized college research accounts.", "benign"),
    # 20
    ("National Institute of Biologicals (NIB). Quality Assurance Student Trainee Stipend. Pay ₹800 laboratory biosafety verification fee to validate trainee allotment.", "suspicious"),
    ("National Institute of Biologicals (NIB). Quality Assurance Student Trainee Stipend. Quality assurance trainees undergo mandatory institutional induction with zero fees charged to trainees.", "benign"),
    # 21
    ("Archaeological Survey of India (ASI). Monument Conservation Student Fellowship. Shortlisted candidate must remit ₹1,050 excavation equipment security deposit to confirm award.", "suspicious"),
    ("Archaeological Survey of India (ASI). Monument Conservation Student Fellowship. Field excavation equipment and safety gear are issued by the ASI circle office without deposit.", "benign"),
    # 22
    ("Central Silk Board, Ministry of Textiles. Sericulture Student Research Assistance. Deposit ₹600 laboratory vetting charge on gateway to activate monthly grant.", "suspicious"),
    ("Central Silk Board, Ministry of Textiles. Sericulture Student Research Assistance. Research stipends are released in accordance with central silk board research norms through DBT.", "benign"),
    # 23
    ("Tea Board of India, Ministry of Commerce. Plantation Management Student Fellowship. Pay ₹700 garden inspector trainee verification fee to confirm student allowance.", "suspicious"),
    ("Tea Board of India, Ministry of Commerce. Plantation Management Student Fellowship. Trainee allowances are subsidized directly by the board under the plantation development scheme.", "benign"),
    # 24
    ("Spices Board India. Quality Evaluation Student Trainee Grant. Shortlisted student must deposit ₹850 export laboratory clearance charge to authorize stipend payout.", "suspicious"),
    ("Spices Board India. Quality Evaluation Student Trainee Grant. Training grants for post-graduate chemistry scholars are paid directly following monthly attendance verification.", "benign"),
    # 25
    ("Coir Board, Ministry of MSME. Coir Technology Innovation Student Fellowship. Remit ₹650 technical dossier registration fee to release project assistance voucher.", "suspicious"),
    ("Coir Board, Ministry of MSME. Coir Technology Innovation Student Fellowship. Selected innovators receive incubation support and grants without any upfront financial deposit.", "benign"),
    # 26
    ("National Biodiversity Authority (NBA). Biological Conservation Student Grant. Pay ₹900 taxonomy assessment fee on portal to confirm scholarship allocation.", "suspicious"),
    ("National Biodiversity Authority (NBA). Biological Conservation Student Grant. State biodiversity boards coordinate project funding through accredited universities with zero fee.", "benign"),
    # 27
    ("National Institute of Solar Energy (NISE). Suryamitra Student Trainee Fellowship. Remit ₹750 solar panel safety clearance charge to activate monthly stipend.", "suspicious"),
    ("National Institute of Solar Energy (NISE). Suryamitra Student Trainee Fellowship. The Suryamitra training program is 100% government sponsored with no fee charged to candidates.", "benign"),
    # 28
    ("Food Safety and Standards Authority of India (FSSAI). National Food Analyst Student Internship. Deposit ₹1,150 laboratory safety kit security fee to confirm intern posting.", "suspicious"),
    ("Food Safety and Standards Authority of India (FSSAI). National Food Analyst Student Internship. Interns are chosen through competitive evaluation and paid monthly stipends without fee.", "benign"),
    # 29
    ("National Health Systems Resource Centre (NHSRC). Public Health Student Fellowship 2026. Pay ₹950 healthcare mission verification fee to disburse research allowance.", "suspicious"),
    ("National Health Systems Resource Centre (NHSRC). Public Health Student Fellowship 2026. Public health research fellowship disbursements are executed transparently through the PFMS platform.", "benign"),
    # 30
    ("National Institute of Wind Energy (NIWE). Renewable Energy Trainee Grant. Remit ₹800 offshore turbine documentation deposit to confirm candidate scholarship ledger.", "suspicious"),
    ("National Institute of Wind Energy (NIWE). Renewable Energy Trainee Grant. Engineering students selected for renewable energy training receive travel support and stipends at no cost.", "benign"),
]

def main():
    print(f"Total Paired Training Rows to Add: {len(PAIRED_FORMAL_DATA) * 2} (60 Scam, 60 Genuine)")
    print(f"Total Held-Out Evaluation Rows to Create: {len(HELD_OUT_FORMAL_DATA)} (30 Scam, 30 Genuine)")

    # 1. Prepare Training Rows
    train_rows = []
    for scam_text, genuine_text, scam_type, grp_id in PAIRED_FORMAL_DATA:
        train_rows.append({
            "text": scam_text,
            "label": "suspicious",
            "scam_type": scam_type,
            "language": "en",
            "source_file": "formal_scholarships.csv",
            "source_type": "synthetic",
            "license_note": "synthetic_formal_hard_positives",
            "group_id": grp_id,
            "source_family": "FORMAL",
        })
        train_rows.append({
            "text": genuine_text,
            "label": "benign",
            "scam_type": "none",
            "language": "en",
            "source_file": "formal_scholarships.csv",
            "source_type": "synthetic",
            "license_note": "synthetic_formal_hard_negatives",
            "group_id": grp_id,
            "source_family": "FORMAL",
        })

    # Read existing final_train.csv
    final_train_path = DATA_DIR / "final_train.csv"
    existing_rows = []
    with open(final_train_path, "r", encoding="utf-8") as f:
        reader = csv.DictReader(f)
        fieldnames = reader.fieldnames
        for r in reader:
            existing_rows.append(r)

    print(f"Existing rows in final_train.csv: {len(existing_rows)}")

    # Check for duplicate text
    existing_norm_texts = set(normalize_text(r["text"]) for r in existing_rows)
    for r in train_rows:
        n_text = normalize_text(r["text"])
        assert n_text not in existing_norm_texts, f"Collision detected: {r['text'][:60]}"

    # Append to final_train.csv
    new_final_rows = existing_rows + train_rows
    print(f"New total rows in final_train.csv: {len(new_final_rows)}")

    with open(final_train_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=fieldnames)
        writer.writeheader()
        for r in new_final_rows:
            writer.writerow(r)

    print("Updated final_train.csv successfully.")

    # 2. Write Held-Out Evaluation Dataset (services/classifier/data/formal_held_out_eval.csv)
    held_out_path = DATA_DIR / "formal_held_out_eval.csv"
    held_out_fields = ["id", "text", "label", "source_type", "scam_type", "notes"]

    held_out_rows = []
    for idx, (text, label) in enumerate(HELD_OUT_FORMAL_DATA, 1):
        stype = "scholarship_fee_scam" if label == "suspicious" else "none"
        held_out_rows.append({
            "id": f"FORMAL-HELD-{idx:03d}",
            "text": text,
            "label": label,
            "source_type": "synthetic",
            "scam_type": stype,
            "notes": "independent_formal_held_out_sample"
        })

    with open(held_out_path, "w", encoding="utf-8", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=held_out_fields)
        writer.writeheader()
        for r in held_out_rows:
            writer.writerow(r)

    print(f"Written {len(held_out_rows)} independent held-out evaluation rows to {held_out_path}.")

if __name__ == "__main__":
    main()
