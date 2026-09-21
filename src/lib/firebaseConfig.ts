/**
 * Firebase web config. These values are NOT secrets (they ship to every browser);
 * access is protected by Firestore security rules (see firestore.rules).
 *
 * Either paste your values below, or provide them at build time through the
 * VITE_FIREBASE_* environment variables (the GitHub Actions workflow does this).
 *
 * If apiKey/projectId are empty the app falls back to a browser-local demo leaderboard.
 */
const env = import.meta.env;

export const firebaseConfig = {
  apiKey: env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: env.VITE_FIREBASE_APP_ID ?? '',
};

export const firebaseConfigured = Boolean(firebaseConfig.apiKey && firebaseConfig.projectId);
