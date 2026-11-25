import { initializeApp, type FirebaseApp } from "firebase/app";
import { initializeAppCheck, ReCaptchaEnterpriseProvider } from "firebase/app-check";

// Firebase config comes from .env.local (see .env.example). The web apiKey in a
// Firebase config object is a public identifier, not a secret — but NEVER commit
// App Check debug tokens, service account keys, or .env files to the public repo.
const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

export const firebaseApp: FirebaseApp = initializeApp(firebaseConfig);

// Firebase AI Logic requires App Check. For local development, the debug
// provider is enabled BEFORE initializing App Check, using the token from
// .env.local (VITE_APPCHECK_DEBUG_TOKEN), which is registered in the Firebase
// console (App Check > Apps > Manage debug tokens). Production builds use the
// real Fraud Defense (reCAPTCHA Enterprise) provider with the site key below.
if (import.meta.env.DEV) {
  (self as unknown as { FIREBASE_APPCHECK_DEBUG_TOKEN: string | boolean }).FIREBASE_APPCHECK_DEBUG_TOKEN =
    import.meta.env.VITE_APPCHECK_DEBUG_TOKEN ?? true;
}

initializeAppCheck(firebaseApp, {
  // Fraud Defense (reCAPTCHA Enterprise) site key for project hookline-168e0,
  // registered in App Check on 25 Nov 2026. Site keys are public identifiers.
  provider: new ReCaptchaEnterpriseProvider("6Le60TEuAAAAAInOSSzV7hyazxStuSV-voOiL35T"),
  isTokenAutoRefreshEnabled: true,
});
