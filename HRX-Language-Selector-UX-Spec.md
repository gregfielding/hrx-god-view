
# HRX Language Selector UX Improvement Spec
### Worker Portal + Jobs Board (Web + Flutter)

---

# Objective

Ensure Spanish-dominant workers clearly understand how to switch languages and confidently use the platform.

This spec improves the clarity, visibility, and usability of the language selector for light industrial and Spanish-first users.

---

# Current State

Current UI:
- 🌐 Globe icon
- Dropdown
- Options:
  - English
  - Español

### What Works
- “Español” is written correctly in Spanish (good)
- Globe icon is internationally recognized
- Clean minimal interface

### Where It Can Improve
- No visible label (unclear what the globe means)
- No active language indicator
- No onboarding prompt for first-time users
- May not be obvious to English-limited workers

---

# Recommended Improvements

## 1️⃣ Add Visible Label (High Impact, Low Effort)

### Option A (Preferred)

Add a small label next to the globe:

When English active:
🌐 Language

When Spanish active:
🌐 Idioma

This removes ambiguity entirely.

---

## 2️⃣ Show Active Language Indicator

Instead of only showing a globe icon, display:

When English active:
🌐 EN

When Spanish active:
🌐 ES

This:
- Signals current state clearly
- Reduces confusion
- Improves perceived polish

---

## 3️⃣ First Login Language Selection Modal (Best UX)

If `users/{userId}.preferredLanguage` is not set:

Display modal:

------------------------------------
Select Your Language
Seleccione su idioma

[ English ]     [ Español ]
------------------------------------

On selection:
- Save preferredLanguage in Firestore
- Close modal
- Persist selection for all future sessions

This is strongly recommended for worker portal.

---

## 4️⃣ Auto-Detect Browser Language (Optional but Smart)

If browser language is Spanish (`navigator.language` starts with "es"):

Show banner:

"We noticed your browser is set to Spanish.
¿Desea ver esta aplicación en Español?"

[ Yes, switch to Español ]   [ Keep English ]

Do not auto-switch without confirmation.

---

## 5️⃣ Improve Dropdown Clarity

Instead of:

English
Español

Use:

English (EN)
Español (ES)

OR bold the active selection.

---

# Worker-Specific Recommendation

For light industrial workforce environments (NV, TX, AZ, CA):

Strongly recommended combination:

✔ First-login language modal  
✔ Active language badge (EN/ES)  
✔ Label (Language / Idioma)  

This maximizes clarity for Spanish-dominant users.

---

# Flutter Implementation Notes

Flutter should:

- Use same `preferredLanguage` from Firestore
- Apply display rule:

field_i18n[preferredLanguage]
  ?? field_i18n.en
  ?? legacyField

- Mirror the same selector behavior as web
- Ensure modal displays full-width on first login

---

# Technical Checklist

1. Add label component next to globe
2. Add EN/ES active badge state
3. Add first-login modal logic
4. Persist users/{userId}.preferredLanguage
5. Optional: browser language detection banner
6. QA test with Spanish-first user simulation

---

# Final Recommendation

Is current selector functional? Yes.

Is it optimal for Spanish-first blue-collar workforce? Not yet.

Implementing the above changes will:

- Reduce confusion
- Increase Spanish engagement
- Improve retention signals
- Strengthen HRX positioning in bilingual markets

---

END OF SPEC
