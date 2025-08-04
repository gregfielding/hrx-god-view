// Browser-based Google Maps API test
// Run this in the browser console

console.log('=== Browser Google Maps API Test ===');

// Check if Google Maps API is loaded
if (typeof window !== 'undefined' && window.google && window.google.maps) {
  console.log('✅ Google Maps API is loaded');
  console.log('Available services:', Object.keys(window.google.maps));
  
  // Check if Places service is available
  if (window.google.maps.places) {
    console.log('✅ Places service is available');
  } else {
    console.log('❌ Places service is not available');
  }
  
  // Check if Autocomplete is available
  if (window.google.maps.places.Autocomplete) {
    console.log('✅ Autocomplete is available');
  } else {
    console.log('❌ Autocomplete is not available');
  }
} else {
  console.log('❌ Google Maps API is not loaded');
  console.log('window.google:', window.google);
}

// Check environment variable
console.log('Environment variable available:', !!process.env.REACT_APP_GOOGLE_MAPS_API_KEY);

// Test creating an Autocomplete instance
if (typeof window !== 'undefined' && window.google && window.google.maps && window.google.maps.places) {
  try {
    // Create a dummy input element
    const dummyInput = document.createElement('input');
    dummyInput.type = 'text';
    dummyInput.id = 'test-autocomplete';
    document.body.appendChild(dummyInput);
    
    // Try to create an Autocomplete instance
    const autocomplete = new window.google.maps.places.Autocomplete(dummyInput);
    console.log('✅ Autocomplete instance created successfully');
    
    // Clean up
    document.body.removeChild(dummyInput);
  } catch (error) {
    console.log('❌ Failed to create Autocomplete instance:', error);
  }
}

console.log('=== Test Complete ==='); 