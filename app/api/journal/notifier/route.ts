import { NextResponse } from 'next/server';
import { accesAppelant } from '@/lib/acces-serveur';
import { clientService } from '@/lib/caisse-serveur';
import { notifierOrganisation } from '@/lib/push';
import { decrireEvenement, type LigneJournal } from '@/lib/journal';

// Envoie au patron (notification push) les evenements sensibles du journal
// qui n'ont pas encore ete signales.
//
// N'importe quel membre connecte de la boutique peut declencher l'envoi : la
// route ne lit QUE le journal (ecrit par la base, infalsifiable) de SA boutique.
// Si une vendeuse ne l'appelle pas, l'envoi se fait au prochain appel (autre
// action, ouverture de l'espace gerant).
export async function POST() {
  const acces = await accesAppelant();
  if (!acces) return NextResponse.json({ ok: false }, { status: 401 });

  const service = clientService();
  const { data: lignes } = await service
    .from('journal_activite')
    .select('id, action, gravite, utilisateur_nom, approuve_nom, details, montant, cree_le')
    .eq('organisation_id', acces.organisation_id)
    .eq('notifie', false)
    .order('id')
    .limit(50);
  if (!lignes?.length) return NextResponse.json({ ok: true, envoyes: 0 });

  // On marque d'abord (evite les doublons si deux appels se croisent).
  const ids = lignes.map((l) => l.id);
  const { data: marques } = await service.from('journal_activite').update({ notifie: true })
    .in('id', ids).eq('notifie', false).select('id');
  const aEnvoyer = (lignes as LigneJournal[]).filter((l) => l.gravite !== 'info' && marques?.some((m) => m.id === l.id));

  try {
    await notifierOrganisation(acces.organisation_id, aEnvoyer.slice(0, 10).map((l) => ({
      title: l.gravite === 'alerte' ? '⚠️ Alerte boutique' : '🔔 À vérifier',
      body: decrireEvenement(l),
      tag: `journal-${l.id}`,
      url: '/admin/journal',
    })));
  } catch (e) {
    console.error('Notification du journal echouee :', e);
  }
  return NextResponse.json({ ok: true, envoyes: aEnvoyer.length });
}
