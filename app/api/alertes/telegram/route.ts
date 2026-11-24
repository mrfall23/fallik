import { NextResponse } from 'next/server';
import { randomBytes } from 'node:crypto';
import { accesGestion } from '@/lib/acces-serveur';
import { creerClientServeur } from '@/lib/supabase-server';
import { clientService } from '@/lib/caisse-serveur';
import { telegramActif, nomDuBot, installerWebhook, origineSite, empreinte, envoyerTelegram } from '@/lib/telegram';

// Telegram de la boutique : etat (GET), liaison / test (POST), deliaison (DELETE).
// Lecture pour le gerant ; liaison, test et deliaison : proprietaire seulement
// (verifie ici ET par la base).

export async function GET() {
  const acces = await accesGestion();
  if (!acces) return NextResponse.json({ message: 'Accès refusé.' }, { status: 403 });
  const supabase = await creerClientServeur();
  const { data } = await supabase.from('reglages_alertes')
    .select('ventes, stock_bas, actions_sensibles, resume_soir, telegram_titre, telegram_lie_le').maybeSingle();
  return NextResponse.json({ actif: telegramActif(), bot: telegramActif() ? await nomDuBot() : null, reglages: data });
}

export async function POST(request: Request) {
  const acces = await accesGestion();
  if (!acces || acces.role !== 'proprietaire') return NextResponse.json({ message: 'Réservé au propriétaire.' }, { status: 403 });
  if (!telegramActif()) return NextResponse.json({ message: "Telegram n'est pas encore activé sur Fallik." }, { status: 400 });
  const { action } = await request.json().catch(() => ({}));

  if (action === 'lier') {
    const bot = await nomDuBot();
    if (!bot) return NextResponse.json({ message: 'Bot Telegram injoignable. Réessayez.' }, { status: 502 });
    const w = await installerWebhook(origineSite(request));
    if (!w.ok) return NextResponse.json({ message: 'Impossible de brancher le bot Telegram. Réessayez.' }, { status: 502 });
    const code = randomBytes(9).toString('base64url'); // 12 caracteres, a usage unique
    const supabase = await creerClientServeur();
    const { error } = await supabase.rpc('telegram_preparer_liaison', { p_code_hash: empreinte(code) });
    if (error) return NextResponse.json({ message: error.message }, { status: 400 });
    return NextResponse.json({ lien: `https://t.me/${bot}?start=${code}`, bot });
  }

  if (action === 'test') {
    const { data } = await clientService().from('reglages_alertes').select('telegram_chat_id').eq('organisation_id', acces.organisation_id).maybeSingle();
    if (!data?.telegram_chat_id) return NextResponse.json({ message: "Aucun Telegram relié." }, { status: 400 });
    const r = await envoyerTelegram(data.telegram_chat_id, `✅ ${acces.organisation || 'Votre boutique'} — message de test\n\nLes alertes Fallik arrivent bien ici.`);
    if (!r.ok) return NextResponse.json({ message: `Échec de l'envoi : ${r.detail}` }, { status: 502 });
    return NextResponse.json({ ok: true });
  }
  return NextResponse.json({ message: 'Action inconnue.' }, { status: 400 });
}

export async function DELETE() {
  const acces = await accesGestion();
  if (!acces || acces.role !== 'proprietaire') return NextResponse.json({ message: 'Réservé au propriétaire.' }, { status: 403 });
  const supabase = await creerClientServeur();
  const { error } = await supabase.rpc('telegram_delier');
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ ok: true });
}
