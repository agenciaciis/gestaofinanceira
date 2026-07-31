import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Supplier } from '../types';
import { 
  Plus, 
  Search, 
  Truck, 
  Mail, 
  Phone, 
  CreditCard, 
  Edit2, 
  Trash2,
  X,
  Building2,
  UserCircle,
  Package,
  Image as ImageIcon,
  Banknote,
  Copy,
  Check
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { ViewToggle, useViewMode, DataTable, Column } from '../components/ViewToggle';

const SUPPLIER_CATEGORIES = [
  { id: 'imobiliaria', name: 'Imobiliária', icon: Building2 },
  { id: 'funcionario', name: 'Funcionário', icon: UserCircle },
  { id: 'produtos', name: 'Produtos', icon: Package },
  { id: 'banco_imagem', name: 'Banco de Imagem', icon: ImageIcon },
  { id: 'servicos', name: 'Serviços', icon: Truck },
  { id: 'outros', name: 'Outros', icon: Banknote },
];

export const Suppliers: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { showToast, confirm } = useUI();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingSupplier, setEditingSupplier] = useState<Supplier | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useViewMode('fornecedores', 'grid');
  const [loading, setLoading] = useState(true);
  const [copiedId, setCopiedId] = useState<string | null>(null);

  // Form state
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [cnpjOrCpf, setCnpjOrCpf] = useState('');
  const [email, setEmail] = useState('');
  const [phone, setPhone] = useState('');
  const [pixKey, setPixKey] = useState('');
  const [bank, setBank] = useState('');
  const [agency, setAgency] = useState('');
  const [account, setAccount] = useState('');
  const [targetEntityId, setTargetEntityId] = useState('');

  useEffect(() => {
    if (entities.length === 0) return;

    const filteredEntities = filterType === 'ALL' 
      ? entities 
      : entities.filter(e => e.type === filterType);

    const unsubscribes: (() => void)[] = [];
    let allSuppliers: Supplier[] = [];

    filteredEntities.forEach(entity => {
      const q = query(collection(db, `entities/${entity.id}/suppliers`), orderBy('createdAt', 'desc'));
      const unsub = onSnapshot(q, (snapshot) => {
        const entitySuppliers = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Supplier[];
        allSuppliers = [...allSuppliers.filter(s => s.entityId !== entity.id), ...entitySuppliers];
        setSuppliers([...allSuppliers]);
      }, (error) => {
        console.error(`Error fetching suppliers for entity ${entity.id}:`, error);
        handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/suppliers`);
      });
      unsubscribes.push(unsub);
    });

    setLoading(false);
    return () => unsubscribes.forEach(unsub => unsub());
  }, [entities, filterType]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEntityId) return;

    try {
      const selectedEntity = entities.find(e => e.id === targetEntityId);
      const supplierData = {
        name,
        category,
        cnpjOrCpf,
        email,
        phone,
        pixKey,
        bankInfo: {
          bank,
          agency,
          account
        },
        entityId: targetEntityId,
        ownerUid: selectedEntity?.ownerUid,
        collaboratorsEmails: selectedEntity?.collaboratorsEmails || [],
        updatedAt: serverTimestamp()
      };

      if (editingSupplier) {
        await updateDoc(doc(db, `entities/${editingSupplier.entityId}/suppliers/${editingSupplier.id}`), supplierData);
      } else {
        await addDoc(collection(db, `entities/${targetEntityId}/suppliers`), {
          ...supplierData,
          createdAt: serverTimestamp()
        });
      }

      setIsModalOpen(false);
      resetForm();
      showToast(`${editingSupplier ? 'Cadastro atualizado' : 'Fornecedor cadastrado'} com sucesso!`, 'success');
    } catch (error) {
      console.error("Error saving supplier:", error);
      showToast('Erro ao salvar fornecedor.', 'error');
    }
  };

  const handleEdit = (supplier: Supplier) => {
    setEditingSupplier(supplier);
    setName(supplier.name);
    setCategory(supplier.category);
    setCnpjOrCpf(supplier.cnpjOrCpf || '');
    setEmail(supplier.email || '');
    setPhone(supplier.phone || '');
    setPixKey(supplier.pixKey || '');
    setBank(supplier.bankInfo?.bank || '');
    setAgency(supplier.bankInfo?.agency || '');
    setAccount(supplier.bankInfo?.account || '');
    setTargetEntityId(supplier.entityId);
    setIsModalOpen(true);
  };

  const handleDelete = async (supplier: Supplier) => {
    const confirmed = await confirm({
      title: 'Excluir Fornecedor',
      message: `Tem certeza que deseja excluir ${supplier.name}?`,
      variant: 'danger'
    });
    if (!confirmed) return;
    
    try {
      await deleteDoc(doc(db, `entities/${supplier.entityId}/suppliers/${supplier.id}`));
      showToast('Fornecedor excluído com sucesso.', 'success');
    } catch (error) {
      console.error("Error deleting supplier:", error);
      showToast('Erro ao excluir fornecedor.', 'error');
    }
  };

  const resetForm = () => {
    setEditingSupplier(null);
    setName('');
    setCategory('');
    setCnpjOrCpf('');
    setEmail('');
    setPhone('');
    setPixKey('');
    setBank('');
    setAgency('');
    setAccount('');
    setTargetEntityId('');
  };

  const copyToClipboard = (text: string, id: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filteredSuppliers = suppliers.filter(s => 
    (s.name || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    (s.category || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
    s.cnpjOrCpf?.includes(searchTerm)
  );

  const colunasFornecedores: Column<Supplier>[] = [
    { chave: 'nome', titulo: 'Nome', render: (f) => <span className="font-bold text-content">{f.name}</span> },
    {
      chave: 'categoria', titulo: 'Categoria',
      render: (f) => SUPPLIER_CATEGORIES.find(c => c.id === f.category)?.name || f.category || '—',
    },
    { chave: 'doc', titulo: 'CNPJ / CPF', escondeNoMobile: true, render: (f) => f.cnpjOrCpf || '—' },
    { chave: 'contato', titulo: 'Contato', escondeNoMobile: true, render: (f) => f.phone || f.email || '—' },
    { chave: 'pix', titulo: 'Chave PIX', escondeNoMobile: true, render: (f) => f.pixKey || '—' },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-[2.5rem] bg-amber-50 dark:bg-gradient-to-br dark:from-amber-900 dark:to-orange-950 p-8 text-amber-900 dark:text-white shadow-xl shadow-amber-100 dark:shadow-none relative overflow-hidden border border-amber-100 dark:border-amber-900/30">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-surface dark:bg-white/10 backdrop-blur-md border border-amber-200 dark:border-white/30 shadow-inner">
              <Truck className="h-10 w-10 text-amber-600 dark:text-white" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-amber-500 dark:text-white/60">Agência CIIS</span>
              <h2 className="text-4xl font-black tracking-tighter">Fornecedores & Locais</h2>
              <p className="text-sm font-medium text-amber-700 dark:text-white/80 mt-1">Cadastre locais e pessoas que você precisa pagar.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <button
              onClick={() => { resetForm(); setIsModalOpen(true); }}
              className="flex items-center justify-center gap-2 rounded-2xl bg-amber-600 px-8 py-4 text-sm font-black text-white shadow-xl hover:bg-amber-700 transition-all transform hover:scale-105 active:scale-95"
            >
              <Plus className="h-5 w-5" />
              Novo Cadastro
            </button>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-amber-400/20 blur-2xl" />
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle" />
        <input
          type="text"
          placeholder="Buscar por nome, categoria ou documento..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-xl border border-line bg-surface py-3 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all"
        />
      </div>

      {viewMode === 'list' && (
        <DataTable
          itens={filteredSuppliers}
          colunas={colunasFornecedores}
          acoes={(f) => (
            <>
              <button onClick={() => handleEdit(f)} title="Editar"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                <Edit2 className="h-4 w-4" />
              </button>
              <button onClick={() => handleDelete(f)} title="Excluir"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-rose-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          vazio={<p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhum cadastro encontrado.</p>}
        />
      )}

      {viewMode === 'grid' && <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {filteredSuppliers.map((supplier) => {
            const CategoryIcon = SUPPLIER_CATEGORIES.find(c => c.id === supplier.category)?.icon || Banknote;
            return (
              <motion.div
                key={supplier.id}
                layout
                initial={{ opacity: 0, scale: 0.9 }}
                animate={{ opacity: 1, scale: 1 }}
                exit={{ opacity: 0, scale: 0.9 }}
                className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-sm hover:shadow-md transition-all"
              >
                <div className="flex items-start justify-between">
                  <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-canvas text-content-muted group-hover:bg-primary/10 group-hover:text-primary transition-colors">
                    <CategoryIcon className="h-6 w-6" />
                  </div>
                  <div className="flex gap-2">
                    <button onClick={() => handleEdit(supplier)} className="rounded-lg p-2 text-content-subtle hover:bg-canvas hover:text-primary transition-all">
                      <Edit2 className="h-4 w-4" />
                    </button>
                    <button onClick={() => handleDelete(supplier)} className="rounded-lg p-2 text-content-subtle hover:bg-red-50 hover:text-red-600 transition-all">
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="mt-4">
                  <span className="text-[10px] font-bold uppercase tracking-wider text-primary bg-primary/5 px-2 py-0.5 rounded-full">
                    {SUPPLIER_CATEGORIES.find(c => c.id === supplier.category)?.name || 'Outros'}
                  </span>
                  <h3 className="mt-2 text-lg font-bold text-content">{supplier.name}</h3>
                  {supplier.cnpjOrCpf && (
                    <p className="text-[10px] text-content-subtle font-medium mt-1">Doc: {supplier.cnpjOrCpf}</p>
                  )}
                </div>

                <div className="mt-4 space-y-2 border-t border-gray-50 pt-4">
                  {supplier.pixKey && (
                    <div className="flex items-center justify-between rounded-lg bg-blue-50/50 p-2">
                      <div className="flex items-center gap-2 overflow-hidden">
                        <div className="h-6 w-6 shrink-0 flex items-center justify-center rounded bg-blue-100 text-blue-600 text-[10px] font-bold">PIX</div>
                        <span className="text-xs font-medium text-blue-700 truncate">{supplier.pixKey}</span>
                      </div>
                      <button 
                        onClick={() => copyToClipboard(supplier.pixKey!, supplier.id)}
                        className="text-blue-400 hover:text-blue-600 shrink-0"
                      >
                        {copiedId === supplier.id ? <Check className="h-4 w-4" /> : <Copy className="h-4 w-4" />}
                      </button>
                    </div>
                  )}

                  {supplier.bankInfo?.bank && (
                    <div className="rounded-lg border border-line p-2 space-y-1">
                      <p className="text-[8px] font-bold uppercase text-content-subtle">Dados Bancários</p>
                      <p className="text-xs font-bold text-content-muted">{supplier.bankInfo.bank}</p>
                      <div className="flex gap-4 text-[10px] text-content-subtle">
                        <span>Ag: {supplier.bankInfo.agency}</span>
                        <span>Cc: {supplier.bankInfo.account}</span>
                      </div>
                    </div>
                  )}

                  <div className="flex items-center gap-4 text-content-subtle mt-2">
                    {supplier.email && <Mail className="h-4 w-4" title={supplier.email} />}
                    {supplier.phone && <Phone className="h-4 w-4" title={supplier.phone} />}
                  </div>
                </div>

                <div className="absolute bottom-0 left-0 h-1 w-full bg-surface-muted group-hover:bg-primary transition-colors" />
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-3xl rounded-2xl bg-surface shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
          >
            <div className="p-6 border-b flex items-center justify-between bg-gray-50/50">
              <h3 className="text-xl font-bold text-content">
                {editingSupplier ? 'Editar Cadastro' : 'Novo Fornecedor/Local'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted transition-all">
                <X className="h-5 w-5" />
              </button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4 max-h-[80vh] overflow-y-auto">
              <div>
                <label className="block text-sm font-medium text-content-muted">Entidade Responsável</label>
                <select 
                  value={targetEntityId}
                  onChange={(e) => setTargetEntityId(e.target.value)}
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                  required
                >
                  <option value="">Selecione...</option>
                  {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                </select>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Nome / Razão Social</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" required />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Categoria</label>
                  <select 
                    value={category}
                    onChange={(e) => setCategory(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20"
                    required
                  >
                    <option value="">Selecione...</option>
                    {SUPPLIER_CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-content-muted">CNPJ ou CPF</label>
                  <input type="text" value={cnpjOrCpf} onChange={(e) => setCnpjOrCpf(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Telefone</label>
                  <input type="text" value={phone} onChange={(e) => setPhone(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-content-muted">Chave PIX</label>
                <input type="text" value={pixKey} onChange={(e) => setPixKey(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="CPF, Email, Telefone ou Aleatória" />
              </div>

              <div className="rounded-xl bg-canvas p-4 space-y-4">
                <p className="text-xs font-bold text-content-subtle uppercase tracking-wider">Dados Bancários (DOC/TED)</p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <div className="sm:col-span-1">
                    <label className="block text-[10px] font-bold text-content-subtle">Banco</label>
                    <input type="text" value={bank} onChange={(e) => setBank(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-content-subtle">Agência</label>
                    <input type="text" value={agency} onChange={(e) => setAgency(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-content-subtle">Conta</label>
                    <input type="text" value={account} onChange={(e) => setAccount(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm" />
                  </div>
                </div>
              </div>

              <div className="flex gap-3 pt-6">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-content-muted hover:bg-canvas">Cancelar</button>
                <button type="submit" className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90 shadow-md shadow-primary/20">
                  {editingSupplier ? 'Salvar Alterações' : 'Cadastrar'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
