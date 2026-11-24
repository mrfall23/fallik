import { NextResponse } from 'next/server';
import { creerClientServeur } from '@/lib/supabase-server';
import { envoyerAlertes } from '@/lib/alertes';
import { origineSite } from '@/lib/telegram';

// Enregistrement d'une vente rapide, cote serveur, pour envoyer les alertes
// aussitot.
//
// La vente elle-meme passe TOUJOURS par la RPC enregistrer_vente() : meme
// atomicite, meme verrouillage de stock, memes prix lus en base. On appelle
// la RPC avec la session de la vendeuse (creerClientServeur lit son cookie),
// donc mon_profil_id() la reconnait exactement comme avant.
//
// La notification est un BONUS best-effort : si elle echoue, la vente reste
// valide et la reponse reste un succes.

export async function POST(request: Request) {
  const supabase = await creerClientServeur();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ message: 'Non authentifie.' }, { status: 401 });

  const body = await request.json().catch(() => ({}));
  const { cliente_nom, cliente_telephone, produits, statut_paiement, montant_paye, mode_paiement, autorisation } = body;
  // Jeton de validation du gerant (credit) : verifie et consomme par la base.
  const jeton = typeof autorisation === 'string' && /^[0-9a-f-]{36}$/i.test(autorisation) ? autorisation : null;

  const { data: venteId, error } = await supabase.rpc('enregistrer_vente', {
    p_cliente_nom: cliente_nom,
    p_cliente_telephone: cliente_telephone ?? null,
    p_produits: produits,
    p_statut_paiement: statut_paiement,
    p_montant_paye: montant_paye ?? null,
    p_mode_paiement: mode_paiement,
    p_autorisation: jeton,
  });

  if (error) {
    // Messages metier utiles (stock insuffisant, montant invalide...) renvoyes tels quels.
    return NextResponse.json({ message: error.message || "Erreur lors de l'enregistrement." }, { status: 400 });
  }

  // ── Alertes (push + Telegram, best-effort, jamais bloquantes) ──
  // La base a mis la vente (et un eventuel stock bas) en file : on envoie.
  const { data: acces } = await supabase.rpc('mon_acces');
  if (acces?.organisation_id) await envoyerAlertes(Number(acces.organisation_id), origineSite(request));

  return NextResponse.json({ ok: true, id: venteId });
}
