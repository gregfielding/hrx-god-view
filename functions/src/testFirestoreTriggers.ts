import { logger } from './utils/logger';

export interface TestResult {
  triggerName: string;
  success: boolean;
  error?: string;
  logId?: string;
  logData?: any;
  testData?: any;
  timestamp: string;
}

export interface TestSummary {
  totalTests: number;
  passedTests: number;
  failedTests: number;
  results: TestResult[];
  startTime: string;
  endTime: string;
  duration: number;
}

const disabledSummary: TestSummary = {
  totalTests: 0,
  passedTests: 0,
  failedTests: 0,
  results: [],
  startTime: new Date().toISOString(),
  endTime: new Date().toISOString(),
  duration: 0
};

class FirestoreTriggerTester {
  async runAllTests(): Promise<TestSummary> {
    logger.info('FirestoreTriggerTester.runAllTests invoked but ai_logs has been removed.', {
      context: 'testFirestoreTriggers.runAllTests'
    });
    return disabledSummary;
  }
}

export { FirestoreTriggerTester };

export async function runFirestoreTriggerTests(): Promise<TestSummary> {
  const tester = new FirestoreTriggerTester();
  return tester.runAllTests();
}

export async function checkTestCoverage(): Promise<{
  missingTests: string[];
  extraTests: string[];
  recommendations: string[];
}> {
  logger.info('checkTestCoverage invoked but trigger logging tests are disabled.', {
    context: 'testFirestoreTriggers.checkTestCoverage'
  });
  return {
    missingTests: [],
    extraTests: [],
    recommendations: ['AI logging triggers have been retired; no coverage report is available.']
  };
}
