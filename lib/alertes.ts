// Envoi des alertes d'une boutique : notifications push (appareils abonnes de
// la boutique) + Telegram (conversation reliee par le proprietaire).
// Serveur uniquement (cle secrete). Best-effort : n'echoue jamais.
//
// Sources :
//   - alertes_file   : nouvelles ventes (rapides ET factures encaissees),
//                      produits qui passent sous le seuil de stock ;
//   - journal_activite non encore signale : actions sensibles (gravite
//     « attention » ou « alerte »).
import { clientService } from '@/lib/caisse-serveur';
import { notifierOrganisation } from '@/lib/push';
import { envoyerTelegram, telegramActif } from '@/lib/telegram';
import { decrireEvenement, type LigneJournal } from '@/lib/journal';

const MODES: Record<string, string> = { cash: 'Espèces', mobile_money: 'Mobile Money', orange_money: 'Orange Money', carte: 'Carte', autre: 'Autre' };
const n = (x: unknown) => Number(x) || 0;
const montant = (x: unknown, dev: string) => `${Math.round(n(x)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} ${dev}`;

type Reglages = { ventes: boolean; stock_bas: boolean; actions_sensibles: boolean; resume_soir: boolean; telegram_chat_id: string | null };
type Boutique = { id: number; nom: string; devise: string; fuseau_horaire: string };
type Push = { title: string; body: string; tag: string; url: string };

async function contexte(service: ReturnType<typeof clientService>, org: number) {
  const [{ data: r }, { data: b }] = await Promise.all([
    service.from('reglages_alertes').select('ventes, stock_bas, actions_sensibles, resume_soir, telegram_chat_id').eq('organisation_id', org).maybeSingle(),
    service.from('organisations').select('id, nom, devise, fuseau_horaire').eq('id', org).single(),
  ]);
  const reglages: Reglages = r || { ventes: true, stock_bas: true, actions_sensibles: true, resume_soir: true, telegram_chat_id: null };
  return { reglages, boutique: b as Boutique | null };
}

async function diffuser(org: number, reglages: Reglages, push: Push[], telegram: string[]) {
  await Promise.all([
    push.length ? notifierOrganisation(org, push).catch(e => console.error('[alertes] push :', e)) : null,
    telegramActif() && reglages.telegram_chat_id
      ? (async () => { for (const t of telegram) await envoyerTelegram(reglages.telegram_chat_id!, t); })()
      : null,
  ]);
}

/** Vide la file d'alertes et le journal non signale d'une boutique. */
export async function envoyerAlertes(org: number, site: string) {
  try {
    const service = clientService();
    const { reglages, boutique } = await contexte(service, org);
    if (!boutique) return;
    const dev = boutique.devise || 'FCFA';
    const push: Push[] = [], telegram: string[] = [];

    // 1. File : ventes et stock bas.
    const { data: file } = await service.rpc('alertes_a_envoyer', { p_org: org });
    const ventesIds = (file || []).filter((f: any) => f.type === 'vente').map((f: any) => Number(f.ref));
    const stockIds = (file || []).filter((f: any) => f.type === 'stock_bas').map((f: any) => Number(f.ref));

    if (reglages.ventes && ventesIds.length) {
      const { data: ventes } = await service.from('ventes')
        .select('id, total, montant_paye, reste_a_payer, statut_paiement, annulee, vendeuse_id, cliente_id, organisation_id')
        .in('id', ventesIds.slice(0, 30)).eq('organisation_id', org).order('id');
      const vv = (ventes || []).filter(v => !v.annulee);
      if (vv.length) {
        const [{ data: lignes }, { data: clients }, { data: users }, { data: paiements }] = await Promise.all([
          service.from('vente_produits').select('vente_id, produit_id, quantite, prix_unitaire').in('vente_id', vv.map(v => v.id)),
          service.from('clientes').select('id, nom, telephone').in('id', vv.map(v => v.cliente_id).filter(Boolean) as number[]),
          service.from('utilisateurs').select('id, nom').in('id', vv.map(v => v.vendeuse_id).filter(Boolean) as number[]),
          service.from('paiements').select('vente_id, mode').in('vente_id', vv.map(v => v.id)),
        ]);
        const { data: produits } = await service.from('produits').select('id, nom').in('id', (lignes || []).map(l => l.produit_id).filter(Boolean) as number[]);
        const nomP = new Map((produits || []).map(p => [p.id, p.nom]));
        for (const v of vv) {
          const cli = (clients || []).find(c => c.id === v.cliente_id);
          const vendeuse = (users || []).find(u => u.id === v.vendeuse_id)?.nom || 'Une vendeuse';
          const mode = (paiements || []).find(p => p.vente_id === v.id)?.mode || 'cash';
          const articles = (lignes || []).filter(l => l.vente_id === v.id);
          const reste = n(v.reste_a_payer);
          push.push({
            title: reste > 0 ? '🛍️ Vente à crédit' : '🛍️ Nouvelle vente',
            body: `${vendeuse} : ${montant(v.total, dev)} — ${cli?.nom || 'client de passage'}${reste > 0 ? ` (reste ${montant(reste, dev)})` : ''}`,
            tag: `vente-${v.id}`, url: '/admin/ventes',
          });
          telegram.push([
            `🛍️ ${boutique.nom} — Vente n° ${v.id}`,
            `👩 ${vendeuse}${cli ? ` · 👤 ${cli.nom}${cli.telephone ? ` (${cli.telephone})` : ''}` : ''}`,
            '',
            ...articles.slice(0, 15).map(a => `• ${a.quantite} × ${nomP.get(a.produit_id) || 'Produit'} — ${montant(n(a.prix_unitaire) * n(a.quantite), dev)}`),
            ...(articles.length > 15 ? [`• … et ${articles.length - 15} autre(s) article(s)`] : []),
            '',
            `💰 Total : ${montant(v.total, dev)}`,
            reste > 0 ? `⚠️ Payé ${montant(v.montant_paye, dev)} (${MODES[mode] || mode}) · reste dû ${montant(reste, dev)}` : `✅ Payé · ${MODES[mode] || mode}`,
          ].join('\n'));
        }
        if (ventesIds.length > 30) telegram.push(`… et ${ventesIds.length - 30} autre(s) vente(s) : ${site}/admin/ventes`);
      }
    }

    if (reglages.stock_bas && stockIds.length) {
      const { data: prods } = await service.from('produits').select('nom, stock_restant').in('id', stockIds).eq('organisation_id', org).order('stock_restant');
      if (prods?.length) {
        const lignes = prods.map(p => `${p.nom} : ${p.stock_restant <= 0 ? 'ÉPUISÉ' : `${p.stock_restant} restant${p.stock_restant > 1 ? 's' : ''}`}`);
        push.push({ title: '📦 Stock bas', body: lignes.join(' · ').slice(0, 180), tag: 'stock-bas', url: '/admin/produits' });
        telegram.push([`📦 ${boutique.nom} — Stock bas`, '', ...lignes.map(l => `• ${l}`), '', `→ Réapprovisionner : ${site}/admin/produits`].join('\n'));
      }
    }

    // 2. Journal : evenements sensibles pas encore signales.
    const { data: journal } = await service.from('journal_activite')
      .select('id, action, gravite, utilisateur_nom, approuve_nom, details, montant, cree_le')
      .eq('organisation_id', org).eq('notifie', false).order('id').limit(50);
    if (journal?.length) {
      // On marque d'abord : deux envois simultanes ne doublonnent pas.
      const { data: marques } = await service.from('journal_activite').update({ notifie: true })
        .in('id', journal.map(j => j.id)).eq('notifie', false).select('id');
      const pris = new Set((marques || []).map(m => m.id));
      const sensibles = (journal as LigneJournal[]).filter(j => pris.has(j.id) && j.gravite !== 'info');
      // Les evenements sur les alertes elles-memes partent toujours.
      const aSignaler = reglages.actions_sensibles ? sensibles : sensibles.filter(j => ['alertes_modifiees', 'telegram_delie', 'telegram_lie'].includes(j.action));
      aSignaler.slice(0, 10).forEach(j => push.push({
        title: j.gravite === 'alerte' ? '⚠️ Alerte boutique' : '🔔 À vérifier', body: decrireEvenement(j), tag: `journal-${j.id}`, url: '/admin/journal',
      }));
      if (aSignaler.length) {
        telegram.push([
          `${aSignaler.some(j => j.gravite === 'alerte') ? '⚠️' : '🔔'} ${boutique.nom} — ${aSignaler.length > 1 ? `${aSignaler.length} actions à vérifier` : 'Action à vérifier'}`,
          '',
          ...aSignaler.slice(0, 20).map(j => `${j.gravite === 'alerte' ? '🔴' : '🟠'} ${decrireEvenement(j)}`),
          '',
          `→ Journal : ${site}/admin/journal`,
        ].join('\n'));
      }
    }

    await diffuser(org, reglages, push, telegram);
  } catch (e) {
    console.error('[alertes] envoi echoue :', e);
  }
}

/** Resume de la journee (envoye le soir par la tache planifiee). */
export async function envoyerResume(org: number, site: string): Promise<boolean> {
  const service = clientService();
  const { reglages, boutique } = await contexte(service, org);
  if (!boutique || !reglages.resume_soir) return false;
  const { data: r, error } = await service.rpc('resume_du_jour', { p_org: org });
  if (error || !r) return false;
  const dev = boutique.devise || 'FCFA';
  const v = r.ventes || {}, b = r.benefice || {}, c = r.clotures || {}, a = r.annulees || {};
  const jour = new Date(`${r.jour}T12:00:00`).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
  const lignes = [
    `📊 ${boutique.nom} — Résumé du ${jour}`,
    '',
    `💰 Chiffre d'affaires : ${montant(v.ca, dev)} (${n(v.nb)} vente${n(v.nb) > 1 ? 's' : ''})`,
    ...(n(b.ca_couvert) > 0 ? [`📈 Bénéfice : ${montant(b.benefice, dev)}${n(b.ca_couvert) < n(v.ca) - 0.5 ? ' (prix d\'achat incomplets)' : ''}`] : []),
    ...((r.encaissements || []).length ? ['', '💵 Encaissé :', ...(r.encaissements as any[]).map(e => `• ${MODES[e.mode] || e.mode} : ${montant(e.total, dev)}`)] : []),
    ...((r.vendeuses || []).length ? ['', '👩 Vendeuses :', ...(r.vendeuses as any[]).map(x => `• ${x.nom} : ${montant(x.ca, dev)} (${n(x.nb)})`)] : []),
    ...((r.top_produits || []).length ? ['', '🏆 Plus vendus : ' + (r.top_produits as any[]).map(p => `${p.nom} (${n(p.quantite)})`).join(', ')] : []),
    '',
    ...(n(v.reste) > 0 ? [`🧾 Crédit accordé aujourd'hui : ${montant(v.reste, dev)}`] : []),
    `🧾 Dettes clients en cours : ${montant(r.dettes, dev)}`,
    ...(n(a.nb) > 0 ? [`🚫 Ventes annulées : ${n(a.nb)} (${montant(a.montant, dev)})`] : []),
    ...(n(c.nb) > 0 ? [`🏧 Clôtures de caisse : ${n(c.nb)} · écart total ${n(c.ecart) === 0 ? 'aucun' : montant(c.ecart, dev)}`] : []),
    ...(n(r.alertes_journal) > 0 ? [`⚠️ ${n(r.alertes_journal)} alerte(s) au journal : ${site}/admin/journal`] : []),
    ...((r.stock_bas || []).length ? ['', '📦 Stock bas : ' + (r.stock_bas as any[]).map(s => `${s.nom} (${n(s.stock)})`).join(', ')] : []),
    '',
    `→ ${site}/admin`,
  ];
  await diffuser(org, reglages,
    [{ title: `📊 Résumé du jour`, body: `${montant(v.ca, dev)} sur ${n(v.nb)} vente${n(v.nb) > 1 ? 's' : ''}${n(b.ca_couvert) > 0 ? ` · bénéfice ${montant(b.benefice, dev)}` : ''}`, tag: 'resume', url: '/admin' }],
    [lignes.join('\n')]);
  return true;
}
