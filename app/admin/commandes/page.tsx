'use client';
import { useCallback, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useUtilisateur } from '@/lib/utilisateur';
import { signalerAuPatron } from '../../components/ValidationGerant';

// Commandes envoyees par le site web de la boutique (plan Pro). Le gerant les
// valide (=> vente, stock decompte, prix du moment) ou les refuse.

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', LINE = '#EAEEF5';
const VERT = '#1F9D6B', ROUGE = '#D24444';
const MODES: [string, string][] = [['cash', 'Espèces'], ['mobile_money', 'Mobile Money'], ['orange_money', 'Orange Money'], ['carte', 'Carte'], ['autre', 'Autre']];
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '18px 20px' };
const champ: React.CSSProperties = { height: '40px', padding: '0 12px', borderRadius: '11px', background: '#fff', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '13.5px' };
const bouton: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '6px', height: '40px', padding: '0 14px', borderRadius: '11px', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer' };

type Ligne = { commande_id: number; produit_id: number | null; nom: string; quantite: number; prix_unitaire: number };
type Commande = {
  id: number; reference: string; client_nom: string; client_telephone: string; client_adresse: string | null; note: string | null;
  total: number; statut: 'nouvelle' | 'validee' | 'refusee'; vente_id: number | null; motif_refus: string | null; traitee_le: string | null; cree_le: string;
};
const FILTRES: [string, string][] = [['nouvelle', 'À traiter'], ['validee', 'Validées'], ['refusee', 'Refusées'], ['toutes', 'Toutes']];

export default function CommandesEnLigne() {
  const { acces } = useUtilisateur('admin');
  const [filtre, setFiltre] = useState('nouvelle');
  const [commandes, setCommandes] = useState<Commande[] | null>(null);
  const [lignes, setLignes] = useState<Ligne[]>([]);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [mode, setMode] = useState('cash');
  const [acompte, setAcompte] = useState('');
  const [motif, setMotif] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const charger = useCallback(async (f: string) => {
    let req = supabase.from('commandes_en_ligne')
      .select('id, reference, client_nom, client_telephone, client_adresse, note, total, statut, vente_id, motif_refus, traitee_le, cree_le')
      .order('id', { ascending: false }).limit(200);
    if (f !== 'toutes') req = req.eq('statut', f);
    const { data } = await req;
    const cmds = (data || []) as Commande[];
    const { data: l } = cmds.length
      ? await supabase.from('commande_en_ligne_lignes').select('commande_id, produit_id, nom, quantite, prix_unitaire').in('commande_id', cmds.map(c => c.id))
      : { data: [] };
    return { cmds, lignes: (l || []) as Ligne[] };
  }, []);

  useEffect(() => {
    let annule = false;
    charger(filtre).then(r => { if (!annule) { setCommandes(r.cmds); setLignes(r.lignes); } });
    return () => { annule = true; };
  }, [filtre, charger]);

  const recharger = async () => { const r = await charger(filtre); setCommandes(r.cmds); setLignes(r.lignes); };

  const ouvrir = (id: number) => { setOuverte(ouverte === id ? null : id); setMode('cash'); setAcompte(''); setMotif(''); setMessage(null); };

  const valider = async (c: Commande) => {
    const montant = acompte.trim() === '' ? null : Number(acompte);
    if (montant !== null && !(montant >= 0 && montant <= c.total)) { setMessage({ ok: false, texte: 'Acompte invalide.' }); return; }
    setOccupe(true); setMessage(null);
    const { data, error } = await supabase.rpc('commande_valider', { p_id: c.id, p_mode: mode, p_montant_paye: montant });
    setOccupe(false);
    if (error) { setMessage({ ok: false, texte: error.message }); return; }
    setMessage({ ok: true, texte: `Commande ${c.reference} validée : vente n° ${data}.` });
    setOuverte(null); signalerAuPatron(); await recharger();
  };

  const refuser = async (c: Commande) => {
    if (!confirm(`Refuser la commande ${c.reference} de ${c.client_nom} ?`)) return;
    setOccupe(true); setMessage(null);
    const { error } = await supabase.rpc('commande_refuser', { p_id: c.id, p_motif: motif.trim() || null });
    setOccupe(false);
    if (error) { setMessage({ ok: false, texte: error.message }); return; }
    setMessage({ ok: true, texte: `Commande ${c.reference} refusée.` });
    setOuverte(null); await recharger();
  };

  const statutBadge = (s: Commande['statut']) => {
    const [txt, c, bg] = s === 'nouvelle' ? ['À traiter', '#B26A00', '#FFF3DC'] : s === 'validee' ? ['Validée', VERT, 'rgba(31,157,107,.12)'] : ['Refusée', ROUGE, 'rgba(210,68,68,.1)'];
    return <span style={{ fontSize: '12px', fontWeight: 700, color: c, background: bg, padding: '4px 11px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{txt}</span>;
  };
  const whatsapp = (tel: string) => `https://wa.me/${tel.replace(/[^0-9]/g, '').replace(/^(6\d{8})$/, '237$1')}`;

  return (
    <div className="fade-up">
      {acces?.plan !== 'pro' && (
        <div style={{ ...carte, marginBottom: '16px', fontSize: '13.5px', color: '#5A6472' }}>
          Les commandes en ligne viennent de votre site web : réservé au plan Pro. Les commandes déjà reçues restent visibles et peuvent être traitées.
        </div>
      )}

      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {FILTRES.map(([k, l]) => (
          <button key={k} onClick={() => { setFiltre(k); setCommandes(null); setOuverte(null); }}
            style={{ ...bouton, height: '36px', border: filtre === k ? 'none' : `1px solid ${LINE}`, background: filtre === k ? GRAD : '#fff', color: filtre === k ? '#fff' : '#5A6478' }}>{l}</button>
        ))}
      </div>
      {message && <div style={{ marginBottom: '12px', fontSize: '13.5px', fontWeight: 600, color: message.ok ? VERT : ROUGE }}>{message.texte}</div>}

      {commandes === null ? (
        <div style={{ ...carte, color: MUTE, fontSize: '13.5px' }}>Chargement…</div>
      ) : commandes.length === 0 ? (
        <div style={{ ...carte, color: MUTE, fontSize: '13.5px', textAlign: 'center', padding: '40px 20px' }}>
          <span className="ms" style={{ fontSize: '36px', display: 'block', marginBottom: '8px', color: '#C5CCD8' }}>shopping_cart</span>
          {filtre === 'nouvelle' ? 'Aucune commande à traiter.' : 'Aucune commande.'}
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {commandes.map(c => {
            const ls = lignes.filter(l => l.commande_id === c.id);
            const ouv = ouverte === c.id;
            return (
              <div key={c.id} style={carte}>
                <div onClick={() => ouvrir(c.id)} style={{ display: 'flex', alignItems: 'center', gap: '12px', cursor: 'pointer', flexWrap: 'wrap' }}>
                  <div style={{ flex: 1, minWidth: '180px' }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: INK }}>{c.client_nom} <span style={{ fontSize: '12.5px', fontWeight: 600, color: MUTE }}>· {c.reference}</span></div>
                    <div style={{ fontSize: '12.5px', color: '#6B7688', marginTop: '2px' }}>
                      {new Date(c.cree_le).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {ls.reduce((s, l) => s + l.quantite, 0)} article(s)
                    </div>
                  </div>
                  <div style={{ fontSize: '16px', fontWeight: 800, color: INK }}>{fmt(c.total)} FCFA</div>
                  {statutBadge(c.statut)}
                  <span className="ms" style={{ color: MUTE }}>{ouv ? 'expand_less' : 'expand_more'}</span>
                </div>

                {ouv && (
                  <div style={{ borderTop: '1px solid #F1F4FA', marginTop: '14px', paddingTop: '14px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '14px', marginBottom: '14px', fontSize: '13px', color: '#5A6472' }}>
                      <div>
                        <div><b style={{ color: INK }}>Téléphone :</b> <a href={`tel:${c.client_telephone}`} style={{ color: BLUE }}>{c.client_telephone}</a> · <a href={whatsapp(c.client_telephone)} target="_blank" rel="noopener noreferrer" style={{ color: VERT, fontWeight: 600 }}>WhatsApp</a></div>
                        {c.client_adresse && <div style={{ marginTop: '4px' }}><b style={{ color: INK }}>Adresse :</b> {c.client_adresse}</div>}
                        {c.note && <div style={{ marginTop: '4px' }}><b style={{ color: INK }}>Note :</b> {c.note}</div>}
                      </div>
                      <div>
                        {ls.map((l, i) => (
                          <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '3px 0' }}>
                            <span>{l.quantite} × {l.nom}{l.produit_id === null && <b style={{ color: ROUGE }}> (supprimé)</b>}</span>
                            <span style={{ whiteSpace: 'nowrap' }}>{fmt(l.quantite * l.prix_unitaire)}</span>
                          </div>
                        ))}
                      </div>
                    </div>

                    {c.statut === 'nouvelle' ? (
                      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'flex-end' }}>
                        <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#8A94A6' }}>MODE DE PAIEMENT<br />
                          <select value={mode} onChange={e => setMode(e.target.value)} style={{ ...champ, marginTop: '5px' }}>
                            {MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}
                          </select>
                        </label>
                        <label style={{ fontSize: '11.5px', fontWeight: 600, color: '#8A94A6' }}>ACOMPTE (VIDE = TOUT PAYÉ)<br />
                          <input inputMode="numeric" value={acompte} onChange={e => setAcompte(e.target.value.replace(/[^0-9]/g, ''))} placeholder={fmt(c.total)} style={{ ...champ, marginTop: '5px', width: '150px' }} />
                        </label>
                        <button onClick={() => valider(c)} disabled={occupe} style={{ ...bouton, border: 'none', background: GRAD, color: '#fff' }}>
                          <span className="ms" style={{ fontSize: '18px' }}>check</span>{occupe ? 'Patientez…' : 'Valider (vente)'}
                        </button>
                        <input value={motif} onChange={e => setMotif(e.target.value)} placeholder="Motif du refus (facultatif)" style={{ ...champ, flex: 1, minWidth: '160px' }} />
                        <button onClick={() => refuser(c)} disabled={occupe} style={{ ...bouton, border: `1px solid ${LINE}`, background: '#fff', color: ROUGE }}>
                          <span className="ms" style={{ fontSize: '18px' }}>close</span>Refuser
                        </button>
                        <div style={{ width: '100%', fontSize: '12px', color: MUTE }}>La vente reprend les prix et le stock actuels de Fallik.</div>
                      </div>
                    ) : (
                      <div style={{ fontSize: '13px', color: '#5A6472' }}>
                        {c.statut === 'validee' ? `Validée${c.vente_id ? ` : vente n° ${c.vente_id}` : ''}` : `Refusée${c.motif_refus ? ` : ${c.motif_refus}` : ''}`}
                        {c.traitee_le && ` · le ${new Date(c.traitee_le).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}`}
                      </div>
                    )}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
