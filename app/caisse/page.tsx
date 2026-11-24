'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { FallikLogo } from '../components/Logo';
import PinPad from '../components/PinPad';

const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';

type Etat = { ok: boolean; poste?: string; boutique?: string; vendeuses?: { id: number; nom: string }[] };

// Ecran d'accueil d'un telephone « caisse » : chaque vendeuse touche son nom
// et tape son code. Personne n'a besoin du mot de passe du patron.
export default function CaissePage() {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [choisie, setChoisie] = useState<{ id: number; nom: string } | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    fetch('/api/caisse', { cache: 'no-store' }).then(r => r.json()).then(setEtat).catch(() => setEtat({ ok: false }));
  }, []);

  const valider = useCallback(async (pin: string) => {
    if (!choisie) return;
    setOccupe(true); setErreur('');
    const r = await fetch('/api/caisse/connexion', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ utilisateur_id: choisie.id, pin }),
    });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) {
      setOccupe(false);
      const restants = typeof res.restants === 'number' ? ` (${res.restants} essai${res.restants > 1 ? 's' : ''} restant${res.restants > 1 ? 's' : ''})` : '';
      setErreur((res.message || 'Code incorrect.') + restants);
      return;
    }
    window.location.href = '/vendeuse';
  }, [choisie]);

  const quitter = async () => {
    if (!confirm('Retirer le mode caisse de ce téléphone ?')) return;
    await fetch('/api/caisse', { method: 'DELETE' });
    window.location.href = '/?compte=1';
  };

  const carte: React.CSSProperties = { width: '100%', maxWidth: '420px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: '22px', padding: '26px 22px', boxShadow: '0 12px 40px rgba(26,36,56,.08)' };

  return (
    <div style={{ minHeight: '100vh', background: '#F4F6FB', display: 'flex', flexDirection: 'column', alignItems: 'center', padding: '28px 16px', gap: '18px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
        <FallikLogo size={44} shadow />
        <div>
          <div style={{ fontSize: '19px', fontWeight: 800, color: INK, lineHeight: 1 }}>Fallik</div>
          <div style={{ fontSize: '12px', color: MUTE, fontWeight: 600, marginTop: '3px' }}>{etat?.boutique ? `${etat.boutique} · ${etat.poste}` : 'Caisse'}</div>
        </div>
      </div>

      {!etat ? (
        <div style={{ color: MUTE, padding: '40px' }}>Chargement…</div>
      ) : !etat.ok ? (
        <div style={{ ...carte, textAlign: 'center' }}>
          <span className="ms" style={{ fontSize: '44px', color: '#C6D2E8' }}>point_of_sale</span>
          <div style={{ fontSize: '16px', fontWeight: 800, color: INK, margin: '8px 0 6px' }}>Ce téléphone n&apos;est pas une caisse</div>
          <div style={{ fontSize: '13.5px', color: SOFT, lineHeight: 1.5, marginBottom: '18px' }}>
            Le gérant l&apos;active depuis <b>Paramètres → Téléphone caisse</b>. Si la caisse a été retirée, il faut la réactiver.
          </div>
          <Link href="/?compte=1" style={{ color: BLUE, fontWeight: 700, fontSize: '14px' }}>Se connecter avec un email</Link>
        </div>
      ) : !choisie ? (
        <div style={carte}>
          <div style={{ fontSize: '17px', fontWeight: 800, color: INK, marginBottom: '4px' }}>Qui vend ?</div>
          <div style={{ fontSize: '13px', color: SOFT, marginBottom: '16px' }}>Touchez votre nom puis tapez votre code.</div>
          {etat.vendeuses?.length ? (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '10px' }}>
              {etat.vendeuses.map(v => (
                <button key={v.id} onClick={() => { setChoisie(v); setErreur(''); }} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '14px', borderRadius: '14px', border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer', textAlign: 'left' }}>
                  <span style={{ width: '36px', height: '36px', borderRadius: '11px', background: '#EEF3FC', color: BLUE, fontWeight: 800, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>{v.nom[0]?.toUpperCase()}</span>
                  <span style={{ fontSize: '14.5px', fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.nom}</span>
                </button>
              ))}
            </div>
          ) : (
            <div style={{ fontSize: '13.5px', color: SOFT, lineHeight: 1.5 }}>Aucune vendeuse n&apos;a encore de code. Le gérant le définit dans <b>Paramètres → Comptes vendeuses → Code PIN</b>.</div>
          )}
        </div>
      ) : (
        <div style={carte}>
          <button onClick={() => { setChoisie(null); setErreur(''); }} style={{ display: 'flex', alignItems: 'center', gap: '4px', background: 'none', border: 'none', color: SOFT, cursor: 'pointer', fontSize: '13px', fontWeight: 600, padding: 0, marginBottom: '12px' }}>
            <span className="ms" style={{ fontSize: '18px' }}>arrow_back</span>Changer
          </button>
          <div style={{ fontSize: '17px', fontWeight: 800, color: INK, textAlign: 'center', marginBottom: '16px' }}>Bonjour {choisie.nom}</div>
          <PinPad onValider={valider} occupe={occupe} erreur={erreur} libelleBouton="Entrer" />
        </div>
      )}

      <div style={{ display: 'flex', gap: '18px', flexWrap: 'wrap', justifyContent: 'center' }}>
        <Link href="/?compte=1" style={{ color: SOFT, fontSize: '13px', fontWeight: 600 }}>Connexion gérant / propriétaire</Link>
        {etat?.ok && <button onClick={quitter} style={{ background: 'none', border: 'none', color: SOFT, fontSize: '13px', fontWeight: 600, cursor: 'pointer', textDecoration: 'underline' }}>Retirer le mode caisse</button>}
      </div>
    </div>
  );
}
