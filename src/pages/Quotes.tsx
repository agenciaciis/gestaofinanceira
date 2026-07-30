import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, setDoc } from 'firebase/firestore';
import { db, handleFirestoreError, OperationType } from '../firebase';
import { Quote, Client, Service, Plan, QuoteItem } from '../types';
import { 
  FileText, 
  Plus, 
  Trash2, 
  Edit2, 
  Search, 
  X, 
  Download, 
  Send, 
  CheckCircle2, 
  Clock, 
  AlertCircle,
  UserPlus,
  Package,
  Layers,
  Calculator,
  ChevronRight,
  Printer,
  Calendar,
  DollarSign,
  Briefcase
, Share2, ImagePlus } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { parseLocalDate } from '../lib/finance';
import { quoteTotals, itemGross } from '../lib/quotes';
import { ViewToggle, useViewMode, DataTable, Column } from '../components/ViewToggle';
import { format, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import { compressLetterhead, validateLetterhead } from '../lib/branding';
import autoTable from 'jspdf-autotable';

export const Quotes: React.FC = () => {
  const { selectedEntity } = useEntity();
  const { showToast, confirm } = useUI();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusMenuFor, setStatusMenuFor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useViewMode('orcamentos', 'grid');
  const [letterhead, setLetterhead] = useState<string | null>(null);
  const [uploadingLetterhead, setUploadingLetterhead] = useState(false);

  // Form states
  const [selectedClientId, setSelectedClientId] = useState('');
  const [isNewClient, setIsNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [quoteDate, setQuoteDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [validUntil, setValidUntil] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  const [paymentMethod, setPaymentMethod] = useState('PIX');
  const [installments, setInstallments] = useState(1);
  const [notes, setNotes] = useState('');
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');

  useEffect(() => {
    if (!selectedEntity) return;

    const quotesQ = query(collection(db, `entities/${selectedEntity.id}/quotes`), orderBy('createdAt', 'desc'));
    const clientsQ = query(collection(db, `entities/${selectedEntity.id}/clients`), orderBy('name', 'asc'));
    const servicesQ = query(collection(db, `entities/${selectedEntity.id}/services`), orderBy('name', 'asc'));
    const plansQ = query(collection(db, `entities/${selectedEntity.id}/plans`), orderBy('name', 'asc'));

    const unsubQuotes = onSnapshot(quotesQ, (snapshot) => {
      setQuotes(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Quote[]);
    }, (error) => {
      console.error("Error fetching quotes:", error);
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/quotes`);
    });

    const unsubClients = onSnapshot(clientsQ, (snapshot) => {
      setClients(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Client[]);
    }, (error) => {
      console.error("Error fetching clients for quotes:", error);
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/clients`);
    });

    const unsubServices = onSnapshot(servicesQ, (snapshot) => {
      setServices(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Service[]);
    }, (error) => {
      console.error("Error fetching services for quotes:", error);
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/services`);
    });

    const unsubPlans = onSnapshot(plansQ, (snapshot) => {
      setPlans(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Plan[]);
      setLoading(false);
    }, (error) => {
      console.error("Error fetching plans for quotes:", error);
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/plans`);
    });

    return () => {
      unsubQuotes();
      unsubClients();
      unsubServices();
      unsubPlans();
    };
  }, [selectedEntity]);

  // Fonte única testada (lib/quotes): round2, desconto abatido uma vez, total nunca negativo.
  const { subtotal, discountTotal, total } = useMemo(() => quoteTotals(quoteItems), [quoteItems]);

  const handleAddItem = (type: 'service' | 'plan') => {
    const newItem: QuoteItem = {
      id: Math.random().toString(36).substr(2, 9),
      description: '',
      quantity: 1,
      unitPrice: 0,
      discount: 0,
      total: 0,
      type
    };
    setQuoteItems([...quoteItems, newItem]);
  };

  const updateItem = (id: string, updates: Partial<QuoteItem>) => {
    setQuoteItems(prev => prev.map(item => {
      if (item.id === id) {
        const updated = { ...item, ...updates };
        // If referenceId changed, update description and price
        if (updates.referenceId) {
          if (item.type === 'service') {
            const s = services.find(serv => serv.id === updates.referenceId);
            if (s) {
              updated.description = s.name;
              updated.unitPrice = s.basePrice;
            }
          } else {
            const p = plans.find(plan => plan.id === updates.referenceId);
            if (p) {
              updated.description = p.name;
              updated.unitPrice = p.price;
            }
          }
        }
        // Guarda contra NaN vindo de inputs vazios. O desconto é abatido uma única
        // vez no total geral (subtotal - discountTotal), então item.total é bruto.
        const qty = Math.max(0, Number(updated.quantity) || 0);
        const price = Math.max(0, Number(updated.unitPrice) || 0);
        updated.quantity = qty;
        updated.unitPrice = price;
        updated.discount = Math.max(0, Number(updated.discount) || 0);
        updated.total = itemGross(updated); // bruto, com round2 (desconto entra no total geral)
        return updated;
      }
      return item;
    }));
  };

  const removeItem = (id: string) => {
    setQuoteItems(prev => prev.filter(item => item.id !== id));
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!selectedEntity) return;

    if (quoteItems.length === 0) {
      showToast('Adicione pelo menos um item ao orçamento.', 'error');
      return;
    }
    if (quoteItems.some(i => !i.description?.trim())) {
      showToast('Há itens sem descrição. Selecione um serviço/plano para cada item.', 'error');
      return;
    }

    try {
      let clientId = selectedClientId;
      let clientName = clients.find(c => c.id === selectedClientId)?.name || '';

      if (isNewClient) {
        const clientDoc = await addDoc(collection(db, `entities/${selectedEntity.id}/clients`), {
          name: newClientName,
          email: newClientEmail,
          entityId: selectedEntity.id,
          ownerUid: selectedEntity.ownerUid,
          collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
          createdAt: serverTimestamp(),
          credentials: {}
        });
        clientId = clientDoc.id;
        clientName = newClientName;
      }

      // Número sequential por mês (ORC-AAAAMM-0001), derivado dos orçamentos já
      // carregados — legível e sem número aleatório.
      const uniqueQuoteNumber = () => {
        const d = new Date();
        const prefix = `ORC-${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}-`;
        const usados = quotes
          .map(q => q.quoteNumber)
          .filter((n): n is string => !!n && n.startsWith(prefix))
          .map(n => parseInt(n.slice(prefix.length), 10))
          .filter(n => Number.isFinite(n));
        const proximo = (usados.length ? Math.max(...usados) : 0) + 1;
        return `${prefix}${String(proximo).padStart(4, '0')}`;
      };

      const quoteData: any = {
        quoteNumber: editingQuote?.quoteNumber || uniqueQuoteNumber(),
        clientId,
        clientName,
        date: quoteDate,
        validUntil,
        items: quoteItems,
        subtotal,
        discountTotal,
        total,
        paymentMethod,
        installments: Number(installments) || 1,
        status: editingQuote?.status || 'draft',
        notes,
        entityId: selectedEntity.id,
        ownerUid: selectedEntity.ownerUid,
        collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
        updatedAt: serverTimestamp(),
        recurrenceConfig: {
          enabled: recurrenceEnabled,
          frequency: recurrenceFrequency,
          startDate: quoteDate
        }
      };

      if (editingQuote) {
        // Preserva o createdAt original na edição.
        await updateDoc(doc(db, `entities/${selectedEntity.id}/quotes/${editingQuote.id}`), quoteData);
      } else {
        quoteData.createdAt = serverTimestamp();
        await addDoc(collection(db, `entities/${selectedEntity.id}/quotes`), quoteData);
      }

      resetForm();
      setIsModalOpen(false);
      showToast(`Orçamento ${editingQuote ? 'atualizado' : 'criado'} com sucesso!`, 'success');
    } catch (error) {
      console.error("Error saving quote:", error);
      showToast('Erro ao salvar orçamento.', 'error');
    }
  };

  const resetForm = () => {
    setSelectedClientId('');
    setIsNewClient(false);
    setNewClientName('');
    setNewClientEmail('');
    setQuoteDate(format(new Date(), 'yyyy-MM-dd'));
    setValidUntil(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
    setQuoteItems([]);
    setPaymentMethod('PIX');
    setInstallments(1);
    setNotes('');
    setRecurrenceEnabled(false);
    setRecurrenceFrequency('monthly');
    setEditingQuote(null);
  };

  const handleEdit = (quote: Quote) => {
    setEditingQuote(quote);
    setSelectedClientId(quote.clientId);
    setQuoteDate(quote.date);
    setValidUntil(quote.validUntil);
    setQuoteItems(quote.items || []);
    setPaymentMethod(quote.paymentMethod);
    setInstallments(quote.installments);
    setNotes(quote.notes || '');
    setRecurrenceEnabled(quote.recurrenceConfig?.enabled || false);
    setRecurrenceFrequency(quote.recurrenceConfig?.frequency || 'monthly');
    setIsModalOpen(true);
  };

  const handleDelete = async (id: string) => {
    if (!selectedEntity) return;
    const confirmed = await confirm({
      title: 'Excluir Orçamento',
      message: 'Tem certeza que deseja excluir este orçamento?',
      variant: 'danger'
    });
    if (!confirmed) return;
    
    try {
      await deleteDoc(doc(db, `entities/${selectedEntity.id}/quotes`, id));
      showToast('Orçamento excluído com sucesso.', 'success');
    } catch (error) {
      console.error("Error deleting quote:", error);
      showToast('Erro ao excluir orçamento.', 'error');
    }
  };

  const updateStatus = async (id: string, status: Quote['status']) => {
    if (!selectedEntity) return;
    try {
      await updateDoc(doc(db, `entities/${selectedEntity.id}/quotes/${id}`), { status });
      showToast('Status atualizado com sucesso.', 'success');
    } catch (error) {
      console.error("Error updating status:", error);
      showToast('Erro ao atualizar status.', 'error');
    }
  };

  // Papel timbrado da entidade (guardado como imagem no próprio Firestore).
  useEffect(() => {
    if (!selectedEntity) return;
    return onSnapshot(doc(db, `entities/${selectedEntity.id}/config/branding`), snap => {
      setLetterhead((snap.data()?.letterhead as string) || null);
    }, e => handleFirestoreError(e, OperationType.GET, `entities/${selectedEntity.id}/config/branding`));
  }, [selectedEntity]);

  const handleLetterheadUpload = async (file: File) => {
    if (!selectedEntity) return;
    setUploadingLetterhead(true);
    try {
      const compressed = await compressLetterhead(file);
      const check = validateLetterhead(compressed);
      if (!check.ok) { showToast(check.reason || 'Imagem inválida.', 'error'); return; }
      await setDoc(doc(db, `entities/${selectedEntity.id}/config/branding`),
        { letterhead: compressed, updatedAt: serverTimestamp() }, { merge: true });
      showToast('Papel timbrado salvo! Os próximos orçamentos já saem nele.', 'success');
    } catch (error: any) {
      console.error('Erro no papel timbrado:', error);
      showToast(error?.message || 'Não consegui processar a imagem.', 'error');
    } finally {
      setUploadingLetterhead(false);
    }
  };

  const removeLetterhead = async () => {
    if (!selectedEntity) return;
    await setDoc(doc(db, `entities/${selectedEntity.id}/config/branding`), { letterhead: null }, { merge: true });
    showToast('Papel timbrado removido.', 'success');
  };

  const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

  /**
   * Monta o PDF COMPLETO (itens, totais, pagamento) — com ou sem papel timbrado.
   * Antes, o caminho com timbrado saía só com o cabeçalho, sem valores.
   * Os totais são recalculados por `quoteTotals` para não depender do que ficou gravado.
   */
  const buildPDF = (quote: Quote): jsPDF => {
    const doc = new jsPDF();
    const itens = quote.items || [];
    const totais = quoteTotals(itens);
    let bodyStartY: number;

    if (letterhead) {
      // A4 = 210 x 297 mm. O timbrado ocupa a página inteira, como fundo.
      doc.addImage(letterhead, 'JPEG', 0, 0, 210, 297, undefined, 'FAST');
      doc.setTextColor(30, 41, 59);
      doc.setFontSize(16);
      doc.setFont('helvetica', 'bold');
      doc.text(`ORÇAMENTO ${quote.quoteNumber}`, 14, 52);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text(`Cliente: ${quote.clientName}`, 14, 60);
      doc.text(`Data: ${format(parseLocalDate(quote.date), 'dd/MM/yyyy')}`, 150, 60);
      doc.text(`Validade: ${format(parseLocalDate(quote.validUntil), 'dd/MM/yyyy')}`, 150, 66);
      bodyStartY = 78;
    } else {
      // Cabeçalho azul padrão (sem papel timbrado cadastrado).
      doc.setFillColor(37, 99, 235);
      doc.rect(0, 0, 210, 40, 'F');
      doc.setTextColor(255, 255, 255);
      doc.setFontSize(24);
      doc.setFont('helvetica', 'bold');
      doc.text('AGÊNCIA CIIS', 14, 25);
      doc.setFontSize(10);
      doc.setFont('helvetica', 'normal');
      doc.text('Soluções Digitais & Gestão Financeira', 14, 32);
      doc.setFontSize(12);
      doc.text(`ORÇAMENTO: ${quote.quoteNumber}`, 150, 25);
      doc.setTextColor(0, 0, 0);
      doc.setFontSize(12);
      doc.setFont('helvetica', 'bold');
      doc.text('CLIENTE:', 14, 55);
      doc.setFont('helvetica', 'normal');
      doc.text(quote.clientName, 14, 62);
      doc.setFont('helvetica', 'bold');
      doc.text('DATA:', 150, 55);
      doc.setFont('helvetica', 'normal');
      doc.text(format(parseLocalDate(quote.date), 'dd/MM/yyyy'), 150, 62);
      doc.setFont('helvetica', 'bold');
      doc.text('VALIDADE:', 150, 72);
      doc.setFont('helvetica', 'normal');
      doc.text(format(parseLocalDate(quote.validUntil), 'dd/MM/yyyy'), 150, 79);
      bodyStartY = 90;
    }

    // Tabela de itens (comum aos dois caminhos).
    const tableData = itens.map(item => [
      item.description,
      String(item.quantity),
      brl(item.unitPrice),
      brl(itemGross(item)),
    ]);

    autoTable(doc, {
      startY: bodyStartY,
      head: [['Descrição', 'Qtd', 'Unitário', 'Total']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 10 },
      margin: { left: 14, right: 14 },
    });

    // Totais.
    let y = (doc as any).lastAutoTable.finalY + 10;
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.setFont('helvetica', 'bold');
    doc.text('Subtotal:', 140, y);
    doc.setFont('helvetica', 'normal');
    doc.text(brl(totais.subtotal), 170, y);

    if (totais.discountTotal > 0) {
      y += 7;
      doc.setFont('helvetica', 'bold');
      doc.text('Desconto:', 140, y);
      doc.setFont('helvetica', 'normal');
      doc.text(`- ${brl(totais.discountTotal)}`, 170, y);
    }

    y += 10;
    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text('TOTAL:', 140, y);
    doc.text(brl(totais.total), 170, y);

    // Pagamento e observações.
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('FORMA DE PAGAMENTO:', 14, y + 13);
    doc.setFont('helvetica', 'normal');
    doc.text(`${quote.paymentMethod || '-'} ${(quote.installments || 1) > 1 ? `(${quote.installments}x)` : ''}`, 14, y + 20);

    if (quote.notes) {
      doc.setFont('helvetica', 'bold');
      doc.text('OBSERVAÇÕES:', 14, y + 33);
      doc.setFont('helvetica', 'normal');
      doc.text(quote.notes, 14, y + 40, { maxWidth: 180 });
    }

    return doc;
  };

  const exportPDF = (quote: Quote) => {
    buildPDF(quote).save(`Orcamento_${quote.quoteNumber}.pdf`);
  };

  /** Abre o PDF numa aba e dispara a impressão — sai idêntico ao arquivo. */
  const printQuote = (quote: Quote) => {
    const pdf = buildPDF(quote);
    pdf.autoPrint();
    const url = pdf.output('bloburl');
    window.open(url as unknown as string, '_blank');
  };

  /** Usa o compartilhamento nativo (celular). Sem suporte, baixa o arquivo. */
  const shareQuote = async (quote: Quote) => {
    const pdf = buildPDF(quote);
    const blob = pdf.output('blob');
    const file = new File([blob], `Orcamento_${quote.quoteNumber}.pdf`, { type: 'application/pdf' });
    const nav = navigator as Navigator & { canShare?: (d: any) => boolean; share?: (d: any) => Promise<void> };
    if (nav.canShare?.({ files: [file] }) && nav.share) {
      try { await nav.share({ files: [file], title: `Orçamento ${quote.quoteNumber}` }); return; }
      catch { /* usuário cancelou: cai no download */ }
    }
    pdf.save(`Orcamento_${quote.quoteNumber}.pdf`);
    showToast('Compartilhamento não disponível aqui — baixei o PDF.', 'success');
  };

  const filteredQuotes = quotes.filter(q => 
    q.clientName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    q.quoteNumber.toLowerCase().includes(searchTerm.toLowerCase())
  );

  const STATUS_ROTULO: Record<string, { texto: string; cor: string }> = {
    draft: { texto: 'Rascunho', cor: 'text-content-subtle' },
    sent: { texto: 'Enviado', cor: 'text-blue-600' },
    approved: { texto: 'Aprovado', cor: 'text-emerald-600' },
    converted: { texto: 'Convertido', cor: 'text-emerald-700' },
    rejected: { texto: 'Recusado', cor: 'text-rose-600' },
  };

  const colunasOrcamentos: Column<Quote>[] = [
    { chave: 'numero', titulo: 'Nº', render: (q) => <span className="font-black text-content">{q.quoteNumber}</span> },
    { chave: 'cliente', titulo: 'Cliente', render: (q) => q.clientName || '—' },
    {
      chave: 'data', titulo: 'Data', escondeNoMobile: true,
      render: (q) => q.date ? format(parseLocalDate(q.date), 'dd/MM/yyyy') : '—',
    },
    {
      chave: 'validade', titulo: 'Vence', escondeNoMobile: true,
      render: (q) => q.validUntil ? format(parseLocalDate(q.validUntil), 'dd/MM/yyyy') : '—',
    },
    { chave: 'itens', titulo: 'Itens', numerico: true, escondeNoMobile: true, render: (q) => String(q.items?.length || 0) },
    {
      chave: 'total', titulo: 'Total', numerico: true,
      render: (q) => (
        <span className="font-black text-content">
          {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(q.total) || 0)}
        </span>
      ),
    },
    {
      chave: 'status', titulo: 'Situação',
      render: (q) => {
        const st = STATUS_ROTULO[q.status] || { texto: q.status, cor: 'text-content-muted' };
        return <span className={cn('text-xs font-bold', st.cor)}>{st.texto}</span>;
      },
    },
  ];

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
      <div className="rounded-[2.5rem] bg-blue-50 dark:bg-gradient-to-br dark:from-blue-900 dark:to-indigo-950 p-8 text-blue-900 dark:text-white shadow-xl shadow-blue-100 dark:shadow-none relative overflow-hidden group border border-blue-100 dark:border-blue-900/30">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-surface dark:bg-white/10 backdrop-blur-md border border-blue-200 dark:border-white/30 shadow-inner">
              <Briefcase className="h-10 w-10 text-blue-600 dark:text-white" />
            </div>
            <div>
              <div className="flex items-center gap-2 mb-1">
                <span className="text-[10px] font-black uppercase tracking-[0.3em] text-blue-400 dark:text-white/60">Agência CIIS</span>
              </div>
              <h2 className="text-4xl font-black tracking-tighter">Central de Orçamentos</h2>
              <p className="text-sm font-medium text-blue-700 dark:text-white/80 mt-1">Gere propostas profissionais e gerencie recorrências com facilidade.</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <ViewToggle mode={viewMode} onChange={setViewMode} />
            <button
              onClick={() => { resetForm(); setIsModalOpen(true); }}
              className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 text-sm font-black text-white shadow-xl hover:bg-blue-700 transition-all transform hover:scale-105 active:scale-95"
            >
              <Plus className="h-5 w-5" />
              Novo Orçamento
            </button>
          </div>
        </div>

      {/* Papel timbrado — sai no PDF de todos os orçamentos desta entidade */}
      <div className="rounded-2xl bg-surface p-5 border border-line shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 items-center justify-center rounded-2xl bg-surface-muted text-content-muted">
              <ImagePlus className="h-5 w-5" />
            </div>
            <div>
              <p className="font-black text-content">Papel timbrado</p>
              <p className="text-xs text-content-subtle">
                Envie o A4 com sua logo. Todo orçamento passa a sair nele, pronto para baixar, imprimir ou enviar.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {letterhead && (
              <img src={letterhead} alt="Papel timbrado" className="h-16 w-auto rounded-lg border border-line" />
            )}
            <label className="cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90">
              {uploadingLetterhead ? 'Processando...' : letterhead ? 'Trocar' : 'Enviar imagem'}
              <input
                type="file" accept="image/png,image/jpeg,image/webp" className="hidden"
                disabled={uploadingLetterhead}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleLetterheadUpload(f); e.target.value = ''; }}
              />
            </label>
            {letterhead && (
              <button onClick={removeLetterhead}
                className="text-xs font-bold text-content-subtle hover:text-rose-600">Remover</button>
            )}
          </div>
        </div>
      </div>

        
        {/* Decorative elements */}
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-blue-400/20 blur-2xl" />
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-4 top-3 h-5 w-5 text-content-subtle" />
          <input 
            type="text"
            placeholder="Buscar por cliente ou número..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl border border-line bg-surface pl-12 pr-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all shadow-sm"
          />
        </div>
      </div>

      {viewMode === 'list' && (
        <DataTable
          itens={filteredQuotes}
          colunas={colunasOrcamentos}
          acoes={(q) => (
            <>
              <button onClick={() => exportPDF(q)} title="Baixar PDF"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                <Download className="h-4 w-4" />
              </button>
              <button onClick={() => printQuote(q)} title="Imprimir"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                <Printer className="h-4 w-4" />
              </button>
              <button onClick={() => handleEdit(q)} title="Editar"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                <Edit2 className="h-4 w-4" />
              </button>
              <button onClick={() => handleDelete(q.id)} title="Excluir"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-rose-600">
                <Trash2 className="h-4 w-4" />
              </button>
            </>
          )}
          vazio={<p className="rounded-2xl border border-dashed border-line p-10 text-center text-sm text-content-subtle">Nenhum orçamento encontrado.</p>}
        />
      )}

      {/* Quotes List */}
      {viewMode === 'grid' && <div className="grid gap-6">
        {filteredQuotes.map(quote => (
          <motion.div 
            layout
            key={quote.id}
            className="group relative rounded-3xl bg-surface p-6 shadow-sm border border-line hover:shadow-md transition-all"
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-black text-primary uppercase tracking-widest">{quote.quoteNumber}</span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    quote.status === 'approved' ? "bg-emerald-100 text-emerald-700" :
                    quote.status === 'sent' ? "bg-blue-100 text-blue-700" :
                    quote.status === 'rejected' ? "bg-red-100 text-red-700" : "bg-surface-muted text-content-muted"
                  )}>
                    {quote.status === 'draft' ? 'Rascunho' : 
                     quote.status === 'sent' ? 'Enviado' :
                     quote.status === 'approved' ? 'Aprovado' :
                     quote.status === 'rejected' ? 'Recusado' : 'Convertido'}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-content">{quote.clientName}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-medium text-content-subtle">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {format(parseLocalDate(quote.date), 'dd/MM/yyyy')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Válido até {format(parseLocalDate(quote.validUntil), 'dd/MM/yyyy')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    {quote.items?.length || 0} itens
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <p className="text-2xl font-black text-content">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(quote.total)}
                </p>
                <p className="text-xs font-bold text-content-subtle uppercase tracking-widest">
                  {quote.paymentMethod} {quote.installments > 1 ? `(${quote.installments}x)` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2 border-t pt-4 sm:border-t-0 sm:pt-0 sm:pl-6 sm:border-l">
                <button
                  onClick={() => exportPDF(quote)}
                  className="rounded-xl p-2.5 text-content-subtle hover:bg-canvas hover:text-primary transition-all"
                  title="Baixar PDF"
                >
                  <Download className="h-5 w-5" />
                </button>
                <button
                  onClick={() => printQuote(quote)}
                  className="rounded-xl p-2.5 text-content-subtle hover:bg-canvas hover:text-primary transition-all"
                  title="Imprimir"
                >
                  <Printer className="h-5 w-5" />
                </button>
                <button
                  onClick={() => shareQuote(quote)}
                  className="rounded-xl p-2.5 text-content-subtle hover:bg-canvas hover:text-primary transition-all"
                  title="Enviar / compartilhar"
                >
                  <Share2 className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => handleEdit(quote)}
                  className="rounded-xl p-2.5 text-content-subtle hover:bg-canvas hover:text-primary transition-all"
                >
                  <Edit2 className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => handleDelete(quote.id)}
                  className="rounded-xl p-2.5 text-content-subtle hover:bg-red-50 hover:text-red-500 transition-all"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
                {/* Menu por CLIQUE, não hover: no celular não existe hover,
                    então o menu era inalcançável. */}
                <div className="relative">
                  <button
                    onClick={() => setStatusMenuFor(prev => prev === quote.id ? null : quote.id)}
                    title="Mudar status"
                    aria-label="Mudar status do orçamento"
                    aria-expanded={statusMenuFor === quote.id}
                    className="rounded-xl bg-canvas p-2.5 text-content-subtle hover:bg-surface-muted transition-all"
                  >
                    <ChevronRight className={cn('h-5 w-5 transition-transform', statusMenuFor === quote.id && 'rotate-90')} />
                  </button>
                  {statusMenuFor === quote.id && (
                    <>
                      {/* Camada invisível: clicar fora fecha o menu. */}
                      <div className="fixed inset-0 z-10" onClick={() => setStatusMenuFor(null)} />
                      <div className="absolute right-0 top-full z-20 mt-2 w-44 rounded-xl border border-line bg-surface p-2 shadow-xl">
                        <button onClick={() => { updateStatus(quote.id, 'sent'); setStatusMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-950/40">Marcar como Enviado</button>
                        <button onClick={() => { updateStatus(quote.id, 'approved'); setStatusMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">Marcar como Aprovado</button>
                        <button onClick={() => { updateStatus(quote.id, 'rejected'); setStatusMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-red-600 hover:bg-red-50 dark:hover:bg-red-950/40">Marcar como Recusado</button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>}

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl rounded-[2rem] bg-surface p-8 shadow-2xl overflow-y-auto max-h-[95vh]"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Calculator className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-black text-content tracking-tight">
                    {editingQuote ? 'Editar Orçamento' : 'Novo Orçamento'}
                  </h3>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="rounded-full p-2 hover:bg-surface-muted">
                  <X className="h-6 w-6 text-content-subtle" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Client Section */}
                <div className="rounded-3xl bg-canvas p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black uppercase tracking-widest text-content-subtle">Informações do Cliente</h4>
                    <button 
                      type="button"
                      onClick={() => setIsNewClient(!isNewClient)}
                      className="text-xs font-bold text-primary hover:underline flex items-center gap-1"
                    >
                      {isNewClient ? 'Selecionar cliente existente' : 'Cadastrar novo cliente'}
                    </button>
                  </div>

                  {isNewClient ? (
                    <div className="grid gap-4 sm:grid-cols-2">
                      <input 
                        type="text"
                        placeholder="Nome do Cliente"
                        value={newClientName}
                        onChange={(e) => setNewClientName(e.target.value)}
                        className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface"
                        required
                      />
                      <input 
                        type="email"
                        placeholder="E-mail"
                        value={newClientEmail}
                        onChange={(e) => setNewClientEmail(e.target.value)}
                        className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface"
                      />
                    </div>
                  ) : (
                    <select 
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface"
                      required
                    >
                      <option value="">Selecione um cliente...</option>
                      {clients.map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  )}

                  <div className="grid gap-4 sm:grid-cols-2">
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1 ml-1">Data do Orçamento</label>
                      <input 
                        type="date"
                        value={quoteDate}
                        onChange={(e) => setQuoteDate(e.target.value)}
                        className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1 ml-1">Validade</label>
                      <input 
                        type="date"
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-surface"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Items Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black uppercase tracking-widest text-content-subtle">Itens do Orçamento</h4>
                    <div className="flex gap-2">
                      <button 
                        type="button"
                        onClick={() => handleAddItem('service')}
                        className="flex items-center gap-1.5 rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20"
                      >
                        <Package className="h-3.5 w-3.5" />
                        + Serviço
                      </button>
                      <button 
                        type="button"
                        onClick={() => handleAddItem('plan')}
                        className="flex items-center gap-1.5 rounded-lg bg-purple-50 px-3 py-1.5 text-xs font-bold text-purple-600 hover:bg-purple-100"
                      >
                        <Layers className="h-3.5 w-3.5" />
                        + Plano
                      </button>
                    </div>
                  </div>

                  <div className="space-y-3">
                    {quoteItems.map((item, index) => (
                      <motion.div 
                        layout
                        key={item.id}
                        className="grid gap-4 sm:grid-cols-12 items-end rounded-2xl border border-line p-4 bg-surface shadow-sm"
                      >
                        <div className="sm:col-span-3">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Item / Descrição</label>
                          <select
                            value={item.referenceId || ''}
                            onChange={(e) => updateItem(item.id, { referenceId: e.target.value })}
                            className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-primary bg-surface"
                          >
                            <option value="">Selecione...</option>
                            {item.type === 'service' ? (
                              services.map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                            ) : (
                              plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                            )}
                          </select>
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Qtd</label>
                          <input
                            type="number"
                            min="0"
                            value={item.quantity}
                            onChange={(e) => updateItem(item.id, { quantity: parseInt(e.target.value) })}
                            className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Unitário</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(item.id, { unitPrice: parseFloat(e.target.value) })}
                            className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Desconto (R$)</label>
                          <input
                            type="number"
                            min="0"
                            step="0.01"
                            value={item.discount || 0}
                            onChange={(e) => updateItem(item.id, { discount: parseFloat(e.target.value) })}
                            className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Total</label>
                          <p className="px-3 py-2 text-sm font-bold text-content">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.total)}
                          </p>
                        </div>
                        <div className="sm:col-span-1 flex justify-end sm:items-center">
                          <button
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="rounded-lg p-2 text-content-subtle hover:bg-red-50 hover:text-red-500"
                            title="Remover item"
                          >
                            <Trash2 className="h-4 w-4" />
                          </button>
                        </div>
                      </motion.div>
                    ))}
                  </div>
                </div>

                {/* Payment & Recurrence */}
                <div className="grid gap-6 sm:grid-cols-2">
                  <div className="rounded-3xl bg-canvas p-6 space-y-4">
                    <h4 className="text-sm font-black uppercase tracking-widest text-content-subtle">Pagamento</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1 ml-1">Forma</label>
                        <select 
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary bg-surface"
                        >
                          <option value="PIX">PIX</option>
                          <option value="Cartão de Crédito">Cartão de Crédito</option>
                          <option value="Boleto">Boleto</option>
                          <option value="Transferência">Transferência</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1 ml-1">Parcelas</label>
                        <input 
                          type="number"
                          min="1"
                          max="12"
                          value={installments}
                          onChange={(e) => setInstallments(parseInt(e.target.value))}
                          className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary bg-surface"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl bg-canvas p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-black uppercase tracking-widest text-content-subtle">Recorrência</h4>
                      <button 
                        type="button"
                        onClick={() => setRecurrenceEnabled(!recurrenceEnabled)}
                        className={cn(
                          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                          recurrenceEnabled ? "bg-primary" : "bg-gray-200"
                        )}
                      >
                        <span className={cn(
                          "inline-block h-4 w-4 transform rounded-full bg-surface transition-transform",
                          recurrenceEnabled ? "translate-x-6" : "translate-x-1"
                        )} />
                      </button>
                    </div>
                    {recurrenceEnabled && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1 ml-1">Frequência</label>
                          <select 
                            value={recurrenceFrequency}
                            onChange={(e) => setRecurrenceFrequency(e.target.value as any)}
                            className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary bg-surface"
                          >
                            <option value="monthly">Mensal</option>
                            <option value="weekly">Semanal</option>
                            <option value="yearly">Anual</option>
                          </select>
                        </div>
                      </div>
                    )}
                  </div>
                </div>

                {/* Notes */}
                <div>
                  <label className="block text-sm font-black uppercase tracking-widest text-content-subtle mb-2 ml-1">Observações</label>
                  <textarea 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded-2xl border border-line px-4 py-3 outline-none focus:border-primary transition-all min-h-[100px]"
                    placeholder="Condições especiais, prazos de entrega..."
                  />
                </div>

                {/* Summary & Actions */}
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between border-t pt-8">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-content-subtle uppercase tracking-widest">Resumo do Orçamento</p>
                    {discountTotal > 0 && (
                      <p className="text-xs font-medium text-content-subtle">
                        Subtotal {brl(subtotal)} − desconto {brl(discountTotal)}
                      </p>
                    )}
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black text-content">
                        {brl(total)}
                      </span>
                      {installments > 1 && (
                        <span className="text-sm font-bold text-content-subtle">
                          ({installments}x de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total / installments)})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button 
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="rounded-xl border border-line px-6 py-3 text-sm font-bold text-content-muted hover:bg-canvas transition-all"
                    >
                      Cancelar
                    </button>
                    <button 
                      type="submit"
                      className="flex items-center gap-2 rounded-xl bg-primary px-8 py-3 text-sm font-black text-white shadow-lg shadow-primary/20 hover:bg-primary/90 transition-all"
                    >
                      <CheckCircle2 className="h-5 w-5" />
                      Salvar Orçamento
                    </button>
                  </div>
                </div>
              </form>
            </motion.div>
          </div>
        )}
      </AnimatePresence>
    </div>
  );
};
