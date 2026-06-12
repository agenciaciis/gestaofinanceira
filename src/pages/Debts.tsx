import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, doc, updateDoc, deleteDoc, where } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Transaction } from '../types';
import { 
  AlertCircle, 
  Plus, 
  Trash2, 
  CheckCircle2, 
  Clock, 
  Calendar,
  DollarSign,
  ArrowUpRight,
  ArrowDownLeft,
  Search,
  Filter
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { format, isBefore, startOfDay } from 'date-fns';
import { CATEGORIES } from '../constants';
import { parseLocalDate } from '../lib/finance';

export const Debts: React.FC = () => {
  const { selectedEntity } = useEntity();
  const { showToast, confirm } = useUI();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [searchTerm, setSearchTerm] = useState('');
  const [filter, setFilter] = useState<'all' | 'pending' | 'overdue' | 'paid'>('pending');

  useEffect(() => {
    if (!selectedEntity) return;

    const q = query(
      collection(db, `entities/${selectedEntity.id}/transactions`),
      orderBy('date', 'desc')
    );

    const unsub = onSnapshot(q, (snapshot) => {
      const allTransactions = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Transaction[];
      // Filter for transactions that are pending
      setTransactions(allTransactions.filter(t => t.status === 'pending'));
      setLoading(false);
    }, (error) => {
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/transactions`);
    });

    return () => unsub();
  }, [selectedEntity]);

  const handleMarkAsPaid = async (transaction: Transaction) => {
    if (!selectedEntity) return;
    
    const confirmed = await confirm({
      title: 'Confirmar Pagamento',
      message: `Deseja marcar "${transaction.description}" como pago?`,
      variant: 'default'
    });
    
    if (!confirmed) return;

    try {
      await updateDoc(doc(db, `entities/${selectedEntity.id}/transactions/${transaction.id}`), {
        status: 'completed',
        paidAt: new Date().toISOString().split('T')[0],
        updatedAt: serverTimestamp()
      });
      showToast('Pagamento confirmado com sucesso!', 'success');
    } catch (error) {
      console.error("Error updating transaction:", error);
      showToast('Erro ao confirmar pagamento.', 'error');
    }
  };

  const handleDelete = async (transaction: Transaction) => {
    if (!selectedEntity) return;

    const confirmed = await confirm({
      title: 'Excluir Lançamento',
      message: 'Tem certeza que deseja excluir esta pendência?',
      variant: 'danger'
    });

    if (!confirmed) return;

    try {
      await deleteDoc(doc(db, `entities/${selectedEntity.id}/transactions/${transaction.id}`));
      showToast('Lançamento excluído com sucesso.', 'success');
    } catch (error) {
      console.error("Error deleting transaction:", error);
      showToast('Erro ao excluir lançamento.', 'error');
    }
  };

  const filteredDebts = transactions.filter(t => {
    const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase());
    const isOverdue = isBefore(parseLocalDate(t.date), startOfDay(new Date()));

    if (filter === 'overdue') return matchesSearch && isOverdue;
    // "Pendentes" mostra TODAS as pendências (inclusive as atrasadas).
    return matchesSearch;
  });

  const totalPending = filteredDebts.reduce((acc, t) => acc + (t.type === 'expense' ? t.amount : -t.amount), 0);

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="rounded-[2.5rem] bg-red-50 dark:bg-gradient-to-br dark:from-red-900 dark:to-rose-950 p-8 text-red-900 dark:text-white shadow-xl shadow-red-100 dark:shadow-none relative overflow-hidden border border-red-100 dark:border-red-900/30">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white dark:bg-white/10 backdrop-blur-md border border-red-200 dark:border-white/30 shadow-inner">
              <AlertCircle className="h-10 w-10 text-red-600 dark:text-white" />
            </div>
            <div>
              <h2 className="text-4xl font-black tracking-tighter">Contas a Pagar/Receber</h2>
              <p className="text-sm font-medium text-red-700 dark:text-white/80 mt-1">Gerencie suas pendências e evite atrasos.</p>
            </div>
          </div>
          <div className="text-right">
            <p className="text-xs font-bold uppercase tracking-widest text-red-400 dark:text-white/60 mb-1">Total Pendente</p>
            <p className="text-4xl font-black tracking-tighter">
              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Math.abs(totalPending))}
            </p>
          </div>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2 rounded-xl bg-gray-100 p-1">
          <button 
            onClick={() => setFilter('pending')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all",
              filter === 'pending' ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            Pendentes
          </button>
          <button 
            onClick={() => setFilter('overdue')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all",
              filter === 'overdue' ? "bg-white text-red-600 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            Atrasados
          </button>
          <button 
            onClick={() => setFilter('all')}
            className={cn(
              "px-4 py-2 text-xs font-bold rounded-lg transition-all",
              filter === 'all' ? "bg-white text-gray-900 shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            Todos
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
          <input 
            type="text"
            placeholder="Buscar pendência..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 py-2 text-sm outline-none focus:border-primary transition-all"
          />
        </div>
      </div>

      {/* List */}
      <div className="grid gap-4">
        {filteredDebts.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-20 text-center bg-white rounded-3xl border border-dashed border-gray-200">
            <CheckCircle2 className="h-12 w-12 text-emerald-500 mb-4" />
            <h3 className="text-lg font-bold text-gray-900">Tudo em dia!</h3>
            <p className="text-sm text-gray-500">Não há pendências para os filtros selecionados.</p>
          </div>
        ) : (
          filteredDebts.map(debt => {
            const isOverdue = isBefore(parseLocalDate(debt.date), startOfDay(new Date()));
            return (
              <motion.div 
                layout
                key={debt.id}
                className={cn(
                  "group relative rounded-2xl bg-white p-5 shadow-sm border transition-all hover:shadow-md",
                  isOverdue ? "border-red-100 bg-red-50/30" : "border-gray-100"
                )}
              >
                <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-4">
                    <div className={cn(
                      "flex h-12 w-12 items-center justify-center rounded-xl",
                      debt.type === 'income' ? "bg-emerald-100 text-emerald-600" : "bg-red-100 text-red-600"
                    )}>
                      {debt.type === 'income' ? <ArrowDownLeft className="h-6 w-6" /> : <ArrowUpRight className="h-6 w-6" />}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900">{debt.description}</h3>
                      <div className="flex items-center gap-3 mt-1">
                        <span className="text-xs font-medium text-gray-400 flex items-center gap-1">
                          <Calendar className="h-3 w-3" />
                          Vencimento: {format(parseLocalDate(debt.date), 'dd/MM/yyyy')}
                        </span>
                        {isOverdue && (
                          <span className="text-[10px] font-black uppercase tracking-widest text-red-600 bg-red-100 px-2 py-0.5 rounded-full">
                            Atrasado
                          </span>
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-6">
                    <div className="text-right">
                      <p className={cn(
                        "text-lg font-black",
                        debt.type === 'income' ? "text-emerald-600" : "text-red-600"
                      )}>
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(debt.amount)}
                      </p>
                      <p className="text-[10px] font-bold text-gray-400 uppercase tracking-widest">
                        {CATEGORIES.find(c => c.id === debt.categoryId)?.name || 'Outros'}
                      </p>
                    </div>

                    <div className="flex items-center gap-2 border-l pl-6">
                      <button 
                        onClick={() => handleMarkAsPaid(debt)}
                        className="rounded-xl bg-emerald-500 p-2.5 text-white hover:bg-emerald-600 transition-all shadow-lg shadow-emerald-500/20"
                        title="Marcar como Pago"
                      >
                        <CheckCircle2 className="h-5 w-5" />
                      </button>
                      <button 
                        onClick={() => handleDelete(debt)}
                        className="rounded-xl bg-gray-50 p-2.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"
                      >
                        <Trash2 className="h-5 w-5" />
                      </button>
                    </div>
                  </div>
                </div>
              </motion.div>
            );
          })
        )}
      </div>
    </div>
  );
};
