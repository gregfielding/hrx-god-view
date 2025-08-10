# HRX Style Guide & Design System

**Date:** January 2025  
**Status:** Active  
**Version:** 1.0

---

## Design Philosophy

The HRX CRM follows a **clean, professional, and modern** design approach with emphasis on:
- **Consistency** across all components
- **Accessibility** for all users
- **Performance** with optimized styling
- **Scalability** for future features

---

## Color Palette

### Primary Colors
```css
/* Primary Brand Colors */
--primary-main: #235DA9;        /* Main brand blue */
--primary-light: #4A7BC8;       /* Light blue for hover states */
--primary-dark: #1A4A8A;        /* Dark blue for active states */

/* Secondary Colors */
--secondary-main: #FF6B35;      /* Orange for CTAs and highlights */
--secondary-light: #FF8A5C;     /* Light orange */
--secondary-dark: #E55A2B;      /* Dark orange */
```

### Neutral Colors
```css
/* Background Colors */
--background-default: #FFFFFF;
--background-paper: #F8F9FA;
--background-elevated: #FFFFFF;

/* Text Colors */
--text-primary: #1A1A1A;
--text-secondary: #666666;
--text-disabled: #BDBDBD;

/* Border Colors */
--border-light: #E0E0E0;
--border-medium: #CCCCCC;
--border-dark: #999999;
```

### Status Colors
```css
/* Success */
--success-main: #32CD32;
--success-light: #4CAF50;
--success-dark: #2E7D32;

/* Warning */
--warning-main: #FFA500;
--warning-light: #FFB74D;
--warning-dark: #F57C00;

/* Error */
--error-main: #FF0000;
--error-light: #FF5252;
--error-dark: #D32F2F;

/* Info */
--info-main: #87CEEB;
--info-light: #B3E5FC;
--info-dark: #1976D2;
```

---

## Typography

### Font Stack
```css
font-family: 'Helvetica Neue', 'Helvetica', 'Arial', sans-serif;
```

### Font Weights
```css
--font-weight-light: 300;
--font-weight-normal: 400;
--font-weight-medium: 500;
--font-weight-semibold: 600;
--font-weight-bold: 700;
```

### Font Sizes
```css
/* Headings */
--h1-size: 2.5rem;      /* 40px */
--h2-size: 2rem;        /* 32px */
--h3-size: 1.75rem;     /* 28px */
--h4-size: 1.5rem;      /* 24px */
--h5-size: 1.25rem;     /* 20px */
--h6-size: 1rem;        /* 16px */

/* Body Text */
--body-large: 1.125rem; /* 18px */
--body-medium: 1rem;    /* 16px */
--body-small: 0.875rem; /* 14px */
--body-xs: 0.75rem;     /* 12px */
```

### Special Typography Rules
```css
/* Messaging Font (from user preferences) */
.messaging-text {
  font-family: 'Helvetica Neue Condensed', 'Helvetica', sans-serif;
  font-weight: 600;
  font-size: 36px;
  letter-spacing: -1.0px;
}
```

---

## Spacing System

### Base Unit
```css
--spacing-unit: 8px;
```

### Spacing Scale
```css
--spacing-xs: 4px;    /* 0.5rem */
--spacing-sm: 8px;    /* 1rem */
--spacing-md: 16px;   /* 2rem */
--spacing-lg: 24px;   /* 3rem */
--spacing-xl: 32px;   /* 4rem */
--spacing-xxl: 48px;  /* 6rem */
```

---

## Component Standards

### Cards & Containers
```css
/* Standard Card */
.card {
  background: var(--background-paper);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  box-shadow: 0 2px 4px rgba(0, 0, 0, 0.1);
  padding: var(--spacing-md);
}

/* Elevated Card */
.card-elevated {
  background: var(--background-elevated);
  border: 1px solid var(--border-light);
  border-radius: 8px;
  box-shadow: 0 4px 8px rgba(0, 0, 0, 0.15);
  padding: var(--spacing-md);
}
```

### Buttons
```css
/* Primary Button */
.btn-primary {
  background: var(--primary-main);
  color: white;
  border: none;
  border-radius: 6px;
  padding: 12px 24px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: background-color 0.2s ease;
}

.btn-primary:hover {
  background: var(--primary-light);
}

/* Secondary Button */
.btn-secondary {
  background: transparent;
  color: var(--primary-main);
  border: 2px solid var(--primary-main);
  border-radius: 6px;
  padding: 10px 22px;
  font-weight: 600;
  font-size: 14px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.btn-secondary:hover {
  background: var(--primary-main);
  color: white;
}
```

### Form Elements
```css
/* Input Fields */
.input-field {
  border: 1px solid var(--border-medium);
  border-radius: 6px;
  padding: 12px 16px;
  font-size: 14px;
  transition: border-color 0.2s ease;
}

.input-field:focus {
  border-color: var(--primary-main);
  outline: none;
  box-shadow: 0 0 0 3px rgba(35, 93, 169, 0.1);
}

/* Select Dropdowns */
.select-field {
  border: 1px solid var(--border-medium);
  border-radius: 6px;
  padding: 12px 16px;
  font-size: 14px;
  background: white;
  cursor: pointer;
}
```

---

## Tabbed Menus

### Standard Tab Style
```css
/* Horizontal Tabbed Menus */
.tab-menu {
  border-bottom: 1px solid var(--border-light);
  display: flex;
  gap: 0;
}

.tab-button {
  background: transparent;
  border: none;
  padding: 16px 24px;
  font-weight: 500;
  color: var(--text-secondary);
  cursor: pointer;
  border-radius: 0; /* Zero border radius as per user preference */
  transition: all 0.2s ease;
}

.tab-button.active {
  color: var(--primary-main);
  border-bottom: 2px solid var(--primary-main);
  background: transparent;
}

.tab-button:hover {
  color: var(--primary-main);
  background: rgba(35, 93, 169, 0.05);
}
```

---

## Messaging System

### Chat Message Styles
```css
/* System/Received Messages */
.message-received {
  background: #F5F5F5; /* Grey background */
  border-radius: 12px;
  padding: 12px 16px;
  margin: 8px 0;
  max-width: 80%;
  align-self: flex-start;
}

/* Sent Messages */
.message-sent {
  background: var(--primary-main); /* #235DA9 background */
  color: white;
  border-radius: 12px;
  padding: 12px 16px;
  margin: 8px 0;
  max-width: 80%;
  align-self: flex-end;
}
```

---

## Section Components

### Section Headers
```css
/* Section Headings (h6) */
.section-header {
  font-size: var(--h6-size);
  font-weight: 600;
  color: var(--text-primary);
  margin-bottom: var(--spacing-md);
  padding: 0; /* Remove left/right padding as per user preference */
}

/* Section Containers */
.section-container {
  padding: var(--spacing-md) 0; /* Only vertical spacing */
  background: transparent; /* Remove background colors */
}
```

---

## Data Tables

### Table Styles
```css
/* Standard Table */
.data-table {
  width: 100%;
  border-collapse: collapse;
  background: white;
}

.data-table th {
  background: var(--background-paper);
  padding: 12px 16px;
  text-align: left;
  font-weight: 600;
  color: var(--text-primary);
  border-bottom: 2px solid var(--border-light);
}

.data-table td {
  padding: 12px 16px;
  border-bottom: 1px solid var(--border-light);
  color: var(--text-secondary);
}

.data-table tr:hover {
  background: rgba(35, 93, 169, 0.05);
}
```

---

## Status Indicators

### Status Colors
```css
/* Task Status Colors */
.status-upcoming { color: var(--info-main); }
.status-due { color: var(--warning-main); }
.status-completed { color: var(--success-main); }
.status-overdue { color: var(--error-main); }

/* Priority Colors */
.priority-high { color: var(--error-main); }
.priority-medium { color: var(--warning-main); }
.priority-low { color: var(--success-main); }
```

---

## Loading States

### Loading Indicators
```css
/* Linear Progress */
.loading-progress {
  background: var(--border-light);
  height: 4px;
  border-radius: 2px;
  overflow: hidden;
}

.loading-progress-bar {
  background: var(--primary-main);
  height: 100%;
  animation: loading 1.5s ease-in-out infinite;
}

@keyframes loading {
  0% { transform: translateX(-100%); }
  100% { transform: translateX(100%); }
}

/* Spinner */
.loading-spinner {
  border: 2px solid var(--border-light);
  border-top: 2px solid var(--primary-main);
  border-radius: 50%;
  width: 20px;
  height: 20px;
  animation: spin 1s linear infinite;
}

@keyframes spin {
  0% { transform: rotate(0deg); }
  100% { transform: rotate(360deg); }
}
```

---

## Responsive Design

### Breakpoints
```css
/* Mobile First Approach */
--breakpoint-xs: 0px;
--breakpoint-sm: 600px;
--breakpoint-md: 960px;
--breakpoint-lg: 1280px;
--breakpoint-xl: 1920px;
```

### Responsive Utilities
```css
/* Hide/Show based on screen size */
.hide-mobile { display: none; }
.show-mobile { display: block; }

@media (min-width: 600px) {
  .hide-mobile { display: block; }
  .show-mobile { display: none; }
}
```

---

## Accessibility

### Focus States
```css
/* Focus Indicators */
.focus-visible {
  outline: 2px solid var(--primary-main);
  outline-offset: 2px;
}

/* High Contrast Mode */
@media (prefers-contrast: high) {
  :root {
    --border-light: #000000;
    --text-secondary: #000000;
  }
}
```

### Screen Reader Support
```css
/* Visually Hidden */
.sr-only {
  position: absolute;
  width: 1px;
  height: 1px;
  padding: 0;
  margin: -1px;
  overflow: hidden;
  clip: rect(0, 0, 0, 0);
  white-space: nowrap;
  border: 0;
}
```

---

## Animation & Transitions

### Standard Transitions
```css
/* Quick Transitions */
.transition-fast {
  transition: all 0.15s ease;
}

/* Standard Transitions */
.transition-standard {
  transition: all 0.2s ease;
}

/* Slow Transitions */
.transition-slow {
  transition: all 0.3s ease;
}
```

---

## Utility Classes

### Spacing Utilities
```css
/* Margin */
.m-0 { margin: 0; }
.m-1 { margin: var(--spacing-xs); }
.m-2 { margin: var(--spacing-sm); }
.m-3 { margin: var(--spacing-md); }
.m-4 { margin: var(--spacing-lg); }

/* Padding */
.p-0 { padding: 0; }
.p-1 { padding: var(--spacing-xs); }
.p-2 { padding: var(--spacing-sm); }
.p-3 { padding: var(--spacing-md); }
.p-4 { padding: var(--spacing-lg); }
```

### Text Utilities
```css
/* Text Alignment */
.text-left { text-align: left; }
.text-center { text-align: center; }
.text-right { text-align: right; }

/* Text Colors */
.text-primary { color: var(--text-primary); }
.text-secondary { color: var(--text-secondary); }
.text-disabled { color: var(--text-disabled); }
```

---

## Theme Integration

### Material-UI Theme Override
```typescript
// src/theme/theme.tsx
export const theme = createTheme({
  palette: {
    primary: {
      main: '#235DA9',
      light: '#4A7BC8',
      dark: '#1A4A8A',
    },
    secondary: {
      main: '#FF6B35',
      light: '#FF8A5C',
      dark: '#E55A2B',
    },
    background: {
      default: '#FFFFFF',
      paper: '#F8F9FA',
    },
    text: {
      primary: '#1A1A1A',
      secondary: '#666666',
    },
  },
  typography: {
    fontFamily: '"Helvetica Neue", "Helvetica", "Arial", sans-serif',
    h6: {
      fontSize: '1rem',
      fontWeight: 600,
    },
  },
  components: {
    MuiCard: {
      styleOverrides: {
        root: {
          borderRadius: 8,
          boxShadow: '0 2px 4px rgba(0, 0, 0, 0.1)',
        },
      },
    },
    MuiTab: {
      styleOverrides: {
        root: {
          borderRadius: 0,
          textTransform: 'none',
        },
      },
    },
  },
});
```

---

## Implementation Guidelines

### CSS Organization
1. **Global Styles** - Base styles, variables, and utilities
2. **Component Styles** - Specific component styling
3. **Layout Styles** - Grid systems and page layouts
4. **Theme Overrides** - Material-UI customizations

### Naming Conventions
- Use **kebab-case** for CSS classes
- Use **BEM methodology** for complex components
- Prefix utility classes appropriately

### Performance Considerations
- Use CSS custom properties for theming
- Minimize CSS-in-JS for better performance
- Leverage CSS Grid and Flexbox for layouts
- Optimize critical CSS for above-the-fold content

---

## Future Considerations

### Dark Mode Support
```css
/* Dark Mode Variables (Future) */
[data-theme="dark"] {
  --background-default: #121212;
  --background-paper: #1E1E1E;
  --text-primary: #FFFFFF;
  --text-secondary: #B0B0B0;
}
```

### Custom Properties for Theming
```css
/* Component-specific theming */
.component {
  --component-background: var(--background-paper);
  --component-border: var(--border-light);
  --component-text: var(--text-primary);
}
```

---

**Last Updated:** January 2025  
**Next Review:** TBD
