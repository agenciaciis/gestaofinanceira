import React, { useEffect, useState, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { collection, query, where, onSnapshot, limit, orderBy, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Transaction, BankAccount, CreditCard, Debt } from '../types';
import { CATEGORIES, MONTHS } from '../constants';
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
import { computeBalances, parseLocalDate, isNotCancelled, computeCardInvoice, round2 } from '../lib/finance';
import { collectDebts, payoffSchedule } from '../lib/debts';
import { computeSpendable, detectDuplicateLoanCommitments, suggestReserve } from '../lib/spendable';
import { consolidate } from '../lib/crossEntity';
import { CrossEntityTransferModal } from '../components/CrossEntityTransferModal';

/** Chave da reserva protegida — preferência deste dispositivo. */
const RESERVE_STORAGE_KEY = 'finanflow:reserva-protegida';

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
    transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
    whileHover={{ y: -4 }}
    className="relative overflow-hidden rounded-2xl bg-surface p-6 shadow-sm border border-line hover:shadow-lg transition-shadow duration-300"
  >
    <div className="flex items-center justify-between">
      <p className="text-xs font-bold uppercase tracking-wider text-content-subtle">{title}</p>
      <div className={cn(
        "flex h-10 w-10 items-center justify-center rounded-xl",
        type === 'income' ? "bg-emerald-50 text-emerald-600" : 
        type === 'expense' ? "bg-rose-50 text-rose-600" : 
        type === 'balance' ? "bg-blue-50 text-blue-600" : "bg-canvas text-content-muted"
      )}>
        {type === 'income' ? <TrendingUp className="h-5 w-5" /> : 
         type === 'expense' ? <TrendingDown className="h-5 w-5" /> : 
         type === 'balance' ? <DollarSign className="h-5 w-5" /> : <Activity className="h-5 w-5" />}
      </div>
    </div>
    <div className="mt-4">
      <h3 className="text-2xl font-black text-content">
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
        {subtitle && <p className="text-xs text-content-subtle font-medium">{subtitle}</p>}
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

export const Dashboard: React.FC<{ onNavigate?: (page: string) => void }> = ({ onNavigate }) => {
  const { entities, filterType } = useEntity();
  const { theme } = useTheme();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [debts, setDebts] = useState<Debt[]>([]);
  const [loading, setLoading] = useState(true);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [timeFilter, setTimeFilter] = useState<'today' | 'month' | 'year'>('month');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  // Vazio = usar a reserva sugerida pelo sistema.
  const [reserveOverride, setReserveOverride] = useState<string>(
    () => (typeof localStorage !== 'undefined' && localStorage.getItem(RESERVE_STORAGE_KEY)) || ''
  );
  const [isCrossEntityOpen, setIsCrossEntityOpen] = useState(false);

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
  /** Hoje de verdade — para "posso gastar", reserva e duplicidade, que são do agora. */
  const hoje = useMemo(() => new Date(), []);
  /**
   * Referência do PERÍODO analisado. "Hoje" sempre aponta para hoje; Mês e Ano
   * respeitam o seletor, para dar para olhar março de 2026.
   */
  const now = useMemo(
    () => (timeFilter === 'today' ? hoje : new Date(selectedYear, selectedMonth, 15)),
    [timeFilter, hoje, selectedYear, selectedMonth]
  );
  const currentMonthStart = startOfMonth(now);
  const lastMonthStart = subMonths(currentMonthStart, 1);

  // Saldo calculado por conta (fonte da verdade), usado também na lista lateral.
  const accountBalances = useMemo(() => computeBalances(accounts, transactions), [accounts, transactions]);

  const stats = useMemo(() => {
    const balancesByAccount = computeBalances(accounts, transactions);
    const totalBankBalance = Object.values(balancesByAccount).reduce((acc, v) => acc + v, 0);

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
      .filter(t => t.type === 'income' && t.status === 'completed' && filterFn(parseLocalDate(t.date), now))
      .reduce((acc, t) => acc + t.amount, 0);
    
    const expenseThisPeriod = transactions
      .filter(t => t.type === 'expense' && t.status === 'completed' && filterFn(parseLocalDate(t.date), now))
      .reduce((acc, t) => acc + t.amount, 0);

    const incomeLastPeriod = transactions
      .filter(t => t.type === 'income' && t.status === 'completed' && filterFn(parseLocalDate(t.date), prevDate))
      .reduce((acc, t) => acc + t.amount, 0);

    const expenseLastPeriod = transactions
      .filter(t => t.type === 'expense' && t.status === 'completed' && filterFn(parseLocalDate(t.date), prevDate))
      .reduce((acc, t) => acc + t.amount, 0);

    // Pendentes DO PERÍODO analisado. Antes somavam qualquer data, então
    // trocar de mês não mexia em "a receber", "a pagar" nem no previsto —
    // metade do painel ficava parada.
    const pendingIncome = transactions
      .filter(t => t.type === 'income' && t.status === 'pending' && filterFn(parseLocalDate(t.date), now))
      .reduce((acc, t) => acc + t.amount, 0);

    const pendingExpense = transactions
      .filter(t => t.type === 'expense' && t.status === 'pending' && filterFn(parseLocalDate(t.date), now))
      .reduce((acc, t) => acc + t.amount, 0);

    // Vencidas é "até hoje", não do período: uma conta vencida continua vencida
    // independente do mês que você está olhando.
    const inicioDeHoje = new Date(hoje.getFullYear(), hoje.getMonth(), hoje.getDate());
    const overdue = transactions
      .filter(t => t.status === 'pending' && t.type === 'expense' && isBefore(parseLocalDate(t.date), inicioDeHoje))
      .reduce((acc, t) => acc + t.amount, 0);

    // Dívida de cartão = soma das faturas EM ABERTO (ciclo atual), não o histórico inteiro.
    const cardDebt = cards.reduce((acc, card) => acc + computeCardInvoice(card.id, card.closingDay, transactions, now), 0);

    // Mesma fonte de verdade da tela de Saúde Financeira: parcelamentos em
    // aberto + dívidas com juros + fatura de cartão. Os dois números batem.
    const debtViews = collectDebts(transactions, debts, cards, {}, now);
    const totalOpenDebts = round2(debtViews.reduce((acc, v) => acc + v.balance, 0));
    const totalEstimatedInterest = payoffSchedule(debtViews, 0, 'avalanche', now).totalInterest;

    const calculateTrend = (current: number, last: number) => {
      if (last === 0) return { value: 0, isPositive: true };
      const diff = ((current - last) / last) * 100;
      return { value: Math.abs(Math.round(diff)), isPositive: diff >= 0 };
    };

    const budgetProgress = CATEGORIES.filter(c => budgets[c.id]).map(cat => {
      const isIncome = cat.type === 'income';
      const realized = transactions
        .filter(t => t.categoryId === cat.id && t.status === 'completed' && isSameMonth(parseLocalDate(t.date), now))
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
      // A fatura de cartão já está dentro de totalOpenDebts — subtrair de novo
      // contaria a mesma dívida duas vezes.
      // Os dois que faltavam do painel da planilha antiga.
      resultadoPeriodo: round2(incomeThisPeriod - expenseThisPeriod),
      resultadoPrevisto: round2((incomeThisPeriod + pendingIncome) - (expenseThisPeriod + pendingExpense)),
      netWorth: round2(totalBankBalance - totalOpenDebts),
      incomeTrend: calculateTrend(incomeThisPeriod, incomeLastPeriod),
      expenseTrend: calculateTrend(expenseThisPeriod, expenseLastPeriod),
      budgetProgress
    };
  }, [transactions, accounts, cards, debts, budgets, now, hoje, timeFilter]);

  /**
   * "Posso gastar?" — quanto sobra hoje já descontando tudo que está
   * comprometido até o fim do mês, o gasto variável esperado e a reserva.
   */
  const reserveSuggestion = useMemo(
    () => suggestReserve(transactions, hoje, stats.totalOpenDebts > 0),
    [transactions, hoje, stats.totalOpenDebts]
  );

  const activeReserve = reserveOverride.trim() === ''
    ? reserveSuggestion.amount
    : Math.max(0, Number(reserveOverride) || 0);

  const spendable = useMemo(
    () => computeSpendable({
      accounts,
      transactions,
      cards,
      loans: debts.map(d => ({ id: d.id, name: d.name, monthlyPayment: d.monthlyPayment })),
      reserve: activeReserve,
      reference: hoje,
    }),
    [accounts, transactions, cards, debts, activeReserve, hoje]
  );

  const duplicateLoans = useMemo(
    () => detectDuplicateLoanCommitments(
      debts.map(d => ({ id: d.id, name: d.name, monthlyPayment: d.monthlyPayment })),
      transactions,
      hoje
    ),
    [debts, transactions, hoje]
  );

  /** Consolidação PF × PJ do mês, com o movimento interno anulado. */
  const group = useMemo(() => consolidate(transactions, entities, now), [transactions, entities, now]);

  const saveReserve = (value: string) => {
    setReserveOverride(value);
    try {
      if (value.trim() === '') localStorage.removeItem(RESERVE_STORAGE_KEY);
      else localStorage.setItem(RESERVE_STORAGE_KEY, value);
    } catch {
      // localStorage indisponível (aba privada): segue só em memória.
    }
  };

  // Chart Data: Last 6 months + Next 6 months projection
  const cashFlowData = useMemo(() => {
    const data = [];
    // Last 6 months
    for (let i = 5; i >= 0; i--) {
      const month = subMonths(now, i);
      const monthIncome = transactions
        .filter(t => t.type === 'income' && t.status === 'completed' && isSameMonth(parseLocalDate(t.date), month))
        .reduce((acc, t) => acc + t.amount, 0);
      const monthExpense = transactions
        .filter(t => t.type === 'expense' && t.status === 'completed' && isSameMonth(parseLocalDate(t.date), month))
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
        .filter(t => t.type === 'income' && isNotCancelled(t) && isSameMonth(parseLocalDate(t.date), month))
        .reduce((acc, t) => acc + t.amount, 0);
      const monthExpense = transactions
        .filter(t => t.type === 'expense' && isNotCancelled(t) && isSameMonth(parseLocalDate(t.date), month))
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
        .filter(t => t.categoryId === cat.id && t.type === 'expense' && t.status === 'completed' && filterFn(parseLocalDate(t.date)))
        .reduce((acc, t) => acc + t.amount, 0);
      return { name: cat.name, value: amount };
    }).filter(c => c.value > 0).sort((a, b) => b.value - a.value).slice(0, 6);
  }, [transactions, now, timeFilter]);

  const COLORS = ['#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#ec4899'];

  const upcomingBills = useMemo(() => {
    return transactions
      .filter(t => t.status === 'pending' && isAfter(parseLocalDate(t.date), new Date().setHours(0,0,0,0)))
      .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime())
      .slice(0, 5);
  }, [transactions]);

  const toggleStatus = async (transaction: Transaction) => {
    try {
      const completing = transaction.status !== 'completed';
      await updateDoc(doc(db, `entities/${transaction.entityId}/transactions/${transaction.id}`), {
        status: completing ? 'completed' : 'pending',
        paidAt: completing ? new Date().toISOString().split('T')[0] : null,
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
          <h2 className="text-3xl font-black text-content tracking-tight">
            Dashboard Executivo
          </h2>
          <p className="text-content-subtle font-medium">Visão estratégica e projeções do seu ecossistema financeiro.</p>
        </div>
        <div className="flex items-center gap-3">
          <div className="flex items-center gap-2 rounded-xl bg-surface-muted dark:bg-gray-800 p-1">
            <button 
              onClick={() => setTimeFilter('today')}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                timeFilter === 'today' 
                  ? "bg-surface dark:bg-gray-700 text-content dark:text-gray-100 shadow-sm" 
                  : "text-content-subtle dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-700/50"
              )}
            >
              Hoje
            </button>
            <button 
              onClick={() => setTimeFilter('month')}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                timeFilter === 'month' 
                  ? "bg-surface dark:bg-gray-700 text-content dark:text-gray-100 shadow-sm" 
                  : "text-content-subtle dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-700/50"
              )}
            >
              Mês
            </button>
            <button 
              onClick={() => setTimeFilter('year')}
              className={cn(
                "rounded-lg px-3 py-1.5 text-xs font-bold transition-all",
                timeFilter === 'year' 
                  ? "bg-surface dark:bg-gray-700 text-content dark:text-gray-100 shadow-sm" 
                  : "text-content-subtle dark:text-gray-400 hover:bg-white/50 dark:hover:bg-gray-700/50"
              )}
            >
              Ano
            </button>
          </div>
          {timeFilter !== 'today' && (
            <div className="flex items-center gap-1 rounded-xl border border-line px-2 py-1">
              {timeFilter === 'month' && (
                <select
                  value={selectedMonth}
                  onChange={(e) => setSelectedMonth(Number(e.target.value))}
                  aria-label="Mês analisado"
                  className="rounded-lg bg-transparent px-2 py-1 text-xs font-bold text-content outline-none"
                >
                  {MONTHS.map((m, i) => <option key={m} value={i}>{m}</option>)}
                </select>
              )}
              <select
                value={selectedYear}
                onChange={(e) => setSelectedYear(Number(e.target.value))}
                aria-label="Ano analisado"
                className="rounded-lg bg-transparent px-2 py-1 text-xs font-bold text-content outline-none"
              >
                {Array.from({ length: 7 }, (_, i) => hoje.getFullYear() - 4 + i).map(y => (
                  <option key={y} value={y}>{y}</option>
                ))}
              </select>
            </div>
          )}
          {entities.length > 1 && (
            <button
              onClick={() => setIsCrossEntityOpen(true)}
              className="rounded-xl border border-line dark:border-gray-700 px-4 py-2 text-xs font-bold text-content-muted dark:text-gray-300 hover:bg-surface-muted dark:hover:bg-gray-800 transition-all"
              title="Pró-labore, distribuição de lucros, aporte ou reembolso entre PF e PJ"
            >
              Movimento PF ⇄ PJ
            </button>
          )}
          <button
            onClick={() => onNavigate?.('transactions')}
            title="Novo lançamento"
            aria-label="Novo lançamento"
            className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
          >
            <Plus className="h-5 w-5" />
          </button>
        </div>
      </div>

      {/* Painel do período — os 8 indicadores juntos, como na planilha antiga.
          Antes estavam espalhados entre Dashboard, Lançamentos e Relatórios. */}
      <div className="rounded-3xl bg-surface p-6 shadow-sm border border-line">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h3 className="text-sm font-black uppercase tracking-widest text-content-subtle">
            Painel de {timeFilter === 'today' ? 'hoje' : timeFilter === 'year' ? selectedYear : `${MONTHS[selectedMonth]} de ${selectedYear}`}
          </h3>
          <span className="text-xs text-content-subtle">Tudo abaixo responde ao período escolhido acima.</span>
        </div>

        <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          {[
            { rotulo: 'Saldo geral', valor: stats.totalBankBalance, cor: 'text-content', nota: 'todas as contas, hoje' },
            { rotulo: 'Receita', valor: stats.incomeThisPeriod, cor: 'text-emerald-600', nota: 'recebido no período' },
            { rotulo: 'Despesa', valor: -stats.expenseThisPeriod, cor: 'text-rose-600', nota: 'pago no período' },
            { rotulo: 'Resultado do período', valor: stats.resultadoPeriodo, cor: stats.resultadoPeriodo >= 0 ? 'text-emerald-600' : 'text-rose-600', nota: 'receita − despesa' },
            { rotulo: 'Valores a receber', valor: stats.pendingIncome, cor: 'text-blue-600', nota: 'ainda não entrou' },
            { rotulo: 'Valores a pagar', valor: -stats.pendingExpense, cor: 'text-amber-600', nota: 'ainda não saiu' },
            { rotulo: 'Resultado previsto', valor: stats.resultadoPrevisto, cor: stats.resultadoPrevisto >= 0 ? 'text-emerald-600' : 'text-rose-600', nota: 'se tudo se confirmar' },
            { rotulo: 'Vencidas', valor: -stats.overdue, cor: 'text-rose-600', nota: 'até hoje, todo o histórico' },
          ].map(item => (
            <div key={item.rotulo} className="rounded-2xl border border-line p-4">
              <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">{item.rotulo}</p>
              <p className={cn('mt-1 text-xl font-black tracking-tight tabular-nums', item.cor)}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.valor)}
              </p>
              <p className="mt-0.5 text-[10px] text-content-subtle">{item.nota}</p>
            </div>
          ))}
        </div>

        <p className="mt-4 text-xs text-content-subtle">
          O ponto de equilíbrio fica em <strong>Relatórios</strong>, porque depende de você classificar
          cada categoria como custo variável ou despesa fixa — sem isso o número seria um chute.
        </p>
      </div>

      {/* Posso gastar? */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className={cn(
          'rounded-3xl p-8 border',
          spendable.spendable >= 0
            ? 'bg-emerald-50 dark:bg-emerald-950/40 border-emerald-100 dark:border-emerald-900/40'
            : 'bg-rose-50 dark:bg-rose-950/40 border-rose-100 dark:border-rose-900/40'
        )}>
          <p className={cn(
            'text-[10px] font-black uppercase tracking-widest',
            spendable.spendable >= 0 ? 'text-emerald-600' : 'text-rose-500'
          )}>
            Posso gastar
          </p>
          <p className={cn(
            'mt-1 text-4xl font-black tracking-tighter',
            spendable.spendable >= 0 ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'
          )}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(spendable.spendable)}
          </p>
          <p className="mt-2 text-sm font-medium text-content-muted dark:text-slate-400">
            {spendable.spendable >= 0
              ? `Livre para gastar nos ${spendable.daysLeft} dias que faltam do mês, sem furar nenhum compromisso.`
              : 'Seus compromissos do mês já passam do que você tem. Não assuma gasto novo — veja o que dá para adiar ou renegociar.'}
          </p>
        </div>

        {/* De onde sai esse número */}
        <div className="lg:col-span-2 rounded-3xl bg-surface dark:bg-gray-900 p-8 shadow-sm border border-line dark:border-gray-800">
          <h4 className="text-sm font-black text-content dark:text-gray-100 uppercase tracking-widest">
            De onde sai esse número
          </h4>
          <div className="mt-4 space-y-2 text-sm">
            {[
              { label: 'Saldo real nas contas', value: spendable.balance, positive: true },
              { label: 'Contas a pagar até o fim do mês', value: -spendable.billsDueThisMonth },
              { label: 'Fatura de cartão em aberto', value: -spendable.cardInvoices },
              { label: 'Parcela de empréstimos cadastrados', value: -spendable.loanPayments },
              { label: `Gasto variável esperado (${spendable.daysLeft} dias)`, value: -spendable.expectedVariable },
              { label: 'Reserva protegida', value: -spendable.reserve },
            ].map(row => (
              <div key={row.label} className="flex justify-between border-b border-slate-50 dark:border-gray-800 pb-1.5">
                <span className="text-content-muted dark:text-slate-400 font-medium">{row.label}</span>
                <span className={cn(
                  'font-black tabular-nums',
                  row.positive ? 'text-content dark:text-gray-100' : 'text-rose-600'
                )}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(row.value)}
                </span>
              </div>
            ))}
          </div>

          <div className="mt-6 rounded-2xl bg-surface-muted dark:bg-gray-800/60 p-5">
            <label className="text-[10px] font-black text-content-subtle uppercase tracking-widest">
              Reserva de emergência protegida
            </label>
            <div className="mt-2 flex flex-wrap items-center gap-3">
              <div className="relative">
                <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-content-subtle">R$</span>
                <input
                  type="number"
                  min="0"
                  step="100"
                  value={reserveOverride}
                  onChange={(e) => saveReserve(e.target.value)}
                  placeholder={String(Math.round(reserveSuggestion.amount))}
                  className="w-44 rounded-xl border border-line dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 py-2 pl-10 pr-3 text-sm font-bold outline-none focus:border-emerald-500"
                />
              </div>
              <p className="text-xs text-content-subtle dark:text-slate-400 flex-1 min-w-[16rem]">
                {reserveSuggestion.monthlyExpense === 0 ? (
                  <>Ainda não tenho histórico para sugerir um valor. Informe quanto você quer manter intocado.</>
                ) : stats.totalOpenDebts > 0 ? (
                  <>
                    Sugestão: <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(reserveSuggestion.amount)}</strong> —
                    1 mês da sua despesa média. Enquanto há dívida, uma reserva pequena basta como para-choque;
                    o resto rende mais atacando a dívida. Quitada, suba para 6 meses.
                  </>
                ) : (
                  <>
                    Sugestão: <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(reserveSuggestion.amount)}</strong> —
                    6 meses da sua despesa média. Sem dívida, agora é hora do colchão de verdade.
                  </>
                )}
                {reserveOverride.trim() !== '' && <> <em>(usando o seu valor; apague para voltar à sugestão)</em></>}
              </p>
            </div>
          </div>
        </div>
      </div>

      {duplicateLoans.length > 0 && (
        <div className="rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/40 p-5">
          <p className="text-sm font-black text-amber-800 dark:text-amber-300">
            Possível cobrança em dobro no "Posso gastar"
          </p>
          <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
            {duplicateLoans.map(l => l.name).join(', ')} {duplicateLoans.length === 1 ? 'está cadastrado' : 'estão cadastrados'} em
            Dívidas <strong>e</strong> também {duplicateLoans.length === 1 ? 'aparece' : 'aparecem'} como conta a pagar deste mês.
            A parcela pode estar sendo descontada duas vezes. Mantenha só um dos dois — não corrijo sozinho para não esconder um compromisso real.
          </p>
        </div>
      )}

      {/* Consolidado PF x PJ */}
      {entities.length > 1 && (
        <div className="rounded-3xl bg-surface dark:bg-gray-900 p-8 shadow-sm border border-line dark:border-gray-800">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h4 className="text-sm font-black text-content dark:text-gray-100 uppercase tracking-widest">
                Consolidado do mês — PF e PJ
              </h4>
              <p className="text-xs text-content-subtle mt-1">
                Dinheiro que só mudou de bolso entre suas entidades não conta como receita nem despesa aqui.
              </p>
            </div>
          </div>

          <div className="mt-6 grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
            {(['PF', 'PJ'] as const).map(t => (
              <div key={t} className="rounded-2xl border border-line dark:border-gray-800 p-5">
                <p className="text-[10px] font-black text-content-subtle uppercase tracking-widest">{t === 'PF' ? 'Pessoa Física' : 'Pessoa Jurídica'}</p>
                <p className={cn(
                  'mt-1 text-2xl font-black tracking-tighter',
                  group.byType[t].net >= 0 ? 'text-emerald-600' : 'text-rose-600'
                )}>
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(group.byType[t].net)}
                </p>
                <p className="mt-1 text-[11px] text-content-subtle">
                  Entrou {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(group.byType[t].income)} ·
                  Saiu {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(group.byType[t].expense)}
                </p>
              </div>
            ))}

            <div className="rounded-2xl border border-indigo-100 dark:border-indigo-900/40 bg-indigo-50 dark:bg-indigo-950/40 p-5">
              <p className="text-[10px] font-black text-indigo-500 uppercase tracking-widest">Resultado do grupo</p>
              <p className={cn(
                'mt-1 text-2xl font-black tracking-tighter',
                group.consolidated.net >= 0 ? 'text-emerald-600' : 'text-rose-600'
              )}>
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(group.consolidated.net)}
              </p>
              <p className="mt-1 text-[11px] text-content-subtle dark:text-slate-400">Sem o movimento interno</p>
            </div>

            <div className="rounded-2xl border border-line dark:border-gray-800 p-5">
              <p className="text-[10px] font-black text-content-subtle uppercase tracking-widest">Movimento interno</p>
              <p className="mt-1 text-2xl font-black tracking-tighter text-content-muted dark:text-gray-300">
                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(group.internalFlow)}
              </p>
              <p className="mt-1 text-[11px] text-content-subtle">Pró-labore, aportes e afins</p>
            </div>
          </div>

          {group.personalExpensePaidByCompany > 0 && (
            <div className="mt-6 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-100 dark:border-amber-900/40 p-4">
              <p className="text-sm font-bold text-amber-800 dark:text-amber-300">
                A empresa pagou {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(group.personalExpensePaidByCompany)} de despesa pessoal este mês
              </p>
              <p className="mt-1 text-xs text-amber-700 dark:text-amber-400">
                Misturar as contas confunde o resultado da empresa e costuma dar problema com a contabilidade.
                O certo é tirar como pró-labore e pagar pela PF.
              </p>
            </div>
          )}
        </div>
      )}

      {isCrossEntityOpen && <CrossEntityTransferModal onClose={() => setIsCrossEntityOpen(false)} />}

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
          <div className="rounded-3xl bg-surface p-8 shadow-sm border border-line">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-black text-content flex items-center gap-2">
                <Target className="h-5 w-5 text-emerald-500" />
                Metas de Receita
              </h3>
              <span className="text-[10px] font-bold text-content-subtle uppercase">Este Mês</span>
            </div>
            <div className="space-y-6">
              {stats.budgetProgress.filter(p => p.isIncome).length > 0 ? (
                stats.budgetProgress.filter(p => p.isIncome).map(p => (
                  <div key={p.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-sm font-bold text-content-muted">{p.name}</span>
                      </div>
                      <span className="text-xs font-black text-content">
                        {p.percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(p.percentage, 100)}%` }}
                        className="h-full bg-emerald-500 rounded-full"
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-content-subtle">
                      <span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.realized)}</span>
                      <span>Meta: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.goal)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-content-subtle text-center py-4">Nenhuma meta de receita definida.</p>
              )}
            </div>
          </div>

          {/* Expense Goals */}
          <div className="rounded-3xl bg-surface p-8 shadow-sm border border-line">
            <div className="mb-6 flex items-center justify-between">
              <h3 className="text-lg font-black text-content flex items-center gap-2">
                <Target className="h-5 w-5 text-rose-500" />
                Limites de Gastos
              </h3>
              <span className="text-[10px] font-bold text-content-subtle uppercase">Este Mês</span>
            </div>
            <div className="space-y-6">
              {stats.budgetProgress.filter(p => !p.isIncome).length > 0 ? (
                stats.budgetProgress.filter(p => !p.isIncome).map(p => (
                  <div key={p.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <div className="h-2 w-2 rounded-full" style={{ backgroundColor: p.color }} />
                        <span className="text-sm font-bold text-content-muted">{p.name}</span>
                      </div>
                      <span className={cn(
                        "text-xs font-black",
                        p.percentage >= 100 ? "text-rose-600" : p.percentage >= 80 ? "text-amber-600" : "text-content"
                      )}>
                        {p.percentage.toFixed(0)}%
                      </span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden">
                      <motion.div 
                        initial={{ width: 0 }}
                        animate={{ width: `${Math.min(p.percentage, 100)}%` }}
                        className={cn(
                          "h-full rounded-full",
                          p.percentage >= 100 ? "bg-rose-500" : p.percentage >= 80 ? "bg-amber-500" : "bg-primary"
                        )}
                      />
                    </div>
                    <div className="flex justify-between text-[10px] font-bold text-content-subtle">
                      <span>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.realized)}</span>
                      <span>Limite: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.goal)}</span>
                    </div>
                  </div>
                ))
              ) : (
                <p className="text-sm text-content-subtle text-center py-4">Nenhum limite de gasto definido.</p>
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
                <button onClick={() => onNavigate?.('transactions')} className="ml-auto rounded-lg bg-rose-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-rose-700">Resolver</button>
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
                <button onClick={() => onNavigate?.('transactions')} className="ml-auto rounded-lg bg-amber-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-amber-700">Ver Lista</button>
              </div>
            )}
          </motion.div>
        )}
      </AnimatePresence>

      <div className="grid gap-6 lg:grid-cols-3">
        {/* Cash Flow Forecast */}
        <div className="lg:col-span-2 rounded-3xl bg-surface p-8 shadow-sm border border-line">
          <div className="mb-8 flex items-center justify-between">
            <div>
              <h3 className="text-lg font-black text-content">Fluxo de Caixa & Projeção</h3>
              <p className="text-xs font-medium text-content-subtle">Histórico de 6 meses e previsão para os próximos 6.</p>
            </div>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-emerald-500" />
                <span className="text-[10px] font-bold text-content-subtle uppercase">Receitas</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-rose-500" />
                <span className="text-[10px] font-bold text-content-subtle uppercase">Despesas</span>
              </div>
            </div>
          </div>
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={cashFlowData}>
                <defs>
                  <linearGradient id="colorIncome" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#10b981" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#10b981" stopOpacity={0.02}/>
                  </linearGradient>
                  <linearGradient id="colorExpense" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#f43f5e" stopOpacity={0.35}/>
                    <stop offset="95%" stopColor="#f43f5e" stopOpacity={0.02}/>
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
                  animationDuration={1400}
                  animationEasing="ease-out"
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
                  animationDuration={1400}
                  animationEasing="ease-out"
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
        <div className="rounded-3xl bg-surface p-8 shadow-sm border border-line">
          <h3 className="text-lg font-black text-content">Distribuição de Gastos</h3>
          <p className="text-xs font-medium text-content-subtle mb-8">
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
                    animationDuration={900}
                    animationBegin={150}
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
                <div className="mb-4 rounded-full bg-surface-muted p-4">
                  <PieIcon className="h-8 w-8 text-slate-300" />
                </div>
                <p className="text-sm font-bold text-content-subtle">Sem dados este mês</p>
              </div>
            )}
          </div>
          <div className="mt-4 space-y-2">
            {categoryDistribution.map((cat, i) => (
              <div key={cat.name} className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <div className="h-2 w-2 rounded-full" style={{ backgroundColor: COLORS[i % COLORS.length] }} />
                  <span className="text-xs font-bold text-content-muted">{cat.name}</span>
                </div>
                <span className="text-xs font-black text-content">
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
          <div className="rounded-3xl bg-surface p-6 shadow-sm border border-line">
            <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-content-subtle">Contas Bancárias</h3>
            <div className="space-y-4">
              {accounts.map(acc => (
                <div key={acc.id} className="flex items-center justify-between p-3 rounded-2xl bg-surface-muted hover:bg-surface-muted transition-colors">
                  <div className="flex items-center gap-3">
                    <div className={cn(
                      "flex h-10 w-10 items-center justify-center rounded-xl bg-surface shadow-sm",
                      acc.type === 'investimento' ? "text-blue-600" :
                      acc.type === 'reserva' ? "text-amber-600" :
                      acc.type === 'caixa' ? "text-content-muted" : "text-primary"
                    )}>
                      {acc.type === 'caixa' ? <DollarSign className="h-5 w-5" /> : <Wallet className="h-5 w-5" />}
                    </div>
                    <div>
                      <p className="text-sm font-bold text-content">{acc.bankName}</p>
                      <p className="text-[10px] font-bold text-content-subtle uppercase">
                        {acc.type === 'corrente' ? 'Corrente' : 
                         acc.type === 'poupanca' ? 'Poupança' :
                         acc.type === 'investimento' ? 'Investimento' :
                         acc.type === 'caixa' ? 'Caixa' : 'Reserva'}
                      </p>
                    </div>
                  </div>
                  <p className={cn(
                    "text-sm font-black",
                    (accountBalances[acc.id] ?? 0) < 0 ? "text-rose-600" : "text-content"
                  )}>
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(accountBalances[acc.id] ?? acc.currentBalance ?? 0)}
                  </p>
                </div>
              ))}
            </div>
          </div>

          <div className="rounded-3xl bg-surface p-6 shadow-sm border border-line">
            <h3 className="mb-4 text-sm font-black uppercase tracking-widest text-content-subtle">Cartões de Crédito</h3>
            <div className="space-y-4">
              {cards.map(card => {
                const used = computeCardInvoice(card.id, card.closingDay, transactions, now);
                const usage = card.limit > 0 ? (used / card.limit) * 100 : 0;
                return (
                  <div key={card.id} className="space-y-2">
                    <div className="flex items-center justify-between">
                      <div className="flex items-center gap-2">
                        <CardIcon className="h-4 w-4 text-content-subtle" />
                        <span className="text-sm font-bold text-content">{card.name}</span>
                      </div>
                      <span className="text-xs font-black text-content">{usage.toFixed(0)}%</span>
                    </div>
                    <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden">
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
        <div className="rounded-3xl bg-surface p-8 shadow-sm border border-line">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-black text-content">Próximos Vencimentos</h3>
            <Calendar className="h-5 w-5 text-slate-300" />
          </div>
          <div className="space-y-6">
            {upcomingBills.length === 0 ? (
              <div className="flex flex-col items-center justify-center py-12 text-center">
                <ShieldCheck className="h-12 w-12 text-emerald-100 mb-4" />
                <p className="text-sm font-bold text-content-subtle">Tudo em dia!</p>
                <p className="text-xs text-slate-300">Nenhum pagamento pendente próximo.</p>
              </div>
            ) : (
              upcomingBills.map(t => (
                <div key={t.id} onClick={() => onNavigate?.('transactions')} className="flex items-center justify-between group cursor-pointer">
                  <div className="flex items-center gap-4">
                    <div className="flex flex-col items-center justify-center h-12 w-12 rounded-2xl bg-surface-muted border border-line group-hover:bg-primary group-hover:border-primary transition-all">
                      <span className="text-[10px] font-black text-content-subtle group-hover:text-white/70 uppercase">
                        {format(parseLocalDate(t.date), 'MMM', { locale: ptBR })}
                      </span>
                      <span className="text-lg font-black text-content group-hover:text-white leading-none">
                        {format(parseLocalDate(t.date), 'dd')}
                      </span>
                    </div>
                    <div>
                      <p className="text-sm font-bold text-content group-hover:text-primary transition-colors">{t.description}</p>
                      <p className="text-[10px] font-bold text-content-subtle uppercase tracking-wider">
                        {CATEGORIES.find(c => c.id === t.categoryId)?.name}
                      </p>
                    </div>
                  </div>
                  <div className="flex flex-col items-end gap-1.5">
                    <p className="text-sm font-black text-content">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.amount)}
                    </p>
                    <button
                      onClick={() => toggleStatus(t)}
                      className="flex items-center gap-1 rounded-lg bg-emerald-500 px-2.5 py-1 text-[10px] font-bold text-white shadow-sm transition-all hover:bg-emerald-600 hover:shadow active:scale-95"
                    >
                      <CheckCircle2 className="h-3 w-3" />
                      {t.type === 'income' ? 'Receber' : 'Pagar'}
                    </button>
                  </div>
                </div>
              ))
            )}
          </div>
          {upcomingBills.length > 0 && (
            <button
              onClick={() => onNavigate?.('transactions')}
              className="mt-8 w-full rounded-2xl bg-surface-muted py-3 text-xs font-black uppercase tracking-widest text-content-subtle hover:text-content-muted transition-all"
            >
              Ver todos os vencimentos
            </button>
          )}
        </div>

        {/* Recent Activity */}
        <div className="rounded-3xl bg-surface p-8 shadow-sm border border-line">
          <div className="mb-6 flex items-center justify-between">
            <h3 className="text-lg font-black text-content">Atividade Recente</h3>
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
                    <p className="text-sm font-bold text-content truncate max-w-[120px]">{t.description}</p>
                    <p className="text-[10px] font-bold text-content-subtle uppercase">{format(parseLocalDate(t.date), 'dd MMM')}</p>
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
          <button
            onClick={() => onNavigate?.('transactions')}
            className="mt-8 w-full flex items-center justify-center gap-2 rounded-2xl border border-line py-3 text-xs font-black uppercase tracking-widest text-content-muted hover:bg-surface-muted transition-all"
          >
            Ver Extrato Completo
            <ArrowRight className="h-4 w-4" />
          </button>
        </div>
      </div>
    </div>
  );
};
