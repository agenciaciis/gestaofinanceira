import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { collection, query, onSnapshot, orderBy, limit } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product, Transaction } from '../types';
import { parseLocalDate } from '../lib/finance';
import { isLowStock } from '../lib/stock';
import { MONTHS } from '../constants';
import { ShoppingBag, TrendingUp, Package, Receipt, ChevronLeft, ChevronRight, AlertTriangle, Trophy } from 'lucide-react';
import { cn } from '../lib/utils';

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

export const PainelVendas: React.FC = () => {
  const { entities, filterType } = useEntity();
  const [sales, setSales] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [month, setMonth] = useState(new Date().getMonth());
  const [year, setYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (entities.length === 0) return;
    const ents = filterType === 'ALL' ? entities : entities.filter(e => e.type === filterType);
    const unsubs: (() => void)[] = [];
    let allS: Transaction[] = [], allP: Product[] = [];
    ents.forEach(entity => {
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/transactions`), orderBy('date', 'desc'), limit(500)), (s) => {
        const list = (s.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[]).filter(t => t.isSale);
        allS = [...allS.filter(t => t.entityId !== entity.id), ...list]; setSales([...allS]);
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'transactions')));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/products`)), (s) => {
        const list = (s.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]);
        allP = [...allP.filter(p => p.entityId !== entity.id), ...list]; setProducts([...allP]);
      }, () => {}));
    });
    return () => unsubs.forEach(u => u());
  }, [entities, filterType]);

  const inMonth = (t: Transaction, m: number, y: number) => {
    const d = parseLocalDate(t.date); return d.getMonth() === m && d.getFullYear() === y;
  };

  const stats = useMemo(() => {
    const monthSales = sales.filter(s => inMonth(s, month, year));
    const vendido = monthSales.reduce((a, s) => a + (s.amount || 0), 0);
    const recebido = monthSales.filter(s => s.status === 'completed').reduce((a, s) => a + (s.amount || 0), 0);
    const aReceber = monthSales.filter(s => s.status === 'pending').reduce((a, s) => a + (s.amount || 0), 0);
    const nVendas = monthSales.length;
    const nProdutos = monthSales.reduce((a, s) => a + (s.saleItems || []).reduce((x, i) => x + (i.qty || 0), 0), 0);
    const ticket = nVendas ? vendido / nVendas : 0;

    // Top produtos do mês (por receita).
    const byProduct: Record<string, { name: string; qty: number; revenue: number }> = {};
    monthSales.forEach(s => (s.saleItems || []).forEach(i => {
      const key = i.name + (i.variationName ? ` (${i.variationName})` : '');
      byProduct[key] = byProduct[key] || { name: key, qty: 0, revenue: 0 };
      byProduct[key].qty += i.qty || 0;
      byProduct[key].revenue += (i.qty || 0) * (i.unitPrice || 0);
    }));
    const topProducts = Object.values(byProduct).sort((a, b) => b.revenue - a.revenue).slice(0, 6);

    // Últimos 6 meses (vendido por mês).
    const trend: { label: string; value: number }[] = [];
    for (let i = 5; i >= 0; i--) {
      const d = new Date(year, month - i, 1);
      const v = sales.filter(s => inMonth(s, d.getMonth(), d.getFullYear())).reduce((a, s) => a + (s.amount || 0), 0);
      trend.push({ label: MONTHS[d.getMonth()].slice(0, 3), value: v });
    }
    const lowStock = products.filter(p => p.itemType !== 'supply' && isLowStock(p));
    return { vendido, recebido, aReceber, nVendas, nProdutos, ticket, topProducts, trend, lowStock };
  }, [sales, products, month, year]);

  const changeMonth = (delta: number) => {
    let m = month + delta, y = year;
    if (m > 11) { m = 0; y++; } if (m < 0) { m = 11; y--; }
    setMonth(m); setYear(y);
  };

  const maxTrend = Math.max(1, ...stats.trend.map(t => t.value));

  const Kpi = ({ icon: Icon, label, value, sub, color }: { icon: React.ElementType; label: string; value: string; sub?: string; color: string }) => (
    <div className="rounded-2xl border border-line bg-surface p-5 shadow-sm">
      <div className="flex items-center gap-2 text-content-subtle"><Icon className={cn('h-4 w-4', color)} /><span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
      <p className="mt-2 text-2xl font-black tracking-tight text-content">{value}</p>
      {sub && <p className="mt-0.5 text-xs text-content-subtle">{sub}</p>}
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50"><ShoppingBag className="h-7 w-7" /></div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-content">Painel de Vendas</h2>
            <p className="text-sm text-content-subtle">Vendas e saída de produtos — separado do painel financeiro.</p>
          </div>
        </div>
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface px-2 py-1">
          <button onClick={() => changeMonth(-1)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted"><ChevronLeft className="h-4 w-4" /></button>
          <span className="min-w-[130px] text-center text-sm font-bold text-content">{MONTHS[month]} {year}</span>
          <button onClick={() => changeMonth(1)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted"><ChevronRight className="h-4 w-4" /></button>
        </div>
      </div>

      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={TrendingUp} label="Vendido no mês" value={brl(stats.vendido)} sub={`${stats.nVendas} venda(s)`} color="text-emerald-600" />
        <Kpi icon={Receipt} label="Recebido" value={brl(stats.recebido)} sub={`A receber: ${brl(stats.aReceber)}`} color="text-blue-600" />
        <Kpi icon={Package} label="Produtos vendidos" value={String(stats.nProdutos)} sub="unidades no mês" color="text-violet-600" />
        <Kpi icon={ShoppingBag} label="Ticket médio" value={brl(stats.ticket)} sub="por venda" color="text-amber-600" />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Tendência 6 meses */}
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-content-subtle">Vendas — últimos 6 meses</h3>
          <div className="flex items-end justify-between gap-3" style={{ height: 160 }}>
            {stats.trend.map((t, i) => (
              <div key={i} className="flex flex-1 flex-col items-center justify-end gap-2">
                <span className="text-[10px] font-bold text-content-subtle">{t.value > 0 ? brl(t.value).replace('R$', '').trim() : ''}</span>
                <div className="w-full rounded-t-lg bg-emerald-500/80 transition-all" style={{ height: `${Math.max(2, (t.value / maxTrend) * 120)}px` }} />
                <span className="text-[10px] font-bold uppercase text-content-subtle">{t.label}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Top produtos */}
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-content-subtle"><Trophy className="h-4 w-4 text-amber-500" /> Mais vendidos no mês</h3>
          {stats.topProducts.length === 0 ? (
            <p className="text-sm text-content-subtle">Nenhuma venda neste mês.</p>
          ) : (
            <div className="space-y-3">
              {stats.topProducts.map((p, i) => (
                <div key={i} className="flex items-center justify-between">
                  <div className="flex items-center gap-3 min-w-0">
                    <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-surface-muted text-[11px] font-black text-content-subtle">{i + 1}</span>
                    <span className="truncate text-sm font-medium text-content">{p.name}</span>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-bold text-emerald-600">{brl(p.revenue)}</p>
                    <p className="text-[10px] text-content-subtle">{p.qty} un</p>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Estoque baixo */}
      <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
        <h3 className="mb-4 flex items-center gap-2 text-sm font-black uppercase tracking-widest text-content-subtle"><AlertTriangle className="h-4 w-4 text-red-500" /> Alertas de estoque</h3>
        {stats.lowStock.length === 0 ? (
          <p className="text-sm text-content-subtle">Nenhum produto no estoque mínimo. 👍</p>
        ) : (
          <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
            {stats.lowStock.map(p => (
              <div key={p.id} className="flex items-center justify-between rounded-xl border border-red-200 bg-red-50 px-4 py-2 dark:bg-red-950/40 dark:border-red-900">
                <span className="truncate text-sm font-medium text-content">{p.name}</span>
                <span className="text-sm font-black text-red-600">{p.stock ?? 0}</span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
};
