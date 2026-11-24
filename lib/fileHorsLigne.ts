// File d'attente locale des ventes rapides faites SANS reseau (repris de
// Fallora). Stockee dans localStorage, elle survit a un rechargement. Chaque
// entree contient le payload exact a renvoyer a /api/ventes. Au retour du
// reseau, on depile : la base reste seule juge (stock, prix) — une vente peut
// donc etre refusee a l'envoi.
//
// Hors ligne, seule une vente PAYEE est acceptee : un credit exige le code du
// gerant, verifie par la base, donc une connexion.

export type PayloadVente = {
  cliente_nom: string;
  cliente_telephone: string | null;
  produits: { produit_id: number; quantite: number }[];
  statut_paiement: 'paye';
  montant_paye: null;
  mode_paiement: string;
};

export type VenteEnAttente = {
  id: string;
  utilisateur_id: number; // la vente part au nom de cette vendeuse uniquement
  payload: PayloadVente;
  apercu: { cliente: string; total: number; date: string };
};

const CLE = 'fallik_ventes_hors_ligne';

export function lireFile(): VenteEnAttente[] {
  try {
    const arr = JSON.parse(localStorage.getItem(CLE) || '[]');
    return Array.isArray(arr) ? arr : [];
  } catch {
    return [];
  }
}

export function ecrireFile(file: VenteEnAttente[]): void {
  try {
    localStorage.setItem(CLE, JSON.stringify(file));
  } catch {
    // quota plein ou stockage indisponible : rien de mieux a faire ici.
  }
}

export function ajouterAFile(vente: VenteEnAttente): VenteEnAttente[] {
  const file = lireFile();
  file.push(vente);
  ecrireFile(file);
  return file;
}

export function nouvelId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  }
}
