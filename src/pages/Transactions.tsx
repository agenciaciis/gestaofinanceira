import React, { useState, useEffect, useRef } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, limit, where, writeBatch, doc, updateDoc, deleteDoc, getDocs, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Transaction, BankAccount, CreditCard, Client, Goal, Supplier } from '../types';
import { Plus, ArrowUpCircle, ArrowDownCircle, Search, Filter, Calendar, Tag, Wallet, CreditCard as CardIcon, ArrowRightLeft, Repeat, Download, CheckCircle2, Clock, AlertCircle, ChevronLeft, ChevronRight, Edit2, Trash2, Upload, X } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { addMonths, format } from 'date-fns';
import * as XLSX from 'xlsx';
import Papa from 'papaparse';
import { suggestCategory as aiSuggestCategory } from "../services/aiService";
import { Sparkles, Loader2 } from 'lucide-react';

import { CATEGORIES, MONTHS } from '../constants';
import { ImportTransactionsModal } from '../components/ImportTransactionsModal';
import { splitInstallments, parseLocalDate, totalBalance } from '../lib/finance';
import { planRecurringRenewals } from '../lib/recurring';
import { tagsDocPath, readTags, parseTags, mergeTags, matchesAllTags } from '../lib/tags';
import { readGoals, goalsDocPath } from '../lib/goalStore';

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
  // Lançamento avulso: "Já foi pago/recebido?" (senão nasce pendente/a pagar).
  const [jaEfetivado, setJaEfetivado] = useState(false);
  const [categoryId, setCategoryId] = useState('outros');
  const [targetEntityId, setTargetEntityId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'account' | 'card'>('account');
  const [accountId, setAccountId] = useState('');
  const [toAccountId, setToAccountId] = useState('');
  const [cardId, setCardId] = useState('');
  const [paymentType, setPaymentType] = useState<'' | NonNullable<Transaction['paymentType']>>('');
  const [personalExpense, setPersonalExpense] = useState(false);
  const [clientId, setClientId] = useState('');
  const [clients, setClients] = useState<Client[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [goals, setGoals] = useState<Goal[]>([]);
  const [goalId, setGoalId] = useState('');
  const [tagsInput, setTagsInput] = useState('');
  const [plannedAmount, setPlannedAmount] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [knownTags, setKnownTags] = useState<string[]>([]);
  const [tagFilter, setTagFilter] = useState<string[]>([]);

  // Installment state
  const [isInstallment, setIsInstallment] = useState(false);
  const [totalInstallments, setTotalInstallments] = useState('1');
  // Recurring state
  const [isRecurring, setIsRecurring] = useState(false);
  const [recurringPeriod, setRecurringPeriod] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');
  const [showExportMenu, setShowExportMenu] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'all' | 'pending' | 'completed' | 'overdue'>('all');
  const [searchTerm, setSearchTerm] = useState('');
  // Modal de pagamento: ao marcar como pago/recebido, escolher de qual conta sai/entra e a data.
  const [payingTx, setPayingTx] = useState<Transaction | null>(null);
  const [paySelAccount, setPaySelAccount] = useState('');
  const [paySelDate, setPaySelDate] = useState('');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedYear, setSelectedYear] = useState(new Date().getFullYear());
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [saving, setSaving] = useState(false);

  const suggestCategory = async () => {
    if (!description) return;
    setIsAiLoading(true);
    try {
      const suggestedId = await aiSuggestCategory(description, type === 'income' ? 'income' : 'expense');
      if (suggestedId) setCategoryId(suggestedId);
    } finally {
      setIsAiLoading(false);
    }
  };

  /** Marca/desmarca "conferido contra o extrato do banco". */
  const toggleReconciled = async (transaction: Transaction) => {
    const novo = !transaction.reconciled;
    setTransactions(prev => prev.map(x => x.id === transaction.id ? { ...x, reconciled: novo } : x));
    try {
      await updateDoc(doc(db, `entities/${transaction.entityId}/transactions/${transaction.id}`), {
        reconciled: novo,
        updatedAt: serverTimestamp(),
      });
    } catch (error) {
      console.error('Erro ao conciliar:', error);
      setTransactions(prev => prev.map(x => x.id === transaction.id ? { ...x, reconciled: transaction.reconciled } : x));
      showToast('Erro ao marcar conciliação.', 'error');
    }
  };

  const toggleStatus = async (transaction: Transaction) => {
    const completing = transaction.status !== 'completed';
    const newStatus = completing ? 'completed' : 'pending';
    // Atualização OTIMISTA: reflete na hora (cards e lista), sem esperar o Firestore.
    setTransactions(prev => prev.map(x => x.id === transaction.id ? { ...x, status: newStatus } : x));
    try {
      await updateDoc(doc(db, `entities/${transaction.entityId}/transactions/${transaction.id}`), {
        status: newStatus,
        paidAt: completing ? new Date().toISOString().split('T')[0] : null,
        updatedAt: serverTimestamp(),
      });
      const verb = transaction.type === 'income' ? (completing ? 'Recebido' : 'A receber') : (completing ? 'Pago' : 'Pendente');
      showToast(`${transaction.description}: ${verb}. ${completing ? 'Toque no selo verde para desfazer.' : ''}`.trim(), 'success');
    } catch (error) {
      console.error("Error updating status:", error);
      // Reverte a atualização otimista em caso de falha.
      setTransactions(prev => prev.map(x => x.id === transaction.id ? { ...x, status: transaction.status } : x));
      showToast('Erro ao atualizar status.', 'error');
    }
  };

  // Abre o modal de pagamento (pendente -> pago/recebido), escolhendo a conta e a data.
  const openPay = (t: Transaction) => {
    const accs = accounts.filter(a => a.entityId === t.entityId);
    setPaySelAccount(t.accountId || accs[0]?.id || '');
    setPaySelDate(new Date().toISOString().split('T')[0]);
    setPayingTx(t);
  };

  // Confirma o pagamento/recebimento: dá a baixa na conta escolhida e marca como concluído.
  const confirmPay = async () => {
    if (!payingTx) return;
    if (!paySelAccount) { showToast('Escolha a conta de onde sai/entra o dinheiro.', 'error'); return; }
    const t = payingTx;
    // Atualização otimista.
    setTransactions(prev => prev.map(x => x.id === t.id ? { ...x, status: 'completed', accountId: paySelAccount, paidAt: paySelDate } : x));
    setPayingTx(null);
    try {
      await updateDoc(doc(db, `entities/${t.entityId}/transactions/${t.id}`), {
        status: 'completed',
        accountId: paySelAccount,
        paidAt: paySelDate,
        updatedAt: serverTimestamp(),
      });
      const verb = t.type === 'income' ? 'Recebido' : 'Pago';
      showToast(`${t.description}: ${verb}. Baixa registrada na conta.`, 'success');
    } catch (error) {
      console.error('Erro ao registrar pagamento:', error);
      setTransactions(prev => prev.map(x => x.id === t.id ? { ...x, status: t.status, accountId: t.accountId, paidAt: t.paidAt } : x));
      showToast('Erro ao registrar o pagamento.', 'error');
    }
  };

  // Rótulo do botão de ação rápida conforme tipo e estado.
  const quickActionLabel = (t: Transaction) => {
    if (t.type === 'income') return t.status === 'completed' ? 'Recebido' : 'Receber';
    if (t.type === 'expense') return t.status === 'completed' ? 'Pago' : 'Pagar';
    return 'Concluído';
  };

  const todayStart = new Date(new Date().setHours(0, 0, 0, 0));

  // Compra no cartão (tem cartão e não tem conta): NÃO é caixa — entra na fatura.
  // Quem "paga" é a fatura (tela Cartões), não a compra em si.
  const isCardExpense = (t: Transaction) => t.type === 'expense' && !!t.cardId && !t.accountId;

  // Situação de um lançamento pendente perto do vencimento (para cor e rótulo).
  type DueState = 'paid' | 'overdue' | 'due-soon' | 'open';
  const dueStateOf = (t: Transaction): DueState => {
    if (t.status === 'completed') return 'paid';
    const d = parseLocalDate(t.date);
    const days = Math.round((d.getTime() - todayStart.getTime()) / 86400000);
    if (days < 0) return 'overdue';
    if (days <= 3) return 'due-soon';
    return 'open';
  };

  const filteredTransactions = transactions.filter(t => {
    const matchesSearch = t.description.toLowerCase().includes(searchTerm.toLowerCase());
    const isOverdue = t.status === 'pending' && parseLocalDate(t.date) < todayStart;

    const tDate = parseLocalDate(t.date);
    const matchesDate = tDate.getMonth() === selectedMonth && tDate.getFullYear() === selectedYear;

    if (!matchesDate) return false;

    if (!matchesAllTags(t.tags, tagFilter)) return false;

    if (statusFilter === 'all') return matchesSearch;
    if (statusFilter === 'pending') return matchesSearch && t.status === 'pending' && !isOverdue;
    if (statusFilter === 'completed') return matchesSearch && t.status === 'completed';
    if (statusFilter === 'overdue') return matchesSearch && isOverdue;
    return matchesSearch;
  });

  // Resumo do mês: sempre sobre TODAS as transações do mês (ignora o filtro de
  // status), para que os cards e a "sobra do mês" não dependam da aba selecionada.
  const summary = transactions.reduce((acc, t) => {
    const tDate = parseLocalDate(t.date);
    if (tDate.getMonth() !== selectedMonth || tDate.getFullYear() !== selectedYear) return acc;
    if (t.status === 'cancelled') return acc;
    const isOverdue = t.status === 'pending' && tDate < todayStart;

    // Compra no cartão não é caixa: fica fora de recebido/pago/a pagar.
    // O dinheiro só sai quando a FATURA é paga (transferência, tela Cartões).
    if (isCardExpense(t)) return acc;

    if (t.type === 'income') {
      if (t.status === 'completed') acc.received += t.amount;
      else acc.toReceive += t.amount;
    } else if (t.type === 'expense') {
      if (t.status === 'completed') acc.paid += t.amount;
      else acc.toPay += t.amount;
    }
    if (isOverdue && t.type === 'expense') acc.overdue += t.amount;

    return acc;
  }, { received: 0, paid: 0, toReceive: 0, toPay: 0, overdue: 0 });

  // "Sobra do mês"
  const saldoRealizado = summary.received - summary.paid;                 // já recebido - já pago
  const liquidoPendente = summary.toReceive - summary.toPay;              // a receber - a pagar
  // Saldo REAL de hoje em todas as contas (inclui negativo). É a base da projeção.
  const saldoAtualContas = totalBalance(accounts, transactions);
  // Projeção de fim do mês: o que você TEM hoje + o que ainda entra − o que ainda sai.
  const saldoProjetado = saldoAtualContas + liquidoPendente;

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
    setPersonalExpense(!!t.personalExpense);
    setGoalId(t.goalId || '');
    setTagsInput((t.tags || []).join(', '));
    setPlannedAmount(t.plannedAmount != null ? String(t.plannedAmount) : '');
    setSubcategory(t.subcategory || '');
    setClientId(t.clientId || '');
    setSupplierId(t.supplierId || '');
    setIsInstallment(!!t.installmentGroupId);
    setTotalInstallments(t.totalInstallments?.toString() || '1');
    setIsRecurring(!!t.isRecurring);
    setRecurringPeriod(t.recurringPeriod || 'monthly');
    setIsModalOpen(true);
  };

  const handleDelete = async (t: Transaction) => {
    // Quitação de fatura: ao excluir, devolvemos as compras à fatura (desmarca `settled`),
    // senão o dinheiro volta pro banco mas a fatura some — o valor "desaparece".
    if (t.cardPaymentFor) {
      const toUnsettle = transactions.filter(x =>
        x.entityId === t.entityId && x.cardId === t.cardPaymentFor && x.settled && x.settledAt === t.date
      );
      const confirmPayDelete = await confirm({
        title: 'Excluir pagamento de fatura',
        message: toUnsettle.length
          ? `Ao excluir, ${toUnsettle.length} compra(s) voltam para a fatura do cartão e o limite volta a ficar comprometido. Continuar?`
          : 'Excluir este pagamento de fatura?',
        variant: 'danger',
      });
      if (!confirmPayDelete) return;
      try {
        if (toUnsettle.length) {
          const batch = writeBatch(db);
          for (const x of toUnsettle) {
            batch.update(doc(db, `entities/${t.entityId}/transactions/${x.id}`), { settled: false, settledAt: null });
          }
          await batch.commit();
        }
        await deleteDoc(doc(db, `entities/${t.entityId}/transactions/${t.id}`));
        showToast('Pagamento excluído. A fatura voltou para o cartão.', 'success');
      } catch (error) {
        console.error('Erro ao excluir pagamento de fatura:', error);
        showToast('Erro ao excluir o pagamento.', 'error');
      }
      return;
    }

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
    const data = filteredTransactions.map(t => ({
      Data: parseLocalDate(t.date).toLocaleDateString('pt-BR'),
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
    const data = filteredTransactions.map(t => ({
      Data: parseLocalDate(t.date).toLocaleDateString('pt-BR'),
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
    let allSuppliers: Supplier[] = [];

    let allGoals: Goal[] = [];

    filteredEntities.forEach(entity => {
      // Clients (para vincular receitas a um cliente)
      const clQ = query(collection(db, `entities/${entity.id}/clients`));
      const unsubCl = onSnapshot(clQ, (snapshot) => {
        const entityCl = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Client[];
        allClients = [...allClients.filter(c => c.entityId !== entity.id), ...entityCl];
        setClients([...allClients]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/clients`));
      unsubscribes.push(unsubCl);

      // Fornecedores (para vincular despesas a um fornecedor)
      const supQ = query(collection(db, `entities/${entity.id}/suppliers`));
      const unsubSup = onSnapshot(supQ, (snapshot) => {
        const entitySup = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Supplier[];
        allSuppliers = [...allSuppliers.filter(s => s.entityId !== entity.id), ...entitySup];
        setSuppliers([...allSuppliers]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/suppliers`));
      unsubscribes.push(unsubSup);

      // Caixinhas: doc único `config/goals` (mesma fonte da tela de Caixinhas).
      // Antes lia a coleção `entities/{id}/goals`, que não existe — a marcação
      // de depósito ficava vazia e gerava erro de permissão.
      const unsubG = onSnapshot(doc(db, goalsDocPath(entity.id)), (snap) => {
        const entityG = readGoals(snap.data(), entity.id);
        allGoals = [...allGoals.filter(g => g.entityId !== entity.id), ...entityG];
        setGoals([...allGoals]);
      }, (error) => handleFirestoreError(error, OperationType.GET, goalsDocPath(entity.id)));
      unsubscribes.push(unsubG);

      // Etiquetas já usadas nesta entidade, para sugerir em vez de digitar de novo.
      const unsubTags = onSnapshot(doc(db, tagsDocPath(entity.id)), (snap) => {
        setKnownTags(prev => mergeTags(prev, readTags(snap.data())));
      }, (error) => handleFirestoreError(error, OperationType.GET, tagsDocPath(entity.id)));
      unsubscribes.push(unsubTags);

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
              personalExpense: tmpl.type === 'expense' ? !!tmpl.personalExpense : false,
              goalId: tmpl.goalId ?? null,
              tags: tmpl.tags ?? [],
              plannedAmount: tmpl.plannedAmount ?? null,
              subcategory: tmpl.subcategory ?? null,
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
    if (saving) return;
    setSaving(true);
    // Registra etiquetas novas na lista da entidade, para sugerir depois.
    const novasTags = parseTags(tagsInput);
    if (novasTags.length > 0 && targetEntityId) {
      setDoc(doc(db, tagsDocPath(targetEntityId)),
        { items: mergeTags(knownTags, novasTags), updatedAt: serverTimestamp() },
        { merge: true }
      ).catch(err => console.error('Erro ao salvar etiquetas:', err));
    }
    e.preventDefault();
    if (!targetEntityId) { setSaving(false); return; }

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
            personalExpense: type === 'expense' ? personalExpense : false,
            goalId: goalId || null,
            tags: parseTags(tagsInput),
            plannedAmount: plannedAmount === '' ? null : Number(plannedAmount) || null,
            subcategory: subcategory.trim() || null,
                  clientId: clientId || null,
                  clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
                  supplierId: supplierId || null,
                  supplierName: supplierId ? (suppliers.find(s => s.id === supplierId)?.name || null) : null,
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
            personalExpense: type === 'expense' ? personalExpense : false,
            goalId: goalId || null,
            tags: parseTags(tagsInput),
            plannedAmount: plannedAmount === '' ? null : Number(plannedAmount) || null,
            subcategory: subcategory.trim() || null,
          clientId: clientId || null,
          clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
          supplierId: supplierId || null,
          supplierName: supplierId ? (suppliers.find(s => s.id === supplierId)?.name || null) : null,
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
          status: jaEfetivado ? 'completed' : 'pending',
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
            personalExpense: type === 'expense' ? personalExpense : false,
            goalId: goalId || null,
            tags: parseTags(tagsInput),
            plannedAmount: plannedAmount === '' ? null : Number(plannedAmount) || null,
            subcategory: subcategory.trim() || null,
            clientId: clientId || null,
            clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
            supplierId: supplierId || null,
            supplierName: supplierId ? (suppliers.find(s => s.id === supplierId)?.name || null) : null,
            // Só a 1ª parcela pode nascer paga — e apenas se o usuário marcou "já paguei".
            status: (i === 1 && jaEfetivado) ? 'completed' : 'pending',
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
            personalExpense: type === 'expense' ? personalExpense : false,
            goalId: goalId || null,
            tags: parseTags(tagsInput),
            plannedAmount: plannedAmount === '' ? null : Number(plannedAmount) || null,
            subcategory: subcategory.trim() || null,
            clientId: clientId || null,
            clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
            supplierId: supplierId || null,
            supplierName: supplierId ? (suppliers.find(s => s.id === supplierId)?.name || null) : null,
            // Só a 1ª ocorrência pode nascer paga — e apenas se o usuário marcou "já paguei".
            status: (i === 0 && jaEfetivado) ? 'completed' : 'pending',
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
            personalExpense: type === 'expense' ? personalExpense : false,
            goalId: goalId || null,
            tags: parseTags(tagsInput),
            plannedAmount: plannedAmount === '' ? null : Number(plannedAmount) || null,
            subcategory: subcategory.trim() || null,
          clientId: clientId || null,
          clientName: clientId ? (clients.find(c => c.id === clientId)?.name || null) : null,
          supplierId: supplierId || null,
          supplierName: supplierId ? (suppliers.find(s => s.id === supplierId)?.name || null) : null,
          status: jaEfetivado ? 'completed' : 'pending',
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
    } finally {
      setSaving(false);
    }
  };

  const resetForm = () => {
    setEditingTransaction(null);
    setDescription('');
    setAmount('');
    const hojeStr = new Date().toISOString().split('T')[0];
    setDate(hojeStr);
    // Nasce SEMPRE "A pagar/A receber" (pendente). O usuário marca "já paguei"
    // só quando quitou na hora — fluxo profissional de contas a pagar/receber.
    setJaEfetivado(false);
    // Já abre com uma entidade escolhida (na visão consolidada, a 1ª). Sem isso,
    // os selects de conta/cartão (filtrados por entidade) ficavam vazios.
    setTargetEntityId(entities[0]?.id || '');
    setAccountId('');
    setToAccountId('');
    setCardId('');
    setPaymentMethod('account');
    setPaymentType('');
    setPersonalExpense(false);
    setGoalId('');
    setTagsInput('');
    setPlannedAmount('');
    setSubcategory('');
    setClientId('');
    setSupplierId('');
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
          <h2 className="text-2xl font-bold text-content">Lançamentos</h2>
          <p className="text-sm text-content-subtle">Histórico completo de receitas, despesas e transferências.</p>
        </div>
        <div className="flex flex-wrap gap-3">
          <button
            onClick={() => setIsImportModalOpen(true)}
            className="flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-content-muted shadow-sm hover:bg-canvas"
          >
            <Upload className="h-4 w-4" />
            Importar
          </button>
          <div className="relative">
            <button 
              onClick={() => setShowExportMenu(!showExportMenu)}
              className="flex items-center gap-2 rounded-lg border border-line bg-surface px-4 py-2 text-sm font-semibold text-content-muted shadow-sm hover:bg-canvas"
            >
              <Download className="h-4 w-4" />
              Exportar
            </button>
            {showExportMenu && (
              <div className="absolute right-0 mt-2 w-48 rounded-xl border border-line bg-surface p-2 shadow-lg z-20">
                <button 
                  onClick={exportToExcel}
                  className="w-full rounded-lg px-4 py-2 text-left text-sm hover:bg-canvas"
                >
                  Excel (.xlsx)
                </button>
                <button 
                  onClick={exportToCSV}
                  className="w-full rounded-lg px-4 py-2 text-left text-sm hover:bg-canvas"
                >
                  CSV (.csv)
                </button>
              </div>
            )}
          </div>
          <button 
            onClick={() => { resetForm(); setIsModalOpen(true); }}
            className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            Novo Lançamento
          </button>
        </div>
      </div>

      {/* Painel: Saldo / Sobra do Mês */}
      <div className="grid gap-4 sm:grid-cols-3 rounded-2xl border border-line bg-gradient-to-br from-slate-50 to-white p-5 shadow-sm dark:border-gray-800 dark:from-gray-900 dark:to-gray-900">
        <div className="sm:border-r sm:border-line dark:sm:border-gray-800">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Quanto vou ter no fim do mês</p>
          <p className="text-[10px] text-content-subtle mb-1">saldo de hoje ({new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldoAtualContas)}) + a receber − a pagar</p>
          <p className={cn("text-3xl font-black tracking-tight", saldoProjetado >= 0 ? "text-emerald-600" : "text-rose-600")}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldoProjetado)}
          </p>
        </div>
        <div className="sm:px-5 sm:border-r sm:border-line dark:sm:border-gray-800">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Saldo realizado</p>
          <p className="text-[10px] text-content-subtle mb-1">recebido − pago (já efetivado)</p>
          <p className={cn("text-2xl font-black tracking-tight", saldoRealizado >= 0 ? "text-emerald-600" : "text-rose-600")}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(saldoRealizado)}
          </p>
        </div>
        <div className="sm:px-5">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">A receber − a pagar</p>
          <p className="text-[10px] text-content-subtle mb-1">o que ainda falta entrar/sair</p>
          <p className={cn("text-2xl font-black tracking-tight", liquidoPendente >= 0 ? "text-blue-600" : "text-orange-600")}>
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(liquidoPendente)}
          </p>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-content-subtle">Recebido</p>
          <p className="mt-1 text-lg font-bold text-green-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.received)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-content-subtle">Pago</p>
          <p className="mt-1 text-lg font-bold text-red-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.paid)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-content-subtle">A Receber</p>
          <p className="mt-1 text-lg font-bold text-blue-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.toReceive)}
          </p>
        </div>
        <div className="rounded-xl border border-line bg-surface p-4 shadow-sm">
          <p className="text-[10px] font-bold uppercase tracking-wider text-content-subtle">A Pagar</p>
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
        <div className="flex items-center gap-2 rounded-xl border border-line bg-surface p-1 shadow-sm">
          <button 
            onClick={() => changeMonth(-1)}
            className="rounded-lg p-2 hover:bg-canvas text-content-subtle hover:text-primary transition-all"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <div className="flex items-center gap-2 px-2 min-w-[140px] justify-center">
            <Calendar className="h-4 w-4 text-primary" />
            <span className="text-sm font-bold text-content-muted capitalize">
              {MONTHS[selectedMonth]} {selectedYear}
            </span>
          </div>
          <button 
            onClick={() => changeMonth(1)}
            className="rounded-lg p-2 hover:bg-canvas text-content-subtle hover:text-primary transition-all"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>

        {knownTags.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Etiquetas:</span>
            {knownTags.map(tag => (
              <button
                key={tag}
                onClick={() => setTagFilter(prev => prev.includes(tag) ? prev.filter(t => t !== tag) : [...prev, tag])}
                className={cn('rounded-full px-2.5 py-1 text-[11px] font-bold transition-all',
                  tagFilter.includes(tag)
                    ? 'bg-primary text-white'
                    : 'border border-line text-content-muted hover:border-primary hover:text-primary')}
              >
                {tag}
              </button>
            ))}
            {tagFilter.length > 0 && (
              <button onClick={() => setTagFilter([])}
                className="ml-1 text-[11px] font-bold text-content-subtle hover:text-rose-600">
                limpar
              </button>
            )}
          </div>
        )}
        <div className="relative flex-1 min-w-[200px]">
          <Search className="absolute left-3 top-2.5 h-4 w-4 text-content-subtle" />
          <input 
            type="text" 
            placeholder="Buscar lançamentos..." 
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-lg border border-line pl-10 pr-4 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          />
        </div>
        <div className="flex rounded-lg border border-line bg-surface p-1">
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
                statusFilter === f.id ? "bg-primary text-white" : "text-content-subtle hover:bg-canvas"
              )}
            >
              {f.label}
            </button>
          ))}
        </div>
      </div>

      {/* Transactions Table */}
      <div className="overflow-hidden rounded-2xl border border-line bg-surface shadow-sm">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="bg-canvas text-xs font-bold uppercase tracking-wider text-content-subtle">
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
            <tbody className="divide-y divide-line">
              {filteredTransactions.map((t) => {
                const isOverdue = t.status === 'pending' && parseLocalDate(t.date) < todayStart;
                return (
                  <tr key={t.id} className="hover:bg-canvas transition-colors group">
                    <td className="whitespace-nowrap px-6 py-4 text-content-muted">
                      {parseLocalDate(t.date).toLocaleDateString('pt-BR')}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center gap-3">
                        <div className={cn(
                          "flex h-8 w-8 shrink-0 items-center justify-center rounded-full",
                          t.type === 'income' ? "bg-green-100 text-green-600" :
                          t.type === 'expense' ? "bg-red-100 text-red-600" : "bg-blue-100 text-blue-600"
                        )}>
                          {t.type === 'income' ? <ArrowUpCircle className="h-4 w-4" /> : 
                           t.type === 'expense' ? <ArrowDownCircle className="h-4 w-4" /> : <ArrowRightLeft className="h-4 w-4" />}
                        </div>
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-content">{t.description}</span>
                            {t.installmentNumber && (
                              <span className="text-[10px] text-content-subtle">({t.installmentNumber}/{t.totalInstallments})</span>
                            )}
                            {t.isRecurring && (
                              <Repeat className="h-3 w-3 text-primary" />
                            )}
                          </div>
                          <span className="text-[10px] text-content-subtle uppercase tracking-wider">
                            {CATEGORIES.find(c => c.id === t.categoryId)?.name || 'Outros'}
                          </span>
                          {t.clientName && (
                            <span className="block text-[10px] text-content-subtle">{t.clientName}</span>
                          )}
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
                    <td className="px-6 py-4 text-content-subtle">
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
                      {t.paymentType && (
                        <span className="mt-1 inline-block rounded-full bg-canvas px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider text-content-subtle">
                          {PAYMENT_TYPES.find(p => p.id === t.paymentType)?.label || t.paymentType}
                        </span>
                      )}
                    </td>
                    <td className="px-6 py-4">
                      {(() => {
                        // Compra no cartão: não é caixa — é paga na FATURA (tela Cartões).
                        if (isCardExpense(t)) return (
                          <span
                            title="Compra no cartão — é paga na fatura (tela Cartões), não aqui."
                            className="flex w-fit items-center gap-1.5 rounded-full bg-indigo-100 px-2.5 py-1 text-[10px] font-bold uppercase text-indigo-700 dark:bg-indigo-950/60 dark:text-indigo-300"
                          >
                            <CardIcon className="h-3 w-3" /> Na fatura
                          </span>
                        );
                        if (t.type === 'transfer') return (
                          <span className="flex w-fit items-center gap-1.5 rounded-full bg-blue-100 px-2.5 py-1 text-[10px] font-bold uppercase text-blue-700 dark:bg-blue-950/50 dark:text-blue-300">
                            <CheckCircle2 className="h-3 w-3" /> Concluído
                          </span>
                        );
                        if (t.status === 'completed') return (
                          <span className="flex w-fit items-center gap-1.5 rounded-full bg-green-100 px-2.5 py-1 text-[10px] font-bold uppercase text-green-700 dark:bg-green-950/50 dark:text-green-300">
                            <CheckCircle2 className="h-3 w-3" /> {t.type === 'income' ? 'Recebido' : 'Pago'}
                            {t.reconciled && <span className="font-normal normal-case opacity-70">· conferido</span>}
                          </span>
                        );
                        // Pendente: selo colorido de vencimento (SÓ a situação, sem botão).
                        const st = dueStateOf(t);
                        if (st === 'overdue') {
                          const days = Math.round((todayStart.getTime() - parseLocalDate(t.date).getTime()) / 86400000);
                          return (
                            <span
                              title={`Atrasada há ${days} dia(s)`}
                              className="flex w-fit items-center gap-1 rounded-full bg-red-100 px-2.5 py-1 text-[10px] font-black uppercase text-red-700 ring-1 ring-red-300 dark:bg-red-950/50 dark:text-red-300"
                            >
                              <AlertCircle className="h-3 w-3" /> Atrasada
                            </span>
                          );
                        }
                        if (st === 'due-soon') {
                          const days = Math.round((parseLocalDate(t.date).getTime() - todayStart.getTime()) / 86400000);
                          const label = days <= 0 ? 'Vence hoje' : days === 1 ? 'Vence amanhã' : `Vence em ${days} dias`;
                          return (
                            <span className="flex w-fit items-center gap-1 rounded-full bg-amber-100 px-2.5 py-1 text-[10px] font-black uppercase text-amber-700 ring-1 ring-amber-300 dark:bg-amber-950/50 dark:text-amber-300">
                              <Clock className="h-3 w-3" /> {label}
                            </span>
                          );
                        }
                        return (
                          <span className="flex w-fit items-center gap-1 rounded-full bg-blue-50 px-2.5 py-1 text-[10px] font-bold uppercase text-blue-600 dark:bg-blue-950/40 dark:text-blue-300">
                            <Calendar className="h-3 w-3" /> A vencer
                          </span>
                        );
                      })()}
                    </td>
                    <td className={cn(
                      "px-6 py-4 text-right font-bold",
                      t.type === 'income' ? "text-green-600" : 
                      t.type === 'expense' ? "text-red-600" : "text-blue-600"
                    )}>
                      {t.type === 'income' ? '+' : t.type === 'expense' ? '-' : ''} {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.amount)}
                    </td>
                    <td className="px-6 py-4">
                      <div className="flex items-center justify-end gap-2">
                        {!isCardExpense(t) && t.type !== 'transfer' && (
                          t.status === 'completed' ? (
                            <div className="flex items-center gap-1.5">
                              <button
                                onClick={() => toggleReconciled(t)}
                                title={t.reconciled ? 'Conferido no extrato — clique para desmarcar' : 'Marcar como conferido no extrato do banco'}
                                className={cn(
                                  'rounded-lg border px-2 py-1 text-[10px] font-bold uppercase transition-all',
                                  t.reconciled
                                    ? 'border-indigo-300 bg-indigo-50 text-indigo-700 dark:bg-indigo-950/50 dark:text-indigo-300'
                                    : 'border-line text-content-subtle hover:border-indigo-400 hover:text-indigo-600'
                                )}
                              >
                                {t.reconciled ? '✓ conferido' : 'conferir'}
                              </button>
                              <button
                                onClick={() => toggleStatus(t)}
                                title="Desfazer — volta a pendente"
                                className="rounded-lg border border-line px-2 py-1 text-[10px] font-bold uppercase text-content-subtle transition-all hover:border-amber-400 hover:text-amber-600"
                              >
                                Desfazer
                              </button>
                            </div>
                          ) : (
                            <button
                              onClick={() => openPay(t)}
                              title={t.type === 'income' ? 'Registrar recebimento (escolher conta)' : 'Registrar pagamento (escolher conta)'}
                              className="flex items-center gap-1.5 rounded-lg bg-emerald-500 px-3 py-1.5 text-xs font-bold text-white shadow-sm transition-all hover:bg-emerald-600 active:scale-95"
                            >
                              <CheckCircle2 className="h-3.5 w-3.5" />
                              {quickActionLabel(t)}
                            </button>
                          )
                        )}
                        <div className="flex gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity">
                          <button
                            onClick={() => handleEdit(t)}
                            className="rounded-lg p-1.5 text-content-subtle hover:bg-surface-muted hover:text-primary transition-all"
                          >
                            <Edit2 className="h-4 w-4" />
                          </button>
                          <button
                            onClick={() => handleDelete(t)}
                            className="rounded-lg p-1.5 text-content-subtle hover:bg-red-50 hover:text-red-600 transition-all"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
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
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm" onClick={() => { resetForm(); setIsModalOpen(false); }}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-surface p-8 shadow-2xl"
          >
            <button type="button" aria-label="Fechar" onClick={() => { resetForm(); setIsModalOpen(false); }}
              className="absolute right-4 top-4 z-10 rounded-xl p-2 text-content-subtle hover:bg-surface-muted hover:text-content">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-xl font-bold text-content pr-10">
              {editingTransaction ? 'Editar Lançamento' : 'Novo Lançamento'}
            </h3>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div className="grid grid-cols-3 gap-2">
                <button
                  type="button"
                  onClick={() => { setType('income'); setIsInstallment(false); }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-xs font-bold transition-all",
                    type === 'income' ? "border-green-500 bg-green-50 text-green-600" : "border-line text-content-subtle"
                  )}
                >
                  <ArrowUpCircle className="h-4 w-4" /> Receita
                </button>
                <button
                  type="button"
                  onClick={() => setType('expense')}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-xs font-bold transition-all",
                    type === 'expense' ? "border-red-500 bg-red-50 text-red-600" : "border-line text-content-subtle"
                  )}
                >
                  <ArrowDownCircle className="h-4 w-4" /> Despesa
                </button>
                <button
                  type="button"
                  onClick={() => { setType('transfer'); setIsInstallment(false); }}
                  className={cn(
                    "flex flex-col items-center justify-center gap-1 rounded-lg border py-2 text-xs font-bold transition-all",
                    type === 'transfer' ? "border-blue-500 bg-blue-50 text-blue-600" : "border-line text-content-subtle"
                  )}
                >
                  <ArrowRightLeft className="h-4 w-4" /> Transf.
                </button>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Entidade</label>
                  <select
                    value={targetEntityId}
                    onChange={(e) => setTargetEntityId(e.target.value)}
                    disabled={!!editingTransaction}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-60 disabled:cursor-not-allowed"
                    required
                  >
                    <option value="">Selecione...</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                  {editingTransaction && (
                    <p className="mt-1 text-xs text-content-subtle">não é possível trocar a entidade na edição</p>
                  )}
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Data</label>
                  <input
                    type="date"
                    value={date}
                    onChange={(e) => setDate(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  />
                </div>
              </div>

              {!editingTransaction && !isInstallment && !isRecurring && (
                <label className="flex items-center gap-2 cursor-pointer rounded-lg bg-canvas px-4 py-2">
                  <input
                    type="checkbox"
                    checked={jaEfetivado}
                    onChange={(e) => setJaEfetivado(e.target.checked)}
                    className="rounded text-primary"
                  />
                  <span className="text-sm font-medium text-content-muted">
                    Já foi pago/recebido (senão fica pendente/a pagar)
                  </span>
                </label>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div className="flex-1">
                  <label className="block text-sm font-medium text-content-muted">Descrição</label>
                  <div className="relative">
                    <input
                      type="text"
                      value={description}
                      onChange={(e) => setDescription(e.target.value)}
                      placeholder="Ex: Aluguel, Supermercado"
                      className="mt-1 w-full rounded-lg border border-line px-4 py-2 pr-10 outline-none focus:ring-2 focus:ring-primary/20"
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
                  <label className="block text-sm font-medium text-content-muted">Categoria</label>
                  <select 
                    value={categoryId}
                    onChange={(e) => setCategoryId(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  >
                    {CATEGORIES.filter(c => type === 'transfer' ? c.id === 'transferencia' : (type === 'income' ? c.type === 'income' : !c.type)).map(c => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-content-muted">Valor Total</label>
                <div className="relative mt-1">
                  <span className="absolute left-4 top-2 text-content-subtle">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={amount}
                    onChange={(e) => setAmount(e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-lg border border-line pl-10 pr-4 py-2 font-bold focus:ring-2 focus:ring-primary/20 outline-none"
                    required
                  />
                </div>
              </div>

              {type === 'transfer' ? (
                <div className="grid grid-cols-2 gap-4">
                  <div>
                    <label className="block text-sm font-medium text-content-muted">Origem</label>
                    <select 
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                      required
                    >
                      <option value="">Selecione...</option>
                      {accounts.filter(a => a.entityId === targetEntityId).map(a => (
                        <option key={a.id} value={a.id}>{a.bankName}</option>
                      ))}
                    </select>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-content-muted">Destino</label>
                    <select 
                      value={toAccountId}
                      onChange={(e) => setToAccountId(e.target.value)}
                      className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
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
                    <label className="block text-sm font-medium text-content-muted">Forma de Pagamento</label>
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
                          className="w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
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
                          className="w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                          required={paymentMethod === 'card'}
                        >
                          <option value="">Selecione o cartão...</option>
                          {cards.filter(c => c.entityId === targetEntityId).map(c => (
                            <option key={c.id} value={c.id}>{c.name}</option>
                          ))}
                        </select>
                      )}
                      {paymentMethod === 'account' && targetEntityId && accounts.filter(a => a.entityId === targetEntityId).length === 0 && (
                        <p className="mt-1 text-xs text-amber-600">Nenhuma conta cadastrada nesta entidade. Cadastre em “Contas”.</p>
                      )}
                      {paymentMethod === 'card' && targetEntityId && cards.filter(c => c.entityId === targetEntityId).length === 0 && (
                        <p className="mt-1 text-xs text-amber-600">Nenhum cartão cadastrado nesta entidade. Cadastre em “Cartões”.</p>
                      )}
                    </div>
                  </div>

                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-content-muted">Tipo de Pagamento</label>
                      <select
                        value={paymentType}
                        onChange={(e) => setPaymentType(e.target.value as typeof paymentType)}
                        className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">Não informado</option>
                        {PAYMENT_TYPES.map(p => (
                          <option key={p.id} value={p.id}>{p.label}</option>
                        ))}
                      </select>
                    </div>
                    <div>
                      {type === 'expense' ? (
                        <>
                          <label className="block text-sm font-medium text-content-muted">Fornecedor (opcional)</label>
                          <select
                            value={supplierId}
                            onChange={(e) => setSupplierId(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                          >
                            <option value="">Nenhum</option>
                            {suppliers.filter(s => s.entityId === targetEntityId).map(s => (
                              <option key={s.id} value={s.id}>{s.name}</option>
                            ))}
                          </select>
                        </>
                      ) : (
                        <>
                          <label className="block text-sm font-medium text-content-muted">
                            Cliente {type === 'income' ? '(quem pagou)' : '(opcional)'}
                          </label>
                          <select
                            value={clientId}
                            onChange={(e) => setClientId(e.target.value)}
                            className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                          >
                            <option value="">Nenhum</option>
                            {clients.filter(c => c.entityId === targetEntityId).map(c => (
                              <option key={c.id} value={c.id}>{c.name}</option>
                            ))}
                          </select>
                        </>
                      )}
                    </div>
                  </div>

                  {/* Gasto pessoal pago pela empresa — o que a contabilidade precisa enxergar. */}
                  {type === 'expense' && entities.find(e => e.id === targetEntityId)?.type === 'PJ' && (
                    <div className="rounded-xl bg-amber-50 p-4">
                      <label className="flex items-center gap-2 cursor-pointer">
                        <input
                          type="checkbox"
                          checked={personalExpense}
                          onChange={(e) => setPersonalExpense(e.target.checked)}
                          className="rounded text-amber-600"
                        />
                        <span className="text-sm font-bold text-amber-800">
                          Este gasto é pessoal, mas foi pago pela empresa
                        </span>
                      </label>
                      <p className="mt-1 text-xs text-amber-700">
                        Some no aviso do consolidado para você saber quanto tirar como pró-labore.
                      </p>
                    </div>
                  )}

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <label className="block text-sm font-medium text-content-muted">
                        Valor previsto <span className="font-normal text-content-subtle">(opcional)</span>
                      </label>
                      <input
                        type="number" step="0.01" min="0"
                        value={plannedAmount}
                        onChange={(e) => setPlannedAmount(e.target.value)}
                        placeholder="quanto você esperava"
                        className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                      />
                      {Number(plannedAmount) > 0 && Number(amount) > 0 && (
                        <p className={cn('mt-1 text-xs font-bold',
                          Number(amount) > Number(plannedAmount) ? 'text-rose-600' : 'text-emerald-600')}>
                          {Number(amount) > Number(plannedAmount)
                            ? `Passou ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(amount) - Number(plannedAmount))} do previsto`
                            : Number(amount) < Number(plannedAmount)
                              ? `Economizou ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(plannedAmount) - Number(amount))}`
                              : 'Bateu o previsto'}
                        </p>
                      )}
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-content-muted">
                        Subcategoria <span className="font-normal text-content-subtle">(opcional)</span>
                      </label>
                      <input
                        type="text"
                        value={subcategory}
                        onChange={(e) => setSubcategory(e.target.value)}
                        placeholder="Ex: energia, aluguel, combustível"
                        className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-content-muted">
                      Etiquetas <span className="font-normal text-content-subtle">(opcional, separe por vírgula)</span>
                    </label>
                    <input
                      type="text"
                      value={tagsInput}
                      onChange={(e) => setTagsInput(e.target.value)}
                      placeholder="Ex: reforma 2026, obra casa"
                      className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    />
                    {knownTags.length > 0 && (
                      <div className="mt-2 flex flex-wrap gap-1.5">
                        {knownTags.slice(0, 14).map(tag => (
                          <button
                            key={tag}
                            type="button"
                            onClick={() => {
                              const atuais = parseTags(tagsInput);
                              if (!atuais.includes(tag)) setTagsInput([...atuais, tag].join(', '));
                            }}
                            className="rounded-full border border-line px-2.5 py-1 text-[11px] font-bold text-content-muted hover:border-primary hover:text-primary transition-all"
                          >
                            {tag}
                          </button>
                        ))}
                      </div>
                    )}
                    <p className="mt-1 text-xs text-content-subtle">
                      Categoria classifica; etiqueta agrupa por assunto e cruza categorias.
                    </p>
                  </div>

                  {/* Caixinha: marca o lançamento como depósito num objetivo */}
                  {type !== 'income' && goals.length > 0 && (
                    <div>
                      <label className="block text-sm font-medium text-content-muted">
                        Guardar numa caixinha? (opcional)
                      </label>
                      <select
                        value={goalId}
                        onChange={(e) => setGoalId(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                      >
                        <option value="">Nenhuma</option>
                        {goals
                          .filter(g => !targetEntityId || g.entityId === targetEntityId)
                          .map(g => <option key={g.id} value={g.id}>{g.name}</option>)}
                      </select>
                      <p className="mt-1 text-xs text-content-subtle">
                        Marcando aqui, o valor entra sozinho no progresso da caixinha.
                      </p>
                    </div>
                  )}

                  {!editingTransaction && (
                    <div className="space-y-4">
                      <div className="rounded-xl bg-canvas p-4">
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
                          <span className="text-sm font-bold text-content-muted flex items-center gap-2">
                            <Repeat className="h-4 w-4" /> Lançamento Parcelado?
                          </span>
                        </label>
                        
                        {isInstallment && (
                          <div className="mt-3">
                            <label className="block text-xs font-medium text-content-subtle">Número de Parcelas</label>
                            <input
                              type="number"
                              min="2"
                              max="72"
                              value={totalInstallments}
                              onChange={(e) => setTotalInstallments(e.target.value)}
                              className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                            />
                            <p className="mt-1 text-[10px] text-content-subtle">
                              Serão criados {totalInstallments} lançamentos de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(splitInstallments(Number(amount) || 0, Number(totalInstallments) || 1)[0])} cada.
                            </p>
                          </div>
                        )}
                      </div>

                      <div className="rounded-xl bg-canvas p-4">
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
                          <span className="text-sm font-bold text-content-muted flex items-center gap-2">
                            <Repeat className="h-4 w-4" /> Lançamento Recorrente?
                          </span>
                        </label>
                        
                        {isRecurring && (
                          <div className="mt-3">
                            <label className="block text-xs font-medium text-content-subtle">Frequência</label>
                            <select
                              value={recurringPeriod}
                              onChange={(e) => setRecurringPeriod(e.target.value as any)}
                              className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                            >
                              <option value="weekly">Semanal</option>
                              <option value="monthly">Mensal</option>
                              <option value="yearly">Anual</option>
                            </select>
                            <p className="mt-1 text-[10px] text-content-subtle">
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
                  onClick={() => { resetForm(); setIsModalOpen(false); }}
                  className="flex-1 rounded-lg border border-line py-2 text-sm font-semibold text-content-muted hover:bg-canvas"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  disabled={saving}
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-white hover:bg-primary/90 disabled:opacity-60 disabled:cursor-not-allowed"
                >
                  {saving ? 'Salvando...' : 'Confirmar Lançamento'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
      {/* Modal de pagamento: escolher de qual conta sai/entra o dinheiro + a data. */}
      {payingTx && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onClick={() => setPayingTx(null)}>
          <div className="w-full max-w-md rounded-2xl bg-surface p-6 shadow-2xl" onClick={e => e.stopPropagation()}>
            <h3 className="text-xl font-bold text-content">
              {payingTx.type === 'income' ? 'Registrar recebimento' : 'Registrar pagamento'}
            </h3>
            <p className="mt-1 text-sm text-content-subtle">
              {payingTx.description} — <strong>{new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(payingTx.amount)}</strong>
            </p>
            <p className="mt-2 text-xs text-content-subtle">
              {payingTx.type === 'income'
                ? 'O dinheiro entra na conta escolhida e o saldo sobe.'
                : 'O dinheiro sai da conta escolhida e o saldo cai.'}
            </p>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-content-subtle">
              {payingTx.type === 'income' ? 'Receber na conta' : 'Pagar com a conta'}
            </label>
            <select
              value={paySelAccount}
              onChange={e => setPaySelAccount(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-content"
            >
              <option value="">Selecione a conta...</option>
              {accounts.filter(a => a.entityId === payingTx.entityId).map(a => (
                <option key={a.id} value={a.id}>{a.bankName}</option>
              ))}
            </select>

            <label className="mt-4 block text-xs font-bold uppercase tracking-wider text-content-subtle">Data</label>
            <input
              type="date"
              value={paySelDate}
              onChange={e => setPaySelDate(e.target.value)}
              className="mt-1 w-full rounded-lg border border-line bg-canvas px-3 py-2 text-sm text-content"
            />

            {accounts.filter(a => a.entityId === payingTx.entityId).length === 0 && (
              <p className="mt-3 text-xs text-red-500">Nenhuma conta cadastrada para esta entidade. Cadastre uma em "Contas" primeiro.</p>
            )}

            <div className="mt-6 flex gap-3">
              <button onClick={() => setPayingTx(null)} className="flex-1 rounded-lg border border-line px-4 py-2 text-sm font-semibold text-content-subtle hover:bg-surface-muted">
                Cancelar
              </button>
              <button onClick={confirmPay} className="flex-1 rounded-lg bg-emerald-500 px-4 py-2 text-sm font-bold text-white hover:bg-emerald-600 disabled:opacity-50">
                {payingTx.type === 'income' ? 'Confirmar recebimento' : 'Confirmar pagamento'}
              </button>
            </div>
          </div>
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
