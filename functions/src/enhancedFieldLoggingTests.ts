import { getFunctions, httpsCallable } from 'firebase/functions';
import { 
  loggingTriggerMap, 
  LogTriggerDefinition, 
  getTestRequiredTriggers,
  validateLogEntry
} from './utils/loggingTriggerMap';

// Enhanced Field Logging Test Framework
// Combines automated DOM scanning with comprehensive validation

interface TestResult {
  fieldPath: string;
  success: boolean;
  error?: string;
  logFound: boolean;
  logValid: boolean;
  missingKeys: string[];
  extraKeys: string[];
  testDuration: number;
  timestamp: Date;
}

interface CoverageReport {
  totalFields: number;
  testedFields: number;
  passedTests: number;
  failedTests: number;
  coveragePercentage: number;
  missingLogs: number;
  malformedLogs: number;
  testResults: TestResult[];
  summary: string;
}

export class EnhancedFieldLoggingTester {
  private testResults: TestResult[] = [];
  private functions = getFunctions();

  // 1. Automated DOM Scanning
  async scanForLoggableFields(): Promise<HTMLElement[]> {
    console.log('🔍 Scanning DOM for LoggableField components...');
    
    // Find all elements with data-ai-log attribute
    const loggableElements = Array.from(document.querySelectorAll('[data-ai-log="true"]'));
    
    console.log(`Found ${loggableElements.length} LoggableField components`);
    
    return loggableElements as HTMLElement[];
  }

  // 2. Extract Field Metadata from DOM
  extractFieldMetadata(element: HTMLElement): {
    fieldPath: string;
    trigger: string;
    destinations: string[];
    context: string;
    urgency: number;
    required: boolean;
    description: string;
  } | null {
    if (!element.hasAttribute('data-ai-log')) {
      return null;
    }

    return {
      fieldPath: element.getAttribute('data-log-field') || '',
      trigger: element.getAttribute('data-log-trigger') || '',
      destinations: element.getAttribute('data-log-destinations')?.split(',') || [],
      context: element.getAttribute('data-log-context') || 'general',
      urgency: parseInt(element.getAttribute('data-log-urgency') || '5'),
      required: element.getAttribute('data-log-required') === 'true',
      description: element.getAttribute('data-log-description') || ''
    };
  }

  // 3. Simulate Field Changes
  async simulateFieldChange(element: HTMLElement, newValue: any): Promise<{ success: boolean; error?: string }> {
    try {
      const metadata = this.extractFieldMetadata(element);
      if (!metadata) {
        return { success: false, error: 'Element is not a LoggableField' };
      }

      // Find the input element within the LoggableField
      const input = element.querySelector('input, textarea, select') as HTMLInputElement;
      if (!input) {
        return { success: false, error: 'No input element found within LoggableField' };
      }

      // Get current value for comparison (unused but kept for debugging)
      // const currentValue = input.type === 'checkbox' ? input.checked : input.value;

      // Simulate the change
      const event = new Event('change', { bubbles: true });
      Object.defineProperty(event, 'target', { value: input });
      
      if (input.type === 'checkbox') {
        input.checked = newValue;
      } else {
        input.value = newValue;
      }
      
      input.dispatchEvent(event);
      
      // Wait a bit for the change to be processed
      await new Promise(resolve => setTimeout(resolve, 100));
      
      return { success: true };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error.message : 'Unknown error' };
    }
  }

  // 4. Check for Log Entry
  async checkForLogEntry(fieldPath: string, triggerDefinition: LogTriggerDefinition): Promise<{
    logFound: boolean;
    logValid: boolean;
    missingKeys: string[];
    extraKeys: string[];
    logEntry?: any;
  }> {
    try {
      // Call the backend function to check for recent logs
      const checkLogs = httpsCallable(this.functions, 'checkRecentAILogs');
      const result = await checkLogs({
        fieldPath,
        timeWindowMinutes: 5, // Check logs from last 5 minutes
        expectedKeys: triggerDefinition.expectedLogKeys
      });

      const data = result.data as any;
      
      if (!data.logFound) {
        return {
          logFound: false,
          logValid: false,
          missingKeys: triggerDefinition.expectedLogKeys,
          extraKeys: []
        };
      }

      // Validate the log entry
      const validation = validateLogEntry(data.logEntry, triggerDefinition);
      
      return {
        logFound: true,
        logValid: validation.isValid,
        missingKeys: validation.missingKeys,
        extraKeys: validation.extraKeys,
        logEntry: data.logEntry
      };
    } catch (error) {
      console.error('Error checking for log entry:', error);
      return {
        logFound: false,
        logValid: false,
        missingKeys: triggerDefinition.expectedLogKeys,
        extraKeys: []
      };
    }
  }

  // 5. Test Individual Field
  async testField(element: HTMLElement): Promise<TestResult> {
    const startTime = Date.now();
    const metadata = this.extractFieldMetadata(element);
    
    if (!metadata) {
      return {
        fieldPath: 'unknown',
        success: false,
        error: 'Element is not a LoggableField',
        logFound: false,
        logValid: false,
        missingKeys: [],
        extraKeys: [],
        testDuration: Date.now() - startTime,
        timestamp: new Date()
      };
    }

    // Find trigger definition
    const triggerDefinition = loggingTriggerMap.find(t => t.fieldPath === metadata.fieldPath);
    if (!triggerDefinition) {
      return {
        fieldPath: metadata.fieldPath,
        success: false,
        error: 'No trigger definition found for field',
        logFound: false,
        logValid: false,
        missingKeys: [],
        extraKeys: [],
        testDuration: Date.now() - startTime,
        timestamp: new Date()
      };
    }

    try {
      // Generate test value based on field type
      const testValue = this.generateTestValue(element, metadata);
      
      // Simulate the change
      const changeResult = await this.simulateFieldChange(element, testValue);
      if (!changeResult.success) {
        return {
          fieldPath: metadata.fieldPath,
          success: false,
          ...(changeResult.error ? { error: changeResult.error } : {}),
          logFound: false,
          logValid: false,
          missingKeys: [],
          extraKeys: [],
          testDuration: Date.now() - startTime,
          timestamp: new Date()
        };
      }

      // Wait for log to be created
      await new Promise(resolve => setTimeout(resolve, 2000));

      // Check for log entry
      const logCheck = await this.checkForLogEntry(metadata.fieldPath, triggerDefinition);

      const success = changeResult.success && logCheck.logFound && logCheck.logValid;

      return {
        fieldPath: metadata.fieldPath,
        success,
        ...(success ? {} : { error: 'Log not found or invalid' }),
        logFound: logCheck.logFound,
        logValid: logCheck.logValid,
        missingKeys: logCheck.missingKeys,
        extraKeys: logCheck.extraKeys,
        testDuration: Date.now() - startTime,
        timestamp: new Date()
      };
    } catch (error) {
      return {
        fieldPath: metadata.fieldPath,
        success: false,
        error: error instanceof Error ? error.message : 'Unknown error',
        logFound: false,
        logValid: false,
        missingKeys: [],
        extraKeys: [],
        testDuration: Date.now() - startTime,
        timestamp: new Date()
      };
    }
  }

  // 6. Generate Test Values
  generateTestValue(element: HTMLElement, metadata: any): any {
    const input = element.querySelector('input, textarea, select') as HTMLInputElement;
    if (!input) return 'test_value';

    switch (input.type) {
      case 'checkbox':
        return !input.checked; // Toggle the value
      case 'range':
        const min = parseInt(input.min) || 0;
        const max = parseInt(input.max) || 100;
        const current = parseInt(input.value) || min;
        return current === max ? min : current + 1;
      case 'number':
        const currentNum = parseInt(input.value) || 0;
        return currentNum + 1;
      default:
        // For text inputs, append a timestamp to make it unique
        return `${input.value || 'test'}_${Date.now()}`;
    }
  }

  // 7. Run Comprehensive Test Suite
  async runComprehensiveTest(): Promise<CoverageReport> {
    console.log('🚀 Starting comprehensive field logging test...');
    
    // Get test-required triggers from the map
    const testRequiredTriggers = getTestRequiredTriggers();
    console.log(`Found ${testRequiredTriggers.length} test-required triggers`);

    // Scan for actual LoggableField components in DOM
    const loggableElements = await this.scanForLoggableFields();
    
    // Test each field
    this.testResults = [];
    
    for (const element of loggableElements) {
      console.log(`Testing field: ${this.extractFieldMetadata(element)?.fieldPath}`);
      const result = await this.testField(element);
      this.testResults.push(result);
      
      // Small delay between tests
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    // Generate coverage report
    return this.generateCoverageReport();
  }

  // 8. Generate Coverage Report
  generateCoverageReport(): CoverageReport {
    const totalFields = this.testResults.length;
    const testedFields = this.testResults.length;
    const passedTests = this.testResults.filter(r => r.success).length;
    const failedTests = this.testResults.filter(r => !r.success).length;
    const missingLogs = this.testResults.filter(r => !r.logFound).length;
    const malformedLogs = this.testResults.filter(r => r.logFound && !r.logValid).length;
    
    const coveragePercentage = totalFields > 0 ? (passedTests / totalFields) * 100 : 0;

    // Generate summary
    let summary = `Coverage: ${coveragePercentage.toFixed(1)}% (${passedTests}/${totalFields} fields passing)`;
    if (missingLogs > 0) summary += `\n→ ${missingLogs} missing logs`;
    if (malformedLogs > 0) summary += `\n→ ${malformedLogs} malformed logs`;

    return {
      totalFields,
      testedFields,
      passedTests,
      failedTests,
      coveragePercentage,
      missingLogs,
      malformedLogs,
      testResults: this.testResults,
      summary
    };
  }

  // 9. Test Specific Field by Path
  async testFieldByPath(fieldPath: string): Promise<TestResult> {
    const element = document.querySelector(`[data-log-field="${fieldPath}"]`) as HTMLElement;
    if (!element) {
      return {
        fieldPath,
        success: false,
        error: 'Field not found in DOM',
        logFound: false,
        logValid: false,
        missingKeys: [],
        extraKeys: [],
        testDuration: 0,
        timestamp: new Date()
      };
    }

    return await this.testField(element);
  }

  // 10. Test Fields by Module
  async testFieldsByModule(module: string): Promise<TestResult[]> {
    const elements = Array.from(document.querySelectorAll(`[data-log-destinations*="${module}"]`)) as HTMLElement[];
    const results: TestResult[] = [];

    for (const element of elements) {
      const result = await this.testField(element);
      results.push(result);
      await new Promise(resolve => setTimeout(resolve, 500));
    }

    return results;
  }

  // 11. Validate Against Trigger Map
  validateAgainstTriggerMap(): {
    missingInDOM: string[];
    extraInDOM: string[];
    mismatchedTriggers: string[];
  } {
    const domFields = Array.from(document.querySelectorAll('[data-ai-log="true"]'))
      .map(el => el.getAttribute('data-log-field'))
      .filter(Boolean) as string[];

    const triggerMapFields = loggingTriggerMap.map(t => t.fieldPath);
    const testRequiredFields = getTestRequiredTriggers().map(t => t.fieldPath);

    const missingInDOM = testRequiredFields.filter(field => !domFields.includes(field));
    const extraInDOM = domFields.filter(field => !triggerMapFields.includes(field));

    // Check for trigger mismatches
    const mismatchedTriggers: string[] = [];
    for (const element of document.querySelectorAll('[data-ai-log="true"]')) {
      const fieldPath = element.getAttribute('data-log-field');
      const domTrigger = element.getAttribute('data-log-trigger');
      const mapTrigger = loggingTriggerMap.find(t => t.fieldPath === fieldPath)?.trigger;
      
      if (fieldPath && domTrigger && mapTrigger && domTrigger !== mapTrigger) {
        mismatchedTriggers.push(`${fieldPath}: DOM=${domTrigger}, Map=${mapTrigger}`);
      }
    }

    return {
      missingInDOM,
      extraInDOM,
      mismatchedTriggers
    };
  }

  // 12. Export Test Results
  exportResults(): string {
    const report = this.generateCoverageReport();
    const validation = this.validateAgainstTriggerMap();
    
    return JSON.stringify({
      coverageReport: report,
      triggerMapValidation: validation,
      timestamp: new Date().toISOString()
    }, null, 2);
  }

  // 13. Get Failed Tests
  getFailedTests(): TestResult[] {
    return this.testResults.filter(r => !r.success);
  }

  // 14. Get Missing Logs
  getMissingLogs(): TestResult[] {
    return this.testResults.filter(r => !r.logFound);
  }

  // 15. Get Malformed Logs
  getMalformedLogs(): TestResult[] {
    return this.testResults.filter(r => r.logFound && !r.logValid);
  }
}

// Utility functions for external use
export const createEnhancedTester = (): EnhancedFieldLoggingTester => {
  return new EnhancedFieldLoggingTester();
};

export const runQuickTest = async (): Promise<CoverageReport> => {
  const tester = createEnhancedTester();
  return await tester.runComprehensiveTest();
};

export const testSpecificField = async (fieldPath: string): Promise<TestResult> => {
  const tester = createEnhancedTester();
  return await tester.testFieldByPath(fieldPath);
};

export const validateTriggerMap = () => {
  const tester = createEnhancedTester();
  return tester.validateAgainstTriggerMap();
};

// Cursor-friendly test runner
export const cursorTestRunner = async (): Promise<{
  success: boolean;
  report: CoverageReport;
  validation: any;
  recommendations: string[];
}> => {
  console.log('🤖 Cursor AI Field Logging Test Runner Starting...');
  
  const tester = createEnhancedTester();
  
  try {
    // Run comprehensive test
    const report = await tester.runComprehensiveTest();
    
    // Validate against trigger map
    const validation = tester.validateAgainstTriggerMap();
    
    // Generate recommendations
    const recommendations: string[] = [];
    
    if (report.coveragePercentage < 90) {
      recommendations.push('Coverage below 90% - review failed tests and missing fields');
    }
    
    if (report.missingLogs > 0) {
      recommendations.push(`${report.missingLogs} missing logs detected - check logging implementation`);
    }
    
    if (report.malformedLogs > 0) {
      recommendations.push(`${report.malformedLogs} malformed logs detected - check log schema`);
    }
    
    if (validation.missingInDOM.length > 0) {
      recommendations.push(`${validation.missingInDOM.length} required fields missing from DOM - add LoggableField components`);
    }
    
    if (validation.mismatchedTriggers.length > 0) {
      recommendations.push(`${validation.mismatchedTriggers.length} trigger mismatches - sync DOM with trigger map`);
    }
    
    const success = report.coveragePercentage >= 90 && report.missingLogs === 0 && report.malformedLogs === 0;
    
    return {
      success,
      report,
      validation,
      recommendations
    };
  } catch (error) {
    console.error('Test runner failed:', error);
    return {
      success: false,
      report: {
        totalFields: 0,
        testedFields: 0,
        passedTests: 0,
        failedTests: 0,
        coveragePercentage: 0,
        missingLogs: 0,
        malformedLogs: 0,
        testResults: [],
        summary: 'Test runner failed'
      },
      validation: { missingInDOM: [], extraInDOM: [], mismatchedTriggers: [] },
      recommendations: ['Test runner encountered an error - check console for details']
    };
  }
}; 