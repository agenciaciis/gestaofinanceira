import React, { useState, useEffect, useMemo } from 'react';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { collection, query, onSnapshot, addDoc, serverTimestamp, updateDoc, doc, deleteDoc, orderBy, getDocs } from 'firebase/firestore';
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
} from 'lucide-react';
import { motion, AnimatePresence } from 'motion/react';
import { cn } from '../lib/utils';
import { format, addDays } from 'date-fns';
import { ptBR } from 'date-fns/locale';
import jsPDF from 'jspdf';
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

  const subtotal = useMemo(() => quoteItems.reduce((acc, item) => acc + item.total, 0), [quoteItems]);
  const discountTotal = useMemo(() => quoteItems.reduce((acc, item) => acc + (item.discount || 0), 0), [quoteItems]);
  const total = useMemo(() => subtotal - discountTotal, [subtotal, discountTotal]);

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
        updated.total = updated.quantity * updated.unitPrice;
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

      const quoteData = {
        quoteNumber: editingQuote?.quoteNumber || `ORC-${Date.now().toString().slice(-6)}`,
        clientId,
        clientName,
        date: quoteDate,
        validUntil,
        items: quoteItems,
        subtotal,
        discountTotal,
        total,
        paymentMethod,
        installments,
        status: editingQuote?.status || 'draft',
        notes,
        entityId: selectedEntity.id,
        ownerUid: selectedEntity.ownerUid,
        collaboratorsEmails: selectedEntity.collaboratorsEmails || [],
        createdAt: serverTimestamp(),
        recurrenceConfig: {
          enabled: recurrenceEnabled,
          frequency: recurrenceFrequency,
          startDate: quoteDate
        }
      };

      if (editingQuote) {
        await updateDoc(doc(db, `entities/${selectedEntity.id}/quotes/${editingQuote.id}`), quoteData);
      } else {
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
    setQuoteItems(quote.items);
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

  const exportPDF = (quote: Quote) => {
    const doc = new jsPDF();
    
    // Header - Branding
    doc.setFillColor(37, 99, 235); // Primary color
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
    
    // Client Info
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(12);
    doc.setFont('helvetica', 'bold');
    doc.text('CLIENTE:', 14, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(quote.clientName, 14, 62);
    
    doc.setFont('helvetica', 'bold');
    doc.text('DATA:', 150, 55);
    doc.setFont('helvetica', 'normal');
    doc.text(format(new Date(quote.date), 'dd/MM/yyyy'), 150, 62);
    
    doc.setFont('helvetica', 'bold');
    doc.text('VALIDADE:', 150, 72);
    doc.setFont('helvetica', 'normal');
    doc.text(format(new Date(quote.validUntil), 'dd/MM/yyyy'), 150, 79);

    // Items Table
    const tableData = quote.items.map(item => [
      item.description,
      item.quantity,
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.unitPrice),
      new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.total)
    ]);

    autoTable(doc, {
      startY: 90,
      head: [['Descrição', 'Qtd', 'Unitário', 'Total']],
      body: tableData,
      theme: 'striped',
      headStyles: { fillColor: [37, 99, 235] },
      styles: { fontSize: 10 }
    });

    // Totals
    const finalY = (doc as any).lastAutoTable.finalY + 10;
    doc.setFont('helvetica', 'bold');
    doc.text('Subtotal:', 140, finalY);
    doc.setFont('helvetica', 'normal');
    doc.text(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(quote.subtotal), 170, finalY);

    if (quote.discountTotal > 0) {
      doc.setFont('helvetica', 'bold');
      doc.text('Desconto:', 140, finalY + 7);
      doc.setFont('helvetica', 'normal');
      doc.text(`- ${new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(quote.discountTotal)}`, 170, finalY + 7);
    }

    doc.setFontSize(14);
    doc.setFont('helvetica', 'bold');
    doc.setTextColor(37, 99, 235);
    doc.text('TOTAL:', 140, finalY + 17);
    doc.text(new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(quote.total), 170, finalY + 17);

    // Payment Info
    doc.setTextColor(0, 0, 0);
    doc.setFontSize(10);
    doc.setFont('helvetica', 'bold');
    doc.text('FORMA DE PAGAMENTO:', 14, finalY + 30);
    doc.setFont('helvetica', 'normal');
    doc.text(`${quote.paymentMethod} ${quote.installments > 1 ? `(${quote.installments}x)` : ''}`, 14, finalY + 37);

    if (quote.notes) {
      doc.setFont('helvetica', 'bold');
      doc.text('OBSERVAÇÕES:', 14, finalY + 50);
      doc.setFont('helvetica', 'normal');
      doc.text(quote.notes, 14, finalY + 57, { maxWidth: 180 });
    }

    doc.save(`orcamento_${quote.quoteNumber}.pdf`);
  };

  const filteredQuotes = quotes.filter(q => 
    q.clientName.toLowerCase().includes(searchTerm.toLowerCase()) || 
    q.quoteNumber.toLowerCase().includes(searchTerm.toLowerCase())
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
      <div className="rounded-[2.5rem] bg-blue-50 dark:bg-gradient-to-br dark:from-blue-900 dark:to-indigo-950 p-8 text-blue-900 dark:text-white shadow-xl shadow-blue-100 dark:shadow-none relative overflow-hidden group border border-blue-100 dark:border-blue-900/30">
        <div className="relative z-10 flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-6">
            <div className="flex h-20 w-20 items-center justify-center rounded-3xl bg-white dark:bg-white/10 backdrop-blur-md border border-blue-200 dark:border-white/30 shadow-inner">
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
          <button 
            onClick={() => { resetForm(); setIsModalOpen(true); }}
            className="flex items-center justify-center gap-2 rounded-2xl bg-blue-600 px-8 py-4 text-sm font-black text-white shadow-xl hover:bg-blue-700 transition-all transform hover:scale-105 active:scale-95"
          >
            <Plus className="h-5 w-5" />
            Novo Orçamento
          </button>
        </div>
        
        {/* Decorative elements */}
        <div className="absolute -right-20 -bottom-20 h-64 w-64 rounded-full bg-white/10 blur-3xl" />
        <div className="absolute -left-10 -top-10 h-40 w-40 rounded-full bg-blue-400/20 blur-2xl" />
      </div>

      {/* Search & Filters */}
      <div className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="relative w-full sm:w-96">
          <Search className="absolute left-4 top-3 h-5 w-5 text-gray-400" />
          <input 
            type="text"
            placeholder="Buscar por cliente ou número..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full rounded-2xl border border-gray-200 bg-white pl-12 pr-4 py-3 text-sm outline-none focus:border-primary focus:ring-1 focus:ring-primary transition-all shadow-sm"
          />
        </div>
      </div>

      {/* Quotes List */}
      <div className="grid gap-6">
        {filteredQuotes.map(quote => (
          <motion.div 
            layout
            key={quote.id}
            className="group relative rounded-3xl bg-white p-6 shadow-sm border border-gray-100 hover:shadow-md transition-all"
          >
            <div className="flex flex-col gap-6 sm:flex-row sm:items-center">
              <div className="flex-1">
                <div className="flex items-center gap-3 mb-2">
                  <span className="text-xs font-black text-primary uppercase tracking-widest">{quote.quoteNumber}</span>
                  <span className={cn(
                    "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wider",
                    quote.status === 'approved' ? "bg-emerald-100 text-emerald-700" :
                    quote.status === 'sent' ? "bg-blue-100 text-blue-700" :
                    quote.status === 'rejected' ? "bg-red-100 text-red-700" : "bg-gray-100 text-gray-700"
                  )}>
                    {quote.status === 'draft' ? 'Rascunho' : 
                     quote.status === 'sent' ? 'Enviado' :
                     quote.status === 'approved' ? 'Aprovado' :
                     quote.status === 'rejected' ? 'Recusado' : 'Convertido'}
                  </span>
                </div>
                <h3 className="text-lg font-bold text-gray-900">{quote.clientName}</h3>
                <div className="mt-2 flex flex-wrap items-center gap-4 text-xs font-medium text-gray-400">
                  <div className="flex items-center gap-1.5">
                    <Calendar className="h-3.5 w-3.5" />
                    {format(new Date(quote.date), 'dd/MM/yyyy')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Clock className="h-3.5 w-3.5" />
                    Válido até {format(new Date(quote.validUntil), 'dd/MM/yyyy')}
                  </div>
                  <div className="flex items-center gap-1.5">
                    <Package className="h-3.5 w-3.5" />
                    {quote.items.length} itens
                  </div>
                </div>
              </div>

              <div className="flex flex-col items-end gap-1">
                <p className="text-2xl font-black text-gray-900">
                  {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(quote.total)}
                </p>
                <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">
                  {quote.paymentMethod} {quote.installments > 1 ? `(${quote.installments}x)` : ''}
                </p>
              </div>

              <div className="flex items-center gap-2 border-t pt-4 sm:border-t-0 sm:pt-0 sm:pl-6 sm:border-l">
                <button 
                  onClick={() => exportPDF(quote)}
                  className="rounded-xl p-2.5 text-gray-400 hover:bg-gray-50 hover:text-primary transition-all"
                  title="Exportar PDF"
                >
                  <Printer className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => handleEdit(quote)}
                  className="rounded-xl p-2.5 text-gray-400 hover:bg-gray-50 hover:text-primary transition-all"
                >
                  <Edit2 className="h-5 w-5" />
                </button>
                <button 
                  onClick={() => handleDelete(quote.id)}
                  className="rounded-xl p-2.5 text-gray-400 hover:bg-red-50 hover:text-red-500 transition-all"
                >
                  <Trash2 className="h-5 w-5" />
                </button>
                <div className="relative group/status">
                  <button className="rounded-xl bg-gray-50 p-2.5 text-gray-400 hover:bg-gray-100 transition-all">
                    <ChevronRight className="h-5 w-5" />
                  </button>
                  <div className="absolute right-0 top-full z-10 mt-2 hidden w-40 rounded-xl border bg-white p-2 shadow-xl group-hover/status:block">
                    <button onClick={() => updateStatus(quote.id, 'sent')} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-blue-600 hover:bg-blue-50">Marcar como Enviado</button>
                    <button onClick={() => updateStatus(quote.id, 'approved')} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-emerald-600 hover:bg-emerald-50">Marcar como Aprovado</button>
                    <button onClick={() => updateStatus(quote.id, 'rejected')} className="w-full rounded-lg px-3 py-2 text-left text-xs font-bold text-red-600 hover:bg-red-50">Marcar como Recusado</button>
                  </div>
                </div>
              </div>
            </div>
          </motion.div>
        ))}
      </div>

      {/* Modal */}
      <AnimatePresence>
        {isModalOpen && (
          <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/50 backdrop-blur-sm">
            <motion.div 
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="w-full max-w-4xl rounded-[2rem] bg-white p-8 shadow-2xl overflow-y-auto max-h-[95vh]"
            >
              <div className="flex items-center justify-between mb-8">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                    <Calculator className="h-6 w-6" />
                  </div>
                  <h3 className="text-xl font-black text-gray-900 tracking-tight">
                    {editingQuote ? 'Editar Orçamento' : 'Novo Orçamento'}
                  </h3>
                </div>
                <button onClick={() => setIsModalOpen(false)} className="rounded-full p-2 hover:bg-gray-100">
                  <X className="h-6 w-6 text-gray-400" />
                </button>
              </div>

              <form onSubmit={handleSubmit} className="space-y-8">
                {/* Client Section */}
                <div className="rounded-3xl bg-gray-50 p-6 space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black uppercase tracking-widest text-gray-400">Informações do Cliente</h4>
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
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
                        required
                      />
                      <input 
                        type="email"
                        placeholder="E-mail"
                        value={newClientEmail}
                        onChange={(e) => setNewClientEmail(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
                      />
                    </div>
                  ) : (
                    <select 
                      value={selectedClientId}
                      onChange={(e) => setSelectedClientId(e.target.value)}
                      className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
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
                      <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 ml-1">Data do Orçamento</label>
                      <input 
                        type="date"
                        value={quoteDate}
                        onChange={(e) => setQuoteDate(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
                        required
                      />
                    </div>
                    <div>
                      <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 ml-1">Validade</label>
                      <input 
                        type="date"
                        value={validUntil}
                        onChange={(e) => setValidUntil(e.target.value)}
                        className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary bg-white"
                        required
                      />
                    </div>
                  </div>
                </div>

                {/* Items Section */}
                <div className="space-y-4">
                  <div className="flex items-center justify-between">
                    <h4 className="text-sm font-black uppercase tracking-widest text-gray-400">Itens do Orçamento</h4>
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
                        className="grid gap-4 sm:grid-cols-12 items-end rounded-2xl border border-gray-100 p-4 bg-white shadow-sm"
                      >
                        <div className="sm:col-span-5">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Item / Descrição</label>
                          <select 
                            value={item.referenceId || ''}
                            onChange={(e) => updateItem(item.id, { referenceId: e.target.value })}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
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
                          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Qtd</label>
                          <input 
                            type="number"
                            value={item.quantity}
                            onChange={(e) => updateItem(item.id, { quantity: parseInt(e.target.value) })}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Unitário</label>
                          <input 
                            type="number"
                            value={item.unitPrice}
                            onChange={(e) => updateItem(item.id, { unitPrice: parseFloat(e.target.value) })}
                            className="w-full rounded-xl border border-gray-200 px-3 py-2 text-sm outline-none focus:border-primary"
                          />
                        </div>
                        <div className="sm:col-span-2">
                          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1">Total</label>
                          <p className="px-3 py-2 text-sm font-bold text-gray-900">
                            {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(item.total)}
                          </p>
                        </div>
                        <div className="sm:col-span-1 flex justify-end">
                          <button 
                            type="button"
                            onClick={() => removeItem(item.id)}
                            className="rounded-lg p-2 text-gray-400 hover:bg-red-50 hover:text-red-500"
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
                  <div className="rounded-3xl bg-gray-50 p-6 space-y-4">
                    <h4 className="text-sm font-black uppercase tracking-widest text-gray-400">Pagamento</h4>
                    <div className="grid gap-4 sm:grid-cols-2">
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 ml-1">Forma</label>
                        <select 
                          value={paymentMethod}
                          onChange={(e) => setPaymentMethod(e.target.value)}
                          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary bg-white"
                        >
                          <option value="PIX">PIX</option>
                          <option value="Cartão de Crédito">Cartão de Crédito</option>
                          <option value="Boleto">Boleto</option>
                          <option value="Transferência">Transferência</option>
                        </select>
                      </div>
                      <div>
                        <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 ml-1">Parcelas</label>
                        <input 
                          type="number"
                          min="1"
                          max="12"
                          value={installments}
                          onChange={(e) => setInstallments(parseInt(e.target.value))}
                          className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary bg-white"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="rounded-3xl bg-gray-50 p-6 space-y-4">
                    <div className="flex items-center justify-between">
                      <h4 className="text-sm font-black uppercase tracking-widest text-gray-400">Recorrência</h4>
                      <button 
                        type="button"
                        onClick={() => setRecurrenceEnabled(!recurrenceEnabled)}
                        className={cn(
                          "relative inline-flex h-6 w-11 items-center rounded-full transition-colors",
                          recurrenceEnabled ? "bg-primary" : "bg-gray-200"
                        )}
                      >
                        <span className={cn(
                          "inline-block h-4 w-4 transform rounded-full bg-white transition-transform",
                          recurrenceEnabled ? "translate-x-6" : "translate-x-1"
                        )} />
                      </button>
                    </div>
                    {recurrenceEnabled && (
                      <div className="space-y-4 animate-in fade-in slide-in-from-top-2">
                        <div>
                          <label className="block text-[10px] font-black uppercase tracking-widest text-gray-400 mb-1 ml-1">Frequência</label>
                          <select 
                            value={recurrenceFrequency}
                            onChange={(e) => setRecurrenceFrequency(e.target.value as any)}
                            className="w-full rounded-xl border border-gray-200 px-4 py-2.5 outline-none focus:border-primary bg-white"
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
                  <label className="block text-sm font-black uppercase tracking-widest text-gray-400 mb-2 ml-1">Observações</label>
                  <textarea 
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    className="w-full rounded-2xl border border-gray-200 px-4 py-3 outline-none focus:border-primary transition-all min-h-[100px]"
                    placeholder="Condições especiais, prazos de entrega..."
                  />
                </div>

                {/* Summary & Actions */}
                <div className="flex flex-col gap-6 sm:flex-row sm:items-center sm:justify-between border-t pt-8">
                  <div className="space-y-1">
                    <p className="text-xs font-bold text-gray-400 uppercase tracking-widest">Resumo do Orçamento</p>
                    <div className="flex items-baseline gap-2">
                      <span className="text-3xl font-black text-gray-900">
                        {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total)}
                      </span>
                      {installments > 1 && (
                        <span className="text-sm font-bold text-gray-400">
                          ({installments}x de {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(total / installments)})
                        </span>
                      )}
                    </div>
                  </div>

                  <div className="flex gap-4">
                    <button 
                      type="button"
                      onClick={() => setIsModalOpen(false)}
                      className="rounded-xl border border-gray-200 px-6 py-3 text-sm font-bold text-gray-600 hover:bg-gray-50 transition-all"
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
