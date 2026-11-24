// Traduction des lignes du journal d'activite en phrases lisibles
// (page Journal + notifications au patron).

export type LigneJournal = {
  id: number;
  action: string;
  gravite: 'info' | 'attention' | 'alerte';
  utilisateur_nom: string | null;
  approuve_nom: string | null;
  details: Record<string, any>;
  montant: number | null;
  cree_le: string;
};

const f = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('fr-FR');

export const ICONES_JOURNAL: Record<string, string> = {
  facture_annulee: 'delete_forever', article_retire: 'remove_shopping_cart', correction_article: 'edit_note',
  credit_accorde: 'credit_card_clock', vente_annulee: 'block', reappro: 'local_shipping', stock_corrige: 'tune', creance_encaissee: 'payments', code_gerant_faux: 'gpp_maybe', stock_modifie: 'inventory',
  prix_modifie: 'sell', produit_cree: 'add_box', produit_supprime: 'delete', cloture_caisse: 'point_of_sale',
  inventaire: 'fact_check', connexion_caisse: 'login', caisse_compte_bloque: 'lock',
  poste_caisse_active: 'smartphone', poste_caisse_retire: 'mobile_off', pin_modifie: 'pin', pin_vendeuse_modifie: 'pin',
  periode_cloturee: 'restart_alt', objectif_defini: 'flag',
  alertes_modifiees: 'notifications', telegram_lie: 'send', telegram_delie: 'notifications_off',
};

export function decrireEvenement(j: LigneJournal): string {
  const d = j.details || {};
  const qui = j.utilisateur_nom || 'Système';
  const valide = j.approuve_nom ? ` (validé par ${j.approuve_nom})` : '';
  switch (j.action) {
    case 'facture_annulee': return `${qui} a annulé la facture « ${d.client} » : ${f(j.montant)} FCFA${valide}`;
    case 'article_retire': return `${qui} a retiré ${d.avant - d.apres} × ${d.produit} de « ${d.client} » (${f(j.montant)} FCFA)${valide}`;
    case 'correction_article': return `${qui} a corrigé ${d.produit} sur « ${d.client} » (${d.avant} → ${d.apres}) juste après l'ajout`;
    case 'reappro': return `${qui} a reçu ${d.quantite} × ${d.produit} (stock ${d.apres})${d.note ? ` — ${d.note}` : ''}`;
    case 'stock_corrige': return `${qui} a corrigé le stock de ${d.produit} : ${d.avant} → ${d.apres} (${f(j.montant)} FCFA) — ${d.motif}`;
    case 'vente_annulee': return `${qui} a annulé la vente n° ${d.vente} (« ${d.client} », vendue par ${d.vendeuse || '?'}) : ${f(j.montant)} FCFA — motif : ${d.motif}`;
    case 'creance_encaissee': return `${qui} a encaissé ${f(j.montant)} FCFA de « ${d.client} » sur une dette (reste ${f(d.reste)} FCFA)`;
    case 'credit_accorde': return `${qui} a fait crédit à « ${d.client} » : reste ${f(j.montant)} FCFA sur ${f(d.total)}${valide}`;
    case 'code_gerant_faux': return `${qui} a tapé un mauvais code gérant (essai n° ${d.essai})`;
    case 'stock_modifie': return `${qui} a changé le stock de ${d.produit} : ${d.avant} → ${d.apres}`;
    case 'prix_modifie': return `${qui} a changé le prix de ${d.produit} : ${f(d.avant)} → ${f(d.apres)} FCFA`;
    case 'produit_cree': return `${qui} a créé le produit ${d.produit} (stock ${d.stock})`;
    case 'produit_supprime': return `${qui} a supprimé le produit ${d.produit} (il restait ${d.stock} en stock)`;
    case 'cloture_caisse': {
      const e = Number(j.montant) || 0;
      return `${qui} a clôturé sa caisse : ${f(d.declare)} déclarés pour ${f(d.attendu)} attendus — ${e === 0 ? 'aucun écart' : e < 0 ? `manque ${f(-e)} FCFA` : `surplus ${f(e)} FCFA`}`;
    }
    case 'inventaire': return `${qui} a fait un inventaire : ${d.ecarts} écart(s) sur ${d.produits} produit(s), ${f(j.montant)} FCFA${d.applique ? '' : ' (stock non modifié)'}`;
    case 'connexion_caisse': return `${qui} s'est connectée sur la caisse « ${d.poste} »`;
    case 'caisse_compte_bloque': return `${qui} : 5 codes faux sur la caisse « ${d.poste} », compte bloqué 15 min`;
    case 'poste_caisse_active': return `${qui} a activé un téléphone caisse « ${d.poste} »`;
    case 'poste_caisse_retire': return `${qui} a retiré le téléphone caisse « ${d.poste} »`;
    case 'periode_cloturee': return `${qui} a clôturé la période « ${d.periode} » : ${f(j.montant)} FCFA sur ${d.ventes} vente(s), compteurs remis à zéro`;
    case 'objectif_defini': return j.montant ? `${qui} a fixé l'objectif de ${d.vendeuse} pour ${d.mois} : ${f(j.montant)} FCFA` : `${qui} a retiré l'objectif de ${d.vendeuse} pour ${d.mois}`;
    case 'alertes_modifiees': {
      const off = ['ventes', 'stock_bas', 'actions_sensibles', 'resume_soir'].filter(k => d[k] === false)
        .map(k => ({ ventes: 'ventes', stock_bas: 'stock bas', actions_sensibles: 'actions à vérifier', resume_soir: 'résumé du soir' } as Record<string, string>)[k]);
      return `${qui} a modifié les alertes${off.length ? ` (coupées : ${off.join(', ')})` : ' (toutes actives)'}`;
    }
    case 'telegram_lie': return `Telegram relié à la boutique (${d.conversation})`;
    case 'telegram_delie': return `${qui === 'Système' ? 'Telegram' : qui} : alertes Telegram délié${d.conversation ? ` (${d.conversation})` : ''}`;
    case 'pin_modifie': return `${qui} a changé son code PIN`;
    case 'pin_vendeuse_modifie': return `${qui} a défini le code PIN de ${d.vendeuse}`;
    default: return `${qui} : ${j.action}`;
  }
}
