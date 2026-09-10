import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, doc, updateDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product } from '../types';
import { Calculator, Check, TrendingUp, AlertTriangle } from 'lucide-react';
import { cn } from '../lib/utils';

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

/** Preço que atinge a margem desejada sobre o PREÇO (markup por margem). */
export function suggestedPrice(cost: number, marginPercent: number): number {
  const c = Number(cost) || 0;
  const m = Math.min(99.9, Math.max(0, Number(marginPercent) || 0));
  if (c <= 0) return 0;
  return Math.round((c / (1 - m / 100)) * 100) / 100;
}
/** Margem atual (%) sobre o preço. */
export function marginOf(price: number, cost: number): number {
  const p = Number(price) || 0, c = Number(cost) || 0;
  if (p <= 0) return 0;
  return Math.round(((p - c) / p) * 1000) / 10;
}

const pricingDocPath = (entityId: string) => `entities/${entityId}/config/pricing`;

export const Precificacao: React.FC = () => {
  const { entities } = useEntity();
  const { showToast } = useUI();
  const [entityId, setEntityId] = useState('');
  const [products, setProducts] = useState<Product[]>([]);
  const [margin, setMargin] = useState(20);
  const [savingMargin, setSavingMargin] = useState(false);

  useEffect(() => { if (!entityId && entities.length) setEntityId(entities[0].id); }, [entities, entityId]);

  useEffect(() => {
    if (!entityId) { setProducts([]); return; }
    const unsubs: (() => void)[] = [];
    unsubs.push(onSnapshot(query(collection(db, `entities/${entityId}/products`)), (s) => {
      setProducts((s.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]).filter(p => p.itemType !== 'supply'));
    }, (e) => handleFirestoreError(e, OperationType.LIST, 'products')));
    unsubs.push(onSnapshot(doc(db, pricingDocPath(entityId)), (snap) => {
      const m = (snap.data() as { targetMargin?: number } | undefined)?.targetMargin;
      if (typeof m === 'number') setMargin(m);
    }, () => {}));
    return () => unsubs.forEach(u => u());
  }, [entityId]);

  const saveMargin = async () => {
    setSavingMargin(true);
    try {
      await setDoc(doc(db, pricingDocPath(entityId)), { targetMargin: Number(margin) || 0, updatedAt: serverTimestamp() }, { merge: true });
      showToast('Meta de lucro salva.', 'success');
    } catch (e) { console.error(e); showToast('Erro ao salvar a meta.', 'error'); }
    finally { setSavingMargin(false); }
  };

  const applyPrice = async (p: Product) => {
    const novo = suggestedPrice(p.costPrice || 0, margin);
    if (novo <= 0) { showToast('Defina o custo do produto primeiro.', 'error'); return; }
    try {
      await updateDoc(doc(db, `entities/${p.entityId}/products/${p.id}`), { basePrice: novo });
      showToast(`${p.name}: preço aplicado ${brl(novo)}.`, 'success');
    } catch (e) { console.error(e); showToast('Erro ao aplicar o preço.', 'error'); }
  };

  const semCusto = products.filter(p => !(Number(p.costPrice) > 0)).length;
  const calculados = products.length - semCusto;

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-amber-100 text-amber-600 dark:bg-amber-950/50"><Calculator className="h-7 w-7" /></div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-content">Precificação</h2>
            <p className="text-sm text-content-subtle">Defina a meta de lucro e aplique o preço sugerido nos produtos.</p>
          </div>
        </div>
        <select value={entityId} onChange={e => setEntityId(e.target.value)} className="rounded-xl border border-line bg-surface px-4 py-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20">
          {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
        </select>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm sm:col-span-1">
          <p className="flex items-center gap-2 text-[10px] font-black uppercase tracking-widest text-content-subtle"><TrendingUp className="h-4 w-4 text-amber-500" /> Meta de lucro</p>
          <div className="mt-2 flex items-center gap-2">
            <input type="number" step="1" value={margin} onChange={e => setMargin(Number(e.target.value))} className="w-24 rounded-lg border border-line px-3 py-2 text-2xl font-black outline-none focus:ring-2 focus:ring-primary/20" />
            <span className="text-2xl font-black text-content-subtle">%</span>
            <button onClick={saveMargin} disabled={savingMargin} className="ml-auto rounded-lg bg-amber-600 px-4 py-2 text-sm font-bold text-white hover:bg-amber-700 disabled:opacity-50">Salvar</button>
          </div>
          <p className="mt-2 text-xs text-content-subtle">Margem sobre o preço de venda.</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Com custo definido</p>
          <p className="mt-2 text-2xl font-black text-content">{calculados}</p>
        </div>
        <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Falta custo</p>
          <p className={cn('mt-2 text-2xl font-black', semCusto > 0 ? 'text-red-600' : 'text-content')}>{semCusto}</p>
        </div>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        {products.length === 0 ? (
          <p className="p-10 text-center text-sm text-content-subtle">Nenhum produto para precificar. Cadastre em Produtos.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-[10px] uppercase text-content-subtle">
              <tr>
                <th className="px-4 py-3 text-left">Produto</th>
                <th className="px-4 py-3 text-right">Custo</th>
                <th className="px-4 py-3 text-right">Preço atual</th>
                <th className="px-4 py-3 text-right">Margem atual</th>
                <th className="px-4 py-3 text-right">Preço sugerido</th>
                <th className="px-4 py-3 text-right">Ação</th>
              </tr>
            </thead>
            <tbody>
              {products.map(p => {
                const cost = Number(p.costPrice) || 0;
                const price = Number(p.basePrice) || 0;
                const sug = suggestedPrice(cost, margin);
                const mgn = marginOf(price, cost);
                const semCustoRow = cost <= 0;
                const aplicado = price > 0 && Math.abs(price - sug) < 0.01;
                return (
                  <tr key={p.id} className="border-t border-line">
                    <td className="px-4 py-3 font-medium text-content">{p.name}</td>
                    <td className="px-4 py-3 text-right text-content-subtle">{cost > 0 ? brl(cost) : <span className="text-red-500">—</span>}</td>
                    <td className="px-4 py-3 text-right text-content">{price > 0 ? brl(price) : '—'}</td>
                    <td className={cn('px-4 py-3 text-right font-bold', mgn < margin ? 'text-red-600' : 'text-emerald-600')}>{price > 0 ? `${mgn}%` : '—'}</td>
                    <td className="px-4 py-3 text-right font-black text-amber-600">{semCustoRow ? <span className="text-content-subtle">defina o custo</span> : brl(sug)}</td>
                    <td className="px-4 py-3 text-right">
                      {aplicado
                        ? <span className="inline-flex items-center gap-1 text-[11px] font-bold text-emerald-600"><Check className="h-3.5 w-3.5" /> aplicado</span>
                        : <button onClick={() => applyPrice(p)} disabled={semCustoRow} className="rounded-lg border border-line px-3 py-1.5 text-xs font-bold text-content hover:border-amber-400 hover:text-amber-600 disabled:opacity-40">Aplicar</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>

      {semCusto > 0 && (
        <p className="flex items-center gap-2 text-sm text-content-subtle"><AlertTriangle className="h-4 w-4 text-amber-500" /> {semCusto} produto(s) sem custo — informe o custo no cadastro para calcular o preço.</p>
      )}
    </div>
  );
};
