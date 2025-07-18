const { initializeApp } = require('firebase/app');
const { getFunctions, httpsCallable } = require('firebase/functions');

const firebaseConfig = {
  apiKey: 'AIzaSyBQA9bc25_7ncjvY75nAtIUv47C3w5jl6c',
  authDomain: 'hrx1-d3beb.firebaseapp.com',
  projectId: 'hrx1-d3beb',
  storageBucket: 'hrx1-d3beb.firebasestorage.app',
  messagingSenderId: '143752240496',
  appId: '1:143752240496:web:e0b584983d4b04cb3983b5',
  measurementId: 'G-LL20QKNT0W',
};

const app = initializeApp(firebaseConfig);
const functions = getFunctions(app, 'us-central1');
const inviteUser = httpsCallable(functions, 'inviteUser');

inviteUser({ email: 'test@example.com' })
  .then((result) => {
    console.log('Success:', result);
  })
  .catch((err) => {
    console.error('Error:', err);
  }); 