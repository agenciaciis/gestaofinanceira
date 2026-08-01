import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { BankAccount, Transaction } from '../types';
import { Plus, Landmark, Trash2, Edit2, Wallet, X } from 'lucide-react';
import { ColorField } from '../components/ColorField';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { normalizeHex, readableForeground } from '../lib/brandColors';
import { computeBalances } from '../lib/finance';
import { ViewToggle, useViewMode, DataTable, Column } from '../components/ViewToggle';

export const BankAccounts: React.FC = () => {
  const { selectedEntity } = useEntity();
  const { showToast, confirm } = useUI();
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingAccount, setEditingAccount] = useState<BankAccount | null>(null);
  const [loading, setLoading] = useState(true);

  // Form state
  const [bankName, setBankName] = useState('');
  const [color, setColor] = useState('');
  const [viewMode, setViewMode] = useViewMode('contas', 'grid');
  const [type, setType] = useState<'corrente' | 'poupanca' | 'investimento' | 'caixa' | 'reserva'>('corrente');
  const [initialBalance, setInitialBalance] = useState('');

  useEffect(() => {
    if (!selectedEntity) return;

    const qAccounts = query(collection(db, `entities/${selectedEntity.id}/bank_accounts`));
    const unsubAccounts = onSnapshot(qAccounts, (snapshot) => {
      setAccounts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as BankAccount[]);
      setLoading(false);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/bank_accounts`));

    const qTx = query(collection(db, `entities/${selectedEntity.id}/transactions`));
    const unsubTx = onSnapshot(qTx, (snapshot) => {
      setTransactions(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Transaction[]);
    }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/transactions`));

    return () => { unsubAccounts(); unsubTx(); };
  }, [selectedEntity]);

  // Saldo é SEMPRE calculado a partir das transações concluídas (fonte da verdade).
  const balances = computeBalances(accounts, transactions);
  const getBalance = (account: BankAccount) =>
    account.id in balances ? balances[account.id] : (account.currentBalance ?? account.initialBalance ?? 0);

  const summary = accounts.reduce((acc, curr) => {
    const bal = getBalance(curr);
    acc[curr.type] = (acc[curr.type] || 0) + bal;
    acc.total = (acc.total || 0) + bal;
    return acc;
  }, {} as Record<string, number>);

  const resetForm = () => {
    setBankName('');
    setColor('');
    setType('corrente');
    setInitialBalance('');
    setEditingAccount(null);
  };

  const handleEdit = (account: BankAccount) => {
    setEditingAccount(account);
    setBankName(account.bankName);
    setColor(account.color || '');
    setType(account.type);
    setInitialBalance(String(account.initialBalance ?? ''));
    setIsModalOpen(true);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntity) return;

    try {
      if (editingAccount) {
        await updateDoc(doc(db, `entities/${selectedEntity.id}/bank_accounts`, editingAccount.id), {
          bankName,
          color: normalizeHex(color) || null,
          type,
          initialBalance: Number(initialBalance),
        });
        showToast('Conta bancária atualizada com sucesso!', 'success');
      } else {
        await addDoc(collection(db, `entities/${selectedEntity.id}/bank_accounts`), {
          bankName,
          color: normalizeHex(color) || null,
          type,
          initialBalance: Number(initialBalance),
          currentBalance: Number(initialBalance),
          entityId: selectedEntity.id,
          ownerUid: selectedEntity.ownerUid,
          collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
          createdAt: serverTimestamp(),
        });
        showToast('Conta bancária cadastrada com sucesso!', 'success');
      }
      setIsModalOpen(false);
      resetForm();
    } catch (error) {
      console.error("Error saving account:", error);
      showToast('Erro ao salvar conta bancária.', 'error');
    }
  };

  const handleDelete = async (id: string) => {
    if (!selectedEntity) return;
    const confirmed = await confirm({
      title: 'Excluir Conta',
      message: 'Tem certeza que deseja excluir esta conta bancária?',
      variant: 'danger'
    });
    if (!confirmed) return;
    
    try {
      await deleteDoc(doc(db, `entities/${selectedEntity.id}/bank_accounts`, id));
      showToast('Conta bancária excluída com sucesso.', 'success');
    } catch (error) {
      console.error("Error deleting account:", error);
      showToast('Erro ao excluir conta bancária.', 'error');
    }
  };

  const getTypeLabel = (type: string) => {
    switch (type) {
      case 'corrente': return 'Conta Corrente';
      case 'poupanca': return 'Poupança';
      case 'investimento': return 'Investimento';
      case 'caixa': return 'Caixa (Dinheiro)';
      case 'reserva': return 'Reserva de Emergência';
      default: return type;
    }
  };

  const brl = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);

  const colunasContas: Column<BankAccount>[] = [
    {
      chave: 'banco', titulo: 'Conta',
      render: (a) => (
        <span className="flex items-center gap-2">
          <span className="h-3 w-3 shrink-0 rounded-full border border-line"
            style={{ backgroundColor: normalizeHex(a.color) || '#94a3b8' }} />
          <span className="font-bold text-content">{a.bankName}</span>
        </span>
      ),
    },
    { chave: 'tipo', titulo: 'Tipo', escondeNoMobile: true, render: (a) => getTypeLabel(a.type) },
    { chave: 'inicial', titulo: 'Saldo inicial', numerico: true, escondeNoMobile: true, render: (a) => brl(a.initialBalance) },
    {
      chave: 'saldo', titulo: 'Saldo atual', numerico: true,
      render: (a) => (
        <span className={cn('font-black', getBalance(a) < 0 ? 'text-rose-600' : 'text-content')}>
          {brl(getBalance(a))}
        </span>
      ),
    },
  ];

  return (
    <div className="space-y-8">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-3xl font-black text-content tracking-tight">Contas & Caixas</h2>
          <p className="text-sm font-medium text-content-subtle">Gestão centralizada de toda sua liquidez.</p>
        </div>
        <div className="flex items-center gap-3">
          <ViewToggle mode={viewMode} onChange={setViewMode} />
          <button
            onClick={() => { resetForm(); setIsModalOpen(true); }}
            className="flex items-center gap-2 rounded-xl bg-primary px-5 py-2.5 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
          >
            <Plus className="h-4 w-4" />
            Nova Conta
          </button>
        </div>
      </div>

      {/* Summary Cards */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-5">
        <div className="rounded-2xl bg-surface p-4 shadow-sm border border-line">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Total Consolidado</p>
          <p className="mt-1 text-xl font-black text-content">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.total || 0)}
          </p>
        </div>
        <div className="rounded-2xl bg-surface p-4 shadow-sm border border-line">
          <p className="text-[10px] font-black uppercase tracking-widest text-emerald-400">Disponível (Corrente)</p>
          <p className="mt-1 text-xl font-black text-emerald-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.corrente || 0)}
          </p>
        </div>
        <div className="rounded-2xl bg-surface p-4 shadow-sm border border-line">
          <p className="text-[10px] font-black uppercase tracking-widest text-blue-400">Investimentos</p>
          <p className="mt-1 text-xl font-black text-blue-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.investimento || 0)}
          </p>
        </div>
        <div className="rounded-2xl bg-surface p-4 shadow-sm border border-line">
          <p className="text-[10px] font-black uppercase tracking-widest text-amber-400">Reserva</p>
          <p className="mt-1 text-xl font-black text-amber-600">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.reserva || 0)}
          </p>
        </div>
        <div className="rounded-2xl bg-surface p-4 shadow-sm border border-line">
          <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Caixa Físico</p>
          <p className="mt-1 text-xl font-black text-content-muted">
            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(summary.caixa || 0)}
          </p>
        </div>
      </div>

      {viewMode === 'list' && (
        <DataTable
          itens={accounts}
          colunas={colunasContas}
          acoes={(a) => (
            <>
              <button onClick={() => handleEdit(a)} title="Editar"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                <Edit2 className="h-4 w-4" />
              </button>
              <button onClick={() => handleDelete(a.id)} title="Excluir"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-rose-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          vazio={<p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhuma conta cadastrada.</p>}
        />
      )}

      {viewMode === 'grid' && <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {accounts.map((account) => (
          <motion.div 
            key={account.id}
            initial={{ opacity: 0, scale: 0.95 }}
            animate={{ opacity: 1, scale: 1 }}
            className="group relative overflow-hidden rounded-3xl bg-surface p-6 shadow-sm border border-line hover:shadow-xl hover:border-primary/20 transition-all"
          >
            {/* Faixa com a cor do banco. A conta segue o tema (fundo claro ou
                escuro), então a cor entra como acento — pintar o card inteiro
                brigaria com o tema e atrapalharia a leitura do saldo. */}
            {normalizeHex(account.color) && (
              <div
                className="absolute inset-x-0 top-0 h-1.5"
                style={{ backgroundColor: normalizeHex(account.color)! }}
              />
            )}
            <div className="flex items-center justify-between">
              <div
                className={cn(
                  "flex h-12 w-12 items-center justify-center rounded-2xl",
                  !normalizeHex(account.color) && (
                    account.type === 'investimento' ? "bg-blue-50 text-blue-600" :
                    account.type === 'reserva' ? "bg-amber-50 text-amber-600" :
                    account.type === 'caixa' ? "bg-surface-muted text-content-muted" : "bg-emerald-50 text-emerald-600"
                  )
                )}
                style={normalizeHex(account.color) ? {
                  backgroundColor: normalizeHex(account.color)!,
                  color: readableForeground(normalizeHex(account.color)!),
                } : undefined}
              >
                <Landmark className="h-6 w-6" />
              </div>
              <div className="flex gap-2 opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={() => handleEdit(account)}
                  className="p-2 rounded-lg hover:bg-surface-muted text-content-subtle hover:text-primary transition-colors"
                >
                  <Edit2 className="h-4 w-4" />
                </button>
                <button 
                  onClick={() => handleDelete(account.id)}
                  className="p-2 rounded-lg hover:bg-rose-50 text-content-subtle hover:text-rose-600 transition-colors"
                >
                  <Trash2 className="h-4 w-4" />
                </button>
              </div>
            </div>
            <div className="mt-6">
              <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">
                {getTypeLabel(account.type)}
              </p>
              <h3 className="text-lg font-black text-content mt-1">{account.bankName}</h3>
              <div className="mt-4 flex items-baseline gap-1">
                <span className="text-sm font-bold text-content-subtle">R$</span>
                <p className={cn(
                  "text-3xl font-black tracking-tight",
                  getBalance(account) < 0 ? "text-rose-600" : "text-content"
                )}>
                  {new Intl.NumberFormat('pt-BR', { minimumFractionDigits: 2 }).format(getBalance(account))}
                </p>
              </div>
            </div>
          </motion.div>
        ))}

        {accounts.length === 0 && !loading && (
          <div className="col-span-full flex flex-col items-center justify-center rounded-2xl border-2 border-dashed border-line p-12 text-center">
            <div className="mb-4 rounded-full bg-canvas p-4">
              <Wallet className="h-8 w-8 text-content-subtle" />
            </div>
            <h3 className="text-lg font-bold text-content">Nenhuma conta cadastrada</h3>
            <p className="mt-1 text-content-subtle">Comece cadastrando sua primeira conta bancária.</p>
            <button 
              onClick={() => { resetForm(); setIsModalOpen(true); }}
              className="mt-6 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white"
            >
              Cadastrar Agora
            </button>
          </div>
        )}
      </div>}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4" onClick={() => { setIsModalOpen(false); resetForm(); }}>
          <motion.div
            initial={{ opacity: 0, scale: 0.98 }}
            animate={{ opacity: 1, scale: 1 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-3xl max-h-[92vh] overflow-y-auto rounded-2xl bg-surface p-6 sm:p-8 shadow-2xl"
          >
            <button type="button" aria-label="Fechar" onClick={() => { setIsModalOpen(false); resetForm(); }}
              className="absolute right-4 top-4 z-10 rounded-xl p-2 text-content-subtle hover:bg-surface-muted hover:text-content">
              <X className="h-5 w-5" />
            </button>
            <h3 className="text-xl font-bold text-content pr-10">{editingAccount ? 'Editar Conta Bancária' : 'Nova Conta Bancária'}</h3>
            <form onSubmit={handleSubmit} className="mt-6 space-y-4">
              <div>
                <label className="block text-sm font-medium text-content-muted">Nome do Banco</label>
                <input
                  type="text"
                  value={bankName}
                  onChange={(e) => setBankName(e.target.value)}
                  placeholder="Ex: Nubank, Itaú, Bradesco"
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                  required
                />
              </div>

              <div>
                <div className="flex items-center justify-between">
                  <label className="block text-sm font-medium text-content-muted">Cor do banco</label>
                  {color && (
                    <button type="button" onClick={() => setColor('')} className="text-xs font-bold text-content-subtle hover:text-rose-600">
                      Sem cor
                    </button>
                  )}
                </div>
                <div className="mt-2">
                  <ColorField value={color} onChange={setColor} />
                </div>
              </div>
              <div>
                <label className="block text-sm font-medium text-content-muted">Tipo de Conta</label>
                <select 
                  value={type}
                  onChange={(e) => setType(e.target.value as any)}
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                >
                  <option value="corrente">Conta Corrente</option>
                  <option value="poupanca">Poupança</option>
                  <option value="investimento">Investimento</option>
                  <option value="caixa">Caixa (Dinheiro Físico)</option>
                  <option value="reserva">Reserva de Emergência</option>
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-content-muted">Saldo Inicial</label>
                <div className="relative mt-1">
                  <span className="absolute left-4 top-2 text-content-subtle">R$</span>
                  <input
                    type="number"
                    step="0.01"
                    value={initialBalance}
                    onChange={(e) => setInitialBalance(e.target.value)}
                    placeholder="0,00"
                    className="w-full rounded-lg border border-line pl-10 pr-4 py-2 focus:border-primary focus:ring-1 focus:ring-primary outline-none"
                    required
                  />
                </div>
              </div>
              <div className="mt-8 flex gap-3">
                <button
                  type="button"
                  onClick={() => { setIsModalOpen(false); resetForm(); }}
                  className="flex-1 rounded-lg border border-line py-2 text-sm font-semibold text-content-muted hover:bg-canvas"
                >
                  Cancelar
                </button>
                <button
                  type="submit"
                  className="flex-1 rounded-lg bg-primary py-2 text-sm font-semibold text-white hover:bg-primary/90"
                >
                  {editingAccount ? 'Salvar Alterações' : 'Salvar Conta'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
