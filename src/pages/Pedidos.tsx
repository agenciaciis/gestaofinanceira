import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, onSnapshot, addDoc, updateDoc, deleteDoc, doc, getDoc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product, Client, SaleItem, BankAccount } from '../types';
import { ClipboardList, Plus, Trash2, X, LayoutList, Columns, ChevronRight, DollarSign, Package } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { parseLocalDate } from '../lib/finance';
import { StockMovement, stockMovementsDocPath, readMovements, applyDelta } from '../lib/stock';

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);
const today = () => new Date().toISOString().split('T')[0];

type PedidoStatus = 'aberto' | 'arte' | 'producao' | 'aguardando' | 'entregue';
const STAGES: { id: PedidoStatus; label: string; color: string }[] = [
  { id: 'aberto', label: 'Em aberto', color: 'bg-slate-400' },
  { id: 'arte', label: 'Criando arte', color: 'bg-violet-500' },
  { id: 'producao', label: 'Em produção', color: 'bg-amber-500' },
  { id: 'aguardando', label: 'Aguardando retirada', color: 'bg-blue-500' },
  { id: 'entregue', label: 'Entregue', color: 'bg-emerald-500' },
];
const stageOf = (s?: string) => STAGES.find(x => x.id === s) || STAGES[0];

interface Pedido {
  id: string; docType: 'pedido'; clientId?: string | null; clientName?: string | null;
  items: SaleItem[]; total: number; status: PedidoStatus; paid?: boolean;
  dueDate?: string | null; note?: string | null; entityId: string; createdAt?: any;
}
interface Line { id: string; productId: string; variationId: string; qty: string; unitPrice: string; }
const emptyLine = (): Line => ({ id: crypto.randomUUID(), productId: '', variationId: '', qty: '1', unitPrice: '' });

export const Pedidos: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { user } = useAuth();
  const { showToast, confirm } = useUI();
  const [pedidos, setPedidos] = useState<Pedido[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [view, setView] = useState<'lista' | 'kanban'>('kanban');
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // form
  const [entityId, setEntityId] = useState('');
  const [clientId, setClientId] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [dueDate, setDueDate] = useState('');
  const [note, setNote] = useState('');

  useEffect(() => {
    if (entities.length === 0) return;
    const ents = filterType === 'ALL' ? entities : entities.filter(e => e.type === filterType);
    const unsubs: (() => void)[] = [];
    let allPed: Pedido[] = [], allP: Product[] = [], allC: Client[] = [], allA: BankAccount[] = [];
    ents.forEach(entity => {
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/quotes`)), (s) => {
        const list = (s.docs.map(d => ({ id: d.id, ...d.data() })) as Pedido[]).filter(q => (q as any).docType === 'pedido');
        allPed = [...allPed.filter(p => p.entityId !== entity.id), ...list];
        setPedidos([...allPed].sort((a, b) => ((a.createdAt?.seconds || 0) < (b.createdAt?.seconds || 0) ? 1 : -1)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'quotes')));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/products`)), (s) => {
        const list = (s.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]).filter(p => p.itemType !== 'supply');
        allP = [...allP.filter(p => p.entityId !== entity.id), ...list]; setProducts([...allP]);
      }, () => {}));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/clients`)), (s) => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as Client[];
        allC = [...allC.filter(c => c.entityId !== entity.id), ...list]; setClients([...allC]);
      }, () => {}));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/bank_accounts`)), (s) => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as BankAccount[];
        allA = [...allA.filter(a => a.entityId !== entity.id), ...list]; setAccounts([...allA]);
      }, () => {}));
    });
    return () => unsubs.forEach(u => u());
  }, [entities, filterType]);

  const reset = () => { setEntityId(''); setClientId(''); setLines([emptyLine()]); setDueDate(''); setNote(''); };
  const productsOfEntity = products.filter(p => p.entityId === entityId);
  const clientsOfEntity = clients.filter(c => c.entityId === entityId);

  const priceFor = (p: Product | undefined, variationId: string) => {
    if (!p) return 0;
    if (variationId) { const v = (p.variations || []).find(x => x.id === variationId); if (v) return Number(v.price) || 0; }
    return Number(p.basePrice) || 0;
  };
  const setLineProduct = (id: string, productId: string) => {
    const p = productsOfEntity.find(x => x.id === productId);
    const fv = p?.variations && p.variations.length ? p.variations[0].id : '';
    setLines(ls => ls.map(l => l.id === id ? { ...l, productId, variationId: fv, unitPrice: String(priceFor(p, fv)) } : l));
  };
  const setLineVar = (id: string, variationId: string) => setLines(ls => ls.map(l => {
    if (l.id !== id) return l; const p = productsOfEntity.find(x => x.id === l.productId);
    return { ...l, variationId, unitPrice: String(priceFor(p, variationId)) };
  }));
  const updateLine = (id: string, patch: Partial<Line>) => setLines(ls => ls.map(l => l.id === id ? { ...l, ...patch } : l));
  const removeLine = (id: string) => setLines(ls => ls.length > 1 ? ls.filter(l => l.id !== id) : ls);
  const formTotal = lines.reduce((a, l) => a + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

  const savePedido = async () => {
    if (!entityId) { showToast('Escolha a entidade.', 'error'); return; }
    const valid = lines.filter(l => l.productId && (Number(l.qty) || 0) > 0);
    if (valid.length === 0) { showToast('Adicione ao menos um item.', 'error'); return; }
    setSaving(true);
    const ent = entities.find(e => e.id === entityId);
    const client = clientsOfEntity.find(c => c.id === clientId);
    const items: SaleItem[] = valid.map(l => {
      const p = productsOfEntity.find(x => x.id === l.productId)!;
      const v = (p.variations || []).find(x => x.id === l.variationId);
      return { productId: p.id, name: p.name, variationName: v?.name, qty: Number(l.qty) || 0, unitPrice: Number(l.unitPrice) || 0 };
    });
    const total = items.reduce((a, i) => a + i.qty * i.unitPrice, 0);
    try {
      await addDoc(collection(db, `entities/${entityId}/quotes`), {
        docType: 'pedido', clientId: clientId || null, clientName: client?.name || null,
        items, total: Math.round(total * 100) / 100, status: 'aberto', paid: false,
        dueDate: dueDate || null, note: note.trim() || null, entityId,
        ownerUid: ent?.ownerUid, collaboratorsEmails: ent?.collaboratorsEmails || [],
        createdAt: serverTimestamp(),
      });
      setIsOpen(false); reset();
      showToast('Pedido criado.', 'success');
    } catch (e) { console.error(e); showToast('Erro ao criar o pedido.', 'error'); }
    finally { setSaving(false); }
  };

  const setStatus = async (p: Pedido, status: PedidoStatus) => {
    try { await updateDoc(doc(db, `entities/${p.entityId}/quotes/${p.id}`), { status, updatedAt: serverTimestamp() }); }
    catch (e) { console.error(e); showToast('Erro ao mover o pedido.', 'error'); }
  };
  const advance = (p: Pedido) => {
    const i = STAGES.findIndex(s => s.id === p.status);
    if (i < STAGES.length - 1) setStatus(p, STAGES[i + 1].id);
  };

  const del = async (p: Pedido) => {
    const ok = await confirm({ title: 'Excluir pedido', message: `Excluir o pedido de ${p.clientName || 'cliente'}?`, variant: 'danger' });
    if (!ok) return;
    try { await deleteDoc(doc(db, `entities/${p.entityId}/quotes/${p.id}`)); showToast('Pedido excluído.', 'success'); }
    catch (e) { console.error(e); showToast('Erro ao excluir.', 'error'); }
  };

  // Faturar: cria a receita (isSale) + baixa estoque + marca pago. Pede a conta.
  const [faturando, setFaturando] = useState<Pedido | null>(null);
  const [fatAccount, setFatAccount] = useState('');
  const accountsOfEntity = (eid: string) => accounts.filter(a => a.entityId === eid);
  const confirmFaturar = async () => {
    if (!faturando) return;
    if (!fatAccount) { showToast('Escolha a conta que recebeu.', 'error'); return; }
    const p = faturando;
    try {
      const ent = entities.find(e => e.id === p.entityId);
      await addDoc(collection(db, `entities/${p.entityId}/transactions`), {
        description: `Venda (pedido): ${p.items[0]?.name || 'itens'}${p.items.length > 1 ? ` +${p.items.length - 1}` : ''}${p.clientName ? ` — ${p.clientName}` : ''}`,
        amount: p.total, type: 'income', date: today(), categoryId: 'venda',
        status: 'completed', accountId: fatAccount, paidAt: today(),
        clientId: p.clientId || null, clientName: p.clientName || null,
        isSale: true, saleItems: p.items, entityId: p.entityId,
        ownerUid: ent?.ownerUid, collaboratorsEmails: ent?.collaboratorsEmails || [], createdAt: serverTimestamp(),
      });
      // baixa estoque
      const movs: StockMovement[] = [];
      for (const item of p.items) {
        const prod = products.find(x => x.id === item.productId && x.entityId === p.entityId);
        if (!prod || !prod.trackStock) continue;
        const balanceAfter = applyDelta(prod.stock, -item.qty);
        await updateDoc(doc(db, `entities/${p.entityId}/products/${prod.id}`), { stock: balanceAfter });
        movs.push({ id: crypto.randomUUID(), itemType: 'product', itemId: prod.id, itemName: item.variationName ? `${prod.name} (${item.variationName})` : prod.name, delta: -item.qty, balanceAfter, reason: 'venda', note: `Pedido ${p.clientName || ''}`.trim(), at: new Date().toISOString(), by: user?.email || undefined });
      }
      if (movs.length) {
        const path = stockMovementsDocPath(p.entityId);
        const snap = await getDoc(doc(db, path));
        await setDoc(doc(db, path), { items: [...movs, ...readMovements(snap.data())].slice(0, 300), updatedAt: serverTimestamp() }, { merge: true });
      }
      await updateDoc(doc(db, `entities/${p.entityId}/quotes/${p.id}`), { paid: true, status: 'entregue', updatedAt: serverTimestamp() });
      setFaturando(null); setFatAccount('');
      showToast(`Pedido faturado: ${brl(p.total)} no caixa.`, 'success');
    } catch (e) { console.error(e); showToast('Erro ao faturar o pedido.', 'error'); }
  };

  const PedidoCard: React.FC<{ p: Pedido; compact?: boolean }> = ({ p, compact }) => (
    <div className="rounded-xl border border-line bg-surface p-3 shadow-sm">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-bold text-content">{p.clientName || 'Sem cliente'}</p>
          <p className="truncate text-[11px] text-content-subtle">{p.items.map(i => `${i.qty}× ${i.name}`).join(', ')}</p>
        </div>
        {p.paid && <span className="shrink-0 rounded-full bg-emerald-100 px-2 py-0.5 text-[9px] font-bold uppercase text-emerald-700 dark:bg-emerald-950/50">Pago</span>}
      </div>
      <div className="mt-2 flex items-center justify-between">
        <span className="text-sm font-black text-emerald-600">{brl(p.total)}</span>
        {p.dueDate && <span className="text-[10px] text-content-subtle">entrega {parseLocalDate(p.dueDate).toLocaleDateString('pt-BR', { day: '2-digit', month: '2-digit' })}</span>}
      </div>
      <div className="mt-2 flex items-center gap-1">
        {p.status !== 'entregue' && <button onClick={() => advance(p)} className="flex flex-1 items-center justify-center gap-1 rounded-lg bg-surface-muted px-2 py-1 text-[11px] font-bold text-content hover:bg-line">avançar <ChevronRight className="h-3 w-3" /></button>}
        {!p.paid && <button onClick={() => { setFaturando(p); setFatAccount(''); }} title="Faturar (vira receita + baixa estoque)" className="flex items-center justify-center gap-1 rounded-lg bg-emerald-600 px-2 py-1 text-[11px] font-bold text-white hover:bg-emerald-700"><DollarSign className="h-3 w-3" /> Faturar</button>}
        {!compact && <button onClick={() => del(p)} className="rounded-lg p-1 text-content-subtle hover:text-rose-600"><Trash2 className="h-3.5 w-3.5" /></button>}
      </div>
    </div>
  );

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-blue-100 text-blue-600 dark:bg-blue-950/50"><ClipboardList className="h-7 w-7" /></div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-content">Pedidos</h2>
            <p className="text-sm text-content-subtle">Acompanhe os pedidos na produção (Kanban) e fature quando entregar.</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <div className="flex rounded-xl border border-line bg-surface p-1">
            <button onClick={() => setView('kanban')} className={cn('flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-bold', view === 'kanban' ? 'bg-primary text-white' : 'text-content-subtle')}><Columns className="h-4 w-4" /> Kanban</button>
            <button onClick={() => setView('lista')} className={cn('flex items-center gap-1 rounded-lg px-3 py-1.5 text-sm font-bold', view === 'lista' ? 'bg-primary text-white' : 'text-content-subtle')}><LayoutList className="h-4 w-4" /> Lista</button>
          </div>
          <button onClick={() => { reset(); setIsOpen(true); }} className="flex items-center gap-2 rounded-xl bg-blue-600 px-5 py-2.5 text-sm font-bold text-white hover:bg-blue-700"><Plus className="h-4 w-4" /> Novo Pedido</button>
        </div>
      </div>

      {pedidos.length === 0 ? (
        <p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhum pedido ainda. Crie o primeiro.</p>
      ) : view === 'kanban' ? (
        <div className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          {STAGES.map(stage => {
            const cards = pedidos.filter(p => p.status === stage.id);
            return (
              <div key={stage.id} className="rounded-2xl bg-canvas p-3">
                <div className="mb-3 flex items-center gap-2">
                  <span className={cn('h-2.5 w-2.5 rounded-full', stage.color)} />
                  <span className="text-xs font-black uppercase tracking-wider text-content-subtle">{stage.label}</span>
                  <span className="ml-auto text-xs font-bold text-content-subtle">{cards.length}</span>
                </div>
                <div className="space-y-2">
                  {cards.map(p => <PedidoCard key={p.id} p={p} compact />)}
                </div>
              </div>
            );
          })}
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {pedidos.map(p => (
            <div key={p.id}>
              <div className="mb-1 flex items-center gap-2"><span className={cn('h-2 w-2 rounded-full', stageOf(p.status).color)} /><span className="text-[11px] font-bold uppercase text-content-subtle">{stageOf(p.status).label}</span></div>
              <PedidoCard p={p} />
            </div>
          ))}
        </div>
      )}

      {/* Modal novo pedido */}
      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={e => e.stopPropagation()} className="relative w-full max-w-3xl rounded-2xl bg-surface shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line p-6"><h3 className="text-xl font-bold text-content">Novo Pedido</h3>
              <button onClick={() => setIsOpen(false)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted"><X className="h-5 w-5" /></button></div>
            <div className="space-y-4 p-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div><label className="block text-sm font-medium text-content-muted">Entidade</label>
                  <select value={entityId} onChange={e => { setEntityId(e.target.value); setClientId(''); setLines([emptyLine()]); }} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">Selecione...</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium text-content-muted">Cliente</label>
                  <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={!entityId} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50">
                    <option value="">Nenhum</option>{clientsOfEntity.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium text-content-muted">Entrega</label>
                  <input type="date" value={dueDate} onChange={e => setDueDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" /></div>
              </div>
              <div className="rounded-xl bg-canvas p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-content-subtle"><Package className="h-4 w-4 text-blue-600" /> Itens</p>
                  <button type="button" onClick={() => setLines(ls => [...ls, emptyLine()])} className="flex items-center gap-1 rounded-lg bg-blue-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-blue-700"><Plus className="h-3.5 w-3.5" /> Item</button>
                </div>
                {!entityId ? <p className="text-xs text-content-subtle">Escolha a entidade.</p> : (
                  <div className="space-y-2">
                    {lines.map(l => {
                      const p = productsOfEntity.find(x => x.id === l.productId);
                      const hasVars = !!(p?.variations && p.variations.length);
                      return (
                        <div key={l.id} className="grid grid-cols-12 gap-2">
                          <select value={l.productId} onChange={e => setLineProduct(l.id, e.target.value)} className="col-span-12 sm:col-span-5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                            <option value="">Produto...</option>{productsOfEntity.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                          </select>
                          {hasVars ? (
                            <select value={l.variationId} onChange={e => setLineVar(l.id, e.target.value)} className="col-span-6 sm:col-span-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                              {p!.variations!.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                          ) : <div className="hidden sm:block sm:col-span-3" />}
                          <input type="number" min="1" value={l.qty} onChange={e => updateLine(l.id, { qty: e.target.value })} placeholder="Qtd" className="col-span-3 sm:col-span-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                          <input type="number" step="0.01" value={l.unitPrice} onChange={e => updateLine(l.id, { unitPrice: e.target.value })} placeholder="Preço" className="col-span-6 sm:col-span-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                          <button type="button" onClick={() => removeLine(l.id)} className="col-span-3 sm:col-span-1 flex items-center justify-center rounded-lg text-content-subtle hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 flex justify-end border-t border-line pt-3"><p className="text-sm text-content-subtle">Total: <strong className="text-lg text-blue-600">{brl(formTotal)}</strong></p></div>
              </div>
              <div><label className="block text-sm font-medium text-content-muted">Observações (opcional)</label>
                <input value={note} onChange={e => setNote(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" placeholder="Detalhes do pedido, arte, acabamento..." /></div>
              <div className="flex gap-3">
                <button type="button" onClick={() => setIsOpen(false)} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-content-muted hover:bg-canvas">Cancelar</button>
                <button onClick={savePedido} disabled={saving || formTotal <= 0} className="flex-1 rounded-lg bg-blue-600 py-2.5 text-sm font-semibold text-white hover:bg-blue-700 disabled:opacity-50">{saving ? 'Criando…' : 'Criar pedido'}</button>
              </div>
            </div>
          </motion.div>
        </div>
      )}

      {/* Modal faturar */}
      {faturando && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm" onClick={() => setFaturando(null)}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={e => e.stopPropagation()} className="w-full max-w-md rounded-2xl bg-surface shadow-2xl overflow-hidden">
            <div className="flex items-center justify-between border-b border-line p-6"><div><h3 className="text-lg font-bold text-content">Faturar pedido</h3><p className="text-sm text-content-subtle">{brl(faturando.total)} — vira receita e baixa o estoque.</p></div>
              <button onClick={() => setFaturando(null)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted"><X className="h-5 w-5" /></button></div>
            <div className="space-y-4 p-6">
              <div><label className="block text-[11px] font-bold uppercase text-content-subtle">Recebido na conta</label>
                <select value={fatAccount} onChange={e => setFatAccount(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                  <option value="">Selecione a conta...</option>{accountsOfEntity(faturando.entityId).map(a => <option key={a.id} value={a.id}>{a.bankName}</option>)}
                </select></div>
              <div className="flex gap-3">
                <button onClick={() => setFaturando(null)} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-content-muted hover:bg-canvas">Cancelar</button>
                <button onClick={confirmFaturar} className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700">Faturar {brl(faturando.total)}</button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
