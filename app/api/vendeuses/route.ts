import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';
import { creerClientServeur } from '@/lib/supabase-server';

// Creation et modification des comptes vendeuses (multi-boutiques).
//
// Cette route utilise la cle secrete, qui CONTOURNE RLS. Elle doit donc
// verifier elle-meme que l'appelant est un admin actif ET rattacher/limiter
// les operations a SON organisation.

function clientAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

/** Renvoie l'organisation de l'appelant s'il est admin actif, sinon une reponse d'erreur. */
async function adminOrg(): Promise<{ orgId: number } | { erreur: NextResponse }> {
  const supabase = await creerClientServeur();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return { erreur: NextResponse.json({ message: 'Non authentifié.' }, { status: 401 }) };

  const { data: profil } = await supabase
    .from('utilisateurs')
    .select('role, actif, organisation_id')
    .eq('auth_id', user.id)
    .single();

  if (!profil || !profil.actif || profil.role !== 'admin') {
    return { erreur: NextResponse.json({ message: 'Accès refusé.' }, { status: 403 }) };
  }
  return { orgId: profil.organisation_id as number };
}

export async function POST(request: Request) {
  const ctx = await adminOrg();
  if ('erreur' in ctx) return ctx.erreur;

  const { nom, email, motDePasse } = await request.json();
  if (!nom?.trim() || !email?.trim() || !motDePasse?.trim()) {
    return NextResponse.json({ message: 'Tous les champs sont obligatoires.' }, { status: 400 });
  }
  if (motDePasse.length < 6) {
    return NextResponse.json({ message: 'Le mot de passe doit faire au moins 6 caractères.' }, { status: 400 });
  }

  const admin = clientAdmin();
  const emailNormalise = email.trim().toLowerCase();

  const { data: cree, error: erreurAuth } = await admin.auth.admin.createUser({
    email: emailNormalise,
    password: motDePasse,
    email_confirm: true,
    user_metadata: { nom: nom.trim() },
    app_metadata: { role: 'vendeuse' },
  });
  if (erreurAuth) {
    const dejaPris = /already|exists|registered/i.test(erreurAuth.message);
    return NextResponse.json(
      { message: dejaPris ? 'Cet email est déjà utilisé.' : 'Erreur lors de la création du compte.' },
      { status: dejaPris ? 409 : 500 },
    );
  }

  // Rattachement a l'organisation de l'admin.
  const { error: erreurLigne } = await admin.from('utilisateurs').insert({
    organisation_id: ctx.orgId,
    nom: nom.trim(),
    email: emailNormalise,
    role: 'vendeuse',
    actif: true,
    auth_id: cree.user.id,
  });
  if (erreurLigne) {
    await admin.auth.admin.deleteUser(cree.user.id);
    const dejaPris = erreurLigne.code === '23505';
    return NextResponse.json(
      { message: dejaPris ? 'Cet email est déjà utilisé.' : 'Erreur lors de la création du compte.' },
      { status: dejaPris ? 409 : 500 },
    );
  }

  return NextResponse.json({ message: 'Compte créé.' }, { status: 201 });
}

export async function PATCH(request: Request) {
  const ctx = await adminOrg();
  if ('erreur' in ctx) return ctx.erreur;

  const { id, nom, email, motDePasse } = await request.json();
  if (!id || !nom?.trim() || !email?.trim()) {
    return NextResponse.json({ message: 'Nom et email sont obligatoires.' }, { status: 400 });
  }
  if (motDePasse && motDePasse.length < 6) {
    return NextResponse.json({ message: 'Le mot de passe doit faire au moins 6 caractères.' }, { status: 400 });
  }

  const admin = clientAdmin();
  const emailNormalise = email.trim().toLowerCase();

  const { data: cible } = await admin
    .from('utilisateurs')
    .select('auth_id, role, organisation_id')
    .eq('id', id)
    .single();

  if (!cible?.auth_id) {
    return NextResponse.json({ message: 'Compte introuvable.' }, { status: 404 });
  }
  // Isolation : on ne touche qu'aux vendeuses de SA propre boutique.
  if (cible.organisation_id !== ctx.orgId || cible.role !== 'vendeuse') {
    return NextResponse.json({ message: "Ce compte n'est pas modifiable ici." }, { status: 403 });
  }

  const { error: erreurAuth } = await admin.auth.admin.updateUserById(cible.auth_id, {
    email: emailNormalise,
    ...(motDePasse ? { password: motDePasse } : {}),
    user_metadata: { nom: nom.trim() },
  });
  if (erreurAuth) {
    const dejaPris = /already|exists|registered/i.test(erreurAuth.message);
    return NextResponse.json(
      { message: dejaPris ? 'Cet email est déjà utilisé.' : 'Erreur lors de la modification.' },
      { status: dejaPris ? 409 : 500 },
    );
  }

  const { error: erreurLigne } = await admin
    .from('utilisateurs')
    .update({ nom: nom.trim(), email: emailNormalise })
    .eq('id', id);
  if (erreurLigne) {
    return NextResponse.json({ message: 'Erreur lors de la modification.' }, { status: 500 });
  }

  return NextResponse.json({ message: 'Compte mis à jour.' });
}
