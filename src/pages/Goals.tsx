/**
 * Caixinhas — juntar dinheiro para objetivos (praia, carro, reserva).
 *
 * O quanto já foi guardado NÃO é digitado: vem dos lançamentos marcados com a
 * caixinha (ver src/lib/goals.ts). Assim o valor nunca desencontra do extrato.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Goal, Transaction } from '../types';
import { PiggyBank, Plus, Trash2, Edit2, Target, CheckCircle2, AlertCircle, TrendingUp } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { computeGoalProgress, monthlyNeeded, goalForecast, goalStatus } from '../lib/goals';
import { BANK_PRESETS, normalizeHex, readableForeground } from '../lib/brandColors';
import { formatLocalDate } from '../lib/finance';

const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);

export const Goals: React.FC = () => {
  const { entities, selectedEntity, filterType } = useEntity();
  const { showToast, confirm } = useUI();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Goal | null>(null);

  // Formulário
  const [name, setName] = useState('');
  const [targetAmount, setTargetAmount] = useState('');
  const [deadline, setDeadline] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('');
  const [targetEntityId, setTargetEntityId] = useState('');

  const visibleEntities = useMemo(
    () => (filterType === 'ALL' ? entities : entities.filter(e => e.type === filterType)),
    [entities, filterType]
  );

  useEffect(() => {
    if (visibleEntities.length === 0) { setLoading(false); return; }
    const unsubs: (() => void)[] = [];
    let allGoals: Goal[] = [];
    let allTx: Transaction[] = [];

    visibleEntities.forEach(entity => {
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/goals`)), snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Goal[];
        allGoals = [...allGoals.filter(g => g.entityId !== entity.id), ...list];
        setGoals([...allGoals]);
        setLoading(false);
      }, e => handleFirestoreError(e, OperationType.LIST, `entities/${entity.id}/goals`)));

      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/transactions`)), snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[];
        allTx = [...allTx.filter(t => t.entityId !== entity.id), ...list];
        setTransactions([...allTx]);
      }, e => handleFirestoreError(e, OperationType.LIST, `entities/${entity.id}/transactions`)));
    });

    return () => unsubs.forEach(u => u());
  }, [visibleEntities]);

  const resetForm = () => {
    setEditing(null); setName(''); setTargetAmount(''); setDeadline('');
    setDescription(''); setColor(''); setTargetEntityId(selectedEntity?.id || '');
  };

  const openEdit = (g: Goal) => {
    setEditing(g); setName(g.name); setTargetAmount(String(g.targetAmount));
    setDeadline(g.deadline || ''); setDescription(g.description || '');
    setColor(g.color || ''); setTargetEntityId(g.entityId); setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const entityId = targetEntityId || selectedEntity?.id;
    if (!entityId) { showToast('Escolha se a caixinha é da PF ou da PJ.', 'error'); return; }
    const target = Number(targetAmount);
    if (!Number.isFinite(target) || target <= 0) { showToast('Informe um valor de meta maior que zero.', 'error'); return; }

    const entity = entities.find(en => en.id === entityId);
    const data = {
      name: name.trim(),
      targetAmount: target,
      deadline: deadline || null,
      description: description.trim() || null,
      color: normalizeHex(color) || null,
      entityId,
      ownerUid: entity?.ownerUid,
      collaboratorsEmails: entity?.collaboratorsEmails || [],
    };

    try {
      if (editing) {
        await updateDoc(doc(db, `entities/${editing.entityId}/goals`, editing.id), data);
        showToast('Caixinha atualizada!', 'success');
      } else {
        await addDoc(collection(db, `entities/${entityId}/goals`), { ...data, createdAt: serverTimestamp() });
        showToast('Caixinha criada! Marque um lançamento com ela para começar a guardar.', 'success');
      }
      setIsModalOpen(false); resetForm();
    } catch (error) {
      console.error('Erro ao salvar caixinha:', error);
      showToast('Erro ao salvar a caixinha.', 'error');
    }
  };

  const handleDelete = async (g: Goal) => {
    const ok = await confirm({
      title: 'Excluir caixinha',
      message: `Excluir "${g.name}"? Os lançamentos já feitos continuam no extrato, só perdem o vínculo com ela.`,
      variant: 'danger',
    });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, `entities/${g.entityId}/goals`, g.id));
      showToast('Caixinha excluída.', 'success');
    } catch (error) {
      console.error('Erro ao excluir caixinha:', error);
      showToast('Erro ao excluir.', 'error');
    }
  };

  const totals = useMemo(() => {
    let saved = 0, target = 0, concluidas = 0;
    for (const g of goals) {
      const p = computeGoalProgress(g, transactions);
      saved += p.saved; target += Number(g.targetAmount) || 0;
      if (p.complete) concluidas++;
    }
    return { saved, target, concluidas };
  }, [goals, transactions]);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-3xl font-black text-content tracking-tight">Caixinhas & Objetivos</h2>
          <p className="text-sm font-medium text-content-subtle">
            Junte dinheiro para o que você quer. O guardado vem dos seus lançamentos — nada é digitado à mão.
          </p>
        </div>
        <button
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
        >
          <Plus className="h-4 w-4" /> Nova Caixinha
        </button>
      </div>

      {goals.length > 0 && (
        <div className="grid gap-4 sm:grid-cols-3">
          <div className="rounded-2xl bg-surface p-5 border border-line shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Guardado no total</p>
            <p className="mt-1 text-2xl font-black text-emerald-600">{fmt(totals.saved)}</p>
          </div>
          <div className="rounded-2xl bg-surface p-5 border border-line shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Somando as metas</p>
            <p className="mt-1 text-2xl font-black text-content">{fmt(totals.target)}</p>
          </div>
          <div className="rounded-2xl bg-surface p-5 border border-line shadow-sm">
            <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Conquistadas</p>
            <p className="mt-1 text-2xl font-black text-content">{totals.concluidas} de {goals.length}</p>
          </div>
        </div>
      )}

      {goals.length === 0 ? (
        <div className="flex flex-col items-center justify-center rounded-3xl border border-dashed border-line bg-surface py-20 text-center">
          <PiggyBank className="h-12 w-12 text-content-subtle mb-4" />
          <h3 className="text-lg font-bold text-content">Nenhuma caixinha ainda</h3>
          <p className="mt-1 max-w-md text-sm text-content-subtle">
            Crie uma para a praia, um carro, a reserva de emergência. Depois é só marcar seus
            lançamentos com ela que o progresso anda sozinho.
          </p>
        </div>
      ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {goals.map(goal => {
            const p = computeGoalProgress(goal, transactions);
            const status = goalStatus(goal, p.saved);
            const perMonth = monthlyNeeded(p.remaining, goal.deadline);
            const forecast = goalForecast(goal, transactions);
            const accent = normalizeHex(goal.color) || '#2563eb';
            const entity = entities.find(e => e.id === goal.entityId);

            return (
              <motion.div
                key={goal.id}
                layout
                className="group relative overflow-hidden rounded-3xl bg-surface p-6 shadow-sm border border-line hover:shadow-lg transition-all"
              >
                <div className="absolute inset-x-0 top-0 h-1.5" style={{ backgroundColor: accent }} />

                <div className="flex items-start justify-between">
                  <div
                    className="flex h-11 w-11 items-center justify-center rounded-2xl"
                    style={{ backgroundColor: accent, color: readableForeground(accent) }}
                  >
                    <PiggyBank className="h-5 w-5" />
                  </div>
                  <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                    <button onClick={() => openEdit(goal)} className="rounded-lg p-2 text-content-subtle hover:text-primary hover:bg-surface-muted">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(goal)} className="rounded-lg p-2 text-content-subtle hover:text-rose-600 hover:bg-surface-muted">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4 flex items-center gap-2">
                  <h3 className="text-lg font-black text-content">{goal.name}</h3>
                  {entity && (
                    <span className="rounded-md bg-surface-muted px-1.5 py-0.5 text-[10px] font-black text-content-subtle">
                      {entity.type}
                    </span>
                  )}
                </div>
                {goal.description && <p className="text-xs text-content-subtle">{goal.description}</p>}

                <div className="mt-5">
                  <div className="flex items-baseline justify-between">
                    <p className="text-2xl font-black text-content">{fmt(p.saved)}</p>
                    <p className="text-xs font-bold text-content-subtle">de {fmt(goal.targetAmount)}</p>
                  </div>
                  <div className="mt-2 h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
                    <motion.div
                      initial={{ width: 0 }}
                      animate={{ width: `${p.percent}%` }}
                      transition={{ duration: 0.7, ease: [0.16, 1, 0.3, 1] }}
                      className="h-full rounded-full"
                      style={{ backgroundColor: p.complete ? '#10b981' : accent }}
                    />
                  </div>
                  <div className="mt-1 flex justify-between text-[11px] font-bold">
                    <span style={{ color: accent }}>{p.percent.toFixed(0)}%</span>
                    <span className="text-content-subtle">
                      {p.complete ? 'Meta batida!' : `Faltam ${fmt(p.remaining)}`}
                    </span>
                  </div>
                </div>

                <div className="mt-5 space-y-1.5 border-t border-line pt-4 text-xs">
                  {status === 'concluida' ? (
                    <p className="flex items-center gap-1.5 font-bold text-emerald-600">
                      <CheckCircle2 className="h-4 w-4" /> Conquistada
                    </p>
                  ) : status === 'atrasada' ? (
                    <p className="flex items-center gap-1.5 font-bold text-rose-600">
                      <AlertCircle className="h-4 w-4" /> Prazo venceu e ainda falta {fmt(p.remaining)}
                    </p>
                  ) : perMonth !== null ? (
                    <p className="flex items-center gap-1.5 text-content-muted">
                      <Target className="h-4 w-4 text-content-subtle" />
                      Guarde <strong className="text-content">{fmt(perMonth)}</strong>/mês para chegar em{' '}
                      {goal.deadline && format(new Date(goal.deadline + 'T00:00:00'), "MMM 'de' yyyy", { locale: ptBR })}
                    </p>
                  ) : (
                    <p className="text-content-subtle">Sem prazo definido — sem ritmo exigido.</p>
                  )}

                  {!p.complete && forecast.monthlyPace > 0 && forecast.finishDate && (
                    <p className="flex items-center gap-1.5 text-content-muted">
                      <TrendingUp className="h-4 w-4 text-content-subtle" />
                      No seu ritmo real ({fmt(forecast.monthlyPace)}/mês) você chega em{' '}
                      <strong className="text-content capitalize">
                        {format(forecast.finishDate, "MMM 'de' yyyy", { locale: ptBR })}
                      </strong>
                    </p>
                  )}
                  {!p.complete && forecast.monthlyPace <= 0 && (
                    <p className="text-content-subtle">
                      Ainda sem depósitos. Marque um lançamento com esta caixinha para começar.
                    </p>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            className="w-full max-w-lg rounded-3xl bg-surface p-8 shadow-2xl max-h-[90vh] overflow-y-auto"
          >
            <h3 className="text-xl font-black text-content">{editing ? 'Editar caixinha' : 'Nova caixinha'}</h3>
            <p className="text-sm text-content-subtle">Um objetivo por caixinha. O progresso vem dos lançamentos.</p>

            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-content-muted">Nome do objetivo</label>
                <input
                  type="text" required value={name} onChange={e => setName(e.target.value)}
                  placeholder="Ex: Praia em janeiro, Reserva, Carro novo"
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Quanto quero juntar</label>
                  <input
                    type="number" step="0.01" min="0.01" required value={targetAmount}
                    onChange={e => setTargetAmount(e.target.value)} placeholder="5000.00"
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Até quando (opcional)</label>
                  <input
                    type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                    min={formatLocalDate(new Date())}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* PF ou PJ — separação é o ponto central do sistema */}
              <div>
                <label className="block text-sm font-medium text-content-muted">É de qual? (PF ou PJ)</label>
                <select
                  required value={targetEntityId} onChange={e => setTargetEntityId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                >
                  <option value="">Escolha...</option>
                  {entities.map(en => <option key={en.id} value={en.id}>{en.name} ({en.type})</option>)}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-content-muted">Observação (opcional)</label>
                <input
                  type="text" value={description} onChange={e => setDescription(e.target.value)}
                  placeholder="Ex: passagem + hospedagem para 2 pessoas"
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-content-muted">Cor</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {BANK_PRESETS.slice(0, 12).map(p => (
                    <button
                      key={p.id} type="button" title={p.name}
                      onClick={() => setColor(p.color)} style={{ backgroundColor: p.color }}
                      className={cn('h-7 w-7 rounded-full border transition-all',
                        normalizeHex(color) === p.color ? 'ring-2 ring-primary ring-offset-2 scale-110' : 'border-line hover:scale-110')}
                    />
                  ))}
                  <input
                    type="color" value={normalizeHex(color) || '#2563eb'}
                    onChange={e => setColor(e.target.value)}
                    className="h-7 w-10 cursor-pointer rounded-lg border border-line bg-transparent p-0.5"
                  />
                </div>
              </div>

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => { setIsModalOpen(false); resetForm(); }}
                  className="flex-1 rounded-2xl border border-line py-3 text-sm font-bold text-content-muted hover:bg-surface-muted">
                  Cancelar
                </button>
                <button type="submit" className="flex-1 rounded-2xl bg-primary py-3 text-sm font-bold text-white hover:bg-primary/90">
                  {editing ? 'Salvar' : 'Criar caixinha'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
