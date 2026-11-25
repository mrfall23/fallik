// Lien site web (plan Pro) : outils communs aux routes publiques /api/site/*.
// Le site de la boutique envoie sa cle (en-tete « X-Fallik-Cle » ou ?cle=) ;
// le serveur n'en garde que l'empreinte. Cote base, tout passe par des RPC
// reservees a la cle secrete (site_catalogue, site_commander).
import { createHash, randomBytes } from 'node:crypto';

export const empreinte = (texte: string) => createHash('sha256').update(texte).digest('hex');

/** Nouvelle cle de site : « fk_ » + 32 caracteres aleatoires. */
export const nouvelleCle = () => `fk_${randomBytes(24).toString('base64url')}`;

export function cleDeLaRequete(request: Request): string | null {
  const cle = request.headers.get('x-fallik-cle') || new URL(request.url).searchParams.get('cle');
  return cle && /^fk_[A-Za-z0-9_-]{20,64}$/.test(cle) ? cle : null;
}

/** Empreinte de l'IP (anti-abus), jamais l'IP elle-meme. */
export function empreinteIp(request: Request): string | null {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim() || request.headers.get('x-real-ip') || '';
  return ip ? empreinte(`fallik-ip:${ip}`) : null;
}

// Le site peut etre heberge n'importe ou : CORS ouvert. La cle n'est pas un
// secret fort (elle est visible dans le site) : elle ne donne que le
// catalogue public et le droit de deposer une commande, que le gerant valide.
export const CORS: Record<string, string> = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
  'Access-Control-Allow-Headers': 'Content-Type, X-Fallik-Cle',
  'Access-Control-Max-Age': '86400',
};
