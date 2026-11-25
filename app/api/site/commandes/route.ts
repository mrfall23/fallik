import { NextResponse, after } from 'next/server';
import { clientService } from '@/lib/caisse-serveur';
import { envoyerAlertes } from '@/lib/alertes';
import { CORS, cleDeLaRequete, empreinte, empreinteIp } from '@/lib/site-web';

// Commande deposee par le site d'une boutique Pro. Elle arrive dans Fallik en
// « commande en ligne » ; le stock n'est decompte qu'a la validation du gerant.
// Corps : { client: { nom, telephone, adresse?, note? }, lignes: [{ produit_id, quantite }] }
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function POST(request: Request) {
  const cle = cleDeLaRequete(request);
  if (!cle) return NextResponse.json({ ok: false, erreur: 'Clé manquante.' }, { status: 401, headers: CORS });
  const corps = await request.json().catch(() => null);
  if (!corps || typeof corps !== 'object') return NextResponse.json({ ok: false, erreur: 'Requête invalide.' }, { status: 400, headers: CORS });

  const { data, error } = await clientService().rpc('site_commander', {
    p_cle_hash: empreinte(cle),
    p_client: corps.client ?? {},
    p_lignes: Array.isArray(corps.lignes) ? corps.lignes : [],
    p_ip_hash: empreinteIp(request),
  });
  if (error || !data) return NextResponse.json({ ok: false, erreur: 'Service indisponible.' }, { status: 503, headers: CORS });
  if (!data.ok) return NextResponse.json({ ok: false, erreur: data.erreur }, { status: 400, headers: CORS });

  const org = Number(data.organisation_id);
  after(() => envoyerAlertes(org));
  return NextResponse.json({ ok: true, reference: data.reference, total: data.total }, { headers: CORS });
}
