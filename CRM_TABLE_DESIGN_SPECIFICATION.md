# CRM Table Design Specification

## Overview
This document outlines the design system and style guidelines for the CRM tables (Contacts, Companies, Opportunities) in the HRX God View application. All tables follow a consistent design language that prioritizes readability, scannability, and modern aesthetics.

## Table Structure

### Container Styling
```css
/* Table Container */
TableContainer {
  overflowX: 'auto',
  borderRadius: '8px',
  boxShadow: '0 1px 3px 0 rgba(0, 0, 0, 0.1), 0 1px 2px 0 rgba(0, 0, 0, 0.06)'
}

/* Table */
Table {
  minWidth: 1200px  /* Contacts & Companies */
  minWidth: 1400px  /* Opportunities */
}
```

### Header Row
```css
/* Header Row Background */
TableRow {
  backgroundColor: '#F9FAFB'
}

/* Header Cells */
TableCell {
  fontSize: '0.75rem',
  fontWeight: 600,
  color: '#374151',
  textTransform: 'uppercase',
  letterSpacing: '0.05em',
  borderBottom: '1px solid #E5E7EB',
  py: 1.5
}

/* Money Value Columns (Right Aligned) */
TableCell {
  textAlign: 'right'  /* Pipeline Value, Closed Value, Value */
}
```

### Data Rows
```css
/* Row Styling */
TableRow {
  height: '48px',
  cursor: 'pointer',
  '&:hover': {
    backgroundColor: '#F9FAFB'
  }
}

/* Data Cells */
TableCell {
  py: 1,
  px: 2  /* For first column with avatar */
}
```

## Typography System

### Primary Text (Company/Contact Names)
```css
Typography {
  variant: "body2",
  fontWeight: 600,
  color: "#111827",
  fontSize: '0.9375rem'
}
```

### Secondary Text (Job titles, emails, etc.)
```css
Typography {
  variant: "body2",
  color: "#6B7280",
  fontSize: '0.875rem'
}
```

### Muted Text (Placeholders, counts)
```css
Typography {
  variant: "body2",
  color: "#9CA3AF",
  fontSize: '0.875rem'
}
```

### Money Values
```css
Typography {
  variant: "body2",
  fontWeight: 500,
  color: "#374151",  /* Pipeline values */
  color: "#059669",  /* Closed values */
  fontSize: '0.8125rem'
}
```

## Avatar System

### Avatar Styling
```css
Avatar {
  width: 32,
  height: 32,
  fontWeight: 600,
  fontSize: '12px'
}
```

### Color Palette (Soft Pastels)
```javascript
const avatarColors = [
  '#F3F4F6', // Light gray
  '#FEF3C7', // Light yellow
  '#DBEAFE', // Light blue
  '#D1FAE5', // Light green
  '#FCE7F3', // Light pink
  '#EDE9FE', // Light purple
  '#FEE2E2', // Light red
  '#FEF5E7'  // Light orange
];

const avatarTextColors = [
  '#6B7280', // Gray
  '#92400E', // Amber
  '#1E40AF', // Blue
  '#065F46', // Green
  '#BE185D', // Pink
  '#5B21B6', // Purple
  '#DC2626', // Red
  '#EA580C'  // Orange
];
```

## Filter & Toolbar Area

### Container
```css
Box {
  mb: 2,
  p: 1.5,
  backgroundColor: '#F9FAFB',
  borderRadius: '8px',
  border: '1px solid #E5E7EB',
  borderBottom: '1px solid #D1D5DB'
}
```

### Toggle Button Groups
```css
ToggleButtonGroup {
  height: 36,
  '& .MuiToggleButton-root': {
    px: 2.5,
    py: 0.75,
    fontSize: '0.8125rem',
    fontWeight: 500,
    borderRadius: '18px',
    border: '1px solid #E5E7EB',
    color: '#6B7280',
    backgroundColor: 'white',
    '&.Mui-selected': {
      backgroundColor: '#0B63C5',
      color: 'white',
      '&:hover': {
        backgroundColor: '#0B63C5',
      }
    },
    '&:hover': {
      backgroundColor: '#F3F4F6',
    }
  }
}
```

### Search Fields
```css
TextField {
  width: 280,  /* Standard search width */
  height: 36,
  '& .MuiOutlinedInput-root': {
    height: 36,
    borderRadius: '6px',
    backgroundColor: 'white',
    fontSize: '0.875rem',
    '& fieldset': {
      borderColor: '#E5E7EB',
    },
    '&:hover fieldset': {
      borderColor: '#D1D5DB',
    },
  }
}
```

### Action Buttons
```css
/* Primary Action Button */
Button {
  variant: "contained",
  color: "primary",
  height: 36,
  borderRadius: '6px',
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.875rem',
  px: 2.5,
  py: 0.75
}

/* Secondary Action Button */
Button {
  variant: "outlined",
  color: "secondary",
  height: 36,
  borderRadius: '6px',
  textTransform: 'none',
  fontWeight: 500,
  fontSize: '0.875rem',
  px: 2.5,
  py: 0.75
}
```

## Stage Chips

### Chip Styling
```css
StageChip {
  size: "small",
  useCustomColors: true
}
```

### Custom Stage Colors
```javascript
const stageColors = {
  'qualification': '#3B82F6',    // Blue
  'proposal': '#8B5CF6',         // Purple
  'negotiation': '#F59E0B',      // Amber
  'closed': '#10B981',           // Green
  'lost': '#EF4444'              // Red
};
```

## Icons

### Icon Sizing
```css
/* Small Icons (in cells) */
Icon {
  fontSize: 16,
  color: '#9CA3AF'
}

/* Medium Icons (in headers) */
Icon {
  fontSize: 18,
  color: '#9CA3AF'
}

/* Large Icons (in buttons) */
Icon {
  fontSize: 20
}
```

### Icon Colors
- **Primary**: `#9CA3AF` (Gray for secondary actions)
- **Success**: `#10B981` (Green for positive actions)
- **Warning**: `#F59E0B` (Amber for caution)
- **Error**: `#EF4444` (Red for destructive actions)
- **Info**: `#3B82F6` (Blue for informational)

## Spacing System

### Vertical Spacing
```css
/* Section spacing */
mb: 3    /* Between major sections */
mb: 2    /* Between related elements */
mb: 1.5  /* Between filter elements */

/* Cell padding */
py: 1.5  /* Header cells */
py: 1    /* Data cells */
px: 2    /* First column with avatar */
```

### Horizontal Spacing
```css
/* Filter bar spacing */
gap: 1.5  /* Between filter elements */
gap: 1    /* Between related buttons */

/* Button spacing */
px: 2.5   /* Button horizontal padding */
```

## Hover States

### Row Hover
```css
TableRow {
  '&:hover': {
    backgroundColor: '#F9FAFB'
  }
}
```

### Button Hover
```css
/* Primary Button */
'&:hover': {
  backgroundColor: '#0B63C5'
}

/* Secondary Button */
'&:hover': {
  backgroundColor: '#F3F4F6',
  borderColor: '#D1D5DB'
}
```

### Toggle Button Hover
```css
'&:hover': {
  backgroundColor: '#F3F4F6'
}
```

## Loading States

### Loading Spinner
```css
CircularProgress {
  size: 20,
  color: 'inherit'
}
```

### Loading Text
```css
Typography {
  variant: "body2",
  color: "#6B7280"
}
```

## Empty States

### Empty State Container
```css
Box {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'center',
  justifyContent: 'center',
  py: 8,
  textAlign: 'center'
}
```

### Empty State Icon
```css
Box {
  width: 120,
  height: 120,
  borderRadius: '50%',
  backgroundColor: '#F3F4F6',
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'center',
  mb: 3
}

Icon {
  fontSize: 48,
  color: '#9CA3AF'
}
```

### Empty State Typography
```css
/* Title */
Typography {
  variant: "h6",
  fontWeight: 600,
  color: '#111827',
  mb: 1
}

/* Description */
Typography {
  variant: "body2",
  color: "#6B7280",
  mb: 3
}
```

## Color Palette

### Primary Colors
- **Primary Blue**: `#0B63C5`
- **Primary Dark**: `#0B63C5` (hover state)

### Neutral Colors
- **Text Primary**: `#111827`
- **Text Secondary**: `#6B7280`
- **Text Muted**: `#9CA3AF`
- **Border Light**: `#E5E7EB`
- **Border Medium**: `#D1D5DB`
- **Background Light**: `#F9FAFB`
- **Background White**: `#FFFFFF`

### Status Colors
- **Success**: `#059669` (Closed deals)
- **Warning**: `#F59E0B` (Amber)
- **Error**: `#EF4444` (Red)
- **Info**: `#3B82F6` (Blue)

## Responsive Design

### Breakpoints
```css
/* Mobile */
xs: {
  fontSize: '14px'
}

/* Tablet */
sm: {
  fontSize: '15px'
}

/* Desktop */
md: {
  fontSize: '15px'
}
```

### Responsive Behavior
- Tables use horizontal scrolling on smaller screens
- Filter elements wrap on mobile
- Button text may be abbreviated on small screens

## Accessibility

### Focus States
```css
/* Focus ring for interactive elements */
'&:focus-visible': {
  outline: '2px solid #0B63C5',
  outlineOffset: '2px'
}
```

### Color Contrast
- All text meets WCAG AA contrast requirements
- Interactive elements have sufficient contrast ratios
- Status colors are distinguishable for colorblind users

### Screen Reader Support
- Proper ARIA labels on interactive elements
- Descriptive alt text for icons
- Semantic HTML structure

## Animation & Transitions

### Hover Transitions
```css
transition: 'color 200ms ease-in',
transition: 'background-color 200ms ease-in'
```

### Loading Transitions
```css
transition: 'opacity 200ms ease-in-out'
```

## Implementation Notes

### Material-UI Theme Overrides
```javascript
const theme = createTheme({
  components: {
    MuiTableRow: {
      styleOverrides: {
        root: {
          '&:hover': {
            backgroundColor: '#F9FAFB'
          }
        }
      }
    },
    MuiTableCell: {
      styleOverrides: {
        head: {
          fontSize: '0.75rem',
          fontWeight: 600,
          color: '#374151',
          textTransform: 'uppercase',
          letterSpacing: '0.05em'
        }
      }
    }
  }
});
```

### CSS-in-JS Best Practices
- Use `sx` prop for component-specific styling
- Leverage theme tokens for consistency
- Maintain responsive design patterns
- Follow the established spacing scale

This design specification ensures consistency across all CRM tables while maintaining flexibility for future enhancements and maintaining accessibility standards.
