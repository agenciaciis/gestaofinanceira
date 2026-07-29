import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, onSnapshot, setDoc, doc, query, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CATEGORIES } from '../constants';
import { Target, Save, AlertCircle, CheckCircle2 } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';

interface Budget {
  categoryId: string;
  amount: number;
}

export const Budgets: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { showToast } = useUI();
  const [budgets, setBudgets] = useState<Record<string, number>>({});
  const [isSaving, setIsSaving] = useState(false);

  useEffect(() => {
    if (entities.length === 0 || filterType === 'ALL') return;

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

  const handleSave = async () => {
    if (filterType === 'ALL') {
      showToast('Selecione uma entidade específica (PF ou PJ) para definir metas.', 'error');
      return;
    }

    const entity = entities.find(e => e.type === filterType);
    if (!entity) return;

    setIsSaving(true);
    try {
      await setDoc(doc(db, `entities/${entity.id}/config/budgets`), {
        ...budgets,
        ownerUid: entity.ownerUid,
        collaboratorsEmails: entity.collaboratorsEmails || [],
      });
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

  if (filterType === 'ALL') {
    return (
      <div className="flex h-[60vh] flex-col items-center justify-center text-center">
        <div className="mb-4 rounded-full bg-blue-50 p-4">
          <Target className="h-12 w-12 text-blue-500" />
        </div>
        <h2 className="text-xl font-bold text-content">Metas Financeiras</h2>
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
          <p className="text-content-subtle">Defina metas de receitas e limites de gastos por categoria para {filterType}</p>
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
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
};
