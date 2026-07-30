import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { collection, query, onSnapshot, orderBy, doc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Transaction } from '../types';
import jsPDF from 'jspdf';
import autoTable from 'jspdf-autotable';
import { format, startOfMonth, endOfMonth, subMonths, isSameMonth } from 'date-fns';
import { parseLocalDate, isNotCancelled } from '../lib/finance';
import { ptBR } from 'date-fns/locale';
import { CATEGORIES, MONTHS } from '../constants';
import { 
  PieChart as PieChartIcon, 
  BarChart3, 
  TrendingUp, 
  Calendar, 
  ChevronLeft, 
  ChevronRight,
  Download,
  Filter,
  Target,
  FileText
} from 'lucide-react';
import { motion } from 'motion/react';
import { 
  PieChart, 
  Pie, 
  Cell, 
  ResponsiveContainer, 
  Tooltip as RechartsTooltip, 
  Legend,
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  AreaChart,
  Area,
  ComposedChart,
  Line
} from 'recharts';
import { cn } from '../lib/utils';
import { DREPanel } from '../components/DREPanel';
import { PeriodComparePanel } from '../components/PeriodComparePanel';

export const Reports: React.FC = () => {
  const { entities, filterType, selectedEntity } = useEntity();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  /**
   * Baixa uma tabela como CSV. Antes esses botões de download não faziam nada.
   * Ponto e vírgula como separador: é o que o Excel em português espera, e
   * vírgula quebraria por causa do decimal brasileiro.
   */
  const exportCSV = (nomeArquivo: string, linhas: { name: string; value: number }[]) => {
    if (linhas.length === 0) return;
    const corpo = linhas.map(l => `"${l.name.replace(/"/g, '""')}";${l.value.toFixed(2).replace('.', ',')}`);
    const csv = ['Categoria;Valor', ...corpo].join('\r\n');
    // BOM para o Excel reconhecer acento.
    const blob = new Blob(['\ufeff' + csv], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${nomeArquivo}.csv`;
    a.click();
    URL.revokeObjectURL(url);
  };

  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());

  useEffect(() => {
    if (entities.length === 0) return;

    const filteredEntities = filterType === 'ALL' 
      ? entities 
      : entities.filter(e => e.type === filterType);

    const unsubscribes: (() => void)[] = [];
    let allTransactions: Transaction[] = [];

    filteredEntities.forEach(entity => {
      const tQ = query(collection(db, `entities/${entity.id}/transactions`), orderBy('date', 'desc'));
      const unsub = onSnapshot(tQ, (snapshot) => {
        const entityT = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Transaction[];
        allTransactions = [...allTransactions.filter(t => t.entityId !== entity.id), ...entityT];
        setTransactions([...allTransactions]);
      }, (error) => {
        console.error(`Error fetching transactions for entity ${entity.id}:`, error);
        handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/transactions`);
      });
      unsubscribes.push(unsub);
    });

    return () => unsubscribes.forEach(unsub => unsub());
  }, [entities, filterType]);

  useEffect(() => {
    if (entities.length === 0 || filterType === 'ALL') {
      setBudgets({});
      return;
    }

    const entity = entities.find(e => e.type === filterType);
    if (!entity) return;

    const unsub = onSnapshot(doc(db, `entities/${entity.id}/config/budgets`), (snapshot) => {
      if (snapshot.exists()) {
        setBudgets(snapshot.data() as Record<string, number>);
      } else {
        setBudgets({});
      }
    }, (error) => handleFirestoreError(error, OperationType.GET, `entities/${entity.id}/config/budgets`));

    return () => unsub();
  }, [entities, filterType]);

  // Data Aggregation
  const filteredData = useMemo(() => {
    return transactions.filter(t => {
      const d = parseLocalDate(t.date);
      return d.getMonth() === selectedMonth && d.getFullYear() === selectedYear;
    });
  }, [transactions, selectedMonth, selectedYear]);

  const stats = useMemo(() => {
    const realizedIncome = filteredData.filter(t => t.type === 'income' && t.status === 'completed').reduce((acc, t) => acc + t.amount, 0);
    const realizedExpense = filteredData.filter(t => t.type === 'expense' && t.status === 'completed').reduce((acc, t) => acc + t.amount, 0);
    // "Projetado" = realizado + pendente (exclui cancelados).
    const projectedIncome = filteredData.filter(t => t.type === 'income' && isNotCancelled(t)).reduce((acc, t) => acc + t.amount, 0);
    const projectedExpense = filteredData.filter(t => t.type === 'expense' && isNotCancelled(t)).reduce((acc, t) => acc + t.amount, 0);
    
    return { 
      income: realizedIncome, 
      expense: realizedExpense, 
      balance: realizedIncome - realizedExpense,
      projectedIncome,
      projectedExpense,
      projectedBalance: projectedIncome - projectedExpense
    };
  }, [filteredData]);

  const expenseCategoryData = useMemo(() => {
    const expenses = filteredData.filter(t => t.type === 'expense' && t.status === 'completed');
    const grouped = expenses.reduce((acc, t) => {
      const cat = CATEGORIES.find(c => c.id === t.categoryId) || CATEGORIES.find(c => c.id === 'outros')!;
      acc[cat.name] = (acc[cat.name] || 0) + t.amount;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(grouped).map(([name, value]) => ({
      name,
      value: value as number,
      color: CATEGORIES.find(c => c.name === name)?.color || '#9ca3af'
    })).sort((a, b) => (b.value as number) - (a.value as number));
  }, [filteredData]);

  const incomeCategoryData = useMemo(() => {
    const incomes = filteredData.filter(t => t.type === 'income' && t.status === 'completed');
    const grouped = incomes.reduce((acc, t) => {
      const cat = CATEGORIES.find(c => c.id === t.categoryId) || CATEGORIES.find(c => c.id === 'outros')!;
      acc[cat.name] = (acc[cat.name] || 0) + t.amount;
      return acc;
    }, {} as Record<string, number>);

    return Object.entries(grouped).map(([name, value]) => ({
      name,
      value: value as number,
      color: CATEGORIES.find(c => c.name === name)?.color || '#9ca3af'
    })).sort((a, b) => (b.value as number) - (a.value as number));
  }, [filteredData]);

  const monthlyTrend = useMemo(() => {
    // Last 6 months trend
    const months = [];
    const balanceGoal = budgets['monthly_balance_goal'] || 0;

    for (let i = 5; i >= 0; i--) {
      const d = new Date(selectedYear, selectedMonth - i, 1);
      const m = d.getMonth();
      const y = d.getFullYear();
      
      const monthData = transactions.filter(t => {
        const td = parseLocalDate(t.date);
        return td.getMonth() === m && td.getFullYear() === y && isNotCancelled(t);
      });

      const income = monthData.filter(t => t.type === 'income').reduce((acc, t) => acc + t.amount, 0);
      const expense = monthData.filter(t => t.type === 'expense').reduce((acc, t) => acc + t.amount, 0);

      months.push({
        name: MONTHS[m].substring(0, 3),
        income,
        expense,
        balance: income - expense,
        goal: balanceGoal
      });
    }
    return months;
  }, [transactions, selectedMonth, selectedYear, budgets]);

  const expenseBudgetProgress = useMemo(() => {
    if (filterType === 'ALL') return [];
    
    return CATEGORIES.filter(c => budgets[c.id] && (!c.type || c.type === 'expense')).map(category => {
      const spent = expenseCategoryData.find(d => d.name === category.name)?.value || 0;
      const limit = budgets[category.id];
      return {
        name: category.name,
        realizado: spent,
        meta: limit,
      };
    });
  }, [expenseCategoryData, budgets, filterType]);

  const incomeBudgetProgress = useMemo(() => {
    if (filterType === 'ALL') return [];
    
    return CATEGORIES.filter(c => budgets[c.id] && c.type === 'income').map(category => {
      const earned = incomeCategoryData.find(d => d.name === category.name)?.value || 0;
      const goal = budgets[category.id];
      return {
        name: category.name,
        realizado: earned,
        meta: goal,
      };
    });
  }, [incomeCategoryData, budgets, filterType]);

  const cashFlowProjection = useMemo(() => {
    const data = [...monthlyTrend];
    let currentBalance = stats.balance;
    
    // Calculate average monthly income/expense from last 6 months
    const avgIncome = monthlyTrend.reduce((acc, m) => acc + m.income, 0) / monthlyTrend.length;
    const avgExpense = monthlyTrend.reduce((acc, m) => acc + m.expense, 0) / monthlyTrend.length;

    // Project next 6 months
    for (let i = 1; i <= 6; i++) {
      const d = new Date(selectedYear, selectedMonth + i, 1);
      const m = d.getMonth();
      
      currentBalance += (avgIncome - avgExpense);
      
      data.push({
        name: MONTHS[m].substring(0, 3),
        income: avgIncome,
        expense: avgExpense,
        balance: currentBalance,
        isProjection: true
      });
    }
    return data;
  }, [monthlyTrend, stats.balance, selectedMonth, selectedYear]);

  const changeMonth = (delta: number) => {
    let newMonth = selectedMonth + delta;
    let newYear = selectedYear;

    if (newMonth > 11) {
      newMonth = 0;
      newYear++;
    } else if (newMonth < 0) {
      newMonth = 11;
      newYear--;
    }

    setSelectedMonth(newMonth);
    setSelectedYear(newYear);
  };

  const exportPDF = () => {
    const doc = new jsPDF();
    const title = `Relatório Financeiro - ${MONTHS[selectedMonth]} ${selectedYear}`;
    
    doc.setFontSize(20);
    doc.text(title, 14, 22);
    
    doc.setFontSize(12);
    doc.text(`Entidade: ${filterType === 'ALL' ? 'Consolidado' : filterType}`, 14, 32);
    doc.text(`Data de Geração: ${format(new Date(), 'dd/MM/yyyy HH:mm')}`, 14, 38);

    // Summary Table
    autoTable(doc, {
      startY: 45,
      head: [['Resumo', 'Valor']],
      body: [
        ['Receitas Realizadas', new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.income)],
        ['Despesas Pagas', new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.expense)],
        ['Saldo do Período', new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.balance)],
      ],
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] }
    });

    // Categories Table
    const categoryRows = expenseCategoryData.map(cat => [
      cat.name,
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(cat.value),
      `${(stats.expense > 0 ? (cat.value / stats.expense) * 100 : 0).toFixed(1)}%`
    ]);

    autoTable(doc, {
      startY: (doc as any).lastAutoTable.finalY + 10,
      head: [['Categoria (Despesas)', 'Valor', '%']],
      body: categoryRows,
      theme: 'grid',
      headStyles: { fillColor: [239, 68, 68] }
    });

    doc.save(`relatorio_${MONTHS[selectedMonth]}_${selectedYear}.pdf`);
  };

  return (
    <div className="space-y-8">
      <PeriodComparePanel transactions={transactions} />

      {selectedEntity && (
        <DREPanel
          entity={selectedEntity}
          transactions={transactions}
          reference={new Date(selectedYear, selectedMonth, 15)}
        />
      )}

      {/* Header & Month Selector */}
      <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-content">Relatórios e Análises</h2>
          <p className="text-sm text-content-subtle">Visualize o desempenho das suas finanças.</p>
        </div>
        
        <div className="flex items-center gap-3">
          <button 
            onClick={exportPDF}
            className="flex items-center gap-2 rounded-xl bg-surface border border-line px-4 py-2 text-sm font-bold text-content-muted shadow-sm hover:bg-canvas transition-all"
          >
            <FileText className="h-4 w-4 text-primary" />
            Exportar PDF
          </button>
          <div className="flex items-center gap-4 rounded-2xl bg-surface p-2 shadow-sm border border-line">
          <button 
            onClick={() => changeMonth(-1)}
            className="rounded-lg p-2 hover:bg-canvas text-content-subtle"
          >
            <ChevronLeft className="h-5 w-5" />
          </button>
          <div className="flex flex-col items-center min-w-[120px]">
            <span className="text-sm font-bold text-content">{MONTHS[selectedMonth]}</span>
            <span className="text-[10px] font-medium text-content-subtle uppercase tracking-widest">{selectedYear}</span>
          </div>
          <button 
            onClick={() => changeMonth(1)}
            className="rounded-lg p-2 hover:bg-canvas text-content-subtle"
          >
            <ChevronRight className="h-5 w-5" />
          </button>
        </div>
      </div>
    </div>

      {/* Summary Cards */}
      <div className="grid gap-6 sm:grid-cols-3">
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          className="rounded-2xl bg-surface p-6 shadow-sm border border-line"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-content-subtle">Receitas Realizadas</p>
          <h3 className="mt-2 text-2xl font-bold text-green-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.income)}
          </h3>
          <p className="mt-1 text-[10px] text-content-subtle">
            Projetado: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.projectedIncome)}
          </p>
        </motion.div>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.1 }}
          className="rounded-2xl bg-surface p-6 shadow-sm border border-line"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-content-subtle">Despesas Pagas</p>
          <h3 className="mt-2 text-2xl font-bold text-red-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.expense)}
          </h3>
          <p className="mt-1 text-[10px] text-content-subtle">
            Projetado: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.projectedExpense)}
          </p>
        </motion.div>
        <motion.div 
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.2 }}
          className="rounded-2xl bg-surface p-6 shadow-sm border border-line"
        >
          <p className="text-xs font-bold uppercase tracking-wider text-content-subtle">Saldo Realizado</p>
          <h3 className={cn(
            "mt-2 text-2xl font-bold",
            stats.balance >= 0 ? "text-blue-600" : "text-red-600"
          )}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.balance)}
          </h3>
          <p className="mt-1 text-[10px] text-content-subtle">
            Projetado: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(stats.projectedBalance)}
          </p>
        </motion.div>
      </div>

      {/* Budget Progress */}
      {filterType !== 'ALL' && (expenseBudgetProgress.length > 0 || incomeBudgetProgress.length > 0) && (
        <div className="space-y-6">
          <div className="grid gap-6 lg:grid-cols-2">
            {expenseBudgetProgress.length > 0 && (
              <div className="rounded-2xl bg-surface p-8 shadow-sm border border-line">
                <h3 className="text-lg font-bold text-content flex items-center gap-2 mb-6">
                  <Target className="h-5 w-5 text-red-500" />
                  Metas de Gastos (Gasto vs Limite)
                </h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={expenseBudgetProgress}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                      <XAxis 
                        type="number"
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                        tickFormatter={(value) => `R$ ${value}`}
                      />
                      <YAxis 
                        dataKey="name" 
                        type="category"
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#4b5563', fontSize: 12, fontWeight: 600 }}
                        width={100}
                      />
                      <RechartsTooltip 
                        formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend verticalAlign="top" align="right" height={36}/>
                      <Bar dataKey="meta" fill="#e5e7eb" radius={[0, 4, 4, 0]} name="Limite" barSize={20} />
                      <Bar dataKey="realizado" fill="#ef4444" radius={[0, 4, 4, 0]} name="Gasto Real" barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}

            {incomeBudgetProgress.length > 0 && (
              <div className="rounded-2xl bg-surface p-8 shadow-sm border border-line">
                <h3 className="text-lg font-bold text-content flex items-center gap-2 mb-6">
                  <Target className="h-5 w-5 text-emerald-500" />
                  Metas de Receita (Ganho vs Meta)
                </h3>
                <div className="h-[300px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart 
                      data={incomeBudgetProgress}
                      layout="vertical"
                      margin={{ top: 5, right: 30, left: 40, bottom: 5 }}
                    >
                      <CartesianGrid strokeDasharray="3 3" horizontal={true} vertical={false} stroke="#f3f4f6" />
                      <XAxis 
                        type="number"
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#9ca3af', fontSize: 12 }}
                        tickFormatter={(value) => `R$ ${value}`}
                      />
                      <YAxis 
                        dataKey="name" 
                        type="category"
                        axisLine={false} 
                        tickLine={false} 
                        tick={{ fill: '#4b5563', fontSize: 12, fontWeight: 600 }}
                        width={100}
                      />
                      <RechartsTooltip 
                        formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                        contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                      />
                      <Legend verticalAlign="top" align="right" height={36}/>
                      <Bar dataKey="meta" fill="#e5e7eb" radius={[0, 4, 4, 0]} name="Meta" barSize={20} />
                      <Bar dataKey="realizado" fill="#10b981" radius={[0, 4, 4, 0]} name="Ganho Real" barSize={20} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </div>
            )}
          </div>

          {/* Detailed Progress List */}
          <div className="grid gap-6 lg:grid-cols-2">
            {incomeBudgetProgress.length > 0 && (
              <div className="rounded-2xl bg-surface p-8 shadow-sm border border-line">
                <h3 className="text-sm font-black uppercase tracking-widest text-content-subtle mb-6">Detalhamento de Metas de Receita</h3>
                <div className="space-y-6">
                  {incomeBudgetProgress.map(p => {
                    const percentage = p.meta > 0 ? (p.realizado / p.meta) * 100 : 0;
                    return (
                      <div key={p.name} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-content-muted">{p.name}</span>
                          <span className="text-sm font-black text-emerald-600">{percentage.toFixed(1)}%</span>
                        </div>
                        <div className="h-3 w-full rounded-full bg-surface-muted overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(percentage, 100)}%` }}
                            className="h-full bg-emerald-500 rounded-full"
                          />
                        </div>
                        <div className="flex justify-between text-xs text-content-subtle">
                          <span>Realizado: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.realizado)}</span>
                          <span>Meta: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.meta)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}

            {expenseBudgetProgress.length > 0 && (
              <div className="rounded-2xl bg-surface p-8 shadow-sm border border-line">
                <h3 className="text-sm font-black uppercase tracking-widest text-content-subtle mb-6">Detalhamento de Limites de Gastos</h3>
                <div className="space-y-6">
                  {expenseBudgetProgress.map(p => {
                    const percentage = p.meta > 0 ? (p.realizado / p.meta) * 100 : 0;
                    return (
                      <div key={p.name} className="space-y-2">
                        <div className="flex items-center justify-between">
                          <span className="text-sm font-bold text-content-muted">{p.name}</span>
                          <span className={cn(
                            "text-sm font-black",
                            percentage >= 100 ? "text-red-600" : percentage >= 80 ? "text-amber-600" : "text-content"
                          )}>
                            {percentage.toFixed(1)}%
                          </span>
                        </div>
                        <div className="h-3 w-full rounded-full bg-surface-muted overflow-hidden">
                          <motion.div 
                            initial={{ width: 0 }}
                            animate={{ width: `${Math.min(percentage, 100)}%` }}
                            className={cn(
                              "h-full rounded-full",
                              percentage >= 100 ? "bg-red-500" : percentage >= 80 ? "bg-amber-500" : "bg-primary"
                            )}
                          />
                        </div>
                        <div className="flex justify-between text-xs text-content-subtle">
                          <span>Gasto: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.realizado)}</span>
                          <span>Limite: {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(p.meta)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        {/* Category Breakdown */}
        <div className="rounded-2xl bg-surface p-8 shadow-sm border border-line">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="text-lg font-bold text-content flex items-center gap-2">
              <PieChartIcon className="h-5 w-5 text-primary" />
              Gastos por Categoria
            </h3>
            <button
              onClick={() => exportCSV(`gastos-por-categoria-${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`, expenseCategoryData)}
              disabled={expenseCategoryData.length === 0}
              title="Baixar em CSV"
              aria-label="Baixar gastos por categoria em CSV"
              className="text-content-subtle hover:text-primary disabled:opacity-40 transition-colors"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
          
          <div className="h-[300px] w-full">
            {expenseCategoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={expenseCategoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {expenseCategoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip 
                    formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36}/>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-content-subtle">
                <PieChartIcon className="mb-2 h-12 w-12 opacity-20" />
                <p>Sem dados para este período</p>
              </div>
            )}
          </div>
        </div>

        {/* Income Category Breakdown */}
        <div className="rounded-2xl bg-surface p-8 shadow-sm border border-line">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="text-lg font-bold text-content flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-emerald-500" />
              Receitas por Categoria
            </h3>
            <button
              onClick={() => exportCSV(`receitas-por-categoria-${selectedYear}-${String(selectedMonth + 1).padStart(2, '0')}`, incomeCategoryData)}
              disabled={incomeCategoryData.length === 0}
              title="Baixar em CSV"
              aria-label="Baixar receitas por categoria em CSV"
              className="text-content-subtle hover:text-primary disabled:opacity-40 transition-colors"
            >
              <Download className="h-4 w-4" />
            </button>
          </div>
          
          <div className="h-[300px] w-full">
            {incomeCategoryData.length > 0 ? (
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={incomeCategoryData}
                    cx="50%"
                    cy="50%"
                    innerRadius={60}
                    outerRadius={100}
                    paddingAngle={5}
                    dataKey="value"
                  >
                    {incomeCategoryData.map((entry, index) => (
                      <Cell key={`cell-${index}`} fill={entry.color} />
                    ))}
                  </Pie>
                  <RechartsTooltip 
                    formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                    contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                  />
                  <Legend verticalAlign="bottom" height={36}/>
                </PieChart>
              </ResponsiveContainer>
            ) : (
              <div className="flex h-full flex-col items-center justify-center text-content-subtle">
                <TrendingUp className="mb-2 h-12 w-12 opacity-20" />
                <p>Sem dados para este período</p>
              </div>
            )}
          </div>
        </div>

        {/* Income vs Expense */}
        <div className="rounded-2xl bg-surface p-8 shadow-sm border border-line">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="text-lg font-bold text-content flex items-center gap-2">
              <BarChart3 className="h-5 w-5 text-primary" />
              Receitas vs Despesas
            </h3>
          </div>
          
          <div className="h-[300px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9ca3af', fontSize: 12 }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9ca3af', fontSize: 12 }}
                  tickFormatter={(value) => `R$ ${value}`}
                />
                <RechartsTooltip 
                  formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Bar dataKey="income" fill="#10b981" radius={[4, 4, 0, 0]} name="Receita" animationDuration={900} />
                <Bar dataKey="expense" fill="#ef4444" radius={[4, 4, 0, 0]} name="Despesa" animationDuration={900} animationBegin={150} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Monthly Trend */}
        <div className="lg:col-span-2 rounded-2xl bg-surface p-8 shadow-sm border border-line">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="text-lg font-bold text-content flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Evolução do Saldo Mensal (vs Meta)
            </h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-[10px] font-bold text-content-subtle uppercase">Saldo Real</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-amber-500" />
                <span className="text-[10px] font-bold text-content-subtle uppercase">Meta de Saldo</span>
              </div>
            </div>
          </div>
          
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={monthlyTrend}>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9ca3af', fontSize: 12 }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9ca3af', fontSize: 12 }}
                  tickFormatter={(value) => `R$ ${value}`}
                />
                <RechartsTooltip 
                  formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Legend verticalAlign="top" align="right" height={36}/>
                <Bar dataKey="balance" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Saldo Mensal" barSize={40} />
                <Line 
                  type="monotone" 
                  dataKey="goal" 
                  stroke="#f59e0b" 
                  strokeWidth={3} 
                  strokeDasharray="5 5"
                  dot={{ r: 4, fill: '#f59e0b' }} 
                  name="Meta de Saldo"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>

        {/* Cash Flow Projection */}
        <div className="lg:col-span-2 rounded-2xl bg-surface p-8 shadow-sm border border-line">
          <div className="mb-8 flex items-center justify-between">
            <h3 className="text-lg font-bold text-content flex items-center gap-2">
              <TrendingUp className="h-5 w-5 text-primary" />
              Projeção de Fluxo de Caixa (Próximos 6 meses)
            </h3>
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-blue-500" />
                <span className="text-[10px] font-bold text-content-subtle uppercase">Histórico</span>
              </div>
              <div className="flex items-center gap-1.5">
                <div className="h-2 w-2 rounded-full bg-blue-300" />
                <span className="text-[10px] font-bold text-content-subtle uppercase">Projeção</span>
              </div>
            </div>
          </div>
          
          <div className="h-[350px] w-full">
            <ResponsiveContainer width="100%" height="100%">
              <ComposedChart data={cashFlowProjection}>
                <defs>
                  <linearGradient id="colorBalance" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor="#3b82f6" stopOpacity={0.1}/>
                    <stop offset="95%" stopColor="#3b82f6" stopOpacity={0}/>
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                <XAxis 
                  dataKey="name" 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9ca3af', fontSize: 12 }}
                />
                <YAxis 
                  axisLine={false} 
                  tickLine={false} 
                  tick={{ fill: '#9ca3af', fontSize: 12 }}
                  tickFormatter={(value) => `R$ ${value}`}
                />
                <RechartsTooltip 
                  formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                  contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                />
                <Area 
                  type="monotone" 
                  dataKey="balance" 
                  stroke="#3b82f6" 
                  strokeWidth={3}
                  fillOpacity={1} 
                  fill="url(#colorBalance)" 
                  name="Saldo Acumulado"
                />
                <Line 
                  type="monotone" 
                  dataKey="income" 
                  stroke="#10b981" 
                  strokeWidth={2} 
                  dot={false} 
                  name="Receita"
                />
                <Line 
                  type="monotone" 
                  dataKey="expense" 
                  stroke="#ef4444" 
                  strokeWidth={2} 
                  dot={false} 
                  name="Despesa"
                />
              </ComposedChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>
    </div>
  );
};
