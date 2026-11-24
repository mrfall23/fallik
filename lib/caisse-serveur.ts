import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import { createClient } from '@supabase/supabase-js';

// Telephone « caisse » : un jeton secret vit dans un cookie httpOnly de
// l'appareil (illisible en JavaScript). La base n'en garde que l'empreinte.
export const COOKIE_POSTE = 'fallik_poste';
// Simple indicateur (lisible cote navigateur) pour l'affichage : il ne donne
// aucun droit.
export const COOKIE_MODE_CAISSE = 'fallik_caisse';

const UN_AN = 60 * 60 * 24 * 365;

export const empreinte = (jeton: string) => createHash('sha256').update(jeton).digest('hex');
export const nouveauJeton = () => randomBytes(32).toString('base64url');

export function clientService() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Empreinte du jeton de caisse de cet appareil, ou null. */
export async function empreintePoste(): Promise<string | null> {
  const jeton = (await cookies()).get(COOKIE_POSTE)?.value;
  return jeton && jeton.length >= 32 ? empreinte(jeton) : null;
}

export async function poserCookiesCaisse(jeton: string) {
  const c = await cookies();
  const secure = process.env.NODE_ENV === 'production';
  c.set(COOKIE_POSTE, jeton, { httpOnly: true, secure, sameSite: 'lax', path: '/', maxAge: UN_AN });
  c.set(COOKIE_MODE_CAISSE, '1', { httpOnly: false, secure, sameSite: 'lax', path: '/', maxAge: UN_AN });
}

export async function retirerCookiesCaisse() {
  const c = await cookies();
  c.delete(COOKIE_POSTE);
  c.delete(COOKIE_MODE_CAISSE);
}
