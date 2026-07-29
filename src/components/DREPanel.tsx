/**
 * DRE gerencial: margem de contribuição e ponto de equilíbrio.
 *
 * A classificação de cada categoria (variável / fixa / investimento) fica em
 * `entities/{id}/config/category_kinds`, documento em `config` — coleção que já
 * tem regra publicada, então não depende de nenhum passo manual no Firebase.
 */
import React, { useState, useEffect, useMemo } from 'react';
import { onSnapshot, doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Entity, Transaction } from '../types';
import { CATEGORIES } from '../constants';
import { computeDRE, breakEven, CategoryKind, CategoryKindMap } from '../lib/dre';
import { Scale, AlertTriangle, Target } from 'lucide-react';
import { cn } from '../lib/utils';

const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);

const KIND_LABELS: Record<CategoryKind, string> = {
  variable: 'Custo variável',
  fixed: 'Despesa fixa',
  investment: 'Investimento',
};

const KIND_HINTS: Record<CategoryKind, string> = {
  variable: 'sobe e desce junto com a venda',
  fixed: 'existe mesmo vendendo zero',
  investment: 'compra que fica, não é custo do mês',
};

export const DREPanel: React.FC<{
  entity: Entity;
  transactions: Transaction[];
  reference: Date;
}> = ({ entity, transactions, reference }) => {
  const [kinds, setKinds] = useState<CategoryKindMap>({});
  const [showConfig, setShowConfig] = useState(false);
  const path = `entities/${entity.id}/config/category_kinds`;

  useEffect(() => {
    return onSnapshot(doc(db, path), snap => {
      const raw = (snap.data()?.kinds || {}) as Record<string, unknown>;
      const out: CategoryKindMap = {};
      for (const [id, v] of Object.entries(raw)) {
        if (v === 'variable' || v === 'fixed' || v === 'investment') out[id] = v;
      }
      setKinds(out);
    }, e => handleFirestoreError(e, OperationType.GET, path));
  }, [path]);

  const dre = useMemo(() => computeDRE(transactions, kinds, reference), [transactions, kinds, reference]);
  const equilibrio = breakEven(dre.despesaFixa, dre.margemPercent);

  const setKind = async (categoryId: string, kind: CategoryKind) => {
    try {
      await setDoc(doc(db, path), { kinds: { ...kinds, [categoryId]: kind }, updatedAt: serverTimestamp() }, { merge: true });
    } catch (error) {
      console.error('Erro ao classificar categoria:', error);
    }
  };

  const despesaCategorias = CATEGORIES.filter(c => c.type !== 'income' && c.id !== 'transferencia');

  const Linha: React.FC<{ label: string; value: number; strong?: boolean; negative?: boolean; hint?: string }> =
    ({ label, value, strong, negative, hint }) => (
      <div className={cn('flex items-baseline justify-between border-b border-line py-2', strong && 'border-b-2')}>
        <span className={cn('text-sm', strong ? 'font-black text-content' : 'text-content-muted')}>
          {label}
          {hint && <span className="ml-2 text-[11px] font-normal text-content-subtle">{hint}</span>}
        </span>
        <span className={cn('tabular-nums', strong ? 'text-lg font-black' : 'text-sm font-bold',
          negative ? 'text-rose-600' : strong ? 'text-content' : 'text-content-muted')}>
          {negative && value > 0 ? `− ${fmt(value)}` : fmt(value)}
        </span>
      </div>
    );

  return (
    <div className="rounded-3xl bg-surface p-8 shadow-sm border border-line">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-lg font-black text-content flex items-center gap-2">
            <Scale className="h-5 w-5 text-indigo-500" />
            Margem e ponto de equilíbrio
          </h3>
          <p className="text-sm text-content-subtle mt-1">
            Quanto sobra de cada real vendido, e quanto você precisa faturar para não ter prejuízo.
          </p>
        </div>
        <button
          onClick={() => setShowConfig(v => !v)}
          className="rounded-xl border border-line px-4 py-2 text-xs font-bold text-content-muted hover:bg-surface-muted"
        >
          {showConfig ? 'Fechar classificação' : 'Classificar categorias'}
        </button>
      </div>

      {dre.semClassificacao.length > 0 && !showConfig && (
        <div className="mt-4 flex items-start gap-2 rounded-2xl bg-amber-50 dark:bg-amber-950/40 border border-amber-200 dark:border-amber-900/40 p-4">
          <AlertTriangle className="h-4 w-4 shrink-0 text-amber-600 mt-0.5" />
          <p className="text-xs text-amber-800 dark:text-amber-300">
            <strong>{dre.semClassificacao.length}</strong>{' '}
            {dre.semClassificacao.length === 1 ? 'categoria ainda não foi classificada' : 'categorias ainda não foram classificadas'}
            {' '}e está contando como <strong>despesa fixa</strong>. Isso deixa a margem mais pessimista
            do que a real — classifique para o número ficar certo.
          </p>
        </div>
      )}

      {showConfig && (
        <div className="mt-5 rounded-2xl border border-line p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">
            Cada categoria de saída é o quê?
          </p>
          <div className="mt-3 space-y-2">
            {despesaCategorias.map(cat => (
              <div key={cat.id} className="flex flex-wrap items-center justify-between gap-2">
                <span className="text-sm font-bold text-content">
                  {cat.name}
                  {!kinds[cat.id] && <span className="ml-2 text-[10px] font-black uppercase text-amber-600">sem classificar</span>}
                </span>
                <div className="flex gap-1">
                  {(['variable', 'fixed', 'investment'] as CategoryKind[]).map(k => (
                    <button
                      key={k}
                      onClick={() => setKind(cat.id, k)}
                      title={KIND_HINTS[k]}
                      className={cn('rounded-lg px-2.5 py-1 text-[11px] font-bold transition-all',
                        kinds[cat.id] === k
                          ? 'bg-primary text-white'
                          : 'border border-line text-content-muted hover:bg-surface-muted')}
                    >
                      {KIND_LABELS[k]}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="mt-6 grid gap-8 lg:grid-cols-2">
        <div>
          <Linha label="Receitas" value={dre.receita} />
          <Linha label="Custos variáveis" value={dre.custoVariavel} negative hint={KIND_HINTS.variable} />
          <Linha label="( = ) Margem de contribuição" value={dre.margemContribuicao} strong />
          <Linha label="Despesas fixas" value={dre.despesaFixa} negative hint={KIND_HINTS.fixed} />
          <Linha label="( = ) Lucro operacional" value={dre.lucroOperacional} strong />
          <Linha label="Investimentos" value={dre.investimentos} negative />
          <Linha label="( = ) Resultado do mês" value={dre.resultado} strong />
        </div>

        <div className="space-y-4">
          <div className="rounded-2xl bg-surface-muted p-5">
            <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">
              Margem de contribuição
            </p>
            <p className={cn('mt-1 text-4xl font-black tracking-tighter',
              dre.margemPercent >= 40 ? 'text-emerald-600' : dre.margemPercent >= 20 ? 'text-amber-600' : 'text-rose-600')}>
              {dre.margemPercent.toFixed(1)}%
            </p>
            <p className="mt-1 text-xs text-content-muted">
              De cada R$ 100 que entram, <strong>{fmt(dre.margemPercent)}</strong> sobram para pagar a
              estrutura e virar lucro.
            </p>
          </div>

          <div className={cn('rounded-2xl p-5 border',
            equilibrio === null
              ? 'bg-rose-50 dark:bg-rose-950/40 border-rose-200 dark:border-rose-900/40'
              : 'bg-surface-muted border-transparent')}>
            <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle flex items-center gap-1.5">
              <Target className="h-3.5 w-3.5" /> Ponto de equilíbrio
            </p>
            {equilibrio === null ? (
              <>
                <p className="mt-1 text-lg font-black text-rose-700 dark:text-rose-300">Não existe neste cenário</p>
                <p className="mt-1 text-xs text-rose-700 dark:text-rose-400">
                  Sua margem está em zero ou negativa: cada venda piora o resultado, então nenhum
                  faturamento resolve. O que precisa mexer é <strong>preço</strong> ou{' '}
                  <strong>custo variável</strong>, não volume.
                </p>
              </>
            ) : (
              <>
                <p className="mt-1 text-3xl font-black tracking-tighter text-content">{fmt(equilibrio)}</p>
                <p className="mt-1 text-xs text-content-muted">
                  É o faturamento do mês que zera o lucro operacional.{' '}
                  {dre.receita >= equilibrio
                    ? <strong className="text-emerald-600">Você já passou disso este mês.</strong>
                    : <>Faltam <strong className="text-rose-600">{fmt(equilibrio - dre.receita)}</strong> para chegar.</>}
                </p>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
};
