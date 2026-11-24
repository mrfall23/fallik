import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { clientService } from '@/lib/caisse-serveur';
import { secretWebhook, empreinte, envoyerTelegram, telegramActif } from '@/lib/telegram';

// Webhook du bot Telegram Fallik. Telegram l'appelle avec l'en-tete secret
// fixe a l'installation : toute autre requete est rejetee.
//   « /start CODE » : relie cette conversation a la boutique du code ;
//   « /stop »       : cette conversation ne recoit plus d'alertes.
// Le bot ne repond qu'a ces commandes et ne lit rien d'autre.

function secretOk(recu: string | null) {
  const attendu = Buffer.from(secretWebhook());
  const b = Buffer.from(recu || '');
  return b.length === attendu.length && timingSafeEqual(b, attendu);
}

export async function POST(request: Request) {
  if (!telegramActif() || !secretOk(request.headers.get('x-telegram-bot-api-secret-token'))) {
    return NextResponse.json({ ok: false }, { status: 401 });
  }
  const maj = await request.json().catch(() => null);
  const msg = maj?.message;
  const texte: string = typeof msg?.text === 'string' ? msg.text.trim() : '';
  const chat = msg?.chat;
  if (!chat?.id || !texte.startsWith('/')) return NextResponse.json({ ok: true });
  const chatId = String(chat.id);
  const service = clientService();

  const [commande, argument] = texte.split(/\s+/, 2);
  if (commande.split('@')[0] === '/start') {
    if (!argument || !/^[A-Za-z0-9_-]{8,64}$/.test(argument)) {
      await envoyerTelegram(chatId, "Bonjour ! Pour recevoir les alertes de votre boutique, ouvrez Fallik → Paramètres → Alertes, puis « Relier Telegram ».");
      return NextResponse.json({ ok: true });
    }
    const titre = chat.title || [chat.first_name, chat.last_name].filter(Boolean).join(' ') || chat.username || 'Telegram';
    const { data } = await service.rpc('telegram_lier', { p_code_hash: empreinte(argument), p_chat_id: chatId, p_titre: titre });
    await envoyerTelegram(chatId, data?.ok
      ? `✅ Telegram relié à « ${data.boutique} ».\n\nVous recevrez ici les alertes choisies dans Fallik (ventes, stock bas, actions à vérifier, résumé du soir).\nEnvoyez /stop pour ne plus rien recevoir.`
      : '❌ Ce lien a expiré ou a déjà servi. Recommencez depuis Fallik → Paramètres → Alertes.');
  } else if (commande.split('@')[0] === '/stop') {
    const { data } = await service.rpc('telegram_arreter', { p_chat_id: chatId });
    await envoyerTelegram(chatId, Number(data) > 0 ? '🔕 Cette conversation ne recevra plus les alertes Fallik.' : "Cette conversation n'était reliée à aucune boutique.");
  }
  return NextResponse.json({ ok: true });
}
