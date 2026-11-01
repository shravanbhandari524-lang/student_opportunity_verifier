"""services/classifier/normalize.py

Text normalization for Opportunity Verifier Classifier.
Standardizes entity surfaces (URLs, bare domains, emails, UPI IDs, phone numbers,
currency amounts, masked account/OTP strings, and standalone 3+ digit numbers)
into canonical placeholder tokens (<URL>, <EMAIL>, <UPI>, <PHONE>, <AMT>, <NUM>)
to prevent model overfitting and shortcut learning on specific synthetic handles,
currency tokens (e.g. rs, inr), or numerical artifacts (e.g. 000).
Applied identically during training and inference.
"""

import re

FULL_URL_REGEX = re.compile(
    r"https?://[^\s]+|www\.[^\s]+",
    re.IGNORECASE
)

EMAIL_REGEX = re.compile(
    r"\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b",
    re.IGNORECASE
)

UPI_REGEX = re.compile(
    r"\b[a-zA-Z0-9.\-_]{2,256}@[a-zA-Z0-9_-]{2,64}\b",
    re.IGNORECASE
)

DOMAIN_REGEX = re.compile(
    r"\b(?:[a-zA-Z0-9-]+\.)+(?:gov\.in|nic\.in|ac\.in|edu\.in|edu|org|com|net|in|io|test|example|invalid)\b(?:/[^\s]*)?",
    re.IGNORECASE
)

PHONE_REGEX = re.compile(
    r"(?:\+91[\-\s]?)?[6-9]\d{4}[\-\s]?\d{5}\b|\b0[6-9]\d{4}[\-\s]?\d{5}\b|\b[6-9]\d{9}\b"
)

CURRENCY_REGEX = re.compile(
    r"(?i)(?:(?:\b(?:Rs\.?|INR)|₹)\s*\d+(?:,\d+)*(?:\.\d+)?(?:\s*/-)?|\b\d+(?:,\d+)*(?:\.\d+)?\s*(?:\b(?:Rs\.?|INR)|₹)\b)"
)

MASKED_PATTERN_REGEX = re.compile(
    r"\b(?=[0-9xX\-]*[xX])[0-9xX\-]{3,}\b"
)

STANDALONE_NUM_REGEX = re.compile(
    r"\b\d{1,3}(?:,\d{3})+(?:\.\d+)?\b|\b\d{3,}(?:\.\d+)?\b"
)

MAX_TEXT_CHARS = 5000


def normalize_text(text: str, max_chars: int = MAX_TEXT_CHARS) -> str:
    """Normalize raw text by masking URLs, emails, UPI IDs, domains, phones, currency amounts, and numbers.
    
    Caps input and output length to max_chars (default 5000) for uniform, safe evaluation across training and serving.
    
    Order of operations:
    1. Truncate raw input if exceeding max_chars.
    2. Full URLs with http(s):// or www. -> <URL>
    3. Email addresses with recognized domain suffix -> <EMAIL>
    4. UPI payment handles (user@bank) -> <UPI>
    5. Standalone domain names without scheme -> <URL>
    6. Phone numbers (Indian 10-digit mobile and landline patterns) -> <PHONE>
    7. Currency amounts (Rs, Rs., INR, ₹, followed or preceded by digits/commas/decimals) -> <AMT>
    8. Masked account / OTP patterns (e.g., XXXXXX1234, 9XXXXX, 1800-XXX-XXXX, XX1234) -> <NUM>
    9. Remaining standalone numbers of 3 or more digits (e.g., 50,000, 2026, 123) -> <NUM>
    10. Whitespace collapse, trim, and cap output at max_chars.
    """
    if not text:
        return ""

    if max_chars and len(text) > max_chars:
        text = text[:max_chars]

    # 1. Full URLs
    t = FULL_URL_REGEX.sub("<URL>", text)
    # 2. Email addresses
    t = EMAIL_REGEX.sub("<EMAIL>", t)
    # 3. UPI IDs
    t = UPI_REGEX.sub("<UPI>", t)
    # 4. Bare domains
    t = DOMAIN_REGEX.sub("<URL>", t)
    # 5. Phone numbers
    t = PHONE_REGEX.sub("<PHONE>", t)
    # 6. Currency amounts
    t = CURRENCY_REGEX.sub("<AMT>", t)
    # 7. Masked OTP / account patterns
    t = MASKED_PATTERN_REGEX.sub("<NUM>", t)
    # 8. Standalone numbers of 3 or more digits
    t = STANDALONE_NUM_REGEX.sub("<NUM>", t)
    # 9. Normalize whitespace
    t = re.sub(r"\s+", " ", t).strip()
    if max_chars and len(t) > max_chars:
        t = t[:max_chars].rstrip()
    return t
