import { creerClientServeur } from '@/lib/supabase-server';
import { estGestion, type Acces } from '@/lib/roles';

/**
 * Pour les routes serveur qui utilisent la cle secrete (elle CONTOURNE RLS) :
 * renvoie l'etat d'acces de l'appelant, lu avec SA session via public.mon_acces().
 * null si pas de session, compte inactif, ou boutique non accessible
 * (desactivee, suspendue, resiliee, expiree).
 */
export async function accesAppelant(): Promise<Acces | null> {
  const supabase = await creerClientServeur();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return null;
  const { data, error } = await supabase.rpc('mon_acces');
  if (error || !data) return null;
  const acces = data as Acces;
  if (!acces.acces || !acces.compte_actif) return null;
  return acces;
}

/** Comme accesAppelant(), mais exige un role de gestion (proprietaire ou admin). */
export async function accesGestion(): Promise<Acces | null> {
  const acces = await accesAppelant();
  return acces && estGestion(acces.role) ? acces : null;
}
