import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Service, Plan, ServiceUnit, SERVICE_UNIT_LABELS } from '../types';
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
import { ViewToggle, useViewMode, DataTable, Column } from '../components/ViewToggle';
import { serviceMargin } from '../lib/quotes';

export const Services: React.FC = () => {
  const { selectedEntity } = useEntity();
  const { showToast, confirm } = useUI();
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Service[]>([]); // produto usa o mesmo formato de serviço
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [activeTab, setActiveTab] = useState<'services' | 'plans' | 'products'>('services');
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingItem, setEditingItem] = useState<Service | Plan | null>(null);
  // A regra da subcoleção `products` é mais nova; se ainda não foi publicada no
  // Firebase, leitura/escrita caem em permission-denied. Guardamos isso para
  // avisar em vez de falhar em silêncio.
  const [productsBlocked, setProductsBlocked] = useState(false);
  const [searchTerm, setSearchTerm] = useState('');
  const [viewMode, setViewMode] = useViewMode('servicos', 'grid');

  // Form states
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [price, setPrice] = useState('');
  const [category, setCategory] = useState('');
  const [billingCycle, setBillingCycle] = useState<'monthly' | 'quarterly' | 'yearly'>('monthly');
  // Campos profissionais do serviço
  const [code, setCode] = useState('');
  const [unit, setUnit] = useState<ServiceUnit>('projeto');
  const [costPrice, setCostPrice] = useState('');
  const [estimatedHours, setEstimatedHours] = useState('');
  const [deliveryDays, setDeliveryDays] = useState('');
  const [scope, setScope] = useState('');
  const [notIncluded, setNotIncluded] = useState('');
  const [observations, setObservations] = useState('');
  const [active, setActive] = useState(true);
  const [selectedServices, setSelectedServices] = useState<string[]>([]);

  useEffect(() => {
    // Sem entidade selecionada não há o que carregar — mas precisa DESLIGAR o
    // loading, senão a tela fica presa no spinner e nenhum botão é alcançável.
    if (!selectedEntity) { setLoading(false); return; }

    const servicesQ = query(collection(db, `entities/${selectedEntity.id}/services`), orderBy('createdAt', 'desc'));
    const productsQ = query(collection(db, `entities/${selectedEntity.id}/products`), orderBy('createdAt', 'desc'));
    const plansQ = query(collection(db, `entities/${selectedEntity.id}/plans`), orderBy('createdAt', 'desc'));

    const unsubServices = onSnapshot(servicesQ, (snapshot) => {
      setServices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Service[]);
    }, (error) => {
      console.error("Error fetching services:", error);
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/services`);
    });

    const unsubProducts = onSnapshot(productsQ, (snapshot) => {
      setProductsBlocked(false);
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Service[]);
    }, (error) => {
      console.error("Error fetching products:", error);
      if ((error as { code?: string })?.code === 'permission-denied') setProductsBlocked(true);
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/products`);
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
      unsubProducts();
      unsubPlans();
    };
  }, [selectedEntity]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntity) return;

    try {
      if (activeTab === 'services' || activeTab === 'products') {
        const serviceData = {
          name,
          description,
          basePrice: Number(price) || 0,
          category: category || (activeTab === 'products' ? 'Produto' : ''),
          code: code.trim() || null,
          unit,
          costPrice: costPrice === '' ? null : Number(costPrice) || 0,
          estimatedHours: estimatedHours === '' ? null : Number(estimatedHours) || 0,
          deliveryDays: deliveryDays === '' ? null : Number(deliveryDays) || 0,
          scope: scope.trim() || null,
          notIncluded: notIncluded.trim() || null,
          observations: observations.trim() || null,
          active,
          entityId: selectedEntity.id,
          ownerUid: selectedEntity.ownerUid,
          collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
        };

        if (editingItem) {
          // createdAt é gravado SOMENTE na criação; na edição só atualizamos os campos + updatedAt.
          await updateDoc(doc(db, `entities/${selectedEntity.id}/${activeTab}/${editingItem.id}`), {
            ...serviceData,
            updatedAt: serverTimestamp(),
          });
        } else {
          await addDoc(collection(db, `entities/${selectedEntity.id}/${activeTab}`), {
            ...serviceData,
            createdAt: serverTimestamp(),
          });
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
        };

        if (editingItem) {
          // createdAt é gravado SOMENTE na criação; na edição só atualizamos os campos + updatedAt.
          await updateDoc(doc(db, `entities/${selectedEntity.id}/plans/${editingItem.id}`), {
            ...planData,
            updatedAt: serverTimestamp(),
          });
        } else {
          await addDoc(collection(db, `entities/${selectedEntity.id}/plans`), {
            ...planData,
            createdAt: serverTimestamp(),
          });
        }
      }

      resetForm();
      setIsModalOpen(false);
      showToast(`${activeTab === 'plans' ? 'Plano' : activeTab === 'products' ? 'Produto' : 'Serviço'} salvo com sucesso!`, 'success');
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
    setCode(''); setUnit('projeto'); setCostPrice(''); setEstimatedHours('');
    setDeliveryDays(''); setScope(''); setNotIncluded(''); setObservations(''); setActive(true);
    setEditingItem(null);
  };

  const handleEdit = (item: Service | Plan) => {
    setEditingItem(item);
    setName(item.name);
    setDescription(item.description || '');
    setPrice(activeTab === 'plans'
      ? String((item as Plan).price ?? '')
      : String((item as Service).basePrice ?? ''));
    
    if (activeTab === 'services' || activeTab === 'products') {
      const sv = item as Service;
      setCategory(sv.category);
      setCode(sv.code || '');
      setUnit(sv.unit || 'projeto');
      setCostPrice(sv.costPrice != null ? String(sv.costPrice) : '');
      setEstimatedHours(sv.estimatedHours != null ? String(sv.estimatedHours) : '');
      setDeliveryDays(sv.deliveryDays != null ? String(sv.deliveryDays) : '');
      setScope(sv.scope || '');
      setNotIncluded(sv.notIncluded || '');
      setObservations(sv.observations || '');
      setActive(sv.active !== false);
    } else {
      setBillingCycle((item as Plan).billingCycle);
      setSelectedServices((item as Plan).services || []);
    }
    
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!selectedEntity) return;
    const confirmed = await confirm({
      title: 'Excluir Item',
      message: `Tem certeza que deseja excluir este ${activeTab === 'plans' ? 'plano' : activeTab === 'products' ? 'produto' : 'serviço'}?`,
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

  const filteredProducts = products.filter(p =>
    p.name.toLowerCase().includes(searchTerm.toLowerCase()) ||
    (p.category || '').toLowerCase().includes(searchTerm.toLowerCase())
  );

  if (loading) {
    return (
      <div className="flex h-[60vh] items-center justify-center">
        <div className="h-12 w-12 animate-spin rounded-full border-4 border-primary border-t-transparent" />
      </div>
    );
  }

  const brl = (n: number) =>
    new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number.isFinite(n) ? n : 0);

  const colunasServicos: Column<Service>[] = [
    {
      chave: 'nome', titulo: 'Serviço',
      render: (sv) => (
        <span>
          <span className="font-bold text-content">{sv.name}</span>
          {sv.code && <span className="ml-2 text-[10px] font-black text-content-subtle">{sv.code}</span>}
          {sv.active === false && <span className="ml-2 rounded bg-surface-muted px-1.5 text-[10px] font-black text-content-subtle">inativo</span>}
        </span>
      ),
    },
    { chave: 'categoria', titulo: 'Categoria', escondeNoMobile: true, render: (sv) => sv.category || '—' },
    { chave: 'preco', titulo: 'Preço', numerico: true, render: (sv) => brl(sv.basePrice) },
    { chave: 'custo', titulo: 'Custo', numerico: true, escondeNoMobile: true, render: (sv) => sv.costPrice != null ? brl(sv.costPrice) : '—' },
    {
      chave: 'margem', titulo: 'Margem', numerico: true,
      render: (sv) => {
        const m = serviceMargin(sv.basePrice, sv.costPrice, sv.estimatedHours);
        return (
          <span className={cn('font-bold',
            m.margemPercent >= 40 ? 'text-emerald-600' : m.margemPercent >= 20 ? 'text-amber-600' : 'text-rose-600')}>
            {m.margemPercent.toFixed(0)}%
          </span>
        );
      },
    },
    {
      chave: 'hora', titulo: 'Por hora', numerico: true, escondeNoMobile: true,
      render: (sv) => {
        const m = serviceMargin(sv.basePrice, sv.costPrice, sv.estimatedHours);
        return m.valorHora !== null ? brl(m.valorHora) : '—';
      },
    },
    { chave: 'prazo', titulo: 'Prazo', numerico: true, escondeNoMobile: true, render: (sv) => sv.deliveryDays ? `${sv.deliveryDays}d` : '—' },
  ];

  const colunasPlanos: Column<Plan>[] = [
    { chave: 'nome', titulo: 'Plano', render: (pl) => <span className="font-bold text-content">{pl.name}</span> },
    { chave: 'preco', titulo: 'Preço', numerico: true, render: (pl) => brl(pl.price) },
    {
      chave: 'ciclo', titulo: 'Cobrança',
      render: (pl) => ({ monthly: 'Mensal', quarterly: 'Trimestral', yearly: 'Anual' }[pl.billingCycle] || pl.billingCycle),
    },
    { chave: 'servicos', titulo: 'Serviços inclusos', numerico: true, escondeNoMobile: true, render: (pl) => String(pl.services?.length || 0) },
  ];

  return (
    <div className="space-y-8">
      {/* Header */}
      <div className="rounded-[2.5rem] bg-purple-50 dark:bg-gradient-to-br dark:from-purple-900 dark:to-indigo-950 p-8 text-purple-900 dark:text-white shadow-xl shadow-purple-100 dark:shadow-none relative overflow-hidden group border border-purple-100 dark:border-purple-900/30">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-surface dark:bg-white/10 backdrop-blur-md border border-purple-200 dark:border-white/30 shadow-inner">
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
          <div className="flex items-center gap-3">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <button
              onClick={() => { resetForm(); setIsModalOpen(true); }}
              className="flex items-center justify-center gap-2 rounded-2xl bg-purple-600 px-8 py-4 text-sm font-black text-white shadow-xl hover:bg-purple-700 transition-all transform hover:scale-105 active:scale-95"
            >
              <Plus className="h-5 w-5" />
              {activeTab === 'plans' ? 'Novo Plano' : activeTab === 'products' ? 'Novo Produto' : 'Novo Serviço'}
            </button>
          </div>
        </div>
        
        {/* Decorative elements */}
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-purple-400/20 blur-2xl" />
      </div>

      {/* Tabs & Search */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-1 rounded-xl bg-surface-muted p-1">
          <button 
            onClick={() => setActiveTab('services')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all",
              activeTab === 'services' ? "bg-surface text-primary shadow-sm" : "text-content-subtle hover:text-content-muted"
            )}
          >
            <Tag className="h-4 w-4" />
            Serviços
          </button>
          <button
            onClick={() => setActiveTab('products')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all",
              activeTab === 'products' ? "bg-surface text-primary shadow-sm" : "text-content-subtle hover:text-content-muted"
            )}
          >
            <Package className="h-4 w-4" />
            Produtos
          </button>
          <button
            onClick={() => setActiveTab('plans')}
            className={cn(
              "flex items-center gap-2 rounded-lg px-4 py-2 text-sm font-bold transition-all",
              activeTab === 'plans' ? "bg-surface text-primary shadow-sm" : "text-content-subtle hover:text-content-muted"
            )}
          >
            <Layers className="h-4 w-4" />
            Planos/Pacotes
          </button>
        </div>

        <div className="relative w-full sm:w-64">
          <Search className="absolute left-3 top-2.5 h-5 w-5 text-content-subtle" />
          <input 
            type="text"
            placeholder="Buscar..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface pl-10 pr-4 py-2 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
          />
        </div>
      </div>

      {activeTab === 'products' && productsBlocked && (
        <div className="mb-6 rounded-2xl border border-amber-200 dark:border-amber-900/40 bg-amber-50 dark:bg-amber-950/40 p-6">
          <p className="font-bold text-amber-900 dark:text-amber-200">Catálogo de produtos bloqueado pelo banco de dados</p>
          <p className="mt-1 text-sm text-amber-800 dark:text-amber-300">
            A regra de acesso da coleção <code className="mx-1 rounded bg-amber-900/20 px-1">products</code> ainda não foi
            publicada no Firebase — por isso produtos não salvam nem aparecem aqui (e não podem ser puxados no orçamento).
            Publique o arquivo <code className="mx-1 rounded bg-amber-900/20 px-1">firestore.rules</code>
            (Console do Firebase → Firestore → Regras → Publicar, ou <code className="mx-1 rounded bg-amber-900/20 px-1">firebase deploy --only firestore:rules</code>) e isto volta a funcionar. Serviços e Planos não são afetados.
          </p>
        </div>
      )}

      {viewMode === 'list' && (
        activeTab !== 'plans' ? (
          <DataTable
            itens={activeTab === 'products' ? filteredProducts : filteredServices}
            colunas={colunasServicos}
            acoes={(sv) => (
              <>
                <button onClick={() => handleEdit(sv)} title="Editar"
                  className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                  <Edit2 className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(sv.id)} title="Excluir"
                  className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
            vazio={<p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhum {activeTab === 'products' ? 'produto' : 'serviço'} encontrado.</p>}
          />
        ) : (
          <DataTable
            itens={filteredPlans}
            colunas={colunasPlanos}
            acoes={(pl) => (
              <>
                <button onClick={() => handleEdit(pl)} title="Editar"
                  className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                  <Edit2 className="h-4 w-4" />
                </button>
                <button onClick={() => handleDelete(pl.id)} title="Excluir"
                  className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-rose-600">
                  <Trash2 className="h-4 w-4" />
                </button>
              </>
            )}
            vazio={<p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhum plano encontrado.</p>}
          />
        )
      )}

      {/* Content Grid */}
      {viewMode === 'grid' && <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
        {activeTab !== 'plans' ? (
          (activeTab === 'products' ? filteredProducts : filteredServices).map(service => (
            <motion.div 
              layout
              key={service.id}
              className="group relative rounded-2xl bg-surface p-6 shadow-sm border border-line hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-primary/10 text-primary">
                  <Package className="h-6 w-6" />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleEdit(service)}
                    className="rounded-lg p-2 text-content-subtle hover:bg-canvas hover:text-primary"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(service.id)}
                    className="rounded-lg p-2 text-content-subtle hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <span className="inline-block rounded-full bg-surface-muted px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-content-subtle mb-2">
                  {service.category}
                </span>
                <h3 className="text-lg font-bold text-content">{service.name}</h3>
                <p className="mt-1 text-sm text-content-subtle line-clamp-2">{service.description}</p>
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
              className="group relative rounded-2xl bg-surface p-6 shadow-sm border border-line hover:shadow-md transition-all"
            >
              <div className="flex items-start justify-between">
                <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-purple-50 text-purple-600">
                  <Layers className="h-6 w-6" />
                </div>
                <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button 
                    onClick={() => handleEdit(plan)}
                    className="rounded-lg p-2 text-content-subtle hover:bg-canvas hover:text-primary"
                  >
                    <Edit2 className="h-4 w-4" />
                  </button>
                  <button 
                    onClick={() => handleDelete(plan.id)}
                    className="rounded-lg p-2 text-content-subtle hover:bg-red-50 hover:text-red-500"
                  >
                    <Trash2 className="h-4 w-4" />
                  </button>
                </div>
              </div>
              <div className="mt-4">
                <span className="inline-block rounded-full bg-purple-100 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider text-purple-700 mb-2">
                  {plan.billingCycle === 'monthly' ? 'Mensal' : plan.billingCycle === 'quarterly' ? 'Trimestral' : 'Anual'}
                </span>
                <h3 className="text-lg font-bold text-content">{plan.name}</h3>
                <p className="mt-1 text-sm text-content-subtle line-clamp-2">{plan.description}</p>
                
                <div className="mt-4 space-y-2">
                  <p className="text-xs font-bold text-content-subtle uppercase tracking-widest">Serviços Inclusos</p>
                  <div className="flex flex-wrap gap-1">
                    {(plan.services || []).map(sId => {
                      const s = services.find(serv => serv.id === sId);
                      return s ? (
                        <span key={sId} className="rounded-md bg-canvas px-2 py-1 text-[10px] font-medium text-content-muted border border-line">
                          {s.name}
                        </span>
                      ) : null;
                    })}
                  </div>
                </div>

                <div className="mt-6 flex items-center justify-between">
                  <p className="text-xl font-black text-primary">
                    {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(plan.price)}
                    <span className="text-xs font-normal text-content-subtle ml-1">
                      /{plan.billingCycle === 'monthly' ? 'mês' : plan.billingCycle === 'quarterly' ? 'tri' : 'ano'}
                    </span>
                  </p>
                </div>
              </div>
            </motion.div>
          ))
        )}
      </div>}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}>
            <motion.div
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              onClick={e => e.stopPropagation()}
              className="relative w-full max-w-4xl rounded-3xl bg-surface p-8 shadow-2xl overflow-y-auto max-h-[92vh]"
            >
              <div className="flex items-center justify-between mb-8">
                <h3 className="text-xl font-bold text-content">
                  {editingItem ? 'Editar' : 'Novo'} {activeTab === 'plans' ? 'Plano' : activeTab === 'products' ? 'Produto' : 'Serviço'}
                </h3>
                <button onClick={() => setIsModalOpen(false)} className="rounded-full p-2 hover:bg-surface-muted">
                  <X className="h-6 w-6 text-content-subtle" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-6">
                <div>
                  <label className="block text-sm font-bold text-content-muted mb-2">Nome</label>
                  <input 
                    type="text"
                    value={name}
                    onChange={(e) => setName(e.target.value)}
                    className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                    placeholder={activeTab === 'plans' ? "Ex: Plano Premium" : activeTab === 'products' ? "Ex: E-book, Template, Curso" : "Ex: Gestão de Redes Sociais"}
                    required
                  />
                </div>

                <div>
                  <label className="block text-sm font-bold text-content-muted mb-2">Descrição</label>
                  <textarea 
                    value={description}
                    onChange={(e) => setDescription(e.target.value)}
                    className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all min-h-[100px]"
                    placeholder="Detalhes do que está incluso..."
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="block text-sm font-bold text-content-muted mb-2">Preço Base (R$)</label>
                    <input 
                      type="number"
                      step="0.01"
                      value={price}
                      onChange={(e) => setPrice(e.target.value)}
                      className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                      placeholder="0,00"
                      required
                    />
                  </div>
                  {activeTab !== 'plans' ? (
                    <div>
                      <label className="block text-sm font-bold text-content-muted mb-2">Categoria</label>
                      <input
                        type="text"
                        value={category}
                        onChange={(e) => setCategory(e.target.value)}
                        className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                        placeholder={activeTab === 'products' ? "Ex: Produto digital" : "Ex: Marketing, Design..."}
                      />
                    </div>
                  ) : (
                    <div>
                      <label className="block text-sm font-bold text-content-muted mb-2">Ciclo de Cobrança</label>
                      <select 
                        value={billingCycle}
                        onChange={(e) => setBillingCycle(e.target.value as any)}
                        className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all"
                      >
                        <option value="monthly">Mensal</option>
                        <option value="quarterly">Trimestral</option>
                        <option value="yearly">Anual</option>
                      </select>
                    </div>
                  )}
                </div>

                {/* Campos profissionais do serviço — o que faz o orçamento sair completo */}
                {activeTab === 'services' && (
                  <div className="space-y-4 rounded-2xl border border-line p-4">
                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <label className="block text-sm font-bold text-content-muted mb-2">Código</label>
                        <input type="text" value={code} onChange={e => setCode(e.target.value)}
                          placeholder="Ex: SM-01"
                          className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary" />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-content-muted mb-2">Cobrança</label>
                        <select value={unit} onChange={e => setUnit(e.target.value as ServiceUnit)}
                          className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary">
                          {Object.entries(SERVICE_UNIT_LABELS).map(([v, l]) => (
                            <option key={v} value={v}>{l}</option>
                          ))}
                        </select>
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-content-muted mb-2">Prazo (dias úteis)</label>
                        <input type="number" min="0" value={deliveryDays} onChange={e => setDeliveryDays(e.target.value)}
                          placeholder="Ex: 15"
                          className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary" />
                      </div>
                    </div>

                    <div className="grid gap-4 sm:grid-cols-3">
                      <div>
                        <label className="block text-sm font-bold text-content-muted mb-2">Custo de execução</label>
                        <input type="number" step="0.01" min="0" value={costPrice} onChange={e => setCostPrice(e.target.value)}
                          placeholder="0,00"
                          className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary" />
                      </div>
                      <div>
                        <label className="block text-sm font-bold text-content-muted mb-2">Horas estimadas</label>
                        <input type="number" step="0.5" min="0" value={estimatedHours} onChange={e => setEstimatedHours(e.target.value)}
                          placeholder="Ex: 20"
                          className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary" />
                      </div>
                      <div className="flex flex-col justify-end">
                        {/* Margem: o número que diz se vale a pena vender esse serviço */}
                        {Number(price) > 0 && costPrice !== '' && (
                          <div className="rounded-xl bg-surface-muted px-4 py-2.5">
                            <p className="text-[10px] font-black uppercase tracking-widest text-content-subtle">Margem</p>
                            <p className={cn('text-lg font-black',
                              (Number(price) - Number(costPrice)) / Number(price) >= 0.4 ? 'text-emerald-600'
                                : (Number(price) - Number(costPrice)) / Number(price) >= 0.2 ? 'text-amber-600' : 'text-rose-600')}>
                              {(((Number(price) - Number(costPrice)) / Number(price)) * 100).toFixed(0)}%
                              <span className="ml-2 text-xs font-bold text-content-subtle">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(price) - Number(costPrice))}
                              </span>
                            </p>
                            {Number(estimatedHours) > 0 && (
                              <p className="text-[10px] text-content-subtle">
                                {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(price) / Number(estimatedHours))}/hora
                              </p>
                            )}
                          </div>
                        )}
                      </div>
                    </div>

                    <div>
                      <label className="block text-sm font-bold text-content-muted mb-2">O que está incluso</label>
                      <textarea value={scope} onChange={e => setScope(e.target.value)} rows={2}
                        placeholder="Ex: 12 posts por mês, 2 rodadas de ajuste, relatório mensal"
                        className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary" />
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-content-muted mb-2">O que NÃO está incluso</label>
                      <textarea value={notIncluded} onChange={e => setNotIncluded(e.target.value)} rows={2}
                        placeholder="Ex: verba de anúncio, produção de vídeo, banco de imagens"
                        className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary" />
                      <p className="mt-1 text-xs text-content-subtle">Deixar isso escrito evita discussão depois da venda.</p>
                    </div>
                    <div>
                      <label className="block text-sm font-bold text-content-muted mb-2">Observações e condições</label>
                      <textarea value={observations} onChange={e => setObservations(e.target.value)} rows={2}
                        placeholder="Ex: cliente fornece acesso às contas; início após aprovação do briefing"
                        className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary" />
                    </div>
                    <label className="flex items-center gap-2 cursor-pointer">
                      <input type="checkbox" checked={active} onChange={e => setActive(e.target.checked)} className="rounded text-primary" />
                      <span className="text-sm font-bold text-content-muted">Serviço ativo (aparece no orçamento)</span>
                    </label>
                  </div>
                )}

                {activeTab === 'plans' && (
                  <div>
                    <label className="block text-sm font-bold text-content-muted mb-4">Serviços Inclusos</label>
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
                              : "border-line bg-canvas text-content-muted hover:bg-surface-muted"
                          )}
                        >
                          <div className={cn(
                            "flex h-5 w-5 items-center justify-center rounded border transition-all",
                            selectedServices.includes(s.id) ? "bg-primary border-primary" : "bg-surface border-line"
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
                    className="flex-1 rounded-xl border border-line px-4 py-3 text-sm font-bold text-content-muted hover:bg-canvas transition-all"
                  >
                    Cancelar
                  </button>
                  <button 
                    type="submit"
                    className="flex-1 rounded-xl bg-primary px-4 py-3 text-sm font-bold text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
                  >
                    Salvar {activeTab === 'plans' ? 'Plano' : activeTab === 'products' ? 'Produto' : 'Serviço'}
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
