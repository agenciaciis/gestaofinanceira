import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Transaction, BankAccount, Debt } from '../types';
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
  MessageSquare
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
import { GoogleGenAI } from "@google/genai";

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY || '' });

export const FinancialHealth: React.FC = () => {
  const { selectedEntity } = useEntity();
  const [debts, setDebts] = useState<Debt[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [isDebtModalOpen, setIsDebtModalOpen] = useState(false);
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

    return () => {
      unsubDebts();
      unsubTrans();
      unsubAccs();
    };
  }, [selectedEntity]);

  const totalDebt = useMemo(() => debts.reduce((acc, d) => acc + d.remainingAmount, 0), [debts]);
  const totalBalance = useMemo(() => accounts.reduce((acc, a) => acc + a.currentBalance, 0), [accounts]);
  
  const debtStats = useMemo(() => {
    let totalEstimatedInterest = 0;
    let maxMonths = 0;
    
    debts.forEach(debt => {
      const simPayment = simulationPayments[debt.id] ? Number(simulationPayments[debt.id]) : debt.monthlyPayment;
      const { months, totalInterest } = calculatePayoff(debt.remainingAmount, simPayment, debt.interestRate);
      if (months !== Infinity) {
        totalEstimatedInterest += totalInterest;
        maxMonths = Math.max(maxMonths, months);
      }
    });

    return {
      totalEstimatedInterest,
      maxMonths,
      totalRemaining: totalDebt,
      totalOriginal: debts.reduce((acc, d) => acc + d.totalAmount, 0)
    };
  }, [debts, simulationPayments, totalDebt]);

  const healthScore = useMemo(() => {
    if (totalDebt === 0) return 100;
    const ratio = totalBalance / totalDebt;
    if (ratio >= 1) return 90;
    if (ratio >= 0.5) return 70;
    if (ratio >= 0.2) return 50;
    return 30;
  }, [totalBalance, totalDebt]);

  const debtChartData = useMemo(() => {
    return debts.map(debt => ({
      name: debt.name,
      'Valor Total': debt.totalAmount,
      'Valor Restante': debt.remainingAmount,
      'Pago': debt.totalAmount - debt.remainingAmount
    }));
  }, [debts]);

  const calculatePayoff = (remaining: number, monthly: number, interestRate: number) => {
    if (monthly <= 0) return { months: Infinity, totalInterest: Infinity };
    
    const monthlyRate = interestRate / 100;
    let currentBalance = remaining;
    let totalInterest = 0;
    let months = 0;
    const MAX_MONTHS = 1200; // 100 years safety limit

    while (currentBalance > 0 && months < MAX_MONTHS) {
      const interest = currentBalance * monthlyRate;
      if (interest >= monthly && currentBalance > 0.01) return { months: Infinity, totalInterest: Infinity };
      
      totalInterest += interest;
      currentBalance = currentBalance + interest - monthly;
      months++;
    }

    return { months, totalInterest };
  };

  const activeAlerts = useMemo(() => {
    const today = new Date().getDate();
    return debts.filter(debt => {
      if (!debt.alerts) return false;
      
      const daysUntilDue = debt.dueDate >= today ? debt.dueDate - today : (30 - today + debt.dueDate);
      const isDueSoon = debt.alerts.dueDateEnabled && daysUntilDue <= (debt.alerts.dueDateDaysBefore || 0);
      const isThresholdReached = debt.alerts.thresholdEnabled && debt.remainingAmount <= (debt.alerts.thresholdValue || 0);
      
      return isDueSoon || isThresholdReached;
    });
  }, [debts]);

  const handleSendWhatsAppAlert = async (debt: Debt) => {
    if (!selectedEntity?.whatsappConfig?.enabled) {
      alert('Configure o WhatsApp nas Configurações para enviar alertas.');
      return;
    }

    try {
      const today = new Date().getDate();
      const daysUntilDue = debt.dueDate >= today ? debt.dueDate - today : (30 - today + debt.dueDate);
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
      alert('Alerta enviado para o WhatsApp com sucesso!');
    } catch (error) {
      console.error('Error sending WhatsApp alert:', error);
      alert('Erro ao enviar alerta. Verifique as configurações do WhatsApp.');
    }
  };

  const analyzeFinancialHealth = async () => {
    if (!selectedEntity || isAnalyzing) return;
    setIsAnalyzing(true);
    try {
      const dataSummary = {
        balance: totalBalance,
        debts: debts.map(d => ({ name: d.name, amount: d.remainingAmount, interest: d.interestRate })),
        recentTransactions: transactions.slice(0, 10).map(t => ({ desc: t.description, amount: t.amount, type: t.type }))
      };

      const prompt = `Como um consultor financeiro profissional, analise os seguintes dados financeiros e forneça 3 dicas práticas e curtas para melhorar a saúde financeira, focar em quitar dívidas e onde investir se sobrar dinheiro. Seja direto e motivador. Responda em Português do Brasil.
      Dados: ${JSON.stringify(dataSummary)}`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      setAiAdvice(response.text || "Não foi possível gerar a análise no momento.");
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
          <h2 className="text-3xl font-black text-slate-900 tracking-tight">Saúde Financeira</h2>
          <p className="text-slate-500 font-medium">Análise inteligente e plano de liberdade financeira.</p>
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
                  const today = new Date().getDate();
                  const daysUntilDue = debt.dueDate >= today ? debt.dueDate - today : (30 - today + debt.dueDate);
                  const isDueSoon = debt.alerts?.dueDateEnabled && daysUntilDue <= (debt.alerts?.dueDateDaysBefore || 0);
                  const isThresholdReached = debt.alerts?.thresholdEnabled && debt.remainingAmount <= (debt.alerts?.thresholdValue || 0);

                  return (
                    <div key={debt.id} className="bg-white rounded-2xl p-4 shadow-sm border border-amber-200 flex items-center justify-between gap-4">
                      <div className="flex-1 min-w-0">
                        <p className="font-bold text-slate-900 truncate">{debt.name}</p>
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
        <div className="lg:col-span-2 rounded-3xl bg-white dark:bg-gray-900 p-8 shadow-sm border border-slate-100 dark:border-gray-800 overflow-hidden relative">
          <div className="relative z-10">
            <h3 className="text-lg font-black text-slate-900 dark:text-gray-100 flex items-center gap-2">
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
                <p className="text-sm font-bold text-slate-400 dark:text-gray-500 uppercase tracking-widest">Pontos de 100</p>
                <p className="text-lg font-black text-slate-900 dark:text-gray-100">
                  {healthScore >= 80 ? "Excelente!" : healthScore >= 50 ? "Pode Melhorar" : "Atenção Crítica"}
                </p>
              </div>
            </div>
            <div className="mt-8 h-3 w-full rounded-full bg-slate-100 dark:bg-gray-800 overflow-hidden">
              <motion.div 
                initial={{ width: 0 }}
                animate={{ width: `${healthScore}%` }}
                className={cn(
                  "h-full rounded-full",
                  healthScore >= 80 ? "bg-emerald-500" : healthScore >= 50 ? "bg-amber-500" : "bg-rose-500"
                )}
              />
            </div>
            <p className="mt-4 text-sm text-slate-500 dark:text-gray-400 font-medium">
              Sua saúde financeira é calculada baseada na relação entre seu saldo disponível e suas dívidas totais.
            </p>
          </div>
          <div className="absolute -right-12 -bottom-12 h-64 w-64 bg-slate-50 dark:bg-gray-800/20 rounded-full opacity-50" />
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
          <div className="absolute -right-8 -top-8 h-32 w-32 bg-indigo-200/20 dark:bg-white/10 rounded-full blur-2xl" />
        </div>
      </div>

      {/* Quitação de Dívidas Section */}
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <div>
            <h3 className="text-2xl font-black text-slate-900 flex items-center gap-2">
              <Target className="h-6 w-6 text-rose-500" />
              Quitação de Dívidas
            </h3>
            <p className="text-sm text-slate-500 font-medium">Acompanhamento detalhado e simulação de pagamentos.</p>
          </div>
          <button 
            onClick={() => setIsDebtModalOpen(true)}
            className="flex items-center gap-2 rounded-xl bg-white border border-slate-200 px-4 py-2 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all shadow-sm"
          >
            <Plus className="h-4 w-4" />
            Adicionar Dívida
          </button>
        </div>

        {debts.length > 0 ? (
          <div className="space-y-8">
            {/* Debt Summary Cards */}
            <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-4">
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Total Restante</p>
                <p className="mt-1 text-2xl font-black text-slate-900">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(debtStats.totalRemaining)}
                </p>
              </div>
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Juros Estimados</p>
                <p className="mt-1 text-2xl font-black text-amber-600">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(debtStats.totalEstimatedInterest)}
                </p>
              </div>
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Tempo para Quitação</p>
                <p className="mt-1 text-2xl font-black text-indigo-600">
                  {debtStats.maxMonths === 0 ? '-' : `${debtStats.maxMonths} meses`}
                </p>
              </div>
              <div className="rounded-2xl bg-white p-6 shadow-sm border border-slate-100">
                <p className="text-[10px] font-black text-slate-400 uppercase tracking-widest">Economia Potencial</p>
                <p className="mt-1 text-2xl font-black text-emerald-600">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(debtStats.totalOriginal - debtStats.totalRemaining)}
                </p>
              </div>
            </div>

            {/* Debt Progress Chart */}
            <div className="rounded-3xl bg-white p-8 shadow-sm border border-slate-100">
              <h3 className="text-lg font-black text-slate-900 flex items-center gap-2 mb-8">
                <TrendingUp className="h-5 w-5 text-indigo-500" />
                Comparativo: Valor Total vs Restante
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
                    <Bar dataKey="Valor Total" fill="#e2e8f0" radius={[4, 4, 0, 0]} barSize={40} name="Dívida Original" />
                    <Bar dataKey="Valor Restante" fill="#f43f5e" radius={[4, 4, 0, 0]} barSize={40} name="Saldo Devedor" />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </div>

            {/* Debt List */}
            <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
              {debts.map(debt => {
                const simPayment = simulationPayments[debt.id] ? Number(simulationPayments[debt.id]) : debt.monthlyPayment;
                const { months: monthsToPay, totalInterest } = calculatePayoff(debt.remainingAmount, simPayment, debt.interestRate);
                const payoffDate = monthsToPay === Infinity ? null : addMonths(new Date(), monthsToPay);
                const progress = ((debt.totalAmount - debt.remainingAmount) / debt.totalAmount) * 100;

                return (
                  <motion.div 
                    key={debt.id}
                    layout
                    className="rounded-3xl bg-white p-6 shadow-sm border border-slate-100 hover:shadow-md transition-all flex flex-col"
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
                          <div className="h-8 w-8 rounded-lg bg-slate-50 text-slate-300 flex items-center justify-center">
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
                    <h4 className="font-black text-slate-900">{debt.name}</h4>
                    
                    {/* Alert Badges */}
                    <div className="mt-2 flex flex-wrap gap-2">
                      {debt.alerts?.thresholdEnabled && debt.remainingAmount <= (debt.alerts.thresholdValue || 0) && (
                        <div className="flex items-center gap-1 px-2 py-1 rounded-md bg-emerald-50 text-[10px] font-bold text-emerald-600 border border-emerald-100">
                          <CheckCircle2 className="h-3 w-3" />
                          Meta de Saldo Atingida
                        </div>
                      )}
                      {(() => {
                        const today = new Date().getDate();
                        const daysUntilDue = debt.dueDate >= today ? debt.dueDate - today : (30 - today + debt.dueDate);
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
                          <p className="text-[10px] font-black text-slate-400 uppercase">Restante</p>
                          <p className="text-xl font-black text-slate-900">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(debt.remainingAmount)}
                          </p>
                        </div>
                        <div className="text-right">
                          <p className="text-[10px] font-black text-slate-400 uppercase">Progresso</p>
                          <p className="text-sm font-black text-emerald-600">{progress.toFixed(0)}%</p>
                        </div>
                      </div>
                      <div className="h-2 w-full rounded-full bg-slate-100 overflow-hidden">
                        <div className="h-full bg-emerald-500 rounded-full" style={{ width: `${progress}%` }} />
                      </div>
                      
                      {/* Simulation Input */}
                      <div className="pt-4 border-t border-slate-50">
                        <div className="flex items-center justify-between mb-2">
                          <label className="block text-[10px] font-black text-slate-400 uppercase">Simular Nova Parcela</label>
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
                          <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">R$</span>
                          <input 
                            type="number"
                            value={simulationPayments[debt.id] || ''}
                            onChange={(e) => setSimulationPayments(prev => ({ ...prev, [debt.id]: e.target.value }))}
                            placeholder={debt.monthlyPayment.toString()}
                            className="w-full rounded-xl border border-slate-100 bg-slate-50/50 pl-9 pr-4 py-2 text-sm font-bold text-slate-700 outline-none focus:border-indigo-300 focus:ring-2 focus:ring-indigo-100 transition-all"
                          />
                        </div>
                      </div>

                      <div className="space-y-3 pt-4 border-t border-slate-50">
                        <div className="grid grid-cols-2 gap-4">
                          <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase">Quitação em</p>
                            <p className={cn(
                              "text-sm font-bold",
                              monthsToPay === Infinity ? "text-rose-600" : "text-slate-700"
                            )}>
                              {monthsToPay === Infinity ? "Nunca (Juros > Parcela)" : payoffDate ? format(payoffDate, 'MMM/yyyy', { locale: ptBR }) : '-'}
                            </p>
                          </div>
                          <div>
                            <p className="text-[10px] font-black text-slate-400 uppercase">Total Juros</p>
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
                              const original = calculatePayoff(debt.remainingAmount, debt.monthlyPayment, debt.interestRate);
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
          <div className="rounded-3xl border-2 border-dashed border-slate-200 p-12 text-center">
            <div className="mx-auto h-16 w-16 rounded-full bg-emerald-50 text-emerald-600 flex items-center justify-center mb-4">
              <ShieldCheck className="h-8 w-8" />
            </div>
            <h4 className="text-lg font-black text-slate-900">Nenhuma dívida registrada</h4>
            <p className="text-sm text-slate-500 mt-2">Parabéns! Você está no caminho certo para a liberdade financeira.</p>
          </div>
        )}
      </div>

      {/* Alert Modal */}
      {isAlertModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
          >
            <div className="flex items-center gap-3 mb-6">
              <div className="h-12 w-12 rounded-2xl bg-indigo-50 text-indigo-600 flex items-center justify-center">
                <Bell className="h-6 w-6" />
              </div>
              <div>
                <h3 className="text-xl font-black text-slate-900">Configurar Alertas</h3>
                <p className="text-sm text-slate-500 font-medium">{editingDebt?.name}</p>
              </div>
            </div>
            
            <form onSubmit={handleUpdateAlerts} className="space-y-6">
              {/* Due Date Alert */}
              <div className="p-4 rounded-2xl border border-slate-100 bg-slate-50/50 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-bold text-slate-700">Aviso de Vencimento</span>
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
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      dueDateEnabled ? "translate-x-6" : "translate-x-1"
                    )} />
                  </button>
                </div>
                {dueDateEnabled && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Avisar quantos dias antes?</label>
                    <div className="flex items-center gap-2">
                      <input
                        type="number"
                        value={dueDateDaysBefore}
                        onChange={(e) => setDueDateDaysBefore(e.target.value)}
                        className="flex-1 rounded-xl border border-slate-200 bg-white px-4 py-2 text-sm font-bold outline-none focus:border-indigo-500 transition-all"
                      />
                      <span className="text-xs font-bold text-slate-400">dias</span>
                    </div>
                  </div>
                )}
              </div>

              {/* Threshold Alert */}
              <div className="p-4 rounded-2xl border border-slate-100 bg-slate-50/50 space-y-4">
                <div className="flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Target className="h-4 w-4 text-slate-400" />
                    <span className="text-sm font-bold text-slate-700">Meta de Saldo</span>
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
                      "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                      thresholdEnabled ? "translate-x-6" : "translate-x-1"
                    )} />
                  </button>
                </div>
                {thresholdEnabled && (
                  <div className="animate-in fade-in slide-in-from-top-2">
                    <label className="block text-[10px] font-black text-slate-400 uppercase mb-1">Avisar quando o saldo for menor que:</label>
                    <div className="relative">
                      <span className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400 text-xs font-bold">R$</span>
                      <input
                        type="number"
                        value={thresholdValue}
                        onChange={(e) => setThresholdValue(e.target.value)}
                        className="w-full rounded-xl border border-slate-200 bg-white pl-9 pr-4 py-2 text-sm font-bold outline-none focus:border-emerald-500 transition-all"
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
                  className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all"
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

      {/* Investment Suggestions */}
      <div className="rounded-3xl bg-slate-900 p-8 text-white">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h3 className="text-xl font-black flex items-center gap-2">
              <TrendingUp className="h-6 w-6 text-emerald-400" />
              Onde Investir Agora
            </h3>
            <p className="text-slate-400 text-sm font-medium">Sugestões baseadas no seu perfil e saldo atual.</p>
          </div>
          <div className="hidden sm:block">
             <div className="flex items-center gap-2 px-4 py-2 rounded-full bg-white/10 text-xs font-bold">
               Saldo Disponível: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalBalance)}
             </div>
          </div>
        </div>

        <div className="grid gap-6 md:grid-cols-3">
          <div className="rounded-2xl bg-white/5 p-6 border border-white/10 hover:bg-white/10 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <ShieldCheck className="h-5 w-5" />
            </div>
            <h4 className="font-black text-lg">Reserva de Emergência</h4>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              O primeiro passo. Guarde o equivalente a 6 meses de seus gastos fixos em um investimento de liquidez diária (CDB 100% CDI ou Tesouro Selic).
            </p>
            <div className="mt-6 flex items-center gap-2 text-emerald-400 text-xs font-black uppercase tracking-widest">
              Começar Agora <ChevronRight className="h-4 w-4" />
            </div>
          </div>

          <div className="rounded-2xl bg-white/5 p-6 border border-white/10 hover:bg-white/10 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <TrendingUp className="h-5 w-5" />
            </div>
            <h4 className="font-black text-lg">Renda Fixa (Longo Prazo)</h4>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              Para objetivos de 2 a 5 anos. Considere IPCA+ para proteger seu dinheiro da inflação e garantir ganho real.
            </p>
            <div className="mt-6 flex items-center gap-2 text-blue-400 text-xs font-black uppercase tracking-widest">
              Ver Opções <ChevronRight className="h-4 w-4" />
            </div>
          </div>

          <div className="rounded-2xl bg-white/5 p-6 border border-white/10 hover:bg-white/10 transition-all cursor-pointer group">
            <div className="h-10 w-10 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center mb-4 group-hover:scale-110 transition-transform">
              <ArrowUpRight className="h-5 w-5" />
            </div>
            <h4 className="font-black text-lg">Diversificação</h4>
            <p className="text-sm text-slate-400 mt-2 leading-relaxed">
              Se já tem reserva e renda fixa, explore Fundos Imobiliários (FIIs) para renda passiva mensal ou Ações para crescimento.
            </p>
            <div className="mt-6 flex items-center gap-2 text-indigo-400 text-xs font-black uppercase tracking-widest">
              Explorar <ChevronRight className="h-4 w-4" />
            </div>
          </div>
        </div>
      </div>

      {/* Debt Modal */}
      {isDebtModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-3xl bg-white p-8 shadow-2xl"
          >
            <h3 className="text-2xl font-black text-slate-900">Nova Dívida</h3>
            <p className="text-sm text-slate-500 mt-1">Registre para calcular o tempo de quitação.</p>
            
            <form onSubmit={handleAddDebt} className="mt-8 space-y-4">
              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Nome da Dívida</label>
                <input
                  type="text"
                  value={debtName}
                  onChange={(e) => setDebtName(e.target.value)}
                  placeholder="Ex: Empréstimo, Cartão, Financiamento"
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Valor Total</label>
                  <input
                    type="number"
                    value={totalAmount}
                    onChange={(e) => setTotalAmount(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Valor Restante</label>
                  <input
                    type="number"
                    value={remainingAmount}
                    onChange={(e) => setRemainingAmount(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Juros Mensal (%)</label>
                  <input
                    type="number"
                    step="0.01"
                    value={interestRate}
                    onChange={(e) => setInterestRate(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    required
                  />
                </div>
                <div>
                  <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Valor Parcela</label>
                  <input
                    type="number"
                    value={monthlyPayment}
                    onChange={(e) => setMonthlyPayment(e.target.value)}
                    className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                    required
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-black uppercase tracking-widest text-slate-400 mb-1">Dia do Vencimento</label>
                <input
                  type="number"
                  min="1"
                  max="31"
                  value={dueDate}
                  onChange={(e) => setDueDate(e.target.value)}
                  className="w-full rounded-xl border border-slate-200 px-4 py-3 focus:border-primary focus:ring-2 focus:ring-primary/20 outline-none transition-all"
                  required
                />
              </div>

              {/* Alert Config in Add Modal */}
              <div className="space-y-4 pt-4 border-t border-slate-100">
                <h4 className="text-xs font-black uppercase tracking-widest text-slate-400">Configurações de Alerta</h4>
                
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-700">Vencimento</span>
                      <button
                        type="button"
                        onClick={() => setDueDateEnabled(!dueDateEnabled)}
                        className={cn(
                          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                          dueDateEnabled ? "bg-indigo-600" : "bg-slate-200"
                        )}
                      >
                        <span className={cn(
                          "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
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
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold outline-none focus:border-indigo-500"
                      />
                    )}
                  </div>

                  <div className="p-3 rounded-xl border border-slate-100 bg-slate-50/50 space-y-3">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] font-bold text-slate-700">Meta Saldo</span>
                      <button
                        type="button"
                        onClick={() => setThresholdEnabled(!thresholdEnabled)}
                        className={cn(
                          "relative inline-flex h-5 w-9 items-center rounded-full transition-colors",
                          thresholdEnabled ? "bg-emerald-600" : "bg-slate-200"
                        )}
                      >
                        <span className={cn(
                          "inline-block h-3 w-3 transform rounded-full bg-white transition-transform",
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
                        className="w-full rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-xs font-bold outline-none focus:border-emerald-500"
                      />
                    )}
                  </div>
                </div>
              </div>

              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsDebtModalOpen(false)}
                  className="flex-1 rounded-xl border border-slate-200 py-3 text-sm font-bold text-slate-600 hover:bg-slate-50 transition-all"
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
