import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { collection, query, onSnapshot, doc } from 'firebase/firestore';
import { db } from '../firebase';
import { CreditCard, Transaction, BankAccount } from '../types';
import { CATEGORIES } from '../constants';
import {
  Bell,
  AlertCircle,
  Clock,
  CheckCircle2,
  TrendingDown,
  Target,
  Landmark,
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { computeBalances, daysUntilDueDay, parseLocalDate, isRealized } from '../lib/finance';
import { isSameMonth, isBefore, startOfDay } from 'date-fns';

interface Notification {
  id: string;
  title: string;
  message: string;
  type: 'info' | 'warning' | 'error' | 'success';
}

const brl = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(n);

export const Notifications: React.FC = () => {
  const { entities } = useEntity();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [budgetsByEntity, setBudgetsByEntity] = useState<Record<string, Record<string, number>>>({});
  const [isOpen, setIsOpen] = useState(false);

  useEffect(() => {
    if (entities.length === 0) return;

    const unsubscribes: (() => void)[] = [];
    let allCards: CreditCard[] = [];
    let allTx: Transaction[] = [];
    let allAccts: BankAccount[] = [];

    entities.forEach(entity => {
      unsubscribes.push(onSnapshot(query(collection(db, `entities/${entity.id}/credit_cards`)), (snap) => {
        const e = snap.docs.map(d => ({ id: d.id, ...d.data() })) as CreditCard[];
        allCards = [...allCards.filter(c => c.entityId !== entity.id), ...e];
        setCards([...allCards]);
      }));

      unsubscribes.push(onSnapshot(query(collection(db, `entities/${entity.id}/transactions`)), (snap) => {
        const e = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[];
        allTx = [...allTx.filter(t => t.entityId !== entity.id), ...e];
        setTransactions([...allTx]);
      }));

      unsubscribes.push(onSnapshot(query(collection(db, `entities/${entity.id}/bank_accounts`)), (snap) => {
        const e = snap.docs.map(d => ({ id: d.id, ...d.data() })) as BankAccount[];
        allAccts = [...allAccts.filter(a => a.entityId !== entity.id), ...e];
        setAccounts([...allAccts]);
      }));

      unsubscribes.push(onSnapshot(doc(db, `entities/${entity.id}/config/budgets`), (snap) => {
        setBudgetsByEntity(prev => ({ ...prev, [entity.id]: snap.exists() ? (snap.data() as Record<string, number>) : {} }));
      }));
    });

    return () => unsubscribes.forEach(unsub => unsub());
  }, [entities]);

  const allNotifications = useMemo<Notification[]>(() => {
    const alerts: Notification[] = [];
    const now = new Date();
    const todayStart = startOfDay(now);

    // 1) Cartões: fechamento (3 dias) e vencimento (5 dias) — datas reais.
    cards.forEach(card => {
      const toClosing = daysUntilDueDay(card.closingDay, now);
      if (toClosing <= 3) {
        alerts.push({
          id: `closing-${card.id}`,
          title: 'Fatura próxima ao fechamento',
          message: `A fatura do cartão ${card.name} fecha ${toClosing === 0 ? 'hoje' : `em ${toClosing} dia(s)`}.`,
          type: 'warning',
        });
      }
      const toDue = daysUntilDueDay(card.dueDay, now);
      if (toDue <= 5) {
        alerts.push({
          id: `due-${card.id}`,
          title: 'Vencimento de fatura',
          message: `O cartão ${card.name} vence ${toDue === 0 ? 'hoje' : `em ${toDue} dia(s)`} (dia ${card.dueDay}).`,
          type: 'error',
        });
      }
    });

    // 2) Contas a pagar atrasadas (despesa pendente com data no passado).
    const overdue = transactions.filter(t =>
      t.status === 'pending' && t.type === 'expense' && isBefore(parseLocalDate(t.date), todayStart)
    );
    if (overdue.length > 0) {
      const total = overdue.reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
      alerts.push({
        id: 'overdue-bills',
        title: `${overdue.length} conta(s) atrasada(s)`,
        message: `Você tem ${overdue.length} pagamento(s) vencido(s), somando ${brl(total)}.`,
        type: 'error',
      });
    }

    // 3) Saldo negativo em alguma conta.
    const balances = computeBalances(accounts, transactions);
    accounts.forEach(acc => {
      const bal = balances[acc.id] ?? 0;
      if (bal < 0) {
        alerts.push({
          id: `neg-${acc.id}`,
          title: 'Saldo negativo',
          message: `A conta ${acc.bankName} está negativa em ${brl(bal)}.`,
          type: 'error',
        });
      }
    });

    // 4) Estouro de orçamento por categoria (gasto do mês > limite definido).
    Object.entries(budgetsByEntity).forEach(([entityId, budgets]) => {
      CATEGORIES.forEach(cat => {
        const limitValue = budgets?.[cat.id];
        if (!limitValue || limitValue <= 0) return;
        const spent = transactions
          .filter(t => t.entityId === entityId && t.categoryId === cat.id && t.type === 'expense'
            && isRealized(t) && isSameMonth(parseLocalDate(t.date), now))
          .reduce((acc, t) => acc + (Number(t.amount) || 0), 0);
        if (spent > limitValue) {
          alerts.push({
            id: `budget-${entityId}-${cat.id}`,
            title: 'Limite de gasto estourado',
            message: `${cat.name}: ${brl(spent)} gastos de um limite de ${brl(limitValue)}.`,
            type: 'warning',
          });
        }
      });
    });

    return alerts;
  }, [cards, transactions, accounts, budgetsByEntity]);

  const unreadCount = allNotifications.length;

  return (
    <div className="relative">
      <button 
        onClick={() => setIsOpen(!isOpen)}
        className="relative rounded-full p-2 text-content-subtle hover:bg-surface-muted hover:text-content-muted transition-all"
      >
        <Bell className="h-5 w-5" />
        {unreadCount > 0 && (
          <span className="absolute right-1 top-1 flex h-4 w-4 items-center justify-center rounded-full bg-red-500 text-[10px] font-bold text-white ring-2 ring-white">
            {unreadCount}
          </span>
        )}
      </button>

      <AnimatePresence>
        {isOpen && (
          <>
            <div className="fixed inset-0 z-40" onClick={() => setIsOpen(false)} />
            <motion.div 
              initial={{ opacity: 0, y: 10, scale: 0.95 }}
              animate={{ opacity: 1, y: 0, scale: 1 }}
              exit={{ opacity: 0, y: 10, scale: 0.95 }}
              className="absolute right-0 z-50 mt-2 w-80 rounded-2xl border border-line bg-surface p-4 shadow-2xl"
            >
              <div className="mb-4 flex items-center justify-between border-b pb-2">
                <h3 className="text-sm font-bold text-content">Notificações</h3>
                <span className="text-[10px] font-bold text-content-subtle uppercase tracking-wider">{unreadCount} Pendentes</span>
              </div>

              <div className="max-h-[400px] overflow-y-auto space-y-3">
                {allNotifications.length === 0 ? (
                  <div className="py-8 text-center">
                    <CheckCircle2 className="mx-auto h-8 w-8 text-gray-100" />
                    <p className="mt-2 text-xs text-content-subtle">Tudo em dia por aqui!</p>
                  </div>
                ) : (
                  allNotifications.map((n) => (
                    <div 
                      key={n.id} 
                      className={cn(
                        "flex gap-3 rounded-xl p-3 transition-all border",
                        n.type === 'warning' ? "bg-orange-50 border-orange-100" : 
                        n.type === 'error' ? "bg-red-50 border-red-100" : "bg-blue-50 border-blue-100"
                      )}
                    >
                      <div className={cn(
                        "flex h-8 w-8 shrink-0 items-center justify-center rounded-lg",
                        n.type === 'warning' ? "bg-orange-100 text-orange-600" : 
                        n.type === 'error' ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
                      )}>
                        {n.id.startsWith('budget-') ? <Target className="h-4 w-4" /> :
                         n.id.startsWith('neg-') ? <TrendingDown className="h-4 w-4" /> :
                         n.id.startsWith('overdue') ? <Landmark className="h-4 w-4" /> :
                         n.type === 'warning' ? <Clock className="h-4 w-4" /> :
                         n.type === 'error' ? <AlertCircle className="h-4 w-4" /> : <Bell className="h-4 w-4" />}
                      </div>
                      <div className="flex-1">
                        <p className="text-xs font-bold text-content">{n.title}</p>
                        <p className="mt-0.5 text-[10px] text-content-muted leading-relaxed">{n.message}</p>
                      </div>
                    </div>
                  ))
                )}
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );
};
