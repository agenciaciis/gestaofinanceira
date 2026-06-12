import React, { useEffect, useState, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { collection, query, where, onSnapshot, limit, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Transaction, BankAccount, CreditCard, Debt } from '../types';
import { CATEGORIES } from '../constants';
import { 
  TrendingUp, 
  TrendingDown, 
  DollarSign, 
  Calendar,
  ArrowUpRight,
  ArrowDownRight,
  Plus,
  Filter,
  ArrowRightLeft,
  Clock,
  AlertCircle,
  CheckCircle2,
  CreditCard as CardIcon,
  Wallet,
  ArrowRight,
  PieChart as PieIcon,
  Activity,
  ChevronRight,
  Target,
  ShieldCheck
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  AreaChart, 
  Area, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Legend,
  BarChart,
  Bar
} from 'recharts';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';
import { format, startOfMonth, endOfMonth, subMonths, addMonths, isSameMonth, isAfter, isBefore, isSameDay, isSameYear, subDays, subYears } from 'date-fns';
import { ptBR } from 'date-fns/locale';

const StatCard: React.FC<{ 
  title: string; 
  value: number; 
  type: 'income' | 'expense' | 'balance' | 'neutral'; 
  subtitle?: string;
  trend?: { value: number; isPositive: boolean };
}> = ({ title, value, type, subtitle, trend }) => (
  <motion.div 
    initial={{ opacity: 0, y: 20 }}
    animate={{ opacity: 1, y: 0 }}
    className="relative overflow-hidden rounded-2xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md transition-shadow"
  >
    <div className="flex items-center justify-between">
      <p className="text-xs font-bold uppercase tracking-wider text-gray-400">{title}</p>
      <div className={cn(
        "flex h-10 w-10 items-center justify-center rounded-xl",
        type === 'income' ? "bg-emerald-50 text-emerald-600" : 
        type === 'expense' ? "bg-rose-50 text-rose-600" : 
        type === 'balance' ? "bg-blue-50 text-blue-600" : "bg-gray-50 text-gray-600"
      )}>
        {type === 'income' ? <TrendingUp className="h-5 w-5" /> : 
         type === 'expense' ? <TrendingDown className="h-5 w-5" /> : 
         type === 'balance' ? <DollarSign className="h-5 w-5" /> : <Activity className="h-5 w-5" />}
      </div>
    </div>
    <div className="mt-4">
      <h3 className="text-2xl font-black text-gray-900">
        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
      </h3>
      <div className="mt-2 flex items-center gap-2">
        {trend && (
          <span className={cn(
            "flex items-center gap-0.5 text-xs font-bold px-1.5 py-0.5 rounded-full",
            trend.isPositive ? "bg-emerald-100 text-emerald-700" : "bg-rose-100 text-rose-700"
          )}>
            {trend.isPositive ? <ArrowUpRight className="h-3 w-3" /> : <ArrowDownRight className="h-3 w-3" />}
            {trend.value}%
          </span>
        )}
        {subtitle && <p className="text-xs text-gray-400 font-medium">{subtitle}</p>}
      </div>
    </div>
    {/* Decorative background element */}
    <div className={cn(
      "absolute -right-4 -bottom-4 h-24 w-24 rounded-full opacity-[0.03]",
      type === 'income' ? "bg-emerald-600" : 
      type === 'expense' ? "bg-rose-600" : "bg-blue-600"
    )} />
  </motion.div>
);

export const Dashboard: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { theme } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [timeFilter, setTimeFilter] = useState<'today' | 'month' | 'year'>('month');

  useEffect(() => {
    console.log('Dashboard: useEffect triggered', { entitiesCount: entities.length, filterType });
    if (entities.length === 0) {
      setLoading(false);
      return;
    }

    const filteredEntities = filterType === 'ALL' 
      ? entities 
      : entities.filter(e => e.type === filterType);

    if (filteredEntities.length === 0) {
      setTransactions([]);
      setAccounts([]);
      setCards([]);
      setLoading(false);
      return;
    }

    const entityIds = filteredEntities.map(e => e.id);
    const unsubscribes: (() => void)[] = [];
    
    let currentAccounts: BankAccount[] = [];
    let currentTransactions: Transaction[] = [];
    let currentCards: CreditCard[] = [];
    let currentDebts: Debt[] = [];

    entityIds.forEach(id => {
      // Accounts
      const unsubA = onSnapshot(query(collection(db, `entities/${id}/bank_accounts`)), (snapshot) => {
        const entityAccounts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BankAccount[];
        currentAccounts = [...currentAccounts.filter(a => a.entityId !== id), ...entityAccounts];
        setAccounts([...currentAccounts]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${id}/bank_accounts`));
      unsubscribes.push(unsubA);

      // Cards
      const unsubC = onSnapshot(query(collection(db, `entities/${id}/credit_cards`)), (snapshot) => {
        const entityCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CreditCard[];
        currentCards = [...currentCards.filter(c => c.entityId !== id), ...entityCards];
        setCards([...currentCards]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${id}/credit_cards`));
      unsubscribes.push(unsubC);

      // Debts
      const unsubD = onSnapshot(query(collection(db, `entities/${id}/debts`)), (snapshot) => {
        const entityDebts = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Debt[];
        currentDebts = [...currentDebts.filter(d => d.entityId !== id), ...entityDebts];
        setDebts([...currentDebts]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${id}/debts`));
      unsubscribes.push(unsubD);

      // Transactions
      const unsubT = onSnapshot(query(collection(db, `entities/${id}/transactions`)), (snapshot) => {
        const entityT = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Transaction[];
        currentTransactions = [...currentTransactions.filter(t => t.entityId !== id), ...entityT];
        setTransactions([...currentTransactions]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${id}/transactions`));
      unsubscribes.push(unsubT);

      // Budgets
      const unsubB = onSnapshot(doc(db, `entities/${id}/config/budgets`), (snapshot) => {
        if (snapshot.exists()) {
          setBudgets(prev => ({ ...prev, ...snapshot.data() }));
        }
      }, (error) => handleFirestoreError(error, OperationType.GET, `entities/${id}/config/budgets`));
      unsubscribes.push(unsubB);
    });

    setLoading(false);
    return () => unsubscribes.forEach(unsub => unsub());
  }, [entities, filterType]);

  // Derived Data
  const now = useMemo(() => new Date(), []);
  const currentMonthStart = startOfMonth(now);
  const lastMonthStart = subMonths(currentMonthStart, 1);

  const stats = useMemo(() => {
    const totalBankBalance = accounts.reduce((acc, a) => acc + a.currentBalance, 0);
    
    const filterFn = (date: Date, referenceDate: Date) => {
      if (timeFilter === 'today') return isSameDay(date, referenceDate);
      if (timeFilter === 'year') return isSameYear(date, referenceDate);
      return isSameMonth(date, referenceDate);
    };

    const getPreviousPeriodDate = (referenceDate: Date) => {
      if (timeFilter === 'today') return subDays(referenceDate, 1);
      if (timeFilter === 'year') return subYears(referenceDate, 1);
      return subMonths(referenceDate, 1);
    };

    const prevDate = getPreviousPeriodDate(now);

    const incomeThisPeriod = transactions
      .filter(t => t.type === 'income' && t.status === 'completed' && filterFn(new Date(t.date), now))
      .reduce((acc, t) => acc + t.amount, 0);
    
    const expenseThisPeriod = transactions
      .filter(t => t.type === 'expense' && t.status === 'completed' && filterFn(new Date(t.date), now))
      .reduce((acc, t) => acc + t.amount, 0);

    const incomeLastPeriod = transactions
      .filter(t => t.type === 'income' && t.status === 'completed' && filterFn(new Date(t.date), prevDate))
      .reduce((acc, t) => acc + t.amount, 0);

    const expenseLastPeriod = transactions
      .filter(t => t.type === 'expense' && t.status === 'completed' && filterFn(new Date(t.date), prevDate))
      .reduce((acc, t) => acc + t.amount, 0);

    const pendingIncome = transactions
      .filter(t => t.type === 'income' && t.status === 'pending')
      .reduce((acc, t) => acc + t.amount, 0);

    const pendingExpense = transactions
      .filter(t => t.type === 'expense' && t.status === 'pending')
      .reduce((acc, t) => acc + t.amount, 0);

    const overdue = transactions
      .filter(t => t.status === 'pending' && isBefore(new Date(t.date), new Date().setHours(0,0,0,0)))
      .reduce((acc, t) => acc + t.amount, 0);

    const cardDebt = transactions
      .filter(t => t.cardId && t.type === 'expense' && t.status !== 'cancelled')
      .reduce((acc, t) => acc + t.amount, 0);

    const totalOpenDebts = debts.reduce((acc, d) => acc + d.remainingAmount, 0);
    
    const calculatePayoff = (remaining: number, monthly: number, interestRate: number) => {
      if (monthly <= 0) return { months: Infinity, totalInterest: Infinity };
      const monthlyRate = interestRate / 100;
      let currentBalance = remaining;
      let totalInterest = 0;
      let months = 0;
      const MAX_MONTHS = 1200;
      while (currentBalance > 0 && months < MAX_MONTHS) {
        const interest = currentBalance * monthlyRate;
        if (interest >= monthly && currentBalance > 0.01) return { months: Infinity, totalInterest: Infinity };
        totalInterest += interest;
        currentBalance = currentBalance + interest - monthly;
        months++;
      }
      return { months, totalInterest };
    };

    const totalEstimatedInterest = debts.reduce((acc, debt) => {
      const { totalInterest } = calculatePayoff(debt.remainingAmount, debt.monthlyPayment, debt.interestRate);
      return acc + (totalInterest === Infinity ? 0 : totalInterest);
    }, 0);

    const calculateTrend = (current: number, last: number) => {
      if (last === 0) return { value: 0, isPositive: true };
      const diff = ((current - last) / last) * 100;
      return { value: Math.abs(Math.round(diff)), isPositive: diff >= 0 };
    };

    const budgetProgress = CATEGORIES.filter(c => budgets[c.id]).map(cat => {
      const isIncome = cat.type === 'income';
      const realized = transactions
        .filter(t => t.categoryId === cat.id && t.status === 'completed' && isSameMonth(new Date(t.date), now))
        .reduce((acc, t) => acc + t.amount, 0);
      const goal = budgets[cat.id];
      const percentage = goal > 0 ? (realized / goal) * 100 : 0;
      
      return {
        ...cat,
        realized,
        goal,
        percentage,
        isIncome
      };
    });

    return {
      totalBankBalance,
      incomeThisPeriod,
      expenseThisPeriod,
      pendingIncome,
      pendingExpense,
      overdue,
      cardDebt,
      totalOpenDebts,
      totalEstimatedInterest,
      netWorth: totalBankBalance - cardDebt - totalOpenDebts,
      incomeTrend: calculateTrend(incomeThisPeriod, incomeLastPeriod),
      expenseTrend: calculateTrend(expenseThisPeriod, expenseLastPeriod),
      budgetProgress
    };
  }, [transactions, accounts, debts, budgets, now, timeFilter]);

  // Chart Data: Last 6 months + Next 6 months projection
  const cashFlowData = useMemo(() => {
    const data = [];
    // Last 6 months
    for (let i = 5; i >= 0; i--) {
      const month = subMonths(now, i);
      const monthIncome = transactions
        .filter(t => t.type === 'income' && t.status === 'completed' && isSameMonth(new Date(t.date), month))
        .reduce((acc, t) => acc + t.amount, 0);
      const monthExpense = transactions
        .filter(t => t.type === 'expense' && t.status === 'completed' && isSameMonth(new Date(t.date), month))
        .reduce((acc, t) => acc + t.amount, 0);
      
      data.push({
        name: format(month, 'MMM', { locale: ptBR }),
        income: monthIncome,
        expense: monthExpense,
        incomeProjection: i === 0 ? monthIncome : null,
        expenseProjection: i === 0 ? monthExpense : null,
        isProjection: false
      });
    }

    // Next 6 months projection
    for (let i = 1; i <= 6; i++) {
      const month = addMonths(now, i);
      const monthIncome = transactions
        .filter(t => t.type === 'income' && isSameMonth(new Date(t.date), month))
        .reduce((acc, t) => acc + t.amount, 0);
      const monthExpense = transactions
        .filter(t => t.type === 'expense' && isSameMonth(new Date(t.date), month))
        .reduce((acc, t) => acc + t.amount, 0);

      data.push({
        name: format(month, 'MMM', { locale: ptBR }),
        income: null,
        expense: null,
        incomeProjection: monthIncome,
        expenseProjection: monthExpense,
        isProjection: true
      });
    }
    return data;
  }, [transactions, now]);

  const categoryDistribution = useMemo(() => {
    const filterFn = (date: Date) => {
      if (timeFilter === 'today') return isSameDay(date, now);
      if (timeFilter === 'year') return isSameYear(date, now);
      return isSameMonth(date, now);
    };

    return CATEGORIES.map(cat => {
      const amount = transactions
        .filter(t => t.categoryId === cat.id && t.type === 'expense' && t.status === 'completed' && filterFn(new Date(t.date)))
        .reduce((acc, t) => acc + t.amount, 0);
      return { name: cat.name, value: amount };
    }).filter(c => c.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [transactions, now, timeFilter]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  const upcomingBills = useMemo(() => {
    return transactions
      .filter(t => t.status === 'pending' && isAfter(new Date(t.date), new Date().setHours(0,0,0,0)))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 5);
  }, [transactions]);

  const toggleStatus = async (transaction: Transaction) => {
    try {
      const newStatus = transaction.status === 'completed' ? 'pending' : 'completed';
      await updateDoc(doc(db, `entities/${transaction.entityId}/transactions/${transaction.id}`), {
        status: newStatus
      });
    } catch (error) {
      console.error("Error updating status:", error);
    }
  };

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-black text-gray-900 tracking-tight">
            Dashboard Executivo
          </h2>
          <p className="text-gray-500 font-medium">Visão estratégica e projeções do seu ecossistema financeiro.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-gray-100 dark:bg-gray-800 p-1">
            <button 
              onClick={() => setTimeFilter('today')}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                timeFilter === 'today' 
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" 
                  : "text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-700/50"
              )}
            >
              Hoje
            </button>
            <button 
              onClick={() => setTimeFilter('month')}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                timeFilter === 'month' 
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" 
                  : "text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-700/50"
              )}
            >
              Mês
            </button>
            <button 
              onClick={() => setTimeFilter('year')}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                timeFilter === 'year' 
                  ? "bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm" 
                  : "text-gray-500 dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-700/50"
              )}
            >
              Ano
            </button>
          </div>
          <button className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all">
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Primary Stats */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard 
          title="Patrimônio Líquido" 
          value={stats.netWorth} 
          type="balance" 
          subtitle="Saldo - Dívidas"
        />
        <StatCard 
          title="Receitas" 
          value={stats.incomeThisPeriod} 
          type="income" 
          trend={stats.incomeTrend}
          subtitle={timeFilter === 'today' ? 'Hoje' : timeFilter === 'year' ? 'Este ano' : 'Este mês'}
        />
        <StatCard 
          title="Despesas" 
          value={stats.expenseThisPeriod} 
          type="expense" 
          trend={stats.expenseTrend}
          subtitle={timeFilter === 'today' ? 'Hoje' : timeFilter === 'year' ? 'Este ano' : 'Este mês'}
        />
        <StatCard 
          title="Dívidas em Aberto" 
          value={stats.totalOpenDebts} 
          type="expense" 
          subtitle={`Juros Est.: ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.totalEstimatedInterest)}`}
        />
      </div>

      {/* Goals Progress Section */}
      {stats.budgetProgress.length > 0 && (
        <div className="grid gap-6 lg:grid-cols-2">
          {/* Income Goals */}
          <div className="rounded-3xl bg-white p-8 shadow-sm border border-slate-100">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Target className="h-5 w-5 text-emerald-500" />
                Metas de Receita
              </h3>
              <span className="text-[10px] font-bold text-slate-400 uppercase">Este Mês</span>
            </div>
            <div className="space-y-6">
              {stats.budgetProgress.filter(p => p.isIncome).length > 0 ? (
                stats.budgetProgress.filter(p => p.isIncome).map(p => (
                  <div key={p.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-sm font-bold text-slate-700">{p.name}</span>
                      </div>
                      <span className="text-xs font-black text-slate-900">
                        {p.percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(p.percentage, 100)}%` }}
                        className="h-full bg-emerald-500 rounded-full"
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-slate-400">
                      <span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.realized)}</span>
                      <span>Meta: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.goal)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">Nenhuma meta de receita definida.</p>
              )}
            </div>
          </div>

          {/* Expense Goals */}
          <div className="rounded-3xl bg-white p-8 shadow-sm border border-slate-100">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2">
                <Target className="h-5 w-5 text-rose-500" />
                Limites de Gastos
              </h3>
              <span className="text-[10px] font-bold text-slate-400 uppercase">Este Mês</span>
            </div>
            <div className="space-y-6">
              {stats.budgetProgress.filter(p => !p.isIncome).length > 0 ? (
                stats.budgetProgress.filter(p => !p.isIncome).map(p => (
                  <div key={p.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-sm font-bold text-slate-700">{p.name}</span>
                      </div>
                      <span className={cn(
                        "text-xs font-black",
                        p.percentage >= 100 ? "text-rose-600" : p.percentage >= 80 ? "text-amber-600" : "text-slate-900"
                      )}>
                        {p.percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(p.percentage, 100)}%` }}
                        className={cn(
                          "h-full rounded-full",
                          p.percentage >= 100 ? "bg-rose-500" : p.percentage >= 80 ? "bg-amber-500" : "bg-primary"
                        )}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-slate-400">
                      <span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.realized)}</span>
                      <span>Limite: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.goal)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-slate-400 text-center py-4">Nenhum limite de gasto definido.</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Alerts & Critical Info */}
      <AnimatePresence>
        {(stats.overdue > 0 || stats.pendingExpense > 0) && (
          <motion.div 
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="grid gap-4 sm:grid-cols-2"
          >
            {stats.overdue > 0 && (
              <div className="flex items-center gap-4 rounded-2xl border border-rose-100 bg-rose-50 p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-rose-100 text-rose-600">
                  <AlertCircle className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-rose-400">Atenção: Pagamentos Atrasados</p>
                  <p className="text-xl font-black text-rose-700">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.overdue)}
                  </p>
                </div>
                <button className="ml-auto rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700">Resolver</button>
              </div>
            )}
            {stats.pendingExpense > 0 && (
              <div className="flex items-center gap-4 rounded-2xl border border-amber-100 bg-amber-50 p-4">
                <div className="flex h-12 w-12 items-center justify-center rounded-full bg-amber-100 text-amber-600">
                  <Clock className="h-6 w-6" />
                </div>
                <div>
                  <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Compromissos Pendentes</p>
                  <p className="text-xl font-black text-amber-700">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.pendingExpense)}
                  </p>
                </div>
                <button className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">Ver Lista</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Cash Flow Forecast */}
        <div className="lg:col-span-2 rounded-3xl bg-white p-8 shadow-sm border border-slate-100">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black text-slate-900">Fluxo de Caixa & Projeção</h3>
              <p className="text-xs font-medium text-slate-400">Histórico de 6 meses e previsão para os próximos 6.</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-bold text-slate-500 uppercase">Receitas</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="text-[10px] font-bold text-slate-500 uppercase">Despesas</span>
              </div>
            </div>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashFlowData}>
                <defs>
                  <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0}/>
                  </linearGradient>
                  <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#1f2937' : '#f1f5f9'} />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: theme === 'dark' ? '#64748b' : '#94a3b8', fontSize: 10, fontWeight: 700 }}
                  dy={10}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: theme === 'dark' ? '#64748b' : '#94a3b8', fontSize: 10, fontWeight: 700 }}
                  tickFormatter={(value) => `R$ ${value >= 1000 ? (value/1000).toFixed(0) + 'k' : value}`}
                />
                <Tooltip 
                  contentStyle={{ 
                    borderRadius: '16px', 
                    border: 'none', 
                    boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', 
                    padding: '12px',
                    backgroundColor: theme === 'dark' ? '#111827' : '#ffffff',
                    color: theme === 'dark' ? '#f9fafb' : '#111827'
                  }}
                  itemStyle={{ fontSize: '12px', fontWeight: 'bold' }}
                  labelStyle={{ fontSize: '10px', fontWeight: 'black', textTransform: 'uppercase', color: '#94a3b8', marginBottom: '4px' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="income" 
                  name="Receita"
                  stroke="#10b981" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorIncome)" 
                  dot={false}
                />
                <Area 
                  type="monotone" 
                  dataKey="incomeProjection" 
                  name="Receita (Projeção)"
                  stroke="#10b981" 
                  strokeWidth={3}
                  strokeDasharray="5 5"
                  fillOpacity={1} 
                  fill="url(#colorIncome)" 
                  dot={(props: any) => {
                    if (props.payload.isProjection) return <circle key={`dot-income-${props.index}`} cx={props.cx} cy={props.cy} r={3} fill="#10b981" strokeWidth={0} />;
                    return null;
                  }}
                  legendType="none"
                />
                <Area 
                  type="monotone" 
                  dataKey="expense" 
                  name="Despesa"
                  stroke="#f43f5e" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorExpense)" 
                  dot={false}
                />
                <Area 
                  type="monotone" 
                  dataKey="expenseProjection" 
                  name="Despesa (Projeção)"
                  stroke="#f43f5e" 
                  strokeWidth={3}
                  strokeDasharray="5 5"
                  fillOpacity={1} 
                  fill="url(#colorExpense)" 
                  dot={(props: any) => {
                    if (props.payload.isProjection) return <circle key={`dot-expense-${props.index}`} cx={props.cx} cy={props.cy} r={3} fill="#f43f5e" strokeWidth={0} />;
                    return null;
                  }}
                  legendType="none"
                />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Category Breakdown */}
        <div className="rounded-3xl bg-white p-8 shadow-sm border border-slate-100">
          <h3 className="text-lg font-black text-slate-900">Distribuição de Gastos</h3>
          <p className="text-xs font-medium text-slate-400 mb-8">
            {timeFilter === 'today' ? 'Gastos de hoje.' : timeFilter === 'year' ? 'Gastos deste ano.' : 'Onde seu dinheiro está indo este mês.'}
          </p>
          <div className="h-[300px] w-full">
            {categoryDistribution.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={categoryDistribution}
                    cx="50%"
                    cy="50%"
                    innerRadius={70}
                    outerRadius={90}
                    paddingAngle={8}
                    dataKey="value"
                  >
                    {categoryDistribution.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={COLORS[index % COLORS.length]} />
                    ))}
                  </Pie>
                  <Tooltip 
                    formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                  />
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-center">
                <div className="mb-4 rounded-full bg-slate-50 p-4">
                  <PieIcon className="h-8 w-8 text-slate-300" />
                </div>
                <p className="text-sm font-bold text-slate-400">Sem dados este mês</p>
              </div>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {categoryDistribution.map((cat, i) => (
              <div key={cat.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-xs font-bold text-slate-600">{cat.name}</span>
                </div>
                <span className="text-xs font-black text-slate-900">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cat.value)}
                </span>
              </div>
            ))}
          </div>
        </div>
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Bank Accounts & Cards Summary */}
        <div className="space-y-6">
          <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-slate-400">Contas Bancárias</h3>
            <div className="space-y-4">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center justify-between p-3 rounded-2xl bg-slate-50 hover:bg-slate-100 transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl bg-white shadow-sm",
                      acc.type === 'investimento' ? "text-blue-600" :
                      acc.type === 'reserva' ? "text-amber-600" :
                      acc.type === 'caixa' ? "text-slate-600" : "text-primary"
                    )}>
                      {acc.type === 'caixa' ? <DollarSign className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900">{acc.bankName}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase">
                        {acc.type === 'corrente' ? 'Corrente' : 
                         acc.type === 'poupanca' ? 'Poupança' :
                         acc.type === 'investimento' ? 'Investimento' :
                         acc.type === 'caixa' ? 'Caixa' : 'Reserva'}
                      </p>
                    </div>
                  </div>
                  <p className="text-sm font-black text-slate-900">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(acc.currentBalance)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100">
            <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-slate-400">Cartões de Crédito</h3>
            <div className="space-y-4">
              {cards.map(card => {
                const used = transactions
                  .filter(t => t.cardId === card.id && t.type === 'expense' && t.status !== 'cancelled')
                  .reduce((acc, t) => acc + t.amount, 0);
                const usage = (used / card.limit) * 100;
                return (
                  <div key={card.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CardIcon className="h-4 w-4 text-slate-400" />
                        <span className="text-sm font-bold text-slate-900">{card.name}</span>
                      </div>
                      <span className="text-xs font-black text-slate-900">{usage.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(usage, 100)}%` }}
                        className={cn(
                          "h-full rounded-full",
                          usage >= 90 ? "bg-rose-500" : usage >= 70 ? "bg-amber-500" : "bg-primary"
                        )}
                      />
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>

        {/* Upcoming Bills */}
        <div className="rounded-3xl bg-white p-8 shadow-sm border border-slate-100">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-900">Próximos Vencimentos</h3>
            <Calendar className="h-5 w-5 text-slate-300" />
          </div>
          <div className="space-y-6">
            {upcomingBills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ShieldCheck className="h-12 w-12 text-emerald-100 mb-4" />
                <p className="text-sm font-bold text-slate-400">Tudo em dia!</p>
                <p className="text-xs text-slate-300">Nenhum pagamento pendente próximo.</p>
              </div>
            ) : (
              upcomingBills.map(t => (
                <div key={t.id} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center justify-center h-12 w-12 rounded-2xl bg-slate-50 border border-slate-100 group-hover:bg-primary group-hover:border-primary transition-all">
                      <span className="text-[10px] font-black text-slate-400 group-hover:text-white/70 uppercase">
                        {format(new Date(t.date), 'MMM', { locale: ptBR })}
                      </span>
                      <span className="text-lg font-black text-slate-900 group-hover:text-white leading-none">
                        {format(new Date(t.date), 'dd')}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-slate-900 group-hover:text-primary transition-colors">{t.description}</p>
                      <p className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        {CATEGORIES.find(c => c.id === t.categoryId)?.name}
                      </p>
                    </div>
                  </div>
                  <div className="text-right">
                    <p className="text-sm font-black text-slate-900">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.amount)}
                    </p>
                    <button 
                      onClick={() => toggleStatus(t)}
                      className="text-[10px] font-bold text-primary hover:underline"
                    >
                      Pagar agora
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {upcomingBills.length > 0 && (
            <button className="mt-8 w-full rounded-2xl bg-slate-50 py-3 text-xs font-black uppercase tracking-widest text-slate-400 hover:bg-slate-100 hover:text-slate-600 transition-all">
              Ver Calendário Completo
            </button>
          )}
        </div>

        {/* Recent Activity */}
        <div className="rounded-3xl bg-white p-8 shadow-sm border border-slate-100">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-black text-slate-900">Atividade Recente</h3>
            <Activity className="h-5 w-5 text-slate-300" />
          </div>
          <div className="space-y-6">
            {transactions.slice(0, 6).map(t => (
              <div key={t.id} className="flex items-center justify-between">
                <div className="flex items-center gap-4">
                  <div className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl",
                    t.type === 'income' ? "bg-emerald-50 text-emerald-600" : 
                    t.type === 'expense' ? "bg-rose-50 text-rose-600" : "bg-blue-50 text-blue-600"
                  )}>
                    {t.type === 'income' ? <ArrowUpRight className="h-5 w-5" /> : 
                     t.type === 'expense' ? <ArrowDownRight className="h-5 w-5" /> : <ArrowRightLeft className="h-5 w-5" />}
                  </div>
                  <div>
                    <p className="text-sm font-bold text-slate-900 truncate max-w-[120px]">{t.description}</p>
                    <p className="text-[10px] font-bold text-slate-400 uppercase">{format(new Date(t.date), 'dd MMM')}</p>
                  </div>
                </div>
                <p className={cn(
                  "text-sm font-black",
                  t.type === 'income' ? "text-emerald-600" : "text-rose-600"
                )}>
                  {t.type === 'income' ? '+' : '-'} {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.amount)}
                </p>
              </div>
            ))}
          </div>
          <button className="mt-8 w-full flex items-center justify-center gap-2 rounded-2xl border border-slate-100 py-3 text-xs font-black uppercase tracking-widest text-slate-600 hover:bg-slate-50 transition-all">
            Ver Extrato Completo
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
