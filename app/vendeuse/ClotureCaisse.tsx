'use client';
import { useState } from 'react';
import { supabase } from '@/lib/supabase';
import { signalerAuPatron } from '../components/ValidationGerant';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', SOFT = '#8A94A6', LINE = '#EAEEF5';
const MODES: Record<string, string> = { cash: 'Espèces', mobile_money: 'Mobile Money', orange_money: 'Orange Money', carte: 'Carte', autre: 'Autre' };

// Cloture « a l'aveugle » : la vendeuse compte et declare ses especes SANS
// voir le montant attendu. La base calcule l'attendu et l'ecart.
export default function ClotureCaisse({ onFermer }: { onFermer: () => void }) {
  const [especes, setEspeces] = useState('');
  const [commentaire, setCommentaire] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const [resultat, setResultat] = useState<any>(null);

  const cloturer = async () => {
    if (especes.trim() === '' || Number(especes) < 0) { setErreur('Indiquez le montant compté (0 si rien).'); return; }
    if (!confirm(`Confirmer : ${fmt(Number(especes))} FCFA en espèces ? Une clôture ne se modifie plus.`)) return;
    setOccupe(true); setErreur('');
    const { data, error } = await supabase.rpc('cloturer_caisse', { p_especes: Number(especes), p_commentaire: commentaire || null });
    setOccupe(false);
    if (error) { setErreur(error.message); return; }
    setResultat(data);
    signalerAuPatron();
  };

  const ecart = Number(resultat?.ecart ?? 0);
  const champ: React.CSSProperties = { height: '48px', padding: '0 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '16px', width: '100%' };

  return (
    <div onClick={onFermer} style={{ position: 'fixed', inset: 0, zIndex: 70, background: 'rgba(16,24,40,.5)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '20px', overflowY: 'auto' }}>
      <div role="dialog" aria-modal="true" aria-label="Clôturer ma caisse" onClick={e => e.stopPropagation()} style={{ width: '100%', maxWidth: '400px', margin: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: '20px', padding: '24px', boxShadow: '0 24px 60px rgba(16,24,40,.28)' }}>
        <div style={{ fontSize: '17px', fontWeight: 800, color: INK, marginBottom: '6px' }}>Clôturer ma caisse</div>
        {!resultat ? (
          <>
            <div style={{ fontSize: '13px', color: SOFT, marginBottom: '16px', lineHeight: 1.5 }}>Comptez l&apos;argent liquide que vous avez encaissé depuis votre dernière clôture, puis tapez le total.</div>
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.4px', color: SOFT, textTransform: 'uppercase', marginBottom: '8px' }}>Espèces comptées (FCFA)</div>
            <input inputMode="numeric" type="number" min="0" autoFocus value={especes} onChange={e => setEspeces(e.target.value)} placeholder="0" style={{ ...champ, marginBottom: '14px' }} />
            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.4px', color: SOFT, textTransform: 'uppercase', marginBottom: '8px' }}>Commentaire (optionnel)</div>
            <input value={commentaire} onChange={e => setCommentaire(e.target.value)} placeholder="Ex. billet de 10 000 déchiré" style={{ ...champ, fontSize: '14px', marginBottom: '16px' }} />
            {erreur && <div style={{ color: '#D24444', fontSize: '13px', marginBottom: '12px' }}>{erreur}</div>}
            <button disabled={occupe} onClick={cloturer} style={{ width: '100%', height: '50px', border: 'none', borderRadius: '14px', background: GRAD, color: '#fff', fontSize: '15px', fontWeight: 700, cursor: occupe ? 'wait' : 'pointer', marginBottom: '10px' }}>{occupe ? 'Clôture…' : 'Clôturer'}</button>
          </>
        ) : (
          <>
            <div style={{ fontSize: '13px', color: SOFT, marginBottom: '16px' }}>{resultat.nb_ventes} vente{resultat.nb_ventes > 1 ? 's' : ''} encaissée{resultat.nb_ventes > 1 ? 's' : ''} sur la période.</div>
            {[['Espèces attendues', resultat.attendu_especes], ['Espèces déclarées', resultat.declare_especes]].map(([l, v]) => (
              <div key={l} style={{ display: 'flex', justifyContent: 'space-between', padding: '10px 0', borderBottom: `1px solid ${LINE}`, fontSize: '14px' }}>
                <span style={{ color: SOFT }}>{l}</span><b style={{ color: INK }}>{fmt(Number(v))} FCFA</b>
              </div>
            ))}
            <div style={{ display: 'flex', justifyContent: 'space-between', padding: '12px 0', fontSize: '15px' }}>
              <span style={{ color: INK, fontWeight: 700 }}>Écart</span>
              <b style={{ color: ecart < 0 ? '#D24444' : ecart > 0 ? '#C8891F' : '#1F9D6B' }}>{ecart > 0 ? '+' : ''}{fmt(ecart)} FCFA</b>
            </div>
            {Object.entries(resultat.attendu || {}).filter(([m]) => m !== 'cash').map(([m, v]) => (
              <div key={m} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px', color: SOFT, padding: '3px 0' }}>
                <span>{MODES[m] || m} (hors caisse)</span><span>{fmt(Number(v))} FCFA</span>
              </div>
            ))}
            <div style={{ fontSize: '12px', color: SOFT, margin: '14px 0', lineHeight: 1.5 }}>La clôture est transmise au patron.</div>
          </>
        )}
        <button onClick={onFermer} style={{ width: '100%', height: '42px', border: `1px solid ${LINE}`, borderRadius: '12px', background: '#fff', color: resultat ? BLUE : SOFT, fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>{resultat ? 'Terminé' : 'Retour'}</button>
      </div>
    </div>
  );
}
