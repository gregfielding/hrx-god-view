# Flutter Style Guide for HRX Companion App

**Date:** January 2025  
**Status:** Active  
**Version:** 1.0

---

## Design Philosophy

The HRX Companion App follows the same **clean, professional, and modern** design approach as the web CRM:
- **Consistency** across all components
- **Accessibility** for all users
- **Performance** with optimized styling
- **Scalability** for future features

---

## Color Palette

### Primary Colors
```dart
// Primary Brand Colors
class HRXColors {
  static const Color primaryMain = Color(0xFF235DA9);    // Main brand blue
  static const Color primaryLight = Color(0xFF4A7BC8);   // Light blue for hover states
  static const Color primaryDark = Color(0xFF1A4A8A);    // Dark blue for active states
  
  // Secondary Colors
  static const Color secondaryMain = Color(0xFFFF6B35);  // Orange for CTAs and highlights
  static const Color secondaryLight = Color(0xFFFF8A5C); // Light orange
  static const Color secondaryDark = Color(0xFFE55A2B);  // Dark orange
}
```

### Neutral Colors
```dart
// Background Colors
static const Color backgroundDefault = Color(0xFFFFFFFF);
static const Color backgroundPaper = Color(0xFFF8F9FA);
static const Color backgroundElevated = Color(0xFFFFFFFF);

// Text Colors
static const Color textPrimary = Color(0xFF1A1A1A);
static const Color textSecondary = Color(0xFF666666);
static const Color textDisabled = Color(0xFFBDBDBD);

// Border Colors
static const Color borderLight = Color(0xFFE0E0E0);
static const Color borderMedium = Color(0xFFCCCCCC);
static const Color borderDark = Color(0xFF999999);
```

### Status Colors
```dart
// Success
static const Color successMain = Color(0xFF32CD32);
static const Color successLight = Color(0xFF4CAF50);
static const Color successDark = Color(0xFF2E7D32);

// Warning
static const Color warningMain = Color(0xFFFFA500);
static const Color warningLight = Color(0xFFFFB74D);
static const Color warningDark = Color(0xFFF57C00);

// Error
static const Color errorMain = Color(0xFFFF0000);
static const Color errorLight = Color(0xFFFF5252);
static const Color errorDark = Color(0xFFD32F2F);

// Info
static const Color infoMain = Color(0xFF87CEEB);
static const Color infoLight = Color(0xFFB3E5FC);
static const Color infoDark = Color(0xFF1976D2);
```

---

## Typography

### Font Stack
```dart
// Font Family
static const String fontFamily = 'Helvetica Neue';

// Font Weights
class HRXFontWeights {
  static const FontWeight light = FontWeight.w300;
  static const FontWeight normal = FontWeight.w400;
  static const FontWeight medium = FontWeight.w500;
  static const FontWeight semibold = FontWeight.w600;
  static const FontWeight bold = FontWeight.w700;
}
```

### Font Sizes
```dart
// Font Sizes
class HRXFontSizes {
  // Headings
  static const double h1 = 40.0;  // 2.5rem
  static const double h2 = 32.0;  // 2rem
  static const double h3 = 28.0;  // 1.75rem
  static const double h4 = 24.0;  // 1.5rem
  static const double h5 = 20.0;  // 1.25rem
  static const double h6 = 16.0;  // 1rem
  
  // Body Text
  static const double bodyLarge = 18.0;   // 1.125rem
  static const double bodyMedium = 16.0;  // 1rem
  static const double bodySmall = 14.0;   // 0.875rem
  static const double bodyXs = 12.0;      // 0.75rem
}
```

### Special Typography Rules
```dart
// Messaging Font (from user preferences)
class HRXMessagingText extends StatelessWidget {
  final String text;
  
  const HRXMessagingText(this.text, {Key? key}) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Text(
      text,
      style: TextStyle(
        fontFamily: 'Helvetica Neue Condensed',
        fontWeight: FontWeight.w600,
        fontSize: 36.0,
        letterSpacing: -1.0,
      ),
    );
  }
}
```

---

## Spacing System

### Base Unit
```dart
// Base spacing unit
static const double spacingUnit = 8.0;
```

### Spacing Scale
```dart
class HRXSpacing {
  static const double xs = 4.0;   // 0.5rem
  static const double sm = 8.0;   // 1rem
  static const double md = 16.0;  // 2rem
  static const double lg = 24.0;  // 3rem
  static const double xl = 32.0;  // 4rem
  static const double xxl = 48.0; // 6rem
}
```

---

## Component Standards

### Cards & Containers
```dart
// Standard Card
class HRXCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  
  const HRXCard({
    Key? key,
    required this.child,
    this.padding,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: HRXColors.backgroundPaper,
        border: Border.all(color: HRXColors.borderLight),
        borderRadius: BorderRadius.circular(8.0),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.1),
            blurRadius: 4.0,
            offset: const Offset(0, 2),
          ),
        ],
      ),
      padding: padding ?? const EdgeInsets.all(HRXSpacing.md),
      child: child,
    );
  }
}

// Elevated Card
class HRXElevatedCard extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  
  const HRXElevatedCard({
    Key? key,
    required this.child,
    this.padding,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: BoxDecoration(
        color: HRXColors.backgroundElevated,
        border: Border.all(color: HRXColors.borderLight),
        borderRadius: BorderRadius.circular(8.0),
        boxShadow: [
          BoxShadow(
            color: Colors.black.withOpacity(0.15),
            blurRadius: 8.0,
            offset: const Offset(0, 4),
          ),
        ],
      ),
      padding: padding ?? const EdgeInsets.all(HRXSpacing.md),
      child: child,
    );
  }
}
```

### Buttons
```dart
// Primary Button
class HRXPrimaryButton extends StatelessWidget {
  final String text;
  final VoidCallback? onPressed;
  final bool isLoading;
  
  const HRXPrimaryButton({
    Key? key,
    required this.text,
    this.onPressed,
    this.isLoading = false,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return ElevatedButton(
      onPressed: isLoading ? null : onPressed,
      style: ElevatedButton.styleFrom(
        backgroundColor: HRXColors.primaryMain,
        foregroundColor: Colors.white,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(6.0),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: HRXSpacing.lg,
          vertical: HRXSpacing.md,
        ),
        textStyle: TextStyle(
          fontWeight: HRXFontWeights.semibold,
          fontSize: HRXFontSizes.bodySmall,
        ),
      ),
      child: isLoading
          ? const SizedBox(
              width: 20,
              height: 20,
              child: CircularProgressIndicator(
                strokeWidth: 2,
                valueColor: AlwaysStoppedAnimation<Color>(Colors.white),
              ),
            )
          : Text(text),
    );
  }
}

// Secondary Button
class HRXSecondaryButton extends StatelessWidget {
  final String text;
  final VoidCallback? onPressed;
  
  const HRXSecondaryButton({
    Key? key,
    required this.text,
    this.onPressed,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return OutlinedButton(
      onPressed: onPressed,
      style: OutlinedButton.styleFrom(
        foregroundColor: HRXColors.primaryMain,
        side: const BorderSide(color: HRXColors.primaryMain, width: 2),
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(6.0),
        ),
        padding: const EdgeInsets.symmetric(
          horizontal: HRXSpacing.lg,
          vertical: HRXSpacing.md,
        ),
        textStyle: TextStyle(
          fontWeight: HRXFontWeights.semibold,
          fontSize: HRXFontSizes.bodySmall,
        ),
      ),
      child: Text(text),
    );
  }
}
```

### Form Elements
```dart
// Input Fields
class HRXTextField extends StatelessWidget {
  final String? label;
  final String? hint;
  final TextEditingController? controller;
  final bool obscureText;
  final TextInputType? keyboardType;
  final String? Function(String?)? validator;
  
  const HRXTextField({
    Key? key,
    this.label,
    this.hint,
    this.controller,
    this.obscureText = false,
    this.keyboardType,
    this.validator,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return TextFormField(
      controller: controller,
      obscureText: obscureText,
      keyboardType: keyboardType,
      validator: validator,
      decoration: InputDecoration(
        labelText: label,
        hintText: hint,
        border: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6.0),
          borderSide: const BorderSide(color: HRXColors.borderMedium),
        ),
        enabledBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6.0),
          borderSide: const BorderSide(color: HRXColors.borderMedium),
        ),
        focusedBorder: OutlineInputBorder(
          borderRadius: BorderRadius.circular(6.0),
          borderSide: const BorderSide(color: HRXColors.primaryMain),
        ),
        contentPadding: const EdgeInsets.symmetric(
          horizontal: HRXSpacing.md,
          vertical: HRXSpacing.md,
        ),
        labelStyle: TextStyle(
          fontSize: HRXFontSizes.bodySmall,
          color: HRXColors.textSecondary,
        ),
      ),
      style: TextStyle(
        fontSize: HRXFontSizes.bodySmall,
        color: HRXColors.textPrimary,
      ),
    );
  }
}
```

---

## Tabbed Menus

### Standard Tab Style
```dart
// Horizontal Tabbed Menus
class HRXTabBar extends StatelessWidget {
  final List<String> tabs;
  final int selectedIndex;
  final Function(int) onTabSelected;
  
  const HRXTabBar({
    Key? key,
    required this.tabs,
    required this.selectedIndex,
    required this.onTabSelected,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Container(
      decoration: const BoxDecoration(
        border: Border(
          bottom: BorderSide(color: HRXColors.borderLight),
        ),
      ),
      child: Row(
        children: tabs.asMap().entries.map((entry) {
          final index = entry.key;
          final tab = entry.value;
          final isSelected = index == selectedIndex;
          
          return Expanded(
            child: GestureDetector(
              onTap: () => onTabSelected(index),
              child: Container(
                padding: const EdgeInsets.symmetric(
                  horizontal: HRXSpacing.lg,
                  vertical: HRXSpacing.md,
                ),
                decoration: BoxDecoration(
                  border: Border(
                    bottom: BorderSide(
                      color: isSelected ? HRXColors.primaryMain : Colors.transparent,
                      width: 2,
                    ),
                  ),
                ),
                child: Text(
                  tab,
                  textAlign: TextAlign.center,
                  style: TextStyle(
                    color: isSelected ? HRXColors.primaryMain : HRXColors.textSecondary,
                    fontWeight: HRXFontWeights.medium,
                    fontSize: HRXFontSizes.bodyMedium,
                  ),
                ),
              ),
            ),
          );
        }).toList(),
      ),
    );
  }
}
```

---

## Messaging System

### Chat Message Styles
```dart
// System/Received Messages
class HRXReceivedMessage extends StatelessWidget {
  final String message;
  final String? timestamp;
  
  const HRXReceivedMessage({
    Key? key,
    required this.message,
    this.timestamp,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerLeft,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: HRXSpacing.sm),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.8,
        ),
        padding: const EdgeInsets.all(HRXSpacing.md),
        decoration: BoxDecoration(
          color: const Color(0xFFF5F5F5), // Grey background
          borderRadius: BorderRadius.circular(12.0),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              message,
              style: TextStyle(
                color: HRXColors.textPrimary,
                fontSize: HRXFontSizes.bodyMedium,
              ),
            ),
            if (timestamp != null)
              Padding(
                padding: const EdgeInsets.only(top: HRXSpacing.xs),
                child: Text(
                  timestamp!,
                  style: TextStyle(
                    color: HRXColors.textSecondary,
                    fontSize: HRXFontSizes.bodyXs,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}

// Sent Messages
class HRXSentMessage extends StatelessWidget {
  final String message;
  final String? timestamp;
  
  const HRXSentMessage({
    Key? key,
    required this.message,
    this.timestamp,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Align(
      alignment: Alignment.centerRight,
      child: Container(
        margin: const EdgeInsets.symmetric(vertical: HRXSpacing.sm),
        constraints: BoxConstraints(
          maxWidth: MediaQuery.of(context).size.width * 0.8,
        ),
        padding: const EdgeInsets.all(HRXSpacing.md),
        decoration: BoxDecoration(
          color: HRXColors.primaryMain, // #235DA9 background
          borderRadius: BorderRadius.circular(12.0),
        ),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.end,
          children: [
            Text(
              message,
              style: const TextStyle(
                color: Colors.white,
                fontSize: HRXFontSizes.bodyMedium,
              ),
            ),
            if (timestamp != null)
              Padding(
                padding: const EdgeInsets.only(top: HRXSpacing.xs),
                child: Text(
                  timestamp!,
                  style: TextStyle(
                    color: Colors.white.withOpacity(0.7),
                    fontSize: HRXFontSizes.bodyXs,
                  ),
                ),
              ),
          ],
        ),
      ),
    );
  }
}
```

---

## Section Components

### Section Headers
```dart
// Section Headings (h6)
class HRXSectionHeader extends StatelessWidget {
  final String title;
  final Widget? trailing;
  
  const HRXSectionHeader({
    Key? key,
    required this.title,
    this.trailing,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(bottom: HRXSpacing.md),
      child: Row(
        mainAxisAlignment: MainAxisAlignment.spaceBetween,
        children: [
          Text(
            title,
            style: TextStyle(
              fontSize: HRXFontSizes.h6,
              fontWeight: HRXFontWeights.semibold,
              color: HRXColors.textPrimary,
            ),
          ),
          if (trailing != null) trailing!,
        ],
      ),
    );
  }
}

// Section Containers
class HRXSectionContainer extends StatelessWidget {
  final Widget child;
  final EdgeInsetsGeometry? padding;
  
  const HRXSectionContainer({
    Key? key,
    required this.child,
    this.padding,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: padding ?? const EdgeInsets.symmetric(vertical: HRXSpacing.md),
      child: child,
    );
  }
}
```

---

## Data Tables

### Table Styles
```dart
// Standard Table
class HRXDataTable extends StatelessWidget {
  final List<DataRow> rows;
  final List<DataColumn> columns;
  
  const HRXDataTable({
    Key? key,
    required this.rows,
    required this.columns,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return DataTable(
      columns: columns.map((column) => DataColumn(
        label: Text(
          column.label.toString(),
          style: TextStyle(
            fontWeight: HRXFontWeights.semibold,
            color: HRXColors.textPrimary,
            fontSize: HRXFontSizes.bodyMedium,
          ),
        ),
      )).toList(),
      rows: rows,
      headingRowColor: MaterialStateProperty.all(HRXColors.backgroundPaper),
      dataRowColor: MaterialStateProperty.resolveWith((states) {
        if (states.contains(MaterialState.hovered)) {
          return HRXColors.primaryMain.withOpacity(0.05);
        }
        return null;
      }),
      border: TableBorder(
        bottom: BorderSide(color: HRXColors.borderLight),
        horizontalInside: BorderSide(color: HRXColors.borderLight),
      ),
    );
  }
}
```

---

## Status Indicators

### Status Colors
```dart
// Task Status Colors
class HRXStatusIndicator extends StatelessWidget {
  final String status;
  final String text;
  
  const HRXStatusIndicator({
    Key? key,
    required this.status,
    required this.text,
  }) : super(key: key);
  
  Color getStatusColor() {
    switch (status.toLowerCase()) {
      case 'upcoming':
        return HRXColors.infoMain;
      case 'due':
        return HRXColors.warningMain;
      case 'completed':
        return HRXColors.successMain;
      case 'overdue':
        return HRXColors.errorMain;
      default:
        return HRXColors.textSecondary;
    }
  }
  
  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(
        horizontal: HRXSpacing.sm,
        vertical: HRXSpacing.xs,
      ),
      decoration: BoxDecoration(
        color: getStatusColor().withOpacity(0.1),
        borderRadius: BorderRadius.circular(4.0),
        border: Border.all(color: getStatusColor()),
      ),
      child: Text(
        text,
        style: TextStyle(
          color: getStatusColor(),
          fontSize: HRXFontSizes.bodyXs,
          fontWeight: HRXFontWeights.medium,
        ),
      ),
    );
  }
}
```

---

## Loading States

### Loading Indicators
```dart
// Linear Progress
class HRXLinearProgress extends StatelessWidget {
  final double? value;
  final Color? backgroundColor;
  final Color? valueColor;
  
  const HRXLinearProgress({
    Key? key,
    this.value,
    this.backgroundColor,
    this.valueColor,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return LinearProgressIndicator(
      value: value,
      backgroundColor: backgroundColor ?? HRXColors.borderLight,
      valueColor: AlwaysStoppedAnimation<Color>(
        valueColor ?? HRXColors.primaryMain,
      ),
    );
  }
}

// Spinner
class HRXSpinner extends StatelessWidget {
  final double size;
  final Color? color;
  
  const HRXSpinner({
    Key? key,
    this.size = 20.0,
    this.color,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return SizedBox(
      width: size,
      height: size,
      child: CircularProgressIndicator(
        strokeWidth: 2,
        valueColor: AlwaysStoppedAnimation<Color>(
          color ?? HRXColors.primaryMain,
        ),
      ),
    );
  }
}
```

---

## Responsive Design

### Breakpoints
```dart
// Breakpoints
class HRXBreakpoints {
  static const double xs = 0.0;
  static const double sm = 600.0;
  static const double md = 960.0;
  static const double lg = 1280.0;
  static const double xl = 1920.0;
}

// Responsive Utilities
class HRXResponsive extends StatelessWidget {
  final Widget mobile;
  final Widget? tablet;
  final Widget? desktop;
  
  const HRXResponsive({
    Key? key,
    required this.mobile,
    this.tablet,
    this.desktop,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return LayoutBuilder(
      builder: (context, constraints) {
        if (constraints.maxWidth >= HRXBreakpoints.lg) {
          return desktop ?? tablet ?? mobile;
        } else if (constraints.maxWidth >= HRXBreakpoints.md) {
          return tablet ?? mobile;
        } else {
          return mobile;
        }
      },
    );
  }
}
```

---

## Accessibility

### Focus States
```dart
// Focus Indicators
class HRXFocusableWidget extends StatelessWidget {
  final Widget child;
  final VoidCallback? onTap;
  
  const HRXFocusableWidget({
    Key? key,
    required this.child,
    this.onTap,
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return Focus(
      onKey: (node, event) {
        if (event is RawKeyDownEvent && 
            event.logicalKey == LogicalKeyboardKey.enter) {
          onTap?.call();
          return KeyEventResult.handled;
        }
        return KeyEventResult.ignored;
      },
      child: GestureDetector(
        onTap: onTap,
        child: child,
      ),
    );
  }
}
```

---

## Animation & Transitions

### Standard Transitions
```dart
// Quick Transitions
class HRXQuickTransition extends StatelessWidget {
  final Widget child;
  final Duration duration;
  
  const HRXQuickTransition({
    Key? key,
    required this.child,
    this.duration = const Duration(milliseconds: 150),
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: duration,
      child: child,
    );
  }
}

// Standard Transitions
class HRXStandardTransition extends StatelessWidget {
  final Widget child;
  final Duration duration;
  
  const HRXStandardTransition({
    Key? key,
    required this.child,
    this.duration = const Duration(milliseconds: 200),
  }) : super(key: key);
  
  @override
  Widget build(BuildContext context) {
    return AnimatedSwitcher(
      duration: duration,
      child: child,
    );
  }
}
```

---

## Theme Integration

### Material-UI Theme Override
```dart
// Theme Data
class HRXTheme {
  static ThemeData get lightTheme {
    return ThemeData(
      primarySwatch: MaterialColor(
        HRXColors.primaryMain.value,
        <int, Color>{
          50: HRXColors.primaryMain.withOpacity(0.1),
          100: HRXColors.primaryMain.withOpacity(0.2),
          200: HRXColors.primaryMain.withOpacity(0.3),
          300: HRXColors.primaryMain.withOpacity(0.4),
          400: HRXColors.primaryMain.withOpacity(0.5),
          500: HRXColors.primaryMain,
          600: HRXColors.primaryDark,
          700: HRXColors.primaryDark,
          800: HRXColors.primaryDark,
          900: HRXColors.primaryDark,
        },
      ),
      colorScheme: ColorScheme.light(
        primary: HRXColors.primaryMain,
        secondary: HRXColors.secondaryMain,
        surface: HRXColors.backgroundPaper,
        background: HRXColors.backgroundDefault,
        onPrimary: Colors.white,
        onSecondary: Colors.white,
        onSurface: HRXColors.textPrimary,
        onBackground: HRXColors.textPrimary,
      ),
      textTheme: TextTheme(
        headlineLarge: TextStyle(
          fontSize: HRXFontSizes.h1,
          fontWeight: HRXFontWeights.bold,
          color: HRXColors.textPrimary,
        ),
        headlineMedium: TextStyle(
          fontSize: HRXFontSizes.h2,
          fontWeight: HRXFontWeights.bold,
          color: HRXColors.textPrimary,
        ),
        headlineSmall: TextStyle(
          fontSize: HRXFontSizes.h3,
          fontWeight: HRXFontWeights.semibold,
          color: HRXColors.textPrimary,
        ),
        titleLarge: TextStyle(
          fontSize: HRXFontSizes.h4,
          fontWeight: HRXFontWeights.semibold,
          color: HRXColors.textPrimary,
        ),
        titleMedium: TextStyle(
          fontSize: HRXFontSizes.h5,
          fontWeight: HRXFontWeights.medium,
          color: HRXColors.textPrimary,
        ),
        titleSmall: TextStyle(
          fontSize: HRXFontSizes.h6,
          fontWeight: HRXFontWeights.semibold,
          color: HRXColors.textPrimary,
        ),
        bodyLarge: TextStyle(
          fontSize: HRXFontSizes.bodyLarge,
          fontWeight: HRXFontWeights.normal,
          color: HRXColors.textPrimary,
        ),
        bodyMedium: TextStyle(
          fontSize: HRXFontSizes.bodyMedium,
          fontWeight: HRXFontWeights.normal,
          color: HRXColors.textPrimary,
        ),
        bodySmall: TextStyle(
          fontSize: HRXFontSizes.bodySmall,
          fontWeight: HRXFontWeights.normal,
          color: HRXColors.textSecondary,
        ),
      ),
      cardTheme: CardTheme(
        color: HRXColors.backgroundPaper,
        elevation: 2,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8.0),
        ),
      ),
      elevatedButtonTheme: ElevatedButtonThemeData(
        style: ElevatedButton.styleFrom(
          backgroundColor: HRXColors.primaryMain,
          foregroundColor: Colors.white,
          shape: RoundedRectangleBorder(
            borderRadius: BorderRadius.circular(6.0),
          ),
          padding: const EdgeInsets.symmetric(
            horizontal: HRXSpacing.lg,
            vertical: HRXSpacing.md,
          ),
        ),
      ),
    );
  }
}
```

---

## Implementation Guidelines

### Widget Organization
1. **Global Widgets** - Base widgets, colors, and utilities
2. **Component Widgets** - Specific component styling
3. **Layout Widgets** - Grid systems and page layouts
4. **Theme Overrides** - Material-UI customizations

### Naming Conventions
- Use **PascalCase** for widget classes
- Use **camelCase** for methods and variables
- Prefix utility widgets with `HRX`
- Use descriptive names for all components

### Performance Considerations
- Use `const` constructors where possible
- Implement `StatelessWidget` for static components
- Use `ListView.builder` for long lists
- Optimize image loading and caching

---

## Usage Examples

### Complete App Structure
```dart
void main() {
  runApp(HRXCompanionApp());
}

class HRXCompanionApp extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'HRX Companion',
      theme: HRXTheme.lightTheme,
      home: HRXHomePage(),
    );
  }
}

class HRXHomePage extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Scaffold(
      backgroundColor: HRXColors.backgroundDefault,
      appBar: AppBar(
        title: Text('HRX Companion'),
        backgroundColor: HRXColors.primaryMain,
      ),
      body: SingleChildScrollView(
        padding: const EdgeInsets.all(HRXSpacing.md),
        child: Column(
          children: [
            HRXSectionHeader(title: 'Recent Tasks'),
            HRXCard(
              child: Column(
                children: [
                  // Task items here
                ],
              ),
            ),
            const SizedBox(height: HRXSpacing.lg),
            HRXSectionHeader(title: 'Quick Actions'),
            Row(
              children: [
                Expanded(
                  child: HRXPrimaryButton(
                    text: 'Create Task',
                    onPressed: () {},
                  ),
                ),
                const SizedBox(width: HRXSpacing.md),
                Expanded(
                  child: HRXSecondaryButton(
                    text: 'View All',
                    onPressed: () {},
                  ),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }
}
```

---

## Key Differences from Web CSS

### 1. **Units**
- CSS uses `px`, `rem`, `em`
- Flutter uses `double` values (logical pixels)

### 2. **Layout**
- CSS uses Flexbox/Grid
- Flutter uses `Row`, `Column`, `Flex`, `Wrap`

### 3. **Styling**
- CSS uses classes and selectors
- Flutter uses widget properties and themes

### 4. **Responsive**
- CSS uses media queries
- Flutter uses `LayoutBuilder` and `MediaQuery`

### 5. **Animations**
- CSS uses keyframes
- Flutter uses `AnimationController` and `Tween`

---

**Last Updated:** January 2025  
**Next Review:** TBD
