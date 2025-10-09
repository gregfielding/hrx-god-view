# HRX / C1 Staffing — Sign Up & Login Modal UX & Content Specification

**Goal:** Make the sign-up and login experience friendlier, faster, and aligned with major job platforms (Indeed, LinkedIn, Workday).  
The design must feel credible, approachable, and efficient while keeping backend logic simple.

---

## 🧭 Design Objectives

1. **First impression:** Feel trustworthy, professional, and welcoming.  
2. **Efficiency:** Minimize friction — fewer fields, clear instructions.  
3. **Clarity:** Consistent tone and visual hierarchy.  
4. **Flexibility:** All fields and subtext optional and conditionally rendered.

---

## 🔹 Updated Button Text

**Before:** `Sign Up / Login`  
**After (options):**
- ✅ **Sign In or Create Account** — clear and professional.  
- ✅ **Get Started** — modern and simple (ideal for mobile).

---

## 🔹 Sign In Modal

### Header & Subheader
```
Welcome Back
Sign in to apply for jobs, save listings, and track your applications.
```

### Fields
| Field | Label | Notes |
|--------|--------|-------|
| Email | Email | Auto-focus this field |
| Password | Password | Add “Show/Hide” toggle |
| Forgot Password | Link | Place below password, not disabled |

### Buttons
- **Primary:** `Sign In`
- **Secondary:** `Cancel`

### Footer microcopy
```
Don’t have an account yet? Create one here.
```

---

## 🔹 Sign Up Modal

### Header & Subheader
```
Create Your Account
Start applying in seconds. Save jobs and track your progress.
```

### Fields
| Field | Label | Notes |
|--------|--------|-------|
| First Name | First Name |  |
| Last Name | Last Name |  |
| Email | Email |  |
| Password | Password | Helper text: “At least 8 characters, including uppercase, lowercase, and a number.” |
| Confirm Password | Confirm Password | Must match password |

### Buttons
- **Primary:** `Create Account`
- **Secondary:** `Cancel`

### Footer microcopy
```
Already have an account? Sign in.
```

---

## 🎨 Visual & Layout Guidelines

| Element | Recommendation |
|----------|----------------|
| **Modal width** | 480–520px max |
| **Border radius** | 12–16px (consistent with brand) |
| **Tabs (“Sign Up” / “Sign In”)** | Use bold active label with thicker underline (brand color) |
| **Field spacing** | 20px between groups; 12px within group |
| **Icons** | Lighten (60–70% opacity); left-aligned inside fields |
| **Field focus** | Highlight border with brand color (`border-primary/70`) |
| **Forgot Password** | Style as subtle text link under password field |
| **Primary buttons** | Bold color, slight hover elevation or shade |
| **Animation** | Soft fade-in or slide-up when opening modal |
| **Responsive behavior** | Center modal on desktop; full-screen drawer on mobile |

---

## 🧠 Micro UX Enhancements

1. **Password visibility toggle** (eye icon).  
2. **Enter key submission** support.  
3. **Form validation messages**:  
   - “Please enter a valid email.”  
   - “Passwords must match.”  
4. **Auto-focus** on first input.  
5. **Success transition:**  
   “✅ Account created! Redirecting you to available jobs…”  
   (2–3 second delay).

---

## 🧩 Accessibility & Behavior

- Trap focus inside modal.  
- Support `Esc` to close.  
- Use `aria-labelledby` and `aria-describedby`.  
- Maintain `Tab` key order.  
- Ensure all color contrasts meet **WCAG AA**.  
- Use motion that respects “prefers-reduced-motion.”

---

## 🧱 Example Layout (React + Tailwind + shadcn/ui)

### Tabs + Header

```tsx
<Tabs defaultValue="signin" className="w-full">
  <TabsList className="flex border-b bg-transparent mb-4">
    <TabsTrigger value="signup" className="flex-1 text-base font-semibold data-[state=active]:border-b-2 data-[state=active]:border-primary">
      Create Account
    </TabsTrigger>
    <TabsTrigger value="signin" className="flex-1 text-base font-semibold data-[state=active]:border-b-2 data-[state=active]:border-primary">
      Sign In
    </TabsTrigger>
  </TabsList>

  <TabsContent value="signin">
    <p className="text-sm text-muted-foreground mb-4">
      Sign in to apply for jobs, save listings, and track your applications.
    </p>
    {/* Sign In form */}
  </TabsContent>

  <TabsContent value="signup">
    <p className="text-sm text-muted-foreground mb-4">
      Create your free account to start applying in seconds.
    </p>
    {/* Sign Up form */}
  </TabsContent>
</Tabs>
```

### Buttons

```tsx
<div className="flex justify-end gap-3 mt-6">
  <Button variant="outline">Cancel</Button>
  <Button>Sign In</Button>
</div>
```

### Footer Copy

```tsx
<p className="text-sm text-center text-muted-foreground mt-3">
  Don’t have an account yet?{" "}
  <button className="text-primary hover:underline" onClick={() => setTab("signup")}>
    Create one here
  </button>
</p>
```

---

## 🔐 Optional Additions (Future Enhancements)

| Feature | Description |
|----------|-------------|
| **Social Sign-In** | “Continue with Google” / “Continue with LinkedIn” buttons |
| **Progressive onboarding** | Start with name + email, then collect extras later |
| **Security copy** | Below password field: “We’ll never share your information.” |
| **Trust cue** | “Trusted by employers across Texas, Nevada, and Arizona.” |

---

## 🧩 Example Copy (Final Preview)

**Sign In**
```
Welcome Back
Sign in to apply for jobs, save listings, and track your applications.

Email: [__________]
Password: [__________]  Forgot your password?

[Cancel]  [Sign In]

Don’t have an account? Create one here.
```

**Sign Up**
```
Create Your Account
Start applying in seconds. Save jobs and track your progress.

First Name: [__________]  Last Name: [__________]
Email: [__________]
Password: [__________]
At least 8 characters, including uppercase, lowercase, and number.
Confirm Password: [__________]

[Cancel]  [Create Account]

Already have an account? Sign in.
```

---

## ✅ Acceptance Checklist

- [ ] Modal open/close transitions smooth.  
- [ ] Focus trapped inside modal.  
- [ ] Keyboard and screen reader friendly.  
- [ ] Text content matches updated tone and copy.  
- [ ] Tabs styled with active underline and hover states.  
- [ ] Buttons follow brand accent color and hover elevation.  
- [ ] Mobile drawer variant uses same structure.  
- [ ] Optional sections (like Forgot Password, Confirm Password) hidden when disabled.

---

**End of File — AuthModals-UX-Content-Spec.md**
