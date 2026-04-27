import { jsPDF } from 'jspdf';
import 'jspdf-autotable';
import * as XLSX from 'xlsx';

interface JSIScore {
  id: string;
  userId: string;
  userName: string;
  department: string;
  location: string;
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  lastUpdated: string;
  trend: 'up' | 'down' | 'stable';
  riskLevel: 'low' | 'medium' | 'high';
  flags: string[];
  supervisor?: string;
  team?: string;
  aiSummary?: string;
  lastSurveyResponse?: string;
  recommendedAction?: string;
}

interface JSIBenchmark {
  type: 'global' | 'industry';
  industryCode?: string;
  industryName?: string;
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  workerCount: number;
  customerCount: number;
  calculatedAt: string;
  dateRange: {
    start: string;
    end: string;
  };
  percentiles: {
    p25: number;
    p50: number;
    p75: number;
    p90: number;
  };
}

interface JSIBaseline {
  tenantId: string;
  customerId?: string; // For backward compatibility
  department?: string;
  location?: string;
  overallScore: number;
  workEngagement: number;
  careerAlignment: number;
  managerRelationship: number;
  personalWellbeing: number;
  jobMobility: number;
  dateRange: {
    start: string;
    end: string;
  };
  workerCount: number;
  calculatedAt: string;
}

interface ExportData {
  workers: JSIScore[];
  benchmarks: {
    global: JSIBenchmark;
    industry?: JSIBenchmark;
  } | null;
  baseline: JSIBaseline;
  filters: any;
  metadata: {
    generatedAt: string;
    totalWorkers: number;
    averageScore: number;
  };
}

// Helper functions
const getPercentile = (score: number, percentiles: any) => {
  if (score <= percentiles.p25) return '25th';
  if (score <= percentiles.p50) return '50th';
  if (score <= percentiles.p75) return '75th';
  if (score <= percentiles.p90) return '90th';
  return '90th+';
};

const getAverageDimension = (workers: JSIScore[], dimension: keyof JSIScore) => {
  const validWorkers = workers.filter((w) => w[dimension] !== undefined);
  if (validWorkers.length === 0) return 0;
  return validWorkers.reduce((sum, w) => sum + (w[dimension] as number), 0) / validWorkers.length;
};

export const generatePDFReport = (data: ExportData, customerName = 'Organization') => {
  const doc = new jsPDF();
  const pageWidth = doc.internal.pageSize.width;
  const pageHeight = doc.internal.pageSize.height;
  const margin = 20;
  let yPosition = margin;

  // Helper function to add new page if needed
  const addPageIfNeeded = (requiredSpace: number) => {
    if (yPosition + requiredSpace > pageHeight - margin) {
      doc.addPage();
      yPosition = margin;
    }
  };

  // Header
  doc.setFontSize(24);
  doc.setFont('helvetica', 'bold');
  doc.text('Job Satisfaction Insights Report', pageWidth / 2, yPosition + 20);

  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');
  doc.text(customerName, pageWidth / 2, yPosition + 30);
  doc.text(
    `Generated: ${new Date(data.metadata.generatedAt).toLocaleDateString()}`,
    pageWidth / 2,
    yPosition + 40,
  );

  yPosition += 60;

  // Executive Summary
  addPageIfNeeded(80);
  doc.setFontSize(16);
  doc.setFont('helvetica', 'bold');
  doc.text('Executive Summary', margin, yPosition);

  yPosition += 20;
  doc.setFontSize(12);
  doc.setFont('helvetica', 'normal');

  const summaryText = [
    `This report provides a comprehensive analysis of job satisfaction across ${data.metadata.totalWorkers} workers.`,
    `The average JSI score is ${data.metadata.averageScore.toFixed(1)} out of 100.`,
    data.benchmarks
      ? `This compares to a global average of ${data.benchmarks.global.overallScore.toFixed(1)}.`
      : '',
    data.benchmarks?.industry
      ? `Industry average: ${data.benchmarks.industry.overallScore.toFixed(1)}.`
      : '',
  ].filter(Boolean);

  summaryText.forEach((text, index) => {
    doc.text(text, margin, yPosition + index * 8);
  });

  yPosition += summaryText.length * 8 + 20;

  // Key Metrics Table
  addPageIfNeeded(100);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Key Metrics', margin, yPosition);

  yPosition += 20;

  const metricsData = [
    ['Metric', 'Value', 'Benchmark'],
    [
      'Average Overall Score',
      data.metadata.averageScore.toFixed(1),
      data.benchmarks?.global.overallScore.toFixed(1) || 'N/A',
    ],
    [
      'Total Workers',
      data.metadata.totalWorkers.toString(),
      data.benchmarks?.global.workerCount.toString() || 'N/A',
    ],
    [
      'High Risk Workers',
      data.workers.filter((w) => w.riskLevel === 'high').length.toString(),
      'N/A',
    ],
    [
      'Medium Risk Workers',
      data.workers.filter((w) => w.riskLevel === 'medium').length.toString(),
      'N/A',
    ],
    [
      'Low Risk Workers',
      data.workers.filter((w) => w.riskLevel === 'low').length.toString(),
      'N/A',
    ],
  ];

  (doc as any).autoTable({
    startY: yPosition,
    head: [metricsData[0]],
    body: metricsData.slice(1),
    theme: 'grid',
    headStyles: { fillColor: [66, 139, 202] },
    styles: { fontSize: 10 },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 20;

  // Benchmarking Section
  if (data.benchmarks) {
    addPageIfNeeded(120);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Benchmarking Analysis', margin, yPosition);

    yPosition += 20;

    const benchmarkData = [
      ['Dimension', 'Your Score', 'Global Avg', 'Industry Avg', 'Percentile'],
      [
        'Overall',
        data.metadata.averageScore.toFixed(1),
        data.benchmarks.global.overallScore.toFixed(1),
        data.benchmarks.industry?.overallScore.toFixed(1) || 'N/A',
        getPercentile(data.metadata.averageScore, data.benchmarks.global.percentiles),
      ],
      [
        'Engagement',
        getAverageDimension(data.workers, 'workEngagement').toFixed(1),
        data.benchmarks.global.workEngagement.toFixed(1),
        data.benchmarks.industry?.workEngagement.toFixed(1) || 'N/A',
        getPercentile(
          getAverageDimension(data.workers, 'workEngagement'),
          data.benchmarks.global.percentiles,
        ),
      ],
      [
        'Career',
        getAverageDimension(data.workers, 'careerAlignment').toFixed(1),
        data.benchmarks.global.careerAlignment.toFixed(1),
        data.benchmarks.industry?.careerAlignment.toFixed(1) || 'N/A',
        getPercentile(
          getAverageDimension(data.workers, 'careerAlignment'),
          data.benchmarks.global.percentiles,
        ),
      ],
      [
        'Manager',
        getAverageDimension(data.workers, 'managerRelationship').toFixed(1),
        data.benchmarks.global.managerRelationship.toFixed(1),
        data.benchmarks.industry?.managerRelationship.toFixed(1) || 'N/A',
        getPercentile(
          getAverageDimension(data.workers, 'managerRelationship'),
          data.benchmarks.global.percentiles,
        ),
      ],
      [
        'Wellbeing',
        getAverageDimension(data.workers, 'personalWellbeing').toFixed(1),
        data.benchmarks.global.personalWellbeing.toFixed(1),
        data.benchmarks.industry?.personalWellbeing.toFixed(1) || 'N/A',
        getPercentile(
          getAverageDimension(data.workers, 'personalWellbeing'),
          data.benchmarks.global.percentiles,
        ),
      ],
      [
        'Mobility',
        getAverageDimension(data.workers, 'jobMobility').toFixed(1),
        data.benchmarks.global.jobMobility.toFixed(1),
        data.benchmarks.industry?.jobMobility.toFixed(1) || 'N/A',
        getPercentile(
          getAverageDimension(data.workers, 'jobMobility'),
          data.benchmarks.global.percentiles,
        ),
      ],
    ];

    (doc as any).autoTable({
      startY: yPosition,
      head: [benchmarkData[0]],
      body: benchmarkData.slice(1),
      theme: 'grid',
      headStyles: { fillColor: [66, 139, 202] },
      styles: { fontSize: 9 },
    });

    yPosition = (doc as any).lastAutoTable.finalY + 20;
  }

  // Risk Analysis
  addPageIfNeeded(100);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Risk Analysis', margin, yPosition);

  yPosition += 20;

  const highRiskWorkers = data.workers.filter((w) => w.riskLevel === 'high');
  const mediumRiskWorkers = data.workers.filter((w) => w.riskLevel === 'medium');

  const riskData = [
    ['Risk Level', 'Count', 'Percentage', 'Average Score'],
    [
      'High Risk',
      highRiskWorkers.length.toString(),
      `${((highRiskWorkers.length / data.metadata.totalWorkers) * 100).toFixed(1)}%`,
      highRiskWorkers.length > 0
        ? (
            highRiskWorkers.reduce((sum, w) => sum + w.overallScore, 0) / highRiskWorkers.length
          ).toFixed(1)
        : 'N/A',
    ],
    [
      'Medium Risk',
      mediumRiskWorkers.length.toString(),
      `${((mediumRiskWorkers.length / data.metadata.totalWorkers) * 100).toFixed(1)}%`,
      mediumRiskWorkers.length > 0
        ? (
            mediumRiskWorkers.reduce((sum, w) => sum + w.overallScore, 0) / mediumRiskWorkers.length
          ).toFixed(1)
        : 'N/A',
    ],
    [
      'Low Risk',
      data.workers.filter((w) => w.riskLevel === 'low').length.toString(),
      `${(
        (data.workers.filter((w) => w.riskLevel === 'low').length / data.metadata.totalWorkers) *
        100
      ).toFixed(1)}%`,
      data.workers.filter((w) => w.riskLevel === 'low').length > 0
        ? (
            data.workers
              .filter((w) => w.riskLevel === 'low')
              .reduce((sum, w) => sum + w.overallScore, 0) /
            data.workers.filter((w) => w.riskLevel === 'low').length
          ).toFixed(1)
        : 'N/A',
    ],
  ];

  (doc as any).autoTable({
    startY: yPosition,
    head: [riskData[0]],
    body: riskData.slice(1),
    theme: 'grid',
    headStyles: { fillColor: [66, 139, 202] },
    styles: { fontSize: 10 },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 20;

  // Department Analysis
  addPageIfNeeded(100);
  doc.setFontSize(14);
  doc.setFont('helvetica', 'bold');
  doc.text('Department Analysis', margin, yPosition);

  yPosition += 20;

  const departments = [...new Set(data.workers.map((w) => w.department))];
  const departmentData = [['Department', 'Workers', 'Avg Score', 'High Risk', 'Medium Risk']];

  departments.forEach((dept) => {
    const deptWorkers = data.workers.filter((w) => w.department === dept);
    const avgScore = deptWorkers.reduce((sum, w) => sum + w.overallScore, 0) / deptWorkers.length;
    const highRisk = deptWorkers.filter((w) => w.riskLevel === 'high').length;
    const mediumRisk = deptWorkers.filter((w) => w.riskLevel === 'medium').length;

    departmentData.push([
      dept,
      deptWorkers.length.toString(),
      avgScore.toFixed(1),
      highRisk.toString(),
      mediumRisk.toString(),
    ]);
  });

  (doc as any).autoTable({
    startY: yPosition,
    head: [departmentData[0]],
    body: departmentData.slice(1),
    theme: 'grid',
    headStyles: { fillColor: [66, 139, 202] },
    styles: { fontSize: 10 },
  });

  yPosition = (doc as any).lastAutoTable.finalY + 20;

  // Individual Worker Scores (if space allows)
  if (data.workers.length <= 20) {
    addPageIfNeeded(150);
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.text('Individual Worker Scores', margin, yPosition);

    yPosition += 20;

    const workerData = [['Worker', 'Department', 'Overall Score', 'Risk Level', 'Flags']];

    data.workers.forEach((worker) => {
      workerData.push([
        worker.userName,
        worker.department,
        worker.overallScore.toString(),
        worker.riskLevel,
        worker.flags.join(', ') || 'None',
      ]);
    });

    (doc as any).autoTable({
      startY: yPosition,
      head: [workerData[0]],
      body: workerData.slice(1),
      theme: 'grid',
      headStyles: { fillColor: [66, 139, 202] },
      styles: { fontSize: 8 },
    });
  }

  // Footer
  const totalPages = doc.getNumberOfPages();
  for (let i = 1; i <= totalPages; i++) {
    doc.setPage(i);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'italic');
    doc.text(`Page ${i} of ${totalPages}`, pageWidth - margin, pageHeight - 10);
    doc.text('Generated by HRX Job Satisfaction Insights', margin, pageHeight - 10);
  }

  // Save the PDF
  const fileName = `JSI_Report_${customerName.replace(/[^a-zA-Z0-9]/g, '_')}_${
    new Date().toISOString().split('T')[0]
  }.pdf`;
  doc.save(fileName);
};

export const generateExcelReport = (data: ExportData, customerName = 'Organization') => {
  const workbook = XLSX.utils.book_new();

  // 1. Executive Summary Sheet
  const summaryData = [
    ['Job Satisfaction Insights Report', ''],
    ['Customer', customerName],
    ['Generated', new Date(data.metadata.generatedAt).toLocaleDateString()],
    ['', ''],
    ['Key Metrics', ''],
    ['Total Workers', data.metadata.totalWorkers.toString()],
    ['Average Overall Score', data.metadata.averageScore.toFixed(1)],
    ['High Risk Workers', data.workers.filter((w) => w.riskLevel === 'high').length.toString()],
    ['Medium Risk Workers', data.workers.filter((w) => w.riskLevel === 'medium').length.toString()],
    ['Low Risk Workers', data.workers.filter((w) => w.riskLevel === 'low').length.toString()],
    ['', ''],
    ['Benchmarking', ''],
    ['Global Average', data.benchmarks?.global.overallScore.toFixed(1) || 'N/A'],
    ['Industry Average', data.benchmarks?.industry?.overallScore.toFixed(1) || 'N/A'],
    ['', ''],
    ['Report Summary', ''],
    [
      `This report provides a comprehensive analysis of job satisfaction across ${data.metadata.totalWorkers} workers.`,
      '',
    ],
    [`The average JSI score is ${data.metadata.averageScore.toFixed(1)} out of 100.`, ''],
    data.benchmarks
      ? [
          `This compares to a global average of ${data.benchmarks.global.overallScore.toFixed(1)}.`,
          '',
        ]
      : ['', ''],
    data.benchmarks?.industry
      ? [`Industry average: ${data.benchmarks.industry.overallScore.toFixed(1)}.`, '']
      : ['', ''],
  ].filter((row) => row[0] !== '');

  const summarySheet = XLSX.utils.aoa_to_sheet(summaryData);
  workbook.SheetNames.push('Executive Summary');
  workbook.Sheets['Executive Summary'] = summarySheet;

  // 2. Individual Worker Scores Sheet
  const workerData = [
    [
      'Worker Name',
      'Department',
      'Location',
      'Overall Score',
      'Work Engagement',
      'Career Alignment',
      'Manager Relationship',
      'Personal Wellbeing',
      'Job Mobility',
      'Risk Level',
      'Trend',
      'Flags',
      'Last Updated',
      'Supervisor',
      'Team',
    ],
  ];

  data.workers.forEach((worker) => {
    workerData.push([
      worker.userName,
      worker.department,
      worker.location,
      worker.overallScore.toString(),
      worker.workEngagement.toString(),
      worker.careerAlignment.toString(),
      worker.managerRelationship.toString(),
      worker.personalWellbeing.toString(),
      worker.jobMobility.toString(),
      worker.riskLevel,
      worker.trend,
      worker.flags.join(', ') || 'None',
      new Date(worker.lastUpdated).toLocaleDateString(),
      worker.supervisor || '',
      worker.team || '',
    ]);
  });

  const workerSheet = XLSX.utils.aoa_to_sheet(workerData);
  workbook.SheetNames.push('Individual Scores');
  workbook.Sheets['Individual Scores'] = workerSheet;

  // 3. Department Analysis Sheet
  const departments = [...new Set(data.workers.map((w) => w.department))];
  const departmentData = [
    [
      'Department',
      'Worker Count',
      'Average Overall Score',
      'Average Work Engagement',
      'Average Career Alignment',
      'Average Manager Relationship',
      'Average Personal Wellbeing',
      'Average Job Mobility',
      'High Risk Count',
      'Medium Risk Count',
      'Low Risk Count',
      'High Risk %',
      'Medium Risk %',
      'Low Risk %',
    ],
  ];

  departments.forEach((dept) => {
    const deptWorkers = data.workers.filter((w) => w.department === dept);
    const avgOverall = deptWorkers.reduce((sum, w) => sum + w.overallScore, 0) / deptWorkers.length;
    const avgEngagement = getAverageDimension(deptWorkers, 'workEngagement');
    const avgCareer = getAverageDimension(deptWorkers, 'careerAlignment');
    const avgManager = getAverageDimension(deptWorkers, 'managerRelationship');
    const avgWellbeing = getAverageDimension(deptWorkers, 'personalWellbeing');
    const avgMobility = getAverageDimension(deptWorkers, 'jobMobility');
    const highRisk = deptWorkers.filter((w) => w.riskLevel === 'high').length;
    const mediumRisk = deptWorkers.filter((w) => w.riskLevel === 'medium').length;
    const lowRisk = deptWorkers.filter((w) => w.riskLevel === 'low').length;

    departmentData.push([
      dept,
      deptWorkers.length.toString(),
      avgOverall.toFixed(1),
      avgEngagement.toFixed(1),
      avgCareer.toFixed(1),
      avgManager.toFixed(1),
      avgWellbeing.toFixed(1),
      avgMobility.toFixed(1),
      highRisk.toString(),
      mediumRisk.toString(),
      lowRisk.toString(),
      `${((highRisk / deptWorkers.length) * 100).toFixed(1)}%`,
      `${((mediumRisk / deptWorkers.length) * 100).toFixed(1)}%`,
      `${((lowRisk / deptWorkers.length) * 100).toFixed(1)}%`,
    ]);
  });

  const departmentSheet = XLSX.utils.aoa_to_sheet(departmentData);
  workbook.SheetNames.push('Department Analysis');
  workbook.Sheets['Department Analysis'] = departmentSheet;

  // 4. Risk Analysis Sheet
  const riskData = [
    [
      'Risk Level',
      'Count',
      'Percentage',
      'Average Overall Score',
      'Average Work Engagement',
      'Average Career Alignment',
      'Average Manager Relationship',
      'Average Personal Wellbeing',
      'Average Job Mobility',
    ],
  ];

  const riskLevels = ['high', 'medium', 'low'] as const;
  riskLevels.forEach((level) => {
    const levelWorkers = data.workers.filter((w) => w.riskLevel === level);
    if (levelWorkers.length > 0) {
      const avgOverall =
        levelWorkers.reduce((sum, w) => sum + w.overallScore, 0) / levelWorkers.length;
      const avgEngagement = getAverageDimension(levelWorkers, 'workEngagement');
      const avgCareer = getAverageDimension(levelWorkers, 'careerAlignment');
      const avgManager = getAverageDimension(levelWorkers, 'managerRelationship');
      const avgWellbeing = getAverageDimension(levelWorkers, 'personalWellbeing');
      const avgMobility = getAverageDimension(levelWorkers, 'jobMobility');

      riskData.push([
        `${level.charAt(0).toUpperCase() + level.slice(1)} Risk`,
        levelWorkers.length.toString(),
        `${((levelWorkers.length / data.metadata.totalWorkers) * 100).toFixed(1)}%`,
        avgOverall.toFixed(1),
        avgEngagement.toFixed(1),
        avgCareer.toFixed(1),
        avgManager.toFixed(1),
        avgWellbeing.toFixed(1),
        avgMobility.toFixed(1),
      ]);
    }
  });

  const riskSheet = XLSX.utils.aoa_to_sheet(riskData);
  workbook.SheetNames.push('Risk Analysis');
  workbook.Sheets['Risk Analysis'] = riskSheet;

  // 5. Benchmarking Sheet
  if (data.benchmarks) {
    const benchmarkData = [
      [
        'Dimension',
        'Your Score',
        'Global Average',
        'Industry Average',
        'Global Percentile',
        'Industry Percentile',
        'Global P25',
        'Global P50',
        'Global P75',
        'Global P90',
      ],
    ];

    const dimensions = [
      {
        name: 'Overall',
        yourScore: data.metadata.averageScore,
        global: data.benchmarks.global.overallScore,
        industry: data.benchmarks.industry?.overallScore,
      },
      {
        name: 'Work Engagement',
        yourScore: getAverageDimension(data.workers, 'workEngagement'),
        global: data.benchmarks.global.workEngagement,
        industry: data.benchmarks.industry?.workEngagement,
      },
      {
        name: 'Career Alignment',
        yourScore: getAverageDimension(data.workers, 'careerAlignment'),
        global: data.benchmarks.global.careerAlignment,
        industry: data.benchmarks.industry?.careerAlignment,
      },
      {
        name: 'Manager Relationship',
        yourScore: getAverageDimension(data.workers, 'managerRelationship'),
        global: data.benchmarks.global.managerRelationship,
        industry: data.benchmarks.industry?.managerRelationship,
      },
      {
        name: 'Personal Wellbeing',
        yourScore: getAverageDimension(data.workers, 'personalWellbeing'),
        global: data.benchmarks.global.personalWellbeing,
        industry: data.benchmarks.industry?.personalWellbeing,
      },
      {
        name: 'Job Mobility',
        yourScore: getAverageDimension(data.workers, 'jobMobility'),
        global: data.benchmarks.global.jobMobility,
        industry: data.benchmarks.industry?.jobMobility,
      },
    ];

    dimensions.forEach((dim) => {
      benchmarkData.push([
        dim.name,
        dim.yourScore.toFixed(1),
        dim.global.toFixed(1),
        dim.industry?.toFixed(1) || 'N/A',
        getPercentile(dim.yourScore, data.benchmarks!.global.percentiles),
        dim.industry ? getPercentile(dim.yourScore, data.benchmarks!.industry!.percentiles) : 'N/A',
        data.benchmarks!.global.percentiles.p25.toFixed(1),
        data.benchmarks!.global.percentiles.p50.toFixed(1),
        data.benchmarks!.global.percentiles.p75.toFixed(1),
        data.benchmarks!.global.percentiles.p90.toFixed(1),
      ]);
    });

    const benchmarkSheet = XLSX.utils.aoa_to_sheet(benchmarkData);
    workbook.SheetNames.push('Benchmarking');
    workbook.Sheets['Benchmarking'] = benchmarkSheet;
  }

  // 6. Raw Data Sheet (for advanced analysis)
  const rawData = [
    [
      'Worker ID',
      'User ID',
      'Worker Name',
      'Department',
      'Location',
      'Overall Score',
      'Work Engagement',
      'Career Alignment',
      'Manager Relationship',
      'Personal Wellbeing',
      'Job Mobility',
      'Risk Level',
      'Trend',
      'Flags',
      'Last Updated',
      'Supervisor',
      'Team',
      'AI Summary',
      'Last Survey Response',
      'Recommended Action',
    ],
  ];

  data.workers.forEach((worker) => {
    rawData.push([
      worker.id,
      worker.userId,
      worker.userName,
      worker.department,
      worker.location,
      worker.overallScore.toString(),
      worker.workEngagement.toString(),
      worker.careerAlignment.toString(),
      worker.managerRelationship.toString(),
      worker.personalWellbeing.toString(),
      worker.jobMobility.toString(),
      worker.riskLevel,
      worker.trend,
      worker.flags.join(';'),
      worker.lastUpdated,
      worker.supervisor || '',
      worker.team || '',
      worker.aiSummary || '',
      worker.lastSurveyResponse || '',
      worker.recommendedAction || '',
    ]);
  });

  const rawSheet = XLSX.utils.aoa_to_sheet(rawData);
  workbook.SheetNames.push('Raw Data');
  workbook.Sheets['Raw Data'] = rawSheet;

  // 7. Metadata Sheet
  const metadataData = [
    ['Report Metadata', ''],
    ['Customer Name', customerName],
    ['Generated At', data.metadata.generatedAt],
    ['Total Workers', data.metadata.totalWorkers.toString()],
    ['Average Score', data.metadata.averageScore.toFixed(1)],
    ['', ''],
    ['Filters Applied', ''],
    ['Department', data.filters.department || 'All'],
    ['Location', data.filters.location || 'All'],
    ['Time Range', data.filters.timeRange || 'All'],
    ['', ''],
    ['Baseline Information', ''],
    ['Baseline Overall Score', data.baseline.overallScore.toFixed(1)],
    ['Baseline Worker Count', data.baseline.workerCount.toString()],
    ['Baseline Date Range', `${data.baseline.dateRange.start} to ${data.baseline.dateRange.end}`],
    ['', ''],
    ['Benchmark Information', ''],
    ['Global Benchmark Available', data.benchmarks ? 'Yes' : 'No'],
    ['Industry Benchmark Available', data.benchmarks?.industry ? 'Yes' : 'No'],
    data.benchmarks?.industry
      ? ['Industry Name', data.benchmarks.industry.industryName || 'Unknown']
      : ['', ''],
    data.benchmarks?.industry
      ? ['Industry Code', data.benchmarks.industry.industryCode || 'Unknown']
      : ['', ''],
  ].filter((row) => row[0] !== '');

  const metadataSheet = XLSX.utils.aoa_to_sheet(metadataData);
  workbook.SheetNames.push('Metadata');
  workbook.Sheets['Metadata'] = metadataSheet;

  // Generate and download the file
  const fileName = `JSI_Report_${customerName.replace(/[^a-zA-Z0-9]/g, '_')}_${
    new Date().toISOString().split('T')[0]
  }.xlsx`;
  XLSX.writeFile(workbook, fileName);
};
