import { NextResponse } from 'next/server';
import { creerClientServeur } from '@/lib/supabase-server';
import { clientService, empreintePoste } from '@/lib/caisse-serveur';

// Connexion d'une vendeuse sur un telephone caisse, par son code PIN.
//
// 1. Le cookie secret prouve que l'appareil est une caisse active.
// 2. La base verifie le code (bcrypt), compte les echecs et bloque apres 5.
// 3. Si c'est bon, on ouvre une vraie session Supabase pour CETTE vendeuse
//    (lien magique genere et consomme cote serveur, jamais envoye par email).
// La vendeuse n'a donc jamais besoin des identifiants du patron.
export async function POST(request: Request) {
  const hash = await empreintePoste();
  if (!hash) return NextResponse.json({ message: 'Ce téléphone n\'est pas une caisse.' }, { status: 403 });

  const body = await request.json().catch(() => ({}));
  const utilisateurId = Number(body?.utilisateur_id);
  const pin = typeof body?.pin === 'string' ? body.pin : '';
  if (!Number.isInteger(utilisateurId) || utilisateurId <= 0 || !/^[0-9]{4,6}$/.test(pin)) {
    return NextResponse.json({ message: 'Code incorrect.' }, { status: 400 });
  }

  const service = clientService();
  const { data, error } = await service.rpc('caisse_verifier_pin', {
    p_jeton_hash: hash, p_utilisateur_id: utilisateurId, p_pin: pin,
  });
  if (error) return NextResponse.json({ message: 'Erreur, réessayez.' }, { status: 500 });
  if (!data?.ok) {
    const restants = typeof data?.restants === 'number' ? data.restants : null;
    return NextResponse.json({ message: data?.message || 'Code incorrect.', restants }, { status: 401 });
  }

  const { data: lien, error: errLien } = await service.auth.admin.generateLink({ type: 'magiclink', email: data.email });
  const tokenHash = lien?.properties?.hashed_token;
  if (errLien || !tokenHash) return NextResponse.json({ message: 'Connexion impossible, réessayez.' }, { status: 500 });

  const supabase = await creerClientServeur();
  await supabase.auth.signOut({ scope: 'local' }); // ferme une eventuelle session precedente sur l'appareil
  const { error: errSession } = await supabase.auth.verifyOtp({ type: 'magiclink', token_hash: tokenHash });
  if (errSession) return NextResponse.json({ message: 'Connexion impossible, réessayez.' }, { status: 500 });

  return NextResponse.json({ ok: true, nom: data.nom });
}
