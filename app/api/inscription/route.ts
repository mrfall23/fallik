import { NextResponse } from 'next/server';
import { createHash } from 'crypto';
import { createClient } from '@supabase/supabase-js';
import { ACTIVITES, type TypeActivite } from '@/lib/activites';

// Inscription d'une nouvelle boutique (organisation) + son proprietaire.
// Route publique (pas encore de session) mais qui utilise la cle secrete cote
// serveur uniquement. Cree, dans l'ordre : compte auth -> organisation ->
// abonnement d'essai -> utilisateur proprietaire. Annule tout si une etape
// echoue (pas de compte orphelin).
//
// Anti-abus : champ piege invisible (les robots le remplissent) et limites
// par adresse IP et globales, tenues dans public.inscriptions_journal.

const ESSAI_JOURS = 14;
const MAX_PAR_IP_24H = 3;
const MAX_GLOBAL_1H = 30;

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

// L'IP n'est jamais stockee en clair : seulement une empreinte salee.
function empreinteIp(request: Request): string {
  const ip = (request.headers.get('x-forwarded-for') || '').split(',')[0].trim()
    || request.headers.get('x-real-ip') || 'inconnue';
  const sel = (process.env.SUPABASE_SECRET_KEY || '').slice(-16);
  return createHash('sha256').update(`${sel}:${ip}`).digest('hex');
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

export async function POST(request: Request) {
  const corps = await request.json().catch(() => ({}));
  const { nomBoutique, nom, email, motDePasse, siteWeb, typeActivite } = corps as Record<string, string | undefined>;
  const type: TypeActivite = typeActivite && typeActivite in ACTIVITES ? (typeActivite as TypeActivite) : 'boutique';

  // Champ piege : invisible pour un humain. Reponse neutre, rien n'est cree.
  if (siteWeb) return NextResponse.json({ message: 'Boutique créée.' }, { status: 201 });

  if (!nomBoutique?.trim() || !nom?.trim() || !email?.trim() || !motDePasse?.trim()) {
    return NextResponse.json({ message: 'Tous les champs sont obligatoires.' }, { status: 400 });
  }
  if (nomBoutique.trim().length > 80 || nom.trim().length > 80) {
    return NextResponse.json({ message: 'Nom trop long (80 caractères maximum).' }, { status: 400 });
  }
  if (!EMAIL_RE.test(email.trim())) {
    return NextResponse.json({ message: 'Adresse email invalide.' }, { status: 400 });
  }
  if (motDePasse.length < 8) {
    return NextResponse.json({ message: 'Le mot de passe doit faire au moins 8 caractères.' }, { status: 400 });
  }

  const admin = clientAdmin();
  const emailNorm = email.trim().toLowerCase();
  const ipHash = empreinteIp(request);

  // ── Limites anti-abus ──
  const depuis24h = new Date(Date.now() - 24 * 3600 * 1000).toISOString();
  const depuis1h = new Date(Date.now() - 3600 * 1000).toISOString();
  const [{ count: parIp, error: eLim1 }, { count: global, error: eLim2 }] = await Promise.all([
    admin.from('inscriptions_journal').select('id', { count: 'exact', head: true }).eq('ip_hash', ipHash).gte('created_at', depuis24h),
    admin.from('inscriptions_journal').select('id', { count: 'exact', head: true }).gte('created_at', depuis1h),
  ]);
  if (eLim1 || eLim2) {
    return NextResponse.json({ message: 'Inscriptions momentanément indisponibles.' }, { status: 503 });
  }
  if ((parIp ?? 0) >= MAX_PAR_IP_24H || (global ?? 0) >= MAX_GLOBAL_1H) {
    return NextResponse.json({ message: 'Trop de tentatives. Réessayez plus tard ou contactez Fall Digital.' }, { status: 429 });
  }
  // Chaque tentative compte (meme ratee) : empeche de sonder les emails en boucle.
  const { data: trace } = await admin.from('inscriptions_journal').insert({ ip_hash: ipHash }).select('id').single();

  // 1) Compte d'authentification
  const { data: cree, error: eAuth } = await admin.auth.admin.createUser({
    email: emailNorm,
    password: motDePasse,
    email_confirm: true,
    user_metadata: { nom: nom.trim() },
    app_metadata: { role: 'proprietaire' },
  });
  if (eAuth || !cree?.user) {
    const pris = /already|exists|registered/i.test(eAuth?.message || '');
    return NextResponse.json(
      { message: pris ? 'Cet email est déjà utilisé.' : 'Erreur lors de la création du compte.' },
      { status: pris ? 409 : 500 },
    );
  }

  const annuler = async (orgId?: number) => {
    if (orgId) await admin.from('organisations').delete().eq('id', orgId); // cascade : abonnement
    await admin.auth.admin.deleteUser(cree.user.id);
  };

  // 2) Organisation (la boutique)
  const slug = (slugify(nomBoutique) || 'boutique') + '-' + Math.random().toString(36).slice(2, 6);
  const { data: org, error: eOrg } = await admin
    .from('organisations')
    .insert({ nom: nomBoutique.trim(), slug, type_activite: type })
    .select('id')
    .single();
  if (eOrg || !org) {
    await annuler();
    return NextResponse.json({ message: 'Erreur lors de la création de la boutique.' }, { status: 500 });
  }

  // 3) Abonnement : essai gratuit
  const { error: eAbo } = await admin.from('abonnements').insert({
    organisation_id: org.id,
    plan: 'solo',
    statut: 'essai',
    date_expiration: new Date(Date.now() + ESSAI_JOURS * 24 * 3600 * 1000).toISOString(),
  });
  if (eAbo) {
    await annuler(org.id);
    return NextResponse.json({ message: "Erreur lors de l'ouverture de l'essai." }, { status: 500 });
  }

  // 4) Proprietaire
  const { error: eUser } = await admin.from('utilisateurs').insert({
    organisation_id: org.id,
    auth_id: cree.user.id,
    nom: nom.trim(),
    email: emailNorm,
    role: 'proprietaire',
    actif: true,
  });
  if (eUser) {
    await annuler(org.id);
    const pris = eUser.code === '23505';
    return NextResponse.json(
      { message: pris ? 'Cet email est déjà utilisé.' : 'Erreur lors de la création du profil.' },
      { status: pris ? 409 : 500 },
    );
  }

  // 5) Catalogue de depart selon le commerce (prix a corriger par le patron).
  //    Facultatif : un echec ici ne bloque pas l'inscription.
  const depart = ACTIVITES[type].catalogue;
  if (depart.length) {
    await admin.from('produits').insert(depart.map(a => ({
      organisation_id: org.id, nom: a.nom, prix: a.prix, suivi_stock: !a.service, stock_restant: 0, stock_initial: 0,
    })));
  }

  if (trace?.id) await admin.from('inscriptions_journal').update({ reussie: true }).eq('id', trace.id);
  return NextResponse.json({ message: 'Boutique créée.' }, { status: 201 });
}
