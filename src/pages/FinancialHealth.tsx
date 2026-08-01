import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, setDoc, getDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Transaction, BankAccount, Debt, CreditCard, Goal } from '../types';
import { 
  Heart, 
  Target, 
  TrendingUp, 
  AlertCircle, 
  ChevronRight, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  Sparkles,
  ArrowUpRight,
  ShieldCheck,
  Zap,
  Bell,
  BellOff,
  Settings2,
  Calendar,
  MessageSquare,
  X
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer, 
  Legend,
  Cell
} from 'recharts';
import { cn } from '../lib/utils';
import { format, addMonths, differenceInMonths } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { getFinancialAdvice } from "../services/geminiService";
import { computeBalances, daysUntilDueDay, parseLocalDate, round2, formatLocalDate } from '../lib/finance';
import { averageMonthlyExpense, averageMonthlyIncome } from '../lib/spendable';
import { computeHealthScore } from '../lib/health';
import { goalsDocPath, readGoals, upsertGoal } from '../lib/goalStore';
import { CreditScorePanel } from '../components/CreditScorePanel';
import {
  collectDebts,
  compareExtraPayment,
  payoffSchedule,
  rankByCost,
  DebtMeta,
  DebtSource,
  DebtView,
  PayoffStrategy,
} from '../lib/debts';

const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);

export const FinancialHealth: React.FC = () => {
  const { selectedEntity } = useEntity();
  const { showToast, confirm } = useUI();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [debtMeta, setDebtMeta] = useState<DebtMeta>({});
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);

  // Plano de quitação
  const [extraPayment, setExtraPayment] = useState('');
  const [strategy, setStrategy] = useState<PayoffStrategy>('avalanche');
  const [editingRateId, setEditingRateId] = useState<string | null>(null);
  const [rateInput, setRateInput] = useState('');

  const [aiAdvice, setAiAdvice] = useState<string>('');
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [simulationPayments, setSimulationPayments] = useState<Record<string, string>>({});
  const [isAlertModalOpen, setIsAlertModalOpen] = useState(false);
  const [editingDebt, setEditingDebt] = useState<Debt | null>(null);

  // Alert Config State
  const [dueDateEnabled, setDueDateEnabled] = useState(false);
  const [dueDateDaysBefore, setDueDateDaysBefore] = useState('3');
  const [thresholdEnabled, setThresholdEnabled] = useState(false);
  const [thresholdValue, setThresholdValue] = useState('');

  // Debt Form State
  const [debtName, setDebtName] = useState('');
  const [totalAmount, setTotalAmount] = useState('');
  const [remainingAmount, setRemainingAmount] = useState('');
  const [interestRate, setInterestRate] = useState('');
  const [monthlyPayment, setMonthlyPayment] = useState('');
  const [dueDate, setDueDate] = useState('10');

  useEffect(() => {
    if (!selectedEntity) return;

    const unsubDebts = onSnapshot(query(collection(db, `entities/${selectedEntity.id}/debts`), orderBy('createdAt', 'desc')), (snapshot) => {
      setDebts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Debt[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/debts`));

    const unsubTrans = onSnapshot(query(collection(db, `entities/${selectedEntity.id}/transactions`)), (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Transaction[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/transactions`));

    const unsubAccs = onSnapshot(query(collection(db, `entities/${selectedEntity.id}/bank_accounts`)), (snapshot) => {
      setAccounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BankAccount[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/bank_accounts`));

    const unsubCards = onSnapshot(query(collection(db, `entities/${selectedEntity.id}/credit_cards`)), (snapshot) => {
      setCards(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CreditCard[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/credit_cards`));

    // Taxas informadas manualmente para parcelamentos e faturas de cartão.
    // Um documento em `config` (já liberado) em vez de subcoleção nova, para
    // não depender de publicar regra no Firebase.
    const unsubMeta = onSnapshot(doc(db, `entities/${selectedEntity.id}/config/debt_meta`), (snap) => {
      const rates = (snap.data()?.rates || {}) as Record<string, unknown>;
      const meta: DebtMeta = {};
      for (const [id, value] of Object.entries(rates)) {
        const rate = Number(value);
        if (Number.isFinite(rate)) meta[id] = { interestRate: rate };
      }
      setDebtMeta(meta);
    }, (error) => handleFirestoreError(error, OperationType.GET, `entities/${selectedEntity.id}/config/debt_meta`));

    return () => {
      unsubDebts();
      unsubTrans();
      unsubAccs();
      unsubCards();
      unsubMeta();
    };
  }, [selectedEntity]);

  /**
   * Todas as dívidas do usuário vindas das TRÊS fontes: parcelamentos em
   * aberto, dívidas com juros cadastradas e fatura de cartão. É a única fonte
   * de verdade do "quanto eu devo" — nada aqui é digitado à mão.
   */
  const debtViews = useMemo(
    () => collectDebts(transactions, debts, cards, debtMeta),
    [transactions, debts, cards, debtMeta]
  );

  const totalDebt = useMemo(
    () => round2(debtViews.reduce((acc, v) => acc + v.balance, 0)),
    [debtViews]
  );

  /** Subtotal por fonte, para o usuário ver de onde vem o que ele deve. */
  const debtBySource = useMemo(() => {
    const acc: Record<DebtSource, number> = { installments: 0, loan: 0, card: 0 };
    for (const v of debtViews) acc[v.source] = round2(acc[v.source] + v.balance);
    return acc;
  }, [debtViews]);

  const ranked = useMemo(() => rankByCost(debtViews), [debtViews]);

  const comparison = useMemo(
    () => compareExtraPayment(debtViews, Number(extraPayment) || 0, strategy),
    [debtViews, extraPayment, strategy]
  );

  const totalBalance = useMemo(() => {
    const balances = computeBalances(accounts, transactions);
    return Object.values(balances).reduce((acc, v) => acc + v, 0);
  }, [accounts, transactions]);

  const health = useMemo(() => {
    const monthlyIncome = averageMonthlyIncome(transactions, new Date(), 3);
    const monthlyExpense = averageMonthlyExpense(transactions, new Date(), 3);
    const monthlyDebtPayment = debtViews.reduce((a, v) => a + v.monthlyPayment, 0);
    const today = new Date(); today.setHours(0, 0, 0, 0);
    const overdueAmount = transactions
      .filter(t => t.type === 'expense' && t.status === 'pending' && parseLocalDate(t.date) < today)
      .reduce((a, t) => a + (Number(t.amount) || 0), 0);

    return computeHealthScore({
      monthlyIncome,
      monthlyExpense,
      monthlyDebtPayment,
      totalDebt,
      balance: totalBalance,
      overdueAmount,
    });
  }, [transactions, debtViews, totalDebt, totalBalance]);

  const healthScore = health.score;

  const debtChartData = useMemo(
    () => debtViews.map(v => ({ name: v.name, 'Saldo Devedor': v.balance })),
    [debtViews]
  );

  /** Simula UMA dívida isolada, para o cartão individual de cada dívida cadastrada. */
  const simulateOne = (view: DebtView, monthlyPayment: number) => {
    const r = payoffSchedule([{ ...view, monthlyPayment }], 0, 'avalanche');
    const ends = r.neverEnds.length === 0;
    return { months: ends ? r.months : Infinity, totalInterest: ends ? r.totalInterest : Infinity };
  };

  /** Grava a taxa mensal informada pelo usuário na fonte certa. */
  /**
   * Cria a caixinha sugerida pelo painel de investimento, já com a meta
   * calculada. O botão precisa FAZER algo — antes ele só parecia clicável.
   */
  const criarCaixinhaSugerida = async (nome: string, meta: number, prazoMeses: number, cor: string) => {
    if (!selectedEntity) return;
    try {
      const snap = await getDoc(doc(db, goalsDocPath(selectedEntity.id)));
      const atuais = readGoals(snap.data(), selectedEntity.id);
      if (atuais.some(g => g.name.toLowerCase() === nome.toLowerCase())) {
        showToast(`Você já tem uma caixinha "${nome}". Abra Caixinhas para acompanhar.`, 'error');
        return;
      }
      const fim = new Date();
      fim.setMonth(fim.getMonth() + prazoMeses + 1, 0);   // último dia do mês alvo
      const nova: Goal = {
        id: crypto.randomUUID(),
        name: nome,
        targetAmount: round2(meta) || 0,
        deadline: formatLocalDate(fim),
        color: cor,
        entityId: selectedEntity.id,
        createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, goalsDocPath(selectedEntity.id)),
        { items: upsertGoal(atuais, nova), updatedAt: serverTimestamp() }, { merge: true });
      showToast(
        meta > 0
          ? `Caixinha "${nome}" criada com meta de ${fmt(meta)}. Ajuste em Caixinhas se quiser.`
          : `Caixinha "${nome}" criada. Abra Caixinhas e defina o valor da meta.`,
        'success'
      );
    } catch (error) {
      console.error('Erro ao criar caixinha sugerida:', error);
      showToast('Não consegui criar a caixinha.', 'error');
    }
  };

  const saveInterestRate = async (view: DebtView, rate: number) => {
    if (!selectedEntity) return;
    if (!Number.isFinite(rate) || rate < 0 || rate > 100) return;
    try {
      if (view.source === 'loan') {
        await updateDoc(doc(db, `entities/${selectedEntity.id}/debts`, view.id), { interestRate: rate });
      } else {
        await setDoc(
          doc(db, `entities/${selectedEntity.id}/config/debt_meta`),
          { rates: { ...Object.fromEntries(Object.entries(debtMeta).map(([k, v]) => [k, (v as { interestRate: number }).interestRate])), [view.id]: rate }, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
      setEditingRateId(null);
      setRateInput('');
    } catch (error) {
      console.error('Erro ao salvar taxa de juros:', error);
    }
  };

  const activeAlerts = useMemo(() => {
    return debts.filter(debt => {
      if (!debt.alerts) return false;

      const daysUntilDue = daysUntilDueDay(debt.dueDate);
      const isDueSoon = debt.alerts.dueDateEnabled && daysUntilDue <= (debt.alerts.dueDateDaysBefore || 0);
      const isThresholdReached = debt.alerts.thresholdEnabled && debt.remainingAmount <= (debt.alerts.thresholdValue || 0);
      
      return isDueSoon || isThresholdReached;
    });
  }, [debts]);

  const handleSendWhatsAppAlert = async (debt: Debt) => {
    if (!selectedEntity?.whatsappConfig?.enabled) {
      showToast('Configure o WhatsApp nas Configurações para enviar alertas.', 'info');
      return;
    }

    try {
      const daysUntilDue = daysUntilDueDay(debt.dueDate);
      const isDueSoon = debt.alerts?.dueDateEnabled && daysUntilDue <= (debt.alerts?.dueDateDaysBefore || 0);
      const isThresholdReached = debt.alerts?.thresholdEnabled && debt.remainingAmount <= (debt.alerts?.thresholdValue || 0);

      let message = `⚠️ *Alerta de Dívida: ${debt.name}*\n\n`;
      if (isDueSoon) message += `📅 *Vencimento Próximo:* Faltam ${daysUntilDue} dias para o vencimento (Dia ${debt.dueDate}).\n`;
      if (isThresholdReached) message += `🎯 *Meta de Saldo:* O saldo devedor atual é de R$ ${debt.remainingAmount.toLocaleString('pt-BR')}, atingindo sua meta de R$ ${debt.alerts?.thresholdValue?.toLocaleString('pt-BR')}.\n`;
      
      message += `\n💰 *Saldo Restante:* R$ ${debt.remainingAmount.toLocaleString('pt-BR')}\n`;
      message += `💳 *Parcela:* R$ ${debt.monthlyPayment.toLocaleString('pt-BR')}`;

      const { WhatsAppService } = await import('../services/WhatsAppService');
      const wa = new WhatsAppService(selectedEntity.whatsappConfig);
      await wa.sendText(message);
      showToast('Alerta enviado para o WhatsApp com sucesso!', 'success');
    } catch (error) {
      console.error('Error sending WhatsApp alert:', error);
      showToast('Erro ao enviar alerta. Verifique as configurações do WhatsApp.', 'error');
    }
  };

  const analyzeFinancialHealth = async () => {
    if (!selectedEntity || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      // Manda as dívidas REAIS (as três fontes), não só a coleção `debts`.
      const advice = await getFinancialAdvice({
        balance: totalBalance,
        debts: debtViews.map(v => ({ name: v.name, amount: v.balance, interest: v.interestRate })),
        recentTransactions: transactions.slice(0, 10).map(t => ({ desc: t.description, amount: t.amount, type: t.type })),
      });

      setAiAdvice(advice || "Não foi possível gerar a análise no momento.");
    } catch (error) {
      console.error("AI Error:", error);
      setAiAdvice("Não foi possível gerar a análise no momento. Tente novamente mais tarde.");
    } finally {
      setIsAnalyzing(false);
    }
  };

  const handleAddDebt = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntity) return;

    try {
      await addDoc(collection(db, `entities/${selectedEntity.id}/debts`), {
        name: debtName,
        totalAmount: Number(totalAmount),
        remainingAmount: Number(remainingAmount),
        interestRate: Number(interestRate),
        monthlyPayment: Number(monthlyPayment),
        dueDate: Number(dueDate),
        entityId: selectedEntity.id,
        ownerUid: selectedEntity.ownerUid,
        collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
        createdAt: serverTimestamp(),
        alerts: {
          dueDateEnabled,
          dueDateDaysBefore: Number(dueDateDaysBefore),
          thresholdEnabled,
          thresholdValue: Number(thresholdValue)
        }
      });
      setIsDebtModalOpen(false);
      setDebtName('');
      setTotalAmount('');
      setRemainingAmount('');
      setInterestRate('');
      setMonthlyPayment('');
      setDueDate('10');
      setDueDateEnabled(false);
      setDueDateDaysBefore('3');
      setThresholdEnabled(false);
      setThresholdValue('');
    } catch (error) {
      console.error("Error adding debt:", error);
    }
  };

  const handleDeleteDebt = async (id: string) => {
    if (!selectedEntity) return;
    const ok = await confirm({ title: 'Excluir dívida', message: 'Tem certeza que deseja excluir esta dívida?', variant: 'danger' });
    if (!ok) return;
    await deleteDoc(doc(db, `entities/${selectedEntity.id}/debts`, id));
  };

  const handleUpdateAlerts = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntity || !editingDebt) return;

    try {
      await updateDoc(doc(db, `entities/${selectedEntity.id}/debts`, editingDebt.id), {
        alerts: {
          dueDateEnabled,
          dueDateDaysBefore: Number(dueDateDaysBefore),
          thresholdEnabled,
          thresholdValue: Number(thresholdValue)
        }
      });
      setIsAlertModalOpen(false);
      setEditingDebt(null);
    } catch (error) {
      console.error("Error updating alerts:", error);
    }
  };

  const openAlertModal = (debt: Debt) => {
    setEditingDebt(debt);
    setDueDateEnabled(debt.alerts?.dueDateEnabled || false);
    setDueDateDaysBefore(debt.alerts?.dueDateDaysBefore?.toString() || '3');
    setThresholdEnabled(debt.alerts?.thresholdEnabled || false);
    setThresholdValue(debt.alerts?.thresholdValue?.toString() || '');
    setIsAlertModalOpen(true);
  };

  return (
    <div className="space-y-8 pb-12">
      {/* Header */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-black text-content tracking-tight">Saúde Financeira</h2>
          <p className="text-content-subtle font-medium">Análise inteligente e plano de liberdade financeira.</p>
        </div>
        <button 
          onClick={analyzeFinancialHealth}
          disabled={isAnalyzing}
          className="flex items-center gap-2 rounded-xl bg-indigo-600 px-6 py-3 text-sm font-bold text-white shadow-lg shadow-indigo-200 hover:bg-indigo-700 transition-all disabled:opacity-50"
        >
          {isAnalyzing ? <Clock className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
          {isAnalyzing ? "Analisando..." : "Consultar IA Advisor"}
        </button>
      </div>

      {/* Active Alerts Section */}
      <AnimatePresence>
        {activeAlerts.length > 0 && (
          <motion.div
            initial={{ opacity: 0, height: 0 }}
            animate={{ opacity: 1, height: 'auto' }}
            exit={{ opacity: 0, height: 0 }}
            className="overflow-hidden"
          >
            <div className="rounded-3xl bg-amber-50 border border-amber-100 p-6 space-y-4">
              <div className="flex items-center gap-2 text-amber-800">
                <Bell className="h-5 w-5 animate-bounce" />
                <h3 className="font-black">Alertas de Atenção ({activeAlerts.length})</h3>
              </div>
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {activeAlerts.map(debt => {
                  const daysUntilDue = daysUntilDueDay(debt.dueDate);
                  const isDueSoon = debt.alerts?.dueDateEnabled && daysUntilDue <= (debt.alerts?.dueDateDaysBefore || 0);
                  const isThresholdReached = debt.alerts?.thresholdEnabled && debt.remainingAmount <= (debt.alerts?.thresholdValue || 0);

                  return (
                    <div key={debt.id} className="bg-surface rounded-2xl p-4 shadow-sm border border-amber-200 flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-content truncate">{debt.name}</p>
                        <div className="flex flex-wrap gap-2 mt-1">
                          {isDueSoon && (
                            <span className="text-[10px] font-black text-rose-600 uppercase">Vence em {daysUntilDue}d</span>
                          )}
                          {isThresholdReached && (
                            <span className="text-[10px] font-black text-emerald-600 uppercase">Meta Atingida</span>
                          )}
                        </div>
                      </div>
                      <button 
                        onClick={() => handleSendWhatsAppAlert(debt)}
                        className="p-2 rounded-xl bg-emerald-50 text-emerald-600 hover:bg-emerald-100 transition-colors"
                        title="Enviar para WhatsApp"
                      >
                        <MessageSquare className="h-4 w-4" />
                      </button>
                    </div>
                  );
                })}
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>

      {/* Health Score Card */}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2 rounded-3xl bg-surface dark:bg-gray-900 p-8 shadow-sm border border-line dark:border-gray-800 overflow-hidden relative">
          <div className="relative z-10">
            <h3 className="text-lg font-black text-content dark:text-gray-100 flex items-center gap-2">
              <Heart className="h-5 w-5 text-rose-500 fill-rose-500" />
              Seu Score de Saúde
            </h3>
            <div className="mt-8 flex items-end gap-4">
              <span className={cn(
                "text-7xl font-black tracking-tighter",
                healthScore >= 80 ? "text-emerald-600" : healthScore >= 50 ? "text-amber-600" : "text-rose-600"
              )}>
                {healthScore}
              </span>
              <div className="pb-2">
                <p className="text-sm font-bold text-content-subtle dark:text-gray-500 uppercase tracking-widest">Pontos de 100</p>
                <p className="text-lg font-black text-content dark:text-gray-100">{health.label}</p>
              </div>
            </div>
            <div className="mt-8 h-3 w-full rounded-full bg-surface-muted dark:bg-gray-800 overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${healthScore}%` }}
                className={cn(
                  "h-full rounded-full",
                  healthScore >= 80 ? "bg-emerald-500" : healthScore >= 50 ? "bg-amber-500" : "bg-rose-500"
                )}
              />
            </div>
            {/* De onde vem a nota — sem isso o número não ajuda ninguém a agir. */}
            <div className="mt-6 space-y-2">
              {health.parts.map(part => (
                <div key={part.key} className="flex items-center gap-3">
                  <div className="w-40 shrink-0">
                    <p className="text-xs font-bold text-content-muted dark:text-gray-300">{part.label}</p>
                    <p className="text-[10px] text-content-subtle">{part.detail}</p>
                  </div>
                  <div className="h-2 flex-1 rounded-full bg-surface-muted dark:bg-gray-800 overflow-hidden">
                    <div
                      className={cn(
                        'h-full rounded-full',
                        part.points / part.max >= 0.7 ? 'bg-emerald-500'
                          : part.points / part.max >= 0.4 ? 'bg-amber-500' : 'bg-rose-500'
                      )}
                      style={{ width: `${(part.points / part.max) * 100}%` }}
                    />
                  </div>
                  <span className="w-14 shrink-0 text-right text-xs font-black text-content-subtle tabular-nums">
                    {Math.round(part.points)}/{part.max}
                  </span>
                </div>
              ))}
            </div>

            {!health.hasEnoughData && (
              <p className="mt-4 text-sm font-medium text-amber-600">
                Sem receitas registradas, não dá para medir comprometimento nem endividamento — lance suas entradas para a nota fazer sentido.
              </p>
            )}
          </div>
          <div className="absolute -right-12 -bottom-12 h-64 w-64 bg-surface-muted dark:bg-gray-800/20 rounded-full opacity-50" />
        </div>

        <div className="rounded-3xl bg-indigo-50 dark:bg-indigo-950 p-8 text-indigo-900 dark:text-white shadow-xl shadow-indigo-100 dark:shadow-none relative overflow-hidden border border-indigo-100 dark:border-indigo-900/30">
          <div className="relative z-10">
            <h3 className="text-lg font-black flex items-center gap-2">
              <Zap className="h-5 w-5 text-amber-500 dark:text-amber-400 fill-amber-500 dark:fill-amber-400" />
              Dica do Advisor
            </h3>
            <div className="mt-6 text-indigo-700 dark:text-indigo-200 text-sm leading-relaxed font-medium italic">
              {aiAdvice || "Clique no botão acima para receber uma análise personalizada da sua situação financeira atual."}
            </div>
          </div>
          <div className="pointer-events-none absolute -right-8 -top-8 h-32 w-32 bg-indigo-200/20 dark:bg-white/10 rounded-full blur-2xl" />
        </div>
      </div>

      {selectedEntity && <CreditScorePanel entity={selectedEntity} />}

      {/* Quitação de Dívidas Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-black text-content flex items-center gap-2">
              <Target className="h-6 w-6 text-rose-500" />
              Quitação de Dívidas
            </h3>
            <p className="text-sm text-content-subtle font-medium">Acompanhamento detalhado e simulação de pagamentos.</p>
          </div>
          <button 
            onClick={() => setIsDebtModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-surface border border-line px-4 py-2 text-sm font-bold text-content-muted hover:bg-surface-muted transition-all shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Adicionar Dívida
          </button>
        </div>

        {debtViews.length > 0 ? (
          <div className="space-y-8">
            {/* Total devido, com a origem de cada real */}
            <div className="grid gap-6 lg:grid-cols-3">
              <div className="rounded-3xl bg-rose-50 dark:bg-rose-950/40 p-8 border border-rose-100 dark:border-rose-900/40">
                <p className="text-[10px] font-black text-rose-500 uppercase tracking-widest">Total que você deve</p>
                <p className="mt-1 text-4xl font-black tracking-tighter text-rose-700 dark:text-rose-300">{fmt(totalDebt)}</p>
                <div className="mt-6 space-y-2 text-sm">
                  <div className="flex justify-between">
                    <span className="text-content-muted dark:text-slate-400 font-medium">Parcelamentos em aberto</span>
                    <span className="font-black text-content dark:text-slate-100">{fmt(debtBySource.installments)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-content-muted dark:text-slate-400 font-medium">Dívidas com juros</span>
                    <span className="font-black text-content dark:text-slate-100">{fmt(debtBySource.loan)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-content-muted dark:text-slate-400 font-medium">Fatura de cartão</span>
                    <span className="font-black text-content dark:text-slate-100">{fmt(debtBySource.card)}</span>
                  </div>
                </div>
              </div>

              {/* Quando eu fico livre */}
              <div className="lg:col-span-2 rounded-3xl bg-surface dark:bg-gray-900 p-8 shadow-sm border border-line dark:border-gray-800">
                <div className="flex flex-wrap items-center justify-between gap-4">
                  <h4 className="text-lg font-black text-content dark:text-gray-100 flex items-center gap-2">
                    <ShieldCheck className="h-5 w-5 text-emerald-500" />
                    Quando eu fico livre
                  </h4>
                  <div className="flex items-center gap-1 rounded-xl bg-surface-muted dark:bg-gray-800 p-1">
                    <button
                      onClick={() => setStrategy('avalanche')}
                      className={cn(
                        'px-3 py-1.5 text-xs font-bold rounded-lg transition-all',
                        strategy === 'avalanche' ? 'bg-surface dark:bg-gray-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-content-subtle'
                      )}
                      title="Ataca primeiro a dívida de maior juros — economiza mais dinheiro"
                    >
                      Avalanche
                    </button>
                    <button
                      onClick={() => setStrategy('snowball')}
                      className={cn(
                        'px-3 py-1.5 text-xs font-bold rounded-lg transition-all',
                        strategy === 'snowball' ? 'bg-surface dark:bg-gray-700 text-indigo-600 dark:text-indigo-300 shadow-sm' : 'text-content-subtle'
                      )}
                      title="Ataca primeiro a menor dívida — quita mais rápido a primeira"
                    >
                      Bola de neve
                    </button>
                  </div>
                </div>

                <div className="mt-6 grid gap-6 sm:grid-cols-3">
                  <div>
                    <p className="text-[10px] font-black text-content-subtle uppercase tracking-widest">Data de libertação</p>
                    <p className="mt-1 text-2xl font-black text-emerald-600 capitalize">
                      {comparison.withExtra.months === 0
                        ? 'Você está livre'
                        : format(comparison.withExtra.freedomDate, "MMM 'de' yyyy", { locale: ptBR })}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-content-subtle uppercase tracking-widest">Tempo restante</p>
                    <p className="mt-1 text-2xl font-black text-indigo-600">
                      {comparison.withExtra.months === 0 ? '-' : `${comparison.withExtra.months} meses`}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] font-black text-content-subtle uppercase tracking-widest">Juros até lá</p>
                    <p className="mt-1 text-2xl font-black text-amber-600">{fmt(comparison.withExtra.totalInterest)}</p>
                  </div>
                </div>

                {/* E se eu pagar mais por mês? */}
                <div className="mt-8 rounded-2xl bg-surface-muted dark:bg-gray-800/60 p-5">
                  <label className="text-[10px] font-black text-content-subtle uppercase tracking-widest">
                    E se eu pagar mais por mês?
                  </label>
                  <div className="mt-2 flex flex-wrap items-center gap-3">
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm font-bold text-content-subtle">R$</span>
                      <input
                        type="number"
                        min="0"
                        step="50"
                        value={extraPayment}
                        onChange={(e) => setExtraPayment(e.target.value)}
                        placeholder="0"
                        className="w-40 rounded-xl border border-line dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 py-2 pl-10 pr-3 text-sm font-bold outline-none focus:border-indigo-500"
                      />
                    </div>
                    {comparison.monthsSaved > 0 ? (
                      <p className="text-sm font-medium text-content-muted dark:text-gray-300">
                        Você sai <strong className="text-emerald-600">{comparison.monthsSaved} {comparison.monthsSaved === 1 ? 'mês' : 'meses'}</strong> antes
                        {comparison.interestSaved > 0 && (
                          <> e economiza <strong className="text-emerald-600">{fmt(comparison.interestSaved)}</strong> de juros</>
                        )}.
                      </p>
                    ) : (
                      <p className="text-sm text-content-subtle">Informe um valor extra para ver quanto tempo e juros você economiza.</p>
                    )}
                  </div>
                </div>

                {comparison.withExtra.neverEnds.length > 0 && (
                  <div className="mt-6 rounded-2xl bg-rose-50 dark:bg-rose-950/40 border border-rose-100 dark:border-rose-900/40 p-5">
                    <p className="text-sm font-black text-rose-700 dark:text-rose-300 flex items-center gap-2">
                      <AlertCircle className="h-4 w-4" />
                      Essas dívidas não acabam no ritmo atual
                    </p>
                    <p className="mt-1 text-xs text-rose-600 dark:text-rose-400">
                      Os juros comem mais do que você paga por mês. Renegocie ou aumente o pagamento.
                    </p>
                    <ul className="mt-3 space-y-1">
                      {comparison.withExtra.neverEnds.map(d => (
                        <li key={d.id} className="text-sm font-bold text-rose-800 dark:text-rose-200 flex justify-between">
                          <span>{d.name}</span>
                          <span>{fmt(d.balance)}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}
              </div>
            </div>

            {/* Qual atacar primeiro */}
            <div className="rounded-3xl bg-surface dark:bg-gray-900 p-8 shadow-sm border border-line dark:border-gray-800">
              <h4 className="text-lg font-black text-content dark:text-gray-100 flex items-center gap-2">
                <Target className="h-5 w-5 text-rose-500" />
                Qual atacar primeiro
              </h4>
              <p className="text-sm text-content-subtle mt-1">
                Ordenado pelo que cada dívida custa de juros por mês — não pelo tamanho.
              </p>

              <div className="mt-6 space-y-3">
                {ranked.map((r, i) => (
                  <div
                    key={r.id}
                    className="flex flex-wrap items-center gap-4 rounded-2xl border border-line dark:border-gray-800 p-4"
                  >
                    <span className={cn(
                      'flex h-8 w-8 shrink-0 items-center justify-center rounded-lg text-xs font-black',
                      i === 0 && !r.unknownRate ? 'bg-rose-100 text-rose-600' : 'bg-surface-muted dark:bg-gray-800 text-content-subtle'
                    )}>
                      {i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="font-bold text-content dark:text-gray-100 truncate">{r.name}</p>
                      <p className="text-[11px] font-medium text-content-subtle">
                        {r.source === 'installments'
                          ? `${r.installmentsLeft} ${r.installmentsLeft === 1 ? 'parcela restante' : 'parcelas restantes'}`
                          : r.source === 'card' ? 'Fatura em aberto' : 'Dívida com juros'}
                        {r.overdue && <span className="ml-2 text-rose-600 font-black uppercase">Atrasada</span>}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="text-[10px] font-black text-content-subtle uppercase tracking-widest">Saldo</p>
                      <p className="font-black text-content dark:text-gray-100">{fmt(r.balance)}</p>
                    </div>
                    <div className="text-right min-w-[9rem]">
                      <p className="text-[10px] font-black text-content-subtle uppercase tracking-widest">Custo por mês</p>
                      {r.unknownRate ? (
                        editingRateId === r.id ? (
                          <div className="mt-1 flex items-center gap-1">
                            <input
                              type="number"
                              min="0"
                              max="100"
                              step="0.1"
                              autoFocus
                              value={rateInput}
                              onChange={(e) => setRateInput(e.target.value)}
                              placeholder="% a.m."
                              className="w-20 rounded-lg border border-line dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 px-2 py-1 text-sm outline-none focus:border-indigo-500"
                            />
                            <button
                              onClick={() => saveInterestRate(r, Number(rateInput))}
                              className="rounded-lg bg-indigo-600 px-2 py-1 text-xs font-bold text-white hover:bg-indigo-700"
                            >
                              Salvar
                            </button>
                          </div>
                        ) : (
                          <button
                            onClick={() => { setEditingRateId(r.id); setRateInput(''); }}
                            className="mt-1 text-xs font-bold text-amber-600 hover:text-amber-700 text-right"
                            title="Informe a taxa mensal para eu calcular o custo real"
                          >
                            ⚠️ taxa não informada
                          </button>
                        )
                      ) : (
                        <p className="font-black text-amber-600">
                          {fmt(r.monthlyCost || 0)}
                          <span className="ml-1 text-[10px] font-bold text-content-subtle">{r.interestRate}% a.m.</span>
                        </p>
                      )}
                    </div>
                  </div>
                ))}
              </div>
            </div>

            {/* Debt Progress Chart */}
            <div className="rounded-3xl bg-surface p-8 shadow-sm border border-line">
              <h3 className="text-lg font-black text-content flex items-center gap-2 mb-8">
                <TrendingUp className="h-5 w-5 text-indigo-500" />
                Saldo devedor por dívida
              </h3>
              <div className="h-[350px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart
                    data={debtChartData}
                    margin={{ top: 20, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#64748b', fontSize: 12, fontWeight: 600 }}
                      tickFormatter={(value) => `R$ ${value >= 1000 ? (value/1000).toFixed(0) + 'k' : value}`}
                    />
                    <Tooltip 
                      cursor={{ fill: '#f8fafc' }}
                      contentStyle={{ borderRadius: '16px', border: 'none', boxShadow: '0 20px 25px -5px rgb(0 0 0 / 0.1)', padding: '12px' }}
                      formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                    />
                    <Legend 
                      verticalAlign="top" 
                      align="right" 
                      iconType="circle"
                      wrapperStyle={{ paddingBottom: '20px', fontSize: '12px', fontWeight: 'bold' }}
                    />
                    <Bar dataKey="Saldo Devedor" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={40} name="Saldo Devedor" animationDuration={900} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Debt List */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {debts.map(debt => {
                const simPayment = simulationPayments[debt.id] ? Number(simulationPayments[debt.id]) : debt.monthlyPayment;
                const debtView = debtViews.find(v => v.source === 'loan' && v.id === debt.id);
                const { months: monthsToPay, totalInterest } = debtView
                  ? simulateOne(debtView, simPayment)
                  : { months: 0, totalInterest: 0 };
                const payoffDate = monthsToPay === Infinity ? null : addMonths(new Date(), monthsToPay);
                const progress = debt.totalAmount > 0 ? ((debt.totalAmount - debt.remainingAmount) / debt.totalAmount) * 100 : 0;

                return (
                  <motion.div 
                    key={debt.id}
                    layout
                    className="rounded-3xl bg-surface p-6 shadow-sm border border-line hover:shadow-md transition-all flex flex-col"
                  >
                    <div className="flex items-center justify-between mb-4">
                      <div className="flex items-center gap-2">
                        <div className="h-10 w-10 rounded-xl bg-rose-50 text-rose-600 flex items-center justify-center">
                          <AlertCircle className="h-5 w-5" />
                        </div>
                        {debt.alerts?.dueDateEnabled || debt.alerts?.thresholdEnabled ? (
                          <div className="flex items-center gap-2">
                            <div className="h-8 w-8 rounded-lg bg-amber-50 text-amber-600 flex items-center justify-center">
                              <Bell className="h-4 w-4" />
                            </div>
                            {(activeAlerts.some(a => a.id === debt.id)) && (
                              <button 
                                onClick={() => handleSendWhatsAppAlert(debt)}
                                className="h-8 w-8 rounded-lg bg-emerald-50 text-emerald-600 flex items-center justify-center hover:bg-emerald-100 transition-colors"
                                title="Notificar via WhatsApp"
                              >
                                <MessageSquare className="h-4 w-4" />
                              </button>
                            )}
                          </div>
                        ) : (
                          <div className="h-8 w-8 rounded-lg bg-surface-muted text-slate-300 flex items-center justify-center">
                            <BellOff className="h-4 w-4" />
                          </div>
                        )}
                      </div>
                      <div className="flex items-center gap-2">
                        <button 
                          onClick={() => openAlertModal(debt)}
                          className="text-slate-300 hover:text-indigo-600 transition-colors"
                          title="Configurar Alertas"
                        >
                          <Settings2 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDeleteDebt(debt.id)}
                          className="text-slate-300 hover:text-rose-600 transition-colors"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </div>
                    <h4 className="font-black text-content">{debt.name}</h4>
                    
                    {/* Alert Badges */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {debt.alerts?.thresholdEnabled && debt.remainingAmount <= (debt.alerts.thresholdValue || 0) && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-[10px] font-bold text-emerald-600 border border-emerald-100">
                          <CheckCircle2 className="h-3 w-3" />
                          Meta de Saldo Atingida
                        </div>
                      )}
                      {(() => {
                        const daysUntilDue = daysUntilDueDay(debt.dueDate);
                        if (debt.alerts?.dueDateEnabled && daysUntilDue <= (debt.alerts.dueDateDaysBefore || 0)) {
                          return (
                            <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-rose-50 text-[10px] font-bold text-rose-600 border border-rose-100">
                              <Clock className="h-3 w-3" />
                              Vencimento Próximo ({daysUntilDue}d)
                            </div>
                          );
                        }
                        return null;
                      })()}
                    </div>
                    <div className="mt-4 space-y-4 flex-1">
                      <div className="flex justify-between items-end">
                        <div>
                          <p className="text-[10px] font-black text-content-subtle uppercase">Restante</p>
                          <p className="text-xl font-black text-content">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(debt.remainingAmount)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black text-content-subtle uppercase">Progresso</p>
                          <p className="text-sm font-black text-emerald-600">{progress.toFixed(0)}%</p>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-surface-muted overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progress}%` }} />
                      </div>
                      
                      {/* Simulation Input */}
                      <div className="pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-[10px] font-black text-content-subtle uppercase">Simular Nova Parcela</label>
                          {simulationPayments[debt.id] && (
                            <button 
                              onClick={() => setSimulationPayments(prev => {
                                const next = { ...prev };
                                delete next[debt.id];
                                return next;
                              })}
                              className="text-[10px] font-bold text-indigo-600 hover:text-indigo-800"
                            >
                              Resetar
                            </button>
                          )}
                        </div>
                        <div className="relative">
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle text-xs font-bold">R$</span>
                          <input 
                            type="number"
                            value={simulationPayments[debt.id] || ''}
                            onChange={(e) => setSimulationPayments(prev => ({ ...prev, [debt.id]: e.target.value }))}
                            placeholder={debt.monthlyPayment.toString()}
                            className="w-full rounded-xl border border-line bg-slate-50/50 pl-9 pr-4 py-2 text-sm font-bold text-content-muted outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                          />
                        </div>
                      </div>

                      <div className="space-y-3 pt-4 border-t border-slate-50">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[10px] font-black text-content-subtle uppercase">Quitação em</p>
                            <p className={cn(
                              "text-sm font-bold",
                              monthsToPay === Infinity ? "text-rose-600" : "text-content-muted"
                            )}>
                              {monthsToPay === Infinity ? "Nunca (Juros > Parcela)" : payoffDate ? format(payoffDate, 'MMM/yyyy', { locale: ptBR }) : '-'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-content-subtle uppercase">Total Juros</p>
                            <p className="text-sm font-bold text-amber-600">
                              {monthsToPay === Infinity ? '∞' : new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalInterest)}
                            </p>
                          </div>
                        </div>

                        {/* Impact Analysis */}
                        {simulationPayments[debt.id] && Number(simulationPayments[debt.id]) !== debt.monthlyPayment && (
                          <motion.div 
                            initial={{ opacity: 0, y: 5 }}
                            animate={{ opacity: 1, y: 0 }}
                            className="rounded-xl bg-indigo-50 p-3 border border-indigo-100"
                          >
                            <p className="text-[10px] font-black text-indigo-900 uppercase mb-2">Impacto da Simulação</p>
                            {(() => {
                              if (!debtView) return null;
                              const original = simulateOne(debtView, debt.monthlyPayment);
                              const simulated = { months: monthsToPay, totalInterest };

                              if (simulated.months === Infinity || original.months === Infinity) return null;
                              
                              const monthDiff = original.months - simulated.months;
                              const interestSaved = original.totalInterest - simulated.totalInterest;
                              
                              return (
                                <div className="space-y-1">
                                  {monthDiff > 0 ? (
                                    <p className="text-xs font-bold text-indigo-700 flex items-center gap-1">
                                      <Zap className="h-3 w-3 fill-indigo-500" />
                                      Quitação {monthDiff} meses mais cedo
                                    </p>
                                  ) : monthDiff < 0 ? (
                                    <p className="text-xs font-bold text-rose-600">
                                      Demora {Math.abs(monthDiff)} meses a mais
                                    </p>
                                  ) : null}
                                  
                                  {interestSaved > 0 ? (
                                    <p className="text-xs font-bold text-emerald-600 flex items-center gap-1">
                                      <Sparkles className="h-3 w-3 fill-emerald-500" />
                                      Economia de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(interestSaved)} em juros
                                    </p>
                                  ) : interestSaved < 0 ? (
                                    <p className="text-xs font-bold text-rose-600">
                                      Gasto extra de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(interestSaved))} em juros
                                    </p>
                                  ) : null}
                                </div>
                              );
                            })()}
                          </motion.div>
                        )}
                      </div>
                    </div>
                  </motion.div>
                );
              })}
            </div>
          </div>
        ) : (
          <div className="rounded-3xl border-2 border-dashed border-line p-12 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <h4 className="text-lg font-black text-content">Nenhuma dívida registrada</h4>
            <p className="text-sm text-content-subtle mt-2">Parabéns! Você está no caminho certo para a liberdade financeira.</p>
          </div>
        )}
      </div>

      {/* Alert Modal */}
      {isAlertModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm"
          onClick={() => setIsAlertModalOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-surface p-6 sm:p-8 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setIsAlertModalOpen(false)}
              className="absolute right-4 top-4 z-10 rounded-xl p-2 text-content-subtle hover:bg-surface-muted hover:text-content"
            >
              <X className="h-5 w-5" />
            </button>
            <div className="flex items-center gap-3 mb-6">
              <div className="h-12 w-12 shrink-0 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Bell className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-black text-content">Configurar Alertas</h3>
                <p className="text-sm text-content-subtle font-medium">{editingDebt?.name}</p>
              </div>
            </div>
            
            <form onSubmit={handleUpdateAlerts} className="space-y-6">
              {/* Due Date Alert */}
              <div className="p-4 rounded-2xl border border-line bg-slate-50/50 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-content-subtle" />
                    <span className="text-sm font-bold text-content-muted">Aviso de Vencimento</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDueDateEnabled(!dueDateEnabled)}
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                      dueDateEnabled ? "bg-indigo-600" : "bg-slate-200"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-surface transition-transform",
                      dueDateEnabled ? "translate-x-6" : "translate-x-1"
                    )} />
                  </button>
                </div>
                {dueDateEnabled && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="block text-[10px] font-black text-content-subtle uppercase mb-1">Avisar quantos dias antes?</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={dueDateDaysBefore}
                        onChange={(e) => setDueDateDaysBefore(e.target.value)}
                        className="flex-1 rounded-xl border border-line bg-surface px-4 py-2 text-sm font-bold outline-none focus:border-indigo-500 transition-all"
                      />
                      <span className="text-xs font-bold text-content-subtle">dias</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Threshold Alert */}
              <div className="p-4 rounded-2xl border border-line bg-slate-50/50 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-content-subtle" />
                    <span className="text-sm font-bold text-content-muted">Meta de Saldo</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setThresholdEnabled(!thresholdEnabled)}
                    className={cn(
                      "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                      thresholdEnabled ? "bg-emerald-600" : "bg-slate-200"
                    )}
                  >
                    <span className={cn(
                      "inline-block h-4 w-4 transform rounded-full bg-surface transition-transform",
                      thresholdEnabled ? "translate-x-6" : "translate-x-1"
                    )} />
                  </button>
                </div>
                {thresholdEnabled && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="block text-[10px] font-black text-content-subtle uppercase mb-1">Avisar quando o saldo for menor que:</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-content-subtle text-xs font-bold">R$</span>
                      <input
                        type="number"
                        value={thresholdValue}
                        onChange={(e) => setThresholdValue(e.target.value)}
                        className="w-full rounded-xl border border-line bg-surface pl-9 pr-4 py-2 text-sm font-bold outline-none focus:border-emerald-500 transition-all"
                        placeholder="Ex: 1000"
                      />
                    </div>
                  </div>
                )}
              </div>

              <div className="flex gap-3 pt-4">
                <button
                  type="button"
                  onClick={() => setIsAlertModalOpen(false)}
                  className="flex-1 rounded-xl border border-line py-3 text-sm font-bold text-content-muted hover:bg-surface-muted transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-indigo-600 py-3 text-sm font-bold text-white hover:bg-indigo-700 shadow-lg shadow-indigo-200 transition-all"
                >
                  Salvar Alertas
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {/* Onde investir — só faz sentido depois que a casa está em ordem */}
      {(() => {
        // Cor FIXA neste painel: ele é escuro nos dois temas, então usar token
        // de tema deixaria o texto cinza-escuro sobre fundo quase preto.
        const sub = 'rgba(255,255,255,0.72)';
        const caraDemais = ranked.find(r => (r.interestRate ?? 0) >= 1.5 && r.balance > 0);
        const semFolga = totalBalance <= 0;
        const mesesDespesa = averageMonthlyExpense(transactions, new Date(), 3);

        if (caraDemais || semFolga) {
          return (
            <div className="rounded-3xl bg-slate-900 p-8 text-white">
              <h3 className="text-xl font-black flex items-center gap-2">
                <ShieldCheck className="h-6 w-6 text-amber-400" />
                Antes de investir
              </h3>
              <p className="mt-2 text-sm" style={{ color: sub }}>
                Sugerir investimento agora seria conselho ruim. Investir rende cerca de 1% ao mês;
                {caraDemais
                  ? ` a sua dívida "${caraDemais.name}" custa ${caraDemais.interestRate}% ao mês. Aplicar dinheiro enquanto ela corre é perder a diferença todo mês.`
                  : ' e o seu saldo está negativo, então não existe sobra para aplicar.'}
              </p>

              <div className="mt-6 grid gap-4 sm:grid-cols-2">
                {caraDemais && (
                  <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
                    <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: sub }}>
                      Prioridade 1 — quitar
                    </p>
                    <p className="mt-1 text-lg font-black">{caraDemais.name}</p>
                    <p className="text-sm" style={{ color: sub }}>
                      {fmt(caraDemais.balance)} a {caraDemais.interestRate}% ao mês
                      {caraDemais.monthlyCost !== null && <> — está custando {fmt(caraDemais.monthlyCost)} por mês</>}
                    </p>
                  </div>
                )}
                <div className="rounded-2xl bg-white/5 border border-white/10 p-5">
                  <p className="text-[10px] font-black uppercase tracking-widest" style={{ color: sub }}>
                    Prioridade 2 — para-choque
                  </p>
                  <p className="mt-1 text-lg font-black">
                    {mesesDespesa > 0 ? fmt(mesesDespesa) : 'Reserva mínima'}
                  </p>
                  <p className="text-sm" style={{ color: sub }}>
                    Um mês da sua despesa guardado impede que o próximo imprevisto vire dívida nova.
                  </p>
                </div>
              </div>

              <p className="mt-6 text-xs" style={{ color: sub }}>
                Quando a dívida cara acabar e houver saldo positivo, as sugestões de investimento
                aparecem aqui automaticamente.
              </p>
            </div>
          );
        }

        return (
          <div className="rounded-3xl bg-slate-900 p-8 text-white">
            <div className="flex flex-wrap items-center justify-between gap-4 mb-8">
              <div>
                <h3 className="text-xl font-black flex items-center gap-2">
                  <TrendingUp className="h-6 w-6 text-emerald-400" />
                  Onde Investir Agora
                </h3>
                <p className="text-sm font-medium" style={{ color: sub }}>
                  Sua casa está em ordem: sem dívida cara e com saldo positivo.
                </p>
              </div>
              <div className="rounded-full bg-white/10 px-4 py-2 text-xs font-bold">
                Saldo disponível: {fmt(totalBalance)}
              </div>
            </div>

            <div className="grid gap-6 md:grid-cols-3">
              <div className="rounded-2xl bg-white/5 p-6 border border-white/10">
                <div className="h-10 w-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4">
                  <ShieldCheck className="h-5 w-5" />
                </div>
                <h4 className="font-black text-lg">Reserva de Emergência</h4>
                <p className="text-sm mt-2 leading-relaxed" style={{ color: sub }}>
                  O primeiro passo: 6 meses da sua despesa em liquidez diária (CDB 100% CDI ou
                  Tesouro Selic).
                  {mesesDespesa > 0 && <> No seu caso, <strong className="text-white">{fmt(mesesDespesa * 6)}</strong>.</>}
                </p>
                <button
                  onClick={() => criarCaixinhaSugerida('Reserva de Emergência', mesesDespesa * 6, 24, '#10b981')}
                  disabled={mesesDespesa <= 0}
                  className="mt-6 flex items-center gap-2 text-emerald-400 text-xs font-black uppercase tracking-widest hover:text-emerald-300 disabled:opacity-40"
                  title={mesesDespesa <= 0 ? 'Preciso de histórico de despesa para calcular a meta' : 'Cria a caixinha já com a meta calculada'}
                >
                  Criar caixinha <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              <div className="rounded-2xl bg-white/5 p-6 border border-white/10">
                <div className="h-10 w-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center mb-4">
                  <TrendingUp className="h-5 w-5" />
                </div>
                <h4 className="font-black text-lg">Objetivo de médio prazo</h4>
                <p className="text-sm mt-2 leading-relaxed" style={{ color: sub }}>
                  Para 2 a 5 anos, renda fixa atrelada ao IPCA protege da inflação. Crie a caixinha
                  aqui e o sistema acompanha o quanto falta.
                </p>
                <button
                  onClick={() => criarCaixinhaSugerida('Objetivo de médio prazo', 0, 36, '#3b82f6')}
                  className="mt-6 flex items-center gap-2 text-blue-400 text-xs font-black uppercase tracking-widest hover:text-blue-300"
                >
                  Criar caixinha <ChevronRight className="h-4 w-4" />
                </button>
              </div>

              {/* Sem botão de propósito: o sistema não executa investimento em
                  bolsa, e um botão que não age é pior que nenhum. */}
              <div className="rounded-2xl bg-white/5 p-6 border border-white/10">
                <div className="h-10 w-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4">
                  <ArrowUpRight className="h-5 w-5" />
                </div>
                <h4 className="font-black text-lg">Diversificação</h4>
                <p className="text-sm mt-2 leading-relaxed" style={{ color: sub }}>
                  Com reserva feita e renda fixa em pé, FIIs geram renda mensal e ações buscam
                  crescimento. Isso se faz na sua corretora — o sistema não executa aplicação.
                </p>
                <p className="mt-6 text-[10px] font-black uppercase tracking-widest" style={{ color: sub }}>
                  Apenas informativo
                </p>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Debt Modal */}
      {isDebtModalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm"
          onClick={() => setIsDebtModalOpen(false)}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={(e) => e.stopPropagation()}
            className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-3xl bg-surface p-6 sm:p-8 shadow-2xl"
          >
            <button
              type="button"
              onClick={() => setIsDebtModalOpen(false)}
              className="absolute right-4 top-4 z-10 rounded-xl p-2 text-content-subtle hover:bg-surface-muted hover:text-content"
            >
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-2xl font-black text-content">Nova Dívida</h3>
            <p className="text-sm text-content-subtle mt-1">Registre para calcular o tempo de quitação.</p>
            
            <form onSubmit={handleAddDebt} className="mt-8 space-y-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-content-subtle mb-1">Nome da Dívida</label>
                <input
                  type="text"
                  value={debtName}
                  onChange={(e) => setDebtName(e.target.value)}
                  placeholder="Ex: Empréstimo, Cartão, Financiamento"
                  className="w-full rounded-xl border border-line px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-content-subtle mb-1">Valor Total</label>
                  <input
                    type="number"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    className="w-full rounded-xl border border-line px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-content-subtle mb-1">Valor Restante</label>
                  <input
                    type="number"
                    value={remainingAmount}
                    onChange={(e) => setRemainingAmount(e.target.value)}
                    className="w-full rounded-xl border border-line px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-content-subtle mb-1">Juros Mensal (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                    className="w-full rounded-xl border border-line px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-content-subtle mb-1">Valor Parcela</label>
                  <input
                    type="number"
                    value={monthlyPayment}
                    onChange={(e) => setMonthlyPayment(e.target.value)}
                    className="w-full rounded-xl border border-line px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-content-subtle mb-1">Dia do Vencimento</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-xl border border-line px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  required
                />
              </div>

              {/* Alert Config in Add Modal */}
              <div className="space-y-4 pt-4 border-t border-line">
                <h4 className="text-xs font-black uppercase tracking-widest text-content-subtle">Configurações de Alerta</h4>
                
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="p-3 rounded-xl border border-line bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-content-muted">Vencimento</span>
                      <button
                        type="button"
                        onClick={() => setDueDateEnabled(!dueDateEnabled)}
                        className={cn(
                          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                          dueDateEnabled ? "bg-indigo-600" : "bg-slate-200"
                        )}
                      >
                        <span className={cn(
                          "inline-block h-3 w-3 transform rounded-full bg-surface transition-transform",
                          dueDateEnabled ? "translate-x-5" : "translate-x-1"
                        )} />
                      </button>
                    </div>
                    {dueDateEnabled && (
                      <input
                        type="number"
                        value={dueDateDaysBefore}
                        onChange={(e) => setDueDateDaysBefore(e.target.value)}
                        placeholder="Dias antes"
                        className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold outline-none focus:border-indigo-500"
                      />
                    )}
                  </div>

                  <div className="p-3 rounded-xl border border-line bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-content-muted">Meta Saldo</span>
                      <button
                        type="button"
                        onClick={() => setThresholdEnabled(!thresholdEnabled)}
                        className={cn(
                          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                          thresholdEnabled ? "bg-emerald-600" : "bg-slate-200"
                        )}
                      >
                        <span className={cn(
                          "inline-block h-3 w-3 transform rounded-full bg-surface transition-transform",
                          thresholdEnabled ? "translate-x-5" : "translate-x-1"
                        )} />
                      </button>
                    </div>
                    {thresholdEnabled && (
                      <input
                        type="number"
                        value={thresholdValue}
                        onChange={(e) => setThresholdValue(e.target.value)}
                        placeholder="Valor limite"
                        className="w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-xs font-bold outline-none focus:border-emerald-500"
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsDebtModalOpen(false)}
                  className="flex-1 rounded-xl border border-line py-3 text-sm font-bold text-content-muted hover:bg-surface-muted transition-all"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-xl bg-primary py-3 text-sm font-bold text-white hover:bg-primary/90 shadow-lg shadow-primary/20 transition-all"
                >
                  Salvar Dívida
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
