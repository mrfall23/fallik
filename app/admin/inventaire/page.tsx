'use client';
import { Fragment, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { signalerAuPatron } from '../../components/ValidationGerant';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const th: React.CSSProperties = { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', textAlign: 'left', padding: '12px 16px', background: '#FBFCFE', borderBottom: '1px solid #EEF2F8', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '10px 16px', borderBottom: '1px solid #F1F4FA', fontSize: '14px', color: INK, verticalAlign: 'middle' };
const couleur = (e: number) => (e < 0 ? '#D24444' : e > 0 ? '#C8891F' : '#1F9D6B');

// Inventaire : on compte physiquement, Fallik montre ce qui manque par
// produit (bouteilles disparues) et peut remettre le stock a jour.
export default function AdminInventaire() {
  const [produits, setProduits] = useState<any[]>([]);
  const [comptes, setComptes] = useState<Record<number, string>>({});
  const [appliquer, setAppliquer] = useState(true);
  const [commentaire, setCommentaire] = useState('');
  const [historique, setHistorique] = useState<any[]>([]);
  const [ouvert, setOuvert] = useState<number | null>(null);
  const [lignesOuvert, setLignesOuvert] = useState<any[]>([]);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const [message, setMessage] = useState('');

  const lire = () => Promise.all([
    supabase.from('produits').select('id, nom, prix, stock_restant').eq('actif', true).eq('suivi_stock', true).order('nom'),
    supabase.from('inventaires').select('*').order('cree_le', { ascending: false }).limit(30),
  ]);
  const charger = async () => {
    const [{ data: p }, { data: h }] = await lire();
    setProduits(p || []); setHistorique(h || []);
  };
  useEffect(() => {
    let annule = false;
    lire().then(([{ data: p }, { data: h }]) => { if (!annule) { setProduits(p || []); setHistorique(h || []); } });
    return () => { annule = true; };
  }, []);

  const saisis = produits.filter(p => (comptes[p.id] ?? '') !== '');
  const ecartDe = (p: any) => Number(comptes[p.id]) - p.stock_restant;
  const valeurTotale = saisis.reduce((s, p) => s + ecartDe(p) * Number(p.prix), 0);

  const enregistrer = async () => {
    if (saisis.length === 0) { setErreur('Tapez au moins une quantité comptée.'); return; }
    if (!confirm(`Enregistrer l'inventaire de ${saisis.length} produit(s)${appliquer ? ' et mettre le stock à jour' : ''} ?`)) return;
    setOccupe(true); setErreur('');
    const { error } = await supabase.rpc('enregistrer_inventaire', {
      p_lignes: saisis.map(p => ({ produit_id: p.id, compte: Number(comptes[p.id]) })),
      p_appliquer: appliquer, p_commentaire: commentaire || null,
    });
    setOccupe(false);
    if (error) { setErreur(error.message); return; }
    setComptes({}); setCommentaire('');
    setMessage('Inventaire enregistré.'); setTimeout(() => setMessage(''), 3500);
    signalerAuPatron();
    charger();
  };

  const voir = async (id: number) => {
    if (ouvert === id) { setOuvert(null); return; }
    setOuvert(id);
    const { data } = await supabase.from('inventaire_lignes').select('*').eq('inventaire_id', id).order('ecart');
    setLignesOuvert(data || []);
  };

  return (
    <div className="fade-up">
      <div style={{ fontSize: '13.5px', color: SOFT, lineHeight: 1.5, marginBottom: '16px', maxWidth: '680px' }}>
        Comptez les produits en rayon et en réserve, tapez les quantités. Les produits laissés vides ne sont pas comptés.
      </div>

      <div style={{ background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, overflow: 'hidden', marginBottom: '16px' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '560px' }}>
            <thead><tr>
              <th style={th}>Produit</th><th style={{ ...th, textAlign: 'right' }}>Selon Fallik</th>
              <th style={{ ...th, width: '130px' }}>Compté</th><th style={{ ...th, textAlign: 'right' }}>Écart</th>
            </tr></thead>
            <tbody>
              {produits.map(p => {
                const saisi = (comptes[p.id] ?? '') !== '';
                const e = saisi ? ecartDe(p) : 0;
                return (
                  <tr key={p.id}>
                    <td style={{ ...td, fontWeight: 600 }}>{p.nom}</td>
                    <td style={{ ...td, textAlign: 'right', color: SOFT }}>{p.stock_restant}</td>
                    <td style={td}>
                      <input type="number" inputMode="numeric" min="0" aria-label={`Quantité comptée : ${p.nom}`} value={comptes[p.id] ?? ''}
                        onChange={ev => setComptes({ ...comptes, [p.id]: ev.target.value.replace(/[^0-9]/g, '') })}
                        style={{ width: '100%', height: '38px', padding: '0 10px', borderRadius: '10px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', fontSize: '14px', color: INK }} />
                    </td>
                    <td style={{ ...td, textAlign: 'right', fontWeight: 700, color: saisi ? couleur(e) : MUTE }}>
                      {saisi ? `${e > 0 ? '+' : ''}${e}` : '—'}
                      {saisi && e !== 0 && <div style={{ fontSize: '11.5px', fontWeight: 600 }}>{e > 0 ? '+' : ''}{fmt(e * Number(p.prix))} FCFA</div>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '12px', alignItems: 'center', marginBottom: '28px' }}>
        <label style={{ display: 'flex', alignItems: 'center', gap: '8px', fontSize: '13.5px', color: INK, cursor: 'pointer' }}>
          <input type="checkbox" checked={appliquer} onChange={e => setAppliquer(e.target.checked)} />
          Mettre le stock à jour avec mes comptages
        </label>
        <input value={commentaire} onChange={e => setCommentaire(e.target.value)} placeholder="Commentaire (optionnel)" style={{ flex: '1 1 200px', height: '42px', padding: '0 12px', borderRadius: '11px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', fontSize: '14px', color: INK }} />
        <div style={{ fontSize: '14px', fontWeight: 800, color: saisis.length ? couleur(valeurTotale) : MUTE }}>{saisis.length ? `${valeurTotale > 0 ? '+' : ''}${fmt(valeurTotale)} FCFA` : ''}</div>
        <button disabled={occupe} onClick={enregistrer} style={{ height: '44px', padding: '0 20px', border: 'none', borderRadius: '12px', background: GRAD, color: '#fff', fontWeight: 700, fontSize: '14px', cursor: 'pointer' }}>{occupe ? 'Enregistrement…' : "Enregistrer l'inventaire"}</button>
      </div>
      {(erreur || message) && <div style={{ marginTop: '-16px', marginBottom: '20px', fontSize: '13.5px', fontWeight: 600, color: erreur ? '#D24444' : '#1F9D6B' }}>{erreur || message}</div>}

      <div style={{ fontSize: '16px', fontWeight: 800, color: INK, marginBottom: '12px' }}>Inventaires précédents</div>
      {historique.length === 0 ? (
        <div style={{ color: MUTE, fontSize: '13.5px' }}>Aucun inventaire pour l&apos;instant.</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, overflow: 'hidden' }}>
          {historique.map((h, i) => (
            <Fragment key={h.id}>
              <button onClick={() => voir(h.id)} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 18px', border: 'none', borderTop: i ? '1px solid #F1F4FA' : 'none', background: '#fff', cursor: 'pointer', textAlign: 'left' }}>
                <span className="ms" style={{ fontSize: '20px', color: BLUE }}>fact_check</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '14px', fontWeight: 700, color: INK }}>{new Date(h.cree_le).toLocaleString('fr-FR')} · {h.utilisateur_nom}</div>
                  <div style={{ fontSize: '12.5px', color: MUTE }}>{h.nb_ecarts} écart(s) sur {h.nb_produits} produit(s){h.applique ? '' : ' · stock non modifié'}{h.commentaire ? ` · ${h.commentaire}` : ''}</div>
                </div>
                <div style={{ fontSize: '14px', fontWeight: 800, color: couleur(Number(h.valeur_ecart)) }}>{Number(h.valeur_ecart) > 0 ? '+' : ''}{fmt(h.valeur_ecart)} FCFA</div>
                <span className="ms" style={{ fontSize: '20px', color: SOFT }}>{ouvert === h.id ? 'expand_less' : 'expand_more'}</span>
              </button>
              {ouvert === h.id && (
                <div style={{ padding: '4px 18px 14px 50px', background: '#FBFCFE' }}>
                  {lignesOuvert.map(l => (
                    <div key={l.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '13px', padding: '5px 0', borderBottom: '1px solid #F1F4FA' }}>
                      <span style={{ color: INK }}>{l.produit_nom}</span>
                      <span style={{ color: SOFT }}>{l.theorique} attendu · {l.compte} compté · <b style={{ color: couleur(l.ecart) }}>{l.ecart > 0 ? '+' : ''}{l.ecart}</b></span>
                    </div>
                  ))}
                </div>
              )}
            </Fragment>
          ))}
        </div>
      )}
    </div>
  );
}
