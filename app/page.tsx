'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { FalloraLogo } from './components/Logo';

type Mode = 'connexion' | 'inscription';

const champStyle: React.CSSProperties = { flex: 1, background: 'transparent', border: 'none', outline: 'none', color: 'var(--ink)', fontSize: '15px' };
const boiteStyle: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '12px', padding: '0 16px', height: '52px', borderRadius: '14px', background: 'var(--surface-inset)', border: '1px solid var(--line)' };

export default function AccueilPage() {
  const [mode, setMode] = useState<Mode>('connexion');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [nomBoutique, setNomBoutique] = useState('');
  const [nom, setNom] = useState('');
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);
  const router = useRouter();

  const connecter = async (mail: string, mdp: string) => {
    const { data: auth, error } = await supabase.auth.signInWithPassword({ email: mail.trim().toLowerCase(), password: mdp });
    if (error || !auth.user) return { ok: false, message: 'Email ou mot de passe incorrect.' };
    const { data: profil } = await supabase.from('utilisateurs').select('role, actif').eq('auth_id', auth.user.id).single();
    if (!profil) { await supabase.auth.signOut(); return { ok: false, message: 'Compte introuvable.' }; }
    if (!profil.actif) { await supabase.auth.signOut(); return { ok: false, message: 'Ce compte a été désactivé.' }; }
    router.replace(profil.role === 'admin' ? '/admin' : '/vendeuse');
    return { ok: true as const };
  };

  const seConnecter = async () => {
    if (!email || !motDePasse) { setErreur('Veuillez remplir tous les champs.'); return; }
    setErreur(''); setChargement(true);
    const r = await connecter(email, motDePasse);
    if (!r.ok) { setChargement(false); setErreur(r.message!); }
  };

  const sInscrire = async () => {
    if (!nomBoutique.trim() || !nom.trim() || !email || !motDePasse) { setErreur('Veuillez remplir tous les champs.'); return; }
    if (motDePasse.length < 6) { setErreur('Le mot de passe doit faire au moins 6 caractères.'); return; }
    setErreur(''); setChargement(true);
    const reponse = await fetch('/api/inscription', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ nomBoutique, nom, email, motDePasse }),
    });
    const resultat = await reponse.json().catch(() => ({}));
    if (!reponse.ok) { setChargement(false); setErreur(resultat.message || 'Une erreur est survenue.'); return; }
    // Boutique créée -> connexion automatique.
    const r = await connecter(email, motDePasse);
    if (!r.ok) { setChargement(false); setMode('connexion'); setErreur('Boutique créée ! Connecte-toi.'); }
  };

  const valider = () => (mode === 'connexion' ? seConnecter() : sInscrire());
  const surEntree = (e: React.KeyboardEvent) => { if (e.key === 'Enter') valider(); };

  return (
    <div style={{ position: 'relative', minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(16px,5vw,40px)', overflow: 'hidden', background: 'radial-gradient(ellipse at top,var(--bg-top),var(--bg-bottom))' }}>
      <div style={{ position: 'absolute', width: '620px', height: '620px', top: '-180px', left: '-120px', borderRadius: '50%', background: 'radial-gradient(circle,rgba(169,103,61,.14),transparent 65%)', animation: 'glowPulse 7s ease-in-out infinite', pointerEvents: 'none' }} />

      <div style={{ position: 'relative', width: '100%', maxWidth: '440px', padding: 'clamp(28px,6vw,44px) clamp(22px,5vw,40px)', borderRadius: '28px', background: 'var(--surface-2)', border: '1px solid var(--accent-20)', backdropFilter: 'blur(26px)', boxShadow: 'var(--shadow-lg)', animation: 'fadeUp .6s ease' }}>
        <div style={{ marginBottom: '28px' }}>
          <FalloraLogo layout="stack" markSize={54} wordSize={38} tagline="La gestion simple de votre commerce" />
        </div>

        {/* Bascule Connexion / Inscription */}
        <div style={{ display: 'flex', gap: '6px', padding: '5px', borderRadius: '14px', background: 'var(--surface-inset)', border: '1px solid var(--line)', marginBottom: '22px' }}>
          {(['connexion', 'inscription'] as Mode[]).map(m => (
            <button key={m} onClick={() => { setMode(m); setErreur(''); }}
              style={{ flex: 1, height: '40px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '13.5px', fontWeight: 700, background: mode === m ? 'var(--accent-grad)' : 'transparent', color: mode === m ? 'var(--on-accent)' : 'var(--ink-55)' }}>
              {m === 'connexion' ? 'Se connecter' : 'Créer ma boutique'}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {mode === 'inscription' && (
            <>
              <div style={boiteStyle}>
                <span className="ms" style={{ fontSize: '20px', color: 'var(--accent)' }}>storefront</span>
                <input placeholder="Nom de la boutique" value={nomBoutique} onChange={e => setNomBoutique(e.target.value)} onKeyDown={surEntree} style={champStyle} />
              </div>
              <div style={boiteStyle}>
                <span className="ms" style={{ fontSize: '20px', color: 'var(--accent)' }}>person</span>
                <input placeholder="Votre nom" value={nom} onChange={e => setNom(e.target.value)} onKeyDown={surEntree} style={champStyle} />
              </div>
            </>
          )}
          <div style={boiteStyle}>
            <span className="ms" style={{ fontSize: '20px', color: 'var(--accent)' }}>mail</span>
            <input type="email" placeholder="votre@email.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={surEntree} style={champStyle} />
          </div>
          <div style={boiteStyle}>
            <span className="ms" style={{ fontSize: '20px', color: 'var(--accent)' }}>lock</span>
            <input type="password" placeholder={mode === 'inscription' ? 'Mot de passe (6 caractères min.)' : '••••••••'} value={motDePasse} onChange={e => setMotDePasse(e.target.value)} onKeyDown={surEntree} style={champStyle} />
          </div>

          {erreur && (
            <div style={{ padding: '12px 16px', borderRadius: '12px', background: 'var(--danger-tint)', border: '1px solid var(--danger-line)', color: 'var(--danger)', fontSize: '13.5px', textAlign: 'center' }}>
              {erreur}
            </div>
          )}

          <button onClick={valider} disabled={chargement} style={{ marginTop: '4px', height: '54px', border: 'none', borderRadius: '15px', cursor: chargement ? 'not-allowed' : 'pointer', background: chargement ? 'var(--accent-30)' : 'var(--accent-grad)', color: 'var(--on-accent)', fontSize: '15.5px', fontWeight: 700, letterSpacing: '.3px', boxShadow: 'var(--shadow-accent)' }}>
            {chargement ? 'Un instant…' : mode === 'connexion' ? 'Se connecter' : 'Créer ma boutique'}
          </button>
        </div>
      </div>
    </div>
  );
}
