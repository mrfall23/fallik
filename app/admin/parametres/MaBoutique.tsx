'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { lireBoutique, type Boutique } from '@/lib/boutique';
import { LIBELLES_STATUT, PLANS } from '@/lib/roles';

// Reglages de la boutique (proprietaire et gerant) + abonnement (lecture
// seule, proprietaire uniquement : la RLS ne le montre qu'a lui, et seul
// Fall Digital peut le modifier, cote serveur).

const INK = '#1A2438', SOFT = '#8A94A6', LINE = '#EAEEF5', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '22px', marginBottom: '18px' };
const inputStyle: React.CSSProperties = { height: '44px', padding: '0 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px', width: '100%' };
const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: SOFT, letterSpacing: '.5px', marginBottom: '6px', textTransform: 'uppercase' };
const titre: React.CSSProperties = { fontSize: '16px', fontWeight: 800, color: INK, marginBottom: '16px', display: 'flex', alignItems: 'center', gap: '8px' };

type Abonnement = { plan: string; statut: string; date_expiration: string; jours?: number };
type Form = Omit<Boutique, 'id' | 'seuil_stock_bas' | 'remise_max_pct' | 'logo_url' | 'telephone' | 'adresse'> & {
  logo_url: string; telephone: string; adresse: string; seuil_stock_bas: string; remise_max_pct: string;
};

const FUSEAUX = ['Africa/Douala', 'Africa/Lagos', 'Africa/Abidjan', 'Africa/Dakar', 'Africa/Kinshasa', 'Africa/Libreville', 'Europe/Paris'];

export default function MaBoutique({ estProprietaire }: { estProprietaire: boolean }) {
  const [form, setForm] = useState<Form | null>(null);
  const [abo, setAbo] = useState<Abonnement | null>(null);
  const [sauvegarde, setSauvegarde] = useState(false);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    (async () => {
      const b = await lireBoutique();
      if (b) setForm({
        nom: b.nom, logo_url: b.logo_url || '', couleur_principale: b.couleur_principale, couleur_secondaire: b.couleur_secondaire,
        devise: b.devise, fuseau_horaire: b.fuseau_horaire, seuil_stock_bas: String(b.seuil_stock_bas),
        remise_max_pct: String(b.remise_max_pct), telephone: b.telephone || '', adresse: b.adresse || '',
      });
      if (estProprietaire) {
        const { data } = await supabase.from('abonnements').select('plan, statut, date_expiration').maybeSingle();
        const a = data as Abonnement | null;
        setAbo(a ? { ...a, jours: Math.ceil((new Date(a.date_expiration).getTime() - Date.now()) / 86400000) } : null);
      }
    })();
  }, [estProprietaire]);

  if (!form) return null;
  const maj = (k: keyof Form, v: string) => setForm({ ...form, [k]: v });

  const enregistrer = async () => {
    setErreur(''); setMessage('');
    const seuil = Number(form.seuil_stock_bas), remise = Number(form.remise_max_pct);
    if (!form.nom.trim()) return setErreur('Le nom de la boutique est obligatoire.');
    if (form.logo_url && !/^https:\/\//.test(form.logo_url.trim())) return setErreur("L'adresse du logo doit commencer par https://");
    if (!Number.isInteger(seuil) || seuil < 0) return setErreur('Seuil de stock invalide.');
    if (!(remise >= 0 && remise <= 100)) return setErreur('La remise maximale doit être entre 0 et 100 %.');
    setSauvegarde(true);
    const { error } = await supabase.from('organisations').update({
      nom: form.nom.trim(),
      logo_url: form.logo_url.trim() || null,
      couleur_principale: form.couleur_principale,
      couleur_secondaire: form.couleur_secondaire,
      devise: form.devise.trim() || 'FCFA',
      fuseau_horaire: form.fuseau_horaire,
      seuil_stock_bas: seuil,
      remise_max_pct: remise,
      telephone: form.telephone.trim() || null,
      adresse: form.adresse.trim() || null,
    }).not('id', 'is', null); // la RLS limite deja a la boutique de l'utilisateur
    setSauvegarde(false);
    if (error) return setErreur("Impossible d'enregistrer : " + error.message);
    setMessage('Réglages enregistrés.');
    setTimeout(() => setMessage(''), 3000);
  };

  const exp = abo ? new Date(abo.date_expiration) : null;
  const joursRestants = abo?.jours ?? null;

  return (
    <>
      {estProprietaire && abo && (
        <div style={carte}>
          <div style={titre}><span className="ms" style={{ fontSize: '20px', color: '#2563EB' }}>workspace_premium</span>Abonnement</div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '22px', fontSize: '14px', color: INK }}>
            <div><div style={labelStyle}>Offre</div><b>{PLANS[abo.plan]?.nom || abo.plan}</b> · {(PLANS[abo.plan]?.prix || 0).toLocaleString('fr-FR')} FCFA / mois</div>
            <div><div style={labelStyle}>Statut</div><b>{LIBELLES_STATUT[abo.statut] || abo.statut}</b></div>
            <div><div style={labelStyle}>Valable jusqu&apos;au</div><b>{exp?.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}</b>
              {joursRestants !== null && <span style={{ color: joursRestants <= 7 ? '#C8891F' : SOFT }}> ({joursRestants} j)</span>}
            </div>
          </div>
          <div style={{ fontSize: '12.5px', color: SOFT, marginTop: '12px' }}>Pour changer d&apos;offre ou renouveler, contactez Fall Digital.</div>
        </div>
      )}

      <div style={carte}>
        <div style={titre}><span className="ms" style={{ fontSize: '20px', color: '#2563EB' }}>storefront</span>Ma boutique</div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '14px' }}>
          <div><div style={labelStyle}>Nom de la boutique *</div><input style={inputStyle} value={form.nom} maxLength={80} onChange={e => maj('nom', e.target.value)} /></div>
          <div><div style={labelStyle}>Téléphone</div><input style={inputStyle} value={form.telephone} onChange={e => maj('telephone', e.target.value)} placeholder="Ex : 677 12 34 56" /></div>
          <div><div style={labelStyle}>Adresse</div><input style={inputStyle} value={form.adresse} onChange={e => maj('adresse', e.target.value)} placeholder="Ex : Marché central, Yaoundé" /></div>
          <div><div style={labelStyle}>Logo (adresse https)</div><input style={inputStyle} value={form.logo_url} onChange={e => maj('logo_url', e.target.value)} placeholder="https://…" /></div>
          <div><div style={labelStyle}>Couleur principale</div>
            <input type="color" style={{ ...inputStyle, padding: '4px' }} value={form.couleur_principale} onChange={e => maj('couleur_principale', e.target.value.toUpperCase())} /></div>
          <div><div style={labelStyle}>Couleur secondaire</div>
            <input type="color" style={{ ...inputStyle, padding: '4px' }} value={form.couleur_secondaire} onChange={e => maj('couleur_secondaire', e.target.value.toUpperCase())} /></div>
          <div><div style={labelStyle}>Devise</div><input style={inputStyle} value={form.devise} maxLength={8} onChange={e => maj('devise', e.target.value)} /></div>
          <div><div style={labelStyle}>Fuseau horaire</div>
            <select style={inputStyle} value={form.fuseau_horaire} onChange={e => maj('fuseau_horaire', e.target.value)}>
              {(FUSEAUX.includes(form.fuseau_horaire) ? FUSEAUX : [form.fuseau_horaire, ...FUSEAUX]).map(f => <option key={f} value={f}>{f}</option>)}
            </select></div>
          <div><div style={labelStyle}>Alerte stock bas (≤)</div><input style={inputStyle} type="number" min={0} value={form.seuil_stock_bas} onChange={e => maj('seuil_stock_bas', e.target.value)} /></div>
          <div><div style={labelStyle}>Remise max vendeuse (%)</div><input style={inputStyle} type="number" min={0} max={100} value={form.remise_max_pct} onChange={e => maj('remise_max_pct', e.target.value)} /></div>
        </div>
        {erreur && <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(210,68,68,.10)', border: '1px solid rgba(210,68,68,.25)', color: '#D24444', fontSize: '13px', marginTop: '14px' }}>{erreur}</div>}
        {message && <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(31,157,107,.12)', color: '#1F9D6B', fontSize: '13px', fontWeight: 600, marginTop: '14px' }}>{message}</div>}
        <button onClick={enregistrer} disabled={sauvegarde} style={{ marginTop: '16px', height: '44px', padding: '0 22px', border: 'none', borderRadius: '12px', cursor: 'pointer', background: GRAD, color: '#fff', fontWeight: 700, fontSize: '14px', opacity: sauvegarde ? 0.7 : 1 }}>
          {sauvegarde ? 'Enregistrement…' : 'Enregistrer les réglages'}
        </button>
      </div>
    </>
  );
}
