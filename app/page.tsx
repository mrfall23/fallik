'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { useIsMobile } from './components/useMediaQuery';
import { FallikLogo } from './components/Logo';
import { accueilPourRole } from '@/lib/roles';
import { ACTIVITES, TYPES_ACTIVITE, type TypeActivite } from '@/lib/activites';

type Mode = 'connexion' | 'inscription';

const champStyle: React.CSSProperties = { width: '100%', height: '50px', padding: '0 16px', borderRadius: '12px', background: '#F4F6FB', border: '1px solid #E1E7F2', outline: 'none', color: '#1A2438', fontSize: '15px' };
const labelStyle: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 700, letterSpacing: '.6px', color: '#8A94A6', textTransform: 'uppercase', marginBottom: '7px' };

export default function AccueilPage() {
  const isMobile = useIsMobile();
  const [mode, setMode] = useState<Mode>('connexion');
  const [email, setEmail] = useState('');
  const [motDePasse, setMotDePasse] = useState('');
  const [voirMdp, setVoirMdp] = useState(false);
  const [nomBoutique, setNomBoutique] = useState('');
  const [nom, setNom] = useState('');
  const [siteWeb, setSiteWeb] = useState(''); // champ piege anti-robots, invisible
  const [typeActivite, setTypeActivite] = useState<TypeActivite | ''>('');
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(false);
  const router = useRouter();

  const connecter = async (mail: string, mdp: string) => {
    const { data: auth, error } = await supabase.auth.signInWithPassword({ email: mail.trim().toLowerCase(), password: mdp });
    if (error || !auth.user) return { ok: false, message: 'Email ou mot de passe incorrect.' };
    const { data: profil } = await supabase.from('utilisateurs').select('role, actif').eq('auth_id', auth.user.id).single();
    if (!profil) {
      // Compte Fall Digital : pas de boutique, il va directement a la console.
      const { data: sa } = await supabase.rpc('suis_super_admin');
      if (sa === true) { router.replace('/fall-digital'); return { ok: true as const }; }
      await supabase.auth.signOut(); return { ok: false, message: 'Compte introuvable.' };
    }
    if (!profil.actif) { await supabase.auth.signOut(); return { ok: false, message: 'Ce compte a été désactivé.' }; }
    router.replace(accueilPourRole(profil.role));
    return { ok: true as const };
  };

  const seConnecter = async () => {
    if (!email || !motDePasse) { setErreur('Veuillez remplir tous les champs.'); return; }
    setErreur(''); setChargement(true);
    const r = await connecter(email, motDePasse);
    if (!r.ok) { setChargement(false); setErreur(r.message!); }
  };

  const sInscrire = async () => {
    if (!typeActivite) { setErreur('Choisissez votre type de commerce.'); return; }
    if (!nomBoutique.trim() || !nom.trim() || !email || !motDePasse) { setErreur('Veuillez remplir tous les champs.'); return; }
    if (motDePasse.length < 8) { setErreur('Le mot de passe doit faire au moins 8 caractères.'); return; }
    setErreur(''); setChargement(true);
    const reponse = await fetch('/api/inscription', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nomBoutique, nom, email, motDePasse, siteWeb, typeActivite }) });
    const resultat = await reponse.json().catch(() => ({}));
    if (!reponse.ok) { setChargement(false); setErreur(resultat.message || 'Une erreur est survenue.'); return; }
    const r = await connecter(email, motDePasse);
    if (!r.ok) { setChargement(false); setMode('connexion'); setErreur('Boutique créée ! Connecte-toi.'); }
  };

  const valider = () => (mode === 'connexion' ? seConnecter() : sInscrire());
  const surEntree = (e: React.KeyboardEvent) => { if (e.key === 'Enter') valider(); };

  return (
    <div style={{ minHeight: '100vh', display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 1fr', background: '#fff' }}>
      {/* ── Colonne formulaire ── */}
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', padding: 'clamp(24px,5vw,48px)' }}>
        <div style={{ width: '100%', maxWidth: '380px' }}>
          {/* Logo */}
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '38px' }}>
            <FallikLogo size={46} shadow />
            <div>
              <div style={{ fontSize: '19px', fontWeight: 800, color: '#1A2438', lineHeight: 1 }}>Fallik</div>
              <div style={{ fontSize: '10.5px', fontWeight: 700, letterSpacing: '1.5px', color: '#8A94A6', marginTop: '3px' }}>STOCK &amp; FACTURATION</div>
            </div>
          </div>

          <div style={{ fontSize: 'clamp(28px,4vw,34px)', fontWeight: 800, color: '#1A2438', letterSpacing: '-.5px', marginBottom: '6px' }}>Bienvenue</div>
          <div style={{ fontSize: '14.5px', color: '#8A94A6', marginBottom: '28px' }}>
            {mode === 'connexion' ? 'Connectez-vous pour accéder à votre boutique.' : 'Créez votre boutique en une minute.'}
          </div>

          {mode === 'inscription' && (
            <>
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Quel est votre commerce ?</label>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3, 1fr)', gap: '8px' }}>
                  {TYPES_ACTIVITE.map(t => {
                    const a = ACTIVITES[t], choisi = typeActivite === t;
                    return (
                      <button key={t} type="button" onClick={() => { setTypeActivite(t); setErreur(''); }} aria-pressed={choisi}
                        style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: '4px', padding: '10px 4px', borderRadius: '12px', cursor: 'pointer', border: `1.5px solid ${choisi ? '#2563EB' : '#E1E7F2'}`, background: choisi ? '#EDF2FD' : '#fff', color: choisi ? '#2563EB' : '#5A6478' }}>
                        <span className="ms" style={{ fontSize: '24px' }}>{a.icone}</span>
                        <span style={{ fontSize: '12px', fontWeight: 700, lineHeight: 1.15, textAlign: 'center' }}>{a.nom}</span>
                      </button>
                    );
                  })}
                </div>
                {typeActivite && <div style={{ fontSize: '12px', color: '#8A94A6', marginTop: '6px' }}>{ACTIVITES[typeActivite].description}{ACTIVITES[typeActivite].catalogue.length ? ' · des exemples de prix seront créés pour vous, à corriger.' : ''}</div>}
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Nom de la boutique</label>
                <input style={champStyle} placeholder={typeActivite ? ACTIVITES[typeActivite].exempleNom : 'Ex. Bar du Coin'} value={nomBoutique} onChange={e => setNomBoutique(e.target.value)} onKeyDown={surEntree} />
              </div>
              <div style={{ marginBottom: '16px' }}>
                <label style={labelStyle}>Votre nom</label>
                <input style={champStyle} placeholder="Votre nom" value={nom} onChange={e => setNom(e.target.value)} onKeyDown={surEntree} />
              </div>
              <div aria-hidden="true" style={{ position: 'absolute', left: '-10000px', width: '1px', height: '1px', overflow: 'hidden' }}>
                <label>Site web<input tabIndex={-1} autoComplete="off" value={siteWeb} onChange={e => setSiteWeb(e.target.value)} /></label>
              </div>
            </>
          )}

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Email</label>
            <input style={champStyle} type="email" placeholder="vous@boutique.com" value={email} onChange={e => setEmail(e.target.value)} onKeyDown={surEntree} />
          </div>

          <div style={{ marginBottom: '16px' }}>
            <label style={labelStyle}>Mot de passe</label>
            <div style={{ position: 'relative' }}>
              <input style={{ ...champStyle, paddingRight: '46px' }} type={voirMdp ? 'text' : 'password'} placeholder={mode === 'inscription' ? '8 caractères minimum' : '••••••••'} value={motDePasse} onChange={e => setMotDePasse(e.target.value)} onKeyDown={surEntree} />
              <button type="button" onClick={() => setVoirMdp(v => !v)} aria-label="Afficher le mot de passe" style={{ position: 'absolute', right: '6px', top: '50%', transform: 'translateY(-50%)', width: '38px', height: '38px', border: 'none', background: 'transparent', cursor: 'pointer', color: '#8A94A6', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="ms" style={{ fontSize: '20px' }}>{voirMdp ? 'visibility_off' : 'visibility'}</span>
              </button>
            </div>
          </div>

          {erreur && (
            <div style={{ padding: '11px 14px', borderRadius: '11px', background: 'rgba(210,68,68,.09)', border: '1px solid rgba(210,68,68,.25)', color: '#C43A3A', fontSize: '13.5px', marginBottom: '16px' }}>{erreur}</div>
          )}

          <button onClick={valider} disabled={chargement} style={{ width: '100%', height: '52px', border: 'none', borderRadius: '13px', cursor: chargement ? 'not-allowed' : 'pointer', background: 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', color: '#fff', fontSize: '15.5px', fontWeight: 700, boxShadow: '0 10px 26px rgba(37,99,235,.28)', marginBottom: '12px' }}>
            {chargement ? 'Un instant…' : mode === 'connexion' ? 'Se connecter' : 'Créer ma boutique'}
          </button>

          <button onClick={() => { setMode(mode === 'connexion' ? 'inscription' : 'connexion'); setErreur(''); }} style={{ width: '100%', height: '50px', border: '1px solid #E1E7F2', borderRadius: '13px', cursor: 'pointer', background: '#fff', color: '#1A2438', fontSize: '14.5px', fontWeight: 600 }}>
            {mode === 'connexion' ? 'Créer ma boutique' : 'J\'ai déjà un compte'}
          </button>

          <div style={{ fontSize: '12px', color: '#A5AEBD', marginTop: '26px', lineHeight: 1.5 }}>
            Accès réservé au personnel de la boutique. Toute connexion est enregistrée.
          </div>
        </div>
      </div>

      {/* ── Colonne vitrine (masquée sur mobile) ── */}
      {!isMobile && (
        <div style={{ position: 'relative', overflow: 'hidden', background: 'linear-gradient(150deg,#1B3A8F 0%,#2456C9 55%,#3E6FE0 100%)', display: 'flex', flexDirection: 'column', justifyContent: 'center', padding: 'clamp(40px,5vw,72px)' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '2px', color: 'rgba(255,255,255,.62)', textTransform: 'uppercase', marginBottom: '18px' }}>Votre boutique, sous contrôle</div>
          <div style={{ fontSize: 'clamp(30px,3vw,38px)', fontWeight: 800, color: '#fff', lineHeight: 1.2, letterSpacing: '-.5px', marginBottom: '34px' }}>
            Le stock se met à jour à chaque facture, sans double saisie.
          </div>
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px', marginBottom: '36px' }}>
            {[['bolt', 'Facture émise en moins de 30 secondes'], ['notifications_active', 'Alerte dès qu\'un article passe sous le seuil'], ['sync', 'Encaissement propre qui alimente le tableau de bord']].map(([icon, txt]) => (
              <div key={txt} style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                <span className="ms" style={{ fontSize: '22px', color: 'rgba(255,255,255,.9)' }}>{icon}</span>
                <span style={{ fontSize: '15px', color: 'rgba(255,255,255,.92)' }}>{txt}</span>
              </div>
            ))}
          </div>
          <div style={{ background: 'rgba(255,255,255,.10)', border: '1px solid rgba(255,255,255,.15)', borderRadius: '16px', padding: '20px 22px', maxWidth: '460px' }}>
            <div style={{ fontSize: '15px', color: '#fff', fontStyle: 'italic', marginBottom: '8px' }}>« On sait exactement ce qui reste en boutique et qui doit encore payer. »</div>
            <div style={{ fontSize: '12.5px', color: 'rgba(255,255,255,.65)' }}>Une gérante satisfaite</div>
          </div>
        </div>
      )}
    </div>
  );
}
