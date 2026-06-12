import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Service, Plan } from '../types';
import { 
  Package, 
  Plus, 
  Trash2, 
  Edit2, 
  Search, 
  Layers, 
  Tag, 
  CheckCircle2, 
  X,
  LayoutGrid,
  List
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';

export const Services: React.FC = () => {
  const { selectedEntity } = useEntity();
  const { showToast, confirm } = useUI();
  const [services, setServices] = useState<Service[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'services' | 'plans'>('services');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Service | Plan | null>(null);
  const [searchTerm, setSearchTerm] = useState('');

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedEntity) return;

    const servicesQ = query(collection(db, `entities/${selectedEntity.id}/services`), orderBy('createdAt', 'desc'));
    const plansQ = query(collection(db, `entities/${selectedEntity.id}/plans`), orderBy('createdAt', 'desc'));

    const unsubServices = onSnapshot(servicesQ, (snapshot) => {
      setServices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Service[]);
    }, (error) => {
      console.error("Error fetching services:", error);
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/services`);
    });

    const unsubPlans = onSnapshot(plansQ, (snapshot) => {
      setPlans(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Plan[]);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching plans:", error);
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/plans`);
    });

    return () => {
      unsubServices();
      unsubPlans();
    };
  }, [selectedEntity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntity) return;

    try {
      if (activeTab === 'services') {
        const serviceData = {
          name,
          description,
          basePrice: Number(price) || 0,
          category,
          entityId: selectedEntity.id,
          ownerUid: selectedEntity.ownerUid,
          collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
          createdAt: serverTimestamp(),
        };

        if (editingItem) {
          await updateDoc(doc(db, `entities/${selectedEntity.id}/services/${editingItem.id}`), serviceData);
        } else {
          await addDoc(collection(db, `entities/${selectedEntity.id}/services`), serviceData);
        }
      } else {
        const planData = {
          name,
          description,
          price: Number(price) || 0,
          billingCycle,
          services: selectedServices,
          entityId: selectedEntity.id,
          ownerUid: selectedEntity.ownerUid,
          collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
          createdAt: serverTimestamp(),
        };

        if (editingItem) {
          await updateDoc(doc(db, `entities/${selectedEntity.id}/plans/${editingItem.id}`), planData);
        } else {
          await addDoc(collection(db, `entities/${selectedEntity.id}/plans`), planData);
        }
      }

      resetForm();
      setIsModalOpen(false);
      showToast(`${activeTab === 'services' ? 'Serviço' : 'Plano'} salvo com sucesso!`, 'success');
    } catch (error) {
      console.error("Error saving service/plan:", error);
      showToast('Erro ao salvar item.', 'error');
    }
  };

  const resetForm = () => {
    setName('');
    setDescription('');
    setPrice('');
    setCategory('');
    setBillingCycle('monthly');
    setSelectedServices([]);
    setEditingItem(null);
  };

  const handleEdit = (item: Service | Plan) => {
    setEditingItem(item);
    setName(item.name);
    setDescription(item.description || '');
    setPrice(activeTab === 'services' ? (item as Service).basePrice.toString() : (item as Plan).price.toString());
    
    if (activeTab === 'services') {
      setCategory((item as Service).category);
    } else {
      setBillingCycle((item as Plan).billingCycle);
      setSelectedServices((item as Plan).services);
    }
    
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!selectedEntity) return;
    const confirmed = await confirm({
      title: 'Excluir Item',
      message: `Tem certeza que deseja excluir este ${activeTab === 'services' ? 'serviço' : 'plano'}?`,
      variant: 'danger'
    });
    if (!confirmed) return;
    
    try {
      await deleteDoc(doc(db, `entities/${selectedEntity.id}/${activeTab}`, id));
      showToast('Item excluído com sucesso.', 'success');
    } catch (error) {
      console.error("Error deleting:", error);
      showToast('Erro ao excluir item.', 'error');
    }
  };

  const filteredServices = services.filter(s => 
    s.name.toLowerCase().includes(searchTerm.toLowerCase()) || 
    s.category.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const filteredPlans = plans.filter(p => 
    p.name.toLowerCase().includes(searchTerm.toLowerCase())
  );

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
      <div className="rounded-[2.5rem] bg-purple-50 dark:bg-gradient-to-br dark:from-purple-900 dark:to-indigo-950 p-8 text-purple-900 dark:text-white shadow-xl shadow-purple-100 dark:shadow-none relative overflow-hidden group border border-purple-100 dark:border-purple-900/30">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white dark:bg-white/10 backdrop-blur-md border border-purple-200 dark:border-white/30 shadow-inner">
              <Package className="h-10 w-10 text-purple-600 dark:text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-purple-400 dark:text-white/60">Agência CIIS</span>
              </div>
              <h2 className="text-4xl font-black tracking-tighter">Serviços & Planos</h2>
              <p className="text-sm font-medium text-purple-700 dark:text-white/80 mt-1">Gerencie seu catálogo de serviços e pacotes recorrentes.</p>
            </div>
          </div>
          <button 
            onClick={() => { resetForm(); setIsModalOpen(true); }}
            className="flex items-center justify-center gap-2 rounded-2xl bg-purple-600 px-8 py-4 text-sm font-black text-white shadow-xl hover:bg-purple-700 transition-all transform hover:scale-105 active:scale-95"
          >
            <Plus className="h-5 w-5" />
            {activeTab === 'services' ? 'Novo Serviço' : 'Novo Plano'}
          </button>
        </div>
        
        {/* Decorative elements */}
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-purple-400/20 blur-2xl" />
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-gray-100 p-1">
          <button 
            onClick={() => setActiveTab('services')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all",
              activeTab === 'services' ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            <Tag className="h-4 w-4" />
            Serviços
          </button>
          <button 
            onClick={() => setActiveTab('plans')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all",
              activeTab === 'plans' ? "bg-white text-primary shadow-sm" : "text-gray-500 hover:text-gray-700"
            )}
          >
            <Layers className="h-4 w-4" />
            Planos/Pacotes
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-5 w-5 text-gray-400" />
          <input 
            type="text"
            placeholder="Buscar..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-gray-200 bg-white pl-10 pr-4 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
          />
        </div>
      </div>

      {/* Content Grid */}
      <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {activeTab === 'services' ? (
          filteredServices.map(service => (
            <motion.div 
              layout
              key={service.id}
              className="group relative rounded-2xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Package className="h-6 w-6" />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleEdit(service)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-primary"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(service.id)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <span className="inline-block rounded-full bg-gray-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-gray-500 mb-2">
                  {service.category}
                </span>
                <h3 className="text-lg font-bold text-gray-900">{service.name}</h3>
                <p className="mt-1 text-sm text-gray-500 line-clamp-2">{service.description}</p>
                <div className="mt-4 flex items-center justify-between">
                  <p className="text-xl font-black text-primary">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(service.basePrice)}
                  </p>
                </div>
              </div>
            </motion.div>
          ))
        ) : (
          filteredPlans.map(plan => (
            <motion.div 
              layout
              key={plan.id}
              className="group relative rounded-2xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
                  <Layers className="h-6 w-6" />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleEdit(plan)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-gray-50 hover:text-primary"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(plan.id)}
                    className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-700 mb-2">
                  {plan.billingCycle === 'monthly' ? 'Mensal' : plan.billingCycle === 'quarterly' ? 'Trimestral' : 'Anual'}
                </span>
                <h3 className="text-lg font-bold text-gray-900">{plan.name}</h3>
                <p className="mt-1 text-sm text-gray-500 line-clamp-2">{plan.description}</p>
                
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Serviços Inclusos</p>
                  <div className="flex flex-wrap gap-1">
                    {plan.services.map(sId => {
                      const s = services.find(serv => serv.id === sId);
                      return s ? (
                        <span key={sId} className="rounded-md bg-gray-50 px-2 py-1 text-[10px] font-medium text-gray-600 border border-gray-100">
                          {s.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <p className="text-xl font-black text-primary">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(plan.price)}
                    <span className="text-xs font-normal text-gray-400 ml-1">
                      /{plan.billingCycle === 'monthly' ? 'mês' : plan.billingCycle === 'quarterly' ? 'tri' : 'ano'}
                    </span>
                  </p>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-lg rounded-3xl bg-white p-8 shadow-2xl overflow-y-auto max-h-[90vh]"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold text-gray-900">
                  {editingItem ? 'Editar' : 'Novo'} {activeTab === 'services' ? 'Serviço' : 'Plano'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="rounded-full p-2 hover:bg-gray-100">
                  <X className="h-6 w-6 text-gray-400" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Nome</label>
                  <input 
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                    placeholder={activeTab === 'services' ? "Ex: Gestão de Redes Sociais" : "Ex: Plano Premium"}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Descrição</label>
                  <textarea 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all min-h-[100px]"
                    placeholder="Detalhes do que está incluso..."
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-2">Preço Base (R$)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                      placeholder="0,00"
                      required
                    />
                  </div>
                  {activeTab === 'services' ? (
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Categoria</label>
                      <input 
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                        placeholder="Ex: Marketing, Design..."
                        required
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-bold text-gray-700 mb-2">Ciclo de Cobrança</label>
                      <select 
                        value={billingCycle}
                        onChange={(e) => setBillingCycle(e.target.value as any)}
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                      >
                        <option value="monthly">Mensal</option>
                        <option value="quarterly">Trimestral</option>
                        <option value="yearly">Anual</option>
                      </select>
                    </div>
                  )}
                </div>

                {activeTab === 'plans' && (
                  <div>
                    <label className="block text-sm font-bold text-gray-700 mb-4">Serviços Inclusos</label>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {services.map(s => (
                        <button
                          key={s.id}
                          type="button"
                          onClick={() => {
                            setSelectedServices(prev => 
                              prev.includes(s.id) ? prev.filter(id => id !== s.id) : [...prev, s.id]
                            );
                          }}
                          className={cn(
                            "flex items-center gap-2 rounded-xl border p-3 text-left transition-all",
                            selectedServices.includes(s.id) 
                              ? "border-primary bg-primary/5 text-primary" 
                              : "border-gray-100 bg-gray-50 text-gray-600 hover:bg-gray-100"
                          )}
                        >
                          <div className={cn(
                            "flex h-5 w-5 items-center justify-center rounded border transition-all",
                            selectedServices.includes(s.id) ? "bg-primary border-primary" : "bg-white border-gray-300"
                          )}>
                            {selectedServices.includes(s.id) && <CheckCircle2 className="h-4 w-4 text-white" />}
                          </div>
                          <span className="text-xs font-bold truncate">{s.name}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}

                <div className="flex gap-4 pt-4">
                  <button 
                    type="button"
                    onClick={() => setIsModalOpen(false)}
                    className="flex-1 rounded-xl border border-gray-200 px-4 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
                  >
                    Salvar {activeTab === 'services' ? 'Serviço' : 'Plano'}
                  </button>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
