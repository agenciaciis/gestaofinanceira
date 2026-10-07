/**
 * Score de saúde financeira.
 *
 * O cálculo antigo eram cinco degraus fixos em cima de saldo÷dívida: quem
 * tinha saldo alto e renda comprometida até o pescoço tirava nota boa. Aqui a
 * nota é a soma de quatro partes mensuráveis, e cada parte é exibível — o
 * usuário precisa saber POR QUE tirou a nota, senão o número não muda nada.
 */
import { round2 } from './finance';

export interface HealthInput {
  /** Receita média mensal. */
  monthlyIncome: number;
  /** Despesa média mensal. */
  monthlyExpense: number;
  /** Soma das parcelas de dívida por mês. */
  monthlyDebtPayment: number;
  /** Tudo que se deve hoje (as três fontes). */
  totalDebt: number;
  /** Saldo realizado nas contas. */
  balance: number;
  /** Valor de contas vencidas ainda em aberto. */
  overdueAmount: number;
}

export interface HealthPart {
  key: 'comprometimento' | 'reserva' | 'endividamento' | 'pontualidade';
  label: string;
  points: number;
  max: number;
  detail: string;
}

export interface HealthScore {
  score: number;
  label: string;
  parts: HealthPart[];
  /** `false` quando não há receita registrada — sem isso não dá para medir nada. */
  hasEnoughData: boolean;
}

/**
 * Nota linear entre dois limites, saturando nas pontas.
 * `best` é o valor que vale nota cheia, `worst` o que vale zero.
 */
function scale(value: number, best: number, worst: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  if (best === worst) return max;
  const ratio = (value - worst) / (best - worst);
  return round2(Math.min(1, Math.max(0, ratio)) * max);
}

const pct = (n: number) => `${Math.round(n * 100)}%`;

export function computeHealthScore(input: HealthInput): HealthScore {
  const income = Math.max(0, Number(input.monthlyIncome) || 0);
  const expense = Math.max(0, Number(input.monthlyExpense) || 0);
  const payment = Math.max(0, Number(input.monthlyDebtPayment) || 0);
  const debt = Math.max(0, Number(input.totalDebt) || 0);
  const balance = Number(input.balance) || 0;
  const overdue = Math.max(0, Number(input.overdueAmount) || 0);

  const hasEnoughData = income > 0;

  // 1. Comprometimento da renda (35): quanto da renda já está prometido às
  //    dívidas. Até 10% é saudável; 50% é sufoco.
  const commitment = income > 0 ? payment / income : 1;
  const comprometimento: HealthPart = {
    key: 'comprometimento',
    label: 'Comprometimento da renda',
    points: income > 0 ? scale(commitment, 0.1, 0.5, 35) : 0,
    max: 35,
    detail: income > 0
      ? `${pct(commitment)} da sua renda vai para dívida`
      : 'Sem receita registrada para medir',
  };

  // 2. Reserva (25): quantos meses de despesa o saldo cobre. 6 meses = cheio.
  const monthsCovered = expense > 0 ? Math.max(0, balance) / expense : (balance > 0 ? 6 : 0);
  const reserva: HealthPart = {
    key: 'reserva',
    label: 'Reserva de emergência',
    points: scale(monthsCovered, 6, 0, 25),
    max: 25,
    detail: expense > 0
      ? `Seu saldo cobre ${monthsCovered.toFixed(1)} ${monthsCovered === 1 ? 'mês' : 'meses'} de despesa`
      : 'Sem despesas registradas para medir',
  };

  // 3. Endividamento (25): dívida total contra uma renda anual.
  const debtToIncome = income > 0 ? debt / (income * 12) : 1;
  const endividamento: HealthPart = {
    key: 'endividamento',
    label: 'Tamanho da dívida',
    points: income > 0 ? scale(debtToIncome, 0, 1, 25) : 0,
    max: 25,
    detail: income > 0
      ? `Você deve ${debtToIncome.toFixed(2)}x o que ganha em um ano`
      : 'Sem receita registrada para medir',
  };

  // 4. Pontualidade (15): qualquer atraso relevante zera. Um mês de renda
  //    atrasado já é situação grave.
  const overdueRatio = income > 0 ? overdue / income : (overdue > 0 ? 1 : 0);
  const pontualidade: HealthPart = {
    key: 'pontualidade',
    label: 'Contas em dia',
    points: scale(overdueRatio, 0, 0.5, 15),
    max: 15,
    detail: overdue > 0 ? 'Você tem contas vencidas em aberto' : 'Nenhuma conta vencida',
  };

  const parts = [comprometimento, reserva, endividamento, pontualidade];
  const score = Math.round(parts.reduce((a, p) => a + p.points, 0));

  const label =
    score >= 85 ? 'Excelente' :
    score >= 65 ? 'Bom' :
    score >= 45 ? 'Atenção' :
    score >= 25 ? 'Ruim' : 'Crítico';

  return { score, label, parts, hasEnoughData };
}
