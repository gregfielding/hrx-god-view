# Addendum 2: Category Scoring Math + Event Model

## Objective
Define how scores are calculated, updated, and controlled.

---

## 1. Score Structure

Each category:
- score: 0–100
- confidence: 0–100

---

## 2. Initial Interview Weight

Interview contributes:
- 40–60% of initial score
- confidence starts low (20–40)

---

## 3. Event-Based Updates

Each event applies a delta:

Example:
background_check_completed:
- reliability +3
- jobReadiness +5
- stability +2

shift_no_show:
- reliability -15
- punctuality -20
- stability -10

first_shift_completed:
- reliability +5
- stability +5

---

## 4. Boundaries

- Scores capped 0–100
- No single event > ±20 impact
- diminishing returns for repeated positives

---

## 5. Confidence Model

Confidence increases when:
- more interviews
- more shifts completed
- consistent behavior

Confidence decreases when:
- conflicting signals
- long inactivity

---

## 6. Decay

Optional later:
- scores slowly decay if inactive (e.g. -1 per 30 days)

---

## 7. Event Processing Rules

- every event must have eventKey (idempotent)
- process once only
- do not re-trigger from score writes

---

## 8. Composite Use

Hiring decisions can use:
- weighted categories (job-specific)
- thresholds (e.g. reliability > 70)

---

## 9. Guiding Principle

Interview = estimate  
Behavior = truth
