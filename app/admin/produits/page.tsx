'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useBoutique, SEUIL_STOCK_BAS_DEFAUT } from '@/lib/boutique';
import { signalerAuPatron } from '../../components/ValidationGerant';
import PanneauStock from './PanneauStock';

type Produit = { id: number; nom: string; prix: number; description: string; stock_restant: number; stock_initial: number; image: string | null; actif: boolean; suivi_stock: boolean };
type FormProduit = { nom: string; prix: number; description: string; stock_restant: number; image: string | null; prix_achat: string; service: boolean };
const FORM_VIDE: FormProduit = { nom: '', prix: 0, description: '', stock_restant: 0, image: null, prix_achat: '', service: false };
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';

const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)' };
const inputStyle: React.CSSProperties = { height: '44px', padding: '0 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px', width: '100%' };
const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: SOFT, letterSpacing: '.5px', marginBottom: '6px', textTransform: 'uppercase' };
const th: React.CSSProperties = { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', textAlign: 'left', padding: '13px 20px', background: '#FBFCFE', borderBottom: '1px solid #EEF2F8', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '13px 20px', borderBottom: '1px solid #F1F4FA', verticalAlign: 'middle' };
const petitBouton: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '6px', height: '38px', padding: '0 12px', borderRadius: '11px', cursor: 'pointer', border: 'none', fontSize: '13px', fontWeight: 600 };

async function lireProduits() {
  const [{ data }, { data: c }] = await Promise.all([
    supabase.from('produits').select('*').order('nom'),
    // Prix d'achat : table reservee au gerant / proprietaire.
    supabase.from('produits_couts').select('produit_id, prix_achat'),
  ]);
  return {
    produits: (data || []) as Produit[],
    couts: Object.fromEntries((c || []).map((x: any) => [x.produit_id, Number(x.prix_achat)])) as Record<number, number>,
  };
}

export default function AdminProduits() {
  const boutique = useBoutique();
  const dev = boutique?.devise || 'FCFA';
  const [produits, setProduits] = useState<Produit[]>([]);
  const [couts, setCouts] = useState<Record<number, number>>({});
  const [chargement, setChargement] = useState(true);
  const [q, setQ] = useState('');
  const [voirRetires, setVoirRetires] = useState(false);
  const [modalOuvert, setModalOuvert] = useState(false);
  const [produitEdite, setProduitEdite] = useState<Produit | null>(null);
  const [form, setForm] = useState(FORM_VIDE);
  const [sauvegarde, setSauvegarde] = useState(false);
  const [erreur, setErreur] = useState('');
  const [erreurForm, setErreurForm] = useState('');
  const [stockOuvert, setStockOuvert] = useState<number | null>(null);

  const chargerProduits = async () => {
    const r = await lireProduits();
    setProduits(r.produits); setCouts(r.couts); setChargement(false);
  };
  useEffect(() => {
    let annule = false;
    lireProduits().then(r => { if (!annule) { setProduits(r.produits); setCouts(r.couts); setChargement(false); } });
    return () => { annule = true; };
  }, []);

  const ouvrirAjout = () => { setForm(FORM_VIDE); setProduitEdite(null); setErreurForm(''); setModalOuvert(true); };
  const ouvrirEdit = (p: Produit) => {
    setForm({ nom: p.nom, prix: p.prix, description: p.description || '', stock_restant: p.stock_restant, image: p.image, prix_achat: couts[p.id] !== undefined ? String(couts[p.id]) : '', service: p.suivi_stock === false });
    setProduitEdite(p); setErreurForm(''); setModalOuvert(true);
  };
  const fermerModal = () => { setModalOuvert(false); setProduitEdite(null); };

  const sauvegarder = async () => {
    if (!form.nom.trim()) { setErreurForm('Le nom du produit est obligatoire.'); return; }
    if (form.prix <= 0) { setErreurForm('Le prix de vente doit être supérieur à 0.'); return; }
    if (!produitEdite && form.stock_restant < 0) { setErreurForm('Le stock de départ ne peut pas être négatif.'); return; }
    const prixAchat = form.prix_achat.trim() === '' ? null : Number(form.prix_achat);
    if (prixAchat !== null && (isNaN(prixAchat) || prixAchat < 0)) { setErreurForm("Prix d'achat invalide."); return; }
    setSauvegarde(true); setErreurForm('');
    const champs = { nom: form.nom.trim(), prix: form.prix, description: form.description, image: form.image, suivi_stock: !form.service };
    if (produitEdite && produitEdite.suivi_stock !== false && form.service && produitEdite.stock_restant > 0
      && !confirm(`« ${produitEdite.nom} » deviendra un service sans stock : les ${produitEdite.stock_restant} en stock ne seront plus comptés. Continuer ?`)) { setSauvegarde(false); return; }
    let produitId = produitEdite?.id;
    if (produitEdite) {
      // Le stock d'un produit existant ne se modifie plus ici : uniquement par
      // Réassort / Correction (bouton Stock), pour tracer chaque mouvement.
      const { error } = await supabase.from('produits').update(champs).eq('id', produitEdite.id);
      if (error) { setSauvegarde(false); setErreurForm(`Enregistrement impossible : ${error.message}`); return; }
    } else {
      const { data, error } = await supabase.from('produits').insert({ ...champs, stock_restant: form.stock_restant, stock_initial: form.stock_restant }).select('id').single();
      if (error) { setSauvegarde(false); setErreurForm(`Enregistrement impossible : ${error.message}`); return; }
      produitId = data.id;
    }
    if (produitId !== undefined && prixAchat !== (couts[produitId] ?? null)) {
      const { error } = prixAchat === null
        ? await supabase.from('produits_couts').delete().eq('produit_id', produitId)
        : await supabase.from('produits_couts').upsert({ produit_id: produitId, prix_achat: prixAchat, maj_le: new Date().toISOString() });
      if (error) { setSauvegarde(false); await chargerProduits(); setErreurForm(`Produit enregistré, mais pas le prix d'achat : ${error.message}`); return; }
    }
    signalerAuPatron(); // un changement de prix est note au journal
    await chargerProduits();
    setSauvegarde(false);
    fermerModal();
  };

  // Retirer de la vente = masque le produit chez les vendeuses, sans rien effacer.
  const basculerActif = async (p: Produit) => {
    setErreur('');
    const { error } = await supabase.from('produits').update({ actif: !p.actif }).eq('id', p.id);
    if (error) { setErreur(`Modification impossible : ${error.message}`); return; }
    await chargerProduits();
  };

  const supprimer = async (p: Produit) => {
    if (!confirm(`Supprimer « ${p.nom} » ?`)) return;
    setErreur('');
    const { error } = await supabase.from('produits').delete().eq('id', p.id);
    // 23503 = cle etrangere : le produit figure dans des ventes (historique a garder).
    if (error) { setErreur(error.code === '23503' ? `« ${p.nom} » a déjà été vendu : il ne peut pas être supprimé sans effacer l'historique. Utilisez plutôt « Retirer de la vente ».` : `Suppression impossible : ${error.message}`); return; }
    signalerAuPatron();
    await chargerProduits();
  };

  const badge = (p: Produit): { text: string; col: string; bg: string } => {
    if (p.suivi_stock === false) return { text: 'Service', col: BLUE, bg: '#EEF3FC' };
    if (p.stock_restant <= 0) return { text: 'Épuisé', col: '#D24444', bg: 'rgba(210,68,68,.10)' };
    if (p.stock_restant <= (boutique?.seuil_stock_bas ?? SEUIL_STOCK_BAS_DEFAUT)) return { text: `${p.stock_restant} en stock`, col: '#C8891F', bg: 'rgba(200,137,31,.14)' };
    return { text: `${p.stock_restant} en stock`, col: '#1F9D6B', bg: 'rgba(31,157,107,.12)' };
  };

  const filtres = useMemo(() => {
    const t = q.trim().toLowerCase();
    const visibles = produits.filter(p => voirRetires || p.actif);
    return t ? visibles.filter(p => p.nom.toLowerCase().includes(t) || (p.description || '').toLowerCase().includes(t)) : visibles;
  }, [produits, q, voirRetires]);

  const actifs = useMemo(() => produits.filter(p => p.actif), [produits]);
  // Les services (sans stock) ne comptent pas dans la valeur du stock.
  const stockes = useMemo(() => actifs.filter(p => p.suivi_stock !== false), [actifs]);
  const valeurTotale = useMemo(() => stockes.reduce((a, p) => a + Number(p.prix) * Number(p.stock_restant), 0), [stockes]);
  // Valeur d'achat du stock (seulement les produits qui ont un prix d'achat).
  const valeurAchat = useMemo(() => stockes.reduce((a, p) => a + (couts[p.id] !== undefined ? couts[p.id] * Number(p.stock_restant) : 0), 0), [stockes, couts]);
  const ruptures = useMemo(() => stockes.filter(p => p.stock_restant <= 0).length, [stockes]);
  const nbRetires = produits.length - actifs.length;

  const miniStats = [
    { icon: 'inventory_2', label: 'Articles en vente', value: actifs.length.toString(), col: BLUE },
    { icon: 'inventory', label: 'Valeur du stock (prix de vente)', value: `${fmt(valeurTotale)} ${dev}`, col: '#1F9D6B' },
    ...(valeurAchat > 0 ? [{ icon: 'shopping_cart', label: "Valeur d'achat du stock", value: `${fmt(valeurAchat)} ${dev}`, col: '#5A6472' }] : []),
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
        {nbRetires > 0 && (
          <button onClick={() => setVoirRetires(!voirRetires)} aria-pressed={voirRetires} style={{ height: '46px', padding: '0 16px', borderRadius: '13px', cursor: 'pointer', fontSize: '13.5px', fontWeight: 600, border: '1px solid #E4E9F2', background: voirRetires ? '#EEF3FC' : '#fff', color: voirRetires ? BLUE : SOFT }}>
            {voirRetires ? 'Masquer' : 'Voir'} les produits retirés ({nbRetires})
          </button>
        )}
      </div>

      {erreur && (
        <div role="alert" style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '16px', padding: '12px 16px', borderRadius: '14px', background: 'rgba(210,68,68,.10)', border: '1px solid rgba(210,68,68,.25)', color: '#D24444', fontSize: '13.5px' }}>
          <span className="ms" style={{ fontSize: '20px' }}>error</span>
          <span style={{ flex: 1 }}>{erreur}</span>
          <button onClick={() => setErreur('')} aria-label="Fermer" style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#D24444', display: 'flex' }}><span className="ms" style={{ fontSize: '18px' }}>close</span></button>
        </div>
      )}

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
                  const cout = couts[p.id];
                  return (
                    <Fragment key={p.id}>
                    <tr style={{ opacity: p.actif ? 1 : 0.65 }}>
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
                            <div style={{ fontSize: '14.5px', fontWeight: 600, color: INK }}>
                              {p.nom}
                              {!p.actif && <span style={{ marginLeft: '8px', fontSize: '11px', fontWeight: 700, color: SOFT, background: '#F1F4FA', padding: '2px 8px', borderRadius: '20px' }}>Retiré de la vente</span>}
                            </div>
                            {p.description && <div style={{ fontSize: '12px', color: MUTE, marginTop: '1px', maxWidth: '260px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.description}</div>}
                          </div>
                        </div>
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: '15px', fontWeight: 800, color: INK }}>{fmt(p.prix)}</span>
                        <span style={{ fontSize: '11.5px', fontWeight: 700, color: BLUE, marginLeft: '4px' }}>{dev}</span>
                        {cout !== undefined && (
                          <div style={{ fontSize: '11.5px', marginTop: '2px', color: p.prix - cout >= 0 ? '#1F9D6B' : '#D24444' }}>
                            Marge {fmt(p.prix - cout)} ({p.prix > 0 ? Math.round(((p.prix - cout) / p.prix) * 100) : 0} %)
                          </div>
                        )}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: b.col, background: b.bg, padding: '5px 12px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{b.text}</span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontSize: '14px', fontWeight: 700, color: '#5A6472' }}>{p.suivi_stock === false ? '—' : fmt(Number(p.prix) * Number(p.stock_restant))}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <div style={{ display: 'inline-flex', gap: '8px' }}>
                          {p.suivi_stock !== false && <button onClick={() => setStockOuvert(stockOuvert === p.id ? null : p.id)} aria-expanded={stockOuvert === p.id} aria-label={`Stock de ${p.nom}`} style={{ ...petitBouton, background: stockOuvert === p.id ? BLUE : '#EEF3FC', color: stockOuvert === p.id ? '#fff' : BLUE }}>
                            <span className="ms" style={{ fontSize: '18px' }}>inventory</span>Stock
                          </button>}
                          <button onClick={() => ouvrirEdit(p)} aria-label={`Modifier ${p.nom}`} style={{ ...petitBouton, background: '#EEF3FC', color: BLUE }}>
                            <span className="ms" style={{ fontSize: '18px' }}>edit</span>Modifier
                          </button>
                          <button onClick={() => basculerActif(p)} title={p.actif ? 'Masquer ce produit chez les vendeuses (historique conservé)' : 'Rendre ce produit de nouveau vendable'} aria-label={p.actif ? `Retirer ${p.nom} de la vente` : `Remettre ${p.nom} en vente`} style={{ ...petitBouton, width: '38px', padding: 0, justifyContent: 'center', background: '#F1F4FA', color: SOFT }}>
                            <span className="ms" style={{ fontSize: '18px' }}>{p.actif ? 'visibility_off' : 'visibility'}</span>
                          </button>
                          <button onClick={() => supprimer(p)} aria-label={`Supprimer ${p.nom}`} style={{ ...petitBouton, width: '38px', padding: 0, justifyContent: 'center', background: 'rgba(210,68,68,.10)', color: '#D24444' }}>
                            <span className="ms" style={{ fontSize: '18px' }}>delete</span>
                          </button>
                        </div>
                      </td>
                    </tr>
                    {stockOuvert === p.id && (
                      <tr><td colSpan={5} style={{ padding: '4px 20px 18px', borderBottom: '1px solid #F1F4FA' }}>
                        <PanneauStock produit={p} onModifie={chargerProduits} />
                      </td></tr>
                    )}
                    </Fragment>
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
                  <div style={labelStyle}>Prix de vente ({dev}) *</div>
                  <input style={inputStyle} type="number" min={0} value={form.prix || ''} onChange={e => setForm({ ...form, prix: Number(e.target.value) })} placeholder="0" />
                </div>
                <div>
                  <div style={labelStyle}>Prix d&apos;achat ({dev})</div>
                  <input style={inputStyle} type="number" min={0} value={form.prix_achat} onChange={e => setForm({ ...form, prix_achat: e.target.value })} placeholder="Visible par vous seul" />
                  {form.prix_achat.trim() !== '' && form.prix > 0 && (
                    <div style={{ fontSize: '11.5px', marginTop: '5px', color: form.prix - Number(form.prix_achat) >= 0 ? '#1F9D6B' : '#D24444' }}>
                      Marge : {fmt(form.prix - Number(form.prix_achat))} {dev} ({Math.round(((form.prix - Number(form.prix_achat)) / form.prix) * 100)} %)
                    </div>
                  )}
                </div>
                {form.service ? null : produitEdite && produitEdite.suivi_stock !== false ? (
                  <div>
                    <div style={labelStyle}>Stock</div>
                    <div style={{ fontSize: '13px', color: SOFT, lineHeight: 1.45, paddingTop: '4px' }}>{produitEdite.stock_restant} en stock. Pour le changer : bouton <b>Stock</b> (réassort ou correction), pour que tout soit tracé.</div>
                  </div>
                ) : produitEdite ? (
                  <div>
                    <div style={labelStyle}>Stock</div>
                    <div style={{ fontSize: '13px', color: SOFT, lineHeight: 1.45, paddingTop: '4px' }}>Part de 0. Ajoutez ensuite avec le bouton <b>Stock</b>.</div>
                  </div>
                ) : (
                  <div>
                    <div style={labelStyle}>Stock de départ *</div>
                    <input style={inputStyle} type="number" min={0} value={form.stock_restant || ''} onChange={e => setForm({ ...form, stock_restant: Number(e.target.value) })} placeholder="0" />
                  </div>
                )}
                <div>
                  <div style={labelStyle}>URL image (optionnel)</div>
                  <input style={inputStyle} value={form.image || ''} onChange={e => setForm({ ...form, image: e.target.value || null })} placeholder="https://…" />
                </div>
              </div>
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: '10px', marginBottom: '16px', padding: '12px 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', cursor: 'pointer' }}>
                <input type="checkbox" checked={form.service} onChange={e => setForm({ ...form, service: e.target.checked })} style={{ marginTop: '3px', width: '17px', height: '17px' }} />
                <span style={{ fontSize: '13.5px', color: INK, lineHeight: 1.45 }}><b>C&apos;est un service</b> (pas de stock)<br /><span style={{ color: SOFT, fontSize: '12.5px' }}>Ex. : repassage d&apos;une chemise, coupe, plat cuisiné. Il se vend sans compter de stock.</span></span>
              </label>
              <div style={{ marginBottom: '20px' }}>
                <div style={labelStyle}>Description</div>
                <textarea style={{ ...inputStyle, height: '72px', resize: 'vertical', paddingTop: '12px' }} value={form.description} onChange={e => setForm({ ...form, description: e.target.value })} placeholder="Description optionnelle…" />
              </div>
              {erreurForm && <div role="alert" style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(210,68,68,.10)', color: '#D24444', fontSize: '13px', marginBottom: '14px' }}>{erreurForm}</div>}
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
