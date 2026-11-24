// Test d'intrusion multi-boutiques sur la base FALLIK.
//
// Cree 3 boutiques jetables (A et B actives, C expiree) avec leurs comptes,
// puis rejoue les attaques realistes : visiteur anonyme, boutique A qui
// tente de lire / modifier / vendre les donnees de B, client qui tente de
// prolonger son propre abonnement, gerant qui tente de prendre la place du
// proprietaire, boutique expiree qui tente de continuer a travailler.
// Tout est supprime a la fin. Ne touche a aucune boutique reelle.
//
// Usage : node scripts/tester-securite.mjs   (lit .env.local)

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);

const URL = env.NEXT_PUBLIC_SUPABASE_URL;
const PUB = env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
const service = createClient(URL, env.SUPABASE_SECRET_KEY, { auth: { autoRefreshToken: false, persistSession: false } });
const nouveauClient = () => createClient(URL, PUB, { auth: { autoRefreshToken: false, persistSession: false } });

let total = 0, reussis = 0;
const echecs = [];
function verifier(nom, condition, detail = '') {
  total++;
  if (condition) { reussis++; console.log(`   [OK]     ${nom}`); }
  else { echecs.push(nom + (detail ? ` — ${detail}` : '')); console.log(`   [ECHEC]  ${nom}${detail ? ` — ${detail}` : ''}`); }
}
const section = (t) => console.log(`\n── ${t} ${'─'.repeat(Math.max(0, 66 - t.length))}\n`);

const jetables = { orgs: [], auth: [] };
const jour = 24 * 3600 * 1000;

async function creerBoutique(nom, { expiree = false } = {}) {
  const { data: org, error } = await service.from('organisations')
    .insert({ nom: `TEST ${nom}`, slug: `test-${randomUUID().slice(0, 8)}` }).select('id').single();
  if (error) throw new Error(`organisation ${nom} : ${error.message}`);
  jetables.orgs.push(org.id);
  const { error: e2 } = await service.from('abonnements').insert({
    organisation_id: org.id, plan: 'solo', statut: expiree ? 'actif' : 'essai',
    date_expiration: new Date(Date.now() + (expiree ? -1 : 30) * jour).toISOString(),
  });
  if (e2) throw new Error(`abonnement ${nom} : ${e2.message}`);
  return org.id;
}

async function creerCompte(orgId, role, nom) {
  const email = `test-${randomUUID().slice(0, 8)}@fallik-test.local`;
  const motDePasse = randomUUID();
  const { data: a, error: e1 } = await service.auth.admin.createUser({ email, password: motDePasse, email_confirm: true, app_metadata: { role } });
  if (e1) throw new Error(`auth ${nom} : ${e1.message}`);
  jetables.auth.push(a.user.id);
  const { data: l, error: e2 } = await service.from('utilisateurs')
    .insert({ organisation_id: orgId, nom, email, role, actif: true, auth_id: a.user.id }).select('id').single();
  if (e2) throw new Error(`utilisateur ${nom} : ${e2.message}`);
  const client = nouveauClient();
  const { error: e3 } = await client.auth.signInWithPassword({ email, password: motDePasse });
  if (e3) throw new Error(`connexion ${nom} : ${e3.message}`);
  return { client, id: l.id, orgId };
}

async function creerProduit(orgId, nom) {
  const { data, error } = await service.from('produits')
    .insert({ organisation_id: orgId, nom, prix: 1000, stock_restant: 50, stock_initial: 50, actif: true }).select('id').single();
  if (error) throw new Error(`produit ${nom} : ${error.message}`);
  return data.id;
}

const vente = (client, produitId) => client.rpc('enregistrer_vente', {
  p_cliente_nom: 'Cliente test', p_cliente_telephone: null,
  p_produits: [{ produit_id: produitId, quantite: 1 }],
  p_statut_paiement: 'paye', p_montant_paye: null, p_mode_paiement: 'cash',
});

// Une ecriture « bloquee » = erreur, OU aucune ligne touchee.
const bloque = ({ data, error }) => !!error || !data || (Array.isArray(data) && data.length === 0);
const lignes = (r) => (Array.isArray(r.data) ? r.data : []);

try {
  console.log(`Base testee : ${URL}`);

  // ── Mise en place ──
  const orgA = await creerBoutique('A');
  const orgB = await creerBoutique('B');
  const orgC = await creerBoutique('C', { expiree: true });
  const propA = await creerCompte(orgA, 'proprietaire', 'Proprio A');
  const gerantA = await creerCompte(orgA, 'admin', 'Gerant A');
  const vendA = await creerCompte(orgA, 'vendeuse', 'Vendeuse A');
  const vendA2 = await creerCompte(orgA, 'vendeuse', 'Vendeuse A2');
  const propB = await creerCompte(orgB, 'proprietaire', 'Proprio B');
  const vendB = await creerCompte(orgB, 'vendeuse', 'Vendeuse B');
  const propC = await creerCompte(orgC, 'proprietaire', 'Proprio C');
  const prodA = await creerProduit(orgA, 'Produit A');
  const prodB = await creerProduit(orgB, 'Produit B');
  const prodC = await creerProduit(orgC, 'Produit C');

  const rA = await vente(vendA.client, prodA);
  verifier('Vendeuse A peut vendre un produit de A', !rA.error, rA.error?.message);
  const rB = await vente(vendB.client, prodB);
  verifier('Vendeuse B peut vendre un produit de B', !rB.error, rB.error?.message);
  const venteB = rB.data;
  const { data: factB } = await propB.client.rpc('ouvrir_facture', { p_nom_client: 'Table B' });

  // ═══════════════════════════════════════════════════════════════
  section('1. Visiteur anonyme (cle publique, sans session)');
  const anon = nouveauClient();
  for (const t of ['organisations', 'abonnements', 'utilisateurs', 'produits', 'clientes', 'ventes', 'vente_produits', 'paiements', 'factures', 'facture_lignes', 'push_subscriptions', 'inscriptions_journal',
    'codes_pin', 'autorisations', 'tentatives_pin', 'journal_activite', 'postes_caisse', 'clotures_caisse', 'inventaires', 'inventaire_lignes']) {
    const r = await anon.from(t).select('*').limit(5);
    verifier(`anonyme ne lit rien dans ${t}`, !!r.error || lignes(r).length === 0, `${lignes(r).length} ligne(s)`);
  }
  verifier('anonyme ne peut pas vendre', !!(await vente(anon, prodA)).error);
  const accAnon = await anon.rpc('mon_acces');
  verifier('anonyme : mon_acces ne renvoie rien', !!accAnon.error || accAnon.data === null);
  verifier('anonyme ne peut pas creer de boutique', bloque(await anon.from('organisations').insert({ nom: 'pirate' }).select()));

  // ═══════════════════════════════════════════════════════════════
  section('2. Cloisonnement : la boutique A face aux donnees de B');
  for (const [qui, c] of [['proprietaire A', propA], ['gerant A', gerantA], ['vendeuse A', vendA]]) {
    for (const t of ['organisations', 'utilisateurs', 'produits', 'clientes', 'ventes', 'factures']) {
      const col = t === 'organisations' ? 'id' : 'organisation_id';
      const r = await c.client.from(t).select(col);
      const etrangeres = lignes(r).filter((x) => x[col] !== orgA);
      verifier(`${qui} ne voit que sa boutique dans ${t}`, !r.error && etrangeres.length === 0, r.error?.message || `${etrangeres.length} ligne(s) d'une autre boutique`);
    }
  }
  const vpB = await propA.client.from('vente_produits').select('id').eq('vente_id', venteB);
  verifier('proprietaire A ne lit pas les lignes de vente de B', lignes(vpB).length === 0);
  const payB = await propA.client.from('paiements').select('id').eq('vente_id', venteB);
  verifier('proprietaire A ne lit pas les paiements de B', lignes(payB).length === 0);
  const flB = await propA.client.from('facture_lignes').select('id').eq('facture_id', factB);
  verifier('proprietaire A ne lit pas les factures ouvertes de B', lignes(flB).length === 0);

  verifier('proprietaire A ne modifie pas un produit de B', bloque(await propA.client.from('produits').update({ prix: 1 }).eq('id', prodB).select()));
  verifier('proprietaire A ne supprime pas un produit de B', bloque(await propA.client.from('produits').delete().eq('id', prodB).select()));
  const { data: prodBApres } = await service.from('produits').select('prix').eq('id', prodB).single();
  verifier('le produit de B est intact', prodBApres?.prix == 1000);
  verifier('proprietaire A ne cree pas de produit chez B', bloque(await propA.client.from('produits').insert({ organisation_id: orgB, nom: 'intrus', prix: 1 }).select()));
  verifier('proprietaire A ne modifie pas une vente de B', bloque(await propA.client.from('ventes').update({ total: 0 }).eq('id', venteB).select()));
  verifier('proprietaire A ne desactive pas un compte de B', bloque(await propA.client.from('utilisateurs').update({ actif: false }).eq('id', vendB.id).select()));
  verifier('vendeuse A ne vend pas un produit de B', !!(await vente(vendA.client, prodB)).error);
  verifier('vendeuse A ne vend pas un produit de C', !!(await vente(vendA.client, prodC)).error);
  const ajout = await propA.client.rpc('facture_definir_quantite', { p_facture_id: factB, p_produit_id: prodA, p_quantite: 1 });
  verifier('proprietaire A ne touche pas une facture ouverte de B', !!ajout.error);
  verifier('proprietaire A n\'annule pas une facture de B', !!(await propA.client.rpc('facture_annuler', { p_facture_id: factB })).error);
  const { data: factA } = await propA.client.rpc('ouvrir_facture', { p_nom_client: 'Table A' });
  const ajoutB = await propA.client.rpc('facture_definir_quantite', { p_facture_id: factA, p_produit_id: prodB, p_quantite: 1 });
  verifier('proprietaire A ne met pas un produit de B sur sa facture', !!ajoutB.error);
  const tdb = await propA.client.rpc('tableau_de_bord_admin');
  verifier('tableau de bord A ne compte que les ventes de A', !tdb.error && Number(tdb.data?.stats?.total_ventes) === 1000, JSON.stringify(tdb.data?.stats || tdb.error?.message));
  verifier('vendeuse A ne lit pas le tableau de bord', !!(await vendA.client.rpc('tableau_de_bord_admin')).error);

  // ═══════════════════════════════════════════════════════════════
  section('3. Abonnement : impossible de se prolonger soi-meme');
  const aboA = await propA.client.from('abonnements').select('organisation_id, date_expiration');
  verifier('proprietaire A lit SON abonnement (et seulement le sien)', lignes(aboA).length === 1 && lignes(aboA)[0].organisation_id === orgA);
  verifier('gerant A ne lit pas l\'abonnement', lignes(await gerantA.client.from('abonnements').select('*')).length === 0);
  verifier('vendeuse A ne lit pas l\'abonnement', lignes(await vendA.client.from('abonnements').select('*')).length === 0);
  const loin = new Date(Date.now() + 3650 * jour).toISOString();
  verifier('proprietaire A ne prolonge pas son abonnement', bloque(await propA.client.from('abonnements').update({ date_expiration: loin, plan: 'pro' }).eq('organisation_id', orgA).select()));
  verifier('proprietaire A ne cree pas d\'abonnement', bloque(await propA.client.from('abonnements').insert({ organisation_id: orgA, date_expiration: loin }).select()));
  verifier('proprietaire A ne supprime pas son abonnement', bloque(await propA.client.from('abonnements').delete().eq('organisation_id', orgA).select()));
  const { data: aboApres } = await service.from('abonnements').select('plan, date_expiration').eq('organisation_id', orgA).single();
  verifier('abonnement A intact', aboApres?.plan === 'solo' && new Date(aboApres.date_expiration) < new Date(loin));
  verifier('proprietaire A ne reactive/desactive pas sa boutique (actif)', bloque(await propA.client.from('organisations').update({ actif: true }).eq('id', orgA).select()));
  verifier('proprietaire A ne change pas son slug', bloque(await propA.client.from('organisations').update({ slug: 'vole' }).eq('id', orgA).select()));
  const reglage = await gerantA.client.from('organisations').update({ seuil_stock_bas: 7 }).eq('id', orgA).select('seuil_stock_bas');
  verifier('gerant A modifie les reglages de sa boutique', !reglage.error && lignes(reglage)[0]?.seuil_stock_bas === 7, reglage.error?.message);
  verifier('vendeuse A ne modifie pas les reglages', bloque(await vendA.client.from('organisations').update({ seuil_stock_bas: 0 }).eq('id', orgA).select()));
  verifier('proprietaire A ne modifie pas les reglages de B', bloque(await propA.client.from('organisations').update({ nom: 'pirate' }).eq('id', orgB).select()));

  // ═══════════════════════════════════════════════════════════════
  section('4. Roles : personne ne prend la place du proprietaire');
  verifier('gerant A ne se promeut pas proprietaire', bloque(await gerantA.client.from('utilisateurs').update({ role: 'proprietaire' }).eq('id', gerantA.id).select()));
  verifier('gerant A ne promeut pas une vendeuse', bloque(await gerantA.client.from('utilisateurs').update({ role: 'admin' }).eq('id', vendA.id).select()));
  verifier('gerant A ne desactive pas le proprietaire', bloque(await gerantA.client.from('utilisateurs').update({ actif: false }).eq('id', propA.id).select()));
  verifier('gerant A ne renomme pas le proprietaire', bloque(await gerantA.client.from('utilisateurs').update({ nom: 'x' }).eq('id', propA.id).select()));
  verifier('gerant A ne supprime pas le proprietaire', bloque(await gerantA.client.from('utilisateurs').delete().eq('id', propA.id).select()));
  const desact = await gerantA.client.from('utilisateurs').update({ actif: false }).eq('id', vendA2.id).select('actif');
  verifier('gerant A desactive une vendeuse', !desact.error && lignes(desact)[0]?.actif === false, desact.error?.message);
  verifier('proprietaire A ne se retrograde pas lui-meme', bloque(await propA.client.from('utilisateurs').update({ role: 'admin' }).eq('id', propA.id).select()));
  verifier('proprietaire A ne se desactive pas lui-meme', bloque(await propA.client.from('utilisateurs').update({ actif: false }).eq('id', propA.id).select()));
  const promo = await propA.client.from('utilisateurs').update({ role: 'admin' }).eq('id', vendA2.id).select('role');
  verifier('proprietaire A change le role d\'une vendeuse', !promo.error && lignes(promo)[0]?.role === 'admin', promo.error?.message);
  verifier('proprietaire A ne deplace pas un compte vers B', bloque(await propA.client.from('utilisateurs').update({ organisation_id: orgB }).eq('id', vendA.id).select()));
  verifier('proprietaire A ne change pas l\'email d\'un compte', bloque(await propA.client.from('utilisateurs').update({ email: 'x@y.z' }).eq('id', vendA.id).select()));
  verifier('proprietaire A ne cree pas de compte directement', bloque(await propA.client.from('utilisateurs').insert({ organisation_id: orgA, nom: 'x', email: `x-${randomUUID().slice(0, 6)}@t.local`, role: 'admin' }).select()));
  verifier('vendeuse A ne se promeut pas', bloque(await vendA.client.from('utilisateurs').update({ role: 'admin' }).eq('id', vendA.id).select()));
  const ventesVend = await vendA.client.from('ventes').select('vendeuse_id');
  verifier('vendeuse A ne voit que ses propres ventes', lignes(ventesVend).every((v) => v.vendeuse_id === vendA.id));

  // ═══════════════════════════════════════════════════════════════
  section('4 bis. Vendeuses : code du gerant, journal, caisse');
  const vendA3 = await creerCompte(orgA, 'vendeuse', 'Vendeuse A3');
  verifier('gerant A definit son code', !(await gerantA.client.rpc('definir_mon_pin', { p_pin: '4826' })).error);
  verifier('gerant A definit le code de la vendeuse A', !(await gerantA.client.rpc('definir_pin_vendeuse', { p_utilisateur_id: vendA.id, p_pin: '7391' })).error);
  verifier("vendeuse A ne definit pas le code d'une collegue", !!(await vendA.client.rpc('definir_pin_vendeuse', { p_utilisateur_id: vendA3.id, p_pin: '7391' })).error);
  verifier("proprietaire B ne definit pas le code d'une vendeuse de A", !!(await propB.client.rpc('definir_pin_vendeuse', { p_utilisateur_id: vendA.id, p_pin: '5555' })).error);
  for (const t of ['codes_pin', 'autorisations', 'tentatives_pin']) {
    verifier(`gerant A ne lit pas ${t}`, lignes(await gerantA.client.from(t).select('*')).length === 0);
  }
  const { data: fV } = await vendA.client.rpc('ouvrir_facture', { p_nom_client: 'Table V' });
  await vendA.client.rpc('facture_definir_quantite', { p_facture_id: fV, p_produit_id: prodA, p_quantite: 2 });
  verifier('vendeuse A3 ne touche pas la facture de A', !!(await vendA3.client.rpc('facture_definir_quantite', { p_facture_id: fV, p_produit_id: prodA, p_quantite: 5 })).error);
  const annSans = await vendA.client.rpc('facture_annuler', { p_facture_id: fV });
  verifier("vendeuse A n'annule pas sans le code du gerant", /Validation du gérant requise/.test(annSans.error?.message || ''), annSans.error?.message);
  const credSans = await vendA.client.rpc('facture_finaliser', { p_facture_id: fV, p_mode_paiement: 'cash', p_montant_paye: 0 });
  verifier('vendeuse A ne fait pas credit sans le code du gerant', !!credSans.error);
  const faux = await vendA.client.rpc('demander_autorisation', { p_action: 'annuler_facture', p_cible: fV, p_montant: 2000, p_code: '0000' });
  verifier('mauvais code gerant refuse', faux.data?.ok === false, JSON.stringify(faux.data || faux.error?.message));
  const vrai = await vendA.client.rpc('demander_autorisation', { p_action: 'annuler_facture', p_cible: fV, p_montant: 2000, p_code: '4826' });
  verifier('bon code gerant : jeton', vrai.data?.ok === true, JSON.stringify(vrai.data || vrai.error?.message));
  verifier('vendeuse A3 ne reutilise pas le jeton de A', !!(await vendA3.client.rpc('facture_annuler', { p_facture_id: fV, p_autorisation: vrai.data?.autorisation })).error);
  verifier('vendeuse A annule avec le jeton', !(await vendA.client.rpc('facture_annuler', { p_facture_id: fV, p_autorisation: vrai.data?.autorisation })).error);
  const jA = await gerantA.client.from('journal_activite').select('action, approuve_nom').eq('action', 'facture_annulee');
  verifier('annulation au journal avec le nom du gerant', lignes(jA).some((j) => j.approuve_nom === 'Gerant A'));
  verifier('vendeuse A ne lit pas le journal', lignes(await vendA.client.from('journal_activite').select('id')).length === 0);
  verifier('proprietaire B ne lit pas le journal de A', lignes(await propB.client.from('journal_activite').select('id').eq('organisation_id', orgA)).length === 0);
  verifier("gerant A n'efface pas le journal", bloque(await gerantA.client.from('journal_activite').delete().eq('organisation_id', orgA).select()));
  verifier("cle secrete n'efface pas le journal", !!(await service.from('journal_activite').delete().eq('organisation_id', orgA)).error);
  const clo = await vendA.client.rpc('cloturer_caisse', { p_especes: 0 });
  verifier('vendeuse A cloture sa caisse (attendu calcule par la base)', !clo.error && Number(clo.data?.attendu_especes) === 1000, JSON.stringify(clo.data || clo.error?.message));
  verifier("vendeuse A ne fait pas d'inventaire", !!(await vendA.client.rpc('enregistrer_inventaire', { p_lignes: [{ produit_id: prodA, compte: 0 }], p_appliquer: true })).error);
  // Creances et annulation de vente (gerant seulement, ecritures directes fermees).
  verifier('vendeuse A n\'annule pas une vente', !!(await vendA.client.rpc('annuler_vente', { p_vente_id: rA.data, p_motif: 'test' })).error);
  verifier('proprietaire B n\'annule pas une vente de A', !!(await propB.client.rpc('annuler_vente', { p_vente_id: rA.data, p_motif: 'pirate' })).error);
  verifier('gerant A ne modifie pas une vente directement', bloque(await gerantA.client.from('ventes').update({ total: 1 }).eq('id', rA.data).select()));
  verifier('gerant A n\'ajoute pas de paiement directement', bloque(await gerantA.client.from('paiements').insert({ vente_id: rA.data, montant: 1 }).select()));
  verifier('proprietaire B n\'encaisse pas une dette de A', !!(await propB.client.rpc('enregistrer_paiement', { p_vente_id: rA.data, p_montant: 1, p_mode: 'cash' })).error);
  const annV = await gerantA.client.rpc('annuler_vente', { p_vente_id: rA.data, p_motif: 'Test intrusion' });
  verifier('gerant A annule une vente avec motif', !annV.error && annV.data?.articles_remis === 1, annV.error?.message);

  // Phase 2 : stock trace, prix d'achat confidentiel.
  verifier('gerant A ne change pas le stock directement', bloque(await gerantA.client.from('produits').update({ stock_restant: 999 }).eq('id', prodA).select()));
  verifier('vendeuse A ne reapprovisionne pas', !!(await vendA.client.rpc('reapprovisionner', { p_produit_id: prodA, p_quantite: 5, p_note: null })).error);
  verifier('proprietaire B ne reapprovisionne pas un produit de A', !!(await propB.client.rpc('reapprovisionner', { p_produit_id: prodA, p_quantite: 5, p_note: null })).error);
  const reap = await gerantA.client.rpc('reapprovisionner', { p_produit_id: prodA, p_quantite: 5, p_note: 'Test' });
  verifier('gerant A reapprovisionne', !reap.error, reap.error?.message);
  verifier('mouvements de stock : gerant A lit l\'historique', lignes(await gerantA.client.from('mouvements_stock').select('type').eq('produit_id', prodA)).some((m) => m.type === 'reappro'));
  verifier('mouvements de stock : vendeuse A ne lit rien', lignes(await vendA.client.from('mouvements_stock').select('id')).length === 0);
  verifier('gerant A fixe un prix d\'achat', !(await gerantA.client.from('produits_couts').upsert({ produit_id: prodA, prix_achat: 600 })).error);
  verifier('vendeuse A ne lit pas les prix d\'achat', lignes(await vendA.client.from('produits_couts').select('*')).length === 0);
  verifier('proprietaire B ne lit pas les prix d\'achat de A', lignes(await propB.client.from('produits_couts').select('*')).length === 0);
  verifier('proprietaire B n\'ecrit pas un prix d\'achat chez A', bloque(await propB.client.from('produits_couts').upsert({ produit_id: prodA, prix_achat: 1 }).select()));

  // Telephone caisse : connexion par code, sans mot de passe.
  const jeton = 'c'.repeat(64);
  verifier('gerant A active un poste caisse', !(await gerantA.client.rpc('creer_poste_caisse', { p_nom: 'Test', p_jeton_hash: jeton })).error);
  verifier("un connecte n'appelle pas caisse_verifier_pin", !!(await vendA.client.rpc('caisse_verifier_pin', { p_jeton_hash: jeton, p_utilisateur_id: vendA.id, p_pin: '7391' })).error);
  const cx = await service.rpc('caisse_verifier_pin', { p_jeton_hash: jeton, p_utilisateur_id: vendA.id, p_pin: '7391' });
  verifier('caisse : bon code accepte', cx.data?.ok === true, JSON.stringify(cx.data || cx.error?.message));
  const lien = await service.auth.admin.generateLink({ type: 'magiclink', email: cx.data?.email });
  const poste = nouveauClient();
  const ses = await poste.auth.verifyOtp({ type: 'magiclink', token_hash: lien.data?.properties?.hashed_token });
  const qui = await poste.rpc('mon_acces');
  verifier('caisse : session ouverte pour la vendeuse A (et pas le patron)', !ses.error && qui.data?.utilisateur_id === vendA.id && qui.data?.role === 'vendeuse', ses.error?.message || JSON.stringify(qui.data));
  verifier("caisse : la vendeuse d'une autre boutique est refusee", (await service.rpc('caisse_verifier_pin', { p_jeton_hash: jeton, p_utilisateur_id: vendB.id, p_pin: '7391' })).data?.ok === false);

  // ═══════════════════════════════════════════════════════════════
  section('5. Boutique expiree (C)');
  const accC = await propC.client.rpc('mon_acces');
  verifier('mon_acces dit « pas d\'acces » a C', !accC.error && accC.data?.acces === false, JSON.stringify(accC.data || accC.error?.message));
  verifier('C lit encore sa propre fiche (pour l\'ecran d\'abonnement)', lignes(await propC.client.from('utilisateurs').select('id')).length === 1);
  verifier('C ne lit plus ses produits', lignes(await propC.client.from('produits').select('id')).length === 0);
  verifier('C ne peut plus vendre', !!(await vente(propC.client, prodC)).error);
  verifier('C ne peut plus ouvrir de facture', !!(await propC.client.rpc('ouvrir_facture', { p_nom_client: 'x' })).error);
  verifier('C ne modifie plus ses reglages', bloque(await propC.client.from('organisations').update({ nom: 'x' }).eq('id', orgC).select()));
  verifier('C ne lit plus le tableau de bord', !!(await propC.client.rpc('tableau_de_bord_admin')).error);

  // ═══════════════════════════════════════════════════════════════
  section('6. Suspension en direct de la boutique A');
  await service.from('abonnements').update({ statut: 'suspendu' }).eq('organisation_id', orgA);
  verifier('A suspendue : la vendeuse ne voit plus les produits', lignes(await vendA.client.from('produits').select('id')).length === 0);
  verifier('A suspendue : la vendeuse ne peut plus vendre', !!(await vente(vendA.client, prodA)).error);
  await service.from('abonnements').update({ statut: 'actif' }).eq('organisation_id', orgA);
  await service.from('organisations').update({ actif: false }).eq('id', orgA);
  verifier('A desactivee : plus d\'acces', lignes(await propA.client.from('produits').select('id')).length === 0);
  await service.from('organisations').update({ actif: true }).eq('id', orgA);
  verifier('A reactivee : acces retabli', lignes(await vendA.client.from('produits').select('id')).length === 1);
} catch (e) {
  echecs.push(`ERREUR DE MISE EN PLACE : ${e.message}`);
  console.error('\n!! Erreur :', e.message);
} finally {
  // ── Nettoyage ── (cascade : comptes, produits, ventes, factures, abonnements)
  let restes = 0;
  for (const id of jetables.orgs) {
    const { error } = await service.from('organisations').delete().eq('id', id);
    if (error) { restes++; console.log(`   !! boutique de test ${id} non supprimee : ${error.message}`); }
  }
  for (const id of jetables.auth) {
    const { error } = await service.auth.admin.deleteUser(id);
    if (error) { restes++; console.log(`   !! compte de test ${id} non supprime : ${error.message}`); }
  }
  if (restes) echecs.push(`Nettoyage incomplet : ${restes} element(s) de test restent en base`);
  console.log(`\nNettoyage : ${jetables.orgs.length} boutique(s) et ${jetables.auth.length} compte(s) de test traites, ${restes} echec(s).`);
}

console.log(`\n══ Resultat : ${reussis}/${total} controles reussis ══`);
if (echecs.length) {
  console.log('\nEchecs :');
  echecs.forEach((e) => console.log(' - ' + e));
  process.exit(1);
}
