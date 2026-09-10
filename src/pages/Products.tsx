import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, doc, updateDoc, deleteDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product, ProductVariation } from '../types';
import { Plus, Search, Package, Box, Printer, Edit2, Trash2, X, Layers, Tag, AlertTriangle } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { ViewToggle, useViewMode, DataTable, Column } from '../components/ViewToggle';
import { isLowStock } from '../lib/stock';
import { readProductCategories, productCategoriesDocPath } from '../lib/productCategoryStore';

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

const KINDS: { id: NonNullable<Product['kind']>; label: string; icon: React.ComponentType<{ className?: string }> }[] = [
  { id: 'grafica', label: 'Gráfica rápida', icon: Printer },
  { id: '3d', label: 'Impressão 3D', icon: Box },
  { id: 'outro', label: 'Outro', icon: Package },
];

const emptyVariation = (): ProductVariation => ({ id: crypto.randomUUID(), name: '', price: 0, cost: 0 });

export const Products: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { showToast, confirm } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editing, setEditing] = useState<Product | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [categoryFilter, setCategoryFilter] = useState('all');
  const [managedCats, setManagedCats] = useState<Record<string, string[]>>({});
  const [viewMode, setViewMode] = useViewMode('produtos', 'grid');

  // Form
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');
  const [kind, setKind] = useState<NonNullable<Product['kind']>>('grafica');
  const [unit, setUnit] = useState('un');
  const [description, setDescription] = useState('');
  const [basePrice, setBasePrice] = useState('');
  const [costPrice, setCostPrice] = useState('');
  const [active, setActive] = useState(true);
  const [variations, setVariations] = useState<ProductVariation[]>([]);
  const [trackStock, setTrackStock] = useState(false);
  const [stock, setStock] = useState('');
  const [minStock, setMinStock] = useState('');
  const [targetEntityId, setTargetEntityId] = useState('');

  useEffect(() => {
    if (entities.length === 0) return;
    const filteredEntities = filterType === 'ALL' ? entities : entities.filter(e => e.type === filterType);
    const unsubscribes: (() => void)[] = [];
    let all: Product[] = [];
    filteredEntities.forEach(entity => {
      const q = query(collection(db, `entities/${entity.id}/products`), orderBy('createdAt', 'desc'));
      const unsub = onSnapshot(q, (snapshot) => {
        const list = (snapshot.docs.map(d => ({ id: d.id, ...d.data() })) as Product[])
          .filter(p => p.itemType !== 'supply'); // insumos ficam na tela de Estoque
        all = [...all.filter(p => p.entityId !== entity.id), ...list];
        setProducts([...all]);
      }, (error) => handleFirestoreError(error, OperationType.LIST, `entities/${entity.id}/products`));
      unsubscribes.push(unsub);

      // Categorias gerenciadas (tela Categorias) — pra aparecerem no formulário.
      const unsubCat = onSnapshot(doc(db, productCategoriesDocPath(entity.id)), (snap) => {
        setManagedCats(prev => ({ ...prev, [entity.id]: readProductCategories(snap.data()).map(c => c.name) }));
      }, () => { /* doc pode não existir */ });
      unsubscribes.push(unsubCat);
    });
    return () => unsubscribes.forEach(u => u());
  }, [entities, filterType]);

  const resetForm = () => {
    setEditing(null);
    setName(''); setCategory(''); setKind('grafica'); setUnit('un');
    setDescription(''); setBasePrice(''); setCostPrice(''); setActive(true);
    setVariations([]); setTrackStock(false); setStock(''); setMinStock(''); setTargetEntityId('');
  };

  const addVariation = () => setVariations(v => [...v, emptyVariation()]);
  const updateVariation = (id: string, patch: Partial<ProductVariation>) =>
    setVariations(v => v.map(x => x.id === id ? { ...x, ...patch } : x));
  const removeVariation = (id: string) => setVariations(v => v.filter(x => x.id !== id));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!targetEntityId) { showToast('Escolha a entidade.', 'error'); return; }
    if (!name.trim()) { showToast('Dê um nome ao produto.', 'error'); return; }
    const selectedEntity = entities.find(en => en.id === targetEntityId);
    // Só variações com nome entram; preço/custo viram número.
    const vars = variations
      .filter(v => v.name.trim())
      .map(v => ({ id: v.id, name: v.name.trim(), price: Number(v.price) || 0, cost: Number(v.cost) || 0 }));
    const data = {
      name: name.trim(),
      description: description.trim() || null,
      category: category.trim() || null,
      kind,
      unit: unit.trim() || null,
      basePrice: Number(basePrice) || 0,
      costPrice: Number(costPrice) || 0,
      variations: vars,
      active,
      itemType: 'product' as const,
      trackStock,
      stock: trackStock ? (Number(stock) || 0) : null,
      minStock: trackStock ? (Number(minStock) || 0) : null,
      entityId: targetEntityId,
      ownerUid: selectedEntity?.ownerUid,
      collaboratorsEmails: selectedEntity?.collaboratorsEmails || [],
      updatedAt: serverTimestamp(),
    };
    try {
      if (editing) {
        await updateDoc(doc(db, `entities/${editing.entityId}/products/${editing.id}`), data);
      } else {
        await addDoc(collection(db, `entities/${targetEntityId}/products`), { ...data, createdAt: serverTimestamp() });
      }
      setIsModalOpen(false);
      resetForm();
      showToast(`Produto ${editing ? 'atualizado' : 'cadastrado'} com sucesso!`, 'success');
    } catch (error) {
      console.error('Erro ao salvar produto:', error);
      showToast('Erro ao salvar o produto.', 'error');
    }
  };

  const handleEdit = (p: Product) => {
    setEditing(p);
    setName(p.name || '');
    setCategory(p.category || '');
    setKind(p.kind || 'grafica');
    setUnit(p.unit || 'un');
    setDescription(p.description || '');
    setBasePrice(p.basePrice != null ? String(p.basePrice) : '');
    setCostPrice(p.costPrice != null ? String(p.costPrice) : '');
    setActive(p.active !== false);
    setVariations((p.variations || []).map(v => ({ ...v })));
    setTrackStock(!!p.trackStock);
    setStock(p.stock != null ? String(p.stock) : '');
    setMinStock(p.minStock != null ? String(p.minStock) : '');
    setTargetEntityId(p.entityId);
    setIsModalOpen(true);
  };

  const handleDelete = async (p: Product) => {
    const ok = await confirm({ title: 'Excluir produto', message: `Tem certeza que deseja excluir "${p.name}"?`, variant: 'danger' });
    if (!ok) return;
    try {
      await deleteDoc(doc(db, `entities/${p.entityId}/products/${p.id}`));
      showToast('Produto excluído.', 'success');
    } catch (error) {
      console.error('Erro ao excluir produto:', error);
      showToast('Erro ao excluir o produto.', 'error');
    }
  };

  const categories = [...new Set([
    ...products.map(p => p.category),
    ...Object.values(managedCats).flat(),
  ].filter(Boolean))] as string[];

  const filtered = products.filter(p => {
    const s = searchTerm.toLowerCase();
    const matchesSearch = (p.name || '').toLowerCase().includes(s) || (p.category || '').toLowerCase().includes(s);
    const matchesCat = categoryFilter === 'all' || p.category === categoryFilter;
    return matchesSearch && matchesCat;
  });

  // Faixa de preço exibida no card/tabela: base ou o intervalo das variações.
  const priceLabel = (p: Product) => {
    const vs = (p.variations || []).filter(v => (Number(v.price) || 0) > 0);
    if (vs.length) {
      const prices = vs.map(v => Number(v.price) || 0);
      const min = Math.min(...prices), max = Math.max(...prices);
      return min === max ? brl(min) : `${brl(min)} – ${brl(max)}`;
    }
    return brl(p.basePrice || 0);
  };

  const kindOf = (p: Product) => KINDS.find(k => k.id === (p.kind || 'grafica')) || KINDS[0];

  const colunas: Column<Product>[] = [
    { chave: 'nome', titulo: 'Produto', render: (p) => <span className="font-bold text-content">{p.name}</span> },
    { chave: 'tipo', titulo: 'Tipo', escondeNoMobile: true, render: (p) => kindOf(p).label },
    { chave: 'categoria', titulo: 'Categoria', escondeNoMobile: true, render: (p) => p.category || '—' },
    { chave: 'variacoes', titulo: 'Variações', numerico: true, escondeNoMobile: true, render: (p) => (p.variations?.length || 0) || '—' },
    { chave: 'preco', titulo: 'Preço', numerico: true, render: (p) => <span className="font-bold text-emerald-600">{priceLabel(p)}</span> },
  ];

  return (
    <div className="space-y-6">
      <div className="rounded-[2.5rem] bg-violet-50 dark:bg-gradient-to-br dark:from-violet-900 dark:to-indigo-950 p-8 text-violet-900 dark:text-white shadow-xl shadow-violet-100 dark:shadow-none relative overflow-hidden border border-violet-100 dark:border-violet-900/30">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-surface dark:bg-white/10 border border-violet-200 dark:border-white/30 shadow-inner">
              <Package className="h-10 w-10 text-violet-600 dark:text-white" />
            </div>
            <div>
              <span className="text-[10px] font-black uppercase tracking-[0.3em] text-violet-500 dark:text-white/60">Catálogo</span>
              <h2 className="text-4xl font-black tracking-tighter">Produtos</h2>
              <p className="text-sm font-medium text-violet-700 dark:text-white/80 mt-1">Gráfica rápida, impressão 3D e mais — com variações e preço.</p>
            </div>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <button
              onClick={() => { resetForm(); setIsModalOpen(true); }}
              className="flex items-center justify-center gap-2 rounded-2xl bg-violet-600 px-8 py-4 text-sm font-black text-white shadow-xl hover:bg-violet-700 transition-all transform hover:scale-105 active:scale-95"
            >
              <Plus className="h-5 w-5" /> Novo Produto
            </button>
          </div>
        </div>
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
      </div>

      <div className="flex flex-col gap-3 sm:flex-row">
        <div className="relative flex-1">
          <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-content-subtle" />
          <input
            type="text"
            placeholder="Buscar por nome ou categoria..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-xl border border-line bg-surface py-3 pl-10 pr-4 text-sm outline-none focus:ring-2 focus:ring-primary/20 transition-all"
          />
        </div>
        {categories.length > 0 && (
          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="rounded-xl border border-line bg-surface px-4 py-3 text-sm outline-none focus:ring-2 focus:ring-primary/20"
          >
            <option value="all">Todas as categorias</option>
            {categories.map(c => <option key={c} value={c}>{c}</option>)}
          </select>
        )}
      </div>

      {viewMode === 'list' && (
        <DataTable
          itens={filtered}
          colunas={colunas}
          acoes={(p) => (
            <>
              <button onClick={() => handleEdit(p)} title="Editar" className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary"><Edit2 className="h-4 w-4" /></button>
              <button onClick={() => handleDelete(p)} title="Excluir" className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
            </>
          )}
          vazio={<p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhum produto cadastrado ainda.</p>}
        />
      )}

      {viewMode === 'grid' && (
        <div className="grid gap-6 sm:grid-cols-2 lg:grid-cols-3">
          <AnimatePresence mode="popLayout">
            {filtered.map((p) => {
              const KindIcon = kindOf(p).icon;
              return (
                <motion.div
                  key={p.id}
                  layout
                  initial={{ opacity: 0, scale: 0.9 }}
                  animate={{ opacity: 1, scale: 1 }}
                  exit={{ opacity: 0, scale: 0.9 }}
                  className="group relative overflow-hidden rounded-2xl border border-line bg-surface p-6 shadow-sm hover:shadow-md transition-all"
                >
                  <div className="flex items-start justify-between">
                    <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-canvas text-content-muted group-hover:bg-violet-100 group-hover:text-violet-600 transition-colors">
                      <KindIcon className="h-6 w-6" />
                    </div>
                    <div className="flex gap-2">
                      <button onClick={() => handleEdit(p)} className="rounded-lg p-2 text-content-subtle hover:bg-canvas hover:text-primary transition-all"><Edit2 className="h-4 w-4" /></button>
                      <button onClick={() => handleDelete(p)} className="rounded-lg p-2 text-content-subtle hover:bg-red-50 hover:text-red-600 transition-all"><Trash2 className="h-4 w-4" /></button>
                    </div>
                  </div>
                  <div className="mt-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="text-[10px] font-bold uppercase tracking-wider text-violet-600 bg-violet-500/5 px-2 py-0.5 rounded-full">{kindOf(p).label}</span>
                      {p.active === false && <span className="text-[10px] font-bold uppercase text-content-subtle bg-surface-muted px-2 py-0.5 rounded-full">Inativo</span>}
                      {p.trackStock && (
                        isLowStock(p)
                          ? <span className="flex items-center gap-1 text-[10px] font-bold uppercase text-red-600 bg-red-50 px-2 py-0.5 rounded-full dark:bg-red-950/50"><AlertTriangle className="h-2.5 w-2.5" /> Estoque {p.stock ?? 0}</span>
                          : <span className="text-[10px] font-bold uppercase text-content-subtle bg-surface-muted px-2 py-0.5 rounded-full">Estoque {p.stock ?? 0}</span>
                      )}
                    </div>
                    <h3 className="mt-2 text-lg font-bold text-content">{p.name}</h3>
                    {p.category && <p className="mt-0.5 flex items-center gap-1 text-[11px] text-content-subtle"><Tag className="h-3 w-3" /> {p.category}</p>}
                  </div>
                  <div className="mt-4 flex items-end justify-between border-t border-line pt-4">
                    <div>
                      <p className="text-[10px] uppercase text-content-subtle">Preço {p.unit ? `/ ${p.unit}` : ''}</p>
                      <p className="text-lg font-black text-emerald-600">{priceLabel(p)}</p>
                    </div>
                    {(p.variations?.length || 0) > 0 && (
                      <span className="flex items-center gap-1 text-[11px] font-bold text-content-subtle"><Layers className="h-3 w-3" /> {p.variations!.length} variações</span>
                    )}
                  </div>
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}

      {isModalOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm" onClick={() => setIsModalOpen(false)}>
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            onClick={e => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-2xl bg-surface shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto"
          >
            <div className="p-6 border-b border-line flex items-center justify-between bg-surface-muted/40">
              <h3 className="text-xl font-bold text-content">{editing ? 'Editar Produto' : 'Novo Produto'}</h3>
              <button onClick={() => setIsModalOpen(false)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted"><X className="h-5 w-5" /></button>
            </div>

            <form onSubmit={handleSubmit} className="p-6 space-y-4">
              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Entidade</label>
                  <select value={targetEntityId} onChange={(e) => setTargetEntityId(e.target.value)} required
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">Selecione...</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Tipo</label>
                  <select value={kind} onChange={(e) => setKind(e.target.value as NonNullable<Product['kind']>)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20">
                    {KINDS.map(k => <option key={k.id} value={k.id}>{k.label}</option>)}
                  </select>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-2">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Nome do produto</label>
                  <input type="text" value={name} onChange={(e) => setName(e.target.value)} required
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="Ex: Cartão de visita, Peça 3D..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Categoria</label>
                  <input type="text" value={category} onChange={(e) => setCategory(e.target.value)} list="prod-cats"
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="Ex: Impressos, Brindes..." />
                  <datalist id="prod-cats">{categories.map(c => <option key={c} value={c} />)}</datalist>
                </div>
              </div>

              <div className="grid gap-4 sm:grid-cols-3">
                <div>
                  <label className="block text-sm font-medium text-content-muted">Unidade</label>
                  <input type="text" value={unit} onChange={(e) => setUnit(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="un, cento, m²..." />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Preço base (R$)</label>
                  <input type="number" step="0.01" value={basePrice} onChange={(e) => setBasePrice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="0,00" />
                </div>
                <div>
                  <label className="block text-sm font-medium text-content-muted">Custo (R$)</label>
                  <input type="number" step="0.01" value={costPrice} onChange={(e) => setCostPrice(e.target.value)}
                    className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="0,00" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-medium text-content-muted">Descrição (opcional)</label>
                <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={2}
                  className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="Detalhes, material, acabamento..." />
              </div>

              {/* Variações */}
              <div className="rounded-xl bg-canvas p-4">
                <div className="mb-3 flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Layers className="h-4 w-4 text-violet-600" />
                    <p className="text-xs font-bold uppercase tracking-wider text-content-subtle">Variações (opcional)</p>
                  </div>
                  <button type="button" onClick={addVariation} className="flex items-center gap-1 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-violet-700">
                    <Plus className="h-3.5 w-3.5" /> Adicionar
                  </button>
                </div>
                {variations.length === 0 ? (
                  <p className="text-xs text-content-subtle">Sem variações → usa o preço base. Adicione se o produto tiver tamanhos/materiais com preços diferentes.</p>
                ) : (
                  <div className="space-y-2">
                    <div className="hidden sm:grid grid-cols-12 gap-2 px-1 text-[10px] font-bold uppercase text-content-subtle">
                      <span className="col-span-6">Nome da variação</span><span className="col-span-3">Preço</span><span className="col-span-2">Custo</span><span className="col-span-1"></span>
                    </div>
                    {variations.map(v => (
                      <div key={v.id} className="grid grid-cols-12 gap-2">
                        <input value={v.name} onChange={e => updateVariation(v.id, { name: e.target.value })} placeholder="Ex: A4, 9x5cm, 5cm"
                          className="col-span-12 sm:col-span-6 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                        <input type="number" step="0.01" value={v.price || ''} onChange={e => updateVariation(v.id, { price: Number(e.target.value) })} placeholder="Preço"
                          className="col-span-6 sm:col-span-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                        <input type="number" step="0.01" value={v.cost || ''} onChange={e => updateVariation(v.id, { cost: Number(e.target.value) })} placeholder="Custo"
                          className="col-span-5 sm:col-span-2 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                        <button type="button" onClick={() => removeVariation(v.id)} className="col-span-1 flex items-center justify-center rounded-lg text-content-subtle hover:text-rose-600" title="Remover">
                          <Trash2 className="h-4 w-4" />
                        </button>
                      </div>
                    ))}
                  </div>
                )}
              </div>

              {/* Estoque */}
              <div className="rounded-xl bg-canvas p-4">
                <label className="flex items-center gap-2 text-sm font-medium text-content">
                  <input type="checkbox" checked={trackStock} onChange={(e) => setTrackStock(e.target.checked)} />
                  Controlar estoque deste produto
                </label>
                {trackStock && (
                  <div className="mt-3 grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-content-subtle">Estoque atual</label>
                      <input type="number" step="1" value={stock} onChange={(e) => setStock(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="0" />
                    </div>
                    <div>
                      <label className="block text-[11px] font-bold uppercase text-content-subtle">Estoque mínimo (alerta)</label>
                      <input type="number" step="1" value={minStock} onChange={(e) => setMinStock(e.target.value)}
                        className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" placeholder="0" />
                    </div>
                  </div>
                )}
              </div>

              <label className="flex items-center gap-2 text-sm text-content-muted">
                <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
                Produto ativo (aparece para venda)
              </label>

              <div className="flex gap-3 pt-4">
                <button type="button" onClick={() => setIsModalOpen(false)} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-content-muted hover:bg-canvas">Cancelar</button>
                <button type="submit" className="flex-1 rounded-lg bg-violet-600 py-2.5 text-sm font-semibold text-white hover:bg-violet-700 shadow-md shadow-violet-500/20">
                  {editing ? 'Salvar Alterações' : 'Cadastrar Produto'}
                </button>
              </div>
            </form>
          </motion.div>
        </div>
      )}
    </div>
  );
};
