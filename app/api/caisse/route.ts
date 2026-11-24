import { NextResponse } from 'next/server';
import { accesGestion } from '@/lib/acces-serveur';
import { creerClientServeur } from '@/lib/supabase-server';
import {
  clientService, empreinte, empreintePoste, nouveauJeton, poserCookiesCaisse, retirerCookiesCaisse,
} from '@/lib/caisse-serveur';

// GET : cet appareil est-il une caisse ? -> boutique + vendeuses ayant un code.
export async function GET() {
  const hash = await empreintePoste();
  if (!hash) return NextResponse.json({ ok: false });
  const { data, error } = await clientService().rpc('caisse_poste', { p_jeton_hash: hash });
  if (error || !data?.ok) return NextResponse.json({ ok: false });
  return NextResponse.json({ ok: true, poste: data.poste, boutique: data.boutique, vendeuses: data.vendeuses });
}

// POST : le gerant / proprietaire transforme CET appareil en caisse, puis
// est deconnecte (son compte ne reste jamais ouvert sur le telephone partage).
export async function POST(request: Request) {
  const acces = await accesGestion();
  if (!acces) return NextResponse.json({ message: 'Réservé au gérant ou au propriétaire.' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const nom = typeof body?.nom === 'string' ? body.nom.trim().slice(0, 60) : '';

  const supabase = await creerClientServeur();
  const jeton = nouveauJeton();
  const { error } = await supabase.rpc('creer_poste_caisse', { p_nom: nom || 'Caisse', p_jeton_hash: empreinte(jeton) });
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });

  await poserCookiesCaisse(jeton);
  await supabase.auth.signOut({ scope: 'local' }); // sur cet appareil seulement
  return NextResponse.json({ ok: true });
}

// DELETE : quitter le mode caisse sur cet appareil (n'efface que les cookies ;
// le poste se retire aussi depuis Paramètres).
export async function DELETE() {
  await retirerCookiesCaisse();
  return NextResponse.json({ ok: true });
}
