/**
 * Registra um movimento entre PF e PJ (pró-labore, distribuição, aporte,
 * reembolso) criando as DUAS pontas de uma vez, em lote.
 *
 * Em lote de propósito: se só uma ponta nascesse, o grupo ficaria com dinheiro
 * sumido ou dobrado. Ou nascem as duas, ou nenhuma.
 */
import React, { useState } from 'react';
import { collection, doc, serverTimestamp, writeBatch } from 'firebase/firestore';
import { db } from '../firebase';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { buildCrossEntityPair } from '../lib/crossEntity';
import { CROSS_ENTITY_KIND_LABELS, CrossEntityKind } from '../types';
import { motion } from 'motion/react';
import { ArrowRightLeft } from 'lucide-react';
import { formatLocalDate } from '../lib/finance';

interface Props {
  onClose: () => void;
}

export const CrossEntityTransferModal: React.FC<Props> = ({ onClose }) => {
  const { entities } = useEntity();
  const { showToast } = useUI();

  const defaultFrom = entities.find(e => e.type === 'PJ')?.id || entities[0]?.id || '';
  const defaultTo = entities.find(e => e.type === 'PF')?.id || entities[1]?.id || '';

  const [fromEntityId, setFromEntityId] = useState(defaultFrom);
  const [toEntityId, setToEntityId] = useState(defaultTo);
  const [kind, setKind] = useState<CrossEntityKind>('prolabore');
  const [amount, setAmount] = useState('');
  const [date, setDate] = useState(formatLocalDate(new Date()));
  const [saving, setSaving] = useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (saving) return;

    let pair;
    try {
      pair = buildCrossEntityPair({
        groupId: crypto.randomUUID(),
        fromEntityId,
        toEntityId,
        amount: Number(amount),
        date,
        kind,
        description: CROSS_ENTITY_KIND_LABELS[kind],
      });
    } catch (error: any) {
      showToast(error?.message || 'Dados inválidos.', 'error');
      return;
    }

    setSaving(true);
    try {
      const batch = writeBatch(db);
      for (const side of [pair.from, pair.to]) {
        const entity = entities.find(en => en.id === side.entityId);
        const ref = doc(collection(db, `entities/${side.entityId}/transactions`));
        batch.set(ref, {
          ...side,
          ownerUid: entity?.ownerUid,
          collaboratorsEmails: entity?.collaboratorsEmails || [],
          createdAt: serverTimestamp(),
        });
      }
      await batch.commit();
      showToast('Movimento registrado nas duas entidades.', 'success');
      onClose();
    } catch (error) {
      console.error('Erro ao registrar movimento entre entidades:', error);
      showToast('Erro ao registrar o movimento.', 'error');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <motion.div
        initial={{ opacity: 0, scale: 0.95, y: 20 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        className="w-full max-w-lg rounded-3xl bg-surface dark:bg-gray-900 p-8 shadow-2xl"
      >
        <div className="flex items-center gap-3">
          <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-indigo-50 text-indigo-600">
            <ArrowRightLeft className="h-5 w-5" />
          </div>
          <div>
            <h3 className="text-xl font-black text-content dark:text-gray-100">Movimento entre PF e PJ</h3>
            <p className="text-sm text-content-subtle">Cria as duas pontas de uma vez, já vinculadas.</p>
          </div>
        </div>

        <form onSubmit={handleSubmit} className="mt-6 space-y-4">
          <div>
            <label className="block text-sm font-medium text-content-muted dark:text-gray-300">Tipo</label>
            <select
              value={kind}
              onChange={(e) => setKind(e.target.value as CrossEntityKind)}
              className="mt-1 w-full rounded-lg border border-line dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
            >
              {Object.entries(CROSS_ENTITY_KIND_LABELS).map(([value, label]) => (
                <option key={value} value={value}>{label}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-muted dark:text-gray-300">Sai de</label>
              <select
                value={fromEntityId}
                onChange={(e) => setFromEntityId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
              >
                {entities.map(en => <option key={en.id} value={en.id}>{en.name} ({en.type})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-content-muted dark:text-gray-300">Entra em</label>
              <select
                value={toEntityId}
                onChange={(e) => setToEntityId(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
              >
                {entities.map(en => <option key={en.id} value={en.id}>{en.name} ({en.type})</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-content-muted dark:text-gray-300">Valor</label>
              <input
                type="number" step="0.01" min="0.01" required
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-content-muted dark:text-gray-300">Data</label>
              <input
                type="date" required
                value={date}
                onChange={(e) => setDate(e.target.value)}
                className="mt-1 w-full rounded-lg border border-line dark:border-gray-700 dark:bg-gray-800 dark:text-gray-100 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
              />
            </div>
          </div>

          <p className="rounded-xl bg-surface-muted dark:bg-gray-800/60 p-3 text-xs text-content-subtle dark:text-slate-400">
            Isso não é receita nova: no consolidado do grupo as duas pontas se anulam. Cada entidade
            continua vendo o movimento na sua própria conta.
          </p>

          <div className="flex gap-3 pt-2">
            <button
              type="button" onClick={onClose}
              className="flex-1 rounded-2xl border border-line dark:border-gray-700 py-3 text-sm font-bold text-content-muted dark:text-gray-400 hover:bg-surface-muted dark:hover:bg-gray-800"
            >
              Cancelar
            </button>
            <button
              type="submit" disabled={saving}
              className="flex-1 rounded-2xl bg-primary py-3 text-sm font-bold text-white hover:bg-primary/90 disabled:opacity-50"
            >
              {saving ? 'Registrando...' : 'Registrar movimento'}
            </button>
          </div>
        </form>
      </motion.div>
    </div>
  );
};
