import { describe, it, expect } from 'vitest';
import { extractEmail } from './sso-routes';

describe('extractEmail', () => {
  it('devolve null quando o payload nao tem email', () => {
    expect(extractEmail({ sub: '123' })).toBeNull();
  });

  it('devolve null quando o token expirou', () => {
    const ontem = Math.floor(Date.now() / 1000) - 3600;
    expect(extractEmail({ email: 'a@b.com', exp: ontem })).toBeNull();
  });

  it('devolve o email quando o token e valido', () => {
    const amanha = Math.floor(Date.now() / 1000) + 3600;
    expect(extractEmail({ email: 'a@b.com', exp: amanha })).toBe('a@b.com');
  });

  it('aceita token sem exp (a validade ja foi checada na assinatura)', () => {
    expect(extractEmail({ email: 'a@b.com' })).toBe('a@b.com');
  });

  it('normaliza o email para minusculas', () => {
    expect(extractEmail({ email: 'Lucas@Exemplo.COM' })).toBe('lucas@exemplo.com');
  });
});
