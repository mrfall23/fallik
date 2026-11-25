import { NextResponse } from 'next/server';
import { clientService } from '@/lib/caisse-serveur';
import { CORS, cleDeLaRequete, empreinte } from '@/lib/site-web';

// Catalogue public d'une boutique Pro : produits actifs, prix, stock.
export function OPTIONS() {
  return new NextResponse(null, { status: 204, headers: CORS });
}

export async function GET(request: Request) {
  const cle = cleDeLaRequete(request);
  if (!cle) return NextResponse.json({ erreur: 'Clé manquante.' }, { status: 401, headers: CORS });
  const { data, error } = await clientService().rpc('site_catalogue', { p_cle_hash: empreinte(cle) });
  if (error) return NextResponse.json({ erreur: 'Service indisponible.' }, { status: 503, headers: CORS });
  if (!data) return NextResponse.json({ erreur: 'Clé invalide ou site désactivé.' }, { status: 403, headers: CORS });
  return NextResponse.json(data, { headers: { ...CORS, 'Cache-Control': 's-maxage=15, stale-while-revalidate=30' } });
}
