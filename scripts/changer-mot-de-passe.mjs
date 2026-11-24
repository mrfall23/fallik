// Outil Fall Digital : definir un nouveau mot de passe pour un compte Fallik.
//
// Le mot de passe est saisi dans le terminal SANS s'afficher, puis envoye a
// Supabase Auth avec la cle secrete (.env.local). Il n'est ecrit nulle part.
//
// Usage : node scripts/changer-mot-de-passe.mjs adresse@email.com

import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import readline from 'node:readline';

const email = (process.argv[2] || '').trim().toLowerCase();
if (!email) {
  console.error('Usage : node scripts/changer-mot-de-passe.mjs adresse@email.com');
  process.exit(1);
}

const env = Object.fromEntries(
  readFileSync('.env.local', 'utf8')
    .split(/\r?\n/)
    .filter((l) => l.includes('=') && !l.trim().startsWith('#'))
    .map((l) => {
      const i = l.indexOf('=');
      return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')];
    })
);
const service = createClient(env.NEXT_PUBLIC_SUPABASE_URL, env.SUPABASE_SECRET_KEY, {
  auth: { autoRefreshToken: false, persistSession: false },
});

// Saisie masquee (rien ne s'affiche pendant la frappe).
function demanderCache(question) {
  return new Promise((resolve) => {
    const rl = readline.createInterface({ input: process.stdin, output: process.stdout, terminal: true });
    rl._writeToOutput = (s) => { if (s.includes(question)) rl.output.write(s); };
    rl.question(question, (rep) => { rl.close(); process.stdout.write('\n'); resolve(rep); });
  });
}

async function principal() {
  const { data: profil } = await service.from('utilisateurs').select('nom, role, auth_id, organisation_id').eq('email', email).maybeSingle();
  if (!profil?.auth_id) {
    console.error(`Aucun compte Fallik pour ${email}.`);
    process.exitCode = 1; return;
  }
  const { data: org } = await service.from('organisations').select('nom').eq('id', profil.organisation_id).single();
  console.log(`Compte : ${profil.nom} (${profil.role}) — boutique « ${org?.nom} »`);

  const mdp1 = await demanderCache('Nouveau mot de passe (8 caracteres min.) : ');
  if (mdp1.length < 8) { console.error('Trop court : 8 caracteres minimum.'); process.exitCode = 1; return; }
  const mdp2 = await demanderCache('Confirmez le mot de passe : ');
  if (mdp1 !== mdp2) { console.error('Les deux saisies sont differentes. Rien n\'a ete change.'); process.exitCode = 1; return; }

  const { error } = await service.auth.admin.updateUserById(profil.auth_id, { password: mdp1 });
  if (error) { console.error('Echec :', error.message); process.exitCode = 1; return; }
  console.log('Mot de passe mis a jour. Vous pouvez vous connecter sur https://fallik-six.vercel.app');
}

await principal();
