'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import PushToggle from '../../components/PushToggle';

const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', LINE = '#EAEEF5';
const VERT = '#1F9D6B', ROUGE = '#D24444';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '20px 22px' };

type Reglages = { ventes: boolean; stock_bas: boolean; actions_sensibles: boolean; resume_soir: boolean };
type Etat = { reglages: Reglages | null };

const CHOIX: { cle: keyof Pick<Reglages, 'ventes' | 'stock_bas' | 'actions_sensibles' | 'resume_soir'>; titre: string; desc: string }[] = [
  { cle: 'ventes', titre: 'Chaque vente', desc: 'Vente rapide ou facture encaissée : vendeuse, articles, montant, crédit éventuel.' },
  { cle: 'stock_bas', titre: 'Stock bas', desc: 'Quand un produit passe sous le seuil d\'alerte (une seule fois, pas à chaque vente).' },
  { cle: 'actions_sensibles', titre: 'Actions à vérifier', desc: 'Annulations, retraits d\'articles, crédits, codes gérant faux, écarts de caisse, corrections de stock.' },
  { cle: 'resume_soir', titre: 'Résumé du soir', desc: 'Vers 21 h : chiffre du jour, bénéfice, encaissements, vendeuses, dettes, stock bas.' },
];

async function lire(): Promise<Etat> {
  const { data } = await supabase.from('reglages_alertes').select('ventes, stock_bas, actions_sensibles, resume_soir').maybeSingle();
  return { reglages: (data as Reglages | null) ?? null };
}

export default function Alertes({ estProprietaire }: { estProprietaire: boolean }) {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  useEffect(() => {
    let annule = false;
    lire().then(e => { if (!annule) setEtat(e); });
    return () => { annule = true; };
  }, []);

  const basculer = async (cle: (typeof CHOIX)[number]['cle']) => {
    if (!etat?.reglages || !estProprietaire) return;
    const valeur = !etat.reglages[cle];
    setOccupe(cle); setMessage(null);
    const { error } = await supabase.rpc('definir_alertes', {
      p_ventes: cle === 'ventes' ? valeur : null, p_stock_bas: cle === 'stock_bas' ? valeur : null,
      p_actions_sensibles: cle === 'actions_sensibles' ? valeur : null, p_resume_soir: cle === 'resume_soir' ? valeur : null,
    });
    setOccupe(null);
    if (error) { setMessage({ ok: false, texte: error.message }); return; }
    setEtat({ ...etat, reglages: { ...etat.reglages, [cle]: valeur } });
  };

  const r = etat?.reglages;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: '18px', marginBottom: '22px' }}>
      {/* Notifications */}
      <div style={carte}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span className="ms" style={{ fontSize: '22px', color: BLUE }}>notifications</span>
          <div style={{ fontSize: '16px', fontWeight: 700, color: INK }}>Notifications sur cet appareil</div>
        </div>
        <p style={{ fontSize: '13px', color: '#5A6472', lineHeight: 1.55, margin: '0 0 14px' }}>
          Activez-les sur chaque téléphone ou ordinateur qui doit recevoir les alertes de la boutique.
        </p>
        <PushToggle />
      </div>

      {/* Choix des alertes */}
      <div style={carte}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: INK, marginBottom: '4px' }}>Que recevoir ?</div>
        <p style={{ fontSize: '12.5px', color: MUTE, margin: '0 0 12px' }}>
          {estProprietaire ? 'Sur les appareils où les notifications sont activées.' : 'Seul le propriétaire peut modifier ces choix.'}
        </p>
        {message && <div style={{ marginBottom: '8px', fontSize: '13px', color: message.ok ? VERT : ROUGE }}>{message.texte}</div>}
        {!etat ? <p style={{ fontSize: '13px', color: MUTE }}>Chargement…</p> : !r ? <p style={{ fontSize: '13px', color: MUTE }}>Réglages indisponibles.</p> : CHOIX.map(c => (
          <label key={c.cle} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 0', borderBottom: '1px solid #F6F8FC', cursor: estProprietaire ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={r[c.cle]} disabled={!estProprietaire || occupe === c.cle} onChange={() => basculer(c.cle)}
              style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: BLUE, flexShrink: 0 }} />
            <span>
              <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: INK }}>{c.titre}</span>
              <span style={{ display: 'block', fontSize: '12.5px', color: '#6B7688', lineHeight: 1.45 }}>{c.desc}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
