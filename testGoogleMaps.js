// Test Google Maps API functionality
const apiKey = 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c';

// Test 1: Check if the API key is accessible
console.log('Testing Google Maps API...');
console.log('API Key available:', !!apiKey);

// Test 2: Test Places Autocomplete API
async function testPlacesAutocomplete() {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/place/autocomplete/json?input=test&key=${apiKey}&types=address`
    );
    const data = await response.json();
    console.log('Places Autocomplete API response:', data);
    return data.status === 'OK';
  } catch (error) {
    console.error('Places Autocomplete API error:', error);
    return false;
  }
}

// Test 3: Test Geocoding API
async function testGeocoding() {
  try {
    const response = await fetch(
      `https://maps.googleapis.com/maps/api/geocode/json?address=test&key=${apiKey}`
    );
    const data = await response.json();
    console.log('Geocoding API response:', data);
    return data.status === 'OK';
  } catch (error) {
    console.error('Geocoding API error:', error);
    return false;
  }
}

// Run tests
async function runTests() {
  console.log('=== Google Maps API Tests ===');
  
  const placesTest = await testPlacesAutocomplete();
  console.log('Places Autocomplete test:', placesTest ? 'PASSED' : 'FAILED');
  
  const geocodingTest = await testGeocoding();
  console.log('Geocoding test:', geocodingTest ? 'PASSED' : 'FAILED');
  
  console.log('=== Tests Complete ===');
}

runTests(); 