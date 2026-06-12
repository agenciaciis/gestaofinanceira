import React, { createContext, useContext, useEffect, useState } from 'react';
import { collection, query, where, onSnapshot, addDoc, serverTimestamp, or } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { useAuth } from './AuthContext';
import { Entity } from '../types';

export type FilterType = 'PF' | 'PJ' | 'ALL';

interface EntityContextType {
  entities: Entity[];
  filterType: FilterType;
  setFilterType: (filter: FilterType) => void;
  selectedEntity: Entity | null; // Used for creating new records
  setSelectedEntity: (entity: Entity | null) => void;
  loading: boolean;
  createEntity: (name: string, type: 'PF' | 'PJ') => Promise<void>;
  updateEntity: (id: string, data: Partial<Entity>) => Promise<void>;
  addCollaborator: (entityId: string, email: string, role: 'admin' | 'viewer') => Promise<void>;
  removeCollaborator: (entityId: string, email: string) => Promise<void>;
}

const EntityContext = createContext<EntityContextType | undefined>(undefined);

export const EntityProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const { user } = useAuth();
  const [entities, setEntities] = useState<Entity[]>([]);
  const [filterType, setFilterType] = useState<FilterType>('ALL');
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    console.log('EntityContext: useEffect triggered', { userUid: user?.uid });
    if (!user) {
      setEntities([]);
      setSelectedEntity(null);
      setLoading(false);
      return;
    }

    console.log('EntityContext: Subscribing to entities');
    
    // Split queries to ensure compatibility with security rules and avoid OR query limitations
    const qOwner = query(collection(db, 'entities'), where('ownerUid', '==', user.uid));
    const qCollaborator = query(collection(db, 'entities'), where('collaboratorsEmails', 'array-contains', user.email));

    let ownerEntities: Entity[] = [];
    let collaboratorEntities: Entity[] = [];

    const updateEntities = (ownerList: Entity[], collaboratorList: Entity[]) => {
      const combined = [...ownerList];
      collaboratorList.forEach(ce => {
        if (!combined.find(e => e.id === ce.id)) {
          combined.push(ce);
        }
      });
      // Sort by name or createdAt
      combined.sort((a, b) => (a.name || '').localeCompare(b.name || ''));
      setEntities(combined);
      
      if (combined.length > 0 && !selectedEntity) {
        setSelectedEntity(combined[0]);
      }
      setLoading(false);
    };

    const unsubOwner = onSnapshot(qOwner, (snapshot) => {
      ownerEntities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Entity));
      updateEntities(ownerEntities, collaboratorEntities);
    }, (error) => {
      console.error("EntityContext: Error fetching owner entities:", error);
      handleFirestoreError(error, OperationType.LIST, 'entities (owner)');
    });

    const unsubCollaborator = onSnapshot(qCollaborator, (snapshot) => {
      collaboratorEntities = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() } as Entity));
      updateEntities(ownerEntities, collaboratorEntities);
    }, (error) => {
      console.error("EntityContext: Error fetching collaborator entities:", error);
      handleFirestoreError(error, OperationType.LIST, 'entities (collaborator)');
      // We still update with owner entities so the app doesn't hang
      updateEntities(ownerEntities, collaboratorEntities);
    });

    return () => {
      unsubOwner();
      unsubCollaborator();
    };
  }, [user]);

  const createEntity = async (name: string, type: 'PF' | 'PJ') => {
    if (!user) return;
    await addDoc(collection(db, 'entities'), {
      name,
      type,
      ownerUid: user.uid,
      createdAt: serverTimestamp(),
      collaborators: [],
      collaboratorsEmails: [],
    });
  };

  const updateEntity = async (id: string, data: Partial<Entity>) => {
    const { doc, updateDoc } = await import('firebase/firestore');
    await updateDoc(doc(db, 'entities', id), data);
  };

  const addCollaborator = async (entityId: string, email: string, role: 'admin' | 'viewer') => {
    const { doc, updateDoc, arrayUnion } = await import('firebase/firestore');
    const entity = entities.find(e => e.id === entityId);
    if (!entity) return;

    await updateDoc(doc(db, 'entities', entityId), {
      collaborators: arrayUnion({
        email: email,
        role,
        addedAt: new Date().toISOString()
      }),
      collaboratorsEmails: arrayUnion(email)
    });
  };

  const removeCollaborator = async (entityId: string, email: string) => {
    const { doc, updateDoc, arrayRemove } = await import('firebase/firestore');
    const entity = entities.find(e => e.id === entityId);
    if (!entity) return;

    const collaborator = entity.collaborators?.find(c => c.email === email);
    if (!collaborator) return;

    await updateDoc(doc(db, 'entities', entityId), {
      collaborators: arrayRemove(collaborator),
      collaboratorsEmails: arrayRemove(email)
    });
  };

  return (
    <EntityContext.Provider value={{ 
      entities, 
      filterType, 
      setFilterType, 
      selectedEntity, 
      setSelectedEntity, 
      loading, 
      createEntity,
      updateEntity,
      addCollaborator,
      removeCollaborator
    }}>
      {children}
    </EntityContext.Provider>
  );
};

export const useEntity = () => {
  const context = useContext(EntityContext);
  if (context === undefined) {
    throw new Error('useEntity must be used within an EntityProvider');
  }
  return context;
};
