import React, { useState, useEffect } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { useAuth } from '../contexts/AuthContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, orderBy, limit, doc, updateDoc, getDoc, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Product, Transaction, SaleItem, Client, BankAccount } from '../types';
import { ShoppingCart, Plus, Trash2, X, Package, CheckCircle2, Clock } from 'lucide-react';
import { motion } from 'motion/react';
import { cn } from '../lib/utils';
import { parseLocalDate } from '../lib/finance';
import { StockMovement, stockMovementsDocPath, readMovements, applyDelta } from '../lib/stock';

const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);
const today = () => new Date().toISOString().split('T')[0];

interface Line { id: string; productId: string; variationId: string; qty: string; unitPrice: string; }
const emptyLine = (): Line => ({ id: crypto.randomUUID(), productId: '', variationId: '', qty: '1', unitPrice: '' });

export const Vendas: React.FC = () => {
  const { entities, filterType } = useEntity();
  const { user } = useAuth();
  const { showToast } = useUI();
  const [products, setProducts] = useState<Product[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [accounts, setAccounts] = useState<BankAccount[]>([]);
  const [sales, setSales] = useState<Transaction[]>([]);
  const [isOpen, setIsOpen] = useState(false);
  const [saving, setSaving] = useState(false);

  // Form
  const [entityId, setEntityId] = useState('');
  const [clientId, setClientId] = useState('');
  const [lines, setLines] = useState<Line[]>([emptyLine()]);
  const [date, setDate] = useState(today());
  const [received, setReceived] = useState(true);
  const [accountId, setAccountId] = useState('');

  useEffect(() => {
    if (entities.length === 0) return;
    const ents = filterType === 'ALL' ? entities : entities.filter(e => e.type === filterType);
    const unsubs: (() => void)[] = [];
    let allP: Product[] = [], allC: Client[] = [], allA: BankAccount[] = [], allS: Transaction[] = [];
    ents.forEach(entity => {
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/products`)), (s) => {
        const list = (s.docs.map(d => ({ id: d.id, ...d.data() })) as Product[]).filter(p => p.itemType !== 'supply' && p.active !== false);
        allP = [...allP.filter(p => p.entityId !== entity.id), ...list]; setProducts([...allP]);
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'products')));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/clients`)), (s) => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as Client[];
        allC = [...allC.filter(c => c.entityId !== entity.id), ...list]; setClients([...allC]);
      }, () => {}));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/bank_accounts`)), (s) => {
        const list = s.docs.map(d => ({ id: d.id, ...d.data() })) as BankAccount[];
        allA = [...allA.filter(a => a.entityId !== entity.id), ...list]; setAccounts([...allA]);
      }, () => {}));
      unsubs.push(onSnapshot(query(collection(db, `entities/${entity.id}/transactions`), orderBy('date', 'desc'), limit(200)), (s) => {
        const list = (s.docs.map(d => ({ id: d.id, ...d.data() })) as Transaction[]).filter(t => t.isSale);
        allS = [...allS.filter(t => t.entityId !== entity.id), ...list];
        setSales([...allS].sort((a, b) => (a.date < b.date ? 1 : -1)));
      }, (e) => handleFirestoreError(e, OperationType.LIST, 'transactions')));
    });
    return () => unsubs.forEach(u => u());
  }, [entities, filterType]);

  const reset = () => { setEntityId(''); setClientId(''); setLines([emptyLine()]); setDate(today()); setReceived(true); setAccountId(''); };

  const productsOfEntity = products.filter(p => p.entityId === entityId);
  const clientsOfEntity = clients.filter(c => c.entityId === entityId);
  const accountsOfEntity = accounts.filter(a => a.entityId === entityId);

  const priceFor = (p: Product | undefined, variationId: string): number => {
    if (!p) return 0;
    if (variationId) { const v = (p.variations || []).find(x => x.id === variationId); if (v) return Number(v.price) || 0; }
    return Number(p.basePrice) || 0;
  };

  const setLineProduct = (lineId: string, productId: string) => {
    const p = productsOfEntity.find(x => x.id === productId);
    const firstVar = p?.variations && p.variations.length ? p.variations[0].id : '';
    setLines(ls => ls.map(l => l.id === lineId ? { ...l, productId, variationId: firstVar, unitPrice: String(priceFor(p, firstVar)) } : l));
  };
  const setLineVariation = (lineId: string, variationId: string) => {
    setLines(ls => ls.map(l => {
      if (l.id !== lineId) return l;
      const p = productsOfEntity.find(x => x.id === l.productId);
      return { ...l, variationId, unitPrice: String(priceFor(p, variationId)) };
    }));
  };
  const updateLine = (lineId: string, patch: Partial<Line>) => setLines(ls => ls.map(l => l.id === lineId ? { ...l, ...patch } : l));
  const removeLine = (lineId: string) => setLines(ls => ls.length > 1 ? ls.filter(l => l.id !== lineId) : ls);

  const total = lines.reduce((acc, l) => acc + (Number(l.qty) || 0) * (Number(l.unitPrice) || 0), 0);

  const handleSave = async () => {
    if (!entityId) { showToast('Escolha a entidade.', 'error'); return; }
    const validLines = lines.filter(l => l.productId && (Number(l.qty) || 0) > 0);
    if (validLines.length === 0) { showToast('Adicione ao menos um produto.', 'error'); return; }
    if (received && !accountId) { showToast('Escolha a conta que recebeu o valor.', 'error'); return; }
    setSaving(true);
    const ent = entities.find(e => e.id === entityId);
    const client = clientsOfEntity.find(c => c.id === clientId);
    const saleItems: SaleItem[] = validLines.map(l => {
      const p = productsOfEntity.find(x => x.id === l.productId)!;
      const v = (p.variations || []).find(x => x.id === l.variationId);
      return {
        productId: p.id,
        name: p.name,
        variationName: v?.name,
        qty: Number(l.qty) || 0,
        unitPrice: Number(l.unitPrice) || 0,
      };
    });
    const totalAmount = saleItems.reduce((a, i) => a + i.qty * i.unitPrice, 0);
    const resumo = saleItems.length === 1
      ? `${saleItems[0].name}${saleItems[0].variationName ? ` (${saleItems[0].variationName})` : ''}`
      : `${saleItems[0].name} +${saleItems.length - 1} item(ns)`;
    try {
      // 1) Lançamento de receita (integra com o caixa).
      await addDoc(collection(db, `entities/${entityId}/transactions`), {
        description: `Venda: ${resumo}${client ? ` — ${client.name}` : ''}`,
        amount: Math.round(totalAmount * 100) / 100,
        type: 'income',
        date,
        categoryId: 'venda',
        status: received ? 'completed' : 'pending',
        accountId: received ? accountId : null,
        paidAt: received ? date : null,
        clientId: clientId || null,
        clientName: client?.name || null,
        isSale: true,
        saleItems,
        entityId,
        ownerUid: ent?.ownerUid,
        collaboratorsEmails: ent?.collaboratorsEmails || [],
        createdAt: serverTimestamp(),
      });

      // 2) Baixa de estoque + movimentações (só produtos com controle de estoque).
      const movs: StockMovement[] = [];
      for (const item of saleItems) {
        const p = productsOfEntity.find(x => x.id === item.productId);
        if (!p || !p.trackStock) continue;
        const balanceAfter = applyDelta(p.stock, -item.qty);
        await updateDoc(doc(db, `entities/${entityId}/products/${p.id}`), { stock: balanceAfter });
        movs.push({
          id: crypto.randomUUID(), itemType: 'product', itemId: p.id,
          itemName: item.variationName ? `${p.name} (${item.variationName})` : p.name,
          delta: -item.qty, balanceAfter, reason: 'venda',
          note: client ? `Venda p/ ${client.name}` : 'Venda', at: new Date().toISOString(), by: user?.email || undefined,
        });
      }
      if (movs.length) {
        const path = stockMovementsDocPath(entityId);
        const snap = await getDoc(doc(db, path));
        const list = readMovements(snap.data());
        await setDoc(doc(db, path), { items: [...movs, ...list].slice(0, 300), updatedAt: serverTimestamp() }, { merge: true });
      }

      setIsOpen(false); reset();
      showToast(`Venda registrada: ${brl(totalAmount)}${received ? '' : ' (a receber)'}.`, 'success');
    } catch (error) {
      console.error('Erro ao registrar venda:', error);
      showToast('Erro ao registrar a venda.', 'error');
    } finally { setSaving(false); }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-4">
          <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-emerald-100 text-emerald-600 dark:bg-emerald-950/50"><ShoppingCart className="h-7 w-7" /></div>
          <div>
            <h2 className="text-2xl font-black tracking-tight text-content">Vendas</h2>
            <p className="text-sm text-content-subtle">Registre a venda: baixa o estoque e cai como receita no caixa.</p>
          </div>
        </div>
        <button onClick={() => { reset(); setIsOpen(true); }} className="flex items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-8 py-4 text-sm font-black text-white shadow-xl hover:bg-emerald-700 transition-all hover:scale-105 active:scale-95">
          <Plus className="h-5 w-5" /> Nova Venda
        </button>
      </div>

      <div className="overflow-x-auto rounded-2xl border border-line">
        {sales.length === 0 ? (
          <p className="p-10 text-center text-sm text-content-subtle">Nenhuma venda registrada ainda.</p>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-surface-muted text-[10px] uppercase text-content-subtle">
              <tr><th className="px-4 py-3 text-left">Data</th><th className="px-4 py-3 text-left">Descrição</th><th className="px-4 py-3 text-center">Itens</th><th className="px-4 py-3 text-center">Status</th><th className="px-4 py-3 text-right">Total</th></tr>
            </thead>
            <tbody>
              {sales.map(s => (
                <tr key={s.id} className="border-t border-line">
                  <td className="px-4 py-3 text-content-subtle">{parseLocalDate(s.date).toLocaleDateString('pt-BR')}</td>
                  <td className="px-4 py-3 font-medium text-content">{s.description?.replace(/^Venda:\s*/, '')}</td>
                  <td className="px-4 py-3 text-center text-content-subtle">{s.saleItems?.reduce((a, i) => a + (i.qty || 0), 0) || '—'}</td>
                  <td className="px-4 py-3 text-center">
                    {s.status === 'completed'
                      ? <span className="inline-flex items-center gap-1 rounded-full bg-green-100 px-2 py-0.5 text-[10px] font-bold uppercase text-green-700 dark:bg-green-950/50"><CheckCircle2 className="h-3 w-3" /> Recebido</span>
                      : <span className="inline-flex items-center gap-1 rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-bold uppercase text-blue-600 dark:bg-blue-950/40"><Clock className="h-3 w-3" /> A receber</span>}
                  </td>
                  <td className="px-4 py-3 text-right font-bold text-emerald-600">{brl(s.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {isOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-4 backdrop-blur-sm" onClick={() => setIsOpen(false)}>
          <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} onClick={e => e.stopPropagation()}
            className="relative w-full max-w-3xl rounded-2xl bg-surface shadow-2xl overflow-hidden max-h-[92vh] overflow-y-auto">
            <div className="flex items-center justify-between border-b border-line p-6"><h3 className="text-xl font-bold text-content">Nova Venda</h3>
              <button onClick={() => setIsOpen(false)} className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted"><X className="h-5 w-5" /></button></div>

            <div className="space-y-4 p-6">
              <div className="grid gap-4 sm:grid-cols-3">
                <div><label className="block text-sm font-medium text-content-muted">Entidade</label>
                  <select value={entityId} onChange={e => { setEntityId(e.target.value); setClientId(''); setAccountId(''); setLines([emptyLine()]); }} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20">
                    <option value="">Selecione...</option>{entities.map(e => <option key={e.id} value={e.id}>{e.name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium text-content-muted">Cliente (opcional)</label>
                  <select value={clientId} onChange={e => setClientId(e.target.value)} disabled={!entityId} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20 disabled:opacity-50">
                    <option value="">Nenhum</option>{clientsOfEntity.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select></div>
                <div><label className="block text-sm font-medium text-content-muted">Data</label>
                  <input type="date" value={date} onChange={e => setDate(e.target.value)} className="mt-1 w-full rounded-lg border border-line px-4 py-2 outline-none focus:ring-2 focus:ring-primary/20" /></div>
              </div>

              {/* Itens */}
              <div className="rounded-xl bg-canvas p-4">
                <div className="mb-3 flex items-center justify-between">
                  <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-content-subtle"><Package className="h-4 w-4 text-emerald-600" /> Itens</p>
                  <button type="button" onClick={() => setLines(ls => [...ls, emptyLine()])} className="flex items-center gap-1 rounded-lg bg-emerald-600 px-3 py-1.5 text-xs font-bold text-white hover:bg-emerald-700"><Plus className="h-3.5 w-3.5" /> Item</button>
                </div>
                {!entityId ? (
                  <p className="text-xs text-content-subtle">Escolha a entidade para listar os produtos.</p>
                ) : (
                  <div className="space-y-2">
                    {lines.map(l => {
                      const p = productsOfEntity.find(x => x.id === l.productId);
                      const hasVars = !!(p?.variations && p.variations.length);
                      return (
                        <div key={l.id} className="grid grid-cols-12 gap-2">
                          <select value={l.productId} onChange={e => setLineProduct(l.id, e.target.value)}
                            className="col-span-12 sm:col-span-5 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                            <option value="">Produto...</option>{productsOfEntity.map(pr => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                          </select>
                          {hasVars ? (
                            <select value={l.variationId} onChange={e => setLineVariation(l.id, e.target.value)}
                              className="col-span-6 sm:col-span-3 rounded-lg border border-line bg-surface px-3 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                              {p!.variations!.map(v => <option key={v.id} value={v.id}>{v.name}</option>)}
                            </select>
                          ) : <div className="hidden sm:block sm:col-span-3" />}
                          <input type="number" min="1" value={l.qty} onChange={e => updateLine(l.id, { qty: e.target.value })} placeholder="Qtd"
                            className="col-span-3 sm:col-span-1 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                          <input type="number" step="0.01" value={l.unitPrice} onChange={e => updateLine(l.id, { unitPrice: e.target.value })} placeholder="Preço"
                            className="col-span-6 sm:col-span-2 rounded-lg border border-line bg-surface px-2 py-1.5 text-sm outline-none focus:ring-2 focus:ring-primary/20" />
                          <button type="button" onClick={() => removeLine(l.id)} className="col-span-3 sm:col-span-1 flex items-center justify-center rounded-lg text-content-subtle hover:text-rose-600"><Trash2 className="h-4 w-4" /></button>
                        </div>
                      );
                    })}
                  </div>
                )}
                <div className="mt-3 flex justify-end border-t border-line pt-3">
                  <p className="text-sm text-content-subtle">Total: <strong className="text-lg text-emerald-600">{brl(total)}</strong></p>
                </div>
              </div>

              {/* Pagamento */}
              <div className="rounded-xl bg-canvas p-4">
                <label className="flex items-center gap-2 text-sm font-medium text-content">
                  <input type="checkbox" checked={received} onChange={e => setReceived(e.target.checked)} />
                  Já recebi este valor
                </label>
                {received ? (
                  <div className="mt-3">
                    <label className="block text-[11px] font-bold uppercase text-content-subtle">Recebido na conta</label>
                    <select value={accountId} onChange={e => setAccountId(e.target.value)} className="mt-1 w-full rounded-lg border border-line bg-surface px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-primary/20">
                      <option value="">Selecione a conta...</option>{accountsOfEntity.map(a => <option key={a.id} value={a.id}>{a.bankName}</option>)}
                    </select>
                  </div>
                ) : (
                  <p className="mt-2 text-xs text-content-subtle">A venda entra como <strong>a receber</strong> (pendente) no financeiro, com vencimento na data acima.</p>
                )}
              </div>

              <div className="flex gap-3">
                <button type="button" onClick={() => setIsOpen(false)} className="flex-1 rounded-lg border border-line py-2.5 text-sm font-semibold text-content-muted hover:bg-canvas">Cancelar</button>
                <button onClick={handleSave} disabled={saving || total <= 0} className="flex-1 rounded-lg bg-emerald-600 py-2.5 text-sm font-semibold text-white hover:bg-emerald-700 disabled:opacity-50">
                  {saving ? 'Registrando…' : `Registrar venda · ${brl(total)}`}
                </button>
              </div>
            </div>
          </motion.div>
        </div>
      )}
    </div>
  );
};
