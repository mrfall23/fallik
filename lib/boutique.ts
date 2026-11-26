'use client';

import { useEffect, useState } from 'react';
import { supabase } from './supabase';

// Reglages de la boutique connectee (ligne public.organisations ; la RLS ne
// laisse lire que la sienne). Remplace les valeurs autrefois ecrites en dur.
export type Boutique = {
  id: number;
  nom: string;
  logo_url: string | null;
  couleur_principale: string;
  couleur_secondaire: string;
  devise: string;
  fuseau_horaire: string;
  seuil_stock_bas: number;
  remise_max_pct: number;
  telephone: string | null;
  adresse: string | null;
  type_activite: string;
};

export const COLONNES_BOUTIQUE =
  'id, nom, logo_url, couleur_principale, couleur_secondaire, devise, fuseau_horaire, seuil_stock_bas, remise_max_pct, telephone, adresse, type_activite';

export const SEUIL_STOCK_BAS_DEFAUT = 5;

export async function lireBoutique(): Promise<Boutique | null> {
  const { data } = await supabase.from('organisations').select(COLONNES_BOUTIQUE).single();
  return (data as Boutique) || null;
}

export function useBoutique() {
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  useEffect(() => {
    let annule = false;
    lireBoutique().then(b => { if (!annule) setBoutique(b); });
    return () => { annule = true; };
  }, []);
  return boutique;
}
