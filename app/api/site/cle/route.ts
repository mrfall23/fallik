import { NextResponse } from 'next/server';
import { accesGestion } from '@/lib/acces-serveur';
import { creerClientServeur } from '@/lib/supabase-server';
import { empreinte, nouvelleCle } from '@/lib/site-web';

// Nouvelle cle du site (proprietaire, plan Pro ; la base le verifie aussi).
// La cle n'est montree qu'une fois : seule son empreinte est enregistree.
export async function POST() {
  const acces = await accesGestion();
  if (!acces || acces.role !== 'proprietaire') return NextResponse.json({ message: 'Réservé au propriétaire.' }, { status: 403 });
  const cle = nouvelleCle();
  const supabase = await creerClientServeur();
  const { error } = await supabase.rpc('site_generer_cle', { p_cle_hash: empreinte(cle), p_cle_debut: cle.slice(0, 10) });
  if (error) return NextResponse.json({ message: error.message }, { status: 400 });
  return NextResponse.json({ cle });
}
