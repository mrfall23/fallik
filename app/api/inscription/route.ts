import { NextResponse } from 'next/server';
import { createClient } from '@supabase/supabase-js';

// Inscription d'une nouvelle boutique (organisation) + son premier compte admin.
// Route publique (pas encore de session) mais qui utilise la cle secrete cote
// serveur uniquement. Cree, dans l'ordre : compte auth -> organisation ->
// utilisateur admin. Annule tout si une etape echoue (pas de compte orphelin).

function clientAdmin() {
  return createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.SUPABASE_SECRET_KEY as string,
    { auth: { autoRefreshToken: false, persistSession: false } },
  );
}

// Slug simple : lettres/chiffres, le reste devient un tiret. Les caracteres
// accentues sont simplement retires (le slug porte un suffixe aleatoire).
function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '').slice(0, 40);
}

export async function POST(request: Request) {
  const { nomBoutique, nom, email, motDePasse } = await request.json().catch(() => ({}));

  if (!nomBoutique?.trim() || !nom?.trim() || !email?.trim() || !motDePasse?.trim()) {
    return NextResponse.json({ message: 'Tous les champs sont obligatoires.' }, { status: 400 });
  }
  if (motDePasse.length < 6) {
    return NextResponse.json({ message: 'Le mot de passe doit faire au moins 6 caractères.' }, { status: 400 });
  }

  const admin = clientAdmin();
  const emailNorm = email.trim().toLowerCase();

  // 1) Compte d'authentification
  const { data: cree, error: eAuth } = await admin.auth.admin.createUser({
    email: emailNorm,
    password: motDePasse,
    email_confirm: true,
    user_metadata: { nom: nom.trim() },
    app_metadata: { role: 'admin' },
  });
  if (eAuth || !cree?.user) {
    const pris = /already|exists|registered/i.test(eAuth?.message || '');
    return NextResponse.json(
      { message: pris ? 'Cet email est déjà utilisé.' : 'Erreur lors de la création du compte.' },
      { status: pris ? 409 : 500 },
    );
  }

  // 2) Organisation (la boutique)
  const slug = (slugify(nomBoutique) || 'boutique') + '-' + Math.random().toString(36).slice(2, 6);
  const { data: org, error: eOrg } = await admin
    .from('organisations')
    .insert({ nom: nomBoutique.trim(), slug })
    .select('id')
    .single();
  if (eOrg || !org) {
    await admin.auth.admin.deleteUser(cree.user.id);
    return NextResponse.json({ message: 'Erreur lors de la création de la boutique.' }, { status: 500 });
  }

  // 3) Utilisateur admin (proprietaire)
  const { error: eUser } = await admin.from('utilisateurs').insert({
    organisation_id: org.id,
    auth_id: cree.user.id,
    nom: nom.trim(),
    email: emailNorm,
    role: 'admin',
    actif: true,
  });
  if (eUser) {
    // Rollback : pas de compte auth ni d'organisation orphelins.
    await admin.from('organisations').delete().eq('id', org.id);
    await admin.auth.admin.deleteUser(cree.user.id);
    const pris = eUser.code === '23505';
    return NextResponse.json(
      { message: pris ? 'Cet email est déjà utilisé.' : 'Erreur lors de la création du profil.' },
      { status: pris ? 409 : 500 },
    );
  }

  return NextResponse.json({ message: 'Boutique créée.' }, { status: 201 });
}
