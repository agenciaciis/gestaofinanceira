import React from 'react';
import { cn } from '../lib/utils';

const PRESETS = [
  '#6366f1', '#8b5cf6', '#a855f7', '#ec4899', '#ef4444', '#f59e0b',
  '#eab308', '#10b981', '#14b8a6', '#0ea5e9', '#3b82f6', '#111827', '#64748b',
];

/**
 * Seletor de cor profissional: quadrado grande que abre o seletor NATIVO do SO
 * (qualquer cor), campo hex digitável e presets como atalho — sem ficar preso
 * às "bolinhas".
 */
export const ColorField: React.FC<{ value: string; onChange: (hex: string) => void; label?: string }> = ({ value, onChange, label }) => {
  const current = (value && /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(value)) ? value : (value || '#3b82f6');
  return (
    <div className="space-y-3">
      {label && <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle">{label}</label>}
      <div className="flex items-center gap-3">
        <label className="relative shrink-0 cursor-pointer" title="Escolher qualquer cor">
          <span className="block h-12 w-12 rounded-xl border border-line shadow-inner" style={{ backgroundColor: current }} />
          <input
            type="color"
            value={current}
            onChange={(e) => onChange(e.target.value)}
            className="absolute inset-0 h-full w-full cursor-pointer opacity-0"
            aria-label="Escolher cor"
          />
        </label>
        <div className="flex-1">
          <input
            type="text"
            value={value || ''}
            onChange={(e) => onChange(e.target.value)}
            placeholder="#RRGGBB"
            className="w-full rounded-xl border border-line bg-surface px-3 py-2 text-sm font-mono outline-none focus:border-primary"
          />
          <p className="mt-1 text-[11px] text-content-subtle">Clique no quadrado para escolher qualquer cor, ou digite o código.</p>
        </div>
      </div>
      <div className="flex flex-wrap gap-2">
        {PRESETS.map((c) => (
          <button
            key={c}
            type="button"
            onClick={() => onChange(c)}
            title={c}
            style={{ backgroundColor: c }}
            className={cn('h-7 w-7 rounded-lg border transition-transform hover:scale-110',
              (current || '').toLowerCase() === c ? 'ring-2 ring-primary ring-offset-1 border-transparent' : 'border-line')}
          />
        ))}
      </div>
    </div>
  );
};
