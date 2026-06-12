import React, { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut, User as FirebaseUser, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
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

  return (
    <AuthContext.Provider value={{ user, loading, login, loginWithEmail, registerWithEmail, logout }}>
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
