import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, setDoc, getDocs, writeBatch, where } from 'firebase/firestore';
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
, Share2, ImagePlus, Eye } from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { parseLocalDate } from '../lib/finance';
import { quoteTotals, itemGross } from '../lib/quotes';
import { quoteToRevenueTransactions } from '../lib/orders';
import { ViewToggle, useViewMode, DataTable, Column } from '../components/ViewToggle';
import { format, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
import { compressLogo, validateLogo, CompanyInfo, DEFAULT_COMPANY } from '../lib/branding';
import autoTable from 'jspdf-autotable';

export const Quotes: React.FC = () => {
  const { selectedEntity } = useEntity();
  const { showToast, confirm } = useUI();
  const [quotes, setQuotes] = useState<Quote[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [services, setServices] = useState<Service[]>([]);
  const [products, setProducts] = useState<Service[]>([]); // produto = mesmo formato de serviço
  const [plans, setPlans] = useState<Plan[]>([]);
  const [loading, setLoading] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [editingQuote, setEditingQuote] = useState<Quote | null>(null);
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState<'todos' | 'aguardando' | 'aprovado' | 'reprovado'>('todos');
  const [statusMenuFor, setStatusMenuFor] = useState<string | null>(null);
  const [viewMode, setViewMode] = useViewMode('orcamentos', 'grid');
  const [logo, setLogo] = useState<string | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [previewNumber, setPreviewNumber] = useState('');
  const [previewData, setPreviewData] = useState<Quote | null>(null);
  const [company, setCompany] = useState<CompanyInfo>(DEFAULT_COMPANY);
  const [savingCompany, setSavingCompany] = useState(false);

  // Form states
  const [selectedClientId, setSelectedClientId] = useState('');
  const [isNewClient, setIsNewClient] = useState(false);
  const [newClientName, setNewClientName] = useState('');
  const [newClientEmail, setNewClientEmail] = useState('');
  const [quoteDate, setQuoteDate] = useState(format(new Date(), 'yyyy-MM-dd'));
  const [validUntil, setValidUntil] = useState(format(addDays(new Date(), 7), 'yyyy-MM-dd'));
  const [quoteItems, setQuoteItems] = useState<QuoteItem[]>([]);
  // Itens avulsos que o usuário quer também salvar no catálogo (serviços/produtos).
  const [saveToCatalog, setSaveToCatalog] = useState<Record<string, boolean>>({});
  const [paymentMethod, setPaymentMethod] = useState('PIX');
  const [installments, setInstallments] = useState(1);
  const [notes, setNotes] = useState('');
  const [recurrenceEnabled, setRecurrenceEnabled] = useState(false);
  const [recurrenceFrequency, setRecurrenceFrequency] = useState<'monthly' | 'weekly' | 'yearly'>('monthly');
  const [recurrenceCount, setRecurrenceCount] = useState(0); // 0 = por tempo indeterminado
  const [noteTemplates, setNoteTemplates] = useState<string[]>([]);

  useEffect(() => {
    if (!selectedEntity) return;

    const quotesQ = query(collection(db, `entities/${selectedEntity.id}/quotes`), orderBy('createdAt', 'desc'));
    const clientsQ = query(collection(db, `entities/${selectedEntity.id}/clients`), orderBy('name', 'asc'));
    const servicesQ = query(collection(db, `entities/${selectedEntity.id}/services`), orderBy('name', 'asc'));
    const productsQ = query(collection(db, `entities/${selectedEntity.id}/products`), orderBy('name', 'asc'));
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

    const unsubProducts = onSnapshot(productsQ, (snapshot) => {
      setProducts(snapshot.docs.map(doc => ({ id: doc.id, ...doc.data() })) as Service[]);
    }, (error) => {
      console.error("Error fetching products for quotes:", error);
      handleFirestoreError(error, OperationType.LIST, `entities/${selectedEntity.id}/products`);
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
      unsubProducts();
      unsubPlans();
    };
  }, [selectedEntity]);

  // Fonte única testada (lib/quotes): round2, desconto abatido uma vez, total nunca negativo.
  const { subtotal, discountTotal, total } = useMemo(() => quoteTotals(quoteItems), [quoteItems]);

  const handleAddItem = (type: 'service' | 'plan' | 'product') => {
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
          if (item.type === 'service' || item.type === 'product') {
            const lista = item.type === 'product' ? products : services;
            const s = lista.find(serv => serv.id === updates.referenceId);
            if (s) {
              // Anexa o escopo/observações à descrição para não se perder no PDF.
              const extra = [s.scope, s.observations].map(x => (x || '').trim()).filter(Boolean).join(' · ');
              updated.description = extra ? `${s.name} — ${extra}` : s.name;
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

      // Cadastra no catálogo os itens AVULSOS marcados "Cadastrar" (serviço/produto).
      for (const it of quoteItems) {
        if (!saveToCatalog[it.id] || it.referenceId || it.type === 'plan') continue;
        const nome = (it.description || '').trim();
        const preco = Number(it.unitPrice) || 0;
        if (!nome || preco <= 0) continue;
        const col = it.type === 'product' ? 'products' : 'services';
        await addDoc(collection(db, `entities/${selectedEntity.id}/${col}`), {
          name: nome, description: '', basePrice: preco,
          category: it.type === 'product' ? 'Produto' : 'Serviço', active: true,
          entityId: selectedEntity.id, ownerUid: selectedEntity.ownerUid,
          collaboratorsEmails: selectedEntity.collaboratorsEmails || [], createdAt: serverTimestamp(),
        });
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
        // Recorrência não tem parcelamento: se recorrente, força 1.
        installments: recurrenceEnabled ? 1 : (Number(installments) || 1),
        status: editingQuote?.status || 'draft',
        notes,
        entityId: selectedEntity.id,
        ownerUid: selectedEntity.ownerUid,
        collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
        updatedAt: serverTimestamp(),
        recurrenceConfig: {
          enabled: recurrenceEnabled,
          frequency: recurrenceFrequency,
          startDate: quoteDate,
          count: recurrenceEnabled ? (Number(recurrenceCount) || 0) : 0
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
    setSaveToCatalog({});
    setPaymentMethod('PIX');
    setInstallments(1);
    setNotes('');
    setRecurrenceEnabled(false);
    setRecurrenceFrequency('monthly');
    setRecurrenceCount(0);
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
    setRecurrenceCount(quote.recurrenceConfig?.count || 0);
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

  /**
   * Converte o orçamento em Ordem de Serviço: gera as receitas A RECEBER
   * (única/parcelada/recorrente) vinculadas ao cliente e marca como convertido.
   * Idempotente: se já houver lançamentos com este sourceQuoteId, não duplica.
   */
  const convertQuote = async (quote: Quote) => {
    if (!selectedEntity) return;
    const confirmed = await confirm({
      title: 'Converter em Receita (OS)',
      message: `Gerar os lançamentos a receber de ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(quote.total) || 0)} para ${quote.clientName} e marcar como convertido?`,
      variant: 'default',
    });
    if (!confirmed) return;
    setStatusMenuFor(null);
    try {
      const txCol = collection(db, `entities/${selectedEntity.id}/transactions`);
      const existing = await getDocs(query(txCol, where('sourceQuoteId', '==', quote.id)));
      if (!existing.empty) {
        await updateDoc(doc(db, `entities/${selectedEntity.id}/quotes/${quote.id}`), { status: 'converted' });
        showToast('Este orçamento já tinha receitas geradas — marquei como convertido (nada duplicado).', 'info');
        return;
      }
      const drafts = quoteToRevenueTransactions(quote, {
        id: selectedEntity.id,
        ownerUid: selectedEntity.ownerUid,
        collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
      });
      if (drafts.length === 0) { showToast('Orçamento sem valor para converter.', 'error'); return; }
      const batch = writeBatch(db);
      for (const d of drafts) {
        batch.set(doc(txCol), { ...d, createdAt: serverTimestamp() });
      }
      batch.update(doc(db, `entities/${selectedEntity.id}/quotes/${quote.id}`), { status: 'converted' });
      await batch.commit();
      showToast(`Convertido! ${drafts.length} lançamento(s) a receber criados para ${quote.clientName}.`, 'success');
    } catch (error) {
      console.error('Erro ao converter orçamento:', error);
      showToast('Erro ao converter o orçamento.', 'error');
    }
  };

  // Logo + dados da empresa (guardados em config/branding). Saem no topo/rodapé do PDF.
  useEffect(() => {
    if (!selectedEntity) return;
    return onSnapshot(doc(db, `entities/${selectedEntity.id}/config/branding`), snap => {
      const d = snap.data() || {};
      setLogo((d.logo as string) || null);
      setCompany({ ...DEFAULT_COMPANY, ...((d.company as Partial<CompanyInfo>) || {}) });
      setNoteTemplates((d.noteTemplates as string[]) || []);
    }, e => handleFirestoreError(e, OperationType.GET, `entities/${selectedEntity.id}/config/branding`));
  }, [selectedEntity]);

  const handleLogoUpload = async (file: File) => {
    if (!selectedEntity) { showToast('Selecione uma empresa antes de enviar a logo.', 'error'); return; }
    setUploadingLogo(true);
    try {
      const compressed = await compressLogo(file);
      const check = validateLogo(compressed);
      if (!check.ok) { showToast(check.reason || 'Imagem inválida.', 'error'); return; }
      // Preview otimista: aparece na hora, sem esperar o Firestore responder.
      setLogo(compressed);
      await setDoc(doc(db, `entities/${selectedEntity.id}/config/branding`),
        { logo: compressed, updatedAt: serverTimestamp() }, { merge: true });
      showToast('Logomarca salva! Os próximos orçamentos já saem com ela.', 'success');
    } catch (error: any) {
      console.error('Erro na logomarca:', error);
      showToast(error?.message || 'Não consegui salvar a imagem. Recarregue a página (Cmd+Shift+R) e tente de novo.', 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  const removeLogo = async () => {
    if (!selectedEntity) return;
    setLogo(null);
    await setDoc(doc(db, `entities/${selectedEntity.id}/config/branding`), { logo: null }, { merge: true });
    showToast('Logomarca removida.', 'success');
  };

  const saveCompany = async () => {
    if (!selectedEntity) return;
    setSavingCompany(true);
    try {
      await setDoc(doc(db, `entities/${selectedEntity.id}/config/branding`), { company, updatedAt: serverTimestamp() }, { merge: true });
      showToast('Dados da empresa salvos — já saem no PDF.', 'success');
    } catch {
      showToast('Erro ao salvar os dados da empresa.', 'error');
    } finally {
      setSavingCompany(false);
    }
  };

  /** Observações salvas: modelos reutilizáveis guardados em config/branding. */
  const saveNoteTemplate = async () => {
    const t = notes.trim();
    if (!t) { showToast('Escreva a observação antes de salvar como modelo.', 'error'); return; }
    if (!selectedEntity) return;
    if (noteTemplates.includes(t)) { showToast('Essa observação já está salva.', 'error'); return; }
    const next = [...noteTemplates, t];
    setNoteTemplates(next);
    await setDoc(doc(db, `entities/${selectedEntity.id}/config/branding`), { noteTemplates: next }, { merge: true });
    showToast('Observação salva como modelo.', 'success');
  };
  const deleteNoteTemplate = async (index: number) => {
    if (!selectedEntity) return;
    const next = noteTemplates.filter((_, i) => i !== index);
    setNoteTemplates(next);
    await setDoc(doc(db, `entities/${selectedEntity.id}/config/branding`), { noteTemplates: next }, { merge: true });
  };

  const brl = (n: number) => new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(Number(n) || 0);

  /**
   * Monta o PDF no estilo da PROPOSTA COMERCIAL: topo com logo + dados da empresa,
   * rodapé de contato, faixa "PROPOSTA COMERCIAL", tabela de itens e totais.
   * Topo/rodapé são fixos; o usuário só sobe a logo e edita os dados da empresa.
   */
  const buildPDF = (quote: Quote): jsPDF => {
    const doc = new jsPDF();
    const PW = 210, PH = 297, M = 16;
    const purple: [number, number, number] = [107, 63, 160];
    const purpleDark: [number, number, number] = [76, 29, 149];
    const lav: [number, number, number] = [238, 233, 247];
    const magenta: [number, number, number] = [176, 32, 150];
    const gray: [number, number, number] = [90, 90, 96];
    const itens = quote.items || [];
    const totais = quoteTotals(itens);
    const rx = PW - M;

    const drawHeader = () => {
      if (logo) {
        try {
          const p: any = (doc as any).getImageProperties(logo);
          const maxH = 15, maxW = 48;
          let w = (p.width / p.height) * maxH, h = maxH;
          if (w > maxW) { w = maxW; h = (p.height / p.width) * maxW; }
          doc.addImage(logo, 'PNG', M, 9, w, h);
        } catch { /* logo inválida — ignora */ }
      } else {
        doc.setTextColor(...purpleDark); doc.setFont('helvetica', 'bold'); doc.setFontSize(15);
        doc.text(company.name || 'Agência Ciis', M, 20);
      }
      let ty = 12;
      doc.setFontSize(8);
      doc.setFont('helvetica', 'bold'); doc.setTextColor(30, 30, 30);
      if (company.owner) { doc.text(company.owner, rx, ty, { align: 'right' }); ty += 4; }
      doc.setFont('helvetica', 'normal'); doc.setTextColor(...gray);
      if (company.cnpj) { doc.text(`CNPJ ${company.cnpj}`, rx, ty, { align: 'right' }); ty += 4; }
      if (company.phone) { doc.text(company.phone, rx, ty, { align: 'right' }); ty += 4; }
      doc.setTextColor(...magenta);
      if (company.email) { doc.text(company.email, rx, ty, { align: 'right' }); ty += 4; }
      if (company.site) { doc.text(company.site, rx, ty, { align: 'right' }); ty += 4; }
      if (company.address) { doc.setTextColor(...gray); doc.text(company.address, rx, ty, { align: 'right', maxWidth: 95 }); }
      doc.setDrawColor(...purple); doc.setLineWidth(0.8); doc.line(M, 34, rx, 34);
    };
    const drawFooter = () => {
      doc.setDrawColor(212, 212, 216); doc.setLineWidth(0.2); doc.line(M, PH - 16, rx, PH - 16);
      doc.setFontSize(8); doc.setTextColor(...gray); doc.setFont('helvetica', 'normal');
      const parts = [company.name, company.phone, company.email, company.site].filter(Boolean).join('   ·   ');
      doc.text(parts, PW / 2, PH - 11, { align: 'center' });
    };

    drawHeader(); drawFooter();

    // Faixa "PROPOSTA COMERCIAL"
    let y = 44;
    doc.setFillColor(...purple); doc.rect(M, y, PW - 2 * M, 10, 'F');
    doc.setTextColor(255, 255, 255); doc.setFont('helvetica', 'bold'); doc.setFontSize(11);
    doc.text('PROPOSTA COMERCIAL', M + 4, y + 6.8);
    y += 14;

    // Caixa de capa (cliente + datas)
    const boxH = 30;
    doc.setFillColor(...lav); doc.rect(M, y, PW - 2 * M, boxH, 'F');
    doc.setTextColor(...purpleDark); doc.setFont('helvetica', 'bold'); doc.setFontSize(16);
    doc.text(quote.clientName || 'Cliente', M + 5, y + 12);
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(70, 70, 76);
    doc.text(`Orçamento ${quote.quoteNumber}`, M + 5, y + 19);
    doc.text(`Emitido em ${format(parseLocalDate(quote.date), 'dd/MM/yyyy')}  ·  válido até ${format(parseLocalDate(quote.validUntil), 'dd/MM/yyyy')}`, M + 5, y + 25);
    y += boxH + 12;

    // Seção Itens
    doc.setFillColor(...purple); doc.rect(M, y - 4.5, 1.6, 6, 'F');
    doc.setTextColor(...purpleDark); doc.setFont('helvetica', 'bold'); doc.setFontSize(13);
    doc.text('Itens da proposta', M + 4, y);
    y += 4;

    autoTable(doc, {
      startY: y,
      head: [['Descrição', 'Qtd', 'Unitário', 'Total']],
      body: itens.map(it => [it.description || '-', String(it.quantity), brl(it.unitPrice), brl(itemGross(it))]),
      theme: 'grid',
      headStyles: { fillColor: purple, textColor: [255, 255, 255], fontStyle: 'bold' },
      alternateRowStyles: { fillColor: [248, 246, 251] },
      styles: { fontSize: 10, cellPadding: 3, lineColor: [230, 225, 240] },
      columnStyles: { 1: { halign: 'center', cellWidth: 18 }, 2: { halign: 'right', cellWidth: 32 }, 3: { halign: 'right', cellWidth: 32 } },
      margin: { left: M, right: M, top: 40, bottom: 20 },
      didDrawPage: () => { drawHeader(); drawFooter(); },
    });

    y = (doc as any).lastAutoTable.finalY + 8;
    const ensure = (need: number) => { if (y + need > PH - 22) { doc.addPage(); drawHeader(); drawFooter(); y = 44; } };

    // Totais (caixa à direita)
    ensure(34);
    const tbX = rx - 80, tbW = 80, tbH = totais.discountTotal > 0 ? 28 : 20;
    doc.setFillColor(...lav); doc.rect(tbX, y, tbW, tbH, 'F');
    doc.setFontSize(10); doc.setTextColor(70, 70, 76); doc.setFont('helvetica', 'normal');
    doc.text('Subtotal', tbX + 4, y + 7); doc.text(brl(totais.subtotal), tbX + tbW - 4, y + 7, { align: 'right' });
    let ty2 = y + 7;
    if (totais.discountTotal > 0) { ty2 += 6; doc.text('Desconto', tbX + 4, ty2); doc.text(`- ${brl(totais.discountTotal)}`, tbX + tbW - 4, ty2, { align: 'right' }); }
    ty2 += 8;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(13); doc.setTextColor(...purpleDark);
    doc.text('TOTAL', tbX + 4, ty2); doc.text(brl(totais.total), tbX + tbW - 4, ty2, { align: 'right' });
    y += tbH + 12;

    // Forma de pagamento
    ensure(22);
    doc.setFillColor(...purple); doc.rect(M, y - 4.5, 1.6, 6, 'F');
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...purpleDark);
    doc.text('Forma de pagamento', M + 4, y);
    y += 7;
    doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(50, 50, 56);
    const freq = quote.recurrenceConfig?.frequency;
    const freqLabel = freq === 'weekly' ? 'semanal' : freq === 'yearly' ? 'anual' : 'mensal';
    let pgto: string;
    if (quote.recurrenceConfig?.enabled) {
      // Recorrência NÃO tem parcelamento — cobrança por período.
      const per = freq === 'weekly' ? 'por semana' : freq === 'yearly' ? 'por ano' : 'por mês';
      const cnt = quote.recurrenceConfig.count || 0;
      const dur = cnt > 0 ? ` durante ${cnt} ${freqLabel === 'anual' ? 'ano(s)' : freqLabel === 'semanal' ? 'semana(s)' : 'mês(es)'}` : ' por tempo indeterminado';
      pgto = `${quote.paymentMethod || 'A combinar'} · recorrência ${freqLabel} — ${brl(totais.total)} ${per}${dur}`;
    } else {
      const n = quote.installments || 1;
      pgto = `${quote.paymentMethod || 'A combinar'}${n > 1 ? ` em ${n}x de ${brl(totais.total / n)}` : ' à vista'}`;
    }
    doc.text(`›  ${pgto}`, M + 2, y);
    y += 11;

    // Observações
    if (quote.notes) {
      ensure(20);
      doc.setFillColor(...purple); doc.rect(M, y - 4.5, 1.6, 6, 'F');
      doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(...purpleDark);
      doc.text('Observações', M + 4, y);
      y += 7;
      doc.setFont('helvetica', 'normal'); doc.setFontSize(10); doc.setTextColor(70, 70, 76);
      doc.text(doc.splitTextToSize(quote.notes, PW - 2 * M), M, y);
    }

    return doc;
  };

  const exportPDF = (quote: Quote) => {
    try {
      buildPDF(quote).save(`Orcamento_${quote.quoteNumber}.pdf`);
    } catch (e: any) {
      console.error('Erro ao gerar PDF:', e);
      showToast('Não consegui gerar o PDF. Recarregue a página (Cmd+Shift+R) e tente de novo.', 'error');
    }
  };

  /** Mostra o PDF numa prévia dentro do próprio sistema (não baixa nem imprime).
   *  Modal com iframe evita o bloqueio de popup do window.open. */
  const previewQuote = (quote: Quote) => {
    try {
      const url = buildPDF(quote).output('bloburl') as unknown as string;
      setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return url; });
    } catch (e) {
      console.error('Erro ao gerar PDF para prévia:', e);
      setPreviewUrl(null); // segue mostrando a prévia em HTML mesmo se o PDF falhar
    }
    setPreviewNumber(quote.quoteNumber);
    setPreviewData(quote);
  };
  const closePreview = () => {
    setPreviewUrl(prev => { if (prev) URL.revokeObjectURL(prev); return null; });
    setPreviewData(null);
  };

  /** Abre o PDF numa aba e dispara a impressão — sai idêntico ao arquivo. */
  const printQuote = (quote: Quote) => {
    try {
      const pdf = buildPDF(quote);
      pdf.autoPrint();
      const url = pdf.output('bloburl');
      const w = window.open(url as unknown as string, '_blank');
      // Popup bloqueado: cai na prévia embutida (o usuário imprime de lá com Ctrl+P).
      if (!w) previewQuote(quote);
    } catch (e: any) {
      console.error('Erro ao imprimir:', e);
      showToast('Não consegui abrir a impressão. Recarregue a página e tente de novo.', 'error');
    }
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

  // Agrupa os status técnicos em 3 situações do fluxo comercial.
  // approved/converted = Aprovado (vira Ordem de Serviço); rejected = Reprovado; resto = Aguardando.
  const statusGroup = (s?: string): 'aguardando' | 'aprovado' | 'reprovado' =>
    s === 'approved' || s === 'converted' ? 'aprovado' : s === 'rejected' ? 'reprovado' : 'aguardando';

  const filteredQuotes = quotes.filter(q => {
    const matchBusca = (q.clientName || '').toLowerCase().includes(searchTerm.toLowerCase()) ||
      (q.quoteNumber || '').toLowerCase().includes(searchTerm.toLowerCase());
    const matchStatus = statusFilter === 'todos' || statusGroup(q.status) === statusFilter;
    return matchBusca && matchStatus;
  });

  const contagem = {
    todos: quotes.length,
    aguardando: quotes.filter(q => statusGroup(q.status) === 'aguardando').length,
    aprovado: quotes.filter(q => statusGroup(q.status) === 'aprovado').length,
    reprovado: quotes.filter(q => statusGroup(q.status) === 'reprovado').length,
  };

  const STATUS_ROTULO: Record<string, { texto: string; cor: string }> = {
    draft: { texto: 'Aguardando', cor: 'text-amber-600' },
    sent: { texto: 'Aguardando', cor: 'text-amber-600' },
    approved: { texto: 'Aprovado (OS)', cor: 'text-emerald-600' },
    converted: { texto: 'Aprovado · Lançado', cor: 'text-emerald-700' },
    rejected: { texto: 'Reprovado', cor: 'text-rose-600' },
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

      {/* Logomarca & dados da empresa — saem no topo/rodapé do PDF de TODO orçamento.
          O usuário só sobe a logo (PNG) e edita os campos; o layout do PDF é fixo,
          igual ao modelo de proposta. relative z-10: fica ACIMA dos blobs decorativos. */}
      <div className="relative z-10 mt-6 rounded-2xl bg-surface p-5 border border-line shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-surface-muted text-content-muted">
              <ImagePlus className="h-5 w-5" />
            </div>
            <div>
              <p className="font-black text-content">Logomarca & dados da empresa</p>
              <p className="text-xs text-content-subtle">
                Suba sua logo em PNG e ajuste os dados. Todo orçamento sai no padrão da proposta comercial, pronto para baixar, imprimir ou enviar.
              </p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            {logo && (
              <div className="flex flex-col items-center gap-1">
                <img src={logo} alt="Logomarca" className="h-14 w-auto rounded-lg border border-line bg-white p-1" />
                <span className="flex items-center gap-1 text-[11px] font-bold text-emerald-600">
                  <CheckCircle2 className="h-3.5 w-3.5" /> Logo aplicada
                </span>
              </div>
            )}
            <label className="cursor-pointer rounded-xl bg-primary px-4 py-2 text-sm font-bold text-white hover:bg-primary/90">
              {uploadingLogo ? 'Processando...' : logo ? 'Trocar logo' : 'Enviar logo (PNG)'}
              <input
                type="file" accept="image/png" className="hidden"
                disabled={uploadingLogo}
                onChange={e => { const f = e.target.files?.[0]; if (f) handleLogoUpload(f); e.target.value = ''; }}
              />
            </label>
            {logo && (
              <button onClick={removeLogo}
                className="text-xs font-bold text-content-subtle hover:text-rose-600">Remover</button>
            )}
          </div>
        </div>

        {/* Campos editáveis que aparecem no cabeçalho/rodapé do PDF. */}
        <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {([
            ['owner', 'Nome do responsável'],
            ['cnpj', 'CNPJ'],
            ['phone', 'Telefone'],
            ['email', 'E-mail'],
            ['site', 'Site'],
            ['address', 'Endereço'],
          ] as [keyof CompanyInfo, string][]).map(([field, label]) => (
            <div key={field}>
              <label className="mb-1 block text-xs font-bold text-content-subtle">{label}</label>
              <input
                value={company[field]}
                onChange={e => setCompany(c => ({ ...c, [field]: e.target.value }))}
                className="w-full rounded-xl border border-line bg-surface-muted px-3 py-2 text-sm text-content focus:border-primary focus:outline-none"
              />
            </div>
          ))}
        </div>
        <div className="mt-4 flex justify-end">
          <button
            onClick={saveCompany}
            disabled={savingCompany}
            className="rounded-xl bg-content px-5 py-2 text-sm font-bold text-surface hover:opacity-90 disabled:opacity-60"
          >
            {savingCompany ? 'Salvando...' : 'Salvar dados da empresa'}
          </button>
        </div>
      </div>

        
        {/* Decorative elements — pointer-events-none para NUNCA interceptar cliques. */}
        <div className="pointer-events-none absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="pointer-events-none absolute -left-10 -top-10 h-40 w-40 rounded-full bg-blue-400/20 blur-2xl" />
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

      {/* Filtro por situação — Aprovados = Ordens de Serviço. */}
      <div className="flex flex-wrap gap-2">
        {([
          ['todos', 'Todos', 'text-content'],
          ['aguardando', 'Aguardando', 'text-amber-600'],
          ['aprovado', 'Aprovados (OS)', 'text-emerald-600'],
          ['reprovado', 'Reprovados', 'text-rose-600'],
        ] as [typeof statusFilter, string, string][]).map(([key, label, cor]) => (
          <button
            key={key}
            onClick={() => setStatusFilter(key)}
            className={cn(
              'rounded-full border px-4 py-1.5 text-xs font-bold transition-all',
              statusFilter === key ? 'border-primary bg-primary/10 text-primary' : `border-line bg-surface ${cor} hover:bg-surface-muted`
            )}
          >
            {label} <span className="opacity-60">({contagem[key]})</span>
          </button>
        ))}
      </div>

      {viewMode === 'list' && (
        <DataTable
          itens={filteredQuotes}
          colunas={colunasOrcamentos}
          acoes={(q) => (
            <>
              <button onClick={() => previewQuote(q)} title="Visualizar"
                className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                <Eye className="h-4 w-4" />
              </button>
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
              {/* Mudar status + Lançar em Contas a Receber — mesmo menu/handlers do grid. */}
              <div className="relative">
                <button
                  onClick={() => setStatusMenuFor(prev => prev === q.id ? null : q.id)}
                  title="Mudar status"
                  aria-label="Mudar status do orçamento"
                  aria-expanded={statusMenuFor === q.id}
                  className="rounded-lg p-2 text-content-subtle hover:bg-surface-muted hover:text-primary">
                  <ChevronRight className={cn('h-4 w-4 transition-transform', statusMenuFor === q.id && 'rotate-90')} />
                </button>
                {statusMenuFor === q.id && (
                  <>
                    <div className="fixed inset-0 z-10" onClick={() => setStatusMenuFor(null)} />
                    <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-line bg-surface p-2 shadow-xl">
                      <p className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-content-subtle">Situação</p>
                      <button onClick={() => { updateStatus(q.id, 'sent'); setStatusMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40">⏳ Aguardando</button>
                      <button onClick={() => { updateStatus(q.id, 'approved'); setStatusMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">✓ Aprovar (vira OS)</button>
                      <button onClick={() => { updateStatus(q.id, 'rejected'); setStatusMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">✕ Reprovar</button>
                      {statusGroup(q.status) === 'aprovado' ? (
                        <>
                          <div className="my-1 border-t border-line" />
                          {q.status === 'converted' ? (
                            <div className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs font-black text-emerald-700">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Já lançado ✓
                            </div>
                          ) : (
                            <button onClick={() => { convertQuote(q); setStatusMenuFor(null); }} className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs font-black text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                              <CheckCircle2 className="h-3.5 w-3.5" /> Lançar em Contas a Receber
                            </button>
                          )}
                        </>
                      ) : (
                        <p className="mt-1 border-t border-line px-3 pt-2 text-[10px] leading-snug text-content-subtle">
                          Aprove o orçamento para lançar em Contas a Receber.
                        </p>
                      )}
                    </div>
                  </>
                )}
              </div>
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
                    statusGroup(quote.status) === 'aprovado' ? "bg-emerald-100 text-emerald-700" :
                    statusGroup(quote.status) === 'reprovado' ? "bg-red-100 text-red-700" : "bg-amber-100 text-amber-700"
                  )}>
                    {quote.status === 'converted' ? 'Aprovado · Lançado' :
                     statusGroup(quote.status) === 'aprovado' ? 'Aprovado (OS)' :
                     statusGroup(quote.status) === 'reprovado' ? 'Reprovado' : 'Aguardando'}
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
                  onClick={() => previewQuote(quote)}
                  className="rounded-xl p-2.5 text-content-subtle hover:bg-canvas hover:text-primary transition-all"
                  title="Visualizar"
                >
                  <Eye className="h-5 w-5" />
                </button>
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
                      <div className="absolute right-0 top-full z-20 mt-2 w-56 rounded-xl border border-line bg-surface p-2 shadow-xl">
                        <p className="px-3 py-1 text-[10px] font-black uppercase tracking-widest text-content-subtle">Situação</p>
                        <button onClick={() => { updateStatus(quote.id, 'sent'); setStatusMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-amber-600 hover:bg-amber-50 dark:hover:bg-amber-950/40">⏳ Aguardando</button>
                        <button onClick={() => { updateStatus(quote.id, 'approved'); setStatusMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-emerald-600 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">✓ Aprovar (vira OS)</button>
                        <button onClick={() => { updateStatus(quote.id, 'rejected'); setStatusMenuFor(null); }} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/40">✕ Reprovar</button>
                        {statusGroup(quote.status) === 'aprovado' ? (
                          <>
                            <div className="my-1 border-t border-line" />
                            {quote.status === 'converted' ? (
                              <div className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs font-black text-emerald-700">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Já lançado ✓
                              </div>
                            ) : (
                              <button onClick={() => { convertQuote(quote); setStatusMenuFor(null); }} className="flex w-full items-center gap-1.5 rounded-lg px-3 py-2 text-left text-xs font-black text-emerald-700 hover:bg-emerald-50 dark:hover:bg-emerald-950/40">
                                <CheckCircle2 className="h-3.5 w-3.5" /> Lançar em Contas a Receber
                              </button>
                            )}
                          </>
                        ) : (
                          <p className="mt-1 border-t border-line px-3 pt-2 text-[10px] leading-snug text-content-subtle">
                            Aprove o orçamento para lançar em Contas a Receber.
                          </p>
                        )}
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
          <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-black/60 backdrop-blur-sm" onClick={() => { setIsModalOpen(false); resetForm(); }}>
            <motion.div
              initial={{ opacity: 0, scale: 0.98 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.98 }}
              onClick={e => e.stopPropagation()}
              className="w-full max-w-4xl rounded-3xl bg-surface p-6 sm:p-8 shadow-2xl overflow-y-auto max-h-[92vh]"
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
                        onClick={() => handleAddItem('product')}
                        className="flex items-center gap-1.5 rounded-lg bg-amber-50 px-3 py-1.5 text-xs font-bold text-amber-700 hover:bg-amber-100"
                      >
                        <DollarSign className="h-3.5 w-3.5" />
                        + Produto
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
                  <p className="-mt-2 text-xs text-content-subtle">
                    Digite a descrição e o valor livremente. Puxar do catálogo é opcional — dá pra criar o item na hora.
                  </p>

                  <div className="space-y-3">
                    {quoteItems.map((item, index) => (
                      <motion.div
                        layout
                        key={item.id}
                        className="rounded-2xl border border-line p-4 bg-surface shadow-sm space-y-3"
                      >
                        {/* Linha 1: descrição (digitável) + puxar do catálogo */}
                        <div className="grid gap-3 sm:grid-cols-12 items-end">
                          <div className="sm:col-span-7">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">
                              {item.type === 'plan' ? 'Plano' : item.type === 'product' ? 'Produto' : 'Serviço'} / Descrição
                            </label>
                            <input
                              type="text"
                              value={item.description}
                              onChange={(e) => updateItem(item.id, { description: e.target.value })}
                              placeholder="Digite aqui, ou puxe do catálogo ao lado"
                              className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-primary bg-surface"
                            />
                          </div>
                          <div className="sm:col-span-5">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Puxar do catálogo (opcional)</label>
                            <select
                              value={item.referenceId || ''}
                              onChange={(e) => updateItem(item.id, { referenceId: e.target.value })}
                              className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-primary bg-surface"
                            >
                              <option value="">— avulso (digitar acima) —</option>
                              {item.type === 'service' ? (
                                services.filter(s => s.active !== false).map(s => <option key={s.id} value={s.id}>{s.name}</option>)
                              ) : item.type === 'product' ? (
                                products.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                              ) : (
                                plans.map(p => <option key={p.id} value={p.id}>{p.name}</option>)
                              )}
                            </select>
                          </div>
                        </div>

                        {/* Linha 2: qtd, unitário, desconto, total, cadastrar, remover */}
                        <div className="grid gap-3 sm:grid-cols-12 items-end">
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Qtd</label>
                            <input type="number" min="0" value={item.quantity}
                              onChange={(e) => updateItem(item.id, { quantity: parseInt(e.target.value) })}
                              className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-primary" />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Unitário</label>
                            <input type="number" min="0" step="0.01" value={item.unitPrice}
                              onChange={(e) => updateItem(item.id, { unitPrice: parseFloat(e.target.value) })}
                              className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-primary" />
                          </div>
                          <div className="sm:col-span-2">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Desconto (R$)</label>
                            <input type="number" min="0" step="0.01" value={item.discount || 0}
                              onChange={(e) => updateItem(item.id, { discount: parseFloat(e.target.value) })}
                              className="w-full rounded-xl border border-line px-3 py-2 text-sm outline-none focus:border-primary" />
                          </div>
                          <div className="sm:col-span-3">
                            <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1">Total</label>
                            <p className="px-3 py-2 text-sm font-bold text-content">
                              {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.total)}
                            </p>
                          </div>
                          <div className="sm:col-span-2 flex items-center">
                            {item.type !== 'plan' && !item.referenceId && (
                              <label className="flex cursor-pointer items-center gap-1.5 text-[11px] font-bold text-content-subtle" title="Salvar este item no catálogo de serviços/produtos">
                                <input type="checkbox" checked={!!saveToCatalog[item.id]}
                                  onChange={(e) => setSaveToCatalog(s => ({ ...s, [item.id]: e.target.checked }))} />
                                Cadastrar
                              </label>
                            )}
                          </div>
                          <div className="sm:col-span-1 flex justify-end sm:items-center">
                            <button type="button" onClick={() => removeItem(item.id)}
                              className="rounded-lg p-2 text-content-subtle hover:bg-red-50 hover:text-red-500" title="Remover item">
                              <Trash2 className="h-4 w-4" />
                            </button>
                          </div>
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
                        {recurrenceEnabled ? (
                          <p className="rounded-xl border border-dashed border-line px-4 py-2.5 text-xs text-content-subtle">
                            Recorrência não tem parcelamento.
                          </p>
                        ) : (
                          <input
                            type="number"
                            min="1"
                            max="12"
                            value={Number.isFinite(installments) ? installments : 1}
                            onChange={(e) => {
                              const v = parseInt(e.target.value);
                              setInstallments(Number.isFinite(v) && v > 0 ? v : 1);
                            }}
                            className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary bg-surface"
                          />
                        )}
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl bg-canvas p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-black uppercase tracking-widest text-content-subtle">Recorrência</h4>
                      <button
                        type="button"
                        onClick={() => {
                          const next = !recurrenceEnabled;
                          setRecurrenceEnabled(next);
                          if (next) setInstallments(1); // recorrência não parcela
                        }}
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
                    {recurrenceEnabled ? (
                      <div className="grid gap-4 sm:grid-cols-2 animate-in fade-in slide-in-from-top-2">
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
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-content-subtle mb-1 ml-1">
                            Duração {recurrenceFrequency === 'weekly' ? '(semanas)' : recurrenceFrequency === 'yearly' ? '(anos)' : '(meses)'}
                          </label>
                          <input
                            type="number" min="0"
                            value={Number.isFinite(recurrenceCount) ? recurrenceCount : 0}
                            onChange={(e) => { const v = parseInt(e.target.value); setRecurrenceCount(Number.isFinite(v) && v > 0 ? v : 0); }}
                            placeholder="0"
                            className="w-full rounded-xl border border-line px-4 py-2.5 outline-none focus:border-primary bg-surface"
                          />
                          <p className="mt-1 text-[10px] text-content-subtle ml-1">0 = por tempo indeterminado</p>
                        </div>
                      </div>
                    ) : (
                      <p className="text-xs text-content-subtle">Ative para cobrança periódica (assinatura), sem parcelamento.</p>
                    )}
                  </div>
                </div>

                {/* Notes + modelos salvos reutilizáveis */}
                <div>
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <label className="text-sm font-black uppercase tracking-widest text-content-subtle ml-1">Observações</label>
                    <button
                      type="button"
                      onClick={saveNoteTemplate}
                      className="rounded-lg bg-primary/10 px-3 py-1.5 text-xs font-bold text-primary hover:bg-primary/20"
                    >
                      + Salvar como modelo
                    </button>
                  </div>

                  {noteTemplates.length > 0 && (
                    <div className="mb-2 flex flex-wrap gap-2">
                      <span className="text-[11px] font-bold text-content-subtle self-center">Modelos:</span>
                      {noteTemplates.map((t, i) => (
                        <span key={i} className="inline-flex items-center gap-1 rounded-full bg-surface-muted px-2.5 py-1 text-xs text-content">
                          <button type="button" onClick={() => setNotes(t)} title={t}
                            className="max-w-[220px] truncate hover:text-primary">{t}</button>
                          <button type="button" onClick={() => deleteNoteTemplate(i)} title="Apagar modelo"
                            className="text-content-subtle hover:text-rose-600">×</button>
                        </span>
                      ))}
                    </div>
                  )}

                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded-2xl border border-line px-4 py-3 outline-none focus:border-primary transition-all min-h-[100px]"
                    placeholder="Condições especiais, prazos de entrega... (clique num modelo acima para reutilizar)"
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

      {/* Prévia dentro do sistema em HTML (mesmo visual do PDF). Não usa o
          visualizador de PDF do navegador — que fica preto em navegadores
          embutidos/sem plugin. O PDF real fica em "Baixar" e "Abrir em nova aba". */}
      {previewData && (() => {
        const pd = previewData;
        const t = quoteTotals(pd.items || []);
        const freq = pd.recurrenceConfig?.frequency;
        const freqWord = freq === 'weekly' ? 'semanal' : freq === 'yearly' ? 'anual' : 'mensal';
        let pay: string;
        if (pd.recurrenceConfig?.enabled) {
          const per = freq === 'weekly' ? 'por semana' : freq === 'yearly' ? 'por ano' : 'por mês';
          const cnt = pd.recurrenceConfig.count || 0;
          const unit = freq === 'weekly' ? 'semana(s)' : freq === 'yearly' ? 'ano(s)' : 'mês(es)';
          pay = `${pd.paymentMethod || 'A combinar'} · recorrência ${freqWord} — ${brl(t.total)} ${per}${cnt > 0 ? ` durante ${cnt} ${unit}` : ' por tempo indeterminado'}`;
        } else {
          const n = pd.installments || 1;
          pay = `${pd.paymentMethod || 'A combinar'}${n > 1 ? ` em ${n}x de ${brl(t.total / n)}` : ' à vista'}`;
        }
        const PURPLE = '#6b3fa0', DARK = '#4c1d95', LAV = '#eee9f6', MAG = '#b02096';
        return (
          <div className="fixed inset-0 z-[60] flex flex-col bg-black/70 p-3 sm:p-6" onClick={closePreview}>
            <div className="mx-auto flex h-full w-full max-w-4xl flex-col overflow-hidden rounded-2xl bg-white shadow-2xl" onClick={e => e.stopPropagation()}>
              <div className="flex items-center justify-between gap-3 border-b border-gray-200 px-5 py-3">
                <div className="flex items-center gap-2 min-w-0">
                  <Eye className="h-5 w-5 shrink-0" style={{ color: PURPLE }} />
                  <p className="truncate font-black text-gray-800">Prévia — Orçamento {previewNumber}</p>
                </div>
                <div className="flex items-center gap-2">
                  {previewUrl && (
                    <a href={previewUrl} target="_blank" rel="noopener noreferrer" className="rounded-xl border border-gray-300 px-3 py-2 text-sm font-bold text-gray-600 hover:bg-gray-100">Abrir em nova aba</a>
                  )}
                  {previewUrl && (
                    <a href={previewUrl} download={`Orcamento_${previewNumber}.pdf`} className="rounded-xl px-4 py-2 text-sm font-bold text-white" style={{ backgroundColor: PURPLE }}>Baixar</a>
                  )}
                  <button onClick={closePreview} className="rounded-xl p-2 text-gray-500 hover:bg-gray-100 hover:text-gray-800" title="Fechar"><X className="h-5 w-5" /></button>
                </div>
              </div>

              {/* Folha da proposta — tamanho A4 (210×297mm ≈ 794×1123px a 96dpi). */}
              <div className="flex-1 overflow-auto bg-gray-100 p-4 sm:p-8">
                <div className="mx-auto flex w-[794px] max-w-full min-h-[1123px] flex-col bg-white px-[56px] py-[56px] shadow-sm text-gray-800">
                  {/* Cabeçalho */}
                  <div className="flex items-start justify-between gap-4 border-b-2 pb-3" style={{ borderColor: PURPLE }}>
                    {logo
                      ? <img src={logo} alt="logo" className="h-14 w-auto object-contain" />
                      : <p className="text-xl font-black" style={{ color: DARK }}>{company.name}</p>}
                    <div className="text-right text-[11px] leading-relaxed">
                      {company.owner && <p className="font-bold text-gray-900">{company.owner}</p>}
                      {company.cnpj && <p className="text-gray-500">CNPJ {company.cnpj}</p>}
                      {company.phone && <p className="text-gray-500">{company.phone}</p>}
                      {company.email && <p style={{ color: MAG }}>{company.email}</p>}
                      {company.site && <p style={{ color: MAG }}>{company.site}</p>}
                      {company.address && <p className="text-gray-500">{company.address}</p>}
                    </div>
                  </div>

                  {/* Faixa */}
                  <div className="mt-6 px-4 py-2.5 text-sm font-black tracking-wide text-white" style={{ backgroundColor: PURPLE }}>PROPOSTA COMERCIAL</div>

                  {/* Capa */}
                  <div className="mt-4 rounded-sm px-5 py-4" style={{ backgroundColor: LAV }}>
                    <p className="text-2xl font-black" style={{ color: DARK }}>{pd.clientName || 'Cliente'}</p>
                    <p className="mt-1 text-sm text-gray-600">Orçamento {pd.quoteNumber}</p>
                    <p className="text-sm text-gray-600">Emitido em {format(parseLocalDate(pd.date), 'dd/MM/yyyy')} · válido até {format(parseLocalDate(pd.validUntil), 'dd/MM/yyyy')}</p>
                  </div>

                  {/* Itens */}
                  <p className="mt-8 mb-2 border-l-4 pl-2 text-lg font-black" style={{ borderColor: PURPLE, color: DARK }}>Itens da proposta</p>
                  <div className="overflow-x-auto">
                    <table className="w-full border-collapse text-sm">
                      <thead>
                        <tr style={{ backgroundColor: PURPLE }} className="text-white text-left">
                          <th className="px-3 py-2 font-bold">Descrição</th>
                          <th className="px-3 py-2 font-bold text-center w-16">Qtd</th>
                          <th className="px-3 py-2 font-bold text-right w-28">Unitário</th>
                          <th className="px-3 py-2 font-bold text-right w-28">Total</th>
                        </tr>
                      </thead>
                      <tbody>
                        {(pd.items || []).map((it, i) => (
                          <tr key={i} className={i % 2 ? 'bg-[#f8f6fb]' : 'bg-white'}>
                            <td className="border border-gray-200 px-3 py-2">{it.description || '-'}</td>
                            <td className="border border-gray-200 px-3 py-2 text-center">{it.quantity}</td>
                            <td className="border border-gray-200 px-3 py-2 text-right">{brl(it.unitPrice)}</td>
                            <td className="border border-gray-200 px-3 py-2 text-right">{brl(itemGross(it))}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  {/* Totais */}
                  <div className="mt-6 flex justify-end">
                    <div className="w-72 rounded-sm px-5 py-4" style={{ backgroundColor: LAV }}>
                      <div className="flex justify-between text-sm text-gray-600"><span>Subtotal</span><span>{brl(t.subtotal)}</span></div>
                      {t.discountTotal > 0 && <div className="mt-1 flex justify-between text-sm text-gray-600"><span>Desconto</span><span>- {brl(t.discountTotal)}</span></div>}
                      <div className="mt-2 flex justify-between text-lg font-black" style={{ color: DARK }}><span>TOTAL</span><span>{brl(t.total)}</span></div>
                    </div>
                  </div>

                  {/* Pagamento */}
                  <p className="mt-8 mb-1 border-l-4 pl-2 text-base font-black" style={{ borderColor: PURPLE, color: DARK }}>Forma de pagamento</p>
                  <p className="text-sm text-gray-700">›&nbsp;&nbsp;{pay}</p>

                  {/* Observações */}
                  {pd.notes && (<>
                    <p className="mt-6 mb-1 border-l-4 pl-2 text-base font-black" style={{ borderColor: PURPLE, color: DARK }}>Observações</p>
                    <p className="whitespace-pre-wrap text-sm text-gray-700">{pd.notes}</p>
                  </>)}

                  {/* Rodapé — fixo no pé da folha A4 (mt-auto empurra pro fundo). */}
                  <div className="mt-auto border-t border-gray-200 pt-3 text-center text-[11px] text-gray-500">
                    {[company.name, company.phone, company.email, company.site].filter(Boolean).join('   ·   ')}
                  </div>
                </div>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
};
