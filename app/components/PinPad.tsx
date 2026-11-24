'use client';
import { useEffect, useState } from 'react';

const INK = '#1A2438', BLUE = '#2563EB', SOFT = '#8A94A6', LINE = '#EAEEF5';

// Clavier a code (4 a 6 chiffres). Les chiffres ne s'affichent jamais :
// seulement des points. Accepte aussi le clavier physique.
export default function PinPad({ onValider, occupe = false, erreur = '', libelleBouton = 'Valider' }: {
  onValider: (pin: string) => void; occupe?: boolean; erreur?: string; libelleBouton?: string;
}) {
  const [pin, setPin] = useState('');
  // Le code tape est efface des l'envoi (pret pour un nouvel essai).
  const envoyer = (p: string) => { onValider(p); setPin(''); };

  useEffect(() => {
    const touche = (e: KeyboardEvent) => {
      if (occupe) return;
      if (/^[0-9]$/.test(e.key)) setPin(p => (p.length < 6 ? p + e.key : p));
      else if (e.key === 'Backspace') setPin(p => p.slice(0, -1));
      else if (e.key === 'Enter' && pin.length >= 4) { onValider(pin); setPin(''); }
    };
    window.addEventListener('keydown', touche);
    return () => window.removeEventListener('keydown', touche);
  }, [pin, occupe, onValider]);

  const ajouter = (c: string) => { if (!occupe) setPin(p => (p.length < 6 ? p + c : p)); };
  const btn: React.CSSProperties = { height: '58px', borderRadius: '14px', border: `1px solid ${LINE}`, background: '#fff', fontSize: '22px', fontWeight: 700, color: INK, cursor: occupe ? 'wait' : 'pointer' };

  return (
    <div style={{ width: '100%', maxWidth: '300px', margin: '0 auto' }}>
      <div aria-label={`${pin.length} chiffres saisis`} style={{ display: 'flex', justifyContent: 'center', gap: '12px', height: '22px', marginBottom: '14px' }}>
        {Array.from({ length: Math.max(4, pin.length) }).map((_, i) => (
          <span key={i} style={{ width: '14px', height: '14px', borderRadius: '50%', background: i < pin.length ? BLUE : '#DCE3EF' }} />
        ))}
      </div>
      {erreur && <div role="alert" style={{ textAlign: 'center', color: '#D24444', fontSize: '13px', fontWeight: 600, marginBottom: '12px' }}>{erreur}</div>}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '10px' }}>
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map(c => <button key={c} type="button" onClick={() => ajouter(c)} style={btn}>{c}</button>)}
        <button type="button" onClick={() => setPin('')} aria-label="Effacer tout" style={{ ...btn, fontSize: '13px', color: SOFT }}>Effacer</button>
        <button type="button" onClick={() => ajouter('0')} style={btn}>0</button>
        <button type="button" onClick={() => setPin(p => p.slice(0, -1))} aria-label="Effacer un chiffre" style={{ ...btn, display: 'flex', alignItems: 'center', justifyContent: 'center', color: SOFT }}>
          <span className="ms" style={{ fontSize: '22px' }}>backspace</span>
        </button>
      </div>
      <button type="button" disabled={occupe || pin.length < 4} onClick={() => envoyer(pin)} style={{ width: '100%', height: '52px', marginTop: '14px', border: 'none', borderRadius: '14px', background: pin.length >= 4 ? 'linear-gradient(135deg,#4B7DF5,#1D4FD0)' : '#C7D6F5', color: '#fff', fontSize: '15px', fontWeight: 700, cursor: occupe || pin.length < 4 ? 'not-allowed' : 'pointer', opacity: occupe ? 0.7 : 1 }}>
        {occupe ? 'Vérification…' : libelleBouton}
      </button>
    </div>
  );
}
