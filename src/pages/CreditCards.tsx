import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, deleteDoc, doc, updateDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { CreditCard, Transaction } from '../types';
import { Plus, CreditCard as CardIcon, Trash2, Edit2, AlertCircle, Calendar, Info, BarChart3, X, ReceiptText, ChevronRight, ChevronDown, ChevronUp } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
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

  const calculateUsage = (cardId: string) => {
    const transactions = cardTransactions[cardId] || [];
    // Only consider pending or completed expenses for current usage
    return transactions
      .filter(t => t.type === 'expense' && t.status !== 'cancelled')
      .reduce((acc, t) => acc + t.amount, 0);
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

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Cartões de Crédito</h2>
          <p className="text-sm text-gray-500">Controle seus limites e faturas.</p>
        </div>
        <button 
          onClick={() => setIsModalOpen(true)}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-primary/90"
        >
          <Plus className="h-4 w-4" />
          Novo Cartão
        </button>
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {cards.map((card) => {
          const usedLimit = calculateUsage(card.id);
          const availableLimit = card.limit - usedLimit;
          const usagePercentage = Math.min((usedLimit / card.limit) * 100, 100);

          return (
            <motion.div 
              key={card.id}
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              className="group relative overflow-hidden rounded-2xl bg-gradient-to-br from-gray-900 to-gray-800 dark:from-slate-900 dark:to-slate-950 p-6 text-white shadow-xl dark:shadow-none border border-white/10 dark:border-slate-800"
            >
              <div className="flex items-center justify-between">
                <CardIcon className="h-8 w-8 text-gray-400" />
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
                <p className="text-xs font-medium uppercase tracking-widest text-gray-400">{card.brand || 'Cartão'}</p>
                <h3 className="text-xl font-bold">{card.name}</h3>
              </div>

              <div className="mt-6 space-y-4">
                <div>
                  <div className="mb-1 flex justify-between text-[10px] uppercase tracking-wider text-gray-400">
                    <span>Limite Utilizado</span>
                    <span>{usagePercentage.toFixed(1)}%</span>
                  </div>
                  <div className="h-1.5 w-full overflow-hidden rounded-full bg-gray-700">
                    <div 
                      className={cn(
                        "h-full transition-all duration-500",
                        usagePercentage > 90 ? "bg-red-500" : usagePercentage > 80 ? "bg-yellow-500" : "bg-primary"
                      )}
                      style={{ width: `${usagePercentage}%` }}
                    />
                  </div>
                </div>

                <div className="flex justify-between">
                  <div>
                    <p className="text-[10px] uppercase text-gray-400">Disponível</p>
                    <p className="text-sm font-bold text-green-400">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(availableLimit)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="text-[10px] uppercase text-gray-400">Limite Total</p>
                    <p className="text-sm font-bold">
                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(card.limit)}
                    </p>
                  </div>
                </div>

                <div className="flex justify-between border-t border-white/10 pt-4">
                  <div className="flex items-center gap-2">
                    <Calendar className="h-3 w-3 text-gray-400" />
                    <div>
                      <p className="text-[8px] uppercase text-gray-400">Fechamento</p>
                      <p className="text-xs font-bold">Dia {card.closingDay}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 text-right">
                    <div>
                      <p className="text-[8px] uppercase text-gray-400">Vencimento</p>
                      <p className="text-xs font-bold">Dia {card.dueDay}</p>
                    </div>
                    <Info className="h-3 w-3 text-gray-400" />
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
      </div>

      <AnimatePresence>
        {selectedCardForInvoices && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl rounded-3xl bg-white p-8 shadow-2xl max-h-[90vh] overflow-hidden flex flex-col"
            >
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Histórico de Faturas</h3>
                  <p className="text-sm text-gray-500">{selectedCardForInvoices.name} - Detalhamento de Lançamentos</p>
                </div>
                <button 
                  onClick={() => setSelectedCardForInvoices(null)}
                  className="rounded-full p-2 hover:bg-gray-100 text-gray-400 transition-all"
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
                      <div className="flex flex-col items-center justify-center py-12 text-gray-400">
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
                      <div key={monthKey} className="rounded-2xl border border-gray-100 overflow-hidden">
                        <button 
                          onClick={() => setExpandedInvoice(isExpanded ? null : monthKey)}
                          className="w-full flex items-center justify-between p-4 bg-gray-50 hover:bg-gray-100 transition-all"
                        >
                          <div className="flex items-center gap-4">
                            <div className="h-10 w-10 rounded-xl bg-white flex flex-col items-center justify-center shadow-sm">
                              <span className="text-[10px] font-bold uppercase text-gray-400">{format(date, 'MMM', { locale: ptBR })}</span>
                              <span className="text-sm font-black text-gray-900">{format(date, 'yyyy')}</span>
                            </div>
                            <div className="text-left">
                              <p className="text-sm font-bold text-gray-900">Fatura de {format(date, 'MMMM', { locale: ptBR })}</p>
                              <p className="text-xs text-gray-500">{monthTransactions.length} lançamentos</p>
                            </div>
                          </div>
                          <div className="flex items-center gap-6">
                            <div className="text-right">
                              <p className="text-xs text-gray-400 uppercase font-bold">Total</p>
                              <p className="text-lg font-black text-primary">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(totalAmount)}
                              </p>
                            </div>
                            {isExpanded ? <ChevronUp className="h-5 w-5 text-gray-400" /> : <ChevronDown className="h-5 w-5 text-gray-400" />}
                          </div>
                        </button>

                        <AnimatePresence>
                          {isExpanded && (
                            <motion.div 
                              initial={{ height: 0 }}
                              animate={{ height: 'auto' }}
                              exit={{ height: 0 }}
                              className="overflow-hidden bg-white"
                            >
                              <div className="p-4 overflow-x-auto">
                                <table className="w-full text-left text-xs">
                                  <thead>
                                    <tr className="border-b border-gray-50 text-gray-400 uppercase font-bold tracking-wider">
                                      <th className="pb-3 pl-2">Data</th>
                                      <th className="pb-3">Descrição</th>
                                      <th className="pb-3">Parcela</th>
                                      <th className="pb-3">Status</th>
                                      <th className="pb-3 text-right pr-2">Valor</th>
                                    </tr>
                                  </thead>
                                  <tbody className="divide-y divide-gray-50">
                                    {monthTransactions.map(t => (
                                      <tr key={t.id} className="hover:bg-gray-50 transition-colors">
                                        <td className="py-3 pl-2 text-gray-500">{format(new Date(t.date), 'dd/MM/yyyy')}</td>
                                        <td className="py-3 font-bold text-gray-900">{t.description}</td>
                                        <td className="py-3">
                                          {t.installmentNumber ? (
                                            <span className="inline-flex items-center rounded-full bg-indigo-50 px-2 py-0.5 text-[10px] font-bold text-indigo-600">
                                              {t.installmentNumber}/{t.totalInstallments}
                                            </span>
                                          ) : (
                                            <span className="text-gray-400">-</span>
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
                                        <td className="py-3 text-right pr-2 font-black text-gray-900">
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
                  className="rounded-xl bg-gray-100 px-6 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200 transition-all"
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
              className="w-full max-w-3xl rounded-3xl bg-white p-8 shadow-2xl"
            >
              <div className="mb-6 flex items-center justify-between">
                <div>
                  <h3 className="text-xl font-bold text-gray-900">Comparativo de Faturas</h3>
                  <p className="text-sm text-gray-500">{comparingCard.name} - Atual vs Anterior</p>
                </div>
                <button 
                  onClick={() => setIsCompareModalOpen(false)}
                  className="rounded-full p-2 hover:bg-gray-100 text-gray-400 transition-all"
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
                  className="rounded-xl bg-gray-100 px-6 py-2 text-sm font-bold text-gray-600 hover:bg-gray-200 transition-all"
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
            className="w-full max-w-md rounded-2xl bg-white p-8 shadow-2xl"
          >
            <h3 className="text-xl font-bold text-gray-900">
              {editingCard ? 'Editar Cartão' : 'Novo Cartão de Crédito'}
            </h3>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700">Entidade Responsável</label>
                <select 
                  value={targetEntityId}
                  onChange={(e) => setTargetEntityId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                  required
                >
                  <option value="">Selecione a entidade...</option>
                  {entities.map(e => (
                    <option key={e.id} value={e.id}>{e.name} ({e.type})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700">Nome do Cartão</label>
                <input
                  type="text"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Ex: Nubank Platinum"
                  className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                  required
                />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Bandeira</label>
                  <input
                    type="text"
                    value={brand}
                    onChange={(e) => setBrand(e.target.value)}
                    placeholder="Visa, Master..."
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Limite</label>
                  <input
                    type="number"
                    value={limit}
                    onChange={(e) => setLimit(e.target.value)}
                    placeholder="0.00"
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Dia Vencimento</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={dueDay}
                    onChange={(e) => setDueDay(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Dia Fechamento</label>
                  <input
                    type="number"
                    min="1"
                    max="31"
                    value={closingDay}
                    onChange={(e) => setClosingDay(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="flex-1 rounded-lg border border-gray-200 py-2 text-sm font-semibold text-gray-600 hover:bg-gray-50"
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
