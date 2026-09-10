import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { doc, onSnapshot, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import {
  ProductCategory, productCategoriesDocPath, readProductCategories,
  upsertProductCategory, removeProductCategory, slugifyProductCategory,
} from '../lib/productCategoryStore';
import { Tags, Plus, Trash2, Edit2, X } from 'lucide-react';
import { motion } from 'motion/react';

const COLORS = ['#8b5cf6', '#ec4899', '#ef4444', '#f59e0b', '#10b981', '#0ea5e9', '#6366f1', '#64748b'];

export const Categorias: React.FC = () => {
  const { entities } = useEntity();
  const { showToast, confirm } = useUI();
  const [entityId, setEntityId] = useState('');
  const [cats, setCats] = useState<ProductCategory[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [editing, setEditing] = useState<ProductCategory | null>(null);
  const [name, setName] = useState('');
  const [color, setColor] = useState(COLORS[0]);

  // Seleciona a 1ª entidade por padrão.
  useEffect(() => {
    if (!entityId && entities.length) setEntityId(entities[0].id);
  }, [entities, entityId]);

  // Carrega as categorias da entidade selecionada.
  useEffect(() => {
    if (!entityId) { setCats([]); return; }
    const unsub = onSnapshot(doc(db, productCategoriesDocPath(entityId)), (snap) => {
      setCats(readProductCategories(snap.data()));
    }, () => setCats([]));
    return () => unsub();
  }, [entityId]);

  const persist = async (next: ProductCategory[]) => {
    await setDoc(doc(db, productCategoriesDocPath(entityId)), { items: next, updatedAt: serverTimestamp() }, { merge: true });
  };

  const openNew = () => { setEditing(null); setName(''); setColor(COLORS[0]); setIsOpen(true); };
  const openEdit = (c: ProductCategory) => { setEditing(c); setName(c.name); setColor(c.color || COLORS[0]); setIsOpen(true); };

  const save = async (e: React.FormEvent) => {
    e.preventDefault();
    const nome = name.trim();
    if (!nome) { showToast('Dê um nome à categoria.', 'error'); return; }
    const id = editing?.id || slugifyProductCategory(nome);
    if (!id) { showToast('Nome inválido.', 'error'); return; }
    if (!editing && cats.some(c => c.id === id)) { showToast('Já existe uma categoria com esse nome.', 'error'); return; }
    const cat: ProductCategory = { id, name: nome, color, order: editing?.order ?? cats.length };
    try {
      await persist(upsertProductCategory(cats, cat));
      setIsOpen(false);
      showToast(`Categoria ${editing ? 'atualizada' : 'criada'}!`, 'success');
    } catch (error) { console.error(error); showToast('Erro ao salvar a categoria.', 'error'); }
  };

  const del = async (c: ProductCategory) => {
    const ok = await confirm({ title: 'Excluir categoria', message: `Excluir "${c.name}"? Os produtos que a usam continuam, mas sem categoria vinculada.`, variant: 'danger' });
    if (!ok) return;
    try { await persist(removeProductCategory(cats, c.id)); showToast('Categoria excluída.', 'success'); }
    catch (error) { console.error(error); showToast('Erro ao excluir.', 'error'); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-950/50"><Tags className="h-7 w-7" /></div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-content">Categorias</h2>
            <p className="text-sm text-content-subtle">Organize os produtos por categoria.</p>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <select value={entityId} onChange={e => setEntityId(e.target.value)} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20">
            {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
          </select>
          <button onClick={openNew} className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700"><Plus className="h-4 w-4" /> Nova</button>
        </div>
      </div>

      {cats.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhuma categoria ainda. Crie a primeira (ex.: Cartões, Banners, Peças 3D...).</p>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {cats.map(c => (
            <div key={c.id} className="group flex items-center justify-between rounded-xl border border-line bg-surface p-4">
              <div className="flex items-center gap-3">
                <span className="h-8 w-8 rounded-lg" style={{ backgroundColor: c.color || '#8b5cf6' }} />
                <span className="font-bold text-content">{c.name}</span>
              </div>
              <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                <button onClick={() => openEdit(c)} className="rounded-lg p-2 text-content-subtle hover:text-primary"><Edit2 className="h-4 w-4" /></button>
                <button onClick={() => del(c)} className="rounded-lg p-2 text-content-subtle hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
              </div>
            </div>
          ))}
        </div>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-surface shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-line p-6"><h3 className="text-lg font-bold text-content">{editing ? 'Editar categoria' : 'Nova categoria'}</h3>
              <button onClick={() => setIsOpen(false)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted"><X className="h-5 w-5" /></button></div>
            <form onSubmit={save} className="space-y-4 p-6">
              <div><label className="block text-sm font-medium text-content-muted">Nome</label>
                <input autoFocus value={name} onChange={e => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="Ex: Cartões, Banners..." /></div>
              <div><label className="block text-sm font-medium text-content-muted">Cor</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {COLORS.map(cl => (
                    <button key={cl} type="button" onClick={() => setColor(cl)} className="h-8 w-8 rounded-lg ring-2 ring-offset-2 ring-offset-surface transition-all" style={{ backgroundColor: cl, boxShadow: color === cl ? `0 0 0 2px ${cl}` : 'none', ...(color === cl ? {} : { }) }} data-active={color === cl} />
                  ))}
                </div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsOpen(false)} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-content-muted hover:bg-canvas">Cancelar</button>
                <button type="submit" className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">{editing ? 'Salvar' : 'Criar'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
