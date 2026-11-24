'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useBoutique } from '@/lib/boutique';

const fmt = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5', VERT = '#1F9D6B', ROUGE = '#D24444';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)' };

type Ligne = { id: number; nom: string; role: string; objectif: number; realise: number; nb: number };

// 'YYYY-MM-01' du mois decale de `decalage` par rapport au mois courant.
function moisDecale(decalage: number) {
  const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + decalage);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-01`;
}
const nomMois = (iso: string) => { const t = new Date(`${iso}T12:00:00`).toLocaleDateString('fr-FR', { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); };

async function lire(mois: string) {
  const { data, error } = await supabase.rpc('objectifs_du_mois', { p_mois: mois });
  return { lignes: ((data?.vendeuses || []) as any[]).map(v => ({ ...v, objectif: Number(v.objectif) || 0, realise: Number(v.realise) || 0, nb: Number(v.nb) || 0 })) as Ligne[], erreur: error?.message || '' };
}

export default function Objectifs() {
  const boutique = useBoutique();
  const dev = boutique?.devise || 'FCFA';
  const [decalage, setDecalage] = useState(0);
  const mois = moisDecale(decalage);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);
  const [edite, setEdite] = useState<number | null>(null);
  const [valeur, setValeur] = useState('');
  const [enCours, setEnCours] = useState(false);

  useEffect(() => {
    let annule = false;
    lire(mois).then(r => { if (!annule) { setLignes(r.lignes); setErreur(r.erreur); setChargement(false); } });
    return () => { annule = true; };
  }, [mois]);

  const changerMois = (d: number) => { setChargement(true); setEdite(null); setDecalage(d); };

  const enregistrer = async (id: number) => {
    const n = valeur.trim() === '' ? 0 : Number(valeur.replace(/\s/g, ''));
    if (isNaN(n) || n < 0) { setErreur('Objectif invalide.'); return; }
    setEnCours(true); setErreur('');
    const { error } = await supabase.rpc('definir_objectif', { p_vendeuse_id: id, p_mois: mois, p_objectif: n });
    setEnCours(false);
    if (error) { setErreur(error.message); return; }
    setEdite(null);
    const r = await lire(mois); setLignes(r.lignes);
  };

  const totalObjectif = lignes.reduce((a, l) => a + l.objectif, 0);
  const totalRealise = lignes.filter(l => l.objectif > 0).reduce((a, l) => a + l.realise, 0);

  return (
    <div style={{ ...carte, padding: '20px 22px', marginBottom: '20px' }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '12px', flexWrap: 'wrap', marginBottom: '16px' }}>
        <div>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '16px', fontWeight: 700, color: INK }}>
            <span className="ms" style={{ fontSize: '20px', color: BLUE }}>flag</span>Objectifs du mois
          </div>
          {totalObjectif > 0 && <div style={{ fontSize: '12.5px', color: MUTE, marginTop: '2px' }}>Équipe : {fmt(totalRealise)} / {fmt(totalObjectif)} {dev} ({Math.round((totalRealise / totalObjectif) * 100)} %)</div>}
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
          <button onClick={() => changerMois(decalage - 1)} aria-label="Mois précédent" style={{ width: '34px', height: '34px', borderRadius: '10px', border: `1px solid ${LINE}`, background: '#fff', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms" style={{ fontSize: '20px', color: SOFT }}>chevron_left</span></button>
          <span style={{ minWidth: '140px', textAlign: 'center', fontSize: '14px', fontWeight: 700, color: INK }}>{nomMois(mois)}</span>
          <button onClick={() => changerMois(decalage + 1)} disabled={decalage >= 1} aria-label="Mois suivant" style={{ width: '34px', height: '34px', borderRadius: '10px', border: `1px solid ${LINE}`, background: '#fff', cursor: decalage >= 1 ? 'default' : 'pointer', opacity: decalage >= 1 ? 0.4 : 1, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms" style={{ fontSize: '20px', color: SOFT }}>chevron_right</span></button>
        </div>
      </div>

      {erreur && <div style={{ fontSize: '13px', color: ROUGE, marginBottom: '10px' }}>{erreur}</div>}

      {chargement ? (
        <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '16px 0', margin: 0 }}>Chargement…</p>
      ) : lignes.length === 0 ? (
        <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '16px 0', margin: 0 }}>Aucune vendeuse active. Créez des comptes dans Paramètres.</p>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
          {lignes.map(l => {
            const pct = l.objectif > 0 ? Math.min(100, Math.round((l.realise / l.objectif) * 100)) : 0;
            const atteint = l.objectif > 0 && l.realise >= l.objectif;
            return (
              <div key={l.id} style={{ paddingBottom: '12px', borderBottom: '1px solid #F1F4FA' }}>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '10px', flexWrap: 'wrap' }}>
                  <div style={{ minWidth: 0 }}>
                    <span style={{ fontSize: '14.5px', fontWeight: 700, color: INK }}>{l.nom}</span>
                    {l.role !== 'vendeuse' && <span style={{ fontSize: '11px', color: MUTE, marginLeft: '6px' }}>({l.role === 'proprietaire' ? 'propriétaire' : 'gérant'})</span>}
                    <div style={{ fontSize: '12.5px', color: '#5A6472', marginTop: '2px' }}>
                      Réalisé : <b style={{ color: INK }}>{fmt(l.realise)}</b>{l.objectif > 0 ? ` / ${fmt(l.objectif)}` : ''} {dev} · {l.nb} vente{l.nb > 1 ? 's' : ''}
                    </div>
                  </div>
                  {edite !== l.id && (
                    <button onClick={() => { setErreur(''); setEdite(l.id); setValeur(l.objectif ? String(l.objectif) : ''); }}
                      style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12.5px', fontWeight: 600, color: BLUE, background: '#EEF3FC', border: 'none', borderRadius: '9px', padding: '6px 12px', cursor: 'pointer' }}>
                      <span className="ms" style={{ fontSize: '15px' }}>edit</span>{l.objectif > 0 ? "Modifier l'objectif" : 'Fixer un objectif'}
                    </button>
                  )}
                </div>

                {edite === l.id ? (
                  <div style={{ display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' }}>
                    <input type="number" inputMode="numeric" min={0} value={valeur} onChange={e => setValeur(e.target.value)} autoFocus
                      placeholder={`Objectif en ${dev} (0 = aucun)`} aria-label={`Objectif de ${l.nom}`}
                      style={{ flex: 1, minWidth: '150px', height: '40px', padding: '0 14px', borderRadius: '10px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px' }} />
                    <button onClick={() => enregistrer(l.id)} disabled={enCours} style={{ height: '40px', padding: '0 16px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 700, background: BLUE, color: '#fff', opacity: enCours ? 0.6 : 1 }}>{enCours ? '…' : 'Enregistrer'}</button>
                    <button onClick={() => setEdite(null)} disabled={enCours} style={{ height: '40px', padding: '0 14px', borderRadius: '10px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, background: '#fff', color: '#5A6472', border: `1px solid ${LINE}` }}>Annuler</button>
                  </div>
                ) : l.objectif > 0 ? (
                  <div style={{ marginTop: '8px' }}>
                    <div style={{ height: '9px', background: '#EEF1F7', borderRadius: '6px', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, background: atteint ? 'linear-gradient(90deg,#34C08A,#1F9D6B)' : 'linear-gradient(90deg,#4B7DF5,#1D4FD0)', borderRadius: '6px', transition: 'width .3s' }} />
                    </div>
                    <div style={{ fontSize: '12px', color: atteint ? VERT : MUTE, fontWeight: 600, marginTop: '5px' }}>
                      {atteint ? 'Objectif atteint' : `${pct} % · il reste ${fmt(l.objectif - l.realise)} ${dev}`}
                    </div>
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
