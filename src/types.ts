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
}

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

export interface Service {
  id: string;
  name: string;
  description?: string;
  basePrice: number;
  category: string;
  entityId: string;
  createdAt: any;
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
  };
}
