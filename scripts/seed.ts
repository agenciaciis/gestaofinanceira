/**
 * Popula o sistema com dados de SIMULAÇÃO (como se estivesse em uso há ~4 meses).
 * Tudo é marcado com `seed: true` para que `scripts/clean.ts` remova com segurança.
 *
 * Uso:  npm run seed
 *
 * Requer que o login por E-mail/Senha esteja habilitado no Firebase Auth.
 * Credenciais padrão: as mesmas pré-preenchidas na tela de login.
 */
import 'dotenv/config'; // carrega SEED_EMAIL/SEED_PASSWORD do .env
import { initializeApp } from 'firebase/app';
import { getAuth, signInWithEmailAndPassword, createUserWithEmailAndPassword } from 'firebase/auth';
import {
  getFirestore, collection, doc, writeBatch, setDoc, serverTimestamp,
} from 'firebase/firestore';
import firebaseConfig from '../firebase-applet-config.json';
import { quoteToRevenueTransactions } from '../src/lib/orders';

const EMAIL = process.env.SEED_EMAIL ?? '';
const PASSWORD = process.env.SEED_PASSWORD ?? '';
if (!EMAIL || !PASSWORD) {
  console.error('❌ Defina SEED_EMAIL e SEED_PASSWORD no ambiente. Ex.: SEED_EMAIL=voce@dominio.com SEED_PASSWORD=suaSenha npm run seed');
  process.exit(1);
}

const app = initializeApp(firebaseConfig as any);
const auth = getAuth(app);
const db = getFirestore(app, (firebaseConfig as any).firestoreDatabaseId);

// ---------- utilidades ----------
const pad = (n: number) => String(n).padStart(2, '0');
const ymd = (d: Date) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const rand = (min: number, max: number) => Math.round((Math.random() * (max - min) + min) * 100) / 100;
const pick = <T,>(arr: T[]) => arr[Math.floor(Math.random() * arr.length)];

const today = new Date();
// 12 meses atrás (início do mês) — simula ~1 ano de uso.
const startMonth = new Date(today.getFullYear(), today.getMonth() - 12, 1);

type Doc = { path: string; data: any };
const docs: Doc[] = [];
const add = (path: string, data: any) => {
  const ref = doc(collection(db, path));
  docs.push({ path, data: { ...data, seed: true, id: ref.id, _ref: ref } });
  return ref.id;
};

async function commitAll() {
  // grava em blocos de 400 (limite do writeBatch é 500)
  for (let i = 0; i < docs.length; i += 400) {
    const batch = writeBatch(db);
    for (const d of docs.slice(i, i + 400)) {
      const { _ref, id, ...rest } = d.data;
      void id;
      batch.set(_ref, rest);
    }
    await batch.commit();
    console.log(`  gravados ${Math.min(i + 400, docs.length)}/${docs.length}`);
  }
}

async function seedEntity(uid: string, email: string, name: string, type: 'PF' | 'PJ') {
  const entityRef = doc(collection(db, 'entities'));
  const entityId = entityRef.id;
  const base = { entityId, ownerUid: uid, collaboratorsEmails: [], seed: true };

  // Cria a entidade ANTES das subcoleções (as regras checam que a entidade existe).
  await setDoc(entityRef, {
    name, type, ownerUid: uid, collaborators: [], collaboratorsEmails: [],
    collaboratorsAdminEmails: [], createdAt: serverTimestamp(), seed: true,
  });

  const P = (sub: string) => `entities/${entityId}/${sub}`;

  // ---------- contas ----------
  const contaCorrente = add(P('bank_accounts'), { ...base, bankName: type === 'PJ' ? 'Nubank PJ' : 'Nubank', type: 'corrente', initialBalance: type === 'PJ' ? 18000 : 6000, currentBalance: type === 'PJ' ? 18000 : 6000, createdAt: serverTimestamp() });
  const reserva = add(P('bank_accounts'), { ...base, bankName: 'Reserva de Emergência', type: 'reserva', initialBalance: type === 'PJ' ? 30000 : 12000, currentBalance: type === 'PJ' ? 30000 : 12000, createdAt: serverTimestamp() });
  add(P('bank_accounts'), { ...base, bankName: 'Caixa', type: 'caixa', initialBalance: 500, currentBalance: 500, createdAt: serverTimestamp() });

  // ---------- cartões ----------
  const cartao1 = add(P('credit_cards'), { ...base, name: type === 'PJ' ? 'Nubank PJ' : 'Nubank', brand: 'Mastercard', limit: type === 'PJ' ? 20000 : 8000, closingDay: 20, dueDay: 27, createdAt: serverTimestamp() });
  const cartao2 = add(P('credit_cards'), { ...base, name: 'Inter', brand: 'Visa', limit: 10000, closingDay: 5, dueDay: 12, createdAt: serverTimestamp() });

  // ---------- clientes (só PJ) ----------
  const clientIds: { id: string; name: string; mensal: number }[] = [];
  if (type === 'PJ') {
    const clientes = [
      { name: 'Padaria Pão Quente', mensal: 1500 },
      { name: 'Academia BodyFit', mensal: 2200 },
      { name: 'Clínica Sorriso', mensal: 1800 },
      { name: 'Auto Center Veloz', mensal: 1200 },
      { name: 'Boutique Elegance', mensal: 2500 },
      { name: 'Restaurante Sabor & Arte', mensal: 1900 },
      { name: 'Pet Shop Amigo Fiel', mensal: 900 },
      { name: 'Imobiliária Lar Ideal', mensal: 3000 },
    ];
    clientes.forEach((c, idx) => {
      const id = add(P('clients'), {
        ...base, name: c.name,
        cnpj: `${pad(10 + idx)}.${pad(100 + idx).slice(0,3)}.000/0001-${pad(idx + 10)}`,
        responsibleName: pick(['Ana', 'Carlos', 'Mariana', 'João', 'Patrícia']),
        email: `contato@${c.name.toLowerCase().replace(/[^a-z]/g, '')}.com.br`,
        address: 'Rua das Flores, ' + (100 + idx),
        credentials: { instagram: '@' + c.name.toLowerCase().replace(/[^a-z]/g, ''), facebook: '', googleAds: '', wordpress: '' },
        contracts: [{ id: 'c' + idx, name: 'Contrato Mensal', url: 'https://drive.google.com', signedAt: ymd(startMonth), value: c.mensal, status: 'active', expirationDate: ymd(new Date(today.getFullYear() + 1, today.getMonth(), 1)) }],
        createdAt: serverTimestamp(),
      });
      clientIds.push({ id, name: c.name, mensal: c.mensal });
    });

    // ---------- fornecedores (genéricos + específicos) ----------
    [
      { name: 'Contabilidade Exata', category: 'Contador' },
      { name: 'Adobe Creative Cloud', category: 'Software' },
      { name: 'Meta (Facebook/Instagram Ads)', category: 'Mídia' },
      { name: 'Google Ads', category: 'Mídia' },
      { name: 'Freelancer Designer', category: 'Funcionário' },
      { name: 'Freelancer Redator', category: 'Funcionário' },
      { name: 'Hostinger (Hospedagem)', category: 'Hospedagem' },
      { name: 'Canva Pro', category: 'Software' },
      { name: 'Banco do Brasil', category: 'Banco' },
      { name: 'Cartório / Despachante', category: 'Serviços' },
    ].forEach((s, i) => add(P('suppliers'), { ...base, name: s.name, category: s.category, cnpjOrCpf: '', email: '', phone: '', pixKey: `pix${i}@${s.name.toLowerCase().replace(/[^a-z]/g, '')}.com`, createdAt: serverTimestamp() }));

    // ---------- serviços e planos (o que a agência realmente vende) ----------
    const servicos = [
      { name: 'Gestão de Redes Sociais', basePrice: 1200, category: 'Social Media' },
      { name: 'Tráfego Pago — Meta Ads', basePrice: 1500, category: 'Tráfego' },
      { name: 'Tráfego Pago — Google Ads', basePrice: 1500, category: 'Tráfego' },
      { name: 'Criação de Site Institucional', basePrice: 3500, category: 'Sites' },
      { name: 'Site E-commerce', basePrice: 6500, category: 'Sites' },
      { name: 'Landing Page', basePrice: 1800, category: 'Sites' },
      { name: 'Identidade Visual / Logomarca', basePrice: 2800, category: 'Design' },
    ];
    const servIds = servicos.map(s => add(P('services'), { ...base, name: s.name, description: '', basePrice: s.basePrice, category: s.category, createdAt: serverTimestamp() }));
    add(P('plans'), { ...base, name: 'Presença Digital', description: 'Redes Sociais + Tráfego Meta', price: 2500, billingCycle: 'monthly', services: [servIds[0], servIds[1]], createdAt: serverTimestamp() });
    add(P('plans'), { ...base, name: 'Aceleração Completa', description: 'Redes + Meta + Google + Site', price: 4900, billingCycle: 'monthly', services: [servIds[0], servIds[1], servIds[2], servIds[3]], createdAt: serverTimestamp() });

    // ---------- produtos digitais ----------
    [
      { name: 'E-book: Marketing para Pequenos Negócios', basePrice: 47, costPrice: 5 },
      { name: 'Pacote de Templates para Social Media', basePrice: 97, costPrice: 10 },
      { name: 'Presets de Edição', basePrice: 37, costPrice: 3 },
      { name: 'Mini-curso de Tráfego Pago', basePrice: 197, costPrice: 20 },
    ].forEach(p => add(P('products'), { ...base, name: p.name, description: 'Produto digital', basePrice: p.basePrice, costPrice: p.costPrice, category: 'Produto', active: true, createdAt: serverTimestamp() }));

    // ---------- GRÁFICA/3D: categorias, produtos c/ variação, insumos, estoque, precificação, meta, vendas, pedidos ----------
    const prodCats = [
      { id: 'pc-cartoes', name: 'Cartões', color: '#8b5cf6' },
      { id: 'pc-banners', name: 'Banners', color: '#ef4444' },
      { id: 'pc-adesivos', name: 'Adesivos', color: '#f59e0b' },
      { id: 'pc-pecas-3d', name: 'Peças 3D', color: '#10b981' },
    ];
    docs.push({ path: P('config'), data: { _ref: doc(db, P('config'), 'product_categories'), seed: true, ownerUid: uid, collaboratorsEmails: [], items: prodCats, updatedAt: serverTimestamp() } });
    docs.push({ path: P('config'), data: { _ref: doc(db, P('config'), 'pricing'), seed: true, ownerUid: uid, collaboratorsEmails: [], targetMargin: 60, updatedAt: serverTimestamp() } });
    docs.push({ path: P('config'), data: { _ref: doc(db, P('config'), 'sales_goal'), seed: true, ownerUid: uid, collaboratorsEmails: [], monthlyGoal: 8000, updatedAt: serverTimestamp() } });

    // Produtos físicos (gráfica rápida + impressão 3D)
    const pCartao = add(P('products'), { ...base, name: 'Cartão de Visita', kind: 'grafica', itemType: 'product', category: 'Cartões', unit: 'cento', basePrice: 90, costPrice: 35, active: true, trackStock: false, variations: [{ id: 'v1', name: '300un — Simples', price: 90, cost: 35 }, { id: 'v2', name: '300un — Verniz', price: 140, cost: 55 }, { id: 'v3', name: '1000un — Simples', price: 240, cost: 95 }], createdAt: serverTimestamp() });
    const pBanner = add(P('products'), { ...base, name: 'Banner em Lona', kind: 'grafica', itemType: 'product', category: 'Banners', unit: 'm²', basePrice: 60, costPrice: 25, active: true, trackStock: false, variations: [], createdAt: serverTimestamp() });
    const pAdesivo = add(P('products'), { ...base, name: 'Adesivo Vinil', kind: 'grafica', itemType: 'product', category: 'Adesivos', unit: 'm²', basePrice: 80, costPrice: 30, active: true, trackStock: false, variations: [], createdAt: serverTimestamp() });
    const pChaveiro = add(P('products'), { ...base, name: 'Chaveiro 3D', kind: '3d', itemType: 'product', category: 'Peças 3D', unit: 'un', basePrice: 25, costPrice: 8, active: true, trackStock: true, stock: 40, minStock: 10, variations: [], createdAt: serverTimestamp() });
    add(P('products'), { ...base, name: 'Suporte de Celular 3D', kind: '3d', itemType: 'product', category: 'Peças 3D', unit: 'un', basePrice: 45, costPrice: 15, active: true, trackStock: true, stock: 6, minStock: 10, variations: [], createdAt: serverTimestamp() }); // estoque baixo (alerta)
    const pTrofeu = add(P('products'), { ...base, name: 'Troféu 3D Personalizado', kind: '3d', itemType: 'product', category: 'Peças 3D', unit: 'un', basePrice: 120, costPrice: 40, active: true, trackStock: true, stock: 15, minStock: 5, variations: [], createdAt: serverTimestamp() });

    // Insumos
    const supFil = add(P('products'), { ...base, name: 'Filamento PLA Branco', itemType: 'supply', category: 'Filamento', unit: 'kg', costPrice: 90, basePrice: 0, active: true, trackStock: true, stock: 3, minStock: 2, createdAt: serverTimestamp() });
    add(P('products'), { ...base, name: 'Filamento PLA Preto', itemType: 'supply', category: 'Filamento', unit: 'kg', costPrice: 90, basePrice: 0, active: true, trackStock: true, stock: 1, minStock: 2, createdAt: serverTimestamp() }); // baixo
    add(P('products'), { ...base, name: 'Papel Couché 300g', itemType: 'supply', category: 'Papel', unit: 'folha', costPrice: 0.5, basePrice: 0, active: true, trackStock: true, stock: 800, minStock: 200, createdAt: serverTimestamp() });
    add(P('products'), { ...base, name: 'Lona 440g', itemType: 'supply', category: 'Lona', unit: 'm²', costPrice: 12, basePrice: 0, active: true, trackStock: true, stock: 25, minStock: 10, createdAt: serverTimestamp() });

    // Movimentações de estoque
    const nowIso = new Date().toISOString();
    docs.push({ path: P('config'), data: { _ref: doc(db, P('config'), 'stock_movements'), seed: true, ownerUid: uid, collaboratorsEmails: [], items: [
      { id: 'mv1', itemType: 'supply', itemId: supFil, itemName: 'Filamento PLA Branco', delta: 5, balanceAfter: 3, reason: 'compra', note: 'Compra fornecedor', at: nowIso },
      { id: 'mv2', itemType: 'product', itemId: pChaveiro, itemName: 'Chaveiro 3D', delta: -10, balanceAfter: 40, reason: 'venda', at: nowIso },
    ], updatedAt: serverTimestamp() } });

    // Vendas (viram receita + têm saleItems) — mês atual
    const vendasDefs = [
      { prod: pChaveiro, name: 'Chaveiro 3D', qty: 10, price: 25, dayOffset: -2, done: true },
      { prod: pTrofeu, name: 'Troféu 3D Personalizado', qty: 2, price: 120, dayOffset: -5, done: true },
      { prod: pCartao, name: 'Cartão de Visita', varName: '300un — Verniz', qty: 1, price: 140, dayOffset: -8, done: true },
      { prod: pBanner, name: 'Banner em Lona', qty: 3, price: 60, dayOffset: -1, done: false },
    ];
    vendasDefs.forEach((v) => {
      const d = new Date(today.getFullYear(), today.getMonth(), Math.max(1, today.getDate() + v.dayOffset));
      const total = v.qty * v.price;
      add(`entities/${entityId}/transactions`, {
        ...base, description: `Venda: ${v.name}${v.varName ? ` (${v.varName})` : ''}`, amount: total, type: 'income',
        date: ymd(d), categoryId: 'venda', accountId: v.done ? contaCorrente : null, status: v.done ? 'completed' : 'pending',
        paidAt: v.done ? ymd(d) : null, isSale: true,
        saleItems: [{ productId: v.prod, name: v.name, variationName: v.varName, qty: v.qty, unitPrice: v.price }],
        paymentType: 'pix', createdAt: serverTimestamp(),
      });
    });

    // Pedidos em vários estágios do Kanban
    const pedDefs: { cli: { id: string; name: string }; items: any[]; status: string; paid?: boolean }[] = [
      { cli: clientIds[0], items: [{ productId: pBanner, name: 'Banner em Lona', qty: 2, unitPrice: 60 }], status: 'aberto' },
      { cli: clientIds[1], items: [{ productId: pCartao, name: 'Cartão de Visita', variationName: '1000un — Simples', qty: 1, unitPrice: 240 }], status: 'arte' },
      { cli: clientIds[2], items: [{ productId: pAdesivo, name: 'Adesivo Vinil', qty: 5, unitPrice: 80 }], status: 'producao' },
      { cli: clientIds[3], items: [{ productId: pTrofeu, name: 'Troféu 3D Personalizado', qty: 3, unitPrice: 120 }], status: 'aguardando' },
      { cli: clientIds[4], items: [{ productId: pChaveiro, name: 'Chaveiro 3D', qty: 20, unitPrice: 25 }], status: 'entregue', paid: true },
    ];
    pedDefs.forEach((pd, i) => {
      const total = pd.items.reduce((a, it) => a + it.qty * it.unitPrice, 0);
      const due = new Date(today.getFullYear(), today.getMonth(), today.getDate() + 3 + i);
      add(P('quotes'), { ...base, docType: 'pedido', clientId: pd.cli.id, clientName: pd.cli.name, items: pd.items, total, status: pd.status, paid: !!pd.paid, dueDate: ymd(due), note: 'Pedido de simulação', createdAt: serverTimestamp() });
    });

    // ---------- orçamentos (~28 ao longo do ano, vários status) ----------
    const statuses = ['draft', 'sent', 'approved', 'rejected', 'converted', 'sent', 'approved', 'converted'];
    const formas = ['PIX', 'Boleto', 'Cartão de Crédito', 'Transferência'];
    for (let i = 0; i < 28; i++) {
      const cli = clientIds[i % clientIds.length];
      const sv = servicos[i % servicos.length];
      const total = sv.basePrice + (i % 3) * 250;
      const parcelas = i % 5 === 0 ? 3 : 1;
      const recorrente = i % 7 === 0;
      const qDate = new Date(today.getFullYear(), today.getMonth() - (11 - (i % 12)), 3 + (i % 24));
      add(P('quotes'), {
        ...base, quoteNumber: `ORC-SIM-${1000 + i}`, clientId: cli.id, clientName: cli.name,
        date: ymd(qDate),
        validUntil: ymd(new Date(qDate.getFullYear(), qDate.getMonth(), qDate.getDate() + 15)),
        items: [{ id: 'i1', description: sv.name, quantity: 1, unitPrice: total, discount: 0, total, type: 'service' }],
        subtotal: total, discountTotal: 0, total,
        paymentMethod: pick(formas), installments: parcelas, status: statuses[i % statuses.length],
        notes: 'Orçamento de simulação',
        recurrenceConfig: { enabled: recorrente, frequency: 'monthly', startDate: ymd(qDate) },
        createdAt: serverTimestamp(),
      });
    }

    // ---------- OS convertidas (orçamento aprovado -> receita a receber) ----------
    const osDefs = [
      { cli: clientIds[0], total: 3500, installments: 1, desc: 'Criação de Site' },
      { cli: clientIds[1], total: 2800, installments: 3, desc: 'Identidade Visual (3x)' },
    ];
    osDefs.forEach((os, i) => {
      const qref = doc(collection(db, P('quotes')));
      const qid = qref.id;
      const qDate = new Date(today.getFullYear(), today.getMonth() - 3, 10 + i);
      const quoteData: any = {
        entityId, ownerUid: uid, collaboratorsEmails: [], seed: true,
        quoteNumber: `ORC-OS-${2000 + i}`, clientId: os.cli.id, clientName: os.cli.name,
        date: ymd(qDate), validUntil: ymd(qDate),
        items: [{ id: 'i1', description: os.desc, quantity: 1, unitPrice: os.total, discount: 0, total: os.total, type: 'service' }],
        subtotal: os.total, discountTotal: 0, total: os.total,
        paymentMethod: 'PIX', installments: os.installments, status: 'converted',
        createdAt: serverTimestamp(),
      };
      docs.push({ path: P('quotes'), data: { ...quoteData, id: qid, _ref: qref } });
      // Gera as receitas a receber pelo MESMO motor da tela (sourceQuoteId = qid).
      const drafts = quoteToRevenueTransactions({ id: qid, ...quoteData }, { id: entityId, ownerUid: uid, collaboratorsEmails: [] });
      drafts.forEach(d => add(`entities/${entityId}/transactions`, { ...d, createdAt: serverTimestamp() }));
    });

    // ---------- orçamento/metas ----------
    docs.push({ path: P('config'), data: {
      _ref: doc(db, P('config'), 'budgets'),
      seed: true, ownerUid: uid, collaboratorsEmails: [],
      moradia: 3000, transporte: 800, alimentacao: 1500, servicos: 2000, lazer: 600, outros: 1000,
      monthly_balance_goal: 8000,
    }});
  }

  // ---------- transações: 4 meses ----------
  const despFixas = [
    { desc: 'Aluguel do escritório', cat: 'moradia', val: type === 'PJ' ? 2500 : 1400, card: false },
    { desc: 'Internet Fibra', cat: 'moradia', val: 200, card: false },
    { desc: 'Energia elétrica', cat: 'moradia', val: () => rand(180, 350), card: false },
    { desc: 'Assinatura Adobe', cat: 'servicos', val: 320, card: true },
    { desc: 'Contador', cat: 'servicos', val: type === 'PJ' ? 600 : 0, card: false },
  ];
  const despVar = [
    { desc: 'Mercado', cat: 'alimentacao', min: 120, max: 600, card: true },
    { desc: 'Posto de gasolina', cat: 'transporte', min: 100, max: 300, card: false },
    { desc: 'Almoço cliente', cat: 'alimentacao', min: 40, max: 150, card: true },
    { desc: 'Uber', cat: 'transporte', min: 18, max: 70, card: false },
    { desc: 'Farmácia', cat: 'saude', min: 30, max: 200, card: true },
  ];

  for (let m = 0; m <= 12; m++) {
    const monthDate = new Date(startMonth.getFullYear(), startMonth.getMonth() + m, 1);
    const isFuture = monthDate.getMonth() === today.getMonth() && monthDate.getFullYear() === today.getFullYear();
    const completed = !isFuture; // mês corrente deixa alguns pendentes

    // receitas de clientes (PJ) — mensalidades
    if (type === 'PJ') {
      clientIds.forEach((cli, idx) => {
        const day = 5 + (idx % 20);
        const date = ymd(new Date(monthDate.getFullYear(), monthDate.getMonth(), Math.min(day, 28)));
        add(`entities/${entityId}/transactions`, {
          ...base, description: `Mensalidade ${cli.name}`, amount: cli.mensal, type: 'income',
          date, categoryId: 'venda', accountId: contaCorrente, clientId: cli.id, clientName: cli.name,
          status: completed ? 'completed' : (idx % 2 === 0 ? 'completed' : 'pending'),
          paymentType: 'pix', createdAt: serverTimestamp(),
        });
      });
    } else {
      // PF: salário
      add(`entities/${entityId}/transactions`, { ...base, description: 'Salário', amount: 7000, type: 'income', date: ymd(new Date(monthDate.getFullYear(), monthDate.getMonth(), 5)), categoryId: 'salario', accountId: contaCorrente, status: completed ? 'completed' : 'pending', paymentType: 'transferencia', createdAt: serverTimestamp() });
    }

    // despesas fixas
    despFixas.forEach((d, i) => {
      const val = typeof d.val === 'function' ? (d.val as any)() : d.val;
      if (!val) return;
      add(`entities/${entityId}/transactions`, {
        ...base, description: d.desc, amount: val, type: 'expense',
        date: ymd(new Date(monthDate.getFullYear(), monthDate.getMonth(), 10 + i)),
        categoryId: d.cat, accountId: d.card ? null : contaCorrente, cardId: d.card ? cartao1 : null,
        status: completed ? 'completed' : 'pending', paymentType: d.card ? 'credito' : 'boleto', createdAt: serverTimestamp(),
      });
    });

    // salários de funcionários (PJ)
    if (type === 'PJ') {
      ['Salário Designer', 'Salário Social Media'].forEach((nome, i) => add(`entities/${entityId}/transactions`, {
        ...base, description: nome, amount: 3000, type: 'expense', date: ymd(new Date(monthDate.getFullYear(), monthDate.getMonth(), 5)),
        categoryId: 'servicos', accountId: contaCorrente, status: completed ? 'completed' : 'pending', paymentType: 'transferencia', createdAt: serverTimestamp(),
      }));
    }

    // despesas variáveis (algumas por mês)
    const n = 4 + Math.floor(Math.random() * 4);
    for (let i = 0; i < n; i++) {
      const d = pick(despVar);
      const day = 1 + Math.floor(Math.random() * 27);
      add(`entities/${entityId}/transactions`, {
        ...base, description: d.desc, amount: rand(d.min, d.max), type: 'expense',
        date: ymd(new Date(monthDate.getFullYear(), monthDate.getMonth(), day)),
        categoryId: d.cat, accountId: d.card ? null : contaCorrente, cardId: d.card ? pick([cartao1, cartao2]) : null,
        status: completed ? 'completed' : (Math.random() > 0.5 ? 'completed' : 'pending'),
        paymentType: d.card ? 'credito' : pick(['pix', 'debito', 'dinheiro']), createdAt: serverTimestamp(),
      });
    }
  }

  // parcelamento: equipamento 10x começando 2 meses atrás
  const totalEquip = 4500;
  const parcelas = 10;
  const base10 = Math.round((totalEquip / parcelas) * 100) / 100;
  for (let i = 1; i <= parcelas; i++) {
    const d = new Date(startMonth.getFullYear(), startMonth.getMonth() + 2 + (i - 1), 15);
    const past = d <= today;
    add(`entities/${entityId}/transactions`, {
      ...base, description: `Notebook Dell (${i}/${parcelas})`, amount: i === parcelas ? Math.round((totalEquip - base10 * (parcelas - 1)) * 100) / 100 : base10,
      type: 'expense', date: ymd(d), categoryId: 'outros', cardId: cartao1, accountId: null,
      status: past ? 'completed' : 'pending', installmentNumber: i, totalInstallments: parcelas, installmentGroupId: `inst-${entityId}`,
      paymentType: 'credito', createdAt: serverTimestamp(),
    });
  }

  // dívida (financiamento)
  add(`entities/${entityId}/debts`, {
    ...base, name: type === 'PJ' ? 'Financiamento Equipamentos' : 'Financiamento do Carro',
    totalAmount: type === 'PJ' ? 30000 : 45000, remainingAmount: type === 'PJ' ? 18000 : 32000,
    interestRate: 1.5, monthlyPayment: type === 'PJ' ? 1200 : 1500, dueDate: 10,
    alerts: { dueDateEnabled: true, dueDateDaysBefore: 5, thresholdEnabled: false, thresholdValue: 0 },
    createdAt: serverTimestamp(),
  });

  // conta a pagar pendente vencendo em breve
  add(`entities/${entityId}/transactions`, {
    ...base, description: 'Imposto DAS', amount: type === 'PJ' ? 850 : 0 || 850, type: 'expense',
    date: ymd(new Date(today.getFullYear(), today.getMonth(), Math.min(today.getDate() + 3, 28))),
    categoryId: 'outros', accountId: contaCorrente, status: 'pending', paymentType: 'boleto', createdAt: serverTimestamp(),
  });

  return entityId;
}

async function main() {
  console.log('🔑 Autenticando...');
  let uid: string;
  try {
    const cred = await signInWithEmailAndPassword(auth, EMAIL, PASSWORD);
    uid = cred.user.uid;
    console.log('   login OK:', EMAIL);
  } catch (e: any) {
    if (e.code === 'auth/invalid-credential' || e.code === 'auth/user-not-found') {
      console.log('   conta não existe, criando...');
      const cred = await createUserWithEmailAndPassword(auth, EMAIL, PASSWORD);
      uid = cred.user.uid;
      console.log('   conta criada:', EMAIL);
    } else if (e.code === 'auth/operation-not-allowed') {
      console.error('\n❌ Login por E-mail/Senha NÃO está habilitado no Firebase Console.');
      console.error('   Ative em: Authentication > Sign-in method > Email/Password, e rode de novo.');
      process.exit(1);
    } else {
      throw e;
    }
  }

  console.log('🌱 Gerando dados de simulação...');
  const e1 = await seedEntity(uid, EMAIL, 'Agência CIIS [SIMULAÇÃO]', 'PJ');
  const e2 = await seedEntity(uid, EMAIL, 'Lucas Pessoal [SIMULAÇÃO]', 'PF');

  console.log(`💾 Gravando ${docs.length} documentos...`);
  await commitAll();

  console.log('\n✅ Simulação criada com sucesso!');
  console.log(`   Entidades: ${e1} (PJ), ${e2} (PF)`);
  console.log('   Tudo marcado com seed:true. Para remover: npm run seed:clean');
  process.exit(0);
}

main().catch((err) => { console.error('Erro no seed:', err); process.exit(1); });
