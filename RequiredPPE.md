# HRX / C1 Required PPE Specification

## 📘 Overview
This file defines standardized dropdown options for **Required PPE (Personal Protective Equipment)** to align with OSHA, ANSI, and staffing industry standards (Indeed, Bullhorn, EmployBridge).  
Use this field separately from **Uniform Requirements** for clearer safety tracking, compliance documentation, and AI worker-equipment matching.

---

## 🏷️ UI Label
**Required PPE**

**Input Type:** Multi-select (chip-based UI)

**Firestore Field:** `required_ppe: string[]`

---

## 🧱 Type Definition (TS)
```typescript
export type RequiredPPE =
  | 'hard_hat'
  | 'safety_glasses'
  | 'face_shield'
  | 'gloves_general'
  | 'gloves_cut_resistant'
  | 'gloves_chemical'
  | 'hearing_protection'
  | 'steel_toe_boots'
  | 'non_slip_shoes'
  | 'respirator_mask'
  | 'safety_vest'
  | 'fall_harness'
  | 'protective_clothing'
  | 'face_mask'
  | 'welding_shield'
  | 'lab_coat';
```

---

## 🧩 Dropdown Options (Standard PPE List)

| Label | Value | Description |
|--------|--------|--------------|
| Hard Hat | `hard_hat` | Head protection for construction or warehouse environments |
| Safety Glasses | `safety_glasses` | Eye protection from debris or chemical splash |
| Face Shield | `face_shield` | Full-face coverage for grinding or chemical splash protection |
| Gloves (General Purpose) | `gloves_general` | Basic hand protection for warehouse or handling tasks |
| Cut-Resistant Gloves | `gloves_cut_resistant` | Reinforced gloves for sharp materials or tools |
| Chemical-Resistant Gloves | `gloves_chemical` | Resistant to solvents, acids, or cleaning chemicals |
| Hearing Protection | `hearing_protection` | Ear plugs or muffs in noisy environments |
| Steel Toe Boots | `steel_toe_boots` | OSHA-compliant safety footwear for heavy work |
| Non-Slip Shoes | `non_slip_shoes` | Slip-resistant footwear for food service or healthcare |
| Respirator / Mask | `respirator_mask` | Dust or vapor protection (N95, half-mask, etc.) |
| High-Visibility Vest | `safety_vest` | Hi-vis garment for equipment or vehicle areas |
| Fall Protection Harness | `fall_harness` | Required when working at heights |
| Protective Clothing | `protective_clothing` | Coveralls or chemical suits for exposure protection |
| Face Mask | `face_mask` | Basic face mask for hygiene or healthcare |
| Welding Shield / Goggles | `welding_shield` | Arc flash or heat protection for welding tasks |
| Lab Coat | `lab_coat` | Required protective garment for lab or clinical settings |

---

## 🧮 Example Dropdown Array (React / Firestore)
```typescript
export const requiredPPEOptions = [
  { value: 'hard_hat', label: 'Hard Hat' },
  { value: 'safety_glasses', label: 'Safety Glasses' },
  { value: 'face_shield', label: 'Face Shield' },
  { value: 'gloves_general', label: 'Gloves (General Purpose)' },
  { value: 'gloves_cut_resistant', label: 'Cut-Resistant Gloves' },
  { value: 'gloves_chemical', label: 'Chemical-Resistant Gloves' },
  { value: 'hearing_protection', label: 'Hearing Protection' },
  { value: 'steel_toe_boots', label: 'Steel Toe Boots' },
  { value: 'non_slip_shoes', label: 'Non-Slip Shoes' },
  { value: 'respirator_mask', label: 'Respirator / Mask' },
  { value: 'safety_vest', label: 'High-Visibility Vest' },
  { value: 'fall_harness', label: 'Fall Protection Harness' },
  { value: 'protective_clothing', label: 'Protective Clothing' },
  { value: 'face_mask', label: 'Face Mask' },
  { value: 'welding_shield', label: 'Welding Shield / Goggles' },
  { value: 'lab_coat', label: 'Lab Coat' },
];
```

---

## 🧠 Integration Notes
- Store as a **multi-select array field** (`required_ppe: string[]`).
- UI: Chip-based multi-select grouped by category.
- Include OSHA iconography or tooltips for safety training context.
- Auto-suggest PPE requirements based on **job category** (e.g., “Warehouse Worker” → hard hat, safety glasses, steel toe boots).
- Cross-reference with worker equipment profile for AI matching.

---

## 🧩 Suggested Categories
**Head & Face Protection:** Hard Hat, Safety Glasses, Face Shield, Welding Shield  
**Hearing Protection:** Hearing Protection  
**Hands:** Gloves (General, Cut-Resistant, Chemical)  
**Feet:** Steel Toe Boots, Non-Slip Shoes  
**Respiratory:** Respirator / Mask, Face Mask  
**Body:** Safety Vest, Fall Harness, Protective Clothing, Lab Coat

---

## ✅ QA Checklist
- [ ] All 16 PPE options visible and selectable.  
- [ ] Stored as `string[]` in Firestore.  
- [ ] Multi-select with chip display.  
- [ ] Categories shown with visual grouping or subheaders.  
- [ ] OSHA tooltip integration tested.  

---

**End of File**
