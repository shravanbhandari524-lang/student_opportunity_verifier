# Student Opportunity Verifier: Evaluation Report

> [!IMPORTANT]
> **Claim Guard Header:** PLUMBING CHECK ON SYNTHETIC CASES; NOT A MEASUREMENT
> **Notice:** CLAIM GUARD: No public accuracy claim may be asserted unless the evaluation dataset contains at least 50 non-synthetic cases with two independent labels.
> *Status:* **UNQUALIFIED / BENCHMARK ONLY** — Public accuracy claim prohibited: dataset contains only 0 qualifying cases (minimum 50 double-labelled non-synthetic cases with agreeing labels required).

## How to read this report
- **Sample Size (Total):** 3
- **Qualifying Double-Labelled Non-Synthetic Cases:** 0
- **Result:** plumbing check, no measurement (3 of 3 matched their stubs)
- **Claim Guard Status:** PROHIBITED (less than 50 qualifying cases)

## 1. Run Metadata
- **Date:** 2026-10-29T05:48:49.276Z
- **Mode:** `fixtures`
- **Git Commit:** `18cb5125dbd631b4b9a73eb67ddf99bee6333876`
- **Model:** `mock-model`
- **Scoring Config Hash:** `sha256:default-rules-v1`
- **Test Set File:** `data/eval/sample-cases.json`
- **Test Set Hash:** `6f2cb401e52420dfc427fd6496c749ab59fa16ca7af6577be95c983dfba0869a`

## 2. Dataset Composition & Provenance
- **Total Cases:** 14
- **Synthetic Cases:** 14
- **Real Public Cases:** 0
- **Paraphrased Cases:** 0
- **Annotator Disagreements:** 0

## 3. Overall Evaluation Metrics
- **Result:** plumbing check, no measurement (3 of 3 matched their stubs)
- **Correct Classifications:** 3
- **Dangerous Misses (Medium/High -> Low):** 0 (High -> Low: 0)
- **False Alarms (Low -> High):** 0
- **Over-cautious (Low -> Medium):** 0
- **Unhelpful Abstention (High/Med/Low -> Cannot Verify):** 0
- **Missed Abstention (Cannot Verify -> Low/Med/High):** 0
- **Other Misclassifications:** 0
- **Cannot Verify Rate:** 33.3%
- **Runs with could_not_check:** 0.0%

## 4. 4x4 Confusion Matrix (Expected vs Predicted)
| Expected \ Predicted | low | medium | high | cannot_verify |
|---|---|---|---|---|
| **low** | 1 | 0 | 0 | 0 |
| **medium** | 0 | 0 | 0 | 0 |
| **high** | 0 | 0 | 1 | 0 |
| **cannot_verify** | 0 | 0 | 0 | 1 |

## 5. Performance by Scam Type
| Scam Type | Cases | Agreement | Dangerous Misses | False Alarms |
|---|---|---|---|---|
| `scholarship` | 1 | 100.0% | 0 | 0 |
| `unknown` | 1 | 100.0% | 0 | 0 |
| `task_job` | 1 | 100.0% | 0 | 0 |

## 6. Confidence Calibration
| Confidence Level | Count | Agreement |
|---|---|---|
| `low` | 1 | 100.0% |
| `medium` | 0 | 0.0% |
| `high` | 2 | 100.0% |

## 6b. Flag Agreement Rates
> *Note:* Flag agreement rate measures how often the final level matched the label in cases where this flag fired; not the accuracy of the flag.
| Flag ID | Fires Count | Agreement Rate |
|---|---|---|
| `graph_match` | 1 | 100.0% |
| `scholarship_fee_demand` | 1 | 100.0% |
| `personal_payment_id` | 1 | 100.0% |
| `domain_new` | 1 | 100.0% |
| `urgency_pressure` | 1 | 100.0% |
| `classifier_high` | 1 | 100.0% |
| `off_platform_contact` | 1 | 100.0% |

## 7. Operational Latency & Calls
- **Latency Percentiles:** p50: 23ms | p90: 45ms | p95: 48ms | max: 51ms
- **LLM Calls per Case:** mean: 0 | max: 0
- **Search Calls per Case:** mean: 0 | max: 0

## 8. Auxiliary Classifier Status
*Auxiliary classifier metrics file not found.*

## 9. Failure Inspection
Zero failures recorded: all cases matched expected risk levels.