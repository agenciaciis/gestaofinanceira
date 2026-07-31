export type EntityType = 'PF' | 'PJ';

export interface User {
  uid: string;
  email: string;
  displayName?: string;
  photoURL?: string;
  role?: 'admin' | 'user';
}

export interface WhatsAppConfig {
  apiUrl: string;
  apiKey: string;
  instanceName: string;
  phoneNumber: string; // Target number for notifications
  enabled: boolean;
}

export interface Collaborator {
  email: string;
  role: 'admin' | 'viewer';
  addedAt: any;
}

export interface Entity {
  id: string;
  name: string;
  type: EntityType;
  ownerUid: string;
  whatsappConfig?: WhatsAppConfig;
  collaborators?: Collaborator[];
  collaboratorsEmails?: string[]; // For easier querying (todos os colaboradores)
  collaboratorsAdminEmails?: string[]; // Apenas colaboradores com papel 'admin' (escrita)
}

export interface BankAccount {
  id: string;
  bankName: string;
  type: 'corrente' | 'poupanca' | 'investimento' | 'caixa' | 'reserva';
  initialBalance: number;
  currentBalance: number;
  entityId: string;
  /** Cor da marca (hex). Sem valor = visual padrão. */
  color?: string;
}

export interface Debt {
  id: string;
  name: string;
  totalAmount: number;
  remainingAmount: number;
  interestRate: number; // monthly %
  monthlyPayment: number;
  dueDate: number; // day of month
  entityId: string;
  createdAt: any;
  alerts?: {
    dueDateEnabled: boolean;
    dueDateDaysBefore: number;
    thresholdEnabled: boolean;
    thresholdValue: number;
  };
}

export interface CreditCard {
  id: string;
  name: string;
  brand: string;
  limit: number;
  dueDay: number;
  closingDay: number;
  entityId: string;
  /** Cor da marca (hex). Sem valor = visual escuro padrão. */
  color?: string;
}

export interface Transaction {
  id: string;
  description: string;
  amount: number;
  type: 'income' | 'expense' | 'transfer';
  date: string;
  categoryId: string;
  accountId?: string;
  toAccountId?: string; // For transfers
  cardId?: string;
  status: 'pending' | 'completed' | 'cancelled';
  entityId: string;
  paidAt?: string; // data em que foi efetivamente pago (YYYY-MM-DD)
  // Forma de pagamento (além de conta/cartão): pix, boleto, dinheiro, transferência...
  paymentType?: 'pix' | 'boleto' | 'dinheiro' | 'transferencia' | 'debito' | 'credito' | 'outro';
  // Vínculo opcional com um cliente cadastrado (para receitas/recebimentos)
  clientId?: string;
  clientName?: string;
  // Installment fields
  installmentNumber?: number;
  totalInstallments?: number;
  installmentGroupId?: string;
  isRecurring?: boolean;
  recurringPeriod?: 'monthly' | 'weekly' | 'yearly';
  recurringGroupId?: string;
  // --- Movimento entre entidades (PF <-> PJ) ---
  // As duas pontas (saída na origem, entrada no destino) compartilham o mesmo
  // crossEntityGroupId. No consolidado elas se anulam: não é receita nova,
  // é o mesmo dinheiro mudando de bolso.
  crossEntityGroupId?: string;
  crossEntityKind?: CrossEntityKind;
  counterpartEntityId?: string;
  /** Despesa pessoal paga pela empresa — o que o contador precisa enxergar. */
  personalExpense?: boolean;
  /**
   * Valor PREVISTO/orçado deste lançamento. O campo `amount` continua sendo o
   * valor real pago — assim nada do que já foi lançado muda de significado.
   */
  plannedAmount?: number;
  /** Detalhamento livre abaixo da categoria ("aluguel", "energia"). */
  subcategory?: string;
  /** Conferido contra o extrato do banco. */
  reconciled?: boolean;
  /**
   * Etiquetas livres, cruzando categorias ("reforma 2026", "cliente X").
   * Ideia trazida da planilha antiga: categoria classifica, etiqueta agrupa.
   */
  tags?: string[];
  /** Vínculo com uma meta/caixinha. */
  goalId?: string;
  /** Orçamento que originou este lançamento (OS convertida). Idempotência + histórico. */
  sourceQuoteId?: string;
  /**
   * Direção EXPLÍCITA do movimento na caixinha. Necessário porque guardar e
   * resgatar são os dois 'transfer': o tipo do lançamento não distingue.
   * Ausente = infere pelo tipo (compatível com lançamentos antigos).
   */
  goalDirection?: 'in' | 'out';
}

/** Meta de poupança — praia, carro, reserva. O guardado é derivado dos lançamentos. */
export interface Goal {
  id: string;
  name: string;
  targetAmount: number;
  /** Prazo opcional 'YYYY-MM-DD'. Sem prazo, não há ritmo exigido. */
  deadline?: string;
  description?: string;
  color?: string;
  entityId: string;
  createdAt: any;
  archived?: boolean;
}

/** Score de crédito informado pelo usuário (Serasa, SPC, Boa Vista). */
export interface CreditScoreEntry {
  id: string;
  provider: 'serasa' | 'spc' | 'boavista';
  score: number;
  date: string;
  notes?: string;
  entityId: string;
  createdAt: any;
}

export type CrossEntityKind = 'prolabore' | 'distribuicao' | 'aporte' | 'reembolso' | 'transferencia';

export const CROSS_ENTITY_KIND_LABELS: Record<CrossEntityKind, string> = {
  prolabore: 'Pró-labore',
  distribuicao: 'Distribuição de lucros',
  aporte: 'Aporte na empresa',
  reembolso: 'Reembolso',
  transferencia: 'Transferência entre contas',
};

export interface Client {
  id: string;
  name: string;
  cnpj?: string;
  responsibleName?: string;
  cpf?: string;
  email?: string;
  address?: string;
  drivePath?: string;
  credentials: {
    instagram?: string;
    facebook?: string;
    googleAds?: string;
    linkedin?: string;
    meta?: string;
    wordpress?: string;
    site?: string;
    others?: string;
  };
  entityId: string;
  createdAt: any;
  contracts?: {
    id: string;
    name: string;
    url: string;
    signedAt: any;
    value?: number;
    expirationDate?: string;
    status?: 'active' | 'inactive';
  }[];
}

export interface Supplier {
  id: string;
  name: string;
  category: string; // e.g., 'Imobiliária', 'Funcionário', 'Software', etc.
  cnpjOrCpf?: string;
  email?: string;
  phone?: string;
  pixKey?: string;
  bankInfo?: {
    bank: string;
    agency: string;
    account: string;
  };
  entityId: string;
  createdAt: any;
}

export type ServiceUnit = 'projeto' | 'hora' | 'mes' | 'diaria' | 'unidade' | 'palavra' | 'post';

export const SERVICE_UNIT_LABELS: Record<ServiceUnit, string> = {
  projeto: 'por projeto',
  hora: 'por hora',
  mes: 'por mês',
  diaria: 'por diária',
  unidade: 'por unidade',
  palavra: 'por palavra',
  post: 'por post',
};

export interface Service {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  category: string;
  entityId: string;
  createdAt: any;
  /** Código interno para referência em orçamento e contrato. */
  code?: string;
  /** Unidade de cobrança — muda como o preço é lido no orçamento. */
  unit?: ServiceUnit;
  /** Custo de execução (mão de obra, ferramentas, terceiros). Base da margem. */
  costPrice?: number;
  /** Horas estimadas de execução. */
  estimatedHours?: number;
  /** Prazo de entrega em dias úteis. */
  deliveryDays?: number;
  /** O que está incluso — vira o detalhamento do orçamento. */
  scope?: string;
  /** O que NÃO está incluso — evita discussão depois. */
  notIncluded?: string;
  /** Condições, observações, pré-requisitos do cliente. */
  observations?: string;
  active?: boolean;
}

export interface Plan {
  id: string;
  name: string;
  description?: string;
  price: number;
  billingCycle: 'monthly' | 'quarterly' | 'yearly';
  services: string[]; // IDs of services included
  entityId: string;
  createdAt: any;
}

export interface QuoteItem {
  id: string;
  description: string;
  quantity: number;
  unitPrice: number;
  discount: number;
  total: number;
  type: 'service' | 'product' | 'plan';
  referenceId?: string; // ID of the service or plan
}

export interface Quote {
  id: string;
  quoteNumber: string;
  clientId: string;
  clientName: string; // Denormalized for easy display
  date: string;
  validUntil: string;
  items: QuoteItem[];
  subtotal: number;
  discountTotal: number;
  total: number;
  paymentMethod: string;
  installments: number;
  status: 'draft' | 'sent' | 'approved' | 'rejected' | 'converted';
  notes?: string;
  entityId: string;
  createdAt: any;
  recurrenceConfig?: {
    enabled: boolean;
    frequency: 'monthly' | 'weekly' | 'yearly';
    startDate: string;
    /** Nº de cobranças da recorrência. 0 = por tempo indeterminado. */
    count?: number;
  };
}
