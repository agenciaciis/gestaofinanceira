import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, onSnapshot } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product, Transaction, BankAccount } from '../types';
import { totalBalance, parseLocalDate, isCardExpense } from '../lib/finance';
import { isLowStock } from '../lib/stock';
import {
  ArrowUpCircle, ShoppingCart, ClipboardList, Box, Wallet, TrendingUp, AlertTriangle,
  Clock, ChevronRight, Package, Boxes,
} from 'lucide-react';
import { cn } from '../lib/utils';

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

export const Inicio: React.FC<{ onNavigate: (page: string) => void }> = ({ onNavigate }) => {
  const { entities, filterType } = useEntity();
  const { user } = useAuth();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [pedidos, setPedidos] = useState<any[]>([]);

  useEffect(() => {
    if (entities.length === 0) return;
    const ents = filterType === 'ALL' ? entities : entities.filter(e => e.type === filterType);
    const unsubs: (() => void)[] = [];
    let allT: Transaction[] = [], allP: Product[] = [], allA: BankAccount[] = [], allPed: any[] = [];
    ents.forEach(entity => {
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/transactions`)), (s) => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[];
        allT = [...allT.filter(t => t.entityId !== entity.id), ...list]; setTransactions([...allT]);
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'transactions')));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/products`)), (s) => {
        const list = (s.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]);
        allP = [...allP.filter(p => p.entityId !== entity.id), ...list]; setProducts([...allP]);
      }, () => {}));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/bank_accounts`)), (s) => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as BankAccount[];
        allA = [...allA.filter(a => a.entityId !== entity.id), ...list]; setAccounts([...allA]);
      }, () => {}));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/quotes`)), (s) => {
        const list = (s.docs.map(d => ({ id: d.id, ...d.data() })) as any[]).filter(q => q.docType === 'pedido');
        allPed = [...allPed.filter(p => p.entityId !== entity.id), ...list]; setPedidos([...allPed]);
      }, () => {}));
    });
    return () => unsubs.forEach(u => u());
  }, [entities, filterType]);

  const stats = useMemo(() => {
    const now = new Date();
    const m = now.getMonth(), y = now.getFullYear();
    const todayStart = new Date(y, m, now.getDate());
    const isThisMonth = (t: Transaction) => { const d = parseLocalDate(t.date); return d.getMonth() === m && d.getFullYear() === y; };
    const saldo = totalBalance(accounts, transactions);
    const vendidoMes = transactions.filter(t => t.isSale && isThisMonth(t)).reduce((a, t) => a + (t.amount || 0), 0);
    const aPagar = transactions.filter(t => t.type === 'expense' && !isCardExpense(t) && t.status === 'pending' && isThisMonth(t)).reduce((a, t) => a + (t.amount || 0), 0);
    const vencidas = transactions.filter(t => t.status === 'pending' && !isCardExpense(t) && parseLocalDate(t.date) < todayStart);
    const pedidosAbertos = pedidos.filter(p => p.status !== 'entregue');
    const estoqueBaixo = products.filter(p => p.itemType !== 'supply' && isLowStock(p));
    const recentesLanc = [...transactions].sort((a, b) => (a.date < b.date ? 1 : -1)).slice(0, 5);
    const recentesPed = [...pedidos].sort((a, b) => ((a.createdAt?.seconds || 0) < (b.createdAt?.seconds || 0) ? 1 : -1)).slice(0, 5);
    return { saldo, vendidoMes, aPagar, vencidas, pedidosAbertos, estoqueBaixo, recentesLanc, recentesPed };
  }, [transactions, products, accounts, pedidos]);

  const nome = (user?.displayName || user?.email?.split('@')[0] || 'por aqui').split(' ')[0];
  const hora = new Date().getHours();
  const saudacao = hora < 12 ? 'Bom dia' : hora < 18 ? 'Boa tarde' : 'Boa noite';

  const actions = [
    { label: 'Novo lançamento', icon: ArrowUpCircle, page: 'transactions', color: 'bg-blue-600' },
    { label: 'Nova venda', icon: ShoppingCart, page: 'vendas', color: 'bg-emerald-600' },
    { label: 'Novo pedido', icon: ClipboardList, page: 'pedidos', color: 'bg-indigo-600' },
    { label: 'Novo produto', icon: Box, page: 'products', color: 'bg-violet-600' },
  ];

  const Kpi = ({ icon: Icon, label, value, color, page }: { icon: React.ElementType; label: string; value: string; color: string; page: string }) => (
    <button onClick={() => onNavigate(page)} className="group rounded-2xl border border-line bg-surface p-5 text-left shadow-sm transition-all hover:shadow-md hover:border-primary/30">
      <div className="flex items-center gap-2 text-content-subtle"><Icon className={cn('h-4 w-4', color)} /><span className="text-[10px] font-black uppercase tracking-widest">{label}</span></div>
      <p className="mt-2 text-2xl font-black tracking-tight text-content">{value}</p>
    </button>
  );

  return (
    <div className="space-y-6">
      {/* Boas-vindas + atalhos */}
      <div className="rounded-[2rem] bg-gradient-to-br from-primary to-indigo-700 p-8 text-white shadow-xl">
        <p className="text-sm font-medium text-white/70">{saudacao},</p>
        <h2 className="text-3xl font-black tracking-tight">{nome} 👋</h2>
        <p className="mt-1 text-sm text-white/80">Aqui está o resumo do seu negócio hoje.</p>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {actions.map(a => (
            <button key={a.page} onClick={() => onNavigate(a.page)} className="flex items-center gap-2 rounded-xl bg-white/15 px-4 py-3 text-sm font-bold backdrop-blur transition-all hover:bg-white/25">
              <a.icon className="h-5 w-5" /> {a.label}
            </button>
          ))}
        </div>
      </div>

      {/* KPIs */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Kpi icon={Wallet} label="Saldo em contas" value={brl(stats.saldo)} color="text-blue-600" page="accounts" />
        <Kpi icon={TrendingUp} label="Vendas do mês" value={brl(stats.vendidoMes)} color="text-emerald-600" page="painel-vendas" />
        <Kpi icon={ArrowUpCircle} label="A pagar no mês" value={brl(stats.aPagar)} color="text-amber-600" page="transactions" />
        <Kpi icon={ClipboardList} label="Pedidos ativos" value={String(stats.pedidosAbertos.length)} color="text-indigo-600" page="pedidos" />
      </div>

      {/* Alertas */}
      {(stats.vencidas.length > 0 || stats.estoqueBaixo.length > 0) && (
        <div className="grid gap-4 lg:grid-cols-2">
          {stats.vencidas.length > 0 && (
            <button onClick={() => onNavigate('transactions')} className="flex items-center justify-between rounded-2xl border border-red-200 bg-red-50 p-5 text-left transition-all hover:shadow-md dark:bg-red-950/30 dark:border-red-900">
              <div className="flex items-center gap-3"><AlertTriangle className="h-6 w-6 text-red-500" /><div><p className="font-bold text-content">{stats.vencidas.length} conta(s) vencida(s)</p><p className="text-sm text-content-subtle">Total {brl(stats.vencidas.reduce((a, t) => a + (t.amount || 0), 0))}</p></div></div>
              <ChevronRight className="h-5 w-5 text-content-subtle" />
            </button>
          )}
          {stats.estoqueBaixo.length > 0 && (
            <button onClick={() => onNavigate('estoque')} className="flex items-center justify-between rounded-2xl border border-amber-200 bg-amber-50 p-5 text-left transition-all hover:shadow-md dark:bg-amber-950/30 dark:border-amber-900">
              <div className="flex items-center gap-3"><Boxes className="h-6 w-6 text-amber-500" /><div><p className="font-bold text-content">{stats.estoqueBaixo.length} item(ns) com estoque baixo</p><p className="text-sm text-content-subtle truncate max-w-[240px]">{stats.estoqueBaixo.map(p => p.name).slice(0, 3).join(', ')}</p></div></div>
              <ChevronRight className="h-5 w-5 text-content-subtle" />
            </button>
          )}
        </div>
      )}

      {/* Recentes */}
      <div className="grid gap-6 lg:grid-cols-2">
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-content-subtle">Últimos lançamentos</h3>
            <button onClick={() => onNavigate('transactions')} className="text-xs font-bold text-primary hover:underline">Ver todos</button>
          </div>
          {stats.recentesLanc.length === 0 ? <p className="text-sm text-content-subtle">Nada ainda.</p> : (
            <div className="space-y-2">
              {stats.recentesLanc.map(t => (
                <div key={t.id} className="flex items-center justify-between text-sm">
                  <span className="truncate text-content">{t.description}</span>
                  <span className={cn('font-bold', t.type === 'income' ? 'text-emerald-600' : t.type === 'expense' ? 'text-red-600' : 'text-blue-600')}>{t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''}{brl(t.amount)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
        <div className="rounded-2xl border border-line bg-surface p-6 shadow-sm">
          <div className="mb-4 flex items-center justify-between">
            <h3 className="text-sm font-black uppercase tracking-widest text-content-subtle">Pedidos recentes</h3>
            <button onClick={() => onNavigate('pedidos')} className="text-xs font-bold text-primary hover:underline">Ver todos</button>
          </div>
          {stats.recentesPed.length === 0 ? <p className="text-sm text-content-subtle">Nenhum pedido ainda.</p> : (
            <div className="space-y-2">
              {stats.recentesPed.map(p => (
                <div key={p.id} className="flex items-center justify-between text-sm">
                  <span className="flex items-center gap-2 truncate text-content"><Clock className="h-3.5 w-3.5 text-content-subtle" /> {p.clientName || 'Sem cliente'}</span>
                  <span className="font-bold text-emerald-600">{brl(p.total)}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
