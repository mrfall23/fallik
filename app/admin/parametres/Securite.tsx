'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '22px' };
const champ: React.CSSProperties = { height: '44px', padding: '0 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '15px', width: '100%', letterSpacing: '4px' };
const bouton: React.CSSProperties = { height: '44px', padding: '0 18px', border: 'none', borderRadius: '12px', background: GRAD, color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer', whiteSpace: 'nowrap' };

/** Champ code PIN masque (chiffres uniquement). */
export function ChampPin({ valeur, onChange, placeholder = '4 à 6 chiffres' }: { valeur: string; onChange: (v: string) => void; placeholder?: string }) {
  return (
    <input type="password" inputMode="numeric" autoComplete="new-password" maxLength={6} value={valeur}
      onChange={e => onChange(e.target.value.replace(/\D/g, '').slice(0, 6))} placeholder={placeholder} style={champ} />
  );
}

// Parametres de securite du gerant / proprietaire :
//  - son propre code PIN (pour valider les actions sensibles des vendeuses) ;
//  - les telephones « caisse » ou les vendeuses se connectent par code.
export default function Securite() {
  const [aUnPin, setAUnPin] = useState<boolean | null>(null);
  const [pin1, setPin1] = useState('');
  const [pin2, setPin2] = useState('');
  const [postes, setPostes] = useState<any[]>([]);
  const [nomPoste, setNomPoste] = useState('Comptoir');
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState(false);

  const lire = () => Promise.all([
    supabase.rpc('etat_pins'),
    supabase.from('postes_caisse').select('id, nom, cree_le, dernier_usage, actif').eq('actif', true).order('cree_le'),
  ]);
  const charger = async () => {
    const [{ data: etat }, { data: p }] = await lire();
    setAUnPin(!!etat?.moi); setPostes(p || []);
  };
  useEffect(() => {
    let annule = false;
    lire().then(([{ data: etat }, { data: p }]) => { if (!annule) { setAUnPin(!!etat?.moi); setPostes(p || []); } });
    return () => { annule = true; };
  }, []);

  const afficher = (m: string) => { setMessage(m); setErreur(''); setTimeout(() => setMessage(''), 3500); };

  const enregistrerPin = async () => {
    if (pin1.length < 4) { setErreur('Le code doit avoir 4 à 6 chiffres.'); return; }
    if (pin1 !== pin2) { setErreur('Les deux codes sont différents.'); return; }
    setOccupe(true);
    const { error } = await supabase.rpc('definir_mon_pin', { p_pin: pin1 });
    setOccupe(false);
    if (error) { setErreur(error.message); return; }
    setPin1(''); setPin2('');
    afficher('Votre code est enregistré. Ne le donnez à personne.');
    charger();
  };

  const activerCaisse = async () => {
    if (!confirm('Transformer CE téléphone en caisse ? Vous serez déconnecté ici, et les vendeuses pourront s\'y connecter avec leur code.')) return;
    setOccupe(true);
    const r = await fetch('/api/caisse', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ nom: nomPoste }) });
    const res = await r.json().catch(() => ({}));
    if (!r.ok) { setOccupe(false); setErreur(res.message || 'Erreur.'); return; }
    window.location.href = '/caisse';
  };

  const retirer = async (id: number, nom: string) => {
    if (!confirm(`Retirer la caisse « ${nom} » ? Plus personne ne pourra s'y connecter par code.`)) return;
    const { error } = await supabase.rpc('retirer_poste_caisse', { p_id: id });
    if (error) { setErreur(error.message); return; }
    afficher('Caisse retirée.');
    charger();
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '18px', marginBottom: '26px' }}>
      <div style={carte}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span className="ms" style={{ fontSize: '22px', color: BLUE }}>pin</span>
          <div style={{ fontSize: '15px', fontWeight: 800, color: INK }}>Mon code PIN</div>
          {aUnPin !== null && (
            <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, padding: '3px 10px', borderRadius: '20px', color: aUnPin ? '#1F9D6B' : '#C8891F', background: aUnPin ? 'rgba(31,157,107,.12)' : 'rgba(200,137,31,.14)' }}>{aUnPin ? 'Défini' : 'À définir'}</span>
          )}
        </div>
        <div style={{ fontSize: '13px', color: SOFT, lineHeight: 1.5, marginBottom: '14px' }}>
          Les vendeuses ne peuvent ni annuler une facture, ni retirer un article déjà servi, ni faire crédit sans que vous tapiez ce code sur leur téléphone. Changez-le si quelqu&apos;un l&apos;a vu.
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginBottom: '12px' }}>
          <ChampPin valeur={pin1} onChange={setPin1} placeholder={aUnPin ? 'Nouveau code' : 'Code'} />
          <ChampPin valeur={pin2} onChange={setPin2} placeholder="Confirmer" />
        </div>
        <button disabled={occupe} onClick={enregistrerPin} style={bouton}>{aUnPin ? 'Changer mon code' : 'Enregistrer mon code'}</button>
      </div>

      <div style={carte}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span className="ms" style={{ fontSize: '22px', color: BLUE }}>point_of_sale</span>
          <div style={{ fontSize: '15px', fontWeight: 800, color: INK }}>Téléphone caisse</div>
        </div>
        <div style={{ fontSize: '13px', color: SOFT, lineHeight: 1.5, marginBottom: '14px' }}>
          Sur le téléphone partagé de la boutique : ouvrez Fallik avec votre compte, puis activez la caisse ici. Votre compte se ferme, et chaque vendeuse entre avec son nom et son code. Elle n&apos;a jamais votre mot de passe.
        </div>
        <div style={{ display: 'flex', gap: '10px', marginBottom: postes.length ? '16px' : 0 }}>
          <input value={nomPoste} onChange={e => setNomPoste(e.target.value)} placeholder="Nom (ex. Comptoir)" maxLength={60} style={{ ...champ, letterSpacing: 0, fontSize: '14px' }} />
          <button disabled={occupe} onClick={activerCaisse} style={bouton}>Activer ici</button>
        </div>
        {postes.map(p => (
          <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '10px 0', borderTop: `1px solid ${LINE}` }}>
            <span className="ms" style={{ fontSize: '20px', color: MUTE }}>smartphone</span>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: '14px', fontWeight: 700, color: INK }}>{p.nom}</div>
              <div style={{ fontSize: '12px', color: MUTE }}>{p.dernier_usage ? `Utilisée le ${new Date(p.dernier_usage).toLocaleString('fr-FR')}` : 'Jamais utilisée'}</div>
            </div>
            <button onClick={() => retirer(p.id, p.nom)} style={{ height: '34px', padding: '0 12px', border: 'none', borderRadius: '10px', background: 'rgba(210,68,68,.08)', color: '#D24444', fontSize: '12.5px', fontWeight: 600, cursor: 'pointer' }}>Retirer</button>
          </div>
        ))}
      </div>

      {(message || erreur) && (
        <div style={{ gridColumn: '1 / -1', padding: '11px 16px', borderRadius: '12px', fontSize: '13.5px', fontWeight: 600, textAlign: 'center', color: erreur ? '#D24444' : '#1F9D6B', background: erreur ? 'rgba(210,68,68,.10)' : 'rgba(31,157,107,.12)' }}>{erreur || message}</div>
      )}
    </div>
  );
}
