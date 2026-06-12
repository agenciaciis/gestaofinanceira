import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Client } from '../types';
import { 
  Plus, 
  Search, 
  User, 
  Mail, 
  MapPin, 
  ExternalLink, 
  Instagram, 
  Facebook, 
  Globe, 
  Linkedin, 
  Layout, 
  Edit2, 
  Trash2,
  Share2,
  Key,
  Chrome,
  ShieldCheck,
  Info,
  X,
  FileCheck,
  Download,
  Calendar,
  BarChart2,
  DollarSign,
  Clock,
  Activity
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { 
  BarChart, 
  Bar, 
  XAxis, 
  YAxis, 
  CartesianGrid, 
  Tooltip, 
  ResponsiveContainer,
  Cell
} from 'recharts';
import { format, parseISO, startOfMonth } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import { cn } from '../lib/utils';
import { useTheme } from '../contexts/ThemeContext';

export const Clients: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { showToast, confirm } = useUI();
  const { theme } = useTheme();
  const [clients, setClients] = useState<Client[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingClient, setEditingClient] = useState<Client | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'info' | 'credentials' | 'contracts'>('info');

  // Form state
  const [name, setName] = useState('');
  const [cnpj, setCnpj] = useState('');
  const [responsibleName, setResponsibleName] = useState('');
  const [cpf, setCpf] = useState('');
  const [email, setEmail] = useState('');
  const [address, setAddress] = useState('');
  const [drivePath, setDrivePath] = useState('');
  const [targetEntityId, setTargetEntityId] = useState('');
  const [credentials, setCredentials] = useState({
    instagram: '',
    facebook: '',
    googleAds: '',
    linkedin: '',
    meta: '',
    wordpress: '',
    site: '',
    others: ''
  });
  const [contracts, setContracts] = useState<{ 
    id: string; 
    name: string; 
    url: string; 
    signedAt: string;
    value?: number;
    expirationDate?: string;
    status?: 'active' | 'inactive';
  }[]>([]);
  
  const maskCpf = (value: string) => {
    return value
      .replace(/\D/g, '')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d{1,2})/, '$1-$2')
      .replace(/(-\d{2})\d+?$/, '$1');
  };

  const maskCnpj = (value: string) => {
    return value
      .replace(/\D/g, '')
      .replace(/(\d{2})(\d)/, '$1.$2')
      .replace(/(\d{3})(\d)/, '$1.$3')
      .replace(/(\d{3})(\d)/, '$1/$2')
      .replace(/(\d{4})(\d)/, '$1-$2')
      .replace(/(-\d{2})\d+?$/, '$1');
  };

  useEffect(() => {
    if (entities.length === 0) return;

    const filteredEntities = filterType === 'ALL' 
      ? entities 
      : entities.filter(e => e.type === filterType);

    const unsubscribes: (() => void)[] = [];
    let allClients: Client[] = [];

    filteredEntities.forEach(entity => {
      const q = query(collection(db, `entities/${entity.id}/clients`), orderBy('createdAt', 'desc'));
      const unsub = onSnapshot(q, (snapshot) => {
        const entityClients = snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Client[];
        allClients = [...allClients.filter(c => c.entityId !== entity.id), ...entityClients];
        setClients([...allClients]);
      }, (error) => {
        console.error(`Error fetching clients for entity ${entity.id}:`, error);
        handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/clients`);
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
      const clientData = {
        name,
        cnpj,
        responsibleName,
        cpf,
        email,
        address,
        drivePath,
        credentials,
        contracts,
        entityId: targetEntityId,
        ownerUid: selectedEntity?.ownerUid,
        collaboratorsEmails: selectedEntity?.collaboratorsEmails || [],
        updatedAt: serverTimestamp()
      };

      if (editingClient) {
        await updateDoc(doc(db, `entities/${editingClient.entityId}/clients/${editingClient.id}`), clientData);
      } else {
        await addDoc(collection(db, `entities/${targetEntityId}/clients`), {
          ...clientData,
          createdAt: serverTimestamp()
        });
      }

      setIsModalOpen(false);
      resetForm();
      showToast(`Cliente ${editingClient ? 'atualizado' : 'cadastrado'} com sucesso!`, 'success');
    } catch (error) {
      console.error("Error saving client:", error);
      showToast('Erro ao salvar cliente.', 'error');
    }
  };

  const handleEdit = (client: Client) => {
    setEditingClient(client);
    setName(client.name);
    setCnpj(client.cnpj || '');
    setResponsibleName(client.responsibleName || '');
    setCpf(client.cpf || '');
    setEmail(client.email || '');
    setAddress(client.address || '');
    setDrivePath(client.drivePath || '');
    setTargetEntityId(client.entityId);
    setCredentials(client.credentials);
    setContracts(client.contracts || []);
    setActiveTab('info');
    setIsModalOpen(true);
  };

  const handleDelete = async (client: Client) => {
    const confirmed = await confirm({
      title: 'Excluir Cliente',
      message: `Tem certeza que deseja excluir o cliente ${client.name}?`,
      variant: 'danger'
    });
    if (!confirmed) return;
    
    try {
      await deleteDoc(doc(db, `entities/${client.entityId}/clients/${client.id}`));
      showToast('Cliente excluído com sucesso.', 'success');
    } catch (error) {
      console.error("Error deleting client:", error);
      showToast('Erro ao excluir cliente.', 'error');
    }
  };

  const resetForm = () => {
    setEditingClient(null);
    setName('');
    setCnpj('');
    setResponsibleName('');
    setCpf('');
    setEmail('');
    setAddress('');
    setDrivePath('');
    setTargetEntityId('');
    setCredentials({
      instagram: '',
      facebook: '',
      googleAds: '',
      linkedin: '',
      meta: '',
      wordpress: '',
      site: '',
      others: ''
    });
    setContracts([]);
    setActiveTab('info');
  };

  const addContract = () => {
    setContracts([...contracts, { 
      id: crypto.randomUUID(), 
      name: '', 
      url: '', 
      signedAt: new Date().toISOString().split('T')[0],
      value: 0,
      expirationDate: '',
      status: 'active'
    }]);
  };

  const updateContract = (id: string, field: string, value: string) => {
    setContracts(contracts.map(c => c.id === id ? { ...c, [field]: value } : c));
  };

  const removeContract = (id: string) => {
    setContracts(contracts.filter(c => c.id !== id));
  };

  const filteredClients = clients.filter(c => 
    c.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.email?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.cnpj?.includes(searchTerm) ||
    c.responsibleName?.toLowerCase().includes(searchTerm.toLowerCase()) ||
    c.cpf?.includes(searchTerm)
  );

  const getContractChartData = (contracts: any[]) => {
    if (!contracts || contracts.length === 0) return [];
    
    const months: Record<string, { count: number; date: Date }> = {};
    
    contracts.forEach(contract => {
      if (contract.signedAt) {
        try {
          const date = parseISO(contract.signedAt);
          const monthKey = format(date, 'MMM/yy', { locale: ptBR });
          if (!months[monthKey]) {
            months[monthKey] = { count: 0, date: startOfMonth(date) };
          }
          months[monthKey].count++;
        } catch (e) {
          console.error("Error parsing date:", contract.signedAt);
        }
      }
    });

    return Object.entries(months)
      .map(([name, data]) => ({ name, count: data.count, date: data.date }))
      .sort((a, b) => a.date.getTime() - b.date.getTime());
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Gestão de Clientes</h2>
          <p className="text-sm text-gray-500">Gerencie informações, acessos e contratos dos seus clientes.</p>
        </div>
        <button 
          onClick={() => { resetForm(); setIsModalOpen(true); }}
          className="flex items-center gap-2 rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-white shadow-md hover:bg-primary/90 transition-all"
        >
          <Plus className="h-4 w-4" />
          Novo Cliente
        </button>
      </div>

      <div className="relative">
        <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-gray-400" />
        <input
          type="text"
          placeholder="Buscar por nome, responsável, email, CNPJ ou CPF..."
          value={searchTerm}
          onChange={(e) => setSearchTerm(e.target.value)}
          className="w-full rounded-xl border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 py-3 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all text-gray-900 dark:text-gray-100"
        />
      </div>

      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        <AnimatePresence mode="popLayout">
          {filteredClients.map((client) => (
            <motion.div
              key={client.id}
              layout
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              className="group relative overflow-hidden rounded-2xl border border-gray-100 bg-white p-6 shadow-sm hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <User className="h-6 w-6" />
                </div>
                <div className="flex gap-2">
                  <button 
                    onClick={() => handleEdit(client)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-primary transition-all"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(client)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-600 transition-all"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="mt-4">
                <h3 className="text-lg font-bold text-gray-900">{client.name}</h3>
                <div className="flex flex-wrap gap-x-3 gap-y-1 mt-1">
                  {client.cnpj && (
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                      CNPJ: {client.cnpj}
                    </p>
                  )}
                  {client.cpf && (
                    <p className="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">
                      CPF: {client.cpf}
                    </p>
                  )}
                  {client.responsibleName && (
                    <p className="text-xs font-medium text-gray-600 w-full">
                      Resp: {client.responsibleName}
                    </p>
                  )}
                </div>
              </div>

              <div className="mt-4 space-y-2">
                {client.email && (
                  <div className="flex items-center gap-2 text-sm text-gray-600">
                    <Mail className="h-4 w-4 text-gray-400" />
                    {client.email}
                  </div>
                )}
                {client.drivePath && (
                  <a 
                    href={client.drivePath} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-2 text-sm text-primary hover:underline"
                  >
                    <Share2 className="h-4 w-4" />
                    Google Drive
                    <ExternalLink className="h-3 w-3" />
                  </a>
                )}
              </div>

              <div className="mt-6 pt-6 border-t border-gray-50 space-y-4">
                <div className="flex items-center justify-between">
                  <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Acessos</p>
                  <div className="flex flex-wrap gap-2">
                    {client.credentials.instagram && <Instagram className="h-4 w-4 text-pink-500" />}
                    {client.credentials.facebook && <Facebook className="h-4 w-4 text-blue-600" />}
                    {client.credentials.googleAds && <Chrome className="h-4 w-4 text-yellow-600" />}
                    {client.credentials.wordpress && <Layout className="h-4 w-4 text-gray-600" />}
                  </div>
                </div>

                {client.contracts && client.contracts.length > 0 && (
                  <div className="space-y-2">
                    <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Contratos Assinados</p>
                          <div className="space-y-1">
                            {client.contracts.map((contract) => (
                              <div key={contract.id} className="flex flex-col rounded-lg bg-gray-50 p-3 text-xs space-y-2">
                                <div className="flex items-center justify-between">
                                  <div className="flex items-center gap-2 truncate">
                                    <FileCheck className="h-3 w-3 text-green-600" />
                                    <span className="font-bold text-gray-700 truncate">{contract.name}</span>
                                  </div>
                                  <div className="flex gap-2 shrink-0 ml-2">
                                    <a 
                                      href={contract.url} 
                                      target="_blank" 
                                      rel="noopener noreferrer"
                                      className="rounded p-1 text-primary hover:bg-primary/10"
                                      title="Visualizar PDF"
                                    >
                                      <ExternalLink className="h-3 w-3" />
                                    </a>
                                    <a 
                                      href={contract.url} 
                                      download
                                      target="_blank"
                                      rel="noopener noreferrer"
                                      className="rounded p-1 text-gray-500 hover:bg-gray-200"
                                      title="Baixar"
                                    >
                                      <Download className="h-3 w-3" />
                                    </a>
                                  </div>
                                </div>
                                
                                <div className="grid grid-cols-2 gap-2 text-[10px]">
                                  <div className="flex items-center gap-1 text-gray-500">
                                    <Calendar className="h-3 w-3" />
                                    Assinado: {contract.signedAt ? format(parseISO(contract.signedAt), 'dd/MM/yyyy') : '-'}
                                  </div>
                                  {contract.expirationDate && (
                                    <div className="flex items-center gap-1 text-gray-500">
                                      <Clock className="h-3 w-3" />
                                      Expira: {format(parseISO(contract.expirationDate), 'dd/MM/yyyy')}
                                    </div>
                                  )}
                                  {contract.value !== undefined && (
                                    <div className="flex items-center gap-1 text-primary font-bold">
                                      <DollarSign className="h-3 w-3" />
                                      {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(contract.value)}
                                    </div>
                                  )}
                                  <div className="flex items-center gap-1">
                                    <Activity className="h-3 w-3 text-gray-400" />
                                    <span className={cn(
                                      "px-1.5 py-0.5 rounded-full font-bold uppercase",
                                      contract.status === 'active' ? "bg-green-100 text-green-700" : "bg-red-100 text-red-700"
                                    )}>
                                      {contract.status === 'active' ? 'Ativo' : 'Inativo'}
                                    </span>
                                  </div>
                                </div>
                              </div>
                            ))}
                          </div>
                  </div>
                )}

                {client.contracts && client.contracts.length > 0 && (
                  <div className="mt-4 pt-4 border-t border-gray-50">
                    <div className="flex items-center gap-2 mb-3">
                      <BarChart2 className="h-3 w-3 text-gray-400" />
                      <p className="text-[10px] font-bold uppercase tracking-wider text-gray-400">Distribuição Mensal</p>
                    </div>
                    <div className="h-32 w-full">
                      <ResponsiveContainer width="100%" height="100%">
                        <BarChart data={getContractChartData(client.contracts)}>
                          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke={theme === 'dark' ? '#1f2937' : '#f1f5f9'} />
                          <XAxis 
                            dataKey="name" 
                            axisLine={false} 
                            tickLine={false} 
                            tick={{ fill: theme === 'dark' ? '#64748b' : '#94a3b8', fontSize: 8, fontWeight: 700 }}
                          />
                          <YAxis hide />
                          <Tooltip 
                            contentStyle={{ 
                              borderRadius: '8px', 
                              border: 'none', 
                              boxShadow: '0 4px 6px -1px rgb(0 0 0 / 0.1)', 
                              padding: '8px',
                              backgroundColor: theme === 'dark' ? '#111827' : '#ffffff',
                              color: theme === 'dark' ? '#f9fafb' : '#111827'
                            }}
                            itemStyle={{ fontSize: '10px', fontWeight: 'bold', color: '#3b82f6' }}
                            labelStyle={{ fontSize: '8px', fontWeight: 'black', textTransform: 'uppercase', color: '#94a3b8', marginBottom: '4px' }}
                            cursor={{ fill: theme === 'dark' ? '#1f2937' : '#f8fafc' }}
                          />
                          <Bar 
                            dataKey="count" 
                            fill="#3b82f6" 
                            radius={[4, 4, 0, 0]} 
                            barSize={20}
                            name="Contratos"
                          />
                        </BarChart>
                      </ResponsiveContainer>
                    </div>
                  </div>
                )}
              </div>

              <div className="absolute bottom-0 left-0 h-1 w-full bg-primary/10 group-hover:bg-primary transition-colors" />
            </motion.div>
          ))}
        </AnimatePresence>
      </div>

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <motion.div 
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="w-full max-w-2xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
          >
            {/* Modal Header */}
            <div className="p-6 border-b flex items-center justify-between bg-gray-50/50">
              <h3 className="text-xl font-bold text-gray-900">
                {editingClient ? 'Editar Cliente' : 'Novo Cliente'}
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="rounded-lg p-2 text-gray-400 hover:bg-gray-100 transition-all">
                <X className="h-5 w-5" />
              </button>
            </div>

            {/* Tabs */}
            <div className="flex border-b px-6 bg-white overflow-x-auto">
              <button
                onClick={() => setActiveTab('info')}
                className={cn(
                  "flex items-center gap-2 px-4 py-4 text-sm font-bold transition-all border-b-2 whitespace-nowrap",
                  activeTab === 'info' ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-700"
                )}
              >
                <Info className="h-4 w-4" />
                Dados
              </button>
              <button
                onClick={() => setActiveTab('credentials')}
                className={cn(
                  "flex items-center gap-2 px-4 py-4 text-sm font-bold transition-all border-b-2 whitespace-nowrap",
                  activeTab === 'credentials' ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-700"
                )}
              >
                <ShieldCheck className="h-4 w-4" />
                Acessos
              </button>
              <button
                onClick={() => setActiveTab('contracts')}
                className={cn(
                  "flex items-center gap-2 px-4 py-4 text-sm font-bold transition-all border-b-2 whitespace-nowrap",
                  activeTab === 'contracts' ? "border-primary text-primary" : "border-transparent text-gray-500 hover:text-gray-700"
                )}
              >
                <FileCheck className="h-4 w-4" />
                Contratos
              </button>
            </div>

            <form onSubmit={handleSubmit} className="flex-1 overflow-y-auto p-6 space-y-6">
              {activeTab === 'info' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-left-4 duration-300">
                  <div className="grid gap-4 sm:grid-cols-2">
                    <div className="sm:col-span-2">
                      <label className="block text-sm font-medium text-gray-700">Entidade Responsável</label>
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
                      <label className="block text-sm font-medium text-gray-700">Nome da Empresa / Cliente</label>
                      <input 
                        type="text" 
                        value={name} 
                        onChange={(e) => setName(e.target.value)} 
                        placeholder="Nome completo ou Razão Social"
                        className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" 
                        required 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">CNPJ</label>
                      <input 
                        type="text" 
                        value={cnpj} 
                        onChange={(e) => setCnpj(maskCnpj(e.target.value))} 
                        placeholder="00.000.000/0000-00"
                        className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">Responsável</label>
                      <input 
                        type="text" 
                        value={responsibleName} 
                        onChange={(e) => setResponsibleName(e.target.value)} 
                        placeholder="Nome do contato principal"
                        className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" 
                      />
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700">CPF</label>
                      <input 
                        type="text" 
                        value={cpf} 
                        onChange={(e) => setCpf(maskCpf(e.target.value))} 
                        placeholder="000.000.000-00"
                        className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" 
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Email</label>
                    <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700">Google Drive</label>
                    <input type="url" value={drivePath} onChange={(e) => setDrivePath(e.target.value)} className="mt-1 w-full rounded-lg border border-gray-300 px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" />
                  </div>
                </div>
              )}

              {activeTab === 'credentials' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-right-4 duration-300">
                  <div className="grid gap-4 sm:grid-cols-2">
                    {Object.keys(credentials).map((key) => (
                      <div key={key}>
                        <label className="block text-[10px] font-bold uppercase tracking-wider text-gray-500">
                          {key === 'googleAds' ? 'Google Ads' : key.charAt(0).toUpperCase() + key.slice(1)}
                        </label>
                        <input
                          type="text"
                          value={(credentials as any)[key]}
                          onChange={(e) => setCredentials({ ...credentials, [key]: e.target.value })}
                          placeholder="Login / Senha"
                          className="mt-1 w-full rounded-lg border border-gray-200 bg-white px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                        />
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {activeTab === 'contracts' && (
                <div className="space-y-6 animate-in fade-in slide-in-from-bottom-4 duration-300">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-bold text-gray-900">Contratos Assinados</h4>
                    <button type="button" onClick={addContract} className="flex items-center gap-1 text-xs font-bold text-primary hover:underline">
                      <Plus className="h-3 w-3" /> Adicionar Contrato
                    </button>
                  </div>
                  <div className="space-y-4">
                    {contracts.length === 0 ? (
                      <div className="text-center py-8 border-2 border-dashed rounded-xl border-gray-100">
                        <FileCheck className="h-8 w-8 text-gray-200 mx-auto mb-2" />
                        <p className="text-sm text-gray-400">Nenhum contrato cadastrado.</p>
                      </div>
                    ) : (
                      contracts.map((contract) => (
                        <div key={contract.id} className="p-4 rounded-xl border border-gray-100 bg-gray-50 space-y-3">
                          <div className="flex justify-between items-center">
                            <input 
                              type="text" 
                              value={contract.name} 
                              onChange={(e) => updateContract(contract.id, 'name', e.target.value)}
                              placeholder="Nome do Contrato (ex: Prestação de Serviço)"
                              className="flex-1 bg-transparent border-none text-sm font-bold focus:ring-0 p-0"
                            />
                            <div className="flex items-center gap-2">
                              {contract.url && (
                                <>
                                  <a 
                                    href={contract.url} 
                                    target="_blank" 
                                    rel="noopener noreferrer"
                                    className="rounded p-1 text-primary hover:bg-primary/10"
                                    title="Visualizar"
                                  >
                                    <ExternalLink className="h-3 w-3" />
                                  </a>
                                  <a 
                                    href={contract.url} 
                                    download
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="rounded p-1 text-gray-500 hover:bg-gray-200"
                                    title="Baixar"
                                  >
                                    <Download className="h-3 w-3" />
                                  </a>
                                </>
                              )}
                              <button type="button" onClick={() => removeContract(contract.id)} className="text-red-400 hover:text-red-600 ml-1">
                                <Trash2 className="h-4 w-4" />
                              </button>
                            </div>
                          </div>
                          <div className="grid gap-3 sm:grid-cols-2">
                            <div className="relative">
                              <Globe className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                              <input 
                                type="url" 
                                value={contract.url} 
                                onChange={(e) => updateContract(contract.id, 'url', e.target.value)}
                                placeholder="Link do arquivo (PDF/Doc)"
                                className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-gray-200"
                              />
                            </div>
                            <div className="relative">
                              <Calendar className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                              <input 
                                type="date" 
                                value={contract.signedAt} 
                                onChange={(e) => updateContract(contract.id, 'signedAt', e.target.value)}
                                className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-gray-200"
                              />
                            </div>
                            <div className="relative">
                              <DollarSign className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                              <input 
                                type="number" 
                                value={contract.value || ''} 
                                onChange={(e) => updateContract(contract.id, 'value', e.target.value)}
                                placeholder="Valor do Contrato"
                                className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-gray-200"
                              />
                            </div>
                            <div className="relative">
                              <Clock className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                              <input 
                                type="date" 
                                value={contract.expirationDate || ''} 
                                onChange={(e) => updateContract(contract.id, 'expirationDate', e.target.value)}
                                placeholder="Data de Vencimento"
                                className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-gray-200"
                              />
                            </div>
                            <div className="relative sm:col-span-2">
                              <Activity className="absolute left-2 top-1/2 -translate-y-1/2 h-3 w-3 text-gray-400" />
                              <select
                                value={contract.status || 'active'}
                                onChange={(e) => updateContract(contract.id, 'status', e.target.value)}
                                className="w-full pl-7 pr-3 py-1.5 text-xs rounded-lg border border-gray-200 bg-white"
                              >
                                <option value="active">Ativo</option>
                                <option value="inactive">Inativo</option>
                              </select>
                            </div>
                          </div>
                        </div>
                      ))
                    )}
                  </div>
                </div>
              )}

              <div className="flex gap-3 pt-6 border-t">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 rounded-lg border border-gray-200 py-2.5 text-sm font-semibold text-gray-600 hover:bg-gray-50">Cancelar</button>
                <button type="submit" className="flex-1 rounded-lg bg-primary py-2.5 text-sm font-semibold text-white hover:bg-primary/90 shadow-md shadow-primary/20">
                  {editingClient ? 'Salvar Alterações' : 'Cadastrar Cliente'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
