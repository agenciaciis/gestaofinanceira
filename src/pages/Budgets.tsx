import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, onSnapshot, setDoc, doc, query } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CATEGORIES } from '../constants';
import { Target, Save } from 'lucide-react';
import { Transaction } from '../types';
import { budgetProgress, BudgetLine } from '../lib/budgets';

export const Budgets: React.FC = () => {
  const { entities, filterType, selectedEntity } = useEntity();
  const { showToast } = useUI();
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isSaving, setIsSaving] = useState(false);

  // Entidade-alvo = a que o usuário selecionou. Antes usava-se
  // entities.find(e => e.type === filterType), que com DUAS entidades do mesmo
  // tipo sempre pegava a 1ª — a 2ª nunca via nem salvava suas metas. Fallback
  // para o filtro por tipo se ainda não há seleção.
  const targetEntity = selectedEntity ?? entities.find(e => e.type === filterType) ?? null;

  useEffect(() => {
    if (!targetEntity) return;
    const entity = targetEntity;

    const unsubB = onSnapshot(doc(db, `entities/${entity.id}/config/budgets`), (snapshot) => {
      setBudgets(snapshot.exists() ? (snapshot.data() as Record<string, number>) : {});
    }, (error) => handleFirestoreError(error, OperationType.GET, `entities/${entity.id}/config/budgets`));

    // Transações da entidade para mostrar o REALIZADO ao lado do orçado.
    const unsubT = onSnapshot(query(collection(db, `entities/${entity.id}/transactions`)), (snap) => {
      setTransactions(snap.docs.map(d => d.data() as Transaction));
    }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/transactions`));

    return () => { unsubB(); unsubT(); };
  }, [targetEntity?.id]);

  // Orçado × realizado do mês corrente, pela fonte única testada (lib/budgets).
  const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);
  const expenseLines = useMemo(() => {
    const m = new Map<string, BudgetLine>();
    for (const l of budgetProgress(budgets, transactions, new Date(), 'expense')) m.set(l.categoryId, l);
    return m;
  }, [budgets, transactions]);
  const incomeLines = useMemo(() => {
    const m = new Map<string, BudgetLine>();
    for (const l of budgetProgress(budgets, transactions, new Date(), 'income')) m.set(l.categoryId, l);
    return m;
  }, [budgets, transactions]);

  const renderProgress = (line?: BudgetLine) => {
    if (!line || line.limit <= 0) return null;
    const pct = Math.min(line.percent, 100);
    return (
      <div className="mt-3">
        <div className="mb-1 flex justify-between text-[11px] font-bold">
          <span className={line.exceeded ? 'text-rose-600' : 'text-content-subtle'}>{brl(line.spent)} de {brl(line.limit)}</span>
          <span className={line.exceeded ? 'text-rose-600' : 'text-content-subtle'}>{line.percent.toFixed(0)}%</span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
          <div className="h-full rounded-full transition-all" style={{ width: `${pct}%`, backgroundColor: line.exceeded ? '#ef4444' : '#10b981' }} />
        </div>
        <p className="mt-1 text-[11px] text-content-subtle">
          {line.exceeded ? `Estourou ${brl(Math.abs(line.remaining))}` : `Resta ${brl(line.remaining)}`}
        </p>
      </div>
    );
  };

  const handleSave = async () => {
    if (!targetEntity) {
      showToast('Selecione uma entidade específica (PF ou PJ) para definir metas.', 'error');
      return;
    }

    setIsSaving(true);
    try {
      // Grava SÓ o mapa categoria→valor. ownerUid/collaboratorsEmails NÃO entram
      // aqui: o snapshot relê o doc inteiro como Record<string, number> e esses
      // campos poluiriam as metas (viravam "categorias" fantasma).
      await setDoc(doc(db, `entities/${targetEntity.id}/config/budgets`), { ...budgets });
      showToast('Metas salvas com sucesso!', 'success');
    } catch (error) {
      console.error("Error saving budgets:", error);
      showToast('Erro ao salvar metas.', 'error');
    } finally {
      setIsSaving(false);
    }
  };

  const updateBudget = (categoryId: string, value: string) => {
    const amount = parseFloat(value) || 0;
    setBudgets(prev => ({ ...prev, [categoryId]: amount }));
  };

  if (!targetEntity) {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <div className="mb-4 rounded-full bg-blue-50 p-4">
          <Target className="h-12 w-12 text-blue-500" />
        </div>
        <h2 className="text-xl font-bold text-content">Selecione uma entidade</h2>
        <p className="mt-2 max-w-md text-content-subtle">
          Para definir metas de gastos, selecione uma entidade específica (PF ou PJ) no seletor acima.
        </p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-content">Metas Mensais</h1>
          <p className="text-content-subtle">Defina metas de receitas e limites de gastos por categoria para {targetEntity.name}</p>
        </div>
        <button
          onClick={handleSave}
          disabled={isSaving}
          className="flex items-center gap-2 rounded-xl bg-primary px-6 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all disabled:opacity-50"
        >
          {isSaving ? (
            <div className="h-4 w-4 animate-spin rounded-full border-2 border-white border-t-transparent"></div>
          ) : (
            <Save className="h-4 w-4" />
          )}
          Salvar Metas
        </button>
      </div>

      <div className="space-y-8">
        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <div className="h-2 w-2 rounded-full bg-blue-500" />
            <h2 className="text-lg font-bold text-content">Meta de Saldo Mensal</h2>
          </div>
          <div className="max-w-md rounded-2xl border border-line bg-surface p-6 shadow-sm transition-all hover:shadow-md">
            <div className="mb-4 flex items-center gap-3">
              <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-blue-500 text-white">
                <Target className="h-5 w-5" />
              </div>
              <div>
                <h3 className="font-bold text-content">Saldo Mensal</h3>
                <p className="text-xs text-content-subtle">Quanto você deseja sobrar no fim do mês</p>
              </div>
            </div>
            <div className="relative">
              <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-content-subtle">R$</span>
              <input
                type="number"
                value={budgets['monthly_balance_goal'] || ''}
                onChange={(e) => updateBudget('monthly_balance_goal', e.target.value)}
                placeholder="0,00"
                className="w-full rounded-xl border border-line bg-canvas py-3 pl-10 pr-4 text-lg font-bold outline-none focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/5 transition-all"
              />
            </div>
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <div className="h-2 w-2 rounded-full bg-red-500" />
            <h2 className="text-lg font-bold text-content">Metas de Gastos (Limites)</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.filter(c => (!c.type || c.type === 'expense') && c.id !== 'transferencia').map((category) => (
              <div key={category.id} className="rounded-2xl border border-line bg-surface p-6 shadow-sm transition-all hover:shadow-md">
                <div className="mb-4 flex items-center gap-3">
                  <div 
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: category.color }}
                  >
                    <Target className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-content">{category.name}</h3>
                    <p className="text-xs text-content-subtle">Limite mensal</p>
                  </div>
                </div>
                
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-content-subtle">R$</span>
                  <input
                    type="number"
                    value={budgets[category.id] || ''}
                    onChange={(e) => updateBudget(category.id, e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-xl border border-line bg-canvas py-3 pl-10 pr-4 text-lg font-bold outline-none focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/5 transition-all"
                  />
                </div>
                {renderProgress(expenseLines.get(category.id))}
              </div>
            ))}
          </div>
        </section>

        <section className="space-y-4">
          <div className="flex items-center gap-2 border-b border-line pb-2">
            <div className="h-2 w-2 rounded-full bg-emerald-500" />
            <h2 className="text-lg font-bold text-content">Metas de Receita</h2>
          </div>
          <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
            {CATEGORIES.filter(c => c.type === 'income').map((category) => (
              <div key={category.id} className="rounded-2xl border border-line bg-surface p-6 shadow-sm transition-all hover:shadow-md">
                <div className="mb-4 flex items-center gap-3">
                  <div 
                    className="flex h-10 w-10 items-center justify-center rounded-xl text-white"
                    style={{ backgroundColor: category.color }}
                  >
                    <Target className="h-5 w-5" />
                  </div>
                  <div>
                    <h3 className="font-bold text-content">{category.name}</h3>
                    <p className="text-xs text-content-subtle">Meta de ganho mensal</p>
                  </div>
                </div>
                
                <div className="relative">
                  <span className="absolute left-4 top-1/2 -translate-y-1/2 text-sm font-bold text-content-subtle">R$</span>
                  <input
                    type="number"
                    value={budgets[category.id] || ''}
                    onChange={(e) => updateBudget(category.id, e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-xl border border-line bg-canvas py-3 pl-10 pr-4 text-lg font-bold outline-none focus:border-primary focus:bg-surface focus:ring-4 focus:ring-primary/5 transition-all"
                  />
                </div>
                {renderProgress(incomeLines.get(category.id))}
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
