// Roles d'une boutique. La vraie barriere reste la base (RLS + prive.est_admin /
// prive.est_proprietaire) ; ces helpers ne servent qu'a l'affichage et aux
// redirections.
export type Role = 'proprietaire' | 'admin' | 'vendeuse';

/** Gestion de la boutique : proprietaire ou admin (gerant). */
export const estGestion = (role?: string | null) => role === 'proprietaire' || role === 'admin';

export const LIBELLES_ROLE: Record<string, string> = {
  proprietaire: 'Propriétaire',
  admin: 'Gérant(e)',
  vendeuse: 'Vendeuse',
};

export const accueilPourRole = (role?: string | null) => (estGestion(role) ? '/admin' : '/vendeuse');

// Offres Fall Digital (prix mensuels, en FCFA).
export const PLANS: Record<string, { nom: string; prix: number }> = {
  solo: { nom: 'Solo', prix: 15000 },
  pro: { nom: 'Pro', prix: 30000 },
};

export const LIBELLES_STATUT: Record<string, string> = {
  essai: "Période d'essai",
  actif: 'Actif',
  suspendu: 'Suspendu',
  resilie: 'Résilié',
};

/** Etat d'acces renvoye par la RPC public.mon_acces(). */
export type Acces = {
  utilisateur_id: number;
  nom: string;
  role: Role;
  compte_actif: boolean;
  organisation_id: number;
  organisation: string;
  organisation_active: boolean;
  plan: string | null;
  statut: string | null;
  date_expiration: string | null;
  acces: boolean;
};
