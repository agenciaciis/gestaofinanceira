/**
 * Comparador de períodos com AV e AH — estrutura da planilha antiga.
 *
 *  AV (análise vertical)   : a linha como % da receita do PRÓPRIO período.
 *                            Mostra composição: "aluguel come 18% do que entra".
 *  AH (análise horizontal) : variação de um período para o outro.
 *                            Mostra tendência: "gastei 30% mais que no mês passado".
 */
import React, { useState, useMemo } from 'react';
import { Transaction } from '../types';
import { CATEGORIES } from '../constants';
import { periodTotals, verticalAnalysis, horizontalAnalysis } from '../lib/variance';
import { formatLocalDate, parseLocalDate } from '../lib/finance';
import { GitCompareArrows } from 'lucide-react';
import { cn } from '../lib/utils';

const fmt = (n: number) =>
  new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);

const pct = (v: number | null, suffix = '%') =>
  v === null ? '—' : `${v > 0 ? '+' : ''}${v.toFixed(1)}${suffix}`;

/** Primeiro e último dia de um mês deslocado em `offset` meses. */
function mesRelativo(offset: number): { start: string; end: string } {
  const hoje = new Date();
  const start = new Date(hoje.getFullYear(), hoje.getMonth() + offset, 1);
  const end = new Date(hoje.getFullYear(), hoje.getMonth() + offset + 1, 0);
  return { start: formatLocalDate(start), end: formatLocalDate(end) };
}

export const PeriodComparePanel: React.FC<{ transactions: Transaction[] }> = ({ transactions }) => {
  const anterior = mesRelativo(-1);
  const atual = mesRelativo(0);

  const [aStart, setAStart] = useState(anterior.start);
  const [aEnd, setAEnd] = useState(anterior.end);
  const [bStart, setBStart] = useState(atual.start);
  const [bEnd, setBEnd] = useState(atual.end);

  const A = useMemo(() => periodTotals(transactions, parseLocalDate(aStart), parseLocalDate(aEnd)),
    [transactions, aStart, aEnd]);
  const B = useMemo(() => periodTotals(transactions, parseLocalDate(bStart), parseLocalDate(bEnd)),
    [transactions, bStart, bEnd]);

  /** Categorias que apareceram em algum dos dois períodos. */
  const categorias = useMemo(() => {
    const ids = new Set([...Object.keys(A.porCategoria), ...Object.keys(B.porCategoria)]);
    return [...ids]
      .map(id => ({ id, name: CATEGORIES.find(c => c.id === id)?.name || id }))
      .sort((x, y) => (B.porCategoria[y.id] || 0) - (B.porCategoria[x.id] || 0));
  }, [A, B]);

  const Cell: React.FC<{ children: React.ReactNode; className?: string }> = ({ children, className }) => (
    <td className={cn('py-2 text-right text-sm tabular-nums whitespace-nowrap', className)}>{children}</td>
  );

  const ahColor = (v: number | null, gastoRuimSubir: boolean) => {
    if (v === null || v === 0) return 'text-content-subtle';
    const subiu = v > 0;
    const ruim = gastoRuimSubir ? subiu : !subiu;
    return ruim ? 'text-rose-600' : 'text-emerald-600';
  };

  return (
    <div className="rounded-3xl bg-surface p-8 shadow-sm border border-line">
      <h3 className="text-lg font-black text-content flex items-center gap-2">
        <GitCompareArrows className="h-5 w-5 text-indigo-500" />
        Comparar dois períodos
      </h3>
      <p className="text-sm text-content-subtle mt-1">
        <strong>AV</strong> é quanto a linha representa da receita do próprio período (composição).{' '}
        <strong>AH</strong> é a variação de A para B (tendência).
      </p>

      <div className="mt-5 grid gap-4 sm:grid-cols-2">
        <div className="rounded-2xl border border-line p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Período A</p>
          <div className="mt-2 flex items-center gap-2">
            <input type="date" value={aStart} onChange={e => setAStart(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-primary" />
            <span className="text-content-subtle">a</span>
            <input type="date" value={aEnd} onChange={e => setAEnd(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-primary" />
          </div>
        </div>
        <div className="rounded-2xl border border-line p-4">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Período B</p>
          <div className="mt-2 flex items-center gap-2">
            <input type="date" value={bStart} onChange={e => setBStart(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-primary" />
            <span className="text-content-subtle">a</span>
            <input type="date" value={bEnd} onChange={e => setBEnd(e.target.value)}
              className="w-full rounded-lg border border-line px-3 py-1.5 text-sm outline-none focus:border-primary" />
          </div>
        </div>
      </div>

      <div className="mt-6 overflow-x-auto">
        <table className="w-full min-w-[640px]">
          <thead>
            <tr className="border-b-2 border-line">
              <th className="py-2 text-left text-[10px] font-black uppercase tracking-widest text-content-subtle">Linha</th>
              <th className="py-2 text-right text-[10px] font-black uppercase tracking-widest text-content-subtle">A</th>
              <th className="py-2 text-right text-[10px] font-black uppercase tracking-widest text-content-subtle">AV A</th>
              <th className="py-2 text-right text-[10px] font-black uppercase tracking-widest text-content-subtle">B</th>
              <th className="py-2 text-right text-[10px] font-black uppercase tracking-widest text-content-subtle">AV B</th>
              <th className="py-2 text-right text-[10px] font-black uppercase tracking-widest text-content-subtle">AH</th>
            </tr>
          </thead>
          <tbody>
            <tr className="border-b border-line">
              <td className="py-2 text-sm font-black text-content">Receitas</td>
              <Cell className="font-bold text-content">{fmt(A.receita)}</Cell>
              <Cell className="text-content-subtle">100%</Cell>
              <Cell className="font-bold text-content">{fmt(B.receita)}</Cell>
              <Cell className="text-content-subtle">100%</Cell>
              <Cell className={cn('font-bold', ahColor(horizontalAnalysis(A.receita, B.receita), false))}>
                {pct(horizontalAnalysis(A.receita, B.receita))}
              </Cell>
            </tr>
            <tr className="border-b border-line">
              <td className="py-2 text-sm font-black text-content">Despesas</td>
              <Cell className="font-bold text-rose-600">{fmt(A.despesa)}</Cell>
              <Cell className="text-content-subtle">{pct(verticalAnalysis(A.despesa, A.receita), '%')}</Cell>
              <Cell className="font-bold text-rose-600">{fmt(B.despesa)}</Cell>
              <Cell className="text-content-subtle">{pct(verticalAnalysis(B.despesa, B.receita), '%')}</Cell>
              <Cell className={cn('font-bold', ahColor(horizontalAnalysis(A.despesa, B.despesa), true))}>
                {pct(horizontalAnalysis(A.despesa, B.despesa))}
              </Cell>
            </tr>

            {categorias.map(cat => {
              const a = A.porCategoria[cat.id] || 0;
              const b = B.porCategoria[cat.id] || 0;
              return (
                <tr key={cat.id} className="border-b border-line">
                  <td className="py-2 pl-4 text-sm text-content-muted">{cat.name}</td>
                  <Cell className="text-content-muted">{fmt(a)}</Cell>
                  <Cell className="text-content-subtle">{pct(verticalAnalysis(a, A.receita), '%')}</Cell>
                  <Cell className="text-content-muted">{fmt(b)}</Cell>
                  <Cell className="text-content-subtle">{pct(verticalAnalysis(b, B.receita), '%')}</Cell>
                  <Cell className={cn('font-bold', ahColor(horizontalAnalysis(a, b), true))}>
                    {pct(horizontalAnalysis(a, b))}
                  </Cell>
                </tr>
              );
            })}

            <tr className="border-t-2 border-line">
              <td className="py-3 text-sm font-black text-content">Resultado</td>
              <Cell className={cn('text-base font-black', A.resultado >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {fmt(A.resultado)}
              </Cell>
              <Cell className="text-content-subtle">{pct(verticalAnalysis(A.resultado, A.receita), '%')}</Cell>
              <Cell className={cn('text-base font-black', B.resultado >= 0 ? 'text-emerald-600' : 'text-rose-600')}>
                {fmt(B.resultado)}
              </Cell>
              <Cell className="text-content-subtle">{pct(verticalAnalysis(B.resultado, B.receita), '%')}</Cell>
              <Cell className={cn('font-bold', ahColor(horizontalAnalysis(A.resultado, B.resultado), false))}>
                {pct(horizontalAnalysis(A.resultado, B.resultado))}
              </Cell>
            </tr>
          </tbody>
        </table>
      </div>

      <p className="mt-4 text-xs text-content-subtle">
        Traço em AV significa período sem receita — não dá para calcular participação sobre zero.
        Traço em AH significa que a linha partiu de zero, e crescer a partir de zero não tem
        percentual.
      </p>
    </div>
  );
};
