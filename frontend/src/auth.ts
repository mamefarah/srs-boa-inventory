import { initializeApp, type FirebaseApp } from 'firebase/app';
import {
  browserPopupRedirectResolver,
  browserSessionPersistence,
  GoogleAuthProvider,
  initializeAuth,
  onAuthStateChanged,
  signInWithPopup,
  signOut,
  type Auth,
  type User,
} from 'firebase/auth';

/**
 * Firebase web configuration comes from build-time environment variables
 * (VITE_FIREBASE_*). These values are public client identifiers, not secrets, but
 * they are environment-specific and are therefore not committed to the repository.
 */
const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY as string | undefined,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN as string | undefined,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID as string | undefined,
  appId: import.meta.env.VITE_FIREBASE_APP_ID as string | undefined,
};

export const authConfigured = Boolean(config.apiKey && config.authDomain && config.projectId && config.appId);

let app: FirebaseApp | undefined;
let auth: Auth | undefined;
function getFirebaseAuth(): Auth {
  if (!authConfigured) throw new Error('Firebase web configuration is missing');
  app ??= initializeApp(config);
  // Session-scoped persistence: warehouse devices may be shared, so a sign-in does not
  // survive closing the browser tab/window.
  auth ??= initializeAuth(app, { persistence: browserSessionPersistence, popupRedirectResolver: browserPopupRedirectResolver });
  return auth;
}

export function watchUser(cb: (u: User | null) => void): () => void {
  if (!authConfigured) {
    cb(null);
    return () => undefined;
  }
  // Sign-in/sign-out transitions only; hourly token refreshes do not re-sync the profile.
  return onAuthStateChanged(getFirebaseAuth(), cb);
}

export async function signInWithGoogle(): Promise<void> {
  await signInWithPopup(getFirebaseAuth(), new GoogleAuthProvider());
}

export async function signOutUser(): Promise<void> {
  if (authConfigured) await signOut(getFirebaseAuth());
}

/** Current ID token, managed by the Firebase SDK (session storage); this app never copies it elsewhere. */
export async function currentIdToken(): Promise<string | null> {
  if (!authConfigured) return null;
  const u = getFirebaseAuth().currentUser;
  return u ? u.getIdToken() : null;
}
