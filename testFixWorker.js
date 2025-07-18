const { getFunctions, httpsCallable } = require('firebase/functions');
const { initializeApp } = require('firebase/app');

// Firebase config
const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);
const functions = getFunctions(app);

async function testFixWorker() {
  try {
    console.log('Calling fixWorkerTenantIds function...');
    
    const fixWorkerTenantIds = httpsCallable(functions, 'fixWorkerTenantIds');
    const result = await fixWorkerTenantIds();
    
    console.log('Function result:', result.data);
    
  } catch (error) {
    console.error('Error calling function:', error);
  }
}

testFixWorker(); 