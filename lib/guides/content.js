/**
 * lib/guides/content.js
 *
 * Authoritative, evidence-backed educational guide content for students.
 * Strictly adheres to the following constraints:
 * - Content is derived SOLELY from repository facts (PRD.md section 2, Flag Registry, manual-links, and known domains).
 * - Zero invented statistics, percentages, or arbitrary numbers.
 * - Every claim explicitly maps to at least one source id in sources.
 * - Neutral phrasing: no defamatory accusations of named people or organisations.
 * - Reporting channels strictly recommend users to "verify on the official site".
 * - No phone numbers or URLs in prose outside the structured sources list.
 * - reviewStatus: "draft_needs_review", language: "en".
 */

export const GUIDES_CONTENT = Object.freeze([
  // 1. Fake Scholarship
  Object.freeze({
    type: "scholarship_scam",
    title: "Fake Scholarship Offers & Advance Fee Demands",
    summary: "How to identify fraudulent scholarship notices demanding application, processing, or disbursement fees.",
    howItWorks: [
      "Solicitations arrive via WhatsApp, SMS, or phone calls claiming the student or parent was selected for a scholarship grant.",
      "The message directs the recipient to a non-governmental website mimicking an official scholarship portal.",
      "The sender demands an upfront registration, verification, or file processing fee before releasing the funds.",
      "The recipient may be prompted to download an untrusted APK file or scan a QR code to receive the payment.",
    ],
    redFlags: [
      "Upfront application, registration, or processing fee demanded to disburse scholarship funds.",
      "Claims of being an official Indian government scheme hosted on a domain not ending in .gov.in or .nic.in.",
      "Disbursement or registration payments directed to an individual or personal UPI handle.",
      "Domain visually or phonetically imitating an established official educational portal.",
      "Prompts to install an out-of-store Android APK file or scan a QR code to receive money.",
    ],
    whatToVerify: [
      "Verify whether the scholarship scheme exists on the official National Scholarship Portal.",
      "Confirm that the official website domain ends with the official government suffix .gov.in.",
      "Check whether your college administration or scholarship welfare department has received an official government circular.",
    ],
    whatToDo: [
      "Never pay an upfront fee to claim or activate an educational scholarship or government grant.",
      "Never scan a QR code or enter your UPI PIN to receive money.",
      "Never download or install Android APK packages sent through messaging channels.",
      "Verify the opportunity directly with your college placement cell or student welfare officer.",
    ],
    alreadyPaid: [
      "Immediately contact your bank or UPI provider helpline to report the unauthorized transaction and request an account freeze.",
      "File a formal cyber fraud complaint on the National Cyber Crime Reporting Portal (verify on the official site).",
      "Report fraudulent communication or impersonation via the Chakshu Portal on Sanchar Saathi (verify on the official site).",
      "Preserve all transaction reference numbers (UTR), SMS receipts, payment screenshots, and chat messages as evidence.",
    ],
    claims: [
      Object.freeze({
        claim: "Genuine government scholarship schemes are hosted on official government domains ending in .gov.in or .nic.in.",
        sourceIds: ["national_scholarship_portal", "known_domains_education"],
      }),
      Object.freeze({
        claim: "Legitimate scholarships disburse funds directly to students and do not demand an upfront fee to release money.",
        sourceIds: ["national_scholarship_portal"],
      }),
      Object.freeze({
        claim: "Scanning a QR code or entering a UPI PIN authorizes a debit from your account, never a credit.",
        sourceIds: ["pib_fact_check"],
      }),
    ],
    sources: [
      Object.freeze({
        id: "national_scholarship_portal",
        title: "National Scholarship Portal (NSP)",
        publisher: "Ministry of Electronics and Information Technology, Government of India",
        url: "https://scholarships.gov.in",
        verified: false,
        retrievalNote: "Curated official government verification portal listed in repository manual links.",
      }),
      Object.freeze({
        id: "pib_fact_check",
        title: "PIB Fact Check Portal",
        publisher: "Press Information Bureau, Government of India",
        url: "https://factcheck.pib.gov.in",
        verified: false,
        retrievalNote: "Official Government of India fact-checking portal listed in repository manual links.",
      }),
      Object.freeze({
        id: "known_domains_education",
        title: "Ministry of Education Official Portal",
        publisher: "Ministry of Education, Government of India",
        url: "https://www.education.gov.in",
        verified: false,
        retrievalNote: "Official education ministry domain listed in repository known-domains registry.",
      }),
    ],
    reviewStatus: "draft_needs_review",
    language: "en",
    lastReviewed: "2026-10-25",
  }),

  // 2. Fake Internship or Job
  Object.freeze({
    type: "internship_scam",
    title: "Fake Internship & Recruitment Fraud",
    summary: "How to spot employment offers issued without an interview that demand training, document, or equipment fees.",
    howItWorks: [
      "Candidates receive unsolicited selection letters or messages for attractive internship or job roles without undergoing a formal interview.",
      "The recruiter claims to represent a recognized corporate entity but communicates using a free webmail address.",
      "Before starting work or issuing an appointment letter, the applicant is asked to pay a security deposit, document fee, or training charge.",
      "Payment is often requested via UPI to a personal account rather than an official corporate current account.",
    ],
    redFlags: [
      "Direct selection or job offer letter issued without any prior application, assessment, or interview.",
      "Demand for a registration, training, laptop security, or background verification fee before onboarding.",
      "Recruiter claims to represent an enterprise but contacts candidates from a free webmail domain.",
      "Payment requested to a personal UPI ID rather than a verified business account.",
      "The hiring company cannot be verified in the official corporate registry.",
    ],
    whatToVerify: [
      "Verify whether the company is actively registered in the Ministry of Corporate Affairs portal.",
      "Check whether the company possesses a valid GST registration on the official GST portal.",
      "Cross-check recruitment drives on official career portals such as AICTE Internship or company websites.",
      "Confirm the legitimacy of campus opportunities directly with your college placement cell.",
    ],
    whatToDo: [
      "Never pay money for job applications, interview scheduling, internship training, or work equipment.",
      "Insist on verifiable corporate email correspondence from official domains.",
      "Verify company credentials and registration before signing agreements or sharing identity documents.",
      "Report unsolicited recruitment fee demands to your institutional placement officer.",
    ],
    alreadyPaid: [
      "Contact your bank or payment provider immediately to flag the transaction and request payment recall.",
      "Lodge an incident report on the National Cyber Crime Reporting Portal (verify on the official site).",
      "Report the recruiter contact details to the Chakshu Portal (verify on the official site).",
      "Preserve all offer letters, email headers, payment proofs, and chat correspondence.",
    ],
    claims: [
      Object.freeze({
        claim: "Legitimate corporate recruiters do not demand monetary deposits or training fees as a prerequisite for hiring.",
        sourceIds: ["mca_portal", "aicte_internship_portal"],
      }),
      Object.freeze({
        claim: "Corporate status and active legal existence can be verified in public company registries.",
        sourceIds: ["mca_portal", "gst_portal"],
      }),
    ],
    sources: [
      Object.freeze({
        id: "mca_portal",
        title: "Ministry of Corporate Affairs (MCA) Portal",
        publisher: "Ministry of Corporate Affairs, Government of India",
        url: "https://www.mca.gov.in",
        verified: false,
        retrievalNote: "Curated official corporate registry portal listed in repository manual links.",
      }),
      Object.freeze({
        id: "gst_portal",
        title: "GST Taxpayer Search Portal",
        publisher: "Goods and Services Tax Network, Government of India",
        url: "https://www.gst.gov.in",
        verified: false,
        retrievalNote: "Curated official taxpayer search registry listed in repository manual links.",
      }),
      Object.freeze({
        id: "aicte_internship_portal",
        title: "AICTE Internship Enterprise Portal",
        publisher: "All India Council for Technical Education",
        url: "https://internship.aicte-india.org",
        verified: false,
        retrievalNote: "Official student internship portal listed in repository known-domains registry.",
      }),
    ],
    reviewStatus: "draft_needs_review",
    language: "en",
    lastReviewed: "2026-10-25",
  }),

  // 3. Task or Part-Time Job Scam
  Object.freeze({
    type: "task_scam",
    title: "Task-Based Online Job & Daily Earning Traps",
    summary: "How to identify part-time work offers involving messaging groups, rating tasks, and escalating deposit demands.",
    howItWorks: [
      "Students are contacted with promises of high daily earnings for simple online tasks such as liking videos, rating apps, or submitting reviews.",
      "The victim is instructed to move communication to private Telegram or WhatsApp groups.",
      "Initial small tasks yield modest token payouts to establish false trust.",
      "The scheme then requires the participant to deposit funds to unlock premium or VIP tasks, preventing withdrawal of deposited money.",
    ],
    redFlags: [
      "Promises of guaranteed daily income for minimal effort like rating maps, liking videos, or posting reviews.",
      "Strong insistence on shifting conversation from public platforms to private messaging groups.",
      "Mandatory requirement to deposit personal money in order to unlock tasks or withdraw accumulated earnings.",
      "Sharing of fabricated screenshots depicting high member earnings in group chats.",
      "Demands to send deposits to multiple rotating individual UPI IDs or accounts.",
    ],
    whatToVerify: [
      "Check whether public warnings or advisories have been issued by government fact-checking authorities regarding task jobs.",
      "Search for consumer complaints regarding the platform or coordinator handle.",
      "Verify whether the coordinating entity is an authorized business entity in corporate registries.",
    ],
    whatToDo: [
      "Decline offers that require paying your own money to earn money or unlock work assignments.",
      "Do not join unverified messaging groups promising daily returns for app ratings or video reviews.",
      "Do not click unverified links or download custom applications sent by task coordinators.",
      "Stop communication immediately when asked to make a deposit, even if earlier small payouts occurred.",
    ],
    alreadyPaid: [
      "Immediately contact your bank or UPI service provider to report the transaction as fraud and request an account freeze.",
      "Lodge a complaint on the National Cyber Crime Reporting Portal under cyber fraud (verify on the official site).",
      "Submit the coordinator handles and communication details to the Chakshu Portal (verify on the official site).",
      "Retain screenshots of task dashboards, group member interactions, payment receipts, and deposit instructions.",
    ],
    claims: [
      Object.freeze({
        claim: "Initial token payouts are a recognized social-engineering tactic used to lure victims into larger deposit traps.",
        sourceIds: ["pib_fact_check"],
      }),
      Object.freeze({
        claim: "Promising guaranteed earnings for rating tasks with mandatory deposits is characteristic of organized online task scams.",
        sourceIds: ["pib_fact_check", "mca_portal"],
      }),
    ],
    sources: [
      Object.freeze({
        id: "pib_fact_check",
        title: "PIB Fact Check Portal",
        publisher: "Press Information Bureau, Government of India",
        url: "https://factcheck.pib.gov.in",
        verified: false,
        retrievalNote: "Official Government of India fact-checking portal listed in repository manual links.",
      }),
      Object.freeze({
        id: "mca_portal",
        title: "Ministry of Corporate Affairs (MCA) Portal",
        publisher: "Ministry of Corporate Affairs, Government of India",
        url: "https://www.mca.gov.in",
        verified: false,
        retrievalNote: "Curated official corporate registry portal listed in repository manual links.",
      }),
    ],
    reviewStatus: "draft_needs_review",
    language: "en",
    lastReviewed: "2026-10-25",
  }),

  // 4. Money Mule Offer
  Object.freeze({
    type: "mule_account",
    title: "Money Mule Solicitations & Account Rental Pitches",
    summary: "How to recognize dangerous solicitations asking students to rent bank accounts, forward funds, or hand over credentials.",
    howItWorks: [
      "Students are approached with lucrative offers to earn easy commissions by allowing third parties to use their bank accounts.",
      "The solicitation may be disguised as student crypto trading, peer-to-peer exchange, or international business transfers.",
      "The operator requests internet banking credentials, ATM debit cards, linked SIM cards, or OTP verification codes.",
      "Funds derived from illicit activity are routed through the student's account; details of account misuse should be verified with your bank.",
    ],
    redFlags: [
      "Requests to rent, borrow, or buy your personal bank account, UPI ID, or net banking access.",
      "Offers of commission or percentage payments simply for receiving and transferring third-party funds.",
      "Requests to hand over your bank ATM card, net banking password, or telecom SIM card.",
      "Requests to share one-time passwords (OTP) or authentication codes received on your phone.",
      "Pitches framed as currency exchange, student remittance facilitation, or crypto forwarding.",
    ],
    whatToVerify: [
      "Check regulatory guidance and public notices regarding illegal account operation and mule networks.",
      "Consult your bank branch or institutional welfare officers before permitting third-party access to your account.",
      "Verify whether the entity offering commission is an authorized banking or financial institution.",
    ],
    whatToDo: [
      "Never allow any third party to receive, hold, or transfer money through your personal bank account.",
      "Never share banking passwords, OTPs, ATM PINs, or identity documents with unknown individuals.",
      "Never hand over your ATM card or registered SIM card to anyone under any pretext.",
      "Understand that renting bank accounts for third-party transactions involves severe risks and potential freezing of your account.",
    ],
    alreadyPaid: [
      "Contact your bank immediately to report that your account credentials or ATM card may have been compromised and request account blocking.",
      "Lodge a formal complaint on the National Cyber Crime Reporting Portal stating that your account was targeted (verify on the official site).",
      "Report the contact numbers and messaging channels to the Chakshu Portal (verify on the official site).",
      "Cooperate fully with banking authorities and institutional administration, preserving all chat messages and transaction histories.",
    ],
    claims: [
      Object.freeze({
        claim: "Allowing your bank account to be used for routing third-party funds constitutes unauthorized money mule activity with severe consequences.",
        sourceIds: ["pib_fact_check"],
      }),
      Object.freeze({
        claim: "Banks and official authorities never ask customers to share OTPs, net banking passwords, or ATM PINs.",
        sourceIds: ["pib_fact_check"],
      }),
    ],
    sources: [
      Object.freeze({
        id: "pib_fact_check",
        title: "PIB Fact Check Portal",
        publisher: "Press Information Bureau, Government of India",
        url: "https://factcheck.pib.gov.in",
        verified: false,
        retrievalNote: "Official Government of India fact-checking portal listed in repository manual links.",
      }),
    ],
    reviewStatus: "draft_needs_review",
    language: "en",
    lastReviewed: "2026-10-25",
  }),

  // 5. Fake Competition or Certificate
  Object.freeze({
    type: "contest_fraud",
    title: "Fake Competitions & Instant Certificate Fraud",
    summary: "How to identify counterfeit hackathons, Olympiads, and awards designed to collect entry fees and sell hollow certificates.",
    howItWorks: [
      "Promoters advertise prestigious-sounding national competitions, hackathons, or academic Olympiads across social media.",
      "The organizers borrow brand logos and imagery from reputed academic institutions, government bodies, or technology firms without authorization.",
      "Participants are charged mandatory entry fees with guarantees of cash prizes or immediate national certificates.",
      "The competition is either not conducted or delivers valueless certificates sold indiscriminately for a payment.",
    ],
    redFlags: [
      "Mandatory registration or certification fees charged by organizers with no verifiable institutional backing.",
      "Guarantees of instant award certificates or trophies simply upon paying a fee.",
      "Websites using copied branding, stock images, or unofficial domains claiming government or corporate affiliation.",
      "Lack of public presence, judge panel disclosures, or past edition records.",
      "Payment collection directed to individual personal UPI IDs rather than institutional event accounts.",
    ],
    whatToVerify: [
      "Verify whether the competition is recognized on established student platforms such as Unstop or institutional boards.",
      "Confirm claimed university or government affiliations directly with the partnering institution.",
      "Verify organizer corporate credentials in the Ministry of Corporate Affairs database.",
    ],
    whatToDo: [
      "Do not pay registration fees for competitions that cannot be verified through official institutional circulars.",
      "Check official partner websites to see if they endorse or list the contest.",
      "Be wary of programs that promise certificates without rigorous evaluation or competition criteria.",
      "Consult your department head or faculty mentor before entering external paid student challenges.",
    ],
    alreadyPaid: [
      "Report the disputed payment to your bank or UPI provider immediately.",
      "File an incident complaint on the National Cyber Crime Reporting Portal (verify on the official site).",
      "Notify your college student council or placement cell so other students can be warned.",
      "Save copies of event brochures, payment receipts, website pages, and organizer correspondence.",
    ],
    claims: [
      Object.freeze({
        claim: "Unverifiable organizers frequently copy established institutional branding to collect unearned entry fees.",
        sourceIds: ["mca_portal", "known_domains_education"],
      }),
      Object.freeze({
        claim: "Authentic university competitions are announced through official institutional portals or established competition aggregators.",
        sourceIds: ["known_domains_education"],
      }),
    ],
    sources: [
      Object.freeze({
        id: "mca_portal",
        title: "Ministry of Corporate Affairs (MCA) Portal",
        publisher: "Ministry of Corporate Affairs, Government of India",
        url: "https://www.mca.gov.in",
        verified: false,
        retrievalNote: "Curated official corporate registry portal listed in repository manual links.",
      }),
      Object.freeze({
        id: "known_domains_education",
        title: "Ministry of Education Official Portal",
        publisher: "Ministry of Education, Government of India",
        url: "https://www.education.gov.in",
        verified: false,
        retrievalNote: "Official education ministry domain listed in repository known-domains registry.",
      }),
    ],
    reviewStatus: "draft_needs_review",
    language: "en",
    lastReviewed: "2026-10-25",
  }),

  // 6. Overseas Study or Visa Agent
  Object.freeze({
    type: "overseas_agent",
    title: "Overseas Study Guarantees & Visa Consultant Fraud",
    summary: "How to evaluate overseas educational consultants offering direct admission promises, forged documentation, and upfront fee demands.",
    howItWorks: [
      "Unregistered education agents promise direct admissions to prestigious foreign universities without requiring standard entrance tests.",
      "The consultant promises guaranteed visa issuance and offers to arrange backdated financial or academic records for a charge.",
      "Applicants are pressured into paying large admission deposits or documentation charges directly to personal consultant accounts.",
      "Victims receive forged admission letters or face visa rejections due to fraudulent submissions; details to be confirmed with an official source.",
    ],
    redFlags: [
      "Unrealistic promises of guaranteed visa approval or direct university admission bypassing standard institutional admission procedures.",
      "Offers to create forged work experience documents, fraudulent bank balance certificates, or fake scorecards.",
      "Demands for large deposits or processing payments to be transferred to personal bank accounts or cash.",
      "Reluctance to provide formal written agency contracts or receipts.",
      "Claims that the agent has exclusive backchannel relationships with foreign embassies or universities.",
    ],
    whatToVerify: [
      "Verify whether the consultant's agency is registered in the Ministry of Corporate Affairs registry.",
      "Check whether the agency has a valid registered GSTIN on the official GST portal.",
      "Verify foreign university accreditation directly on the foreign university's official domain.",
      "Check official advisories issued by national educational regulators such as the University Grants Commission.",
    ],
    whatToDo: [
      "Never participate in submitting forged documentation or fake financial records for visa or university applications.",
      "Always apply directly through official foreign university portals or verified institutional partnerships.",
      "Never pay university tuition fees or visa charges to a personal account of an agent.",
      "Insist on transparent agreements detailing services, fee breakdowns, and refund conditions.",
    ],
    alreadyPaid: [
      "Report the transaction to your bank and consult institutional counselors regarding recovery of disputed funds.",
      "Lodge a formal cybercrime and economic fraud complaint on the National Cyber Crime Reporting Portal (verify on the official site).",
      "Report fraudulent consultant communication to the Chakshu Portal (verify on the official site).",
      "Preserve all consultation contracts, fee receipts, email correspondence, and submitted application files.",
    ],
    claims: [
      Object.freeze({
        claim: "Submitting forged academic or financial records to foreign embassies or universities leads to visa rejections; details to be confirmed with an official source.",
        sourceIds: ["pib_fact_check", "ugc_portal"],
      }),
      Object.freeze({
        claim: "Higher education regulatory advisories warn students against unaccredited institutions and unverified overseas consultants.",
        sourceIds: ["ugc_portal", "mca_portal"],
      }),
    ],
    sources: [
      Object.freeze({
        id: "ugc_portal",
        title: "University Grants Commission (UGC) Portal",
        publisher: "University Grants Commission, Government of India",
        url: "https://www.ugc.ac.in",
        verified: false,
        retrievalNote: "Higher education regulatory body listed in repository known-domains registry.",
      }),
      Object.freeze({
        id: "mca_portal",
        title: "Ministry of Corporate Affairs (MCA) Portal",
        publisher: "Ministry of Corporate Affairs, Government of India",
        url: "https://www.mca.gov.in",
        verified: false,
        retrievalNote: "Curated official corporate registry portal listed in repository manual links.",
      }),
      Object.freeze({
        id: "pib_fact_check",
        title: "PIB Fact Check Portal",
        publisher: "Press Information Bureau, Government of India",
        url: "https://factcheck.pib.gov.in",
        verified: false,
        retrievalNote: "Official Government of India fact-checking portal listed in repository manual links.",
      }),
    ],
    reviewStatus: "draft_needs_review",
    language: "en",
    lastReviewed: "2026-10-25",
  }),
]);
