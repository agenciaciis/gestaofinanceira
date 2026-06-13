import React, { useState, useEffect, useRef } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, limit, where, writeBatch, doc, updateDoc, deleteDoc, getDocs } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Transaction, BankAccount, CreditCard, Client } from '../types';
import { Plus, ArrowUpCircle, ArrowDownCircle, Search, Filter, Calendar, Tag, Wallet, CreditCard as CardIcon, ArrowRightLeft, Repeat, Download, CheckCircle2, Clock, AlertCircle, ChevronLeft, ChevronRight, Edit2, Trash2, Upload } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { addMonths, format } from 'date-fns';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { GoogleGenAI } from "@google/genai";
import { Sparkles, Loader2 } from 'lucide-react';

import { CATEGORIES, MONTHS } from '../constants';
import { ImportTransactionsModal } from '../components/ImportTransactionsModal';
import { splitInstallments, parseLocalDate } from '../lib/finance';
import { planRecurringRenewals } from '../lib/recurring';

const PAYMENT_TYPES: { id: NonNullable<Transaction['paymentType']>; label: string }[] = [
  { id: 'pix', label: 'PIX' },
  { id: 'boleto', label: 'Boleto' },
  { id: 'dinheiro', label: 'Dinheiro' },
  { id: 'transferencia', label: 'Transferência' },
  { id: 'debito', label: 'Débito' },
  { id: 'credito', label: 'Crédito' },
  { id: 'outro', label: 'Outro' },
];

export const Transactions: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { showToast, confirm } = useUI();
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [cards, setCards] = useState<CreditCard[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [type, setType] = useState<'income' | 'expense' | 'transfer'>('expense');
  const [date, setDate] = useState(new Date().toISOString().split('T')[0]);
  const [categoryId, setCategoryId] = useState('outros');
  const [targetEntityId, setTargetEntityId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'account' | 'card'>('account');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [cardId, setCardId] = useState('');
  const [paymentType, setPaymentType] = useState<'' | NonNullable<Transaction['paymentType']>>('');
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState<Client[]>([]);

  // Installment state
  const [isInstallment, setIsInstallment] = useState(false);
  const [totalInstallments, setTotalInstallments] = useState('1');
  // Recurring state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringPeriod, setRecurringPeriod] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'overdue'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isAiLoading, setIsAiLoading] = useState(false);

  const suggestCategory = async () => {
    if (!description) return;
    setIsAiLoading(true);
    try {
      const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY! });

      const prompt = `Analise a descrição de uma transação financeira e sugira a categoria mais adequada entre as seguintes opções: ${CATEGORIES.map(c => c.name).join(', ')}. 
      Descrição: "${description}"
      Tipo: ${type === 'income' ? 'Receita' : 'Despesa'}
      Responda APENAS o nome da categoria sugerida.`;

      const response = await ai.models.generateContent({
        model: "gemini-3-flash-preview",
        contents: prompt,
      });

      const text = response.text?.trim();
      if (!text) return;

      const category = CATEGORIES.find(c => c.name.toLowerCase() === text.toLowerCase());
      if (category) {
        setCategoryId(category.id);
      }
    } catch (error) {
      console.error("Error suggesting category:", error);
    } finally {
      setIsAiLoading(false);
    }
  };

  const toggleStatus = async (transaction: Transaction) => {
    try {
      const completing = transaction.status !== 'completed';
      const newStatus = completing ? 'completed' : 'pending';
      await updateDoc(doc(db, `entities/${transaction.entityId}/transactions/${transaction.id}`), {
        status: newStatus,
        paidAt: completing ? new Date().toISOString().split('T')[0] : null,
        updatedAt: serverTimestamp(),
      });
      const verb = transaction.type === 'income' ? (completing ? 'Recebido' : 'A receber') : (completing ? 'Pago' : 'Pendente');
      showToast(`${transaction.description}: ${verb}. ${completing ? 'Toque no selo verde para desfazer.' : ''}`.trim(), 'success');
    } catch (error) {
      console.error("Error updating status:", error);
      showToast('Erro ao atualizar status.', 'error');
    }
  };

  // Rótulo do botão de ação rápida conforme tipo e estado.
  const quickActionLabel = (t: Transaction) => {
    if (t.type === 'income') return t.status === 'completed' ? 'Recebido' : 'Receber';
    if (t.type === 'expense') return t.status === 'completed' ? 'Pago' : 'Pagar';
    return 'Concluído';
  };

  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase());
    const isOverdue = t.status === 'pending' && new Date(t.date) < new Date(new Date().setHours(0,0,0,0));
    
    const tDate = new Date(t.date);
    const matchesDate = tDate.getMonth() === selectedMonth && tDate.getFullYear() === selectedYear;

    if (!matchesDate) return false;
    
    if (statusFilter === 'all') return matchesSearch;
    if (statusFilter === 'pending') return matchesSearch && t.status === 'pending' && !isOverdue;
    if (statusFilter === 'completed') return matchesSearch && t.status === 'completed';
    if (statusFilter === 'overdue') return matchesSearch && isOverdue;
    return matchesSearch;
  });

  const summary = filteredTransactions.reduce((acc, t) => {
    const isOverdue = t.status === 'pending' && new Date(t.date) < new Date(new Date().setHours(0,0,0,0));
    
    if (t.type === 'income') {
      if (t.status === 'completed') acc.received += t.amount;
      else acc.toReceive += t.amount;
    } else if (t.type === 'expense') {
      if (t.status === 'completed') acc.paid += t.amount;
      else acc.toPay += t.amount;
    }
    
    if (isOverdue) acc.overdue += t.amount;
    
    return acc;
  }, { received: 0, paid: 0, toReceive: 0, toPay: 0, overdue: 0 });

  const changeMonth = (delta: number) => {
    let newMonth = selectedMonth + delta;
    let newYear = selectedYear;

    if (newMonth > 11) {
      newMonth = 0;
      newYear++;
    } else if (newMonth < 0) {
      newMonth = 11;
      newYear--;
    }

    setSelectedMonth(newMonth);
    setSelectedYear(newYear);
  };

  const handleEdit = (t: Transaction) => {
    setEditingTransaction(t);
    setDescription(t.description);
    setAmount(t.amount.toString());
    setType(t.type);
    setDate(t.date);
    setCategoryId(t.categoryId);
    setTargetEntityId(t.entityId);
    if (t.cardId) {
      setPaymentMethod('card');
      setCardId(t.cardId);
    } else {
      setPaymentMethod('account');
      setAccountId(t.accountId || '');
    }
    setToAccountId(t.toAccountId || '');
    setPaymentType(t.paymentType || '');
    setClientId(t.clientId || '');
    setIsInstallment(!!t.installmentGroupId);
    setTotalInstallments(t.totalInstallments?.toString() || '1');
    setIsRecurring(!!t.isRecurring);
    setRecurringPeriod(t.recurringPeriod || 'monthly');
    setIsModalOpen(true);
  };

  const handleDelete = async (t: Transaction) => {
    const groupId = t.recurringGroupId || t.installmentGroupId;
    
    if (groupId) {
      const choice = await confirm({
        title: 'Excluir Grupo',
        message: 'Este lançamento faz parte de um grupo (recorrente ou parcelado). Deseja excluir TODOS os lançamentos futuros deste grupo?',
        confirmLabel: 'Excluir Todos Futuros',
        cancelLabel: 'Apenas Este',
        variant: 'danger'
      });
      
      try {
        if (choice) {
          const q = query(
            collection(db, `entities/${t.entityId}/transactions`), 
            where(t.recurringGroupId ? 'recurringGroupId' : 'installmentGroupId', '==', groupId)
          );
          const snapshot = await getDocs(q);
          const batch = writeBatch(db);
          
          snapshot.docs.forEach(docSnap => {
            const docData = docSnap.data();
            if (new Date(docData.date) >= new Date(t.date)) {
              batch.delete(docSnap.ref);
            }
          });
          
          await batch.commit();
          showToast('Lançamentos futuros excluídos com sucesso.', 'success');
        } else {
          const confirmSingle = await confirm({
            title: 'Excluir Lançamento',
            message: 'Confirmar exclusão apenas deste lançamento?',
            variant: 'danger'
          });
          if (confirmSingle) {
            await deleteDoc(doc(db, `entities/${t.entityId}/transactions/${t.id}`));
            showToast('Lançamento excluído com sucesso.', 'success');
          }
        }
      } catch (error) {
        console.error("Error deleting group transactions:", error);
        showToast('Erro ao excluir lançamentos.', 'error');
      }
      return;
    }

    const confirmDelete = await confirm({
      title: 'Excluir Lançamento',
      message: 'Tem certeza que deseja excluir este lançamento?',
      variant: 'danger'
    });
    if (!confirmDelete) return;
    try {
      await deleteDoc(doc(db, `entities/${t.entityId}/transactions/${t.id}`));
      showToast('Lançamento excluído com sucesso.', 'success');
    } catch (error) {
      console.error("Error deleting transaction:", error);
      showToast('Erro ao excluir lançamento.', 'error');
    }
  };

  const exportToExcel = () => {
    const data = transactions.map(t => ({
      Data: new Date(t.date).toLocaleDateString(),
      Descrição: t.description,
      Tipo: t.type === 'income' ? 'Receita' : t.type === 'expense' ? 'Despesa' : 'Transferência',
      Categoria: CATEGORIES.find(c => c.id === t.categoryId)?.name || 'Outros',
      Entidade: entities.find(e => e.id === t.entityId)?.name,
      Valor: t.amount,
      Parcela: t.installmentNumber ? `${t.installmentNumber}/${t.totalInstallments}` : '-'
    }));

    const ws = XLSX.utils.json_to_sheet(data);
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, ws, "Transações");
    XLSX.writeFile(wb, `transacoes_${format(new Date(), 'yyyy-MM-dd')}.xlsx`);
    setShowExportMenu(false);
  };

  const exportToCSV = () => {
    const data = transactions.map(t => ({
      Data: new Date(t.date).toLocaleDateString(),
      Descrição: t.description,
      Tipo: t.type === 'income' ? 'Receita' : t.type === 'expense' ? 'Despesa' : 'Transferência',
      Categoria: CATEGORIES.find(c => c.id === t.categoryId)?.name || 'Outros',
      Entidade: entities.find(e => e.id === t.entityId)?.name,
      Valor: t.amount,
      Parcela: t.installmentNumber ? `${t.installmentNumber}/${t.totalInstallments}` : '-'
    }));

    const csv = Papa.unparse(data);
    const blob = new Blob([csv], { type: 'text/csv;charset=utf-8;' });
    const link = document.createElement("a");
    const url = URL.createObjectURL(blob);
    link.setAttribute("href", url);
    link.setAttribute("download", `transacoes_${format(new Date(), 'yyyy-MM-dd')}.csv`);
    link.style.visibility = 'hidden';
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    setShowExportMenu(false);
  };

  useEffect(() => {
    if (entities.length === 0) return;

    const filteredEntities = filterType === 'ALL' 
      ? entities 
      : entities.filter(e => e.type === filterType);

    const unsubscribes: (() => void)[] = [];
    let allTransactions: Transaction[] = [];
    let allAccounts: BankAccount[] = [];
    let allCards: CreditCard[] = [];
    let allClients: Client[] = [];

    filteredEntities.forEach(entity => {
      // Clients (para vincular receitas a um cliente)
      const clQ = query(collection(db, `entities/${entity.id}/clients`));
      const unsubCl = onSnapshot(clQ, (snapshot) => {
        const entityCl = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Client[];
        allClients = [...allClients.filter(c => c.entityId !== entity.id), ...entityCl];
        setClients([...allClients]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/clients`));
      unsubscribes.push(unsubCl);

      // Transactions
      const tQ = query(collection(db, `entities/${entity.id}/transactions`), orderBy('date', 'desc'));
      const unsubT = onSnapshot(tQ, (snapshot) => {
        const entityT = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Transaction[];
        allTransactions = [...allTransactions.filter(t => t.entityId !== entity.id), ...entityT]
          .sort((a, b) => new Date(b.date).getTime() - new Date(a.date).getTime());
        setTransactions([...allTransactions]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/transactions`));
      unsubscribes.push(unsubT);

      // Accounts
      const aQ = query(collection(db, `entities/${entity.id}/bank_accounts`));
      const unsubA = onSnapshot(aQ, (snapshot) => {
        const entityA = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BankAccount[];
        allAccounts = [...allAccounts.filter(a => a.entityId !== entity.id), ...entityA];
        setAccounts([...allAccounts]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/bank_accounts`));
      unsubscribes.push(unsubA);

      // Cards
      const cQ = query(collection(db, `entities/${entity.id}/credit_cards`));
      const unsubC = onSnapshot(cQ, (snapshot) => {
        const entityC = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as CreditCard[];
        allCards = [...allCards.filter(c => c.entityId !== entity.id), ...entityC];
        setCards([...allCards]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/credit_cards`));
      unsubscribes.push(unsubC);
    });

    setLoading(false);
    return () => unsubscribes.forEach(unsub => unsub());
  }, [entities, filterType]);

  // Renovação automática de recorrências: mantém ~12 meses de ocorrências futuras
  // para lançamentos fixos (aluguel etc.), sem que o usuário precise recadastrar.
  const renewingRef = useRef(false);
  useEffect(() => {
    if (transactions.length === 0 || renewingRef.current) return;
    const plan = planRecurringRenewals(transactions, new Date(), 12);
    if (plan.length === 0) return;

    renewingRef.current = true;
    (async () => {
      try {
        const batch = writeBatch(db);
        let count = 0;
        for (const item of plan) {
          const tmpl = item.template;
          const ent = entities.find(e => e.id === tmpl.entityId);
          for (const d of item.dates) {
            if (count >= 400) break; // limite seguro do batch
            const ref = doc(collection(db, `entities/${tmpl.entityId}/transactions`));
            batch.set(ref, {
              description: tmpl.description,
              amount: tmpl.amount,
              type: tmpl.type,
              date: d,
              categoryId: tmpl.categoryId,
              accountId: tmpl.accountId ?? null,
              cardId: tmpl.cardId ?? null,
              paymentType: tmpl.paymentType ?? null,
              clientId: tmpl.clientId ?? null,
              clientName: tmpl.clientName ?? null,
              status: 'pending',
              entityId: tmpl.entityId,
              ownerUid: ent?.ownerUid,
              collaboratorsEmails: ent?.collaboratorsEmails || [],
              isRecurring: true,
              recurringPeriod: tmpl.recurringPeriod,
              recurringGroupId: tmpl.recurringGroupId,
              createdAt: serverTimestamp(),
            });
            count++;
          }
        }
        if (count > 0) await batch.commit();
      } catch (e) {
        console.error('Erro ao renovar recorrências:', e);
      } finally {
        renewingRef.current = false;
      }
    })();
  }, [transactions, entities]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEntityId) return;

    try {
      if (editingTransaction) {
        const groupId = editingTransaction.recurringGroupId || editingTransaction.installmentGroupId;
        
        if (groupId) {
          const updateAll = await confirm({
            title: 'Atualizar Grupo',
            message: 'Deseja aplicar estas alterações a TODOS os lançamentos futuros deste grupo?',
            confirmLabel: 'Atualizar Todos Futuros',
            cancelLabel: 'Apenas Este'
          });
          
          if (updateAll) {
            const q = query(
              collection(db, `entities/${targetEntityId}/transactions`),
              where(editingTransaction.recurringGroupId ? 'recurringGroupId' : 'installmentGroupId', '==', groupId)
            );
            const snapshot = await getDocs(q);
            const batch = writeBatch(db);
            
            snapshot.docs.forEach(docSnap => {
              const docData = docSnap.data();
              if (parseLocalDate(docData.date) >= parseLocalDate(editingTransaction.date)) {
                // Preserva a numeração (i/N) das parcelas na descrição do grupo.
                const desc = docData.installmentNumber
                  ? `${description} (${docData.installmentNumber}/${docData.totalInstallments})`
                  : description;
                batch.update(docSnap.ref, {
                  description: desc,
                  amount: Number(amount),
                  type,
                  categoryId,
                  accountId: paymentMethod === 'account' ? accountId : null,
                  cardId: paymentMethod === 'card' ? cardId : null,
                  toAccountId: type === 'transfer' ? toAccountId : null,
                  paymentType: paymentType || null,
                  clientId: clientId || null,
                  clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
                });
              }
            });
            
            await batch.commit();
            setIsModalOpen(false);
            resetForm();
            return;
          }
        }

        await updateDoc(doc(db, `entities/${targetEntityId}/transactions/${editingTransaction.id}`), {
          description,
          amount: Number(amount),
          type,
          date,
          categoryId,
          accountId: paymentMethod === 'account' ? accountId : null,
          cardId: paymentMethod === 'card' ? cardId : null,
          toAccountId: type === 'transfer' ? toAccountId : null,
          paymentType: paymentType || null,
          clientId: clientId || null,
          clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
          isRecurring,
          recurringPeriod: isRecurring ? recurringPeriod : null,
        });
      } else if (type === 'transfer') {
        // Create transfer record
        await addDoc(collection(db, `entities/${targetEntityId}/transactions`), {
          description: `Transferência: ${description || 'Sem descrição'}`,
          amount: Number(amount),
          type: 'transfer',
          date,
          categoryId: 'transferencia',
          accountId,
          toAccountId,
          paymentType: paymentType || 'transferencia',
          status: 'completed',
          entityId: targetEntityId,
          ownerUid: entities.find(e => e.id === targetEntityId)?.ownerUid,
          collaboratorsEmails: entities.find(e => e.id === targetEntityId)?.collaboratorsEmails || [],
          createdAt: serverTimestamp(),
        });
      } else if (isInstallment && Number(totalInstallments) > 1) {
        const batch = writeBatch(db);
        const installmentGroupId = crypto.randomUUID();
        const numInstallments = Number(totalInstallments);
        // Parcelas com centavos ajustados: a soma fecha exatamente o total.
        const parcels = splitInstallments(Number(amount), numInstallments);
        const baseDate = parseLocalDate(date);

        for (let i = 1; i <= numInstallments; i++) {
          const installmentDate = format(addMonths(baseDate, i - 1), 'yyyy-MM-dd');
          const docRef = doc(collection(db, `entities/${targetEntityId}/transactions`));
          batch.set(docRef, {
            description: `${description} (${i}/${numInstallments})`,
            amount: parcels[i - 1],
            type,
            date: installmentDate,
            categoryId,
            accountId: paymentMethod === 'account' ? accountId : null,
            cardId: paymentMethod === 'card' ? cardId : null,
            paymentType: paymentType || null,
            clientId: clientId || null,
            clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
            status: i === 1 ? 'completed' : 'pending',
            entityId: targetEntityId,
            ownerUid: entities.find(e => e.id === targetEntityId)?.ownerUid,
            collaboratorsEmails: entities.find(e => e.id === targetEntityId)?.collaboratorsEmails || [],
            installmentNumber: i,
            totalInstallments: numInstallments,
            installmentGroupId,
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } else if (isRecurring) {
        const batch = writeBatch(db);
        const recurringGroupId = crypto.randomUUID();
        const baseDate = parseLocalDate(date);

        // Cria 12 ocorrências iniciais; a renovação automática mantém o horizonte depois.
        for (let i = 0; i < 12; i++) {
          let nextDate: Date;
          if (recurringPeriod === 'monthly') nextDate = addMonths(baseDate, i);
          else if (recurringPeriod === 'weekly') {
            nextDate = new Date(baseDate);
            nextDate.setDate(baseDate.getDate() + (i * 7));
          } else {
            nextDate = new Date(baseDate);
            nextDate.setFullYear(baseDate.getFullYear() + i);
          }

          const docRef = doc(collection(db, `entities/${targetEntityId}/transactions`));
          batch.set(docRef, {
            description,
            amount: Number(amount),
            type,
            date: format(nextDate, 'yyyy-MM-dd'),
            categoryId,
            accountId: paymentMethod === 'account' ? accountId : null,
            cardId: paymentMethod === 'card' ? cardId : null,
            paymentType: paymentType || null,
            clientId: clientId || null,
            clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
            status: i === 0 ? 'completed' : 'pending',
            entityId: targetEntityId,
            ownerUid: entities.find(e => e.id === targetEntityId)?.ownerUid,
            collaboratorsEmails: entities.find(e => e.id === targetEntityId)?.collaboratorsEmails || [],
            isRecurring: true,
            recurringPeriod,
            recurringGroupId,
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      } else {
        await addDoc(collection(db, `entities/${targetEntityId}/transactions`), {
          description,
          amount: Number(amount),
          type,
          date,
          categoryId,
          accountId: paymentMethod === 'account' ? accountId : null,
          cardId: paymentMethod === 'card' ? cardId : null,
          paymentType: paymentType || null,
          clientId: clientId || null,
          clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
          status: 'completed',
          entityId: targetEntityId,
          ownerUid: entities.find(e => e.id === targetEntityId)?.ownerUid,
          collaboratorsEmails: entities.find(e => e.id === targetEntityId)?.collaboratorsEmails || [],
          createdAt: serverTimestamp(),
        });
      }
      
      setIsModalOpen(false);
      resetForm();
      showToast('Lançamento salvo com sucesso!', 'success');
    } catch (error) {
      console.error("Error saving transaction:", error);
      showToast('Erro ao salvar lançamento.', 'error');
    }
  };

  const resetForm = () => {
    setEditingTransaction(null);
    setDescription('');
    setAmount('');
    setDate(new Date().toISOString().split('T')[0]);
    setTargetEntityId('');
    setAccountId('');
    setToAccountId('');
    setCardId('');
    setPaymentMethod('account');
    setPaymentType('');
    setClientId('');
    setIsInstallment(false);
    setTotalInstallments('1');
    setType('expense');
    setIsRecurring(false);
    setRecurringPeriod('monthly');
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Lançamentos</h2>
          <p className="text-sm text-gray-500">Histórico completo de receitas, despesas e transferências.</p>
        </div>
        <div className="flex gap-3">
          <button 
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 shadow-sm hover:bg-gray-50"
          >
            <Upload className="h-4 w-4" />
            Importar
          </button>
          <div className="relative">
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 rounded-lg border border-gray-200 bg-white px-4 py-2 text-sm font-semibold text-gray-600 shadow-sm hover:bg-gray-50"
            >
              <Download className="h-4 w-4" />
              Exportar
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-gray-100 bg-white p-2 shadow-lg z-20">
                <button 
                  onClick={exportToExcel}
                  className="w-full rounded-lg px-4 py-2 text-left text-sm hover:bg-gray-50"
                >
                  Excel (.xlsx)
                </button>
                <button 
                  onClick={exportToCSV}
                  className="w-full rounded-lg px-4 py-2 text-left text-sm hover:bg-gray-50"
                >
                  CSV (.csv)
                </button>
              </div>
            )}
          </div>
          <button 
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Novo Lançamento
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Recebido</p>
          <p className="mt-1 text-lg font-bold text-green-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.received)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Pago</p>
          <p className="mt-1 text-lg font-bold text-red-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.paid)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">A Receber</p>
          <p className="mt-1 text-lg font-bold text-blue-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.toReceive)}
          </p>
        </div>
        <div className="rounded-xl border border-gray-100 bg-white p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">A Pagar</p>
          <p className="mt-1 text-lg font-bold text-orange-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.toPay)}
          </p>
        </div>
        <div className="rounded-xl border border-red-100 bg-red-50 p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-red-400">Atrasado</p>
          <p className="mt-1 text-lg font-bold text-red-700">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.overdue)}
          </p>
        </div>
      </div>

      {/* Filters & Search */}
      <div className="flex flex-wrap items-center gap-4">
        {/* Month Selector */}
        <div className="flex items-center gap-2 rounded-xl border border-gray-100 bg-white p-1 shadow-sm">
          <button 
            onClick={() => changeMonth(-1)}
            className="rounded-lg p-2 hover:bg-gray-50 text-gray-400 hover:text-primary transition-all"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 px-2 min-w-[140px] justify-center">
            <Calendar className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold text-gray-700 capitalize">
              {MONTHS[selectedMonth]} {selectedYear}
            </span>
          </div>
          <button 
            onClick={() => changeMonth(1)}
            className="rounded-lg p-2 hover:bg-gray-50 text-gray-400 hover:text-primary transition-all"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-gray-400" />
          <input 
            type="text" 
            placeholder="Buscar lançamentos..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-gray-200 pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex rounded-lg border border-gray-200 bg-white p-1">
          {[
            { id: 'all', label: 'Todos' },
            { id: 'completed', label: 'Pagos' },
            { id: 'pending', label: 'Pendentes' },
            { id: 'overdue', label: 'Atrasados' },
          ].map((f) => (
            <button
              key={f.id}
              onClick={() => setStatusFilter(f.id as any)}
              className={cn(
                "rounded-md px-3 py-1 text-xs font-bold transition-all",
                statusFilter === f.id ? "bg-primary text-white" : "text-gray-500 hover:bg-gray-50"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transactions Table */}
      <div className="overflow-hidden rounded-2xl border border-gray-100 bg-white shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-gray-50 text-xs font-bold uppercase tracking-wider text-gray-500">
              <tr>
                <th className="px-6 py-4">Data</th>
                <th className="px-6 py-4">Descrição</th>
                <th className="px-6 py-4">Entidade</th>
                <th className="px-6 py-4">Pagamento / Origem</th>
                <th className="px-6 py-4">Status</th>
                <th className="px-6 py-4 text-right">Valor</th>
                <th className="px-6 py-4 text-right">Ações</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {filteredTransactions.map((t) => {
                const isOverdue = t.status === 'pending' && new Date(t.date) < new Date(new Date().setHours(0,0,0,0));
                return (
                  <tr key={t.id} className="hover:bg-gray-50 transition-colors group">
                    <td className="whitespace-nowrap px-6 py-4 text-gray-600">
                      {new Date(t.date).toLocaleDateString()}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex h-8 w-8 items-center justify-center rounded-full",
                          t.type === 'income' ? "bg-green-100 text-green-600" : 
                          t.type === 'expense' ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
                        )}>
                          {t.type === 'income' ? <ArrowUpCircle className="h-4 w-4" /> : 
                           t.type === 'expense' ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowRightLeft className="h-4 w-4" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-gray-900">{t.description}</span>
                            {t.installmentNumber && (
                              <span className="text-[10px] text-gray-400">({t.installmentNumber}/{t.totalInstallments})</span>
                            )}
                            {t.isRecurring && (
                              <Repeat className="h-3 w-3 text-primary" />
                            )}
                          </div>
                          <span className="text-[10px] text-gray-400 uppercase tracking-wider">
                            {CATEGORIES.find(c => c.id === t.categoryId)?.name || 'Outros'}
                          </span>
                        </div>
                      </div>
                    </td>
                    <td className="px-6 py-4">
                      <span className={cn(
                        "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase",
                        entities.find(e => e.id === t.entityId)?.type === 'PF' ? "bg-blue-100 text-blue-700" : "bg-purple-100 text-purple-700"
                      )}>
                        {entities.find(e => e.id === t.entityId)?.name}
                      </span>
                    </td>
                    <td className="px-6 py-4 text-gray-500">
                      {t.type === 'transfer' ? (
                        <div className="flex items-center gap-2">
                          <span className="text-xs">{accounts.find(a => a.id === t.accountId)?.bankName}</span>
                          <ArrowRightLeft className="h-3 w-3" />
                          <span className="text-xs">{accounts.find(a => a.id === t.toAccountId)?.bankName}</span>
                        </div>
                      ) : t.cardId ? (
                        <div className="flex items-center gap-1">
                          <CardIcon className="h-3 w-3" />
                          <span className="text-xs">{cards.find(c => c.id === t.cardId)?.name}</span>
                        </div>
                      ) : t.accountId ? (
                        <div className="flex items-center gap-1">
                          <Wallet className="h-3 w-3" />
                          <span className="text-xs">{accounts.find(a => a.id === t.accountId)?.bankName}</span>
                        </div>
                      ) : '-'}
                    </td>
                    <td className="px-6 py-4">
                      {t.status === 'completed' ? (
                        // Selo discreto — clique para desfazer (volta a pendente)
                        <button
                          onClick={() => toggleStatus(t)}
                          title="Clique para desfazer"
                          className="group/chip flex items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold uppercase text-green-700 transition-all hover:bg-green-200"
                        >
                          <CheckCircle2 className="h-3 w-3" />
                          {quickActionLabel(t)}
                        </button>
                      ) : t.type === 'transfer' ? (
                        <span className="flex items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase text-blue-700">
                          <CheckCircle2 className="h-3 w-3" /> Concluído
                        </span>
                      ) : (
                        // Botão de AÇÃO RÁPIDA — um clique marca como pago/recebido
                        <div className="flex items-center gap-2">
                          <button
                            onClick={() => toggleStatus(t)}
                            className={cn(
                              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:shadow-md active:scale-95",
                              t.type === 'income' ? "bg-emerald-500 hover:bg-emerald-600" : "bg-emerald-500 hover:bg-emerald-600"
                            )}
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" />
                            {quickActionLabel(t)}
                          </button>
                          {isOverdue && (
                            <span className="flex items-center gap-1 rounded-full bg-red-100 px-2 py-0.5 text-[9px] font-bold uppercase text-red-600">
                              <AlertCircle className="h-2.5 w-2.5" /> Atrasado
                            </span>
                          )}
                        </div>
                      )}
                    </td>
                    <td className={cn(
                      "px-6 py-4 text-right font-bold",
                      t.type === 'income' ? "text-green-600" : 
                      t.type === 'expense' ? "text-red-600" : "text-blue-600"
                    )}>
                      {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''} {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.amount)}
                    </td>
                    <td className="px-6 py-4 text-right">
                      <div className="flex justify-end gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                        <button 
                          onClick={() => handleEdit(t)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-gray-100 hover:text-primary transition-all"
                        >
                          <Edit2 className="h-4 w-4" />
                        </button>
                        <button 
                          onClick={() => handleDelete(t)}
                          className="rounded-lg p-1.5 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-all"
                        >
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-lg rounded-2xl bg-white p-8 shadow-2xl overflow-y-auto max-h-[90vh]"
          >
            <h3 className="text-xl font-bold text-gray-900">
              {editingTransaction ? 'Editar Lançamento' : 'Novo Lançamento'}
            </h3>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => { setType('income'); setIsInstallment(false); }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-xs font-bold transition-all",
                    type === 'income' ? "border-green-500 bg-green-50 text-green-600" : "border-gray-200 text-gray-500"
                  )}
                >
                  <ArrowUpCircle className="h-4 w-4" /> Receita
                </button>
                <button
                  type="button"
                  onClick={() => setType('expense')}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-xs font-bold transition-all",
                    type === 'expense' ? "border-red-500 bg-red-50 text-red-600" : "border-gray-200 text-gray-500"
                  )}
                >
                  <ArrowDownCircle className="h-4 w-4" /> Despesa
                </button>
                <button
                  type="button"
                  onClick={() => { setType('transfer'); setIsInstallment(false); }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-xs font-bold transition-all",
                    type === 'transfer' ? "border-blue-500 bg-blue-50 text-blue-600" : "border-gray-200 text-gray-500"
                  )}
                >
                  <ArrowRightLeft className="h-4 w-4" /> Transf.
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-gray-700">Entidade</label>
                  <select 
                    value={targetEntityId}
                    onChange={(e) => setTargetEntityId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  >
                    <option value="">Selecione...</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Data</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-gray-700">Descrição</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Ex: Aluguel, Supermercado"
                      className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 pr-10 outline-none focus:ring-2 focus:ring-primary/20"
                      required
                    />
                    <button
                      type="button"
                      onClick={suggestCategory}
                      disabled={!description || isAiLoading}
                      className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md p-1 text-primary hover:bg-primary/10 disabled:opacity-50 transition-all"
                      title="Sugerir categoria com IA"
                    >
                      {isAiLoading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                    </button>
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-medium text-gray-700">Categoria</label>
                  <select 
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  >
                    {CATEGORIES.filter(c => type === 'transfer' ? c.id === 'transferencia' : (type === 'income' ? c.type === 'income' : !c.type)).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700">Valor Total</label>
                <div className="relative mt-1">
                  <span className="absolute left-4 top-2 text-gray-500">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-lg border border-gray-300 pl-10 pr-4 py-2 font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                    required
                  />
                </div>
              </div>

              {type === 'transfer' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Origem</label>
                    <select 
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                      required
                    >
                      <option value="">Selecione...</option>
                      {accounts.filter(a => a.entityId === targetEntityId).map(a => (
                        <option key={a.id} value={a.id}>{a.bankName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Destino</label>
                    <select 
                      value={toAccountId}
                      onChange={(e) => setToAccountId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                      required
                    >
                      <option value="">Selecione...</option>
                      {accounts.filter(a => a.entityId === targetEntityId && a.id !== accountId).map(a => (
                        <option key={a.id} value={a.id}>{a.bankName}</option>
                      ))}
                    </select>
                  </div>
                </div>
              ) : (
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Forma de Pagamento</label>
                    <div className="mt-2 flex gap-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="radio" 
                          checked={paymentMethod === 'account'} 
                          onChange={() => setPaymentMethod('account')}
                          className="text-primary"
                        />
                        <span className="text-sm">Conta Bancária</span>
                      </label>
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input 
                          type="radio" 
                          checked={paymentMethod === 'card'} 
                          onChange={() => setPaymentMethod('card')}
                          className="text-primary"
                        />
                        <span className="text-sm">Cartão de Crédito</span>
                      </label>
                    </div>

                    <div className="mt-3">
                      {paymentMethod === 'account' ? (
                        <select 
                          value={accountId}
                          onChange={(e) => setAccountId(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                          required={paymentMethod === 'account'}
                        >
                          <option value="">Selecione a conta...</option>
                          {accounts.filter(a => a.entityId === targetEntityId).map(a => (
                            <option key={a.id} value={a.id}>{a.bankName}</option>
                          ))}
                        </select>
                      ) : (
                        <select 
                          value={cardId}
                          onChange={(e) => setCardId(e.target.value)}
                          className="w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                          required={paymentMethod === 'card'}
                        >
                          <option value="">Selecione o cartão...</option>
                          {cards.filter(c => c.entityId === targetEntityId).map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Tipo de Pagamento</label>
                      <select
                        value={paymentType}
                        onChange={(e) => setPaymentType(e.target.value as typeof paymentType)}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">Não informado</option>
                        {PAYMENT_TYPES.map(p => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">
                        Cliente {type === 'income' ? '(quem pagou)' : '(opcional)'}
                      </label>
                      <select
                        value={clientId}
                        onChange={(e) => setClientId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">Nenhum</option>
                        {clients.filter(c => c.entityId === targetEntityId).map(c => (
                          <option key={c.id} value={c.id}>{c.name}</option>
                        ))}
                      </select>
                    </div>
                  </div>

                  {!editingTransaction && (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-gray-50 p-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input
                            type="checkbox"
                            checked={isInstallment}
                            onChange={(e) => {
                              setIsInstallment(e.target.checked);
                              if (e.target.checked) setIsRecurring(false);
                            }}
                            className="rounded text-primary"
                          />
                          <span className="text-sm font-bold text-gray-700 flex items-center gap-2">
                            <Repeat className="h-4 w-4" /> Lançamento Parcelado?
                          </span>
                        </label>
                        
                        {isInstallment && (
                          <div className="mt-3">
                            <label className="block text-xs font-medium text-gray-500">Número de Parcelas</label>
                            <input
                              type="number"
                              min="2"
                              max="72"
                              value={totalInstallments}
                              onChange={(e) => setTotalInstallments(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <p className="mt-1 text-[10px] text-gray-400">
                              Serão criados {totalInstallments} lançamentos de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount) / Number(totalInstallments))} cada.
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl bg-gray-50 p-4">
                        <label className="flex items-center gap-2 cursor-pointer">
                          <input 
                            type="checkbox" 
                            checked={isRecurring}
                            onChange={(e) => {
                              setIsRecurring(e.target.checked);
                              if (e.target.checked) setIsInstallment(false);
                            }}
                            className="rounded text-primary"
                          />
                          <span className="text-sm font-bold text-gray-700 flex items-center gap-2">
                            <Repeat className="h-4 w-4" /> Lançamento Recorrente?
                          </span>
                        </label>
                        
                        {isRecurring && (
                          <div className="mt-3">
                            <label className="block text-xs font-medium text-gray-500">Frequência</label>
                            <select
                              value={recurringPeriod}
                              onChange={(e) => setRecurringPeriod(e.target.value as any)}
                              className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                            >
                              <option value="weekly">Semanal</option>
                              <option value="monthly">Mensal</option>
                              <option value="yearly">Anual</option>
                            </select>
                            <p className="mt-1 text-[10px] text-gray-400">
                              Serão criados 12 lançamentos recorrentes como base.
                            </p>
                          </div>
                        )}
                      </div>
                    </div>
                  )}
                </>
              )}

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
                  Confirmar Lançamento
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      <ImportTransactionsModal 
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        accounts={accounts}
        cards={cards}
      />
    </div>
  );
};
