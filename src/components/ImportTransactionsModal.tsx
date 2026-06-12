import React, { useState, useRef } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { X, Upload, FileText, Check, AlertCircle, Loader2, Sparkles, ChevronRight, ChevronLeft, Table } from 'lucide-react';
import { cn } from '../lib/utils';
import Papa from 'papaparse';
import * as XLSX from 'xlsx';
import { useEntity } from '../contexts/EntityContext';
import { useUI } from '../contexts/UIContext';
import { suggestCategories, extractStatementFromPdf } from '../services/geminiService';
import { CATEGORIES } from '../constants';
import { collection, writeBatch, doc, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import { BankAccount, CreditCard } from '../types';
import { parseAmountBR, parseFlexibleDate, parseOFX, ParsedRow } from '../lib/statementParsers';

interface ImportTransactionsModalProps {
  isOpen: boolean;
  onClose: () => void;
  accounts: BankAccount[];
  cards: CreditCard[];
}

type Step = 'upload' | 'mapping' | 'review';

interface RawData {
  headers: string[];
  rows: any[][];
}

interface Mapping {
  date: string;
  description: string;
  amount: string;
}

interface ProcessedTransaction {
  date: string;
  description: string;
  amount: number;
  type: 'income' | 'expense';
  categoryId: string;
  status: 'completed' | 'pending';
}

export const ImportTransactionsModal: React.FC<ImportTransactionsModalProps> = ({ isOpen, onClose, accounts, cards }) => {
  const { entities } = useEntity();
  const { showToast } = useUI();
  const [step, setStep] = useState<Step>('upload');
  const [loading, setLoading] = useState(false);
  const [rawData, setRawData] = useState<RawData | null>(null);
  const [mapping, setMapping] = useState<Mapping>({ date: '', description: '', amount: '' });
  const [processedData, setProcessedData] = useState<ProcessedTransaction[]>([]);
  const [targetEntityId, setTargetEntityId] = useState('');
  const [paymentMethod, setPaymentMethod] = useState<'account' | 'card'>('account');
  const [accountId, setAccountId] = useState('');
  const [cardId, setCardId] = useState('');
  
  const fileInputRef = useRef<HTMLInputElement>(null);

  if (!isOpen) return null;

  const readAsText = (file: File) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result || ''));
    r.onerror = reject;
    r.readAsText(file);
  });

  const readAsBase64 = (file: File) => new Promise<string>((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => {
      const result = String(r.result || '');
      resolve(result.includes(',') ? result.split(',')[1] : result);
    };
    r.onerror = reject;
    r.readAsDataURL(file);
  });

  // Converte linhas já normalizadas (data+valor+descrição) em transações,
  // roda a categorização por IA e vai para a revisão. Usado por OFX e PDF.
  const processRows = async (rows: ParsedRow[]) => {
    const clean = rows.filter(r => r.date && Number.isFinite(r.amount) && r.amount !== 0);
    if (clean.length === 0) {
      showToast('Nenhuma transação reconhecida no arquivo.', 'error');
      return;
    }
    const transactions: ProcessedTransaction[] = clean.map(r => ({
      date: r.date,
      description: r.description,
      amount: Math.abs(r.amount),
      type: r.amount >= 0 ? 'income' : 'expense',
      categoryId: 'outros',
      status: 'completed',
    }));
    const categorized = await categorize(transactions);
    setProcessedData(categorized);
    setStep('review');
  };

  // Categorização por IA em blocos, com alinhamento posicional seguro.
  const categorize = async (transactions: ProcessedTransaction[]): Promise<ProcessedTransaction[]> => {
    const chunkSize = 20;
    const suggested: string[] = [];
    for (let i = 0; i < transactions.length; i += chunkSize) {
      const chunk = transactions.slice(i, i + chunkSize).map(t => t.description);
      try {
        const res = await suggestCategories(chunk, 'expense');
        // Garante alinhamento: se a IA retornar tamanho diferente, completa com 'outros'.
        for (let j = 0; j < chunk.length; j++) suggested.push(res[j] || 'outros');
      } catch {
        for (let j = 0; j < chunk.length; j++) suggested.push('outros');
      }
    }
    return transactions.map((t, i) => ({ ...t, categoryId: suggested[i] || 'outros' }));
  };

  const handleFileUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const extension = file.name.split('.').pop()?.toLowerCase();

    try {
      if (extension === 'csv') {
        Papa.parse(file, {
          complete: (results) => {
            const data = (results.data as any[][]).filter(r => Array.isArray(r) && r.some(c => String(c).trim() !== ''));
            if (data.length > 0) {
              setRawData({ headers: (data[0] as string[]).map(h => String(h)), rows: data.slice(1) });
              setStep('mapping');
            } else {
              showToast('Arquivo CSV vazio.', 'error');
            }
          },
          header: false,
          skipEmptyLines: true,
        });
      } else if (extension === 'xlsx' || extension === 'xls') {
        const buf = await file.arrayBuffer();
        const workbook = XLSX.read(buf, { type: 'array' });
        const worksheet = workbook.Sheets[workbook.SheetNames[0]];
        const data = (XLSX.utils.sheet_to_json(worksheet, { header: 1 }) as any[][])
          .filter(r => Array.isArray(r) && r.some(c => String(c).trim() !== ''));
        if (data.length > 0) {
          setRawData({ headers: data[0].map(h => String(h)), rows: data.slice(1) });
          setStep('mapping');
        } else {
          showToast('Planilha vazia.', 'error');
        }
      } else if (extension === 'ofx' || extension === 'qfx') {
        setLoading(true);
        const text = await readAsText(file);
        await processRows(parseOFX(text));
      } else if (extension === 'pdf') {
        setLoading(true);
        showToast('Lendo o PDF com IA... isso pode levar alguns segundos.', 'info');
        const base64 = await readAsBase64(file);
        const rows = await extractStatementFromPdf(base64, 'application/pdf');
        await processRows(rows);
      } else {
        showToast('Formato não suportado. Use CSV, Excel, OFX ou PDF.', 'error');
      }
    } catch (err) {
      console.error('Erro ao ler arquivo:', err);
      showToast('Erro ao ler o arquivo. Verifique o formato.', 'error');
    } finally {
      setLoading(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const handleProcessMapping = async () => {
    if (!rawData || !mapping.date || !mapping.description || !mapping.amount) {
      showToast('Por favor, mapeie todas as colunas obrigatórias.', 'error');
      return;
    }

    setLoading(true);
    try {
      const dateIdx = rawData.headers.indexOf(mapping.date);
      const descIdx = rawData.headers.indexOf(mapping.description);
      const amountIdx = rawData.headers.indexOf(mapping.amount);

      const rows: ParsedRow[] = rawData.rows.map(row => ({
        date: parseFlexibleDate(row[dateIdx]),
        description: String(row[descIdx] ?? '').trim() || 'Lançamento importado',
        amount: parseAmountBR(row[amountIdx]),
      }));
      await processRows(rows);
    } catch (error) {
      console.error("Error processing mapping:", error);
      showToast('Erro ao processar dados. Verifique o formato das colunas.', 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleSave = async () => {
    if (!targetEntityId) {
      showToast('Selecione uma entidade.', 'error');
      return;
    }

    setLoading(true);
    try {
      const entity = entities.find(e => e.id === targetEntityId);
      // Firestore limita 500 operações por batch — comita em blocos.
      const CHUNK = 450;
      for (let i = 0; i < processedData.length; i += CHUNK) {
        const batch = writeBatch(db);
        for (const t of processedData.slice(i, i + CHUNK)) {
          const docRef = doc(collection(db, `entities/${targetEntityId}/transactions`));
          const formattedDate = parseFlexibleDate(t.date) || t.date;
          batch.set(docRef, {
            description: t.description,
            amount: t.amount,
            type: t.type,
            date: formattedDate,
            categoryId: t.categoryId,
            accountId: paymentMethod === 'account' ? accountId : null,
            cardId: paymentMethod === 'card' ? cardId : null,
            status: t.status,
            entityId: targetEntityId,
            ownerUid: entity?.ownerUid,
            collaboratorsEmails: entity?.collaboratorsEmails || [],
            createdAt: serverTimestamp(),
          });
        }
        await batch.commit();
      }
      showToast(`${processedData.length} transações importadas com sucesso!`, 'success');
      onClose();
    } catch (error) {
      console.error("Error saving imported transactions:", error);
      showToast('Erro ao salvar transações.', 'error');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
      <motion.div 
        initial={{ opacity: 0, scale: 0.95 }}
        animate={{ opacity: 1, scale: 1 }}
        className="w-full max-w-4xl rounded-2xl bg-white shadow-2xl overflow-hidden flex flex-col max-h-[90vh]"
      >
        {/* Header */}
        <div className="flex items-center justify-between border-bottom border-gray-100 p-6">
          <div className="flex items-center gap-3">
            <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
              <Upload className="h-5 w-5" />
            </div>
            <div>
              <h3 className="text-xl font-bold text-gray-900">Importar Extrato</h3>
              <p className="text-sm text-gray-500">CSV, Excel, OFX ou PDF — processamos automaticamente.</p>
            </div>
          </div>
          <button onClick={onClose} className="rounded-lg p-2 hover:bg-gray-100 text-gray-400">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Steps Indicator */}
        <div className="flex border-bottom border-gray-100 bg-gray-50/50 px-6 py-3">
          {[
            { id: 'upload', label: 'Upload', icon: Upload },
            { id: 'mapping', label: 'Mapeamento', icon: Table },
            { id: 'review', label: 'Revisão', icon: Check },
          ].map((s, i) => (
            <React.Fragment key={s.id}>
              <div className={cn(
                "flex items-center gap-2 text-sm font-bold",
                step === s.id ? "text-primary" : "text-gray-400"
              )}>
                <div className={cn(
                  "flex h-6 w-6 items-center justify-center rounded-full text-[10px]",
                  step === s.id ? "bg-primary text-white" : "bg-gray-200 text-gray-500"
                )}>
                  {i + 1}
                </div>
                {s.label}
              </div>
              {i < 2 && <div className="mx-4 h-px w-8 bg-gray-200 self-center" />}
            </React.Fragment>
          ))}
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6">
          {step === 'upload' && loading && (
            <div className="flex flex-col items-center justify-center py-20">
              <Loader2 className="h-10 w-10 animate-spin text-primary" />
              <p className="mt-4 text-sm font-bold text-gray-700">Processando arquivo...</p>
              <p className="mt-1 text-xs text-gray-400">Extraindo e categorizando as transações.</p>
            </div>
          )}

          {step === 'upload' && !loading && (
            <div className="flex flex-col items-center justify-center py-12">
              <div
                onClick={() => fileInputRef.current?.click()}
                className="group relative flex w-full max-w-md cursor-pointer flex-col items-center justify-center rounded-2xl border-2 border-dashed border-gray-200 bg-gray-50 p-12 transition-all hover:border-primary/50 hover:bg-primary/5"
              >
                <div className="mb-4 flex h-16 w-16 items-center justify-center rounded-full bg-white shadow-sm group-hover:scale-110 transition-transform">
                  <FileText className="h-8 w-8 text-primary" />
                </div>
                <p className="text-lg font-bold text-gray-900">Clique para selecionar</p>
                <p className="mt-1 text-sm text-gray-500">ou arraste seu arquivo aqui</p>
                <p className="mt-4 text-xs text-gray-400">Suporta .CSV, .XLSX, .XLS, .OFX e .PDF (via IA)</p>
                <input
                  type="file"
                  ref={fileInputRef}
                  onChange={handleFileUpload}
                  accept=".csv,.xlsx,.xls,.ofx,.qfx,.pdf"
                  className="hidden"
                />
              </div>

              <div className="mt-8 grid grid-cols-1 sm:grid-cols-3 gap-4 w-full max-w-2xl">
                <div className="rounded-xl border border-gray-100 p-4 bg-white">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-blue-50 text-blue-600 mb-3">
                    <Check className="h-4 w-4" />
                  </div>
                  <h4 className="text-sm font-bold text-gray-900">Automático</h4>
                  <p className="text-xs text-gray-500 mt-1">Reconhecemos datas e valores automaticamente.</p>
                </div>
                <div className="rounded-xl border border-gray-100 p-4 bg-white">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-purple-50 text-purple-600 mb-3">
                    <Sparkles className="h-4 w-4" />
                  </div>
                  <h4 className="text-sm font-bold text-gray-900">IA Categorização</h4>
                  <p className="text-xs text-gray-500 mt-1">Nossa IA sugere a melhor categoria para cada item.</p>
                </div>
                <div className="rounded-xl border border-gray-100 p-4 bg-white">
                  <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-green-50 text-green-600 mb-3">
                    <Table className="h-4 w-4" />
                  </div>
                  <h4 className="text-sm font-bold text-gray-900">Flexível</h4>
                  <p className="text-xs text-gray-500 mt-1">Funciona com extratos de qualquer banco.</p>
                </div>
              </div>
            </div>
          )}

          {step === 'mapping' && rawData && (
            <div className="space-y-6">
              <div className="rounded-xl bg-blue-50 p-4 flex gap-3">
                <AlertCircle className="h-5 w-5 text-blue-600 shrink-0" />
                <p className="text-sm text-blue-700">
                  Identificamos as colunas do seu arquivo. Por favor, indique qual coluna representa cada informação.
                </p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-3 gap-6">
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Coluna de Data</label>
                  <select 
                    value={mapping.date}
                    onChange={(e) => setMapping({ ...mapping, date: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Selecionar...</option>
                    {rawData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Coluna de Descrição</label>
                  <select 
                    value={mapping.description}
                    onChange={(e) => setMapping({ ...mapping, description: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Selecionar...</option>
                    {rawData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-bold text-gray-700 mb-2">Coluna de Valor</label>
                  <select 
                    value={mapping.amount}
                    onChange={(e) => setMapping({ ...mapping, amount: e.target.value })}
                    className="w-full rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Selecionar...</option>
                    {rawData.headers.map(h => <option key={h} value={h}>{h}</option>)}
                  </select>
                </div>
              </div>

              <div className="mt-8">
                <h4 className="text-sm font-bold text-gray-900 mb-4">Prévia dos Dados (Primeiras 5 linhas)</h4>
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 font-bold text-gray-500">
                      <tr>
                        {rawData.headers.map(h => <th key={h} className="px-4 py-2">{h}</th>)}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {rawData.rows.slice(0, 5).map((row, i) => (
                        <tr key={i}>
                          {row.map((cell, j) => <td key={j} className="px-4 py-2 text-gray-600">{String(cell)}</td>)}
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}

          {step === 'review' && (
            <div className="space-y-6">
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-gray-700 mb-2">Entidade Destino</label>
                  <select 
                    value={targetEntityId}
                    onChange={(e) => setTargetEntityId(e.target.value)}
                    className="w-full rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                  >
                    <option value="">Selecionar Entidade...</option>
                    {entities.map(e => <option key={e.id} value={e.id}>{e.name} ({e.type})</option>)}
                  </select>
                </div>
                <div className="sm:col-span-2">
                  <label className="block text-sm font-bold text-gray-700 mb-2">Método de Pagamento</label>
                  <div className="flex gap-2">
                    <button
                      onClick={() => setPaymentMethod('account')}
                      className={cn(
                        "flex-1 rounded-lg border p-2.5 text-xs font-bold transition-all",
                        paymentMethod === 'account' ? "border-primary bg-primary/5 text-primary" : "border-gray-200 text-gray-500"
                      )}
                    >
                      Conta Bancária
                    </button>
                    <button
                      onClick={() => setPaymentMethod('card')}
                      className={cn(
                        "flex-1 rounded-lg border p-2.5 text-xs font-bold transition-all",
                        paymentMethod === 'card' ? "border-primary bg-primary/5 text-primary" : "border-gray-200 text-gray-500"
                      )}
                    >
                      Cartão de Crédito
                    </button>
                  </div>
                </div>
                {paymentMethod === 'account' ? (
                  <div className="sm:col-span-4">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Conta</label>
                    <select 
                      value={accountId}
                      onChange={(e) => setAccountId(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">Selecionar Conta...</option>
                      {accounts.filter(a => a.entityId === targetEntityId).map(a => (
                        <option key={a.id} value={a.id}>{a.bankName} ({a.type})</option>
                      ))}
                    </select>
                  </div>
                ) : (
                  <div className="sm:col-span-4">
                    <label className="block text-sm font-bold text-gray-700 mb-2">Cartão</label>
                    <select 
                      value={cardId}
                      onChange={(e) => setCardId(e.target.value)}
                      className="w-full rounded-lg border border-gray-200 p-2.5 text-sm outline-none focus:ring-2 focus:ring-primary/20"
                    >
                      <option value="">Selecionar Cartão...</option>
                      {cards.filter(c => c.entityId === targetEntityId).map(c => (
                        <option key={c.id} value={c.id}>{c.name}</option>
                      ))}
                    </select>
                  </div>
                )}
              </div>

              <div className="mt-8">
                <div className="flex items-center justify-between mb-4">
                  <h4 className="text-sm font-bold text-gray-900">Revisar Lançamentos ({processedData.length})</h4>
                  <div className="flex items-center gap-2 text-xs text-purple-600 font-bold">
                    <Sparkles className="h-3 w-3" />
                    Categorizado por IA
                  </div>
                </div>
                <div className="overflow-x-auto rounded-xl border border-gray-100">
                  <table className="w-full text-left text-xs">
                    <thead className="bg-gray-50 font-bold text-gray-500">
                      <tr>
                        <th className="px-4 py-2">Data</th>
                        <th className="px-4 py-2">Descrição</th>
                        <th className="px-4 py-2">Categoria</th>
                        <th className="px-4 py-2 text-right">Valor</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {processedData.map((t, i) => (
                        <tr key={i}>
                          <td className="px-4 py-2 text-gray-600">{t.date}</td>
                          <td className="px-4 py-2 font-bold text-gray-900">{t.description}</td>
                          <td className="px-4 py-2">
                            <select 
                              value={t.categoryId}
                              onChange={(e) => {
                                const newData = [...processedData];
                                newData[i].categoryId = e.target.value;
                                setProcessedData(newData);
                              }}
                              className="rounded border border-gray-100 bg-transparent p-1 text-[10px] outline-none"
                            >
                              {CATEGORIES.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
                            </select>
                          </td>
                          <td className={cn(
                            "px-4 py-2 text-right font-bold",
                            t.type === 'income' ? "text-green-600" : "text-red-600"
                          )}>
                            {t.type === 'income' ? '+' : '-'} {new Intl.NumberFormat('pt-BR', { style: 'currency', currency: 'BRL' }).format(t.amount)}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-top border-gray-100 bg-gray-50 p-6 flex justify-between items-center">
          <button 
            onClick={() => {
              if (step === 'mapping') setStep('upload');
              if (step === 'review') setStep('mapping');
            }}
            disabled={step === 'upload' || loading}
            className={cn(
              "flex items-center gap-2 text-sm font-bold text-gray-500 hover:text-gray-700 disabled:opacity-0 transition-all",
            )}
          >
            <ChevronLeft className="h-4 w-4" />
            Voltar
          </button>

          <div className="flex gap-3">
            <button 
              onClick={onClose}
              className="rounded-lg px-6 py-2 text-sm font-bold text-gray-500 hover:bg-gray-100"
            >
              Cancelar
            </button>
            {step === 'mapping' && (
              <button 
                onClick={handleProcessMapping}
                disabled={loading || !mapping.date || !mapping.description || !mapping.amount}
                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-bold text-white shadow-md hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Sparkles className="h-4 w-4" />}
                Processar com IA
              </button>
            )}
            {step === 'review' && (
              <button 
                onClick={handleSave}
                disabled={loading || !targetEntityId || (paymentMethod === 'account' && !accountId) || (paymentMethod === 'card' && !cardId)}
                className="flex items-center gap-2 rounded-lg bg-primary px-6 py-2 text-sm font-bold text-white shadow-md hover:bg-primary/90 disabled:opacity-50"
              >
                {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
                Confirmar Importação
              </button>
            )}
          </div>
        </div>
      </motion.div>
    </div>
  );
};
