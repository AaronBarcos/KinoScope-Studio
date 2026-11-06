'use client';

import { initializeApp, getApps, getApp } from 'firebase/app';
import {
  getAuth,
  GoogleAuthProvider,
  signInWithPopup,
  signInAnonymously,
  signOut,
} from 'firebase/auth';
import { doc, getDocFromServer, getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = getApps().length > 0 ? getApp() : initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

// Validate connection to Firestore on boot without triggering a 403 Permission Denied on /test/connection
let connectionTested = false;
export async function testFirestoreConnection(): Promise<void> {
  if (typeof window === 'undefined' || connectionTested) return;
  connectionTested = true;
  if (!auth.currentUser) return;
  try {
    await getDocFromServer(doc(db, 'analyses', `ping_${auth.currentUser.uid}`));
  } catch (error) {
    if (error instanceof Error && error.message.includes('the client is offline')) {
      console.error('Please check your Firebase configuration.');
    }
  }
}

export enum OperationType {
  CREATE = 'create',
  UPDATE = 'update',
  DELETE = 'delete',
  LIST = 'list',
  GET = 'get',
  WRITE = 'write',
}

export interface FirestoreErrorInfo {
  error: string;
  operationType: OperationType;
  path: string | null;
  authInfo: {
    userId?: string | null;
    email?: string | null;
    emailVerified?: boolean | null;
    isAnonymous?: boolean | null;
    tenantId?: string | null;
    providerInfo?: {
      providerId?: string | null;
      email?: string | null;
    }[];
  };
}

export function isPermissionDeniedError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code || '';
  return (
    code === 'permission-denied' ||
    code === 'firestore/permission-denied' ||
    msg.includes('Missing or insufficient permissions') ||
    msg.includes('PERMISSION_DENIED') ||
    msg.includes('403')
  );
}

export function isUnauthorizedDomainError(error: unknown): boolean {
  const msg = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: string })?.code || '';
  return (
    code === 'auth/unauthorized-domain' ||
    msg.includes('auth/unauthorized-domain') ||
    msg.includes('unauthorized-domain')
  );
}

export function handleFirestoreError(
  error: unknown,
  operationType: OperationType,
  path: string | null
): FirestoreErrorInfo {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo:
        auth.currentUser?.providerData?.map((provider) => ({
          providerId: provider.providerId,
          email: provider.email,
        })) || [],
    },
    operationType,
    path,
  };
  console.warn('Firestore notice (fallback to local storage active):', JSON.stringify(errInfo));
  return errInfo;
}

export async function signInWithGooglePopup() {
  const provider = new GoogleAuthProvider();
  try {
    return await signInWithPopup(auth, provider);
  } catch (error: unknown) {
    if (isUnauthorizedDomainError(error)) {
      try {
        return await signInAnonymously(auth);
      } catch {
        const domain =
          typeof window !== 'undefined' ? window.location.hostname : 'localhost';
        throw new Error(
          `El dominio "${domain}" no está autorizado para Google Sign-In en este proyecto de Firebase (auth/unauthorized-domain). Tus análisis y vídeos funcionan al 100% en modo local. Para habilitar el login en localhost, añade "${domain}" en Firebase Console > Authentication > Settings > Authorized domains (sin http:// ni puerto).`
        );
      }
    }
    throw error;
  }
}

export async function signOutFirebaseUser() {
  return signOut(auth);
}
