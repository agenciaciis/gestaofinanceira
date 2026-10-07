import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, User as FirebaseUser, signInWithEmailAndPassword, createUserWithEmailAndPassword, EmailAuthProvider, reauthenticateWithCredential, updatePassword } from 'firebase/auth';
import { doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { User } from '../types';

interface AuthContextType {
  user: User | null;
  loading: boolean;
  login: () => Promise<void>;
  loginWithEmail: (email: string, pass: string) => Promise<void>;
  registerWithEmail: (email: string, pass: string) => Promise<void>;
  logout: () => Promise<void>;
  /** Troca a senha exigindo a senha atual (reautenticação). Só p/ contas e-mail/senha. */
  changePassword: (currentPass: string, newPass: string) => Promise<void>;
  /** Encerra a sessão em TODOS os outros dispositivos, mantendo este. */
  signOutOtherDevices: () => Promise<void>;
  /** `true` se a conta usa e-mail/senha (Google não tem senha p/ trocar). */
  hasPasswordProvider: boolean;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

export const AuthProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('AuthContext: Initializing onAuthStateChanged');
    const unsubscribe = onAuthStateChanged(auth, async (firebaseUser) => {
      console.log('AuthContext: Auth state changed', firebaseUser ? 'User logged in' : 'No user');
      if (firebaseUser) {
        const userDocRef = doc(db, 'users', firebaseUser.uid);
        const userDoc = await getDoc(userDocRef);
        
        const userData: User = {
          uid: firebaseUser.uid,
          email: firebaseUser.email!,
          displayName: firebaseUser.displayName || undefined,
          photoURL: firebaseUser.photoURL || undefined,
          role: userDoc.exists() ? userDoc.data().role : 'user'
        };

        if (!userDoc.exists()) {
          // Firestore doesn't accept undefined values, use null or omit
          const dbData = {
            uid: userData.uid,
            email: userData.email,
            displayName: userData.displayName || null,
            photoURL: userData.photoURL || null,
            role: 'user',
            createdAt: serverTimestamp(),
          };
          await setDoc(userDocRef, dbData);
        }

        setUser(userData);
      } else {
        setUser(null);
      }
      setLoading(false);
    });

    return () => unsubscribe();
  }, []);

  const login = async () => {
    const provider = new GoogleAuthProvider();
    await signInWithPopup(auth, provider);
  };

  const loginWithEmail = async (email: string, pass: string) => {
    await signInWithEmailAndPassword(auth, email, pass);
  };

  const registerWithEmail = async (email: string, pass: string) => {
    await createUserWithEmailAndPassword(auth, email, pass);
  };

  const logout = async () => {
    await signOut(auth);
  };

  // Troca de senha: reautentica com a senha atual (o Firebase exige login
  // recente) e então aplica a nova. Erros do Firebase sobem pra UI tratar.
  const changePassword = async (currentPass: string, newPass: string) => {
    const fbUser = auth.currentUser;
    if (!fbUser || !fbUser.email) throw new Error('Sessão inválida. Entre novamente.');
    const cred = EmailAuthProvider.credential(fbUser.email, currentPass);
    await reauthenticateWithCredential(fbUser, cred);
    await updatePassword(fbUser, newPass);
  };

  // Desconecta os outros dispositivos: o servidor revoga os refresh tokens da
  // conta; em seguida renovamos o token DESTE aparelho pra ele continuar logado.
  const signOutOtherDevices = async () => {
    const fbUser = auth.currentUser;
    if (!fbUser) throw new Error('Sessão inválida. Entre novamente.');
    const token = await fbUser.getIdToken();
    const resp = await fetch('/api/auth/revoke-other-sessions', {
      method: 'POST',
      headers: { Authorization: `Bearer ${token}` },
    });
    if (!resp.ok) {
      const detail = await resp.json().catch(() => ({}));
      throw new Error(detail?.error || 'Não consegui desconectar os outros dispositivos.');
    }
    // Renova o token deste aparelho (issued after revoke) para não cair junto.
    await fbUser.getIdToken(true);
  };

  const hasPasswordProvider = !!auth.currentUser?.providerData.some(p => p.providerId === 'password');

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithEmail, registerWithEmail, logout, changePassword, signOutOtherDevices, hasPasswordProvider }}>
      {children}
    </AuthContext.Provider>
  );
};

export const useAuth = () => {
  const context = useContext(AuthContext);
  if (context === undefined) {
    throw new Error('useAuth must be used within an AuthProvider');
  }
  return context;
};
