'use client';
import { Fragment, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toutLire, lireParIds } from '@/lib/requetes';
import { useBoutique } from '@/lib/boutique';
import RecuModal, { recuDepuisVente, enteteRecu } from '../../components/RecuModal';
import { type RecuData } from '../../components/Recu';
import { signalerAuPatron } from '../../components/ValidationGerant';

// Historique des ventes (repris de Fallora) : recherche, filtres, totaux de la
// selection, detail (articles, paiements, motif d'annulation), renvoi du recu,
// encaissement d'un acompte et annulation avec motif (journalisees).

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const MODES: [string, string][] = [['cash', 'Espèces'], ['mobile_money', 'Mobile Money'], ['orange_money', 'Orange Money'], ['carte', 'Carte'], ['autre', 'Autre']];
const MODE_LABELS = Object.fromEntries(MODES);
const PAR_PAGE = 50;
const champ: React.CSSProperties = { height: '42px', padding: '0 12px', borderRadius: '12px', background: '#fff', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '13.5px' };
const th: React.CSSProperties = { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', textAlign: 'left', padding: '13px 18px', background: '#FBFCFE', borderBottom: '1px solid #EEF2F8', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '13px 18px', borderBottom: '1px solid #F1F4FA', verticalAlign: 'middle' };
const badge = (c: string, bg: string): React.CSSProperties => ({ fontSize: '12px', fontWeight: 700, color: c, background: bg, padding: '5px 12px', borderRadius: '20px', whiteSpace: 'nowrap' });

type Ligne = { nom: string; quantite: number; prix: number };
type Paiement = { id: number; montant: number; mode: string; created_at: string };
type Vente = {
  id: number; date_vente: string; total: number; montant_paye: number; reste_a_payer: number; statut_paiement: string;
  annulee: boolean; annulee_le: string | null; motif_annulation: string | null; vendeuse_id: number | null;
  clienteNom: string | null; clienteTelephone: string | null; vendeuseNom: string | null; annuleeParNom: string | null;
  lignes: Ligne[]; paiements: Paiement[];
};

function debutPeriode(p: string): Date | null {
  const n = new Date();
  if (p === 'jour') return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  if (p === '7j') return new Date(n.getFullYear(), n.getMonth(), n.getDate() - 6);
  if (p === 'mois') return new Date(n.getFullYear(), n.getMonth(), 1);
  if (p === 'mois_prec') return new Date(n.getFullYear(), n.getMonth() - 1, 1);
  return null;
}
const finPeriode = (p: string) => { const n = new Date(); return p === 'mois_prec' ? new Date(n.getFullYear(), n.getMonth(), 1) : null; };

async function lireVentes(): Promise<Vente[]> {
  const ventes = await toutLire<any>(() => supabase.from('ventes').select('*').order('date_vente', { ascending: false }).order('id', { ascending: false }));
  const ids = ventes.map(v => v.id);
  const [clientes, utilisateurs, vp, paiements] = await Promise.all([
    lireParIds<any>('clientes', 'id, nom, telephone', 'id', ventes.map(v => v.cliente_id)),
    lireParIds<any>('utilisateurs', 'id, nom', 'id', [...ventes.map(v => v.vendeuse_id), ...ventes.map(v => v.annulee_par)]),
    lireParIds<any>('vente_produits', 'id, vente_id, produit_id, quantite, prix_unitaire', 'vente_id', ids),
    lireParIds<any>('paiements', 'id, vente_id, montant, mode, created_at', 'vente_id', ids),
  ]);
  const produits = await lireParIds<any>('produits', 'id, nom', 'id', vp.map(x => x.produit_id));
  const cMap = new Map(clientes.map(c => [c.id, c])), uMap = new Map(utilisateurs.map(u => [u.id, u.nom]));
  const pMap = new Map(produits.map(p => [p.id, p.nom]));
  const lignes = new Map<number, Ligne[]>(), pays = new Map<number, Paiement[]>();
  for (const x of vp) lignes.set(x.vente_id, [...(lignes.get(x.vente_id) || []), { nom: pMap.get(x.produit_id) || 'Produit supprimé', quantite: x.quantite, prix: Number(x.prix_unitaire) || 0 }]);
  for (const p of paiements) pays.set(p.vente_id, [...(pays.get(p.vente_id) || []), { id: p.id, montant: Number(p.montant) || 0, mode: p.mode, created_at: p.created_at }]);
  return ventes.map(v => ({
    ...v,
    clienteNom: cMap.get(v.cliente_id)?.nom || v.nom_client || null,
    clienteTelephone: cMap.get(v.cliente_id)?.telephone || null,
    vendeuseNom: uMap.get(v.vendeuse_id) || null,
    annuleeParNom: uMap.get(v.annulee_par) || null,
    lignes: lignes.get(v.id) || [],
    paiements: (pays.get(v.id) || []).sort((a, b) => a.created_at.localeCompare(b.created_at)),
  }));
}

export default function AdminVentes() {
  const boutique = useBoutique();
  const entete = enteteRecu(boutique);
  const [ventes, setVentes] = useState<Vente[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreurChargement, setErreurChargement] = useState('');
  const [recherche, setRecherche] = useState('');
  const [periode, setPeriode] = useState('tout');
  const [vendeuse, setVendeuse] = useState('toutes');
  const [statut, setStatut] = useState('actives');
  const [limite, setLimite] = useState(PAR_PAGE);
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [recu, setRecu] = useState<RecuData | null>(null);
  // Action en cours sur la vente ouverte : annulation ou acompte.
  const [action, setAction] = useState<{ type: 'annuler' | 'acompte'; id: number } | null>(null);
  const [motif, setMotif] = useState('');
  const [montant, setMontant] = useState('');
  const [mode, setMode] = useState('cash');
  const [erreurAction, setErreurAction] = useState('');
  const [occupe, setOccupe] = useState(false);

  const charger = async () => {
    try { setVentes(await lireVentes()); setErreurChargement(''); }
    catch (e: any) { setErreurChargement(`Impossible de charger les ventes : ${e?.message || 'erreur réseau'}`); }
    setChargement(false);
  };
  useEffect(() => {
    let annule = false;
    lireVentes()
      .then(v => { if (!annule) { setVentes(v); setChargement(false); } })
      .catch((e: any) => { if (!annule) { setErreurChargement(`Impossible de charger les ventes : ${e?.message || 'erreur réseau'}`); setChargement(false); } });
    return () => { annule = true; };
  }, []);

  const vendeuses = useMemo(() => {
    const m = new Map<number, string>();
    for (const v of ventes) if (v.vendeuse_id && v.vendeuseNom) m.set(v.vendeuse_id, v.vendeuseNom);
    return [...m.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [ventes]);

  const filtrees = useMemo(() => {
    const q = recherche.trim().toLowerCase().replace(/^(n°|#)\s*/, '');
    const debut = debutPeriode(periode), fin = finPeriode(periode);
    return ventes.filter(v => {
      if (statut === 'actives' && v.annulee) return false;
      if (statut === 'annulees' && !v.annulee) return false;
      if ((statut === 'paye' || statut === 'partiel') && (v.annulee || v.statut_paiement !== statut)) return false;
      if (vendeuse !== 'toutes' && String(v.vendeuse_id) !== vendeuse) return false;
      const d = new Date(v.date_vente);
      if (debut && d < debut) return false;
      if (fin && d >= fin) return false;
      if (q) {
        const texte = [v.clienteNom, v.clienteTelephone, v.vendeuseNom, String(v.id), ...v.lignes.map(l => l.nom)].filter(Boolean).join(' ').toLowerCase();
        if (!texte.includes(q)) return false;
      }
      return true;
    });
  }, [ventes, recherche, periode, vendeuse, statut]);

  const totaux = useMemo(() => {
    const actives = filtrees.filter(v => !v.annulee);
    return {
      nb: filtrees.length,
      ca: actives.reduce((s, v) => s + (Number(v.total) || 0), 0),
      encaisse: actives.reduce((s, v) => s + (Number(v.montant_paye) || 0), 0),
      reste: actives.reduce((s, v) => s + (Number(v.reste_a_payer) || 0), 0),
    };
  }, [filtrees]);

  const ouvrirAction = (type: 'annuler' | 'acompte', v: Vente) => {
    setAction({ type, id: v.id }); setMotif(''); setMode('cash'); setErreurAction('');
    setMontant(type === 'acompte' ? String(Math.round(Number(v.reste_a_payer))) : '');
  };

  const confirmer = async () => {
    if (!action) return;
    setErreurAction('');
    let error;
    if (action.type === 'annuler') {
      if (!motif.trim()) { setErreurAction("Indiquez le motif de l'annulation."); return; }
      setOccupe(true);
      ({ error } = await supabase.rpc('annuler_vente', { p_vente_id: action.id, p_motif: motif.trim() }));
    } else {
      const m = Number(montant);
      if (!m || m <= 0) { setErreurAction('Entrez un montant.'); return; }
      setOccupe(true);
      ({ error } = await supabase.rpc('enregistrer_paiement', { p_vente_id: action.id, p_montant: m, p_mode: mode }));
    }
    setOccupe(false);
    if (error) { setErreurAction(error.message || 'Échec.'); return; }
    setAction(null);
    signalerAuPatron();
    await charger();
  };

  if (chargement) return <div style={{ textAlign: 'center', padding: '60px', color: MUTE }}>Chargement…</div>;

  const visibles = filtrees.slice(0, limite);
  const filtreActif = recherche || periode !== 'tout' || vendeuse !== 'toutes' || statut !== 'actives';
  const dev = entete.devise;

  return (
    <div className="fade-up">
      {recu && <RecuModal data={recu} onClose={() => setRecu(null)} />}
      {erreurChargement && <div role="alert" style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '14px', background: 'rgba(210,68,68,.10)', color: '#D24444', fontSize: '13.5px' }}>{erreurChargement}</div>}

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: '10px', marginBottom: '16px' }}>
        <div style={{ position: 'relative', flex: '1 1 240px' }}>
          <span className="ms" style={{ position: 'absolute', left: '12px', top: '11px', fontSize: '20px', color: MUTE }}>search</span>
          <input value={recherche} onChange={e => { setRecherche(e.target.value); setLimite(PAR_PAGE); }} placeholder="Client, téléphone, produit, n° de vente…" aria-label="Rechercher" style={{ ...champ, width: '100%', paddingLeft: '40px' }} />
        </div>
        <select value={periode} onChange={e => { setPeriode(e.target.value); setLimite(PAR_PAGE); }} style={champ} aria-label="Période">
          <option value="tout">Toutes les dates</option>
          <option value="jour">Aujourd&apos;hui</option>
          <option value="7j">7 derniers jours</option>
          <option value="mois">Ce mois-ci</option>
          <option value="mois_prec">Mois dernier</option>
        </select>
        <select value={vendeuse} onChange={e => { setVendeuse(e.target.value); setLimite(PAR_PAGE); }} style={champ} aria-label="Vendeuse">
          <option value="toutes">Toutes les vendeuses</option>
          {vendeuses.map(([id, nom]) => <option key={id} value={String(id)}>{nom}</option>)}
        </select>
        <select value={statut} onChange={e => { setStatut(e.target.value); setLimite(PAR_PAGE); }} style={champ} aria-label="Statut">
          <option value="actives">Toutes (hors annulées)</option>
          <option value="paye">Payées</option>
          <option value="partiel">Reste à payer</option>
          <option value="annulees">Annulées</option>
        </select>
        {filtreActif && <button onClick={() => { setRecherche(''); setPeriode('tout'); setVendeuse('toutes'); setStatut('actives'); setLimite(PAR_PAGE); }} style={{ ...champ, cursor: 'pointer', color: SOFT, fontWeight: 600 }}>Réinitialiser</button>}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '12px', marginBottom: '16px' }}>
        {[
          { label: 'Ventes', valeur: totaux.nb.toLocaleString('fr-FR'), unite: '' },
          { label: "Chiffre d'affaires", valeur: fmt(totaux.ca), unite: dev },
          { label: 'Encaissé', valeur: fmt(totaux.encaisse), unite: dev },
          { label: 'Reste à encaisser', valeur: fmt(totaux.reste), unite: dev, alerte: totaux.reste > 0 },
        ].map(t => (
          <div key={t.label} style={{ padding: '14px 16px', borderRadius: '16px', background: '#fff', border: `1px solid ${LINE}` }}>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.5px', textTransform: 'uppercase', color: SOFT }}>{t.label}</div>
            <div style={{ marginTop: '4px', fontSize: '20px', fontWeight: 800, color: t.alerte ? '#C8891F' : INK }}>{t.valeur} {t.unite && <span style={{ fontSize: '11px', fontWeight: 700, color: BLUE }}>{t.unite}</span>}</div>
          </div>
        ))}
      </div>

      <div style={{ background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, overflow: 'hidden' }}>
        {filtrees.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: MUTE }}>
            <span className="ms" style={{ fontSize: '46px', display: 'block', marginBottom: '10px', color: '#C6D2E8' }}>receipt_long</span>
            {ventes.length === 0 ? 'Aucune vente enregistrée.' : 'Aucune vente ne correspond à ces filtres.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
              <thead><tr>
                <th style={th}>Vente</th><th style={th}>Vendeuse</th><th style={{ ...th, textAlign: 'right' }}>Montant</th>
                <th style={{ ...th, textAlign: 'center' }}>Statut</th><th style={{ ...th, textAlign: 'right' }}>Date</th><th style={{ ...th, width: '56px' }} />
              </tr></thead>
              <tbody>
                {visibles.map(v => {
                  const ouvert = ouverte === v.id;
                  const b = v.annulee ? badge(SOFT, '#F1F4FA') : v.statut_paiement === 'paye' ? badge('#1F9D6B', 'rgba(31,157,107,.12)') : badge('#C8891F', 'rgba(200,137,31,.14)');
                  return (
                    <Fragment key={v.id}>
                      <tr style={{ opacity: v.annulee ? 0.65 : 1 }}>
                        <td style={td}>
                          <div style={{ fontSize: '14.5px', fontWeight: 600, color: INK, textDecoration: v.annulee ? 'line-through' : undefined }}>{v.clienteNom || 'Client comptoir'}</div>
                          <div style={{ fontSize: '12px', color: MUTE }}>N° {v.id}{v.clienteTelephone ? ` · ${v.clienteTelephone}` : ''}</div>
                        </td>
                        <td style={{ ...td, fontSize: '14px', color: '#5A6472' }}>{v.vendeuseNom || '—'}</td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                          <span style={{ fontSize: '15px', fontWeight: 800, color: INK }}>{fmt(v.total)}</span> <span style={{ fontSize: '11.5px', fontWeight: 700, color: BLUE }}>{dev}</span>
                          {!v.annulee && v.reste_a_payer > 0 && <div style={{ fontSize: '11.5px', color: '#C8891F', fontWeight: 600 }}>Reste : {fmt(v.reste_a_payer)}</div>}
                        </td>
                        <td style={{ ...td, textAlign: 'center' }}><span style={b}>{v.annulee ? 'Annulée' : v.statut_paiement === 'paye' ? 'Payé' : 'Partiel'}</span></td>
                        <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontSize: '13.5px', color: '#5A6472' }}>{new Date(v.date_vente).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })}</td>
                        <td style={{ ...td, textAlign: 'right' }}>
                          <button onClick={() => { setOuverte(ouvert ? null : v.id); setAction(null); }} aria-label={`Détail de la vente ${v.id}`} aria-expanded={ouvert} style={{ background: '#EEF3FC', border: 'none', borderRadius: '9px', padding: '7px', cursor: 'pointer', display: 'inline-flex' }}>
                            <span className="ms" style={{ fontSize: '18px', color: BLUE }}>{ouvert ? 'expand_less' : 'expand_more'}</span>
                          </button>
                        </td>
                      </tr>
                      {ouvert && (
                        <tr><td colSpan={6} style={{ padding: '14px 22px 18px', background: '#FBFCFE', borderBottom: '1px solid #F1F4FA' }}>
                          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(260px,1fr))', gap: '18px' }}>
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', marginBottom: '6px' }}>Articles</div>
                              {v.lignes.map((l, i) => (
                                <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0' }}>
                                  <span style={{ color: INK }}>{l.quantite} × {l.nom}</span><span style={{ color: '#5A6472' }}>{fmt(l.quantite * l.prix)} {dev}</span>
                                </div>
                              ))}
                            </div>
                            <div>
                              <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', marginBottom: '6px' }}>Paiements</div>
                              {v.paiements.length === 0 && <div style={{ fontSize: '13px', color: MUTE }}>Aucun</div>}
                              {v.paiements.map(p => (
                                <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '13px', padding: '4px 0' }}>
                                  <span style={{ color: '#5A6472' }}>{new Date(p.created_at).toLocaleString('fr-FR', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {MODE_LABELS[p.mode] || p.mode}</span>
                                  <span style={{ color: INK, fontWeight: 600 }}>{fmt(p.montant)} {dev}</span>
                                </div>
                              ))}
                              {v.annulee && (
                                <div style={{ marginTop: '10px', padding: '10px 12px', borderRadius: '10px', background: 'rgba(210,68,68,.08)', fontSize: '13px', color: '#D24444' }}>
                                  Annulée{v.annulee_le ? ` le ${new Date(v.annulee_le).toLocaleString('fr-FR')}` : ''}{v.annuleeParNom ? ` par ${v.annuleeParNom}` : ''} — {v.motif_annulation}
                                </div>
                              )}
                            </div>
                          </div>

                          {!v.annulee && (
                            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', marginTop: '14px' }}>
                              <button onClick={() => setRecu(recuDepuisVente({ ...v, items: v.lignes, mode: v.paiements[0]?.mode }, entete))} style={{ height: '38px', padding: '0 14px', borderRadius: '10px', border: 'none', background: '#EEF3FC', color: BLUE, fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><span className="ms" style={{ fontSize: '17px' }}>receipt_long</span>Reçu</button>
                              {v.reste_a_payer > 0 && <button onClick={() => ouvrirAction('acompte', v)} style={{ height: '38px', padding: '0 14px', borderRadius: '10px', border: 'none', background: 'rgba(31,157,107,.12)', color: '#1F9D6B', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><span className="ms" style={{ fontSize: '17px' }}>payments</span>Encaisser un paiement</button>}
                              <button onClick={() => ouvrirAction('annuler', v)} style={{ height: '38px', padding: '0 14px', borderRadius: '10px', border: 'none', background: 'rgba(210,68,68,.08)', color: '#D24444', fontSize: '13px', fontWeight: 600, cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px' }}><span className="ms" style={{ fontSize: '17px' }}>block</span>Annuler la vente</button>
                            </div>
                          )}

                          {action?.id === v.id && (
                            <div style={{ marginTop: '12px', padding: '14px', borderRadius: '12px', background: '#fff', border: `1px solid ${LINE}`, maxWidth: '520px' }}>
                              {action.type === 'annuler' ? (
                                <>
                                  <div style={{ fontSize: '13.5px', color: INK, marginBottom: '8px' }}>Le stock vendu sera remis en rayon. La vente reste visible, marquée « annulée », et l&apos;annulation est notée au journal.</div>
                                  <input autoFocus value={motif} onChange={e => setMotif(e.target.value)} placeholder="Motif (obligatoire), ex. erreur de saisie" aria-label="Motif de l'annulation" style={{ ...champ, width: '100%', marginBottom: '10px' }} />
                                </>
                              ) : (
                                <>
                                  <div style={{ fontSize: '13.5px', color: INK, marginBottom: '8px' }}>Reste dû : <b>{fmt(v.reste_a_payer)} {dev}</b></div>
                                  <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '10px' }}>
                                    <input type="number" inputMode="numeric" min="1" value={montant} onChange={e => setMontant(e.target.value)} aria-label="Montant encaissé" style={{ ...champ, flex: '1 1 140px' }} />
                                    <select value={mode} onChange={e => setMode(e.target.value)} aria-label="Moyen de paiement" style={champ}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
                                  </div>
                                </>
                              )}
                              {erreurAction && <div role="alert" style={{ color: '#D24444', fontSize: '13px', marginBottom: '8px' }}>{erreurAction}</div>}
                              <div style={{ display: 'flex', gap: '8px' }}>
                                <button disabled={occupe} onClick={confirmer} style={{ height: '40px', padding: '0 16px', borderRadius: '11px', border: 'none', background: action.type === 'annuler' ? '#D24444' : GRAD, color: '#fff', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer', opacity: occupe ? 0.7 : 1 }}>
                                  {occupe ? '…' : action.type === 'annuler' ? "Confirmer l'annulation" : 'Encaisser'}
                                </button>
                                <button onClick={() => setAction(null)} style={{ height: '40px', padding: '0 16px', borderRadius: '11px', border: `1px solid ${LINE}`, background: '#fff', color: SOFT, fontSize: '13.5px', fontWeight: 600, cursor: 'pointer' }}>Retour</button>
                              </div>
                            </div>
                          )}
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
      {filtrees.length > limite && (
        <button onClick={() => setLimite(limite + PAR_PAGE)} style={{ width: '100%', marginTop: '12px', height: '42px', borderRadius: '12px', cursor: 'pointer', background: '#fff', border: `1px solid ${LINE}`, color: SOFT, fontSize: '13.5px', fontWeight: 600 }}>
          Afficher plus ({filtrees.length - limite})
        </button>
      )}
    </div>
  );
}
