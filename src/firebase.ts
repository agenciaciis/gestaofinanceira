import { initializeApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';
import { getFirestore } from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';

const app = initializeApp(firebaseConfig);
export const db = getFirestore(app, firebaseConfig.firestoreDatabaseId);
export const auth = getAuth(app);

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
    userId: string | undefined;
    email: string | null | undefined;
    emailVerified: boolean | undefined;
    isAnonymous: boolean | undefined;
    tenantId: string | null | undefined;
    providerInfo: {
      providerId: string;
      displayName: string | null;
      email: string | null;
      photoUrl: string | null;
    }[];
  }
}

export function handleFirestoreError(error: unknown, operationType: OperationType, path: string | null) {
  const errInfo: FirestoreErrorInfo = {
    error: error instanceof Error ? error.message : String(error),
    authInfo: {
      userId: auth.currentUser?.uid,
      email: auth.currentUser?.email,
      emailVerified: auth.currentUser?.emailVerified,
      isAnonymous: auth.currentUser?.isAnonymous,
      tenantId: auth.currentUser?.tenantId,
      providerInfo: auth.currentUser?.providerData.map(provider => ({
        providerId: provider.providerId,
        displayName: provider.displayName,
        email: provider.email,
        photoUrl: provider.photoURL
      })) || []
    },
    operationType,
    path
  }
  // IMPORTANTE: esta função é chamada SOMENTE em callbacks de erro do
  // onSnapshot (leituras). Lançar aqui virava uma exceção não tratada dentro do
  // callback assíncrono e podia desestabilizar/derrubar a tela — por exemplo,
  // quando a regra de uma subcoleção (ex.: `goals`) ainda não foi publicada e o
  // Firestore devolve permission-denied. Então a política é: LOGAR e seguir com
  // dados vazios daquela coleção, nunca derrubar a UI.
  const code = (error as { code?: string } | null | undefined)?.code;
  if (code === 'permission-denied') {
    console.warn(
      `Firestore: sem permissão para "${operationType}" em "${path}". ` +
      `Provável regra ainda não publicada (firebase deploy --only firestore:rules). Seguindo sem esses dados.`
    );
    return;
  }
  console.error('Firestore Error: ', JSON.stringify(errInfo));
}
