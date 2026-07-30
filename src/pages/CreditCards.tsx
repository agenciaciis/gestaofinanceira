import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CreditCard, Transaction } from '../types';
import { Plus, CreditCard as CardIcon, Trash2, Edit2, AlertCircle, Calendar, Info, BarChart3, X, ReceiptText, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { cardGradient, readableForeground, mutedForeground, BANK_PRESETS, normalizeHex } from '../lib/brandColors';
import { computeCardUsage } from '../lib/finance';
import { ViewToggle, useViewMode, DataTable, Column } from '../components/ViewToggle';
import { format, addMonths, startOfMonth, endOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  Legend, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { CATEGORIES } from '../constants';

export const CreditCards: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { showToast, confirm } = useUI();
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [cardTransactions, setCardTransactions] = useState<Record<string, Transaction[]>>({});
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isCompareModalOpen, setIsCompareModalOpen] = useState(false);
  const [editingCard, setEditingCard] = useState<CreditCard | null>(null);
  const [comparingCard, setComparingCard] = useState<CreditCard | null>(null);
  const [selectedCardForInvoices, setSelectedCardForInvoices] = useState<CreditCard | null>(null);
  const [expandedInvoice, setExpandedInvoice] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [name, setName] = useState('');
  const [brand, setBrand] = useState('');
  const [limit, setLimit] = useState('');
  const [dueDay, setDueDay] = useState('');
  const [closingDay, setClosingDay] = useState('');
  const [targetEntityId, setTargetEntityId] = useState('');
  const [color, setColor] = useState('');
  const [viewMode, setViewMode] = useViewMode('cartoes', 'grid');

  useEffect(() => {
    if (entities.length === 0) return;

    const filteredEntities = filterType === 'ALL' 
      ? entities 
      : entities.filter(e => e.type === filterType);

    if (filteredEntities.length === 0) {
      setCards([]);
      setLoading(false);
      return;
    }

    const unsubscribes: (() => void)[] = [];
    let allCards: CreditCard[] = [];

    filteredEntities.forEach(entity => {
      const q = query(collection(db, `entities/${entity.id}/credit_cards`));
      const unsub = onSnapshot(q, (snapshot) => {
        const entityCards = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CreditCard[];
        allCards = [...allCards.filter(c => c.entityId !== entity.id), ...entityCards];
        setCards([...allCards]);

        // Fetch transactions for each card to calculate usage
        entityCards.forEach(card => {
          const tQ = query(collection(db, `entities/${entity.id}/transactions`));
          const unsubT = onSnapshot(tQ, (tSnapshot) => {
            const transactions = tSnapshot.docs.map(doc => doc.data() as Transaction);
            const cardT = transactions.filter(t => t.cardId === card.id);
            setCardTransactions(prev => ({ ...prev, [card.id]: cardT }));
          }, (error) => {
            console.error(`Error fetching transactions for card ${card.id}:`, error);
            handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/transactions`);
          });
          unsubscribes.push(unsubT);
        });
      }, (error) => {
        console.error(`Error fetching credit cards for entity ${entity.id}:`, error);
        handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/credit_cards`);
      });
      unsubscribes.push(unsub);
    });

    setLoading(false);
    return () => unsubscribes.forEach(unsub => unsub());
  }, [entities, filterType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEntityId) return;

    const cardData = {
      name,
      brand,
      limit: Number(limit),
      dueDay: Number(dueDay),
      closingDay: Number(closingDay),
      entityId: targetEntityId,
      color: normalizeHex(color) || null,
      ownerUid: entities.find(e => e.id === targetEntityId)?.ownerUid,
      collaboratorsEmails: entities.find(e => e.id === targetEntityId)?.collaboratorsEmails || [],
    };

    try {
      if (editingCard) {
        await updateDoc(doc(db, `entities/${editingCard.entityId}/credit_cards`, editingCard.id), cardData);
      } else {
        await addDoc(collection(db, `entities/${targetEntityId}/credit_cards`), {
          ...cardData,
          createdAt: serverTimestamp(),
        });
      }
      setIsModalOpen(false);
      resetForm();
      showToast(`Cartão ${editingCard ? 'atualizado' : 'cadastrado'} com sucesso!`, 'success');
    } catch (error) {
      console.error("Error saving card:", error);
      showToast('Erro ao salvar cartão.', 'error');
    }
  };

  const handleEdit = (card: CreditCard) => {
    setEditingCard(card);
    setName(card.name);
    setBrand(card.brand);
    setLimit(card.limit.toString());
    setDueDay(card.dueDay.toString());
    setClosingDay(card.closingDay.toString());
    setTargetEntityId(card.entityId);
    setColor(card.color || '');
    setIsModalOpen(true);
  };

  const resetForm = () => {
    setEditingCard(null);
    setName('');
    setBrand('');
    setLimit('');
    setDueDay('');
    setClosingDay('');
    setTargetEntityId('');
    setColor('');
  };

  const handleDelete = async (entityId: string, cardId: string) => {
    const confirmed = await confirm({
      title: 'Excluir Cartão',
      message: 'Tem certeza que deseja excluir este cartão de crédito?',
      variant: 'danger'
    });
    if (!confirmed) return;
    
    try {
      await deleteDoc(doc(db, `entities/${entityId}/credit_cards`, cardId));
      showToast('Cartão excluído com sucesso.', 'success');
    } catch (error) {
      console.error("Error deleting card:", error);
      showToast('Erro ao excluir cartão.', 'error');
    }
  };

  /**
   * Limite utilizado = fatura do ciclo aberto + parcelas futuras pendentes.
   * A conta anterior somava TODAS as despesas do cartão desde sempre, então o
   * utilizado só crescia e o disponível derretia mesmo com as faturas pagas.
   */
  const calculateUsage = (cardId: string) => {
    const card = cards.find(c => c.id === cardId);
    if (!card) return 0;
    return computeCardUsage(cardId, card.closingDay, cardTransactions[cardId] || []);
  };

  const getComparisonData = (card: CreditCard) => {
    const transactions = cardTransactions[card.id] || [];
    const now = new Date();
    const currentMonth = now.getMonth();
    const currentYear = now.getFullYear();
    
    const prevMonth = currentMonth === 0 ? 11 : currentMonth - 1;
    const prevYear = currentMonth === 0 ? currentYear - 1 : currentYear;

    const currentInvoice = transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === currentMonth && d.getFullYear() === currentYear && t.type === 'expense' && t.status !== 'cancelled';
    });

    const prevInvoice = transactions.filter(t => {
      const d = new Date(t.date);
      return d.getMonth() === prevMonth && d.getFullYear() === prevYear && t.type === 'expense' && t.status !== 'cancelled';
    });

    const data = CATEGORIES.filter(c => c.type !== 'income').map(cat => {
      const currentAmount = currentInvoice.filter(t => t.categoryId === cat.id).reduce((acc, t) => acc + t.amount, 0);
      const prevAmount = prevInvoice.filter(t => t.categoryId === cat.id).reduce((acc, t) => acc + t.amount, 0);
      return {
        name: cat.name,
        atual: currentAmount,
        anterior: prevAmount,
      };
    }).filter(d => d.atual > 0 || d.anterior > 0);

    return data;
  };

  const brl = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);

  const colunasCartoes: Column<CreditCard>[] = [
    {
      chave: 'nome', titulo: 'Cartão',
      render: (c) => (
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full border border-line"
            style={{ backgroundColor: normalizeHex(c.color) || '#111827' }} />
          <span className="font-bold text-content">{c.name}</span>
          <span className="text-[10px] font-black uppercase text-content-subtle">{c.brand}</span>
        </span>
      ),
    },
    { chave: 'limite', titulo: 'Limite', numerico: true, render: (c) => brl(c.limit) },
    {
      chave: 'usado', titulo: 'Utilizado', numerico: true,
      render: (c) => {
        const usado = calculateUsage(c.id);
        const pct = c.limit > 0 ? (usado / c.limit) * 100 : 0;
        return (
          <span className={cn('font-bold', pct > 90 ? 'text-rose-600' : pct > 70 ? 'text-amber-600' : 'text-content-muted')}>
            {brl(usado)} <span className="text-[10px] font-normal">({pct.toFixed(0)}%)</span>
          </span>
        );
      },
    },
    {
      chave: 'disponivel', titulo: 'Disponível', numerico: true,
      render: (c) => <span className="font-bold text-emerald-600">{brl(c.limit - calculateUsage(c.id))}</span>,
    },
    { chave: 'fecha', titulo: 'Fecha', numerico: true, escondeNoMobile: true, render: (c) => `dia ${c.closingDay}` },
    { chave: 'vence', titulo: 'Vence', numerico: true, escondeNoMobile: true, render: (c) => `dia ${c.dueDay}` },
  ];

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-content">Cartões de Crédito</h2>
          <p className="text-sm text-content-subtle">Controle seus limites e faturas.</p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Novo Cartão
          </button>
        </div>
      </div>

      {viewMode === 'list' && (
        <DataTable
          itens={cards}
          colunas={colunasCartoes}
          acoes={(card) => (
            <>
              <button onClick={() => handleEdit(card)} title="Editar"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                <Edit2 className="h-4 w-4" />
              </button>
              <button onClick={() => handleDelete(card.entityId, card.id)} title="Excluir"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-rose-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          vazio={<p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhum cartão cadastrado.</p>}
        />
      )}

      {viewMode === 'grid' && <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const usedLimit = calculateUsage(card.id);
          const availableLimit = card.limit - usedLimit;
          const usagePercentage = Math.min((usedLimit / card.limit) * 100, 100);

          const gradient = cardGradient(card.color);
          const fg = readableForeground(gradient.from);
          const fgMuted = mutedForeground(gradient.from);

          return (
            <motion.div
              key={card.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              /* A cor do cartão é FIXA (escolhida pelo usuário), não segue o tema.
                 Por isso o texto por cima vem de readableForeground e não de um
                 token de tema — senão no tema claro o rótulo escurece e some. */
              style={{
                background: `linear-gradient(135deg, ${gradient.from} 0%, ${gradient.to} 100%)`,
                color: fg,
              }}
              className="group relative overflow-hidden rounded-2xl p-6 shadow-xl border border-white/10"
            >
              <div className="flex items-center justify-between">
                <CardIcon className="h-8 w-8" style={{ color: fgMuted }} />
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleEdit(card)}
                    className="rounded-full bg-white/10 p-1.5 hover:bg-white/20 transition-all"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(card.entityId, card.id)}
                    className="rounded-full bg-white/10 p-1.5 hover:bg-red-500/20 hover:text-red-400 transition-all"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              
              <div className="mt-6">
                <p style={{ color: fgMuted }} className="text-xs font-medium uppercase tracking-widest">{card.brand || 'Cartão'}</p>
                <h3 className="text-xl font-bold">{card.name}</h3>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <div style={{ color: fgMuted }} className="mb-1 flex justify-between text-[10px] uppercase tracking-wider">
                    <span>Limite Utilizado</span>
                    <span>{usagePercentage.toFixed(1)}%</span>
                  </div>
                  <div style={{ backgroundColor: fg === '#ffffff' ? 'rgba(255,255,255,0.22)' : 'rgba(15,23,42,0.18)' }} className="h-1.5 w-full overflow-hidden rounded-full">
                    <div
                      className="h-full transition-all duration-500"
                      /* Estado normal usa a cor do TEXTO do cartão: garante
                         contraste em qualquer cor de marca (azul fixo sumia no
                         roxo do Nubank e no laranja do Inter). Vermelho fica
                         reservado ao estouro, onde a cor carrega significado. */
                      style={{
                        width: `${usagePercentage}%`,
                        backgroundColor: usagePercentage > 90 ? '#ef4444' : fg,
                      }}
                    />
                  </div>
                </div>

                <div className="flex justify-between">
                  <div>
                    <p style={{ color: fgMuted }} className="text-[10px] uppercase">Disponível</p>
                    <p className="text-sm font-bold text-green-400">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(availableLimit)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p style={{ color: fgMuted }} className="text-[10px] uppercase">Limite Total</p>
                    <p className="text-sm font-bold">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(card.limit)}
                    </p>
                  </div>
                </div>

                <div className="flex justify-between border-t border-white/10 pt-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3 w-3 text-content-subtle" />
                    <div>
                      <p className="text-[8px] uppercase text-content-subtle">Fechamento</p>
                      <p className="text-xs font-bold">Dia {card.closingDay}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <div>
                      <p className="text-[8px] uppercase text-content-subtle">Vencimento</p>
                      <p className="text-xs font-bold">Dia {card.dueDay}</p>
                    </div>
                    <Info className="h-3 w-3 text-content-subtle" />
                  </div>
                </div>

                <div className="grid grid-cols-2 gap-2">
                  <button
                    onClick={() => {
                      setComparingCard(card);
                      setIsCompareModalOpen(true);
                    }}
                    className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-white/10 py-2 text-[10px] font-bold hover:bg-white/20 transition-all"
                  >
                    <BarChart3 className="h-3 w-3" />
                    Comparar
                  </button>
                  <button
                    onClick={() => {
                      setSelectedCardForInvoices(card);
                    }}
                    className="mt-2 flex items-center justify-center gap-2 rounded-xl bg-primary/20 py-2 text-[10px] font-bold hover:bg-primary/30 transition-all text-primary-foreground"
                  >
                    <ReceiptText className="h-3 w-3" />
                    Ver Faturas
                  </button>
                </div>
              </div>

              {/* Entity Badge */}
              <div className="absolute right-4 top-4">
                <span className={cn(
                  "rounded-full px-2 py-0.5 text-[8px] font-bold uppercase",
                  entities.find(e => e.id === card.entityId)?.type === 'PF' ? "bg-blue-500/20 text-blue-300" : "bg-purple-500/20 text-purple-300"
                )}>
                  {entities.find(e => e.id === card.entityId)?.type}
                </span>
              </div>
            </motion.div>
          );
        })}
      </div>}

      <AnimatePresence>
        {selectedCardForInvoices && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl rounded-3xl bg-surface p-8 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-content">Histórico de Faturas</h3>
                  <p className="text-sm text-content-subtle">{selectedCardForInvoices.name} - Detalhamento de Lançamentos</p>
                </div>
                <button 
                  onClick={() => setSelectedCardForInvoices(null)}
                  className="rounded-full p-2 hover:bg-surface-muted text-content-subtle transition-all"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="flex-1 overflow-y-auto pr-2 space-y-4">
                {(() => {
                  const transactions = cardTransactions[selectedCardForInvoices.id] || [];
                  const groupedByMonth = transactions.reduce((acc, t) => {
                    const date = new Date(t.date);
                    const key = format(date, 'yyyy-MM');
                    if (!acc[key]) acc[key] = [];
                    acc[key].push(t);
                    return acc;
                  }, {} as Record<string, Transaction[]>);

                  const sortedMonths = Object.keys(groupedByMonth).sort((a, b) => b.localeCompare(a));

                  if (sortedMonths.length === 0) {
                    return (
                      <div className="flex flex-col items-center justify-center py-12 text-content-subtle">
                        <ReceiptText className="h-12 w-12 opacity-20 mb-4" />
                        <p>Nenhum lançamento encontrado para este cartão.</p>
                      </div>
                    );
                  }

                  return sortedMonths.map(monthKey => {
                    const monthTransactions = groupedByMonth[monthKey].sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
                    const totalAmount = monthTransactions.reduce((acc, t) => acc + t.amount, 0);
                    const isExpanded = expandedInvoice === monthKey;
                    const [year, month] = monthKey.split('-');
                    const date = new Date(parseInt(year), parseInt(month) - 1);

                    return (
                      <div key={monthKey} className="rounded-2xl border border-line overflow-hidden">
                        <button 
                          onClick={() => setExpandedInvoice(isExpanded ? null : monthKey)}
                          className="w-full flex items-center justify-between p-4 bg-canvas hover:bg-surface-muted transition-all"
                        >
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-xl bg-surface flex flex-col items-center justify-center shadow-sm">
                              <span className="text-[10px] font-bold uppercase text-content-subtle">{format(date, 'MMM', { locale: ptBR })}</span>
                              <span className="text-sm font-black text-content">{format(date, 'yyyy')}</span>
                            </div>
                            <div className="text-left">
                              <p className="text-sm font-bold text-content">Fatura de {format(date, 'MMMM', { locale: ptBR })}</p>
                              <p className="text-xs text-content-subtle">{monthTransactions.length} lançamentos</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <p className="text-xs text-content-subtle uppercase font-bold">Total</p>
                              <p className="text-lg font-black text-primary">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalAmount)}
                              </p>
                            </div>
                            {isExpanded ? <ChevronUp className="h-5 w-5 text-content-subtle" /> : <ChevronDown className="h-5 w-5 text-content-subtle" />}
                          </div>
                        </button>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div 
                              initial={{ height: 0 }}
                              animate={{ height: 'auto' }}
                              exit={{ height: 0 }}
                              className="overflow-hidden bg-surface"
                            >
                              <div className="p-4 overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-gray-50 text-content-subtle uppercase font-bold tracking-wider">
                                      <th className="pb-3 pl-2">Data</th>
                                      <th className="pb-3">Descrição</th>
                                      <th className="pb-3">Parcela</th>
                                      <th className="pb-3">Status</th>
                                      <th className="pb-3 text-right pr-2">Valor</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {monthTransactions.map(t => (
                                      <tr key={t.id} className="hover:bg-canvas transition-colors">
                                        <td className="py-3 pl-2 text-content-subtle">{format(new Date(t.date), 'dd/MM/yyyy')}</td>
                                        <td className="py-3 font-bold text-content">{t.description}</td>
                                        <td className="py-3">
                                          {t.installmentNumber ? (
                                            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
                                              {t.installmentNumber}/{t.totalInstallments}
                                            </span>
                                          ) : (
                                            <span className="text-content-subtle">-</span>
                                          )}
                                        </td>
                                        <td className="py-3">
                                          <span className={cn(
                                            "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                                            t.status === 'completed' ? "bg-green-50 text-green-600" : "bg-amber-50 text-amber-600"
                                          )}>
                                            {t.status === 'completed' ? 'Pago' : 'Pendente'}
                                          </span>
                                        </td>
                                        <td className="py-3 text-right pr-2 font-black text-content">
                                          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.amount)}
                                        </td>
                                      </tr>
                                    ))}
                                  </tbody>
                                </table>
                              </div>
                            </motion.div>
                          )}
                        </AnimatePresence>
                      </div>
                    );
                  });
                })()}
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  onClick={() => setSelectedCardForInvoices(null)}
                  className="rounded-xl bg-surface-muted px-6 py-2 text-sm font-bold text-content-muted hover:bg-gray-200 transition-all"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}

        {isCompareModalOpen && comparingCard && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="w-full max-w-3xl rounded-3xl bg-surface p-8 shadow-2xl"
            >
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-content">Comparativo de Faturas</h3>
                  <p className="text-sm text-content-subtle">{comparingCard.name} - Atual vs Anterior</p>
                </div>
                <button 
                  onClick={() => setIsCompareModalOpen(false)}
                  className="rounded-full p-2 hover:bg-surface-muted text-content-subtle transition-all"
                >
                  <X className="h-6 w-6" />
                </button>
              </div>

              <div className="h-[400px] w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={getComparisonData(comparingCard)}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f3f4f6" />
                    <XAxis 
                      dataKey="name" 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#9ca3af', fontSize: 12 }}
                    />
                    <YAxis 
                      axisLine={false} 
                      tickLine={false} 
                      tick={{ fill: '#9ca3af', fontSize: 12 }}
                      tickFormatter={(value) => `R$ ${value}`}
                    />
                    <Tooltip 
                      formatter={(value: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(value)}
                      contentStyle={{ borderRadius: '12px', border: 'none', boxShadow: '0 10px 15px -3px rgb(0 0 0 / 0.1)' }}
                    />
                    <Legend verticalAlign="top" align="right" height={36}/>
                    <Bar dataKey="anterior" fill="#9ca3af" radius={[4, 4, 0, 0]} name="Mês Anterior" />
                    <Bar dataKey="atual" fill="#3b82f6" radius={[4, 4, 0, 0]} name="Mês Atual" />
                  </BarChart>
                </ResponsiveContainer>
              </div>

              <div className="mt-8 flex justify-end">
                <button
                  onClick={() => setIsCompareModalOpen(false)}
                  className="rounded-xl bg-surface-muted px-6 py-2 text-sm font-bold text-content-muted hover:bg-gray-200 transition-all"
                >
                  Fechar
                </button>
              </div>
            </motion.div>
          </div>
        )}
      </AnimatePresence>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-md rounded-2xl bg-surface p-8 shadow-2xl"
          >
            <h3 className="text-xl font-bold text-content">
              {editingCard ? 'Editar Cartão' : 'Novo Cartão de Crédito'}
            </h3>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-content-muted">Entidade Responsável</label>
                <select 
                  value={targetEntityId}
                  onChange={(e) => setTargetEntityId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                  required
                >
                  <option value="">Selecione a entidade...</option>
                  {entities.map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-content-muted">Nome do Cartão</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Nubank Platinum"
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Bandeira</label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Visa, Master..."
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Limite</label>
                  <input
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
              </div>

              {/* Cor do cartão */}
              <div>
                <label className="block text-sm font-medium text-content-muted">Cor do cartão</label>
                <div className="mt-2 flex flex-wrap gap-2">
                  {BANK_PRESETS.map(preset => (
                    <button
                      key={preset.id}
                      type="button"
                      title={preset.name}
                      onClick={() => setColor(preset.color)}
                      style={{ backgroundColor: preset.color }}
                      className={cn(
                        'h-8 w-8 rounded-full border transition-all',
                        normalizeHex(color) === preset.color
                          ? 'ring-2 ring-primary ring-offset-2 border-transparent scale-110'
                          : 'border-line hover:scale-110'
                      )}
                    />
                  ))}
                </div>
                <div className="mt-3 flex items-center gap-3">
                  <input
                    type="color"
                    value={normalizeHex(color) || '#111827'}
                    onChange={(e) => setColor(e.target.value)}
                    title="Escolher qualquer cor"
                    className="h-9 w-14 cursor-pointer rounded-lg border border-line bg-transparent p-1"
                  />
                  <span className="text-xs text-content-subtle">
                    {color ? BANK_PRESETS.find(p => p.color === normalizeHex(color))?.name || normalizeHex(color) : 'Sem cor — usa o visual escuro padrão'}
                  </span>
                  {color && (
                    <button
                      type="button"
                      onClick={() => setColor('')}
                      className="ml-auto text-xs font-bold text-content-subtle hover:text-rose-600"
                    >
                      Remover cor
                    </button>
                  )}
                </div>

                {/* Prévia com o texto já na cor que o sistema vai calcular */}
                <div
                  className="mt-3 rounded-xl p-4"
                  style={{
                    background: `linear-gradient(135deg, ${cardGradient(color).from} 0%, ${cardGradient(color).to} 100%)`,
                    color: readableForeground(cardGradient(color).from),
                  }}
                >
                  <p className="text-[10px] uppercase tracking-widest" style={{ color: mutedForeground(cardGradient(color).from) }}>
                    {brand || 'Bandeira'}
                  </p>
                  <p className="text-lg font-bold">{name || 'Nome do cartão'}</p>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Dia Vencimento</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Dia Fechamento</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={closingDay}
                    onChange={(e) => setClosingDay(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 rounded-lg border border-line py-2 text-sm font-semibold text-content-muted hover:bg-canvas"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-white hover:bg-primary/90"
                >
                  {editingCard ? 'Salvar Alterações' : 'Salvar Cartão'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
