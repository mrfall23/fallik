import { NextResponse } from 'next/server';
import { accesAppelant } from '@/lib/acces-serveur';
import { envoyerAlertes } from '@/lib/alertes';
import { origineSite } from '@/lib/telegram';

// Declenche l'envoi des alertes en attente de la boutique de l'appelant
// (ventes, stock bas, actions sensibles du journal) : push + Telegram.
//
// N'importe quel membre connecte peut le declencher : la route n'envoie que
// ce que la BASE a mis en file pour SA boutique (rien ne vient du navigateur).
// Sinon, l'envoi se fait au prochain appel ou par la tache du soir.
export async function POST(request: Request) {
  const acces = await accesAppelant();
  if (!acces) return NextResponse.json({ ok: false }, { status: 401 });
  await envoyerAlertes(acces.organisation_id, origineSite(request));
  return NextResponse.json({ ok: true });
}
