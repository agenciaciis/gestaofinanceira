import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, doc, updateDoc, deleteDoc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product } from '../types';
import { Boxes, Plus, Edit2, Trash2, X, AlertTriangle, ArrowUpRight, ArrowDownRight, History } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import {
  isLowStock, StockMovement, StockReason, STOCK_REASONS,
  stockMovementsDocPath, readMovements, appendMovement, applyDelta,
} from '../lib/stock';

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

export const Estoque: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { user } = useAuth();
  const { showToast, confirm } = useUI();
  const [items, setItems] = useState<Product[]>([]);
  const [movements, setMovements] = useState<Record<string, StockMovement[]>>({});
  const [tab, setTab] = useState<'produtos' | 'insumos' | 'mov'>('produtos');

  // Modal de insumo
  const [isInsumoOpen, setIsInsumoOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [inName, setInName] = useState('');
  const [inCategory, setInCategory] = useState('');
  const [inUnit, setInUnit] = useState('un');
  const [inCost, setInCost] = useState('');
  const [inStock, setInStock] = useState('');
  const [inMin, setInMin] = useState('');
  const [inEntity, setInEntity] = useState('');

  // Modal de ajuste
  const [adjItem, setAdjItem] = useState<Product | null>(null);
  const [adjDelta, setAdjDelta] = useState('');
  const [adjDir, setAdjDir] = useState<'in' | 'out'>('in');
  const [adjReason, setAdjReason] = useState<StockReason>('compra');
  const [adjNote, setAdjNote] = useState('');

  useEffect(() => {
    if (entities.length === 0) return;
    const filteredEntities = filterType === 'ALL' ? entities : entities.filter(e => e.type === filterType);
    const unsubscribes: (() => void)[] = [];
    let all: Product[] = [];
    filteredEntities.forEach(entity => {
      const q = query(collection(db, `entities/${entity.id}/products`));
      const unsub = onSnapshot(q, (snap) => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Product[];
        all = [...all.filter(p => p.entityId !== entity.id), ...list];
        setItems([...all]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/products`));
      unsubscribes.push(unsub);

      const unsubMov = onSnapshot(doc(db, stockMovementsDocPath(entity.id)), (snap) => {
        setMovements(prev => ({ ...prev, [entity.id]: readMovements(snap.data()) }));
      }, () => { /* doc pode não existir ainda */ });
      unsubscribes.push(unsubMov);
    });
    return () => unsubscribes.forEach(u => u());
  }, [entities, filterType]);

  const products = items.filter(i => i.itemType !== 'supply' && i.trackStock);
  const insumos = items.filter(i => i.itemType === 'supply');
  const allMovements = (Object.values(movements).flat() as StockMovement[]).sort((a, b) => (a.at < b.at ? 1 : -1));
  const lowCount = [...products, ...insumos].filter(isLowStock).length;

  // ---- Insumo CRUD ----
  const resetInsumo = () => {
    setEditing(null); setInName(''); setInCategory(''); setInUnit('un');
    setInCost(''); setInStock(''); setInMin(''); setInEntity('');
  };
  const openNewInsumo = () => { resetInsumo(); setIsInsumoOpen(true); };
  const editInsumo = (p: Product) => {
    setEditing(p); setInName(p.name || ''); setInCategory(p.category || ''); setInUnit(p.unit || 'un');
    setInCost(p.costPrice != null ? String(p.costPrice) : '');
    setInStock(p.stock != null ? String(p.stock) : '');
    setInMin(p.minStock != null ? String(p.minStock) : '');
    setInEntity(p.entityId); setIsInsumoOpen(true);
  };
  const saveInsumo = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!inEntity) { showToast('Escolha a entidade.', 'error'); return; }
    if (!inName.trim()) { showToast('Dê um nome ao insumo.', 'error'); return; }
    const ent = entities.find(en => en.id === inEntity);
    const data = {
      name: inName.trim(), category: inCategory.trim() || null, unit: inUnit.trim() || null,
      costPrice: Number(inCost) || 0, basePrice: 0,
      itemType: 'supply' as const, trackStock: true,
      stock: Number(inStock) || 0, minStock: Number(inMin) || 0,
      active: true, entityId: inEntity,
      ownerUid: ent?.ownerUid, collaboratorsEmails: ent?.collaboratorsEmails || [],
      updatedAt: serverTimestamp(),
    };
    try {
      if (editing) await updateDoc(doc(db, `entities/${editing.entityId}/products/${editing.id}`), data);
      else await addDoc(collection(db, `entities/${inEntity}/products`), { ...data, createdAt: serverTimestamp() });
      setIsInsumoOpen(false); resetInsumo();
      showToast(`Insumo ${editing ? 'atualizado' : 'cadastrado'}!`, 'success');
    } catch (error) { console.error(error); showToast('Erro ao salvar o insumo.', 'error'); }
  };
  const deleteInsumo = async (p: Product) => {
    const ok = await confirm({ title: 'Excluir insumo', message: `Excluir "${p.name}"?`, variant: 'danger' });
    if (!ok) return;
    try { await deleteDoc(doc(db, `entities/${p.entityId}/products/${p.id}`)); showToast('Insumo excluído.', 'success'); }
    catch (error) { console.error(error); showToast('Erro ao excluir.', 'error'); }
  };

  // ---- Ajuste de estoque ----
  const openAdjust = (item: Product) => {
    setAdjItem(item); setAdjDelta(''); setAdjDir('in'); setAdjNote('');
    setAdjReason(item.itemType === 'supply' ? 'compra' : 'compra');
    setAdjReason('compra');
  };
  const confirmAdjust = async () => {
    if (!adjItem) return;
    const qty = Number(adjDelta) || 0;
    if (qty <= 0) { showToast('Informe a quantidade.', 'error'); return; }
    const delta = adjDir === 'in' ? qty : -qty;
    const balanceAfter = applyDelta(adjItem.stock, delta);
    const mov: StockMovement = {
      id: crypto.randomUUID(),
      itemType: adjItem.itemType === 'supply' ? 'supply' : 'product',
      itemId: adjItem.id, itemName: adjItem.name,
      delta, balanceAfter, reason: adjReason, note: adjNote.trim() || undefined,
      at: new Date().toISOString(), by: user?.email || undefined,
    };
    try {
      await updateDoc(doc(db, `entities/${adjItem.entityId}/products/${adjItem.id}`), { stock: balanceAfter, trackStock: true });
      const path = stockMovementsDocPath(adjItem.entityId);
      const snap = await getDoc(doc(db, path));
      const list = readMovements(snap.data());
      await setDoc(doc(db, path), { items: appendMovement(list, mov), updatedAt: serverTimestamp() }, { merge: true });
      setAdjItem(null);
      showToast(`Estoque atualizado: ${adjItem.name} → ${balanceAfter}.`, 'success');
    } catch (error) { console.error(error); showToast('Erro ao ajustar o estoque.', 'error'); }
  };

  const StockRow: React.FC<{ p: Product }> = ({ p }) => (
    <div className="flex items-center justify-between rounded-xl border border-line bg-surface p-4">
      <div className="min-w-0">
        <div className="flex items-center gap-2">
          <p className="truncate font-bold text-content">{p.name}</p>
          {isLowStock(p) && <span className="flex items-center gap-1 rounded-full bg-red-50 px-2 py-0.5 text-[10px] font-bold uppercase text-red-600 dark:bg-red-950/50"><AlertTriangle className="h-2.5 w-2.5" /> baixo</span>}
        </div>
        <p className="text-xs text-content-subtle">{p.category || '—'} · mín. {p.minStock ?? 0} {p.unit || ''}</p>
      </div>
      <div className="flex items-center gap-4">
        <div className="text-right">
          <p className="text-[10px] uppercase text-content-subtle">Saldo</p>
          <p className={cn('text-xl font-black', isLowStock(p) ? 'text-red-600' : 'text-content')}>{p.stock ?? 0}</p>
        </div>
        <button onClick={() => openAdjust(p)} className="rounded-lg border border-line px-3 py-2 text-xs font-bold text-content hover:border-violet-400 hover:text-violet-600">Ajustar</button>
        {p.itemType === 'supply' && (
          <div className="flex gap-1">
            <button onClick={() => editInsumo(p)} className="rounded-lg p-2 text-content-subtle hover:text-primary"><Edit2 className="h-4 w-4" /></button>
            <button onClick={() => deleteInsumo(p)} className="rounded-lg p-2 text-content-subtle hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-violet-100 text-violet-600 dark:bg-violet-950/50"><Boxes className="h-7 w-7" /></div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-content">Estoque</h2>
            <p className="text-sm text-content-subtle">Saldo de produtos e insumos, com alerta de mínimo e movimentações.</p>
          </div>
        </div>
        {lowCount > 0 && (
          <div className="flex items-center gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-2 text-red-700 dark:bg-red-950/40 dark:border-red-900">
            <AlertTriangle className="h-4 w-4" />
            <span className="text-sm font-bold">{lowCount} item(ns) no estoque mínimo</span>
          </div>
        )}
      </div>

      <div className="flex gap-2 border-b border-line">
        {([['produtos', `Produtos (${products.length})`], ['insumos', `Insumos (${insumos.length})`], ['mov', 'Movimentações']] as const).map(([id, label]) => (
          <button key={id} onClick={() => setTab(id)}
            className={cn('px-4 py-2 text-sm font-bold border-b-2 -mb-px transition-colors',
              tab === id ? 'border-violet-600 text-violet-600' : 'border-transparent text-content-subtle hover:text-content')}>
            {label}
          </button>
        ))}
      </div>

      {tab === 'produtos' && (
        <div className="space-y-3">
          {products.length === 0
            ? <p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhum produto com estoque controlado. Ative "controlar estoque" no cadastro do produto.</p>
            : products.map(p => <StockRow key={p.id} p={p} />)}
        </div>
      )}

      {tab === 'insumos' && (
        <div className="space-y-3">
          <div className="flex justify-end">
            <button onClick={openNewInsumo} className="flex items-center gap-2 rounded-xl bg-violet-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-violet-700"><Plus className="h-4 w-4" /> Novo Insumo</button>
          </div>
          {insumos.length === 0
            ? <p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhum insumo cadastrado. Ex.: papel, tinta, filamento 3D...</p>
            : insumos.map(p => <StockRow key={p.id} p={p} />)}
        </div>
      )}

      {tab === 'mov' && (
        <div className="overflow-x-auto rounded-2xl border border-line">
          {allMovements.length === 0 ? (
            <p className="p-10 text-center text-sm text-content-subtle">Sem movimentações ainda. Ajuste um saldo ou registre uma venda.</p>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-surface-muted text-[10px] uppercase text-content-subtle">
                <tr><th className="px-4 py-3 text-left">Quando</th><th className="px-4 py-3 text-left">Item</th><th className="px-4 py-3 text-left">Motivo</th><th className="px-4 py-3 text-right">Movto</th><th className="px-4 py-3 text-right">Saldo</th></tr>
              </thead>
              <tbody>
                {allMovements.map(m => (
                  <tr key={m.id} className="border-t border-line">
                    <td className="px-4 py-3 text-content-subtle">{new Date(m.at).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}</td>
                    <td className="px-4 py-3 font-medium text-content">{m.itemName}{m.note ? <span className="block text-[11px] text-content-subtle">{m.note}</span> : null}</td>
                    <td className="px-4 py-3 text-content-subtle">{STOCK_REASONS.find(r => r.id === m.reason)?.label || m.reason}</td>
                    <td className={cn('px-4 py-3 text-right font-bold', m.delta >= 0 ? 'text-emerald-600' : 'text-red-600')}>
                      <span className="inline-flex items-center gap-1">{m.delta >= 0 ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}{m.delta > 0 ? '+' : ''}{m.delta}</span>
                    </td>
                    <td className="px-4 py-3 text-right font-bold text-content">{m.balanceAfter}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      )}

      {/* Modal Insumo */}
      {isInsumoOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setIsInsumoOpen(false)}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={e => e.stopPropagation()}
            className="w-full max-w-lg rounded-2xl bg-surface shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line p-6"><h3 className="text-xl font-bold text-content">{editing ? 'Editar Insumo' : 'Novo Insumo'}</h3>
              <button onClick={() => setIsInsumoOpen(false)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted"><X className="h-5 w-5" /></button></div>
            <form onSubmit={saveInsumo} className="space-y-4 p-6">
              <div>
                <label className="block text-sm font-medium text-content-muted">Entidade</label>
                <select value={inEntity} onChange={e => setInEntity(e.target.value)} required className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Selecione...</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>
              <div className="grid gap-4 sm:grid-cols-2">
                <div><label className="block text-sm font-medium text-content-muted">Nome do insumo</label>
                  <input value={inName} onChange={e => setInName(e.target.value)} required className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="Papel couché, filamento PLA..." /></div>
                <div><label className="block text-sm font-medium text-content-muted">Categoria</label>
                  <input value={inCategory} onChange={e => setInCategory(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="Papel, Tinta, Filamento..." /></div>
              </div>
              <div className="grid gap-4 sm:grid-cols-4">
                <div><label className="block text-[11px] font-bold uppercase text-content-subtle">Unidade</label>
                  <input value={inUnit} onChange={e => setInUnit(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="un, kg, m" /></div>
                <div><label className="block text-[11px] font-bold uppercase text-content-subtle">Custo (R$)</label>
                  <input type="number" step="0.01" value={inCost} onChange={e => setInCost(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="0,00" /></div>
                <div><label className="block text-[11px] font-bold uppercase text-content-subtle">Estoque</label>
                  <input type="number" value={inStock} onChange={e => setInStock(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="0" /></div>
                <div><label className="block text-[11px] font-bold uppercase text-content-subtle">Mínimo</label>
                  <input type="number" value={inMin} onChange={e => setInMin(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="0" /></div>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsInsumoOpen(false)} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-content-muted hover:bg-canvas">Cancelar</button>
                <button type="submit" className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">{editing ? 'Salvar' : 'Cadastrar'}</button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Modal Ajuste */}
      {adjItem && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setAdjItem(null)}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={e => e.stopPropagation()}
            className="w-full max-w-md rounded-2xl bg-surface shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-line p-6">
              <div><h3 className="text-lg font-bold text-content">Ajustar estoque</h3><p className="text-sm text-content-subtle">{adjItem.name} · saldo atual {adjItem.stock ?? 0}</p></div>
              <button onClick={() => setAdjItem(null)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted"><X className="h-5 w-5" /></button>
            </div>
            <div className="space-y-4 p-6">
              <div className="flex gap-2">
                <button onClick={() => setAdjDir('in')} className={cn('flex-1 rounded-lg border py-2 text-sm font-bold', adjDir === 'in' ? 'border-emerald-500 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/40' : 'border-line text-content-subtle')}>Entrada (+)</button>
                <button onClick={() => setAdjDir('out')} className={cn('flex-1 rounded-lg border py-2 text-sm font-bold', adjDir === 'out' ? 'border-red-500 bg-red-50 text-red-700 dark:bg-red-950/40' : 'border-line text-content-subtle')}>Saída (−)</button>
              </div>
              <div className="grid gap-3 sm:grid-cols-2">
                <div><label className="block text-[11px] font-bold uppercase text-content-subtle">Quantidade</label>
                  <input type="number" autoFocus value={adjDelta} onChange={e => setAdjDelta(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="0" /></div>
                <div><label className="block text-[11px] font-bold uppercase text-content-subtle">Motivo</label>
                  <select value={adjReason} onChange={e => setAdjReason(e.target.value as StockReason)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                    {STOCK_REASONS.filter(r => r.id !== 'venda').map(r => <option key={r.id} value={r.id}>{r.label}</option>)}
                  </select></div>
              </div>
              <div><label className="block text-[11px] font-bold uppercase text-content-subtle">Observação (opcional)</label>
                <input value={adjNote} onChange={e => setAdjNote(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="Nota fiscal, fornecedor..." /></div>
              <p className="text-xs text-content-subtle">Novo saldo: <strong className="text-content">{applyDelta(adjItem.stock, adjDir === 'in' ? (Number(adjDelta) || 0) : -(Number(adjDelta) || 0))}</strong></p>
              <div className="flex gap-3">
                <button onClick={() => setAdjItem(null)} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-content-muted hover:bg-canvas">Cancelar</button>
                <button onClick={confirmAdjust} className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700">Confirmar</button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
