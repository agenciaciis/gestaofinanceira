/**
 * Carrega as categorias personalizadas (compartilhadas) de TODAS as entidades do
 * usuário e devolve a lista unida. Usado nas telas que exibem nome de categoria
 * (Relatórios, Orçamentos) para que categorias criadas pelo usuário apareçam com
 * o nome certo, e não caiam em "Outros".
 */
import { useEffect, useState } from 'react';
import { onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { useEntity } from '../contexts/EntityContext';
import { CustomCategory, categoriesDocPath, readCustomCategories, mergeCustomCategories } from '../lib/categoryStore';

export function useCustomCategories(): CustomCategory[] {
  const { entities } = useEntity();
  const [byEntity, setByEntity] = useState<Record<string, CustomCategory[]>>({});

  const ids = entities.map(e => e.id).join(',');
  useEffect(() => {
    if (!entities.length) { setByEntity({}); return; }
    const unsubs = entities.map(e =>
      onSnapshot(
        doc(db, categoriesDocPath(e.id)),
        snap => setByEntity(prev => ({ ...prev, [e.id]: readCustomCategories(snap.data()) })),
        () => { /* silencioso: doc pode não existir ainda */ }
      )
    );
    return () => unsubs.forEach(u => u());
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ids]);

  return mergeCustomCategories(...(Object.values(byEntity) as CustomCategory[][]));
}
