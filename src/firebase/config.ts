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
// (default) database: only holds the classStatus mirror read by storage.rules
export const defaultDb = getFirestore(app);
export const storage = getStorage(app);

// Separate Storage instance (same bucket) for the admin background transfers:
// photo uploads and the delete queue. The SDK only retries a failed request for
// 10 minutes (uploads) / 2 minutes (other operations) by default, so a laptop
// that slept or lost Wi-Fi for longer failed every file in flight. With a
// 6-hour window an interrupted upload simply carries on after wake-up, from the
// last uploaded chunk. Kept off the default instance so client pages (e.g. the
// voice upload in the configurator) still fail fast instead of hanging.
const TRANSFER_RETRY_MS = 6 * 60 * 60 * 1000;
export const transferStorage = getStorage(app, `gs://${firebaseConfig.storageBucket}`);
transferStorage.maxUploadRetryTime = TRANSFER_RETRY_MS;
transferStorage.maxOperationRetryTime = TRANSFER_RETRY_MS;

export default app;
