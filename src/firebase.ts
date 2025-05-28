import { initializeApp } from "firebase/app";
import { getFirestore } from "firebase/firestore";
import { getAuth } from "firebase/auth";
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyD-VVEdpoYSW43XwBk025Doq5iCJ3z1FuY",
  authDomain: "hrxone-5c786.firebaseapp.com",
  projectId: "hrxone-5c786",
  storageBucket: "hrxone-5c786.firebasestorage.app",
  messagingSenderId: "676143815605",
  appId: "1:676143815605:web:e32c650012da9e126e97fc",
  measurementId: "G-V7G1D4KLMT"
};

const app = initializeApp(firebaseConfig);

export const db = getFirestore(app);
export const auth = getAuth(app);
export const storage = getStorage(app);