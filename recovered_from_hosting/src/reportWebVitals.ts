import { ReportHandler } from 'web-vitals';

import { logEvent } from 'firebase/analytics';
import { analytics } from './firebase';

const reportWebVitals = (onPerfEntry?: ReportHandler) => {
  if (onPerfEntry && onPerfEntry instanceof Function) {
    import('web-vitals').then(({ getCLS, getFID, getFCP, getLCP, getTTFB }) => {
      getCLS((metric) => {
        onPerfEntry(metric);
        // Send to Firebase Analytics
        if (analytics) {
          logEvent(analytics, 'web_vitals', {
            metric_name: 'CLS',
            value: metric.value,
          });
        }
      });
      getFID((metric) => {
        onPerfEntry(metric);
        if (analytics) {
          logEvent(analytics, 'web_vitals', {
            metric_name: 'FID',
            value: metric.value,
          });
        }
      });
      getFCP((metric) => {
        onPerfEntry(metric);
        if (analytics) {
          logEvent(analytics, 'web_vitals', {
            metric_name: 'FCP',
            value: metric.value,
          });
        }
      });
      getLCP((metric) => {
        onPerfEntry(metric);
        if (analytics) {
          logEvent(analytics, 'web_vitals', {
            metric_name: 'LCP',
            value: metric.value,
          });
        }
      });
      getTTFB((metric) => {
        onPerfEntry(metric);
        if (analytics) {
          logEvent(analytics, 'web_vitals', {
            metric_name: 'TTFB',
            value: metric.value,
          });
        }
      });
    });
  }
};

export default reportWebVitals;
