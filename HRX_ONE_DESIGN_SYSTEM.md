# HRX One Enterprise Design System

## Overview

This document outlines the implementation of the HRX One Enterprise Design System, which provides a consistent, professional visual language across the admin web dashboard and mobile Companion app.

## 🎨 Color Palette

### Core Theme Colors
- **Background**: `#000000` - Pure black for maximum contrast
- **Surface**: `#111111` - Dark gray for cards and containers
- **Surface Light**: `#1C1C1E` - Lighter gray for elevated surfaces
- **Text Primary**: `#FFFFFF` - Pure white for main text
- **Text Secondary**: `#AAAAAA` - Muted gray for secondary text
- **Border**: `#2C2C2C` - Subtle borders and dividers

### HRX Blue Palette
- **Primary Blue**: `#4A90E2` - Main brand color
- **Blue Dark**: `#3273C6` - Button hover states
- **Blue Darker**: `#235DA9` - Active/pressed states
- **Blue Light**: `#6AA9F0` - Background highlights
- **Blue Lighter**: `#9BCBFF` - Soft backgrounds

### Module Accent Colors
- **Scheduler**: `#F4B400` - Gold for scheduling features
- **Talent**: `#2ECC71` - Emerald for talent management
- **Intelligence**: `#6C5CE7` - Deep purple for AI features

### Message Tone Colors
- **Positive**: `#2ECC71` - Success and uplifting messages
- **Informational**: `#4A90E2` - General information
- **Concern**: `#F39C12` - Warnings and concerns
- **Warning**: `#E74C3C` - Critical alerts

## 🔤 Typography

### Font Stack
```css
font-family: 'Helvetica', 'Inter', system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', 'Roboto', sans-serif;
```

### Font Weights
- **Headings**: 600-700 (semi-bold to bold)
- **Body Text**: 400 (regular)
- **UI Labels**: 500-600 (medium to semi-bold)
- **Buttons**: 600 (semi-bold)

### Text Sizes
| Type | MUI Variant | Size | Use Case |
|------|-------------|------|----------|
| Page Title | h1 | 2.5rem | Main page headers |
| Section Head | h2 | 2rem | Section titles |
| Subsection | h3 | 1.75rem | Subsection headers |
| Card Title | h4 | 1.5rem | Card and modal titles |
| List Header | h5 | 1.25rem | List and table headers |
| Small Header | h6 | 1.125rem | Small section headers |
| Body Text | body1 | 1rem | Main content |
| Secondary Text | body2 | 0.875rem | Supporting content |
| Caption | caption | 0.75rem | Metadata and labels |

## 📦 Component Specifications

### Buttons
- **Border Radius**: 8px
- **Text Transform**: None (sentence case)
- **Font Weight**: 600
- **Padding**: 8px 16px
- **Min Height**: 40px
- **Hover Effects**: Color transitions, no shadows

### Cards & Containers
- **Border Radius**: 16px
- **Box Shadow**: None (use solid borders)
- **Border**: 1px solid `#2C2C2C`
- **Background**: `#111111`
- **Padding**: 24px standard

### Avatars & Logos
- **Shape**: Square with 6px border radius
- **Sizes**: 24px, 32px, 48px, 64px
- **Default**: Grayscale if no image
- **HRX Logo**: Uses new `hrxone_logo.png` and `hrxone_logo_square.png`

### Tables
- **Outer Borders**: Removed
- **Row Backgrounds**: Alternating or hover highlights
- **Header Text**: Semi-bold, no uppercase
- **Border Radius**: 12px for containers

### Inputs & Forms
- **Full Width**: Yes
- **Border Radius**: 12px
- **Label Position**: Above input
- **Background**: `#1C1C1E`
- **Focus State**: Blue border

## 🌗 Dark Mode Implementation

### Default State
- All views default to dark mode
- High contrast white text on black backgrounds
- Accent colors adapt automatically
- Uses MUI dark theme with custom overrides

### Theme Provider Setup
```tsx
const theme = createTheme({
  palette: {
    mode: 'dark',
    background: {
      default: '#000000',
      paper: '#111111',
    },
    // ... other palette settings
  },
  // ... component overrides
});
```

## 🧠 Companion AI Design

### Prompt Field
- **Position**: Always visible at top (web) or center (mobile)
- **Style**: Large text box, no shadow, rounded-xl
- **Label**: "Companion:" or "AI:" in muted gray
- **Focus**: Subtle pulse or glow effect

## ✨ Brand Elements

### HRX One Logo
- **Usage**: `hrxone_logo.png` for horizontal layouts
- **Square Version**: `hrxone_logo_square.png` for avatars and icons
- **Dynamic X**: Color changes to match current module or tone
- **Hover Effects**: Subtle pulse or micro-glow
- **CSS Class**: `.hrx-logo` for animations

### Logo Implementation
```tsx
<img
  src="/hrxone_logo.png"
  alt="HRX One"
  className="hrx-logo"
  style={{ height: 40, width: 'auto', objectFit: 'contain' }}
/>
```

## 🎯 Implementation Status

### ✅ Completed
- [x] MUI theme overrides in `src/theme/theme.tsx`
- [x] Global design tokens for colors, typography, and spacing
- [x] Button, card, avatar, and input component updates
- [x] Dark mode default across all pages
- [x] Square avatars with rounded corners (6px)
- [x] New HRX One logo integration
- [x] Global CSS with Inter font loading
- [x] Scrollbar styling
- [x] Focus and hover states
- [x] Utility classes for common patterns

### 🔄 In Progress
- [ ] Module-specific accent color context
- [ ] Styled-components for scoped styles
- [ ] Component library documentation

### 📋 Next Steps
- [ ] Update remaining components to match design system
- [ ] Create component storybook for design tokens
- [ ] Implement module-specific theming
- [ ] Add animation guidelines
- [ ] Create design system documentation site

## 🛠 Usage Guidelines

### Importing Colors
```tsx
import { hrxColors } from '../theme/theme';

// Use in components
const MyComponent = () => (
  <Box sx={{ backgroundColor: hrxColors.surface }}>
    <Typography sx={{ color: hrxColors.hrxBlue }}>
      HRX One Content
    </Typography>
  </Box>
);
```

### Applying Module Colors
```tsx
// CSS classes for module-specific styling
<div className="module-scheduler">
  <Button sx={{ backgroundColor: 'var(--accent-color)' }}>
    Schedule Task
  </Button>
</div>
```

### Tone Colors
```tsx
// Use tone-specific classes for message styling
<Typography className="tone-positive">
  Success message
</Typography>
<Typography className="tone-warning">
  Warning message
</Typography>
```

## 📱 Responsive Design

### Breakpoints
- **Mobile**: < 768px
- **Tablet**: 768px - 1024px
- **Desktop**: > 1024px

### Mobile Considerations
- Reduced padding (16px instead of 24px)
- Larger touch targets (44px minimum)
- Simplified navigation
- Optimized typography scaling

## ♿ Accessibility

### Color Contrast
- All text meets WCAG AA standards
- High contrast ratios maintained
- Color not used as sole indicator

### Focus Management
- Visible focus indicators
- Logical tab order
- Keyboard navigation support

### Screen Reader Support
- Semantic HTML structure
- Proper ARIA labels
- Alt text for images

## 🎨 Animation Guidelines

### Micro-interactions
- **Duration**: 200ms for hover states
- **Easing**: ease-in-out
- **Scale**: 1.05 for logo hover
- **Opacity**: 0.7 to 1.0 for state changes

### Transitions
```css
.hrx-logo {
  transition: all 0.2s ease-in-out;
}

.hrx-logo:hover {
  filter: brightness(1.1);
  transform: scale(1.05);
}
```

## 📚 Resources

### Files Modified
- `src/theme/theme.tsx` - Main theme configuration
- `src/index.css` - Global styles and utilities
- `src/components/Layout.tsx` - Logo integration
- `src/components/TenantSwitcher.tsx` - Logo usage

### Logo Assets
- `public/hrxone_logo.png` - Horizontal logo
- `public/hrxone_logo_square.png` - Square logo for avatars

### Design Tokens
- Colors: Defined in `hrxColors` object
- Typography: MUI theme overrides
- Spacing: 8px base unit system
- Border Radius: 6px, 8px, 12px, 16px

## 🔄 Maintenance

### Adding New Colors
1. Add to `hrxColors` object in theme file
2. Update documentation
3. Create CSS custom properties if needed

### Component Updates
1. Follow existing override patterns
2. Test in both light and dark modes
3. Ensure accessibility compliance
4. Update documentation

### Logo Updates
1. Replace assets in `public/` folder
2. Update alt text and descriptions
3. Test across different sizes and contexts
4. Verify hover animations still work

---

*This design system ensures consistency, accessibility, and professional appearance across all HRX One platform interfaces.* 