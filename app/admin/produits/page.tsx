'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

type Produit = { id: number; nom: string; prix: number; description: string; stock_restant: number; stock_initial: number; image: string | null };
const FORM_VIDE: Omit<Produit, 'id'> = { nom: '', prix: 0, description: '', stock_restant: 0, stock_initial: 0, image: null };
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

// Palette Stockia (identique au tableau de bord)
const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';

const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)' };
const inputStyle: React.CSSProperties = { height: '44px', padding: '0 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px', width: '100%' };
const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: SOFT, letterSpacing: '.5px', marginBottom: '6px', textTransform: 'uppercase' };
const th: React.CSSProperties = { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', textAlign: 'left', padding: '13px 20px', background: '#FBFCFE', borderBottom: '1px solid #EEF2F8', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '13px 20px', borderBottom: '1px solid #F1F4FA', verticalAlign: 'middle' };

export default function AdminProduits() {
  const [produits, setProduits] = useState<Produit[]>([]);
  const [chargement, setChargement] = useState(true);
  const [q, setQ] = useState('');
  const [modalOuvert, setModalOuvert] = useState(false);
  const [produitEdite, setProduitEdite] = useState<Produit | null>(null);
  const [form, setForm] = useState(FORM_VIDE);
  const [sauvegarde, setSauvegarde] = useState(false);

  useEffect(() => { chargerProduits(); }, []);

  const chargerProduits = async () => {
    const { data } = await supabase.from('produits').select('*').order('nom');
    setProduits(data || []);
    setChargement(false);
  };

  const ouvrirAjout = () => { setForm(FORM_VIDE); setProduitEdite(null); setModalOuvert(true); };
  const ouvrirEdit = (p: Produit) => { setForm({ nom: p.nom, prix: p.prix, description: p.description || '', stock_restant: p.stock_restant, stock_initial: p.stock_initial, image: p.image }); setProduitEdite(p); setModalOuvert(true); };
  const fermerModal = () => { setModalOuvert(false); setProduitEdite(null); };

  const sauvegarder = async () => {
    if (!form.nom.trim() || form.prix <= 0) return;
    setSauvegarde(true);
    if (produitEdite) {
      const diff = form.stock_restant - produitEdite.stock_restant;
      await supabase.from('produits').update({ nom: form.nom.trim(), prix: form.prix, description: form.description, stock_restant: form.stock_restant, stock_initial: produitEdite.stock_initial + diff, image: form.image }).eq('id', produitEdite.id);
    } else {
      await supabase.from('produits').insert({ nom: form.nom.trim(), prix: form.prix, description: form.description, stock_restant: form.stock_restant, stock_initial: form.stock_restant, image: form.image });
    }
    await chargerProduits();
    setSauvegarde(false);
    fermerModal();
  };

  const supprimer = async (id: number) => {
    if (!confirm('Supprimer ce produit ?')) return;
    await supabase.from('produits').delete().eq('id', id);
    await chargerProduits();
  };

  const badge = (p: Produit): { text: string; col: string; bg: string } => {
    if (p.stock_restant <= 0) return { text: 'Épuisé', col: '#D24444', bg: 'rgba(210,68,68,.10)' };
    if (p.stock_restant <= 5) return { text: `${p.stock_restant} en stock`, col: '#C8891F', bg: 'rgba(200,137,31,.14)' };
    return { text: `${p.stock_restant} en stock`, col: '#1F9D6B', bg: 'rgba(31,157,107,.12)' };
  };

  const filtres = useMemo(() => {
    const t = q.trim().toLowerCase();
    return t ? produits.filter(p => p.nom.toLowerCase().includes(t) || (p.description || '').toLowerCase().includes(t)) : produits;
  }, [produits, q]);

  const valeurTotale = useMemo(() => produits.reduce((a, p) => a + Number(p.prix) * Number(p.stock_restant), 0), [produits]);
  const ruptures = useMemo(() => produits.filter(p => p.stock_restant <= 0).length, [produits]);

  const miniStats = [
    { icon: 'inventory_2', label: 'Articles référencés', value: produits.length.toString(), col: BLUE },
    { icon: 'inventory', label: 'Valeur du stock', value: `${fmt(valeurTotale)} FCFA`, col: '#1F9D6B' },
    { icon: 'warning', label: 'Ruptures', value: ruptures.toString(), col: ruptures > 0 ? '#D24444' : '#1F9D6B' },
  ];

  return (
    <div className="fade-up">
      {/* Résumé */}
      <div style={{ ...carte, display: 'flex', flexWrap: 'wrap', marginBottom: '18px' }}>
        {miniStats.map((m, i) => (
          <div key={m.label} style={{ flex: 1, minWidth: '180px', display: 'flex', alignItems: 'center', gap: '13px', padding: '18px 22px', borderLeft: i === 0 ? 'none' : '1px solid #F1F4FA' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span className="ms" style={{ fontSize: '22px', color: m.col }}>{m.icon}</span>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase' }}>{m.label}</div>
              <div style={{ fontSize: '19px', fontWeight: 800, color: INK, marginTop: '2px', letterSpacing: '-.3px' }}>{m.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Barre d'outils */}
      <div style={{ display: 'flex', gap: '12px', marginBottom: '16px', flexWrap: 'wrap', alignItems: 'center' }}>
        <div style={{ position: 'relative', flex: 1, minWidth: '220px', maxWidth: '400px' }}>
          <span className="ms" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '20px', color: MUTE }}>search</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher un article…" style={{ height: '46px', width: '100%', padding: '0 14px 0 44px', borderRadius: '13px', border: '1px solid #E4E9F2', background: '#fff', outline: 'none', fontSize: '14px', color: INK }} />
        </div>
        <button onClick={ouvrirAjout} style={{ display: 'flex', alignItems: 'center', gap: '9px', height: '46px', padding: '0 22px', border: 'none', borderRadius: '13px', cursor: 'pointer', background: 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', color: '#fff', fontSize: '14.5px', fontWeight: 700, boxShadow: '0 8px 18px rgba(37,99,235,.28)' }}>
          <span className="ms" style={{ fontSize: '20px' }}>add</span>Ajouter un produit
        </button>
      </div>

      {/* Tableau */}
      <div style={{ ...carte, overflow: 'hidden' }}>
        {chargement ? (
          <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '50px 0' }}>Chargement…</p>
        ) : filtres.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: MUTE }}>
            <span className="ms" style={{ fontSize: '46px', display: 'block', marginBottom: '10px', color: '#C6D2E8' }}>inventory_2</span>
            {produits.length === 0 ? 'Aucun produit. Commencez par en ajouter un.' : 'Aucun article ne correspond à votre recherche.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
              <thead>
                <tr>
                  <th style={th}>Article</th>
                  <th style={{ ...th, textAlign: 'right' }}>Prix unitaire</th>
                  <th style={{ ...th, textAlign: 'center' }}>Stock</th>
                  <th style={{ ...th, textAlign: 'right' }}>Valeur stock</th>
                  <th style={{ ...th, textAlign: 'right' }}></th>
                </tr>
              </thead>
              <tbody>
                {filtres.map(p => {
                  const b = badge(p);
                  return (
                    <tr key={p.id}>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '13px' }}>
                          {p.image ? (
                            <img src={p.image} alt={p.nom} style={{ width: '46px', height: '46px', objectFit: 'cover', borderRadius: '12px', flexShrink: 0 }} />
                          ) : (
                            <div style={{ width: '46px', height: '46px', borderRadius: '12px', flexShrink: 0, background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                              <span className="ms" style={{ fontSize: '22px', color: '#B7C4DE' }}>image</span>
                            </div>
                          )}
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '14.5px', fontWeight: 600, color: INK }}>{p.nom}</div>
                            {p.description && <div style={{ fontSize: '12px', color: MUTE, marginTop: '1px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: '15px', fontWeight: 800, color: INK }}>{fmt(p.prix)}</span>
                        <span style={{ fontSize: '11.5px', fontWeight: 700, color: BLUE, marginLeft: '4px' }}>FCFA</span>
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: b.col, background: b.bg, padding: '5px 12px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{b.text}</span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 700, color: '#5A6472' }}>{fmt(Number(p.prix) * Number(p.stock_restant))}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          <button onClick={() => ouvrirEdit(p)} aria-label={`Modifier ${p.nom}`} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '38px', padding: '0 14px', borderRadius: '11px', cursor: 'pointer', background: '#EEF3FC', border: 'none', color: BLUE, fontSize: '13px', fontWeight: 600 }}>
                            <span className="ms" style={{ fontSize: '18px' }}>edit</span>Modifier
                          </button>
                          <button onClick={() => supprimer(p.id)} aria-label={`Supprimer ${p.nom}`} style={{ width: '38px', height: '38px', borderRadius: '11px', cursor: 'pointer', background: 'rgba(210,68,68,.10)', border: 'none', color: '#D24444', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                            <span className="ms" style={{ fontSize: '18px' }}>delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Modal ajout / édition */}
      {modalOuvert && (
        <div onClick={fermerModal} style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', zIndex: 100, overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '540px', boxShadow: '0 24px 60px rgba(16,24,40,.28)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #EEF2F8' }}>
              <div style={{ fontSize: '17px', fontWeight: 800, color: INK }}>{produitEdite ? 'Modifier le produit' : 'Nouveau produit'}</div>
              <button onClick={fermerModal} aria-label="Fermer" style={{ width: '36px', height: '36px', borderRadius: '10px', border: 'none', background: '#F1F4FA', color: SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="ms" style={{ fontSize: '20px' }}>close</span>
              </button>
            </div>
            <div style={{ padding: '22px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(160px,1fr))', gap: '14px', marginBottom: '14px' }}>
                <div>
                  <div style={labelStyle}>Nom du produit *</div>
                  <input style={inputStyle} value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} placeholder="Ex : Sac à main cuir" />
                </div>
                <div>
                  <div style={labelStyle}>Prix (FCFA) *</div>
                  <input style={inputStyle} type="number" value={form.prix || ''} onChange={e => setForm({ ...form, prix: Number(e.target.value) })} placeholder="0" />
                </div>
                <div>
                  <div style={labelStyle}>Stock *</div>
                  <input style={inputStyle} type="number" value={form.stock_restant || ''} onChange={e => setForm({ ...form, stock_restant: Number(e.target.value) })} placeholder="0" />
                </div>
                <div>
                  <div style={labelStyle}>URL image (optionnel)</div>
                  <input style={inputStyle} value={form.image || ''} onChange={e => setForm({ ...form, image: e.target.value || null })} placeholder="https://…" />
                </div>
              </div>
              <div style={{ marginBottom: '20px' }}>
                <div style={labelStyle}>Description</div>
                <textarea style={{ ...inputStyle, height: '72px', resize: 'vertical', paddingTop: '12px' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description optionnelle…" />
              </div>
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={sauvegarder} disabled={sauvegarde} style={{ flex: 1, height: '46px', border: 'none', borderRadius: '13px', cursor: 'pointer', background: 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', color: '#fff', fontWeight: 700, fontSize: '14px', opacity: sauvegarde ? 0.7 : 1 }}>
                  {sauvegarde ? 'Sauvegarde…' : produitEdite ? 'Enregistrer les modifications' : 'Créer le produit'}
                </button>
                <button onClick={fermerModal} style={{ height: '46px', padding: '0 22px', border: '1px solid #E4E9F2', borderRadius: '13px', cursor: 'pointer', background: '#fff', color: '#5A6472', fontSize: '14px', fontWeight: 600 }}>Annuler</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
