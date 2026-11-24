import { NextResponse } from 'next/server';
import { timingSafeEqual } from 'node:crypto';
import { clientService } from '@/lib/caisse-serveur';
import { envoyerAlertes, envoyerResume } from '@/lib/alertes';
import { origineSite } from '@/lib/telegram';

// Tache planifiee du soir (Vercel Cron, voir vercel.json) :
//   1. envoie les alertes restees en file (personne n'a declenche l'envoi) ;
//   2. envoie le resume de la journee aux boutiques qui l'ont demande.
// Vercel l'appelle avec « Authorization: Bearer CRON_SECRET ».
export const maxDuration = 60;

function autorise(request: Request) {
  const secret = process.env.CRON_SECRET;
  if (!secret) return false;
  const attendu = Buffer.from(`Bearer ${secret}`);
  const recu = Buffer.from(request.headers.get('authorization') || '');
  return recu.length === attendu.length && timingSafeEqual(recu, attendu);
}

export async function GET(request: Request) {
  if (!autorise(request)) return NextResponse.json({ ok: false }, { status: 401 });
  const site = origineSite(request);
  const service = clientService();
  // Boutiques accessibles (abonnement en essai / actif, non expire).
  const { data: abos } = await service.from('abonnements').select('organisation_id')
    .in('statut', ['essai', 'actif']).gt('date_expiration', new Date().toISOString());
  const { data: orgs } = await service.from('organisations').select('id').eq('actif', true)
    .in('id', (abos || []).map(a => a.organisation_id));
  let resumes = 0;
  for (const o of orgs || []) {
    await envoyerAlertes(o.id, site);
    if (await envoyerResume(o.id, site).catch(() => false)) resumes++;
  }
  return NextResponse.json({ ok: true, boutiques: orgs?.length || 0, resumes });
}
