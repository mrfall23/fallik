// Bot Telegram Fallik (un seul bot pour toutes les boutiques). Cote serveur
// uniquement : le jeton ne doit jamais atteindre le navigateur.
//
// Configuration (Vercel + .env.local) : TELEGRAM_BOT_TOKEN, donne par
// @BotFather. Sans lui, rien n'est envoye et rien ne casse.
// Chaque boutique relie SA conversation (code a usage unique) : le chat_id est
// stocke dans reglages_alertes, jamais dans une variable d'environnement.
import { createHash, createHmac } from 'node:crypto';

export const telegramActif = () => !!process.env.TELEGRAM_BOT_TOKEN;

/** Secret du webhook, derive du jeton (aucune variable de plus a gerer). */
export function secretWebhook(): string {
  return createHmac('sha256', process.env.TELEGRAM_BOT_TOKEN || '').update('fallik-webhook').digest('hex');
}

export const empreinte = (code: string) => createHash('sha256').update(code).digest('hex');

async function appel(methode: string, corps: Record<string, unknown>): Promise<{ ok: boolean; result?: any; detail?: string }> {
  const jeton = process.env.TELEGRAM_BOT_TOKEN;
  if (!jeton) return { ok: false, detail: 'Telegram non configuré.' };
  try {
    const res = await fetch(`https://api.telegram.org/bot${jeton}/${methode}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(corps),
      signal: AbortSignal.timeout(8000),
    });
    const json = await res.json().catch(() => ({}));
    // Ne jamais journaliser l'URL : elle contient le jeton.
    if (!res.ok || !json.ok) return { ok: false, detail: `${res.status} ${String(json.description || '').slice(0, 200)}` };
    return { ok: true, result: json.result };
  } catch (e: any) {
    return { ok: false, detail: e?.message || 'Erreur réseau' };
  }
}

/** Envoie un message a une conversation. Ne leve jamais d'erreur. */
export async function envoyerTelegram(chatId: string, texte: string) {
  const r = await appel('sendMessage', { chat_id: chatId, text: texte.slice(0, 4000), disable_web_page_preview: true });
  if (!r.ok) console.error('[telegram] envoi en echec :', r.detail);
  return r;
}

let nomBot: string | null = null;
/** @nom du bot (lu une fois aupres de Telegram). */
export async function nomDuBot(): Promise<string | null> {
  if (nomBot) return nomBot;
  const r = await appel('getMe', {});
  nomBot = r.ok ? r.result?.username || null : null;
  return nomBot;
}

/** Branche le webhook du bot sur ce site (idempotent). */
export async function installerWebhook(origine: string) {
  return appel('setWebhook', {
    url: `${origine}/api/telegram/webhook`,
    secret_token: secretWebhook(),
    allowed_updates: ['message'],
    drop_pending_updates: false,
  });
}

/** URL publique du site (production Vercel, sinon l'origine de la requete). */
export function origineSite(request: Request): string {
  const prod = process.env.VERCEL_PROJECT_PRODUCTION_URL;
  return prod ? `https://${prod}` : new URL(request.url).origin;
}
