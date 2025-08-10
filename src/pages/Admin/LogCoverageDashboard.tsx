import React, { useState } from 'react';
import { getFunctions, httpsCallable } from 'firebase/functions';

import { app } from '../../firebase';
import { 
  loggingTriggerMap,
  getTriggersByModule 
} from '../../utils/loggingTriggerMap';

interface CoverageReport {
  totalFields: number;
  testedFields: number;
  passedTests: number;
  failedTests: number;
  coveragePercentage: number;
  missingLogs: number;
  malformedLogs: number;
  testResults: any[];
  summary: string;
}

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

const LogCoverageDashboard: React.FC = () => {
  const [coverageReport, setCoverageReport] = useState<CoverageReport | null>(null);
  const [isRunning, setIsRunning] = useState(false);
  const [triggerMapValidation, setTriggerMapValidation] = useState<any>(null);
  const [selectedModule, setSelectedModule] = useState<string>('all');
  const [testResults, setTestResults] = useState<TestResult[]>([]);
  const [recommendations, setRecommendations] = useState<string[]>([]);
  const [lastRunTime, setLastRunTime] = useState<Date | null>(null);

  // Get unique modules from trigger map
  const modules = Array.from(new Set(
    loggingTriggerMap.flatMap(trigger => trigger.destinationModules)
  )).sort();

  // Run comprehensive test
  const runComprehensiveTest = async () => {
    setIsRunning(true);
    try {
      console.log('🚀 Starting comprehensive field logging test...');
      
      const functions = getFunctions(app, 'us-central1');
      const runFieldLoggingTests = httpsCallable(functions, 'runFieldLoggingTests');
      const result = await runFieldLoggingTests();
      
      const testResult = result.data as any;
      setCoverageReport(testResult.report);
      setTestResults(testResult.report.testResults);
      setRecommendations(testResult.recommendations);
      setLastRunTime(new Date());
      
      // Validate trigger map
      const validateTriggerMapFn = httpsCallable(functions, 'validateTriggerMap');
      const validation = await validateTriggerMapFn();
      setTriggerMapValidation(validation.data);
      
      console.log('✅ Test completed:', testResult.report.summary);
    } catch (error) {
      console.error('❌ Test failed:', error);
      setRecommendations(['Test runner encountered an error - check console for details']);
    } finally {
      setIsRunning(false);
    }
  };

  // Run test for specific module
  const runModuleTest = async (module: string) => {
    setIsRunning(true);
    try {
      const functions = getFunctions(app, 'us-central1');
      const runModuleTestFn = httpsCallable(functions, 'runModuleTest');
      const result = await runModuleTestFn({ module });
      
      const results = result.data as TestResult[];
      const passedTests = results.filter((r: TestResult) => r.success).length;
      const totalTests = results.length;
      const coveragePercentage = totalTests > 0 ? (passedTests / totalTests) * 100 : 0;
      
      setTestResults(results);
      setCoverageReport({
        totalFields: totalTests,
        testedFields: totalTests,
        passedTests,
        failedTests: totalTests - passedTests,
        coveragePercentage,
        missingLogs: results.filter((r: TestResult) => !r.logFound).length,
        malformedLogs: results.filter((r: TestResult) => r.logFound && !r.logValid).length,
        testResults: results,
        summary: `Module ${module}: ${coveragePercentage.toFixed(1)}% (${passedTests}/${totalTests})`
      });
      setLastRunTime(new Date());
    } catch (error) {
      console.error('Module test failed:', error);
    } finally {
      setIsRunning(false);
    }
  };

  // Get coverage color based on percentage
  const getCoverageColor = (percentage: number): string => {
    if (percentage >= 90) return '#10b981'; // green
    if (percentage >= 70) return '#f59e0b'; // yellow
    return '#ef4444'; // red
  };

  // Get status icon
  const getStatusIcon = (success: boolean): string => {
    return success ? '✅' : '❌';
  };

  // Filter test results by module
  const filteredTestResults = selectedModule === 'all' 
    ? testResults 
    : testResults.filter(result => {
        const trigger = loggingTriggerMap.find(t => t.fieldPath === result.fieldPath);
        return trigger?.destinationModules.includes(selectedModule as any);
      });

  return (
    <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto' }}>
      <div style={{ marginBottom: '32px' }}>
        <h1 style={{ fontSize: '2rem', fontWeight: 'bold', marginBottom: '8px' }}>
          🧠 AI Field Logging Coverage Dashboard
        </h1>
        <p style={{ color: '#6b7280', fontSize: '1rem' }}>
          Monitor and test AI field logging coverage across all modules
        </p>
      </div>

      {/* Control Panel */}
      <div style={{ 
        display: 'flex', 
        gap: '16px', 
        marginBottom: '24px',
        flexWrap: 'wrap',
        alignItems: 'center'
      }}>
        <button
          onClick={runComprehensiveTest}
          disabled={isRunning}
          style={{
            padding: '12px 24px',
            backgroundColor: '#3b82f6',
            color: 'white',
            border: 'none',
            borderRadius: '8px',
            fontSize: '1rem',
            fontWeight: '500',
            cursor: isRunning ? 'not-allowed' : 'pointer',
            opacity: isRunning ? 0.6 : 1
          }}
        >
          {isRunning ? '🔄 Running Tests...' : '🚀 Run Comprehensive Test'}
        </button>

        <select
          value={selectedModule}
          onChange={(e) => setSelectedModule(e.target.value)}
          style={{
            padding: '8px 12px',
            border: '1px solid #d1d5db',
            borderRadius: '6px',
            fontSize: '0.9rem'
          }}
        >
          <option value="all">All Modules</option>
          {modules.map(module => (
            <option key={module} value={module}>{module}</option>
          ))}
        </select>

        {selectedModule !== 'all' && (
          <button
            onClick={() => runModuleTest(selectedModule)}
            disabled={isRunning}
            style={{
              padding: '8px 16px',
              backgroundColor: '#10b981',
              color: 'white',
              border: 'none',
              borderRadius: '6px',
              fontSize: '0.9rem',
              cursor: isRunning ? 'not-allowed' : 'pointer'
            }}
          >
            Test {selectedModule}
          </button>
        )}

        {lastRunTime && (
          <span style={{ color: '#6b7280', fontSize: '0.9rem' }}>
            Last run: {lastRunTime.toLocaleTimeString()}
          </span>
        )}
      </div>

      {/* Coverage Summary */}
      {coverageReport && (
        <div style={{ 
          display: 'grid', 
          gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', 
          gap: '16px',
          marginBottom: '32px'
        }}>
          <div style={{
            padding: '20px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: getCoverageColor(coverageReport.coveragePercentage) }}>
              {coverageReport.coveragePercentage.toFixed(1)}%
            </div>
            <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>Coverage</div>
          </div>

          <div style={{
            padding: '20px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#10b981' }}>
              {coverageReport.passedTests}
            </div>
            <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>Passed Tests</div>
          </div>

          <div style={{
            padding: '20px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#ef4444' }}>
              {coverageReport.failedTests}
            </div>
            <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>Failed Tests</div>
          </div>

          <div style={{
            padding: '20px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#f59e0b' }}>
              {coverageReport.missingLogs}
            </div>
            <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>Missing Logs</div>
          </div>

          <div style={{
            padding: '20px',
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            textAlign: 'center'
          }}>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#8b5cf6' }}>
              {coverageReport.malformedLogs}
            </div>
            <div style={{ color: '#6b7280', fontSize: '0.9rem' }}>Malformed Logs</div>
          </div>
        </div>
      )}

      {/* Recommendations */}
      {recommendations.length > 0 && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '12px' }}>
            📋 Recommendations
          </h3>
          <div style={{
            padding: '16px',
            backgroundColor: '#fef3c7',
            border: '1px solid #f59e0b',
            borderRadius: '8px'
          }}>
            {recommendations.map((rec, index) => (
              <div key={index} style={{ marginBottom: '8px', fontSize: '0.9rem' }}>
                • {rec}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Trigger Map Validation */}
      {triggerMapValidation && (
        <div style={{ marginBottom: '24px' }}>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '12px' }}>
            🗺️ Trigger Map Validation
          </h3>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fit, minmax(300px, 1fr))',
            gap: '16px'
          }}>
            <div style={{
              padding: '16px',
              backgroundColor: triggerMapValidation.missingInDOM.length > 0 ? '#fee2e2' : '#dcfce7',
              border: `1px solid ${triggerMapValidation.missingInDOM.length > 0 ? '#ef4444' : '#10b981'}`,
              borderRadius: '8px'
            }}>
              <div style={{ fontWeight: '600', marginBottom: '8px' }}>
                Missing in DOM: {triggerMapValidation.missingInDOM.length}
              </div>
              {triggerMapValidation.missingInDOM.length > 0 && (
                <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                  {triggerMapValidation.missingInDOM.slice(0, 3).join(', ')}
                  {triggerMapValidation.missingInDOM.length > 3 && '...'}
                </div>
              )}
            </div>

            <div style={{
              padding: '16px',
              backgroundColor: triggerMapValidation.extraInDOM.length > 0 ? '#fee2e2' : '#dcfce7',
              border: `1px solid ${triggerMapValidation.extraInDOM.length > 0 ? '#ef4444' : '#10b981'}`,
              borderRadius: '8px'
            }}>
              <div style={{ fontWeight: '600', marginBottom: '8px' }}>
                Extra in DOM: {triggerMapValidation.extraInDOM.length}
              </div>
              {triggerMapValidation.extraInDOM.length > 0 && (
                <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                  {triggerMapValidation.extraInDOM.slice(0, 3).join(', ')}
                  {triggerMapValidation.extraInDOM.length > 3 && '...'}
                </div>
              )}
            </div>

            <div style={{
              padding: '16px',
              backgroundColor: triggerMapValidation.mismatchedTriggers.length > 0 ? '#fee2e2' : '#dcfce7',
              border: `1px solid ${triggerMapValidation.mismatchedTriggers.length > 0 ? '#ef4444' : '#10b981'}`,
              borderRadius: '8px'
            }}>
              <div style={{ fontWeight: '600', marginBottom: '8px' }}>
                Trigger Mismatches: {triggerMapValidation.mismatchedTriggers.length}
              </div>
              {triggerMapValidation.mismatchedTriggers.length > 0 && (
                <div style={{ fontSize: '0.8rem', color: '#6b7280' }}>
                  {triggerMapValidation.mismatchedTriggers.slice(0, 2).join(', ')}
                  {triggerMapValidation.mismatchedTriggers.length > 2 && '...'}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Test Results Table */}
      {testResults.length > 0 && (
        <div>
          <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '12px' }}>
            📊 Test Results ({filteredTestResults.length} fields)
          </h3>
          <div style={{
            backgroundColor: 'white',
            borderRadius: '12px',
            border: '1px solid #e5e7eb',
            overflow: 'hidden'
          }}>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 80px 80px 80px 120px',
              gap: '16px',
              padding: '16px',
              backgroundColor: '#f9fafb',
              borderBottom: '1px solid #e5e7eb',
              fontWeight: '600',
              fontSize: '0.9rem'
            }}>
              <div>Field Path</div>
              <div>Status</div>
              <div>Log Found</div>
              <div>Log Valid</div>
              <div>Duration (ms)</div>
            </div>
            
            <div style={{ maxHeight: '400px', overflowY: 'auto' }}>
              {filteredTestResults.map((result, index) => (
                <div
                  key={index}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '1fr 80px 80px 80px 120px',
                    gap: '16px',
                    padding: '16px',
                    borderBottom: '1px solid #f3f4f6',
                    fontSize: '0.9rem',
                    backgroundColor: index % 2 === 0 ? 'white' : '#f9fafb'
                  }}
                >
                  <div style={{ fontFamily: 'monospace', fontSize: '0.8rem' }}>
                    {result.fieldPath}
                  </div>
                  <div style={{ color: result.success ? '#10b981' : '#ef4444' }}>
                    {getStatusIcon(result.success)}
                  </div>
                  <div style={{ color: result.logFound ? '#10b981' : '#ef4444' }}>
                    {getStatusIcon(result.logFound)}
                  </div>
                  <div style={{ color: result.logValid ? '#10b981' : '#ef4444' }}>
                    {getStatusIcon(result.logValid)}
                  </div>
                  <div style={{ fontFamily: 'monospace' }}>
                    {result.testDuration}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Module Breakdown */}
      <div style={{ marginTop: '32px' }}>
        <h3 style={{ fontSize: '1.2rem', fontWeight: '600', marginBottom: '12px' }}>
          📈 Module Breakdown
        </h3>
        <div style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))',
          gap: '16px'
        }}>
          {modules.map(module => {
            const moduleTriggers = getTriggersByModule(module as any);
            const moduleResults = testResults.filter(result => {
              const trigger = loggingTriggerMap.find(t => t.fieldPath === result.fieldPath);
              return trigger?.destinationModules.includes(module as any);
            });
            const passedTests = moduleResults.filter(r => r.success).length;
            const coverage = moduleResults.length > 0 ? (passedTests / moduleResults.length) * 100 : 0;
            
            return (
              <div key={module} style={{
                padding: '16px',
                backgroundColor: 'white',
                borderRadius: '8px',
                border: '1px solid #e5e7eb'
              }}>
                <div style={{ fontWeight: '600', marginBottom: '8px' }}>
                  {module}
                </div>
                <div style={{ fontSize: '0.9rem', color: '#6b7280', marginBottom: '8px' }}>
                  {moduleTriggers.length} triggers defined
                </div>
                {moduleResults.length > 0 && (
                  <div style={{ fontSize: '0.9rem' }}>
                    <span style={{ color: getCoverageColor(coverage), fontWeight: '600' }}>
                      {coverage.toFixed(1)}% coverage
                    </span>
                    <span style={{ color: '#6b7280' }}>
                      {' '}({passedTests}/{moduleResults.length})
                    </span>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};

export default LogCoverageDashboard; 