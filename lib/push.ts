import webpush from 'web-push';
import { createClient } from '@supabase/supabase-js';
import { VAPID_PUBLIC_KEY } from './vapid';

// Envoi des notifications Web Push cote serveur. Les cles VAPID viennent des
// variables d'environnement (VAPID_PRIVATE_KEY reste secrete, la publique est
// aussi utilisee cote navigateur). Sans ces cles, la fonction ne fait rien.

let configure = false;
function configurer() {
  if (configure) return;
  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT || 'mailto:andrembarga98@gmail.com',
    VAPID_PUBLIC_KEY,
    process.env.VAPID_PRIVATE_KEY as string,
  );
  configure = true;
}

// Client a cle secrete : contourne RLS pour lire les abonnements et purger
// ceux qui ont expire.
function clientAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

type InfosVente = { organisationId: number; vendeuse: string; cliente: string; total: number; statut: string };

type Message = { title: string; body: string; tag: string; url: string };

/**
 * Envoie un message aux appareils abonnes DE CETTE BOUTIQUE uniquement
 * (filtre strict par organisation_id). Best-effort.
 */
export async function notifierOrganisation(organisationId: number, messages: Message[]) {
  if (!process.env.VAPID_PRIVATE_KEY) return; // pas de cle privee -> notifications desactivees
  if (!organisationId || messages.length === 0) return; // pas d'organisation -> personne (securite)
  configurer();

  const admin = clientAdmin();
  const { data: abos } = await admin
    .from('push_subscriptions')
    .select('id, endpoint, p256dh, auth')
    .eq('organisation_id', organisationId);
  if (!abos || abos.length === 0) return;

  const morts = new Set<number>();
  for (const m of messages) {
    const payload = JSON.stringify(m);
    await Promise.all(
      abos.filter((a: any) => !morts.has(a.id)).map(async (a: any) => {
        try {
          await webpush.sendNotification({ endpoint: a.endpoint, keys: { p256dh: a.p256dh, auth: a.auth } }, payload);
        } catch (e: any) {
          // 404 / 410 : l'abonnement n'existe plus cote navigateur -> on le retire.
          if (e?.statusCode === 404 || e?.statusCode === 410) morts.add(a.id);
        }
      }),
    );
  }
  if (morts.size) await admin.from('push_subscriptions').delete().in('id', [...morts]);
}

/** Notifie la boutique d'une nouvelle vente. */
export async function notifierVente(v: InfosVente) {
  const statutTxt = v.statut === 'paye' ? 'payé' : 'partiel';
  await notifierOrganisation(v.organisationId, [{
    title: '🛍️ Nouvelle vente',
    body: `${v.vendeuse} : ${v.total.toLocaleString('fr-FR')} FCFA — ${v.cliente} (${statutTxt})`,
    tag: 'vente',
    url: '/admin',
  }]);
}
