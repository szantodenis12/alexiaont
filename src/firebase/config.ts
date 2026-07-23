import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import { getStorage } from 'firebase/storage';

const firebaseConfig = {
  apiKey: "AIzaSyC6KNLrEQAstVL85n-G97Kwumhs8t8ZKYg",
  authDomain: "xiagraduationalbums.firebaseapp.com",
  projectId: "xiagraduationalbums",
  storageBucket: "xiagraduationalbums.firebasestorage.app",
  messagingSenderId: "563555828970",
  appId: "1:563555828970:web:22d56b8c303eac67a70393",
  measurementId: "G-80H7TFHJ1V"
};

// Initialize Firebase
const app = initializeApp(firebaseConfig);

// Initialize Services
export const auth = getAuth(app);
export const db = getFirestore(app, "xiacollection");
export const storage = getStorage(app);

export default app;
