# HRX / C1 Screening Requirements Specification

## 📘 Overview
This document defines standardized dropdown options for **Background Checks**, **Drug Screenings**, and **Additional Screenings** to align with AccuSourceHR offerings and staffing industry best practices (Indeed, Bullhorn, AMN, Allegis, etc.).  
These lists should be implemented as configurable dropdowns or multi-select chips in the HRX and C1 Staffing platforms.

---

## 🧩 FIELD 1 — Background Check Options
**UI Label:** Background Check Type  
**Firestore Field:** `background_check: string`

| Label | Value | Description |
|--------|--------|-------------|
| Basic National Criminal Check | `basic_national` | Nationwide database search for criminal convictions |
| 7-Year County Criminal Check | `county_7_year` | In-depth search of counties where the candidate lived in past 7 years |
| Statewide Criminal Search | `statewide_criminal` | State-level court record search |
| Federal Criminal Search | `federal_criminal` | Checks federal court databases (e.g., white-collar crimes) |
| SSN Trace & Address History | `ssn_trace` | Verifies identity and address history from SSN |
| Sex Offender Registry | `sex_offender` | National sex offender database search |
| Motor Vehicle Record (MVR) | `mvr_check` | Driving record check (for driver or delivery positions) |
| Employment Verification | `employment_verification` | Verifies past employers and job titles |
| Education Verification | `education_verification` | Verifies degrees, schools, and graduation years |
| Professional License Verification | `license_verification` | Confirms valid certifications (e.g., RN, CNA, HVAC) |
| Federal Exclusion Check (OIG / SAM) | `federal_exclusion` | Required for healthcare and government roles |
| International Criminal Search | `international_criminal` | For candidates who lived outside the U.S. |

---

## 🧩 FIELD 2 — Drug Screening Options
**UI Label:** Drug Screening Type  
**Firestore Field:** `drug_screening: string`

| Label | Value | Description |
|--------|--------|-------------|
| 4-Panel (No THC) | `4_panel_no_thc` | Tests for Amphetamines, Cocaine, Opiates, and PCP |
| 4-Panel (With THC) | `4_panel_thc` | Includes THC in the 4-panel test |
| 7-Panel (No THC) | `7_panel_no_thc` | Adds Benzodiazepines, Barbiturates, and Methadone |
| 7-Panel (With THC) | `7_panel_thc` | Common for general employment; includes THC |
| 10-Panel (No THC) | `10_panel_no_thc` | Comprehensive screening for extended substances |
| 10-Panel (With THC) | `10_panel_thc` | Full panel with THC included |
| 12-Panel | `12_panel` | Extended version for healthcare and DOT roles |
| DOT Drug Test | `dot_test` | Federally compliant DOT drug test (49 CFR Part 40) |
| Alcohol Screen (Breath or Saliva) | `alcohol_screen` | Alcohol detection via breathalyzer or saliva |
| Random / Periodic Testing | `random_testing` | Used for ongoing employment compliance |
| Post-Accident / Reasonable Suspicion | `post_accident` | Conducted after workplace incidents |

---

## 🧩 FIELD 3 — Additional Screenings (Healthcare / Credential)
**UI Label:** Additional Screenings  
**Firestore Field:** `additional_screenings: string[]`

| Label | Value | Description |
|--------|--------|-------------|
| TB Skin Test (PPD) | `tb_skin_test` | Standard tuberculosis screening (annual or bi-annual) |
| TB Blood Test (Quantiferon) | `tb_blood_test` | Lab-based TB test (Quantiferon Gold or T-Spot) |
| Chest X-Ray (TB Follow-up) | `tb_chest_xray` | Required for positive TB test follow-up |
| Hepatitis B Titer / Series | `hepatitis_b_titer` | Proof of immunity or vaccination series |
| MMR Titer (Measles, Mumps, Rubella) | `mmr_titer` | Proof of immunity or vaccination |
| Varicella (Chickenpox) Titer | `varicella_titer` | Required for healthcare or child-facing work |
| Tdap (Tetanus, Diphtheria, Pertussis) | `tdap_vaccine` | Proof of updated vaccination |
| COVID-19 Vaccine | `covid_vaccine` | COVID-19 vaccination proof or exemption |
| Influenza (Flu Shot) | `flu_shot` | Annual flu vaccination |
| Physical Exam (Fit for Duty) | `physical_exam` | Medical clearance to perform job duties |
| Lift Test / Functional Assessment | `lift_test` | Tests physical capacity for warehouse roles |
| CPR / BLS Certification | `cpr_bls_cert` | Proof of CPR / Basic Life Support certification |
| ACLS Certification | `acls_cert` | Advanced cardiac life support for RNs and clinicians |
| Fingerprinting (Live Scan) | `fingerprinting` | Background fingerprint scan (state or FBI) |
| Drug Screen Confirmation | `drug_confirmation` | Secondary confirmation test after initial screen |
| Respirator Fit Test | `respirator_fit` | Required for respirator use in clinical or industrial jobs |
| OSHA Safety Certification | `osha_cert` | OSHA 10/30 or equivalent safety credential |
| Bloodborne Pathogens Training | `bloodborne_pathogen` | Required for exposure-prone roles |

---

## ✅ QA Checklist
- [ ] All field options correctly mapped to dropdowns.  
- [ ] `additional_screenings` field supports multi-select.  
- [ ] Values stored as lowercase, underscore-separated strings.  
- [ ] Default selections available in client templates (e.g., healthcare = county_7_year + 10_panel_thc + tb_test).  

---

**End of File**
