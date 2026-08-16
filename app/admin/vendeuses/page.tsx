'use client';
import { Fragment, useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)' };

const MEDALS = [
  { color: '#B8912E', bg: 'rgba(184,145,46,.14)', border: 'rgba(184,145,46,.4)', icon: 'emoji_events', cardBg: 'linear-gradient(180deg,rgba(184,145,46,.09),#fff)' },
  { color: '#8C9099', bg: 'rgba(140,144,153,.14)', border: 'rgba(140,144,153,.38)', icon: 'workspace_premium', cardBg: 'linear-gradient(180deg,rgba(140,144,153,.08),#fff)' },
  { color: '#A5673B', bg: 'rgba(165,103,59,.15)', border: 'rgba(165,103,59,.38)', icon: 'military_tech', cardBg: 'linear-gradient(180deg,rgba(165,103,59,.09),#fff)' },
];

const BADGE_PAID = { fontSize: '12px', fontWeight: 700, color: '#1F9D6B', background: 'rgba(31,157,107,.12)', padding: '4px 10px', borderRadius: '20px' } as const;
const BADGE_PART = { fontSize: '12px', fontWeight: 700, color: '#C8891F', background: 'rgba(200,137,31,.14)', padding: '4px 10px', borderRadius: '20px' } as const;
const th: React.CSSProperties = { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', textAlign: 'left', padding: '13px 24px', background: '#FBFCFE', borderBottom: '1px solid #EEF2F8', whiteSpace: 'nowrap' };

export default function AdminVendeuses() {
  const [vendeuses, setVendeuses] = useState<any[]>([]);
  const [chargement, setChargement] = useState(true);
  const [detailOuvert, setDetailOuvert] = useState<number | null>(null);
  const [ventesDetail, setVentesDetail] = useState<any[]>([]);
  const [chargementDetail, setChargementDetail] = useState(false);

  useEffect(() => {
    chargerVendeuses();
    const canal = supabase.channel('vendeuses').on('postgres_changes', { event: '*', schema: 'public', table: 'ventes' }, () => chargerVendeuses()).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, []);

  const chargerVendeuses = async () => {
    const { data: utilisateurs } = await supabase.from('utilisateurs').select('*').eq('role', 'vendeuse').eq('actif', true);
    const { data: ventes } = await supabase.from('ventes').select('*').eq('annulee', false);
    const venteIds = (ventes || []).map((v: any) => v.id);
    const { data: venteProduits } = venteIds.length > 0 ? await supabase.from('vente_produits').select('vente_id, quantite').in('vente_id', venteIds) : { data: [] };
    const result = (utilisateurs || []).map((u: any) => {
      const vv = (ventes || []).filter((v: any) => v.vendeuse_id === u.id);
      const ids = vv.map((v: any) => v.id);
      return { ...u, totalVentes: vv.reduce((s: number, v: any) => s + v.total, 0), totalEncaisse: vv.reduce((s: number, v: any) => s + v.montant_paye, 0), nbVentes: vv.length, nbProduits: (venteProduits || []).filter((vp: any) => ids.includes(vp.vente_id)).reduce((s: number, vp: any) => s + vp.quantite, 0) };
    }).sort((a: any, b: any) => b.totalVentes - a.totalVentes);
    setVendeuses(result);
    setChargement(false);
  };

  const voirDetail = async (vendeuseId: number) => {
    if (detailOuvert === vendeuseId) { setDetailOuvert(null); setVentesDetail([]); return; }
    setDetailOuvert(vendeuseId); setChargementDetail(true);
    const { data: ventesData } = await supabase.from('ventes').select('*').eq('vendeuse_id', vendeuseId).eq('annulee', false).order('date_vente', { ascending: false });
    if (!ventesData || ventesData.length === 0) { setVentesDetail([]); setChargementDetail(false); return; }
    const clienteIds = [...new Set(ventesData.map((v: any) => v.cliente_id).filter(Boolean))];
    const { data: clientes } = clienteIds.length > 0 ? await supabase.from('clientes').select('id, nom').in('id', clienteIds) : { data: [] };
    const venteIds = ventesData.map((v: any) => v.id);
    const { data: vp } = await supabase.from('vente_produits').select('*').in('vente_id', venteIds);
    const produitIds = [...new Set((vp || []).map((x: any) => x.produit_id).filter(Boolean))];
    const { data: produits } = produitIds.length > 0 ? await supabase.from('produits').select('id, nom').in('id', produitIds) : { data: [] };
    setVentesDetail(ventesData.map((v: any) => ({ ...v, cliente: (clientes || []).find((c: any) => c.id === v.cliente_id) || null, vente_produits: (vp || []).filter((x: any) => x.vente_id === v.id).map((x: any) => ({ ...x, produits: (produits || []).find((p: any) => p.id === x.produit_id) })) })));
    setChargementDetail(false);
  };

  if (chargement) return <div style={{ textAlign: 'center', padding: '60px', color: MUTE }}>Chargement…</div>;

  const td: React.CSSProperties = { padding: '15px 24px', borderBottom: '1px solid #F1F4FA', verticalAlign: 'middle' };

  return (
    <div className="fade-up">
      {/* Podium top 3 */}
      {vendeuses.length > 0 && (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(220px,1fr))', gap: '18px', marginBottom: '20px' }}>
          {vendeuses.slice(0, 3).map((v, i) => {
            const m = MEDALS[i];
            return (
              <div key={v.id} style={{ padding: '24px', borderRadius: '20px', background: m.cardBg, border: `1px solid ${m.border}`, textAlign: 'center', boxShadow: '0 6px 20px rgba(26,36,56,.05)' }}>
                <div style={{ width: '58px', height: '58px', margin: '0 auto 14px', borderRadius: '50%', display: 'flex', alignItems: 'center', justifyContent: 'center', background: m.bg, border: `1.5px solid ${m.border}` }}>
                  <span className="ms" style={{ fontSize: '30px', color: m.color }}>{m.icon}</span>
                </div>
                <div style={{ fontSize: '17px', fontWeight: 700, color: INK }}>{v.nom}</div>
                <div style={{ fontSize: '12.5px', color: MUTE, marginBottom: '14px' }}>{v.nbVentes} ventes · {v.nbProduits} articles</div>
                <div style={{ fontSize: '24px', fontWeight: 800, color: m.color }}>{fmt(v.totalVentes)}</div>
                <div style={{ fontSize: '11px', letterSpacing: '1px', color: MUTE, textTransform: 'uppercase' }}>FCFA réalisés</div>
              </div>
            );
          })}
        </div>
      )}

      {/* Table complète */}
      <div style={{ ...carte, overflow: 'hidden' }}>
        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '640px' }}>
            <thead>
              <tr>
                <th style={{ ...th, width: '70px' }}>Rang</th>
                <th style={th}>Vendeuse</th>
                <th style={{ ...th, textAlign: 'right' }}>Ventes FCFA</th>
                <th style={{ ...th, textAlign: 'center' }}>Transactions</th>
                <th style={{ ...th, textAlign: 'center' }}>Produits</th>
                <th style={{ ...th, width: '60px' }}></th>
              </tr>
            </thead>
            <tbody>
              {vendeuses.map((v, i) => {
                const m = MEDALS[i];
                const rankStyle: React.CSSProperties = m
                  ? { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '10px', fontSize: '14px', fontWeight: 800, color: m.color, background: m.bg, border: `1px solid ${m.border}` }
                  : { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: '30px', height: '30px', borderRadius: '10px', fontSize: '14px', fontWeight: 700, color: SOFT, background: '#EEF1F7' };
                return (
                  <Fragment key={v.id}>
                    <tr>
                      <td style={td}><span style={rankStyle}>{i + 1}</span></td>
                      <td style={{ ...td, fontSize: '14.5px', fontWeight: 600, color: INK }}>{v.nom}</td>
                      <td style={{ ...td, textAlign: 'right', fontSize: '14.5px', fontWeight: 800, color: BLUE }}>{fmt(v.totalVentes)}</td>
                      <td style={{ ...td, textAlign: 'center', fontSize: '14px', color: '#5A6472' }}>{v.nbVentes}</td>
                      <td style={{ ...td, textAlign: 'center', fontSize: '14px', color: '#5A6472' }}>{v.nbProduits}</td>
                      <td style={{ ...td, textAlign: 'right' }}>
                        <button onClick={() => voirDetail(v.id)} aria-label={`Voir le détail de ${v.nom}`} style={{ background: '#EEF3FC', border: 'none', borderRadius: '9px', padding: '7px', cursor: 'pointer', display: 'inline-flex' }}>
                          <span className="ms" style={{ fontSize: '18px', color: BLUE }}>{detailOuvert === v.id ? 'expand_less' : 'expand_more'}</span>
                        </button>
                      </td>
                    </tr>
                    {detailOuvert === v.id && (
                      <tr>
                        <td colSpan={6} style={{ padding: '16px 24px 20px', background: '#FBFCFE', borderBottom: '1px solid #F1F4FA' }}>
                          {chargementDetail ? (
                            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', margin: 0 }}>Chargement…</p>
                          ) : ventesDetail.length === 0 ? (
                            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', margin: 0 }}>Aucune vente.</p>
                          ) : (
                            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                              {ventesDetail.map(vente => (
                                <div key={vente.id} style={{ padding: '14px 18px', borderRadius: '14px', background: '#fff', border: `1px solid ${LINE}` }}>
                                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '8px' }}>
                                    <div>
                                      <div style={{ fontSize: '14px', fontWeight: 600, color: INK }}>{vente.cliente?.nom || 'Inconnue'}</div>
                                      <div style={{ fontSize: '12px', color: MUTE }}>{new Date(vente.date_vente).toLocaleString('fr-FR')}</div>
                                    </div>
                                    <div style={{ textAlign: 'right' }}>
                                      <div style={{ fontSize: '15px', fontWeight: 800, color: INK }}>{fmt(vente.total)} <span style={{ fontSize: '11px', color: BLUE }}>FCFA</span></div>
                                      <span style={vente.statut_paiement === 'paye' ? BADGE_PAID : BADGE_PART}>{vente.statut_paiement === 'paye' ? 'Payé' : `Reste : ${fmt(vente.reste_a_payer)} FCFA`}</span>
                                    </div>
                                  </div>
                                  {vente.vente_produits?.length > 0 && (
                                    <div style={{ borderTop: '1px solid #F1F4FA', paddingTop: '8px', display: 'flex', flexDirection: 'column', gap: '3px' }}>
                                      {vente.vente_produits.map((vp: any, j: number) => (
                                        <div key={j} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12.5px' }}>
                                          <span style={{ color: '#5A6472' }}>{vp.produits?.nom || 'Inconnu'} <span style={{ color: BLUE, fontWeight: 700 }}>x{vp.quantite}</span></span>
                                          <span style={{ color: INK, fontWeight: 600 }}>{fmt(vp.prix_unitaire * vp.quantite)} FCFA</span>
                                        </div>
                                      ))}
                                    </div>
                                  )}
                                </div>
                              ))}
                            </div>
                          )}
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
