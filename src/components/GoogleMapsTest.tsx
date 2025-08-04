import React, { useEffect, useState } from 'react';
import { Box, Typography, Alert } from '@mui/material';

const GoogleMapsTest: React.FC = () => {
  const [apiStatus, setApiStatus] = useState<'loading' | 'loaded' | 'error'>('loading');
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const checkGoogleMapsAPI = () => {
      // Check if Google Maps API is loaded
      if (typeof window !== 'undefined' && window.google && window.google.maps) {
        console.log('Google Maps API is loaded successfully');
        console.log('Available services:', Object.keys(window.google.maps));
        setApiStatus('loaded');
      } else {
        console.log('Google Maps API is not loaded');
        setApiStatus('error');
        setError('Google Maps API is not available');
      }
    };

    // Check immediately
    checkGoogleMapsAPI();

    // Check again after a delay in case it's still loading
    const timer = setTimeout(checkGoogleMapsAPI, 2000);

    return () => clearTimeout(timer);
  }, []);

  return (
    <Box sx={{ p: 2 }}>
      <Typography variant="h6" gutterBottom>
        Google Maps API Test
      </Typography>
      
      {apiStatus === 'loading' && (
        <Alert severity="info">
          Checking Google Maps API status...
        </Alert>
      )}
      
      {apiStatus === 'loaded' && (
        <Alert severity="success">
          Google Maps API is loaded successfully!
        </Alert>
      )}
      
      {apiStatus === 'error' && (
        <Alert severity="error">
          {error}
        </Alert>
      )}
      
      <Typography variant="body2" sx={{ mt: 2 }}>
        Environment variable: {process.env.REACT_APP_GOOGLE_MAPS_API_KEY ? 'Set' : 'Not set'}
      </Typography>
    </Box>
  );
};

export default GoogleMapsTest; 