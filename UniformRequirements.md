# HRX / C1 Uniform & PPE Requirements Specification

## 📘 Overview
This document defines standardized dropdown options for **Uniform & PPE (Personal Protective Equipment) Requirements**, aligned with OSHA, Indeed, and major staffing industry standards.  
These options include both general PPE requirements and detailed **Food & Beverage / Hospitality attire standards** for use across industrial, event, healthcare, and hospitality roles.

---

## 🏷️ UI Label
**Uniform & PPE Requirements**

**Input Type:** Multi-select (chip-based UI)

**Firestore Field:** `uniform_requirements: string[]`

---

## 🧱 Type Definition (TS)
```typescript
export type UniformRequirement =
  | 'casual_attire'
  | 'business_casual'
  | 'uniform_provided'
  | 'uniform_required'
  | 'company_shirt'
  | 'id_badge'
  | 'steel_toe_boots'
  | 'non_slip_shoes'
  | 'hard_hat'
  | 'safety_vest'
  | 'safety_glasses'
  | 'gloves'
  | 'face_mask'
  | 'hearing_protection'
  | 'hi_vis_clothing'
  | 'scrubs'
  | 'lab_coat'
  | 'chef_coat'
  | 'hair_net'
  | 'clean_shaven'
  | 'tool_belt'
  | 'rain_gear'
  | 'black_button_down'
  | 'white_button_down'
  | 'black_bistro_apron'
  | 'black_slacks'
  | 'black_pants'
  | 'black_shirt_no_logos';
```

---

## 🧩 Dropdown Options (Expanded Industry Set)

### 👕 General Dress Code
| Label | Value | Description |
|--------|--------|--------------|
| Casual Attire | `casual_attire` | Everyday clothing suitable for light office or warehouse roles |
| Business Casual | `business_casual` | Slacks, collared shirts, or equivalent attire |
| Uniform Provided by Company | `uniform_provided` | Company supplies full or partial uniform |
| Uniform Required (Not Provided) | `uniform_required` | Worker must provide or purchase required uniform |
| Company Shirt Required | `company_shirt` | Worker must wear company-branded shirt |
| ID Badge Required | `id_badge` | Must display photo or site-issued identification |

---

### 👢 Footwear Requirements
| Label | Value | Description |
|--------|--------|--------------|
| Steel Toe Boots | `steel_toe_boots` | OSHA-compliant safety boots for industrial sites |
| Non-Slip Shoes | `non_slip_shoes` | Slip-resistant shoes for hospitality or warehouse roles |

---

### 🦺 PPE (Personal Protective Equipment)
| Label | Value | Description |
|--------|--------|--------------|
| Hard Hat | `hard_hat` | Head protection for construction or warehouse environments |
| Safety Vest | `safety_vest` | High-visibility vest for vehicle or warehouse proximity work |
| Safety Glasses | `safety_glasses` | Eye protection from debris or chemical splash |
| Gloves | `gloves` | Protective gloves (cut-resistant, latex, etc.) |
| Face Mask | `face_mask` | Respiratory or hygiene mask as required |
| Hearing Protection | `hearing_protection` | Ear plugs or muffs for high-noise environments |
| Hi-Vis Clothing | `hi_vis_clothing` | High-visibility clothing required for safety zones |

---

### 🍽️ Food & Beverage / Hospitality Attire
| Label | Value | Description |
|--------|--------|--------------|
| Black Button-Down Shirt | `black_button_down` | Long-sleeve or short-sleeve black dress shirt (pressed, no logos) |
| White Button-Down Shirt | `white_button_down` | Long-sleeve or short-sleeve white dress shirt (pressed, no logos) |
| Black Bistro Apron | `black_bistro_apron` | Knee-length or full-length black apron (no logos, clean presentation) |
| Black Slacks | `black_slacks` | Professional black dress slacks (no jeans, leggings, or sweatpants) |
| Black Pants (No Rips or Tears) | `black_pants` | Clean black work pants; no leggings, sweats, or distressed fabric |
| Black Shirt (No Logos) | `black_shirt_no_logos` | Plain black shirt allowed in casual F&B settings (no graphics or brands) |
| Non-Slip Shoes | `non_slip_shoes` | Required for all food service and hospitality work areas |
| Hair Net | `hair_net` | Required for food preparation or cleanroom tasks |
| Clean-Shaven Requirement | `clean_shaven` | For respirator fit or professional grooming standards |

---

### 🧑‍🔬 Role-Specific Uniforms
| Label | Value | Description |
|--------|--------|--------------|
| Scrubs | `scrubs` | Required medical attire for healthcare environments |
| Lab Coat | `lab_coat` | Scientific or lab work attire |
| Chef Coat | `chef_coat` | Culinary uniform requirement |
| Tool Belt / Equipment Harness | `tool_belt` | Required for skilled trades or maintenance roles |
| Rain Gear | `rain_gear` | Required for outdoor or delivery positions |

---

## 🧮 Example Array for React UI
```typescript
export const uniformRequirements = [
  { value: 'casual_attire', label: 'Casual Attire' },
  { value: 'business_casual', label: 'Business Casual' },
  { value: 'uniform_provided', label: 'Uniform Provided by Company' },
  { value: 'uniform_required', label: 'Uniform Required (Not Provided)' },
  { value: 'company_shirt', label: 'Company Shirt Required' },
  { value: 'id_badge', label: 'ID Badge Required' },
  { value: 'steel_toe_boots', label: 'Steel Toe Boots' },
  { value: 'non_slip_shoes', label: 'Non-Slip Shoes' },
  { value: 'hard_hat', label: 'Hard Hat' },
  { value: 'safety_vest', label: 'Safety Vest' },
  { value: 'safety_glasses', label: 'Safety Glasses' },
  { value: 'gloves', label: 'Gloves' },
  { value: 'face_mask', label: 'Face Mask' },
  { value: 'hearing_protection', label: 'Hearing Protection' },
  { value: 'hi_vis_clothing', label: 'Hi-Vis Clothing' },
  { value: 'scrubs', label: 'Scrubs' },
  { value: 'lab_coat', label: 'Lab Coat' },
  { value: 'chef_coat', label: 'Chef Coat' },
  { value: 'hair_net', label: 'Hair Net' },
  { value: 'clean_shaven', label: 'Clean-Shaven Requirement' },
  { value: 'tool_belt', label: 'Tool Belt / Equipment Harness' },
  { value: 'rain_gear', label: 'Rain Gear' },
  { value: 'black_button_down', label: 'Black Button-Down Shirt' },
  { value: 'white_button_down', label: 'White Button-Down Shirt' },
  { value: 'black_bistro_apron', label: 'Black Bistro Apron' },
  { value: 'black_slacks', label: 'Black Slacks' },
  { value: 'black_pants', label: 'Black Pants (No Rips or Tears)' },
  { value: 'black_shirt_no_logos', label: 'Black Shirt (No Logos)' },
];
```

---

## 🧠 Integration Notes
- Store as an **array of strings** in Firestore (`uniform_requirements: string[]`).
- Display as **chips** in multi-select UI.
- Use for OSHA compliance, safety audits, event uniform planning, and AI job matching.
- Preload defaults by **industry type** (e.g., hospitality = black button-down, apron, non-slip shoes).

---

## ✅ QA Checklist
- [ ] All 27 options visible and selectable.  
- [ ] Stored as `string[]` in Firestore.  
- [ ] Multi-select with chip UI enabled.  
- [ ] Sorted in logical order by Dress Code, PPE, and Role-Specific.  
- [ ] Descriptions or tooltips accessible on hover (optional).  

---

**End of File**
