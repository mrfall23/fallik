// Exports de la page Rapports (Excel et PDF). Tout est lu avec la session du
// gerant / proprietaire : la RLS ne renvoie que les donnees de SA boutique.
// Les bornes de periode sont calculees au fuseau horaire de la boutique.
import { supabase } from '@/lib/supabase';
import { toutLire, lireParIds } from '@/lib/requetes';
import { decrireEvenement, type LigneJournal } from '@/lib/journal';

export const MODES: Record<string, string> = { cash: 'Espèces', mobile_money: 'Mobile Money', orange_money: 'Orange Money', carte: 'Carte', autre: 'Autre' };
const TYPES_MVT: Record<string, string> = {
  ouverture: 'Stock de départ', creation: 'Création du produit', vente: 'Vente', facture: 'Facture (table)',
  annulation: 'Annulation', reappro: 'Réassort', correction: 'Correction', inventaire: 'Inventaire', manuel: "Modifié hors de l'application",
};

// ─── Dates au fuseau de la boutique ───────────────────────────────────
/** 'YYYY-MM-DD' du jour courant dans le fuseau `tz`. */
export function aujourdhui(tz: string) {
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz }).format(new Date());
}
/** Instant de minuit (heure locale de `tz`) du jour `ymd`. */
export function minuitLocal(ymd: string, tz: string): Date {
  const [y, m, d] = ymd.split('-').map(Number);
  const essai = Date.UTC(y, m - 1, d);
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', {
    timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit',
  }).formatToParts(new Date(essai)).map(x => [x.type, x.value]));
  const vu = Date.UTC(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
  return new Date(essai - (vu - essai));
}
export function decalerJour(ymd: string, jours: number) {
  const d = new Date(`${ymd}T12:00:00Z`); d.setUTCDate(d.getUTCDate() + jours);
  return d.toISOString().slice(0, 10);
}
export function debutMois(ymd: string, decalage = 0) {
  const d = new Date(`${ymd.slice(0, 7)}-01T12:00:00Z`); d.setUTCMonth(d.getUTCMonth() + decalage);
  return d.toISOString().slice(0, 10);
}

export type Bornes = { debut: string | null; fin: string | null; libelle: string; plage: string };

// ─── Formats ──────────────────────────────────────────────────────────
const N = (x: unknown) => Number(x) || 0;
// Les polices standard du PDF n'ont pas l'espace fine insecable du fr-FR.
const fmtPdf = (n: unknown) => Math.round(N(n)).toLocaleString('fr-FR').replace(/[  ]/g, ' ');
export const fmtDate = (s: string | Date, tz: string) => new Date(s).toLocaleDateString('fr-FR', { timeZone: tz, day: '2-digit', month: 'short', year: 'numeric' });
export const slug = (s: string) => s.toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '') || 'rapport';

function dansPeriode<T>(q: T & { gte: (c: string, v: string) => T; lt: (c: string, v: string) => T }, col: string, b: Bornes): T {
  let r: any = q;
  if (b.debut) r = r.gte(col, b.debut);
  if (b.fin) r = r.lt(col, b.fin);
  return r;
}

// ─── Chargement des donnees d'une periode ─────────────────────────────
export type Vente = {
  id: number; date_vente: string; total: number; montant_paye: number; reste_a_payer: number; statut_paiement: string;
  vendeuse_id: number | null; cliente_id: number | null; annulee: boolean; annulee_le: string | null; motif_annulation: string | null; annulee_par: number | null;
};

/** Ventes (y compris annulees) de la periode : leger, pour les compteurs. */
export async function lireVentes(b: Bornes): Promise<Vente[]> {
  return toutLire<Vente>(() => dansPeriode(
    supabase.from('ventes').select('id, date_vente, total, montant_paye, reste_a_payer, statut_paiement, vendeuse_id, cliente_id, annulee, annulee_le, motif_annulation, annulee_par') as any,
    'date_vente', b).order('date_vente', { ascending: true }).order('id', { ascending: true }));
}

export type Details = Awaited<ReturnType<typeof lireDetails>>;

/** Tout le detail necessaire aux exports de la periode. */
export async function lireDetails(b: Bornes, ventes: Vente[]) {
  const ids = ventes.map(v => v.id);
  const [lignes, paiements] = await Promise.all([
    lireParIds<any>('vente_produits', 'id, vente_id, produit_id, quantite, prix_unitaire', 'vente_id', ids),
    // Encaissements RECUS pendant la periode (y compris dettes d'avant).
    toutLire<any>(() => dansPeriode(supabase.from('paiements').select('id, vente_id, montant, mode, created_at, encaisse_par') as any, 'created_at', b).order('id', { ascending: true })),
  ]);
  const [couts, produits, clients, ventesPayees] = await Promise.all([
    lireParIds<any>('vente_produits_couts', 'vente_produit_id, prix_achat_unitaire', 'vente_produit_id', lignes.map(l => l.id)),
    lireParIds<any>('produits', 'id, nom', 'id', lignes.map(l => l.produit_id)),
    lireParIds<any>('clientes', 'id, nom, telephone', 'id', ventes.map(v => v.cliente_id) as number[]),
    lireParIds<any>('ventes', 'id, date_vente, cliente_id', 'id', paiements.map(p => p.vente_id).filter(id => !ids.includes(id))),
  ]);
  const autresClients = await lireParIds<any>('clientes', 'id, nom, telephone', 'id', ventesPayees.map(v => v.cliente_id));
  const userIds = [...ventes.flatMap(v => [v.vendeuse_id, v.annulee_par]), ...paiements.map(p => p.encaisse_par)].filter(Boolean) as number[];
  const users = await lireParIds<any>('utilisateurs', 'id, nom', 'id', userIds);
  return {
    lignes, paiements,
    cout: new Map<number, number>(couts.map(c => [c.vente_produit_id, N(c.prix_achat_unitaire)])),
    produit: new Map<number, string>(produits.map(p => [p.id, p.nom])),
    client: new Map<number, { nom: string; telephone: string | null }>([...clients, ...autresClients].map(c => [c.id, c])),
    user: new Map<number, string>(users.map(u => [u.id, u.nom])),
    venteHorsPeriode: new Map<number, any>(ventesPayees.map(v => [v.id, v])),
  };
}

// ─── Agregats communs Excel / PDF ─────────────────────────────────────
export function agreger(ventes: Vente[], d: Details) {
  const valides = ventes.filter(v => !v.annulee);
  const annulees = ventes.filter(v => v.annulee);
  const idsValides = new Set(valides.map(v => v.id));
  const lignesValides = d.lignes.filter(l => idsValides.has(l.vente_id));

  const vendeuses = new Map<string, { nom: string; nb: number; ca: number; encaisse: number; reste: number; articles: number }>();
  const articlesParVente = new Map<number, number>();
  lignesValides.forEach(l => articlesParVente.set(l.vente_id, (articlesParVente.get(l.vente_id) || 0) + N(l.quantite)));
  valides.forEach(v => {
    const nom = (v.vendeuse_id && d.user.get(v.vendeuse_id)) || '—';
    const x = vendeuses.get(nom) || { nom, nb: 0, ca: 0, encaisse: 0, reste: 0, articles: 0 };
    x.nb++; x.ca += N(v.total); x.encaisse += N(v.montant_paye); x.reste += N(v.reste_a_payer); x.articles += articlesParVente.get(v.id) || 0;
    vendeuses.set(nom, x);
  });

  const produits = new Map<string, { nom: string; quantite: number; ca: number; cout: number; caCouvert: number; benefice: number }>();
  let benefice = 0, caCouvert = 0, caLignes = 0;
  lignesValides.forEach(l => {
    const nom = d.produit.get(l.produit_id) || 'Produit supprimé';
    const ca = N(l.prix_unitaire) * N(l.quantite);
    const x = produits.get(nom) || { nom, quantite: 0, ca: 0, cout: 0, caCouvert: 0, benefice: 0 };
    x.quantite += N(l.quantite); x.ca += ca; caLignes += ca;
    const pa = d.cout.get(l.id);
    if (pa !== undefined) { const b = ca - pa * N(l.quantite); x.cout += pa * N(l.quantite); x.caCouvert += ca; x.benefice += b; benefice += b; caCouvert += ca; }
    produits.set(nom, x);
  });

  const modes = new Map<string, number>();
  d.paiements.forEach(p => { const m = p.mode || 'cash'; modes.set(m, (modes.get(m) || 0) + N(p.montant)); });

  return {
    valides, annulees,
    nb: valides.length,
    ca: valides.reduce((a, v) => a + N(v.total), 0),
    encaisseVentes: valides.reduce((a, v) => a + N(v.montant_paye), 0),
    reste: valides.reduce((a, v) => a + N(v.reste_a_payer), 0),
    articles: lignesValides.reduce((a, l) => a + N(l.quantite), 0),
    montantAnnule: annulees.reduce((a, v) => a + N(v.total), 0),
    benefice, caCouvert, caLignes,
    encaissements: [...modes.entries()].map(([mode, total]) => ({ mode, total })).sort((a, b) => b.total - a.total),
    totalEncaissements: [...modes.values()].reduce((a, b) => a + b, 0),
    parVendeuse: [...vendeuses.values()].sort((a, b) => b.ca - a.ca),
    parProduit: [...produits.values()].sort((a, b) => b.ca - a.ca),
  };
}

// ─── Excel ────────────────────────────────────────────────────────────
type Feuille = { nom: string; lignes: Record<string, unknown>[] };

export async function telechargerExcel(feuilles: Feuille[], fichier: string) {
  const XLSX = await import('xlsx');
  const { saveAs } = await import('file-saver');
  const wb = XLSX.utils.book_new();
  feuilles.forEach(f => {
    const lignes = f.lignes.length ? f.lignes : [{ Information: 'Aucune donnée sur cette période' }];
    const ws = XLSX.utils.json_to_sheet(lignes, { cellDates: true });
    // Largeur des colonnes selon le contenu (lisible sans retouche).
    const cols = Object.keys(lignes[0]);
    ws['!cols'] = cols.map(c => ({ wch: Math.min(60, Math.max(c.length, ...lignes.map(l => String(l[c] instanceof Date ? '00/00/0000 00:00' : l[c] ?? '').length)) + 2) }));
    XLSX.utils.book_append_sheet(wb, ws, f.nom.slice(0, 31));
  });
  saveAs(new Blob([XLSX.write(wb, { bookType: 'xlsx', type: 'array' })], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }), fichier);
}

// Date « murale » de la boutique, pour qu'Excel affiche l'heure locale de la
// boutique quel que soit le fuseau de l'ordinateur qui ouvre le fichier.
function dateExcel(s: string | null, tz: string): Date | string {
  if (!s) return '';
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-US', { timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit' })
    .formatToParts(new Date(s)).map(x => [x.type, x.value]));
  return new Date(+p.year, +p.month - 1, +p.day, +p.hour, +p.minute, +p.second);
}

export function feuillesPeriode(b: Bornes, ventes: Vente[], d: Details, a: ReturnType<typeof agreger>, dev: string, tz: string, boutique: string): Feuille[] {
  const client = (id: number | null) => (id && d.client.get(id)) || null;
  const qui = (id: number | null) => (id && d.user.get(id)) || '';
  const mg = a.caCouvert > 0 ? Math.round((a.benefice / a.caCouvert) * 1000) / 10 : null;
  return [
    { nom: 'Synthèse', lignes: [
      { Indicateur: 'Boutique', Valeur: boutique },
      { Indicateur: 'Période', Valeur: `${b.libelle} (${b.plage})` },
      { Indicateur: 'Nombre de ventes', Valeur: a.nb },
      { Indicateur: 'Articles vendus', Valeur: a.articles },
      { Indicateur: `Chiffre d'affaires (${dev})`, Valeur: a.ca },
      { Indicateur: `Payé au moment de la vente (${dev})`, Valeur: a.encaisseVentes },
      { Indicateur: `Reste dû sur ces ventes (${dev})`, Valeur: a.reste },
      { Indicateur: `Encaissements reçus pendant la période (${dev})`, Valeur: a.totalEncaissements },
      { Indicateur: `Bénéfice (${dev})`, Valeur: Math.round(a.benefice) },
      { Indicateur: 'Marge (%)', Valeur: mg ?? 'Prix d\'achat non renseignés' },
      { Indicateur: 'Part du CA avec prix d\'achat connu (%)', Valeur: a.caLignes > 0 ? Math.round((a.caCouvert / a.caLignes) * 1000) / 10 : 0 },
      { Indicateur: 'Ventes annulées', Valeur: a.annulees.length },
      { Indicateur: `Montant annulé (${dev})`, Valeur: a.montantAnnule },
    ] },
    { nom: 'Ventes', lignes: a.valides.map(v => ({
      'N°': v.id, Date: dateExcel(v.date_vente, tz), Client: client(v.cliente_id)?.nom || 'Client de passage', 'Téléphone': client(v.cliente_id)?.telephone || '',
      Vendeuse: qui(v.vendeuse_id), [`Total (${dev})`]: N(v.total), [`Payé (${dev})`]: N(v.montant_paye), [`Reste (${dev})`]: N(v.reste_a_payer),
      Statut: v.statut_paiement === 'paye' ? 'Payé' : 'Reste à payer',
    })) },
    { nom: 'Articles vendus', lignes: d.lignes.filter(l => a.valides.some(v => v.id === l.vente_id)).map(l => {
      const v = a.valides.find(x => x.id === l.vente_id)!;
      const pa = d.cout.get(l.id);
      return {
        'Vente n°': l.vente_id, Date: dateExcel(v.date_vente, tz), Produit: d.produit.get(l.produit_id) || 'Produit supprimé', Vendeuse: qui(v.vendeuse_id),
        'Quantité': N(l.quantite), [`Prix unitaire (${dev})`]: N(l.prix_unitaire), [`Total (${dev})`]: N(l.prix_unitaire) * N(l.quantite),
        [`Prix d'achat (${dev})`]: pa ?? '', [`Bénéfice (${dev})`]: pa === undefined ? '' : (N(l.prix_unitaire) - pa) * N(l.quantite),
      };
    }) },
    { nom: 'Par vendeuse', lignes: a.parVendeuse.map(v => ({
      Vendeuse: v.nom, Ventes: v.nb, Articles: v.articles, [`CA (${dev})`]: v.ca, [`Payé (${dev})`]: v.encaisse, [`Reste (${dev})`]: v.reste,
      [`Panier moyen (${dev})`]: v.nb ? Math.round(v.ca / v.nb) : 0,
    })) },
    { nom: 'Par produit', lignes: a.parProduit.map(p => ({
      Produit: p.nom, 'Quantité': p.quantite, [`CA (${dev})`]: p.ca, [`Coût d'achat (${dev})`]: p.caCouvert ? Math.round(p.cout) : '',
      [`Bénéfice (${dev})`]: p.caCouvert ? Math.round(p.benefice) : '', 'Marge (%)': p.caCouvert ? Math.round((p.benefice / p.caCouvert) * 1000) / 10 : '',
    })) },
    { nom: 'Encaissements', lignes: d.paiements.map(p => {
      const v = ventes.find(x => x.id === p.vente_id) || d.venteHorsPeriode.get(p.vente_id);
      return {
        Date: dateExcel(p.created_at, tz), 'Vente n°': p.vente_id, Client: client(v?.cliente_id ?? null)?.nom || 'Client de passage',
        Mode: MODES[p.mode] || p.mode, [`Montant (${dev})`]: N(p.montant), 'Encaissé par': qui(p.encaisse_par),
        Nature: v && ventes.some(x => x.id === p.vente_id) && Math.abs(new Date(p.created_at).getTime() - new Date(v.date_vente).getTime()) < 120000 ? 'À la vente' : 'Règlement de dette',
      };
    }) },
    { nom: 'Ventes annulées', lignes: a.annulees.map(v => ({
      'N°': v.id, 'Date de vente': dateExcel(v.date_vente, tz), "Date d'annulation": dateExcel(v.annulee_le, tz),
      Client: client(v.cliente_id)?.nom || 'Client de passage', Vendeuse: qui(v.vendeuse_id), [`Montant (${dev})`]: N(v.total),
      'Annulée par': qui(v.annulee_par), Motif: v.motif_annulation || '',
    })) },
  ];
}

// ─── Exports independants de la periode ───────────────────────────────
export async function feuilleStock(dev: string, seuil: number): Promise<Feuille[]> {
  const [produits, couts] = await Promise.all([
    toutLire<any>(() => supabase.from('produits').select('id, nom, prix, stock_restant, actif').order('nom').order('id')),
    toutLire<any>(() => supabase.from('produits_couts').select('produit_id, prix_achat').order('produit_id')),
  ]);
  const pa = new Map<number, number>(couts.map(c => [c.produit_id, N(c.prix_achat)]));
  const lignes = produits.map(p => {
    const stock = Math.max(0, N(p.stock_restant)), achat = pa.get(p.id);
    return {
      Produit: p.nom, 'En vente': p.actif ? 'Oui' : 'Retiré', Stock: N(p.stock_restant),
      Alerte: N(p.stock_restant) <= 0 ? 'Épuisé' : N(p.stock_restant) <= seuil ? 'Stock bas' : '',
      [`Prix de vente (${dev})`]: N(p.prix), [`Prix d'achat (${dev})`]: achat ?? '',
      [`Marge unitaire (${dev})`]: achat === undefined ? '' : N(p.prix) - achat,
      [`Valeur au prix de vente (${dev})`]: stock * N(p.prix), [`Valeur au prix d'achat (${dev})`]: achat === undefined ? '' : stock * achat,
    };
  });
  const total = (k: string) => lignes.reduce((a, l) => a + N((l as any)[k]), 0);
  lignes.push({ Produit: 'TOTAL', 'En vente': '', Stock: total('Stock'), Alerte: '', [`Prix de vente (${dev})`]: '', [`Prix d'achat (${dev})`]: '', [`Marge unitaire (${dev})`]: '',
    [`Valeur au prix de vente (${dev})`]: total(`Valeur au prix de vente (${dev})`), [`Valeur au prix d'achat (${dev})`]: total(`Valeur au prix d'achat (${dev})`) } as any);
  return [{ nom: 'Stock', lignes }];
}

export async function feuilleDettes(dev: string, tz: string): Promise<Feuille[]> {
  const ventes = await toutLire<any>(() => supabase.from('ventes').select('id, date_vente, total, montant_paye, reste_a_payer, vendeuse_id, cliente_id')
    .eq('annulee', false).gt('reste_a_payer', 0).order('date_vente').order('id'));
  const [clients, users] = await Promise.all([
    lireParIds<any>('clientes', 'id, nom, telephone', 'id', ventes.map(v => v.cliente_id)),
    lireParIds<any>('utilisateurs', 'id, nom', 'id', ventes.map(v => v.vendeuse_id)),
  ]);
  const c = new Map(clients.map(x => [x.id, x])), u = new Map(users.map(x => [x.id, x.nom]));
  const maintenant = Date.now();
  const detail = ventes.map(v => ({
    'Vente n°': v.id, Date: dateExcel(v.date_vente, tz), Client: c.get(v.cliente_id)?.nom || 'Client de passage', 'Téléphone': c.get(v.cliente_id)?.telephone || '',
    Vendeuse: u.get(v.vendeuse_id) || '', [`Total (${dev})`]: N(v.total), [`Déjà payé (${dev})`]: N(v.montant_paye), [`Reste dû (${dev})`]: N(v.reste_a_payer),
    'Ancienneté (jours)': Math.floor((maintenant - new Date(v.date_vente).getTime()) / 86400000),
  }));
  const parClient = new Map<string, { Client: string; 'Téléphone': string; Ventes: number; du: number; plusAncienne: number }>();
  detail.forEach(l => {
    const k = `${l.Client}|${l['Téléphone']}`;
    const x = parClient.get(k) || { Client: l.Client, 'Téléphone': l['Téléphone'], Ventes: 0, du: 0, plusAncienne: 0 };
    x.Ventes++; x.du += l[`Reste dû (${dev})`] as number; x.plusAncienne = Math.max(x.plusAncienne, l['Ancienneté (jours)']);
    parClient.set(k, x);
  });
  return [
    { nom: 'Par client', lignes: [...parClient.values()].sort((a, b) => b.du - a.du).map(x => ({ Client: x.Client, 'Téléphone': x['Téléphone'], 'Ventes non soldées': x.Ventes, [`Total dû (${dev})`]: x.du, 'Plus ancienne (jours)': x.plusAncienne })) },
    { nom: 'Détail des dettes', lignes: detail },
  ];
}

export async function feuilleMouvements(b: Bornes, tz: string): Promise<Feuille[]> {
  const mvts = await toutLire<any>(() => dansPeriode(supabase.from('mouvements_stock').select('id, produit_id, type, quantite, stock_apres, vente_id, facture_id, utilisateur_id, motif, cree_le') as any, 'cree_le', b)
    .order('cree_le').order('id'));
  const [produits, users] = await Promise.all([
    lireParIds<any>('produits', 'id, nom', 'id', mvts.map(m => m.produit_id)),
    lireParIds<any>('utilisateurs', 'id, nom', 'id', mvts.map(m => m.utilisateur_id)),
  ]);
  const p = new Map(produits.map(x => [x.id, x.nom])), u = new Map(users.map(x => [x.id, x.nom]));
  return [{ nom: 'Mouvements de stock', lignes: mvts.map(m => ({
    Date: dateExcel(m.cree_le, tz), Produit: p.get(m.produit_id) || '', Type: TYPES_MVT[m.type] || m.type,
    'Entrée / sortie': N(m.quantite), 'Stock après': N(m.stock_apres), Par: u.get(m.utilisateur_id) || '',
    'Vente n°': m.vente_id ?? '', 'Facture n°': m.facture_id ?? '', Motif: m.motif || '',
  })) }];
}

export async function feuilleJournal(b: Bornes, tz: string): Promise<Feuille[]> {
  const j = await toutLire<LigneJournal>(() => dansPeriode(supabase.from('journal_activite').select('id, action, gravite, utilisateur_nom, approuve_nom, details, montant, cree_le') as any, 'cree_le', b)
    .order('cree_le').order('id'));
  const GRAV: Record<string, string> = { info: 'Info', attention: 'Attention', alerte: 'Alerte' };
  return [{ nom: 'Journal', lignes: j.map(x => ({
    Date: dateExcel(x.cree_le, tz), 'Gravité': GRAV[x.gravite] || x.gravite, Qui: x.utilisateur_nom || 'Système',
    'Événement': decrireEvenement(x), 'Validé par': x.approuve_nom || '', Montant: x.montant ?? '',
  })) }];
}

// ─── PDF ──────────────────────────────────────────────────────────────
export async function telechargerPdf(b: Bornes, a: ReturnType<typeof agreger>, dev: string, tz: string, boutique: string, detteTotale: number, fichier: string) {
  const { jsPDF } = await import('jspdf');
  const doc = new jsPDF({ unit: 'mm', format: 'a4' });
  const M = 15, W = doc.internal.pageSize.getWidth(), H = doc.internal.pageSize.getHeight();
  let y = 18;
  const saut = (h = 6) => { if (y + h > H - 16) { doc.addPage(); y = 18; } };
  const titre = (t: string) => {
    saut(16); y += 3;
    doc.setFont('helvetica', 'bold'); doc.setFontSize(12); doc.setTextColor(29, 79, 208); doc.text(t, M, y);
    y += 2.5; doc.setDrawColor(220, 226, 238); doc.line(M, y, W - M, y); y += 5.5;
  };
  // Tableau simple : colonnes [libelle, ...valeurs alignees a droite].
  const tableau = (entetes: string[], lignes: (string | number)[][], largeurs: number[]) => {
    const xs: number[] = []; let x = M; largeurs.forEach(l => { xs.push(x); x += l; });
    const ecrire = (cells: (string | number)[], gras: boolean, couleur: number) => {
      saut(); doc.setFont('helvetica', gras ? 'bold' : 'normal'); doc.setFontSize(9); doc.setTextColor(couleur);
      cells.forEach((c, i) => {
        const txt = String(c);
        if (i === 0) doc.text(doc.splitTextToSize(txt, largeurs[0] - 2)[0], xs[0], y);
        else doc.text(txt, xs[i] + largeurs[i], y, { align: 'right' });
      });
      y += 5.5;
    };
    ecrire(entetes, true, 110);
    if (lignes.length === 0) ecrire(['Aucune donnée', ...entetes.slice(1).map(() => '')], false, 140);
    lignes.forEach(l => ecrire(l, false, 40));
  };
  const ligne = (g: string, d: string, gras = false) => {
    saut(); doc.setFont('helvetica', gras ? 'bold' : 'normal'); doc.setFontSize(10); doc.setTextColor(40);
    doc.text(g, M, y); doc.text(d, W - M, y, { align: 'right' }); y += 6;
  };

  doc.setFont('helvetica', 'bold'); doc.setFontSize(19); doc.setTextColor(26, 36, 56); doc.text(boutique, M, y); y += 7;
  doc.setFont('helvetica', 'normal'); doc.setFontSize(11); doc.setTextColor(90); doc.text(`Rapport d'activité — ${b.libelle}`, M, y); y += 5.5;
  doc.setFontSize(9); doc.setTextColor(130); doc.text(`${b.plage}   ·   Édité le ${new Date().toLocaleString('fr-FR', { timeZone: tz, dateStyle: 'medium', timeStyle: 'short' })}`, M, y); y += 4;

  titre('Synthèse');
  ligne('Nombre de ventes', `${a.nb} (${fmtPdf(a.articles)} articles)`);
  ligne("Chiffre d'affaires", `${fmtPdf(a.ca)} ${dev}`, true);
  ligne('Bénéfice', a.caCouvert > 0 ? `${fmtPdf(a.benefice)} ${dev}  (marge ${Math.round((a.benefice / a.caCouvert) * 100)} %)` : "prix d'achat non renseignés", true);
  if (a.caCouvert > 0 && a.caCouvert < a.caLignes - 0.5) ligne('', `calculé sur ${Math.round((a.caCouvert / a.caLignes) * 100)} % du CA (prix d'achat manquants)`);
  ligne('Panier moyen', `${fmtPdf(a.nb ? a.ca / a.nb : 0)} ${dev}`);
  ligne('Reste dû sur les ventes de la période', `${fmtPdf(a.reste)} ${dev}`);
  ligne('Encaissements reçus pendant la période', `${fmtPdf(a.totalEncaissements)} ${dev}`);
  ligne('Dettes clients en cours (toutes périodes)', `${fmtPdf(detteTotale)} ${dev}`);
  if (a.annulees.length) ligne('Ventes annulées', `${a.annulees.length} (${fmtPdf(a.montantAnnule)} ${dev})`);

  titre('Par vendeuse');
  tableau(['Vendeuse', 'Ventes', 'Articles', `CA (${dev})`, `Reste (${dev})`],
    a.parVendeuse.map(v => [v.nom, v.nb, fmtPdf(v.articles), fmtPdf(v.ca), fmtPdf(v.reste)]), [70, 22, 25, 35, 28]);

  titre('Par produit');
  tableau(['Produit', 'Qté', `CA (${dev})`, `Bénéfice (${dev})`, 'Marge'],
    a.parProduit.map(p => [p.nom, fmtPdf(p.quantite), fmtPdf(p.ca), p.caCouvert ? fmtPdf(p.benefice) : '—', p.caCouvert ? `${Math.round((p.benefice / p.caCouvert) * 100)} %` : '—']), [78, 20, 32, 32, 18]);

  titre('Encaissements reçus par mode de paiement');
  tableau(['Mode', `Montant (${dev})`], [...a.encaissements.map(e => [MODES[e.mode] || e.mode, fmtPdf(e.total)]), ['TOTAL', fmtPdf(a.totalEncaissements)]], [130, 50]);

  if (a.annulees.length) {
    titre('Ventes annulées');
    tableau(['Vente', 'Date', `Montant (${dev})`], a.annulees.map(v => [`n° ${v.id}${v.motif_annulation ? ` — ${v.motif_annulation}` : ''}`, fmtDate(v.date_vente, tz), fmtPdf(v.total)]), [110, 35, 35]);
  }

  const pages = doc.getNumberOfPages();
  for (let i = 1; i <= pages; i++) {
    doc.setPage(i); doc.setFont('helvetica', 'normal'); doc.setFontSize(8); doc.setTextColor(150);
    doc.text(`${boutique} · ${b.libelle} · page ${i}/${pages} · Fallik`, W / 2, H - 8, { align: 'center' });
  }
  doc.save(fichier);
}
