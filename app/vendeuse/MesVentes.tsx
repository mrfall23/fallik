'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toutLire, lireParIds } from '@/lib/requetes';
import { type VenteEnAttente } from '@/lib/fileHorsLigne';
import { recuDepuisVente, type EnteteRecu } from '../components/RecuModal';
import { type RecuData } from '../components/Recu';

// Historique des ventes de la vendeuse connectee (repris de Fallora). La RLS
// ne renvoie que SES ventes, leurs articles et leurs paiements.

const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const MODE_LABELS: Record<string, string> = { cash: 'Espèces', mobile_money: 'Mobile Money', orange_money: 'Orange Money', carte: 'Carte', autre: 'Autre' };
const PAR_PAGE = 30;

type Ligne = { nom: string; quantite: number; prix: number };
type Vente = {
  id: number; date_vente: string; total: number; montant_paye: number; reste_a_payer: number; statut_paiement: string;
  annulee: boolean; motif_annulation: string | null; clienteNom: string | null; clienteTelephone: string | null;
  lignes: Ligne[]; paiements: { id: number; montant: number; mode: string; created_at: string }[];
};

function debutPeriode(p: string): Date | null {
  const n = new Date();
  if (p === 'jour') return new Date(n.getFullYear(), n.getMonth(), n.getDate());
  if (p === '7j') return new Date(n.getFullYear(), n.getMonth(), n.getDate() - 6);
  if (p === 'mois') return new Date(n.getFullYear(), n.getMonth(), 1);
  return null;
}

export default function MesVentes({ isMobile, vendeuseNom, enAttente, rafraichir, entete, onRecu }: {
  isMobile: boolean; vendeuseNom: string; enAttente: VenteEnAttente[]; rafraichir: number;
  entete: EnteteRecu; onRecu: (r: RecuData) => void;
}) {
  const [periode, setPeriode] = useState('jour');
  const [ventes, setVentes] = useState<Vente[]>([]);
  const [chargement, setChargement] = useState(true);
  const [erreur, setErreur] = useState('');
  const [ouverte, setOuverte] = useState<number | null>(null);
  const [limite, setLimite] = useState(PAR_PAGE);

  useEffect(() => {
    let annule = false;
    (async () => {
      try {
        const debut = debutPeriode(periode);
        const ventesData = await toutLire<any>(() => {
          let q = supabase.from('ventes').select('id, date_vente, total, montant_paye, reste_a_payer, statut_paiement, annulee, motif_annulation, cliente_id, nom_client');
          if (debut) q = q.gte('date_vente', debut.toISOString());
          return q.order('date_vente', { ascending: false }).order('id', { ascending: false });
        });
        const ids = ventesData.map(v => v.id);
        const [clientes, vp, paiements] = await Promise.all([
          lireParIds<any>('clientes', 'id, nom, telephone', 'id', ventesData.map(v => v.cliente_id)),
          lireParIds<any>('vente_produits', 'id, vente_id, produit_id, quantite, prix_unitaire', 'vente_id', ids),
          lireParIds<any>('paiements', 'id, vente_id, montant, mode, created_at', 'vente_id', ids),
        ]);
        const produits = await lireParIds<any>('produits', 'id, nom', 'id', vp.map(x => x.produit_id));
        if (annule) return;
        const cMap = new Map(clientes.map(c => [c.id, c]));
        const pMap = new Map(produits.map(p => [p.id, p.nom]));
        setVentes(ventesData.map(v => ({
          ...v,
          clienteNom: cMap.get(v.cliente_id)?.nom || v.nom_client || null,
          clienteTelephone: cMap.get(v.cliente_id)?.telephone || null,
          lignes: vp.filter(x => x.vente_id === v.id).map(x => ({ nom: pMap.get(x.produit_id) || 'Produit', quantite: x.quantite, prix: Number(x.prix_unitaire) || 0 })),
          paiements: paiements.filter(p => p.vente_id === v.id).map(p => ({ id: p.id, montant: Number(p.montant) || 0, mode: p.mode, created_at: p.created_at }))
            .sort((a, b) => a.created_at.localeCompare(b.created_at)),
        })));
        setErreur('');
      } catch (e: any) {
        if (!annule) setErreur(`Impossible de charger vos ventes : ${e?.message || 'vérifiez votre connexion'}`);
      }
      if (!annule) setChargement(false);
    })();
    return () => { annule = true; };
  }, [periode, rafraichir]);

  const actives = ventes.filter(v => !v.annulee);
  const ca = actives.reduce((s, v) => s + (Number(v.total) || 0), 0);
  const encaisse = actives.reduce((s, v) => s + (Number(v.montant_paye) || 0), 0);
  const reste = actives.reduce((s, v) => s + (Number(v.reste_a_payer) || 0), 0);
  const avecHeure = periode === 'jour';
  const dev = entete.devise;

  return (
    <div style={{ padding: isMobile ? '18px 16px' : '24px 32px', maxWidth: '900px', margin: '0 auto' }}>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
        {[['jour', "Aujourd'hui"], ['7j', '7 jours'], ['mois', 'Ce mois'], ['tout', 'Tout']].map(([val, label]) => (
          <button key={val} onClick={() => { setChargement(true); setPeriode(val); setLimite(PAR_PAGE); setOuverte(null); }} style={{ height: '38px', padding: '0 16px', borderRadius: '20px', cursor: 'pointer', fontSize: '13.5px', fontWeight: 600, border: periode === val ? 'none' : `1px solid ${LINE}`, background: periode === val ? BLUE : '#fff', color: periode === val ? '#fff' : SOFT }}>{label}</button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(130px,1fr))', gap: '10px', marginBottom: '18px' }}>
        {[
          { label: 'Ventes', valeur: actives.length.toLocaleString('fr-FR'), unite: '' },
          { label: 'Vendu', valeur: fmt(ca), unite: dev },
          { label: 'Encaissé', valeur: fmt(encaisse), unite: dev },
          { label: 'Reste à encaisser', valeur: fmt(reste), unite: dev, alerte: reste > 0 },
        ].map(t => (
          <div key={t.label} style={{ padding: '12px 14px', borderRadius: '14px', background: '#fff', border: `1px solid ${LINE}` }}>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.4px', textTransform: 'uppercase', color: MUTE }}>{t.label}</div>
            <div style={{ marginTop: '3px', fontSize: '18px', fontWeight: 800, color: t.alerte ? '#C8891F' : INK }}>
              {t.valeur} {t.unite && <span style={{ fontSize: '11px', fontWeight: 700, color: BLUE }}>{t.unite}</span>}
            </div>
          </div>
        ))}
      </div>

      {enAttente.length > 0 && (
        <div style={{ marginBottom: '16px', padding: '12px 16px', borderRadius: '14px', background: 'rgba(200,137,31,.12)', border: '1px solid rgba(200,137,31,.3)' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: INK, marginBottom: '6px' }}>En attente d&apos;envoi (hors ligne)</div>
          {enAttente.map(a => (
            <div key={a.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '13px', padding: '4px 0', color: SOFT }}>
              <span>{a.apercu.cliente} · {new Date(a.apercu.date).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}</span>
              <span style={{ fontWeight: 600, color: INK }}>{fmt(a.apercu.total)} {dev}</span>
            </div>
          ))}
          <div style={{ fontSize: '11.5px', color: SOFT, marginTop: '4px' }}>Elles apparaîtront ci-dessous (avec leur reçu) une fois envoyées.</div>
        </div>
      )}

      {erreur && <div role="alert" style={{ marginBottom: '14px', padding: '12px 16px', borderRadius: '12px', background: 'rgba(210,68,68,.10)', border: '1px solid rgba(210,68,68,.25)', color: '#D24444', fontSize: '13.5px' }}>{erreur}</div>}

      {chargement ? (
        <div style={{ textAlign: 'center', padding: '50px', color: MUTE }}>Chargement…</div>
      ) : ventes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '50px', color: MUTE }}>
          <span className="ms" style={{ fontSize: '44px', display: 'block', marginBottom: '10px', color: '#C6D2E8' }}>receipt_long</span>
          Aucune vente sur cette période.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
          {ventes.slice(0, limite).map(v => {
            const d = new Date(v.date_vente);
            const ouvert = ouverte === v.id;
            const nb = v.lignes.reduce((s, l) => s + l.quantite, 0);
            return (
              <div key={v.id} style={{ borderRadius: '16px', background: '#fff', border: `1px solid ${LINE}`, opacity: v.annulee ? 0.6 : 1, overflow: 'hidden' }}>
                <button onClick={() => setOuverte(ouvert ? null : v.id)} aria-expanded={ouvert} style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', cursor: 'pointer', background: 'none', border: 'none', textAlign: 'left' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', textDecoration: v.annulee ? 'line-through' : undefined }}>{v.clienteNom || 'Client'}</div>
                    <div style={{ fontSize: '12px', color: MUTE }}>
                      N° {v.id} · {avecHeure ? d.toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' }) : d.toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} · {nb} article{nb > 1 ? 's' : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '15px', fontWeight: 700, color: INK }}>{fmt(v.total)} <span style={{ fontSize: '11px', color: BLUE }}>{dev}</span></div>
                    <div style={{ fontSize: '11.5px', fontWeight: 700, color: v.annulee ? MUTE : v.statut_paiement === 'paye' ? '#1F9D6B' : '#C8891F' }}>
                      {v.annulee ? 'Annulée' : v.statut_paiement === 'paye' ? 'Payé' : `Reste ${fmt(v.reste_a_payer)}`}
                    </div>
                  </div>
                  <span className="ms" style={{ fontSize: '20px', color: MUTE }}>{ouvert ? 'expand_less' : 'expand_more'}</span>
                </button>
                {ouvert && (
                  <div style={{ padding: '0 16px 14px', borderTop: '1px solid #F1F4FA' }}>
                    {v.lignes.map((l, i) => (
                      <div key={i} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '13.5px', padding: '7px 0', borderBottom: `1px dashed ${LINE}` }}>
                        <span style={{ color: INK }}>{l.quantite} × {l.nom}</span>
                        <span style={{ color: SOFT, whiteSpace: 'nowrap' }}>{fmt(l.quantite * l.prix)} {dev}</span>
                      </div>
                    ))}
                    {v.paiements.map(p => (
                      <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', fontSize: '12.5px', paddingTop: '6px', color: SOFT }}>
                        <span>Payé le {new Date(p.created_at).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short' })} · {MODE_LABELS[p.mode] || p.mode}</span>
                        <span>{fmt(p.montant)} {dev}</span>
                      </div>
                    ))}
                    {v.annulee && v.motif_annulation && <div style={{ fontSize: '12.5px', color: '#D24444', paddingTop: '8px' }}>Annulée : {v.motif_annulation}</div>}
                    {!v.annulee && (
                      <button onClick={() => onRecu(recuDepuisVente({ ...v, vendeuseNom, items: v.lignes, mode: v.paiements[0]?.mode }, entete))} style={{ marginTop: '12px', width: '100%', height: '44px', borderRadius: '12px', cursor: 'pointer', background: '#EEF3FC', border: '1px solid rgba(37,99,235,.25)', color: BLUE, fontSize: '14px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}>
                        <span className="ms" style={{ fontSize: '19px' }}>receipt_long</span>Renvoyer le reçu
                      </button>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {ventes.length > limite && (
            <button onClick={() => setLimite(limite + PAR_PAGE)} style={{ height: '42px', borderRadius: '12px', cursor: 'pointer', background: '#fff', border: `1px solid ${LINE}`, color: SOFT, fontSize: '13.5px', fontWeight: 600 }}>
              Afficher plus ({ventes.length - limite})
            </button>
          )}
        </div>
      )}
    </div>
  );
}
