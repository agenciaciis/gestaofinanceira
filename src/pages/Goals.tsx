/**
 * Caixinhas — juntar dinheiro para objetivos (praia, carro, reserva).
 *
 * O quanto já foi guardado NÃO é digitado: vem dos lançamentos marcados com a
 * caixinha (ver src/lib/goals.ts). Assim o valor nunca desencontra do extrato.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, doc, writeBatch, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Goal, Transaction, BankAccount } from '../types';
import { PiggyBank, Plus, Trash2, Edit2, Target, CheckCircle2, AlertCircle, TrendingUp, X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { computeGoalProgress, monthlyNeeded, goalForecast, goalStatus, timeProgress, paceVerdict } from '../lib/goals';
import { goalsDocPath, readGoals, upsertGoal, removeGoal } from '../lib/goalStore';
import { BANK_PRESETS, normalizeHex, readableForeground } from '../lib/brandColors';
import { ColorField } from '../components/ColorField';
import { formatLocalDate } from '../lib/finance';
import { ViewToggle, useViewMode, DataTable, Column } from '../components/ViewToggle';

/**
 * Objetivos comuns, para não começar de uma tela em branco.
 * O valor é só um ponto de partida sugerido — cada um ajusta ao seu caso.
 */
const OBJETIVOS_PRONTOS: { nome: string; valor: number; cor: string; dica: string }[] = [
  { nome: 'Férias', valor: 6000, cor: '#00aeef', dica: 'passagem, hospedagem, alimentação e um extra para imprevisto' },
  { nome: 'Casa própria (entrada)', valor: 60000, cor: '#3fa110', dica: 'entrada costuma ser 20% do valor do imóvel' },
  { nome: 'Reforma', valor: 25000, cor: '#ff7a00', dica: 'peça orçamento e acrescente 20% de folga — reforma sempre passa' },
  { nome: 'Carro', valor: 40000, cor: '#e11d48', dica: 'lembre de documentação, seguro e emplacamento' },
  { nome: 'Reserva de emergência', valor: 0, cor: '#10b981', dica: 'de 3 a 6 meses da sua despesa mensal' },
  { nome: 'Casamento', valor: 30000, cor: '#820ad1', dica: '' },
  { nome: 'Faculdade / curso', valor: 15000, cor: '#6366f1', dica: '' },
  { nome: 'Troca de equipamento', valor: 8000, cor: '#242424', dica: 'notebook, celular, câmera' },
];

const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);

export const Goals: React.FC = () => {
  const { entities, selectedEntity, filterType } = useEntity();
  const { showToast, confirm } = useUI();

  const [goals, setGoals] = useState<Goal[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [viewMode, setViewMode] = useViewMode('caixinhas', 'grid');
  // Movimentação: guardar na caixinha ou resgatar dela
  const [moving, setMoving] = useState<{ goal: Goal; mode: 'guardar' | 'resgatar' } | null>(null);
  const [moveAmount, setMoveAmount] = useState('');
  const [moveDate, setMoveDate] = useState(formatLocalDate(new Date()));
  const [fromAccount, setFromAccount] = useState('');
  const [toAccount, setToAccount] = useState('');
  const [savingMove, setSavingMove] = useState(false);
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
    let allAcc: BankAccount[] = [];

    visibleEntities.forEach(entity => {
      unsubs.push(onSnapshot(doc(db, goalsDocPath(entity.id)), snap => {
        const list = readGoals(snap.data(), entity.id);
        allGoals = [...allGoals.filter(g => g.entityId !== entity.id), ...list];
        setGoals([...allGoals]);
        setLoading(false);
      }, e => {
        // Erro TAMBÉM encerra o carregamento: sem isto a página ficava presa no
        // círculo girando, uma falha silenciosa.
        setLoading(false);
        setLoadError((e as { code?: string })?.code === 'permission-denied' ? 'permission-denied' : 'unknown');
        handleFirestoreError(e, OperationType.GET, goalsDocPath(entity.id));
      }));

      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/transactions`)), snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[];
        allTx = [...allTx.filter(t => t.entityId !== entity.id), ...list];
        setTransactions([...allTx]);
      }, e => handleFirestoreError(e, OperationType.LIST, `entities/${entity.id}/transactions`)));

      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/bank_accounts`)), snap => {
        const list = snap.docs.map(d => ({ id: d.id, ...d.data() })) as BankAccount[];
        allAcc = [...allAcc.filter(a => a.entityId !== entity.id), ...list];
        setAccounts([...allAcc]);
      }, e => handleFirestoreError(e, OperationType.LIST, `entities/${entity.id}/bank_accounts`)));

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
      const daEntidade = goals.filter(g => g.entityId === entityId);
      const registro: Goal = {
        id: editing?.id || crypto.randomUUID(),
        name: data.name,
        targetAmount: data.targetAmount,
        deadline: data.deadline || undefined,
        description: data.description || undefined,
        color: data.color || undefined,
        entityId,
        createdAt: editing?.createdAt ?? new Date().toISOString(),
      };
      await setDoc(
        doc(db, goalsDocPath(entityId)),
        { items: upsertGoal(daEntidade, registro), updatedAt: serverTimestamp() },
        { merge: true }
      );
      // Se a caixinha MUDOU de entidade na edição, remove da entidade antiga —
      // senão ela passava a existir nas duas ao mesmo tempo (totais em dobro).
      if (editing && editing.entityId && editing.entityId !== entityId) {
        const restanteNaAntiga = goals.filter(g => g.entityId === editing.entityId && g.id !== registro.id);
        await setDoc(
          doc(db, goalsDocPath(editing.entityId)),
          { items: restanteNaAntiga, updatedAt: serverTimestamp() },
          { merge: true }
        );
      }
      showToast(editing ? 'Caixinha atualizada!' : 'Caixinha criada! Agora registre seus depósitos nela.', 'success');
      setIsModalOpen(false); resetForm();
    } catch (error) {
      console.error('Erro ao salvar caixinha:', error);
      showToast('Erro ao salvar a caixinha.', 'error');
    }
  };

  const openMove = (goal: Goal, mode: 'guardar' | 'resgatar') => {
    setMoving({ goal, mode });
    setMoveAmount(''); setMoveDate(formatLocalDate(new Date()));
    setFromAccount(''); setToAccount('');
  };

  /**
   * Registra a movimentação como TRANSFERÊNCIA entre contas, marcada com a
   * caixinha. Assim o saldo de cada conta continua certo (computeBalances tira
   * da origem e põe no destino) e o progresso da caixinha anda junto — um
   * lançamento só, sem dinheiro inventado nem sumido.
   */
  const handleMove = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!moving || savingMove) return;
    const value = Number(moveAmount);
    if (!Number.isFinite(value) || value <= 0) { showToast('Informe um valor maior que zero.', 'error'); return; }
    // Só uma das contas escolhida não faz sentido: ou as duas, ou nenhuma.
    if ((fromAccount && !toAccount) || (!fromAccount && toAccount)) {
      showToast('Para mexer no saldo, escolha as DUAS contas. Ou deixe as duas em branco para só registrar.', 'error');
      return;
    }
    if (fromAccount && fromAccount === toAccount) {
      showToast('Origem e destino precisam ser contas diferentes.', 'error'); return;
    }

    const origem = accounts.find(a => a.id === fromAccount);
    const destino = accounts.find(a => a.id === toAccount);
    const guardando = moving.mode === 'guardar';
    setSavingMove(true);
    try {
      if (!origem || !destino) {
        // Caminho simples: você depositou no banco por fora e só está
        // apontando aqui. Sem conta, o lançamento NÃO mexe em saldo nenhum —
        // serve só para o progresso da caixinha.
        const entity = entities.find(en => en.id === moving.goal.entityId);
        await addDoc(collection(db, `entities/${moving.goal.entityId}/transactions`), {
          description: `${guardando ? 'Depósito em' : 'Resgate de'} ${moving.goal.name}`,
          amount: value,
          type: 'transfer',
          date: moveDate,
          categoryId: 'transferencia',
          status: 'completed',
          entityId: moving.goal.entityId,
          goalId: moving.goal.id,
          goalDirection: guardando ? 'in' : 'out',
          ownerUid: entity?.ownerUid,
          collaboratorsEmails: entity?.collaboratorsEmails || [],
          createdAt: serverTimestamp(),
        });
      } else if (origem.entityId === destino.entityId) {
        // Mesma entidade: uma transferência resolve.
        const entity = entities.find(en => en.id === origem.entityId);
        await addDoc(collection(db, `entities/${origem.entityId}/transactions`), {
          description: `${guardando ? 'Guardar em' : 'Resgate de'} ${moving.goal.name}`,
          amount: value,
          type: 'transfer',
          date: moveDate,
          categoryId: 'transferencia',
          accountId: fromAccount,
          toAccountId: toAccount,
          status: 'completed',
          entityId: origem.entityId,
          goalId: moving.goal.id,
          goalDirection: guardando ? 'in' : 'out',
          ownerUid: entity?.ownerUid,
          collaboratorsEmails: entity?.collaboratorsEmails || [],
          createdAt: serverTimestamp(),
        });
      } else {
        // Entidades diferentes (Lucas -> Paula, Paula -> PJ): duas pontas
        // vinculadas, ou o dinheiro apareceria de graça num lado.
        const groupId = crypto.randomUUID();
        const eOrigem = entities.find(en => en.id === origem.entityId);
        const eDestino = entities.find(en => en.id === destino.entityId);
        const batch = writeBatch(db);
        const base = {
          amount: value, date: moveDate, status: 'completed' as const,
          categoryId: 'transferencia', crossEntityGroupId: groupId,
          crossEntityKind: 'transferencia' as const, createdAt: serverTimestamp(),
        };
        batch.set(doc(collection(db, `entities/${origem.entityId}/transactions`)), {
          ...base,
          description: `Transferência para ${eDestino?.name} — ${moving.goal.name}`,
          type: 'expense', entityId: origem.entityId, accountId: fromAccount,
          counterpartEntityId: destino.entityId,
          ownerUid: eOrigem?.ownerUid, collaboratorsEmails: eOrigem?.collaboratorsEmails || [],
        });
        batch.set(doc(collection(db, `entities/${destino.entityId}/transactions`)), {
          ...base,
          description: `Recebido de ${eOrigem?.name} — ${moving.goal.name}`,
          type: 'income', entityId: destino.entityId, accountId: toAccount,
          counterpartEntityId: origem.entityId,
          // Só UMA das pontas leva a caixinha, senão o valor contaria em dobro.
          goalId: moving.goal.id,
          goalDirection: guardando ? 'in' : 'out',
          ownerUid: eDestino?.ownerUid, collaboratorsEmails: eDestino?.collaboratorsEmails || [],
        });
        await batch.commit();
      }
      showToast(guardando ? 'Guardado na caixinha!' : 'Resgate registrado.', 'success');
      setMoving(null);
    } catch (error) {
      console.error('Erro na movimentação da caixinha:', error);
      showToast('Erro ao registrar a movimentação.', 'error');
    } finally {
      setSavingMove(false);
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
      const daEntidade = goals.filter(x => x.entityId === g.entityId);
      await setDoc(
        doc(db, goalsDocPath(g.entityId)),
        { items: removeGoal(daEntidade, g.id), updatedAt: serverTimestamp() },
        { merge: true }
      );
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

  const colunasCaixinhas: Column<Goal>[] = [
    {
      chave: 'nome', titulo: 'Objetivo',
      render: (g) => (
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: normalizeHex(g.color) || '#2563eb' }} />
          <span className="font-bold text-content">{g.name}</span>
          <span className="rounded bg-surface-muted px-1.5 text-[10px] font-black text-content-subtle">
            {entities.find(e => e.id === g.entityId)?.type}
          </span>
        </span>
      ),
    },
    { chave: 'meta', titulo: 'Meta', numerico: true, render: (g) => fmt(g.targetAmount) },
    {
      chave: 'guardado', titulo: 'Guardado', numerico: true,
      render: (g) => {
        const p = computeGoalProgress(g, transactions);
        return <span className="font-black text-emerald-600">{fmt(p.saved)}</span>;
      },
    },
    {
      chave: 'progresso', titulo: 'Dinheiro', numerico: true,
      render: (g) => `${computeGoalProgress(g, transactions).percent.toFixed(0)}%`,
    },
    {
      chave: 'tempo', titulo: 'Prazo', numerico: true, escondeNoMobile: true,
      render: (g) => {
        const t = timeProgress(g);
        return t ? `${t.percent.toFixed(0)}% · ${t.remainingDays}d` : 'sem prazo';
      },
    },
    {
      chave: 'ritmo', titulo: 'Ritmo',
      render: (g) => {
        const p = computeGoalProgress(g, transactions);
        const r = paceVerdict(g, p.saved);
        if (!r) return <span className="text-content-subtle">—</span>;
        const rotulo = { concluido: 'Conquistada', adiantado: 'Adiantado', 'em-dia': 'No ritmo', atrasado: 'Atrasado' }[r];
        return (
          <span className={cn('text-xs font-bold',
            r === 'concluido' || r === 'adiantado' ? 'text-emerald-600'
              : r === 'atrasado' ? 'text-rose-600' : 'text-content-muted')}>
            {rotulo}
          </span>
        );
      },
    },
  ];

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  if (loadError) {
    return (
      <div className="mx-auto max-w-lg rounded-3xl border border-rose-200 dark:border-rose-900/40 bg-rose-50 dark:bg-rose-950/40 p-8">
        <h2 className="text-lg font-black text-rose-900 dark:text-rose-200">Não consegui carregar as caixinhas</h2>
        <p className="mt-2 text-sm text-rose-800 dark:text-rose-300">
          {loadError === 'permission-denied'
            ? 'Seu usuário não tem permissão de acesso a esta entidade. Confira em Equipe se o e-mail está como colaborador com permissão de escrita.'
            : 'Houve uma falha de conexão com o banco. Recarregue a página; se persistir, veja o console do navegador.'}
        </p>
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
        <div className="flex items-center gap-3">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <button
            onClick={() => { resetForm(); setIsModalOpen(true); }}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
          >
            <Plus className="h-4 w-4" /> Nova Caixinha
          </button>
        </div>
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
        viewMode === 'list' ? (
          <DataTable
            itens={goals}
            colunas={colunasCaixinhas}
            acoes={(g) => (
              <>
                <button onClick={() => openMove(g, 'guardar')} title="Guardar"
                  className="rounded-lg bg-primary px-2.5 py-1.5 text-[11px] font-bold text-white hover:bg-primary/90">
                  Guardar
                </button>
                <button onClick={() => openEdit(g)} title="Editar"
                  className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                  <Edit2 className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(g)} title="Excluir"
                  className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
          />
        ) : (
        <div className="grid gap-6 md:grid-cols-2 lg:grid-cols-3">
          {goals.map(goal => {
            const p = computeGoalProgress(goal, transactions);
            const status = goalStatus(goal, p.saved);
            const perMonth = monthlyNeeded(p.remaining, goal.deadline);
            const forecast = goalForecast(goal, transactions);
            const accent = normalizeHex(goal.color) || '#2563eb';
            const tempo = timeProgress(goal);
            const ritmo = paceVerdict(goal, p.saved);
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
                  <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
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
                    <span style={{ color: accent }}>{p.percent.toFixed(0)}% do dinheiro</span>
                    <span className="text-content-subtle">
                      {p.complete ? 'Meta batida!' : `Faltam ${fmt(p.remaining)}`}
                    </span>
                  </div>

                  {/* Progresso do TEMPO. Sozinho, o do dinheiro não diz nada:
                      40% guardado é ótimo com 20% do prazo e ruim com 80%. */}
                  {tempo && (
                    <div className="mt-3">
                      <div className="h-1.5 w-full overflow-hidden rounded-full bg-surface-muted">
                        <div className="h-full rounded-full bg-content-subtle/60" style={{ width: `${tempo.percent}%` }} />
                      </div>
                      <div className="mt-1 flex justify-between text-[11px] font-bold text-content-subtle">
                        <span>{tempo.percent.toFixed(0)}% do prazo</span>
                        <span>
                          {tempo.remainingDays === 0
                            ? 'Prazo encerrado'
                            : `Faltam ${tempo.remainingDays} de ${tempo.totalDays} dias`}
                        </span>
                      </div>
                    </div>
                  )}

                  {ritmo && ritmo !== 'concluido' && (
                    <p className={cn('mt-2 text-xs font-bold',
                      ritmo === 'adiantado' ? 'text-emerald-600'
                        : ritmo === 'atrasado' ? 'text-rose-600' : 'text-content-muted')}>
                      {ritmo === 'adiantado' ? 'Você está adiantado no ritmo'
                        : ritmo === 'atrasado' ? 'Você está atrasado para o prazo'
                        : 'No ritmo certo'}
                    </p>
                  )}
                </div>

                <div className="mt-5 flex gap-2">
                  <button
                    onClick={() => openMove(goal, 'guardar')}
                    className="flex-1 rounded-xl bg-primary py-2 text-xs font-bold text-white hover:bg-primary/90 transition-all"
                  >
                    Guardar
                  </button>
                  <button
                    onClick={() => openMove(goal, 'resgatar')}
                    disabled={p.saved <= 0}
                    className="flex-1 rounded-xl border border-line py-2 text-xs font-bold text-content-muted hover:bg-surface-muted disabled:opacity-40 disabled:cursor-not-allowed transition-all"
                    title={p.saved <= 0 ? 'Nada guardado para resgatar' : 'Tirar dinheiro da caixinha'}
                  >
                    Resgatar
                  </button>
                </div>

                <div className="mt-4 space-y-1.5 border-t border-line pt-4 text-xs">
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
        )
      )}

      {moving && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4" onClick={() => setMoving(null)}>
          <motion.div initial={{ opacity: 0, scale: 0.95, y: 20 }} animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-3xl bg-surface p-8 shadow-2xl max-h-[92vh] overflow-y-auto">
            <button type="button" aria-label="Fechar" onClick={() => setMoving(null)}
              className="absolute right-4 top-4 z-10 rounded-xl p-2 text-content-subtle hover:bg-surface-muted hover:text-content">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-xl font-black text-content pr-10">
              {moving.mode === 'guardar' ? 'Guardar em' : 'Resgatar de'} {moving.goal.name}
            </h3>
            <p className="text-sm text-content-subtle">
              Depositou no banco? Informe o valor aqui e o progresso anda. Se quiser que o saldo das
              suas contas também mexa, escolha as contas abaixo.
            </p>

            <form onSubmit={handleMove} className="mt-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Valor</label>
                  <input type="number" step="0.01" min="0.01" required autoFocus
                    value={moveAmount} onChange={e => setMoveAmount(e.target.value)} placeholder="0,00"
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Data</label>
                  <input type="date" required value={moveDate} onChange={e => setMoveDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-content-muted">Sai de qual conta <span className="font-normal text-content-subtle">(opcional)</span></label>
                <select value={fromAccount} onChange={e => setFromAccount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Não mexer em saldo — só registrar</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.bankName} — {entities.find(en => en.id === a.entityId)?.name} ({entities.find(en => en.id === a.entityId)?.type})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium text-content-muted">Entra em qual conta <span className="font-normal text-content-subtle">(opcional)</span></label>
                <select value={toAccount} onChange={e => setToAccount(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Não mexer em saldo — só registrar</option>
                  {accounts.map(a => (
                    <option key={a.id} value={a.id}>
                      {a.bankName} — {entities.find(en => en.id === a.entityId)?.name} ({entities.find(en => en.id === a.entityId)?.type})
                    </option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-content-subtle">
                  Deixando as duas em branco, só o progresso da caixinha anda — nenhum saldo é
                  alterado. Preenchendo as duas, viram transferência de verdade, e pode ser entre
                  bancos seus ou entre pessoas e empresa.
                </p>
              </div>

              {fromAccount && toAccount && (() => {
                const o = accounts.find(a => a.id === fromAccount);
                const d = accounts.find(a => a.id === toAccount);
                if (!o || !d || o.entityId === d.entityId) return null;
                return (
                  <p className="rounded-xl bg-surface-muted p-3 text-xs text-content-muted">
                    Transferência entre entidades diferentes:{' '}
                    <strong>{entities.find(en => en.id === o.entityId)?.name}</strong> →{' '}
                    <strong>{entities.find(en => en.id === d.entityId)?.name}</strong>. No consolidado
                    do grupo isso não conta como receita nova — é o mesmo dinheiro mudando de bolso.
                  </p>
                );
              })()}

              {/* Depois deste depósito, quanto ainda falta e em que ritmo */}
              {Number(moveAmount) > 0 && (() => {
                const atual = computeGoalProgress(moving.goal, transactions);
                const delta = moving.mode === 'guardar' ? Number(moveAmount) : -Number(moveAmount);
                const novoGuardado = atual.saved + delta;
                const faltando = Math.max(0, (Number(moving.goal.targetAmount) || 0) - novoGuardado);
                const porMes = monthlyNeeded(faltando, moving.goal.deadline);
                return (
                  <div className="rounded-2xl bg-surface-muted p-4 text-sm">
                    <p className="text-content-muted">
                      Depois disso você terá <strong className="text-content">{fmt(novoGuardado)}</strong> guardado
                      {faltando > 0
                        ? <> e faltarão <strong className="text-content">{fmt(faltando)}</strong>.</>
                        : <> — <strong className="text-emerald-600">objetivo alcançado!</strong></>}
                    </p>
                    {faltando > 0 && porMes !== null && (
                      <p className="mt-1 text-content-muted">
                        Para chegar no prazo, precisa guardar <strong className="text-primary">{fmt(porMes)}</strong> por mês.
                      </p>
                    )}
                    {faltando > 0 && porMes === null && (
                      <p className="mt-1 text-content-subtle text-xs">
                        Sem prazo definido nesta caixinha — edite e coloque uma data para eu calcular o ritmo.
                      </p>
                    )}
                  </div>
                );
              })()}

              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setMoving(null)}
                  className="flex-1 rounded-2xl border border-line py-3 text-sm font-bold text-content-muted hover:bg-surface-muted">
                  Cancelar
                </button>
                <button type="submit" disabled={savingMove}
                  className="flex-1 rounded-2xl bg-primary py-3 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50">
                  {savingMove ? 'Registrando...' : moving.mode === 'guardar' ? 'Guardar' : 'Resgatar'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4" onClick={() => { setIsModalOpen(false); resetForm(); }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.95, y: 20 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-3xl bg-surface p-8 shadow-2xl max-h-[92vh] overflow-y-auto"
          >
            <button type="button" aria-label="Fechar" onClick={() => { setIsModalOpen(false); resetForm(); }}
              className="absolute right-4 top-4 z-10 rounded-xl p-2 text-content-subtle hover:bg-surface-muted hover:text-content">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-xl font-black text-content pr-10">{editing ? 'Editar caixinha' : 'Nova caixinha'}</h3>
            <p className="text-sm text-content-subtle">Um objetivo por caixinha. O progresso vem dos lançamentos.</p>

            {!editing && (
              <div className="mt-5">
                <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">
                  Comece por um destes
                </p>
                <div className="mt-2 flex flex-wrap gap-2">
                  {OBJETIVOS_PRONTOS.map(o => (
                    <button
                      key={o.nome}
                      type="button"
                      onClick={() => {
                        setName(o.nome);
                        if (o.valor > 0) setTargetAmount(String(o.valor));
                        setColor(o.cor);
                        if (o.dica) setDescription(o.dica);
                      }}
                      className="rounded-full border border-line px-3 py-1.5 text-xs font-bold text-content-muted hover:border-primary hover:text-primary transition-all"
                    >
                      <span className="mr-1.5 inline-block h-2 w-2 rounded-full align-middle" style={{ backgroundColor: o.cor }} />
                      {o.nome}
                    </button>
                  ))}
                </div>
              </div>
            )}

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
                  <label className="block text-sm font-medium text-content-muted">Em quanto tempo?</label>
                  <div className="mt-1 flex gap-1">
                    {[6, 12, 24, 36].map(meses => (
                      <button
                        key={meses}
                        type="button"
                        onClick={() => {
                          const d = new Date();
                          // Último dia do mês alvo, para não cair no dia 31 de mês curto.
                          setDeadline(formatLocalDate(new Date(d.getFullYear(), d.getMonth() + meses + 1, 0)));
                        }}
                        className="flex-1 rounded-lg border border-line py-2 text-xs font-bold text-content-muted hover:border-primary hover:text-primary transition-all"
                      >
                        {meses}m
                      </button>
                    ))}
                  </div>
                  <input
                    type="date" value={deadline} onChange={e => setDeadline(e.target.value)}
                    min={formatLocalDate(new Date())}
                    className="mt-2 w-full rounded-lg border border-line px-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
              </div>

              {/* Planejamento ao vivo: responde antes de salvar */}
              {Number(targetAmount) > 0 && (
                <div className="rounded-2xl bg-surface-muted p-4">
                  <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Planejamento</p>
                  {deadline ? (
                    (() => {
                      const porMes = monthlyNeeded(Number(targetAmount), deadline);
                      const meses = porMes && porMes > 0 ? Math.ceil(Number(targetAmount) / porMes) : 0;
                      return (
                        <>
                          <p className="mt-1 text-sm text-content-muted">
                            Para juntar <strong className="text-content">{fmt(Number(targetAmount))}</strong> até{' '}
                            {format(new Date(deadline + 'T00:00:00'), "MMMM 'de' yyyy", { locale: ptBR })}, você precisa guardar
                          </p>
                          <p className="text-2xl font-black text-primary">{fmt(porMes || 0)}<span className="text-sm font-bold text-content-subtle"> por mês</span></p>
                          <p className="mt-1 text-xs text-content-subtle">São {meses} {meses === 1 ? 'depósito' : 'depósitos'} mensais.</p>
                        </>
                      );
                    })()
                  ) : (
                    <p className="mt-1 text-sm text-content-subtle">
                      Coloque uma data em "até quando" e eu calculo aqui quanto você precisa guardar por mês.
                    </p>
                  )}
                </div>
              )}

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
                <label className="block text-sm font-medium text-content-muted mb-2">Cor</label>
                <ColorField value={color} onChange={setColor} />
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
