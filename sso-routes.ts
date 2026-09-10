import type { Express, Request, Response } from 'express';
import type admin from 'firebase-admin';
import { createRemoteJWKSet, jwtVerify } from 'jose';

interface Payload {
  email?: string;
  exp?: number;
  // Um JWT real do Supabase traz varias outras claims (sub, aud, role...).
  // Aceita-las evita que o tipo minta sobre o que chega aqui.
  [claim: string]: unknown;
}

/**
 * Regra pura: so aceita payload com e-mail e ainda dentro da validade.
 * O e-mail e normalizado para minusculas porque e a chave que liga a conta
 * do Supabase a do Firebase — divergencia de caixa quebraria o vinculo.
 */
export function extractEmail(payload: Payload): string | null {
  if (!payload?.email) return null;
  if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload.email.trim().toLowerCase();
}

export function registerSsoRoutes(
  app: Express,
  firebaseAdmin: typeof admin,
  supabaseUrl: string,
) {
  const jwks = createRemoteJWKSet(
    new URL(`${supabaseUrl}/auth/v1/.well-known/jwks.json`),
  );

  app.post('/api/sso/supabase', async (req: Request, res: Response) => {
    const token = String(req.body?.access_token ?? '');
    if (!token) return res.status(400).json({ error: 'access_token ausente' });

    let email: string | null = null;
    try {
      // Valida a ASSINATURA, nao apenas decodifica. Sem isto qualquer um
      // forjaria um token com o e-mail que quisesse e entraria como outro.
      const { payload } = await jwtVerify(token, jwks);
      email = extractEmail(payload as Payload);
    } catch {
      return res.status(401).json({ error: 'token invalido' });
    }
    if (!email) return res.status(401).json({ error: 'token sem e-mail ou expirado' });

    try {
      // Exige que o usuario ja exista aqui. Nunca criar em silencio:
      // SSO liga contas existentes, nao abre cadastro.
      const user = await firebaseAdmin.auth().getUserByEmail(email);
      const firebaseToken = await firebaseAdmin.auth().createCustomToken(user.uid);
      return res.json({ firebase_token: firebaseToken });
    } catch {
      return res.status(403).json({ error: 'usuario sem conta no financeiro' });
    }
  });
}
