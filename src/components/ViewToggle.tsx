/**
 * Alternador entre quadrados (cartões) e lista, e a tabela genérica que a
 * lista usa.
 *
 * A preferência é POR ABA, não global: em Lançamentos a lista quase sempre
 * ganha, em Cartões o quadrado é bem melhor. Uma preferência única obrigaria
 * a pessoa a reescolher toda vez que trocasse de tela.
 */
import React, { useState } from 'react';
import { LayoutGrid, List } from 'lucide-react';
import { cn } from '../lib/utils';

export type ViewMode = 'grid' | 'list';

/** Lembra a escolha desta aba no dispositivo. */
export function useViewMode(chave: string, inicial: ViewMode = 'grid') {
  const storageKey = `finanflow:visao:${chave}`;
  const [mode, setMode] = useState<ViewMode>(() => {
    try {
      const salvo = localStorage.getItem(storageKey);
      return salvo === 'list' || salvo === 'grid' ? salvo : inicial;
    } catch {
      return inicial;   // aba privada
    }
  });

  const alterar = (novo: ViewMode) => {
    setMode(novo);
    try { localStorage.setItem(storageKey, novo); } catch { /* sem storage */ }
  };

  return [mode, alterar] as const;
}

export const ViewToggle: React.FC<{ mode: ViewMode; onChange: (m: ViewMode) => void }> = ({ mode, onChange }) => (
  <div className="flex items-center gap-1 rounded-xl border border-line p-1">
    {([
      { id: 'grid' as const, Icon: LayoutGrid, label: 'Ver em quadrados' },
      { id: 'list' as const, Icon: List, label: 'Ver em lista' },
    ]).map(({ id, Icon, label }) => (
      <button
        key={id}
        onClick={() => onChange(id)}
        title={label}
        aria-label={label}
        aria-pressed={mode === id}
        className={cn(
          'flex h-8 w-8 items-center justify-center rounded-lg transition-all',
          mode === id ? 'bg-primary text-white' : 'text-content-subtle hover:bg-surface-muted hover:text-content'
        )}
      >
        <Icon className="h-4 w-4" />
      </button>
    ))}
  </div>
);

export interface Column<T> {
  chave: string;
  titulo: string;
  /** Conteúdo da célula. */
  render: (item: T) => React.ReactNode;
  /** Alinha à direita — use em dinheiro, para as vírgulas alinharem. */
  numerico?: boolean;
  /** Esconde em tela estreita, para a tabela não estourar no celular. */
  escondeNoMobile?: boolean;
}

/**
 * Tabela genérica da visão em lista. Cada tela só declara as colunas, em vez
 * de reescrever markup de tabela seis vezes.
 */
export function DataTable<T extends { id: string }>({
  itens, colunas, acoes, vazio,
}: {
  itens: T[];
  colunas: Column<T>[];
  acoes?: (item: T) => React.ReactNode;
  vazio?: React.ReactNode;
}) {
  if (itens.length === 0 && vazio) return <>{vazio}</>;

  return (
    <div className="overflow-x-auto rounded-2xl border border-line bg-surface">
      <table className="w-full">
        <thead>
          <tr className="border-b border-line">
            {colunas.map(c => (
              <th
                key={c.chave}
                className={cn(
                  'px-4 py-3 text-[10px] font-black uppercase tracking-widest text-content-subtle',
                  c.numerico ? 'text-right' : 'text-left',
                  c.escondeNoMobile && 'hidden md:table-cell'
                )}
              >
                {c.titulo}
              </th>
            ))}
            {acoes && <th className="px-4 py-3" />}
          </tr>
        </thead>
        <tbody>
          {itens.map(item => (
            <tr key={item.id} className="border-b border-line last:border-0 hover:bg-surface-muted/60 transition-colors">
              {colunas.map(c => (
                <td
                  key={c.chave}
                  className={cn(
                    'px-4 py-3 text-sm text-content-muted',
                    c.numerico && 'text-right tabular-nums',
                    c.escondeNoMobile && 'hidden md:table-cell'
                  )}
                >
                  {c.render(item)}
                </td>
              ))}
              {acoes && <td className="px-4 py-3"><div className="flex justify-end gap-1">{acoes(item)}</div></td>}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
