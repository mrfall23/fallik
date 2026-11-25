// Envoi des alertes d'une boutique : notifications push (appareils abonnes de
// la boutique). Serveur uniquement (cle secrete). Best-effort : n'echoue jamais.
//
// Sources :
//   - alertes_file   : nouvelles ventes (rapides ET factures encaissees),
//                      produits qui passent sous le seuil de stock ;
//   - journal_activite non encore signale : actions sensibles (gravite
//     « attention » ou « alerte »).
import { clientService } from '@/lib/caisse-serveur';
import { notifierOrganisation } from '@/lib/push';
import { decrireEvenement, type LigneJournal } from '@/lib/journal';

const n = (x: unknown) => Number(x) || 0;
const montant = (x: unknown, dev: string) => `${Math.round(n(x)).toLocaleString('fr-FR').replace(/[  ]/g, ' ')} ${dev}`;

type Reglages = { ventes: boolean; stock_bas: boolean; actions_sensibles: boolean; resume_soir: boolean };
type Boutique = { id: number; nom: string; devise: string; fuseau_horaire: string };
type Push = { title: string; body: string; tag: string; url: string };

async function contexte(service: ReturnType<typeof clientService>, org: number) {
  const [{ data: r }, { data: b }] = await Promise.all([
    service.from('reglages_alertes').select('ventes, stock_bas, actions_sensibles, resume_soir').eq('organisation_id', org).maybeSingle(),
    service.from('organisations').select('id, nom, devise, fuseau_horaire').eq('id', org).single(),
  ]);
  const reglages: Reglages = r || { ventes: true, stock_bas: true, actions_sensibles: true, resume_soir: true };
  return { reglages, boutique: b as Boutique | null };
}

async function diffuser(org: number, push: Push[]) {
  if (push.length) await notifierOrganisation(org, push).catch(e => console.error('[alertes] push :', e));
}

/** Vide la file d'alertes et le journal non signale d'une boutique. */
export async function envoyerAlertes(org: number) {
  try {
    const service = clientService();
    const { reglages, boutique } = await contexte(service, org);
    if (!boutique) return;
    const dev = boutique.devise || 'FCFA';
    const push: Push[] = [];

    // 1. File : ventes et stock bas.
    const { data } = await service.rpc('alertes_a_envoyer', { p_org: org });
    const file = (data || []) as { type: string; ref: number | string }[];
    const ventesIds = file.filter(f => f.type === 'vente').map(f => Number(f.ref));
    const stockIds = file.filter(f => f.type === 'stock_bas').map(f => Number(f.ref));

    if (reglages.ventes && ventesIds.length) {
      const { data: ventes } = await service.from('ventes')
        .select('id, total, reste_a_payer, annulee, vendeuse_id, cliente_id')
        .in('id', ventesIds.slice(0, 30)).eq('organisation_id', org).order('id');
      const vv = (ventes || []).filter(v => !v.annulee);
      if (vv.length) {
        const [{ data: clients }, { data: users }] = await Promise.all([
          service.from('clientes').select('id, nom').in('id', vv.map(v => v.cliente_id).filter(Boolean) as number[]),
          service.from('utilisateurs').select('id, nom').in('id', vv.map(v => v.vendeuse_id).filter(Boolean) as number[]),
        ]);
        for (const v of vv) {
          const cli = (clients || []).find(c => c.id === v.cliente_id);
          const vendeuse = (users || []).find(u => u.id === v.vendeuse_id)?.nom || 'Une vendeuse';
          const reste = n(v.reste_a_payer);
          push.push({
            title: reste > 0 ? '🛍️ Vente à crédit' : '🛍️ Nouvelle vente',
            body: `${vendeuse} : ${montant(v.total, dev)} — ${cli?.nom || 'client de passage'}${reste > 0 ? ` (reste ${montant(reste, dev)})` : ''}`,
            tag: `vente-${v.id}`, url: '/admin/ventes',
          });
        }
      }
    }

    if (reglages.stock_bas && stockIds.length) {
      const { data: prods } = await service.from('produits').select('nom, stock_restant').in('id', stockIds).eq('organisation_id', org).order('stock_restant');
      if (prods?.length) {
        const lignes = prods.map(p => `${p.nom} : ${p.stock_restant <= 0 ? 'ÉPUISÉ' : `${p.stock_restant} restant${p.stock_restant > 1 ? 's' : ''}`}`);
        push.push({ title: '📦 Stock bas', body: lignes.join(' · ').slice(0, 180), tag: 'stock-bas', url: '/admin/produits' });
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
      const aSignaler = reglages.actions_sensibles ? sensibles : sensibles.filter(j => j.action === 'alertes_modifiees');
      aSignaler.slice(0, 10).forEach(j => push.push({
        title: j.gravite === 'alerte' ? '⚠️ Alerte boutique' : '🔔 À vérifier', body: decrireEvenement(j), tag: `journal-${j.id}`, url: '/admin/journal',
      }));
    }

    await diffuser(org, push);
  } catch (e) {
    console.error('[alertes] envoi echoue :', e);
  }
}

/** Resume de la journee (envoye le soir par la tache planifiee). */
export async function envoyerResume(org: number): Promise<boolean> {
  const service = clientService();
  const { reglages, boutique } = await contexte(service, org);
  if (!boutique || !reglages.resume_soir) return false;
  const { data: r, error } = await service.rpc('resume_du_jour', { p_org: org });
  if (error || !r) return false;
  const dev = boutique.devise || 'FCFA';
  const v = r.ventes || {}, b = r.benefice || {};
  await diffuser(org, [{
    title: '📊 Résumé du jour',
    body: `${montant(v.ca, dev)} sur ${n(v.nb)} vente${n(v.nb) > 1 ? 's' : ''}${n(b.ca_couvert) > 0 ? ` · bénéfice ${montant(b.benefice, dev)}` : ''}`,
    tag: 'resume', url: '/admin',
  }]);
  return true;
}
