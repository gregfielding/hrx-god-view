import { ReportHandler } from 'web-vitals';

import { analytics, safeLogEvent } from './firebase';

const reportWebVitals = (onPerfEntry?: ReportHandler) => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
      getCLS((metric) => {
        onPerfEntry(metric);
        // Send to Firebase Analytics
        safeLogEvent(analytics, 'web_vitals', {
          metric_name: 'CLS',
          value: metric.value,
        });
      });
      getFID((metric) => {
        onPerfEntry(metric);
        safeLogEvent(analytics, 'web_vitals', {
          metric_name: 'FID',
          value: metric.value,
        });
      });
      getFCP((metric) => {
        onPerfEntry(metric);
        safeLogEvent(analytics, 'web_vitals', {
          metric_name: 'FCP',
          value: metric.value,
        });
      });
      getLCP((metric) => {
        onPerfEntry(metric);
        safeLogEvent(analytics, 'web_vitals', {
          metric_name: 'LCP',
          value: metric.value,
        });
      });
      getTTFB((metric) => {
        onPerfEntry(metric);
        safeLogEvent(analytics, 'web_vitals', {
          metric_name: 'TTFB',
          value: metric.value,
        });
      });
    });
  }
};

export default reportWebVitals;
