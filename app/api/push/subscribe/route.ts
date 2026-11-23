import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { accesGestion } from '@/lib/acces-serveur';

// Enregistre / supprime l'abonnement Web Push de l'admin.
// Reserve a l'admin : c'est la seule personne censee recevoir les alertes.

function clientAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Renvoie { id, organisationId } si l'appelant est un admin actif, sinon null.
async function adminProfil(): Promise<{ id: number; organisationId: number } | null> {
  const acces = await accesGestion();
  if (!acces) return null;
  return { id: acces.utilisateur_id, organisationId: acces.organisation_id };
}

export async function POST(request: Request) {
  const profil = await adminProfil();
  if (!profil) return NextResponse.json({ message: 'Acces refuse.' }, { status: 403 });

  const sub = await request.json().catch(() => null);
  const endpoint = sub?.endpoint;
  const p256dh = sub?.keys?.p256dh;
  const auth = sub?.keys?.auth;
  if (!endpoint || !p256dh || !auth) {
    return NextResponse.json({ message: 'Abonnement invalide.' }, { status: 400 });
  }

  const admin = clientAdmin();
  const { error } = await admin.from('push_subscriptions').upsert(
    { utilisateur_id: profil.id, organisation_id: profil.organisationId, endpoint, p256dh, auth },
    { onConflict: 'endpoint' },
  );
  if (error) return NextResponse.json({ message: 'Erreur enregistrement.' }, { status: 500 });

  return NextResponse.json({ message: 'Notifications activees.' });
}

export async function DELETE(request: Request) {
  const profil = await adminProfil();
  if (!profil) return NextResponse.json({ message: 'Acces refuse.' }, { status: 403 });

  const { endpoint } = await request.json().catch(() => ({}));
  if (endpoint) {
    const admin = clientAdmin();
    await admin.from('push_subscriptions').delete().eq('endpoint', endpoint);
  }
  return NextResponse.json({ message: 'Notifications desactivees.' });
}
