import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { analytics, safeLogEvent } from '../firebase';

/**
 * Component to track page views in Firebase Analytics
 * Should be placed inside the Router but outside Routes
 */
const PageViewTracker: React.FC = () => {
  const location = useLocation();

  useEffect(() => {
    safeLogEvent(analytics, 'page_view', {
      page_path: location.pathname,
      page_title: document.title,
      page_location: window.location.href,
    });
  }, [location.pathname]);

  return null;
};

export default PageViewTracker;

