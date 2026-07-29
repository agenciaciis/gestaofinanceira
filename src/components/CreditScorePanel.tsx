/**
 * Painel do score de crédito (Serasa/SPC/Boa Vista).
 *
 * Fica ao lado do score de saúde financeira, mas NÃO se mistura com ele: um
 * mede o seu comportamento, o outro mede como o mercado te enxerga. Juntar os
 * dois num número só esconderia os dois.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { onSnapshot, doc, serverTimestamp, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CreditScoreEntry, Entity } from '../types';
import { Gauge, Plus, Trash2, TrendingUp, TrendingDown, Minus, AlertCircle } from 'lucide-react';
import { motion } from 'motion/react';
import { LineChart, Line, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { format } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { scoreBand, scoreTrend, daysSinceUpdate, isStale, SCORE_MAX } from '../lib/creditScore';
import { formatLocalDate, parseLocalDate } from '../lib/finance';
import { cn } from '../lib/utils';

const PROVIDERS: { id: CreditScoreEntry['provider']; label: string }[] = [
  { id: 'serasa', label: 'Serasa' },
  { id: 'spc', label: 'SPC' },
  { id: 'boavista', label: 'Boa Vista' },
];

export const CreditScorePanel: React.FC<{ entity: Entity }> = ({ entity }) => {
  const [entries, setEntries] = useState<CreditScoreEntry[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [provider, setProvider] = useState<CreditScoreEntry['provider']>('serasa');
  const [score, setScore] = useState('');
  const [date, setDate] = useState(formatLocalDate(new Date()));
  const [notes, setNotes] = useState('');
  const [blocked, setBlocked] = useState(false);

  // Histórico num documento de `config` (já liberado), não em subcoleção nova:
  // são poucas dezenas de registros e evita depender de publicar regra.
  const docPath = `entities/${entity.id}/config/credit_scores`;

  useEffect(() => {
    return onSnapshot(doc(db, docPath), snap => {
      const raw = snap.data()?.items;
      const list = Array.isArray(raw) ? raw : [];
      setEntries(
        list
          .filter((e: any) => e && Number.isFinite(Number(e.score)) && typeof e.date === 'string')
          .map((e: any) => ({
            id: String(e.id || e.date),
            provider: ['serasa', 'spc', 'boavista'].includes(e.provider) ? e.provider : 'serasa',
            score: Number(e.score),
            date: e.date,
            notes: typeof e.notes === 'string' ? e.notes : undefined,
            entityId: entity.id,
            createdAt: e.createdAt ?? null,
          })) as CreditScoreEntry[]
      );
    }, e => {
      if ((e as { code?: string })?.code === 'permission-denied') setBlocked(true);
      handleFirestoreError(e, OperationType.GET, docPath);
    });
  }, [entity.id, docPath]);

  const trend = useMemo(() => scoreTrend(entries.map(e => ({ score: e.score, date: e.date }))), [entries]);
  const latest = entries.length > 0
    ? [...entries].sort((a, b) => parseLocalDate(b.date).getTime() - parseLocalDate(a.date).getTime())[0]
    : null;
  const band = latest ? scoreBand(latest.score) : null;
  const days = daysSinceUpdate(latest?.date);
  const stale = isStale(latest?.date);

  const chartData = useMemo(
    () => [...entries]
      .sort((a, b) => parseLocalDate(a.date).getTime() - parseLocalDate(b.date).getTime())
      .map(e => ({ data: format(parseLocalDate(e.date), 'dd/MM/yy'), score: e.score })),
    [entries]
  );

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault();
    const value = Number(score);
    if (!Number.isFinite(value) || value < 0 || value > SCORE_MAX) return;
    try {
      const novo = {
        id: crypto.randomUUID(), provider, score: value, date,
        notes: notes.trim() || null, createdAt: new Date().toISOString(),
      };
      await setDoc(doc(db, docPath), {
        items: [...entries.map(e => ({
          id: e.id, provider: e.provider, score: e.score, date: e.date,
          notes: e.notes ?? null, createdAt: e.createdAt ?? null,
        })), novo],
        updatedAt: serverTimestamp(),
      }, { merge: true });
      setIsOpen(false); setScore(''); setNotes(''); setDate(formatLocalDate(new Date()));
    } catch (error) {
      console.error('Erro ao salvar score:', error);
    }
  };

  return (
    <div className="rounded-3xl bg-surface p-8 shadow-sm border border-line">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-content flex items-center gap-2">
            <Gauge className="h-5 w-5 text-indigo-500" />
            Score de crédito ({entity.name})
          </h3>
          <p className="text-sm text-content-subtle mt-1">
            Você consulta no site e anota aqui. É como o mercado te vê — diferente do score acima,
            que mede o seu comportamento.
          </p>
        </div>
        <button
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" /> Anotar score
        </button>
      </div>

      {blocked ? (
        <div className="mt-6 rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/40 p-6">
          <p className="font-bold text-amber-900 dark:text-amber-200">Score bloqueado pelo banco de dados</p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            A regra de acesso desta coleção ainda não foi publicada no Firebase. Publique o arquivo
            <code className="mx-1 rounded bg-amber-900/20 px-1">firestore.rules</code>
            (Console do Firebase → Firestore → Regras → Publicar) e isso volta a funcionar.
          </p>
        </div>
      ) : !latest ? (
        <div className="mt-6 rounded-2xl border border-dashed border-line p-8 text-center">
          <p className="font-bold text-content">Nenhum score anotado ainda</p>
          <p className="mt-1 text-sm text-content-subtle">
            Consulte no Serasa e registre aqui. Com dois ou mais registros eu mostro a evolução.
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 grid gap-6 lg:grid-cols-3">
            <div>
              <div className="flex items-end gap-3">
                <span className="text-6xl font-black tracking-tighter" style={{ color: band!.color }}>
                  {latest.score}
                </span>
                <div className="pb-2">
                  <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">
                    de {SCORE_MAX}
                  </p>
                  <p className="text-lg font-black" style={{ color: band!.color }}>{band!.label}</p>
                </div>
              </div>

              <div className="mt-4 h-2.5 w-full overflow-hidden rounded-full bg-surface-muted">
                <motion.div
                  initial={{ width: 0 }}
                  animate={{ width: `${(latest.score / SCORE_MAX) * 100}%` }}
                  className="h-full rounded-full"
                  style={{ backgroundColor: band!.color }}
                />
              </div>

              <div className="mt-4 flex flex-wrap items-center gap-3 text-sm">
                {trend.previous !== null && (
                  <span className={cn('flex items-center gap-1 font-bold',
                    trend.direction === 'up' ? 'text-emerald-600' :
                    trend.direction === 'down' ? 'text-rose-600' : 'text-content-subtle')}>
                    {trend.direction === 'up' ? <TrendingUp className="h-4 w-4" /> :
                     trend.direction === 'down' ? <TrendingDown className="h-4 w-4" /> :
                     <Minus className="h-4 w-4" />}
                    {trend.delta > 0 ? '+' : ''}{trend.delta} pontos
                  </span>
                )}
                <span className="text-content-subtle">
                  {days === 0 ? 'Atualizado hoje' : `Atualizado há ${days} ${days === 1 ? 'dia' : 'dias'}`}
                </span>
              </div>

              {stale && (
                <p className="mt-3 flex items-start gap-1.5 rounded-xl bg-amber-50 dark:bg-amber-950/40 p-3 text-xs font-medium text-amber-700 dark:text-amber-300">
                  <AlertCircle className="h-4 w-4 shrink-0" />
                  Esse número já tem mais de 45 dias. Consulte de novo para saber onde você está hoje.
                </p>
              )}

              <p className="mt-3 text-xs text-content-muted">{band!.hint}</p>
            </div>

            <div className="lg:col-span-2">
              {chartData.length >= 2 ? (
                <div className="h-[220px] w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData} margin={{ top: 10, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="var(--color-line)" />
                      <XAxis dataKey="data" axisLine={false} tickLine={false}
                        tick={{ fill: 'var(--color-content-subtle)', fontSize: 11, fontWeight: 600 }} />
                      <YAxis domain={[0, SCORE_MAX]} axisLine={false} tickLine={false}
                        tick={{ fill: 'var(--color-content-subtle)', fontSize: 11, fontWeight: 600 }} />
                      <Tooltip
                        contentStyle={{ borderRadius: 12, border: 'none', boxShadow: '0 10px 20px rgb(0 0 0 / .12)' }}
                        formatter={(v: number) => [`${v} pontos`, 'Score']}
                      />
                      <Line type="monotone" dataKey="score" stroke="#6366f1" strokeWidth={3}
                        dot={{ r: 4 }} animationDuration={800} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              ) : (
                <div className="flex h-full min-h-[160px] items-center justify-center rounded-2xl border border-dashed border-line p-6 text-center text-sm text-content-subtle">
                  Anote mais um score para eu desenhar a evolução.
                </div>
              )}
            </div>
          </div>

          <div className="mt-6 border-t border-line pt-4">
            <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle mb-2">Histórico</p>
            <div className="space-y-1 max-h-48 overflow-y-auto">
              {entries.map(e => (
                <div key={e.id} className="group flex items-center justify-between rounded-lg px-2 py-1.5 hover:bg-surface-muted">
                  <span className="text-sm text-content-muted">
                    {format(parseLocalDate(e.date), "dd 'de' MMM, yyyy", { locale: ptBR })}
                    <span className="ml-2 text-[10px] font-black uppercase text-content-subtle">
                      {PROVIDERS.find(p => p.id === e.provider)?.label}
                    </span>
                    {e.notes && <span className="ml-2 text-xs text-content-subtle">— {e.notes}</span>}
                  </span>
                  <span className="flex items-center gap-3">
                    <strong className="text-sm font-black" style={{ color: scoreBand(e.score).color }}>{e.score}</strong>
                    <button
                      onClick={() => setDoc(doc(db, docPath), {
                        items: entries.filter(x => x.id !== e.id).map(x => ({
                          id: x.id, provider: x.provider, score: x.score, date: x.date,
                          notes: x.notes ?? null, createdAt: x.createdAt ?? null,
                        })),
                        updatedAt: serverTimestamp(),
                      }, { merge: true })}
                      className="opacity-0 group-hover:opacity-100 text-content-subtle hover:text-rose-600"
                    >
                      <Trash2 className="h-3.5 w-3.5" />
                    </button>
                  </span>
                </div>
              ))}
            </div>
          </div>
        </>
      )}

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div initial={{ opacity: 0, scale: 0.95 }} animate={{ opacity: 1, scale: 1 }}
            className="w-full max-w-md rounded-3xl bg-surface p-8 shadow-2xl">
            <h3 className="text-xl font-black text-content">Anotar score</h3>
            <p className="text-sm text-content-subtle">Consultou no site? Registre aqui para acompanhar a evolução.</p>
            <form onSubmit={handleSave} className="mt-6 space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Onde consultou</label>
                  <select value={provider} onChange={e => setProvider(e.target.value as CreditScoreEntry['provider'])}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20">
                    {PROVIDERS.map(p => <option key={p.id} value={p.id}>{p.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Data da consulta</label>
                  <input type="date" required value={date} onChange={e => setDate(e.target.value)}
                    max={formatLocalDate(new Date())}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-content-muted">Score (0 a {SCORE_MAX})</label>
                <input type="number" required min="0" max={SCORE_MAX} value={score}
                  onChange={e => setScore(e.target.value)} placeholder="Ex: 720"
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div>
                <label className="block text-sm font-medium text-content-muted">Observação (opcional)</label>
                <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
                  placeholder="Ex: depois de quitar o cartão"
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setIsOpen(false)}
                  className="flex-1 rounded-2xl border border-line py-3 text-sm font-bold text-content-muted hover:bg-surface-muted">
                  Cancelar
                </button>
                <button type="submit" className="flex-1 rounded-2xl bg-primary py-3 text-sm font-bold text-white hover:bg-primary/90">
                  Salvar
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
