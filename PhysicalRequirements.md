# HRX / C1 Physical Requirements Specification

## 📘 Overview
This file defines standardized dropdown options for **Physical Requirements** to align with industry standards used by Indeed, Monster, ADP, and the U.S. Department of Labor (O*NET).  
Use this as the single source of truth for job postings, compliance, and AI matching.

---

## 🏷️ UI Label
**Physical Requirements**

**Input Type:** Multi-select (chip-based UI)

**Firestore Field:** `physical_requirements: string[]`

---

## 🧱 Type Definition (TS)
```typescript
export type PhysicalRequirement =
  | 'standing_long'
  | 'walking'
  | 'sitting_long'
  | 'climbing'
  | 'bending'
  | 'reaching_overhead'
  | 'kneeling'
  | 'balancing'
  | 'lifting_10'
  | 'lifting_25'
  | 'lifting_50'
  | 'lifting_75'
  | 'carrying'
  | 'repetitive_motion'
  | 'fine_motor'
  | 'grasping'
  | 'hand_tools'
  | 'visual_acuity'
  | 'hearing'
  | 'noise'
  | 'temperature_extremes'
  | 'airborne_exposure'
  | 'ppe_required';
```

---

## 🧩 Dropdown Options (Full Industry-Standard List)

### 🦵 Core Movement & Posture
| Label | Value | Description |
|--------|--------|--------------|
| Standing for Long Periods | `standing_long` | Requires standing for majority of shift |
| Walking / Moving Around | `walking` | Frequent walking between work areas |
| Sitting for Long Periods | `sitting_long` | Primarily seated role (admin, driver, call center) |
| Climbing (Ladders / Stairs) | `climbing` | Requires safe climbing ability |
| Stooping / Bending | `bending` | Regular bending or crouching |
| Reaching Overhead | `reaching_overhead` | Frequent reaching or lifting above shoulders |
| Kneeling / Crouching | `kneeling` | Tasks performed on or near the ground |
| Balancing | `balancing` | Ability to maintain stability while moving or lifting |

---

### 🏋️ Lifting & Carrying
| Label | Value | Description |
|--------|--------|--------------|
| Lifting up to 10 lbs | `lifting_10` | Light lifting (office supplies, documents) |
| Lifting up to 25 lbs | `lifting_25` | Moderate lifting (small boxes, tools) |
| Lifting up to 50 lbs | `lifting_50` | Regular warehouse or industrial lifting |
| Lifting 75+ lbs | `lifting_75` | Heavy labor or team-assisted lifts |
| Carrying Objects | `carrying` | Transporting materials manually |

---

### 🔁 Repetitive or Manual Tasks
| Label | Value | Description |
|--------|--------|--------------|
| Repetitive Motions | `repetitive_motion` | Constant hand or arm movements |
| Fine Motor Skills / Dexterity | `fine_motor` | Precision tasks like typing, wiring, or assembly |
| Grasping / Handling | `grasping` | Frequent use of hands for tools or equipment |
| Using Hand Tools | `hand_tools` | Manual equipment operation |

---

### 👁️ Sensory & Environmental
| Label | Value | Description |
|--------|--------|--------------|
| Visual Acuity Required | `visual_acuity` | Reading labels, screens, or small print |
| Hearing Ability Required | `hearing` | Listening for alarms, machinery, or verbal cues |
| Exposure to Noise | `noise` | Moderate to loud environment |
| Exposure to Heat / Cold | `temperature_extremes` | Work outdoors or in warehouses |
| Exposure to Dust / Fumes | `airborne_exposure` | Common in manufacturing or construction |
| Wearing PPE (Personal Protective Equipment) | `ppe_required` | Safety equipment required (gloves, boots, mask) |

---

## 🧮 Frequency Options (Optional Secondary Field)
These can be added as an optional selector for each physical requirement:

- Occasionally (up to 1/3 of time)
- Frequently (1/3–2/3 of time)
- Constantly (2/3+ of time)

Based on **O*NET frequency classifications** for physical activity demands.

---

## 🎨 Example Dropdown Array (Simplified)
```typescript
export const physicalRequirements = [
  { value: 'standing_long', label: 'Standing for Long Periods' },
  { value: 'walking', label: 'Walking / Moving Around' },
  { value: 'sitting_long', label: 'Sitting for Long Periods' },
  { value: 'climbing', label: 'Climbing (Ladders / Stairs)' },
  { value: 'bending', label: 'Stooping / Bending' },
  { value: 'reaching_overhead', label: 'Reaching Overhead' },
  { value: 'kneeling', label: 'Kneeling / Crouching' },
  { value: 'balancing', label: 'Balancing' },
  { value: 'lifting_10', label: 'Lifting up to 10 lbs' },
  { value: 'lifting_25', label: 'Lifting up to 25 lbs' },
  { value: 'lifting_50', label: 'Lifting up to 50 lbs' },
  { value: 'lifting_75', label: 'Lifting 75+ lbs' },
  { value: 'carrying', label: 'Carrying Objects' },
  { value: 'repetitive_motion', label: 'Repetitive Motions' },
  { value: 'fine_motor', label: 'Fine Motor Skills / Dexterity' },
  { value: 'grasping', label: 'Grasping / Handling' },
  { value: 'hand_tools', label: 'Using Hand Tools' },
  { value: 'visual_acuity', label: 'Visual Acuity Required' },
  { value: 'hearing', label: 'Hearing Ability Required' },
  { value: 'noise', label: 'Exposure to Noise' },
  { value: 'temperature_extremes', label: 'Exposure to Heat / Cold' },
  { value: 'airborne_exposure', label: 'Exposure to Dust / Fumes' },
  { value: 'ppe_required', label: 'Wearing PPE (Personal Protective Equipment)' },
];
```

---

## 🧠 Integration Notes (for HRX / C1)
- Store selected values in an array for each job record.
- Display selections as chips in UI.
- Use for compliance, worker matching, and client safety transparency.
- In AI job-matching, weight physical requirements against worker capability data.

---

## ✅ QA Checklist
- [ ] All 22 options appear in dropdown.  
- [ ] Multi-select enabled with chip display.  
- [ ] Stored as `string[]` in Firestore.  
- [ ] Sorted in logical order by category.  
- [ ] Tooltips or descriptions accessible on hover (optional).  

---

**End of File**
