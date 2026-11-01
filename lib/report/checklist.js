/**
 * lib/report/checklist.js
 *
 * Fixed base verification steps for all 29 registry flag IDs in English and Hindi.
 * Every registry flag ID maps deterministically to a concrete verification action.
 *
 * NOTE: Hindi translations marked with "needs native review" are starting placeholders.
 */

export const FLAG_CHECKLIST_MAP = Object.freeze({
  scholarship_fee_demand: {
    en: "Do NOT pay any upfront registration or processing fee. Legitimate government and institutional scholarships never charge application or release fees.",
    hi: "कोई भी अग्रिम शुल्क या प्रोसेसिंग फीस न दें। वैध छात्रवृत्तियां कभी आवेदन या वितरण शुल्क नहीं लेती हैं।", // needs native review
    url: "https://scholarships.gov.in",
  },
  fee_demand: {
    en: "Never pay training, security deposit, or registration fees at any stage of hiring or scholarship processing.",
    hi: "भर्ती या छात्रवृत्ति प्रक्रिया के किसी भी चरण में प्रशिक्षण, सुरक्षा जमा या पंजीकरण शुल्क कभी न दें।", // needs native review
    url: null,
  },
  equipment_advance: {
    en: "Never send money to an employer or third-party vendor to purchase equipment or laptops. Legitimate employers ship equipment directly.",
    hi: "उपकरण या लैपटॉप खरीदने के लिए नियोक्ता या विक्रेता को पैसे कभी न भेजें। वैध नियोक्ता सीधे उपकरण भेजते हैं।", // needs native review
    url: null,
  },
  unsolicited_award: {
    en: "Never pay claiming or processing fees for competitions or scholarships you did not enter. Legitimate scholarships never charge claiming fees.",
    hi: "उन प्रतियोगिताओं या छात्रवृत्तियों के लिए दावा शुल्क कभी न दें जिनमें आपने भाग नहीं लिया था।", // needs native review
    url: null,
  },
  chat_only_interview: {
    en: "Insist on a verifiable video interview or in-person meeting. Legitimate organizations do not hire entirely over Telegram or WhatsApp chat.",
    hi: "सत्यापित वीडियो या व्यक्तिगत साक्षात्कार की मांग करें। वैध संगठन केवल चैट पर भर्ती नहीं करते हैं।", // needs native review
    url: null,
  },
  candidate_picks_hours: {
    en: "Verify role responsibilities and contract terms. Complete flexibility with guaranteed high income is a common recruitment lure.",
    hi: "भूमिका की जिम्मेदारियों और अनुबंध की पुष्टि करें। गारंटीकृत उच्च आय के साथ पूर्ण कार्य-समय की स्वतंत्रता अक्सर एक प्रलोभन होती है।", // needs native review
    url: null,
  },
  pay_too_high: {
    en: "Compare offered compensation against standard industry rates for the specified skill level and responsibilities.",
    hi: "प्रस्तावित वेतन की तुलना उद्योग मानकों और कार्य जटिलता से करें।", // needs native review
    url: null,
  },
  unusual_pay_schedule: {
    en: "Insist on standard payroll or milestone disbursement contracts rather than immediate per-task or daily UPI payments.",
    hi: "दैनिक या प्रति-कार्य यूपीआई भुगतान के बजाय मानक मासिक वेतन अनुबंध की मांग करें।", // needs native review
    url: null,
  },
  data_harvest_redirects: {
    en: "Do not enter personal or educational credentials on unverified third-party forms reached through redirect links.",
    hi: "रीडायरेक्ट लिंक के माध्यम से खोले गए असत्यापित फॉर्म पर व्यक्तिगत विवरण दर्ज न करें।", // needs native review
    url: null,
  },
  mule_account_request: {
    en: "Never share, rent, or transfer your bank account, ATM card, or UPI credentials to third parties for money transfers. Account mule solicitations are severe criminal offenses.",
    hi: "पैसे के हस्तांतरण के लिए कभी भी अपना बैंक खाता, एटीएम या यूपीआई विवरण किसी को न दें। म्यूल खाता एक गंभीर अपराध है।", // needs native review
    // TODO: Verify https://cybercrime.gov.in before enabling as manual link
    url: null,
  },
  bank_details_request: {
    en: "Do not disclose net banking passwords, debit card PINs, CVV, or full banking credentials. Legitimate employers only need account number and IFSC for salary credit.",
    hi: "नेट बैंकिंग पासवर्ड, एटीएम पिन या सीवीवी कभी साझा न करें। वैध संस्थान केवल वेतन जमा हेतु खाता संख्या और आईएफएससी मांगते हैं।", // needs native review
    url: null,
  },
  otp_or_id_request: {
    en: "Never share Aadhaar OTPs, banking OTPs, or un-redacted identity documents with unknown recruiters.",
    hi: "अज्ञात भर्तीकर्ताओं के साथ कभी भी आधार ओटीपी, बैंक ओटीपी या निजी दस्तावेज साझा न करें।", // needs native review
    url: null,
  },
  authority_impersonation: {
    en: "Cross-check the sender's claims directly on the official ministry or institution portal (e.g., gov.in or nic.in) before responding.",
    hi: "जवाब देने से पहले आधिकारिक मंत्रालय या संस्थान पोर्टल (gov.in या nic.in) पर सीधे दावे की पुष्टि करें।", // needs native review
    url: "https://factcheck.pib.gov.in",
  },
  task_deposit_script: {
    en: "Cease participation immediately. Small initial payouts followed by demands for larger recharge or VIP deposits are hallmark task scam scripts.",
    hi: "तुरंत काम बंद करें। छोटे भुगतान के बाद बड़े वीआईपी रिचार्ज की मांग विशिष्ट कार्य-घोटाले (टास्क स्कैम) की पहचान है।", // needs native review
    url: null,
  },
  crypto_payment_request: {
    en: "Never send cryptocurrency, stablecoins (USDT), or crypto tokens for job applications or task deposits. Legitimate employers never transact in crypto.",
    hi: "नौकरी के आवेदनों या टास्क डिपॉजिट के लिए कभी भी क्रिप्टोकरेंसी या यूएसडीटी न भेजें। वैध नियोक्ता कभी भी क्रिप्टो में लेनदेन नहीं करते हैं।",
    url: null,
  },
  paid_placement_guarantee: {
    en: "Do NOT pay upfront course or placement fees for '100% job guarantees'. Legitimate recruiters are paid by employers, never candidates.",
    hi: "'100% नौकरी की गारंटी' के लिए अग्रिम पाठ्यक्रम या प्लेसमेंट शुल्क न दें। वैध भर्तीकर्ताओं को नियोक्ता भुगतान करते हैं, उम्मीदवार नहीं।",
    url: null,
  },
  unpaid_trial_work: {
    en: "Decline requests for extensive uncompensated trial labor or multi-day production work before hiring. Legitimate hiring evaluates skills through standard interviews or paid trials.",
    hi: "भर्ती से पहले बिना वेतन के कई दिनों के परीक्षण कार्य या उत्पादन कार्य की मांग को अस्वीकार करें। वैध कंपनियां सशुल्क परीक्षण या मानक साक्षात्कार का उपयोग करती हैं।",
    url: null,
  },
  referral_recruitment: {
    en: "Do not participate in schemes requiring you to recruit friends or downlines to unlock tasks, payments, or higher tiers. Multi-level referral hiring is a common pyramid scheme tactic.",
    hi: "उन योजनाओं में भाग न लें जिनमें कार्य या भुगतान अनलॉक करने के लिए दोस्तों या अन्य लोगों को भर्ती करने की आवश्यकता होती है। यह पिरामिड धोखाधड़ी की पहचान है।",
    url: null,
  },
  apk_download_prompt: {
    en: "Do NOT download or install APK files or third-party apps outside of the official Google Play Store or Apple App Store.",
    hi: "आधिकारिक गूगल प्ले स्टोर के बाहर किसी भी एपीके फाइल या ऐप को डाउनलोड या इंस्टॉल न करें।", // needs native review
    url: null,
  },
  url_in_threat_feed: {
    en: "Do NOT click links or enter any personal credentials on this domain. It has been flagged in active cybersecurity threat databases.",
    hi: "इस डोमेन पर किसी लिंक पर क्लिक न करें और न ही क्रेडेंशियल्स दर्ज करें। यह सुरक्षा डेटाबेस में दुर्भावनापूर्ण चिह्नित है।", // needs native review
    url: null,
  },
  qr_code_payment_request: {
    en: "Remember that scanning a QR code is only used to SEND money, never to receive scholarship or salary disbursements.",
    hi: "याद रखें कि क्यूआर कोड स्कैन करने का उपयोग केवल पैसे भेजने के लिए होता है, छात्रवृत्ति या वेतन प्राप्त करने के लिए नहीं।", // needs native review
    url: null,
  },
  lookalike_domain: {
    en: "Verify the spelling of the domain character-by-character against the verified official organisation website.",
    hi: "डोमेन की वर्तनी की आधिकारिक संगठन की वेबसाइट से अक्षर-दर-अक्षर तुलना करें।", // needs native review
    url: null,
  },
  non_gov_domain_claiming_gov: {
    en: "Verify that official government schemes use genuine '.gov.in' or '.nic.in' domains. Commercial extensions like '.com' or '.org' are not official government portals.",
    hi: "जांचें कि आधिकारिक सरकारी योजनाएं '.gov.in' या '.nic.in' डोमेन का उपयोग करती हैं या नहीं। '.com' या '.org' सरकारी पोर्टल नहीं हैं।", // needs native review
    url: "https://factcheck.pib.gov.in",
  },
  personal_payment_id: {
    en: "Reject payment requests sent to personal UPI handles or private savings accounts for corporate or government schemes.",
    hi: "कॉर्पोरेट या सरकारी योजनाओं के लिए व्यक्तिगत यूपीआई या बचत खातों पर भुगतान करने से बचें।", // needs native review
    url: null,
  },
  official_warning_found: {
    en: "Review published fraud advisories and alerts issued by official regulators or law enforcement regarding this entity.",
    hi: "इस इकाई के संबंध में आधिकारिक नियामकों या पुलिस द्वारा जारी धोखाधड़ी चेतावनियों की समीक्षा करें।", // needs native review
    url: "https://factcheck.pib.gov.in",
  },
  scam_reports_found: {
    en: "Check consumer complaint forums and public discussions regarding identical scam scripts reported by other students.",
    hi: "अन्य छात्रों द्वारा रिपोर्ट की गई समान शिकायतों और सार्वजनिक मंचों की समीक्षा करें।", // needs native review
    url: null,
  },
  graph_match: {
    en: "Exercise extreme caution: one or more payment identifiers or domains provided in this offer match previously reported scam cases.",
    hi: "अत्यधिक सावधानी बरतें: इस प्रस्ताव में दिए गए पहचानकर्ता पहले रिपोर्ट किए गए घोटालों से मेल खाते हैं।", // needs native review
    url: null,
  },
  domain_company_mismatch: {
    en: "Verify job applications directly on the company's verified careers website. Avoid third-party domain lookalikes claiming corporate affiliation.",
    hi: "नौकरी के आवेदनों को सीधे कंपनी की आधिकारिक करियर वेबसाइट पर सत्यापित करें। कॉर्पोरेट संबद्धता का दावा करने वाले तीसरे पक्ष के डोमेन से बचें।",
    url: null,
  },
  no_interview_selection: {
    en: "Inquire about formal interview rounds and request a verifiable corporate offer letter before committing personal time or information.",
    hi: "समय या जानकारी देने से पहले औपचारिक साक्षात्कार और सत्यापन योग्य प्रस्ताव पत्र की मांग करें।", // needs native review
    url: null,
  },
  guaranteed_income: {
    en: "Treat promises of guaranteed high returns or unrealistic part-time earnings with extreme skepticism.",
    hi: "अवास्तविक आय या गारंटीकृत उच्च रिटर्न के वादों पर अत्यधिक संदेह करें।", // needs native review
    url: null,
  },
  free_email_recruiter: {
    en: "Ask the recruiter to email you from their official corporate domain address rather than generic free webmail accounts.",
    hi: "भर्तीकर्ता से सामान्य वेबमेल के बजाय अपने आधिकारिक कॉर्पोरेट डोमेन पते से ईमेल करने का अनुरोध करें।", // needs native review
    url: null,
  },
  domain_new: {
    en: "Exercise caution when transacting on newly created domains registered within the last few months.",
    hi: "हाल ही में पंजीकृत नए डोमेन पर लेनदेन करते समय अतिरिक्त सतर्कता बरतें।", // needs native review
    url: null,
  },
  raw_ip_opportunity_link: {
    en: "Do not submit applications, personal credentials, or payments on links using raw IP addresses instead of registered corporate domains.",
    hi: "पंजीकृत कॉर्पोरेट डोमेन के बजाय सीधे आईपी पते वाले लिंक पर आवेदन, क्रेडेंशियल या भुगतान जमा न करें।", // needs native review
    url: null,
  },
  not_on_official_portal: {
    en: "Search the official National Scholarship Portal or Ministry website directly to confirm whether this opportunity exists.",
    hi: "पुष्टि करने के लिए राष्ट्रीय छात्रवृत्ति पोर्टल या मंत्रालय की वेबसाइट पर सीधे खोजें।", // needs native review
    url: "https://scholarships.gov.in",
  },
  review_burst: {
    en: "Be wary of clustered, uniform reviews posted within a short timeframe, as they often indicate artificial reputation manipulation.",
    hi: "कम समय में पोस्ट की गई एक जैसी समीक्षाओं से सावधान रहें, क्योंकि यह कृत्रिम समीक्षाएं हो सकती हैं।", // needs native review
    url: null,
  },
  copied_content: {
    en: "Search distinctive text excerpts from the offer in search engines to check if template wording was copied from other sites.",
    hi: "प्रस्ताव के विशिष्ट अंशों को सर्च इंजन में खोजें ताकि यह पता चल सके कि क्या यह किसी अन्य साइट से कॉपी किया गया है।", // needs native review
    url: null,
  },
  classifier_high: {
    en: "Offer language displays high statistical similarity to confirmed fraudulent solicitations. Review all terms closely.",
    hi: "प्रस्ताव की भाषा ज्ञात धोखाधड़ी वाले संदेशों से बहुत मिलती-जुलती है। सभी शर्तों की सावधानीपूर्वक समीक्षा करें।", // needs native review
    url: null,
  },
  urgency_pressure: {
    en: "Do not let artificial deadlines rush your judgment. Legitimate opportunities allow adequate time for applicant verification.",
    hi: "नकली समयसीमा के दबाव में न आएं। वैध अवसर सत्यापन के लिए पर्याप्त समय देते हैं।", // needs native review
    url: null,
  },
  off_platform_contact: {
    en: "Insist on maintaining communications via verified official job portals or official corporate email rather than private messaging apps.",
    hi: "निजी मैसेजिंग ऐप के बजाय आधिकारिक जॉब पोर्टल या कॉर्पोरेट ईमेल के माध्यम से संवाद करने पर जोर दें।", // needs native review
    url: null,
  },
  domain_no_history: {
    en: "Check the domain's historical presence and verifiable track record using independent public archives.",
    hi: "सार्वजनिक अभिलेखागार (आर्काइव) का उपयोग करके डोमेन के ऐतिहासिक ट्रैक रिकॉर्ड की जांच करें।", // needs native review
    url: null,
  },
  ssl_anomaly: {
    en: "Avoid entering sensitive information or payment details on websites with missing, invalid, or mismatched SSL certificates.",
    hi: "अमान्य या गायब एसएसएल प्रमाणपत्र वाली वेबसाइटों पर संवेदनशील जानकारी या भुगतान विवरण दर्ज करने से बचें।", // needs native review
    url: null,
  },
  foreign_or_voip_number: {
    en: "Verify the sender's official Indian headquarters and landline helpline before trusting contact numbers with foreign country codes or virtual VoIP origins.",
    hi: "विदेशी या वर्चुअल नंबरों पर भरोसा करने से पहले संगठन के आधिकारिक भारतीय मुख्यालय और लैंडलाइन की पुष्टि करें।", // needs native review
    url: null,
  },
});

/**
 * Manual "What to verify next" checklist items from docs/flag-proposal.md.
 * These represent manual actions, absence-of-evidence checks, and official registry links
 * rather than automated flags.
 */
export const MANUAL_VERIFICATION_CHECKLIST = Object.freeze({
  exec_dm_outreach: {
    id: "exec_dm_outreach",
    en: "If someone claiming to be a CXO or Director reached out via personal chat, search LinkedIn or the company's official 'Team' page to verify their role, and ask for an email confirmation from their official corporate domain.",
    hi: "यदि किसी व्यक्ति ने व्यक्तिगत चैट पर सीएक्सओ या निदेशक होने का दावा किया है, तो लिंक्डइन या आधिकारिक टीम पेज पर उनकी भूमिका की पुष्टि करें और आधिकारिक कॉर्पोरेट ईमेल से पुष्टि मांगें।",
    url: null,
  },
  no_video_contact: {
    id: "no_video_contact",
    en: "If all interactions have been via chat or audio call, request a video interview via Google Meet/Zoom or an in-person meeting at their physical office before sharing any personal documents.",
    hi: "यदि सभी बातचीत केवल चैट या ऑडियो कॉल पर हुई है, तो कोई भी व्यक्तिगत दस्तावेज साझा करने से पहले वीडियो साक्षात्कार या व्यक्तिगत बैठक का अनुरोध करें।",
    url: null,
  },
  no_past_winners: {
    id: "no_past_winners",
    en: "Search college archives, university circulars, or official social handles for previous years' awardees. Established scholarship schemes maintain public records of past recipients.",
    hi: "पिछले वर्षों के विजेताओं के लिए कॉलेज अभिलेखागार या विश्वविद्यालय के परिपत्रों की जांच करें। स्थापित छात्रवृत्ति योजनाएं पिछले प्राप्तकर्ताओं का सार्वजनिक रिकॉर्ड रखती हैं।",
    url: null,
  },
  no_footprint: {
    id: "no_footprint",
    en: "Check the Ministry of Corporate Affairs (MCA) portal for the company's Corporate Identification Number (CIN) or LLP registration to verify active legal standing.",
    hi: "कंपनी के कॉर्पोरेट पहचान संख्या (CIN) या एलएलपी पंजीकरण और सक्रिय स्थिति की जांच के लिए कॉर्पोरेट मामलों के मंत्रालय (MCA) पोर्टल पर जाएं।",
    url: "https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do",
  },
  stale_site: {
    id: "stale_site",
    en: "Verify that the organization's website provides working landline contact numbers, official grievance contacts, and verifiable physical office addresses.",
    hi: "सत्यापित करें कि संगठन की वेबसाइट कार्यशील लैंडलाइन संपर्क नंबर, आधिकारिक शिकायत संपर्क और सत्यापित करने योग्य कार्यालय पता प्रदान करती है।",
    url: null,
  },
  campus_placement_cell: {
    id: "campus_placement_cell",
    en: "Contact your college or university campus placement cell to confirm if this recruitment drive or internship offer is officially recognized.",
    hi: "यह पुष्टि करने के लिए अपने कॉलेज या विश्वविद्यालय के प्लेसमेंट सेल से संपर्क करें कि क्या यह भर्ती या इंटर्नशिप आधिकारिक रूप से मान्यता प्राप्त है।",
    url: null,
  },
  mca_portal: {
    id: "mca_portal",
    en: "Verify company registration and director records on the official Ministry of Corporate Affairs portal.",
    hi: "कॉर्पोरेट मामलों के मंत्रालय (MCA) के आधिकारिक पोर्टल पर कंपनी पंजीकरण और निदेशक रिकॉर्ड की पुष्टि करें।",
    url: "https://www.mca.gov.in/mcafoportal/viewCompanyMasterData.do",
  },
  reddit_search: {
    id: "reddit_search",
    en: "Search public student discussion communities and Reddit for reports about this company or opportunity.",
    hi: "इस कंपनी या अवसर के बारे में रिपोर्ट के लिए सार्वजनिक छात्र मंचों और रेडिट (Reddit) पर खोजें।",
    url: "https://www.reddit.com/search",
  },
});
