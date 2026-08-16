'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useIsMobile } from '../../components/useMediaQuery';

type Cliente = { id: number; nom: string; telephone: string | null; created_at: string; nbVentes: number; totalDepense: number; resteAPayer: number; derniereVisite: string | null };

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)' };
const BADGE_PAID = { fontSize: '12px', fontWeight: 700, color: '#1F9D6B', background: 'rgba(31,157,107,.12)', padding: '4px 10px', borderRadius: '20px' } as const;
const BADGE_PART = { fontSize: '12px', fontWeight: 700, color: '#C8891F', background: 'rgba(200,137,31,.14)', padding: '4px 10px', borderRadius: '20px' } as const;

export default function AdminClients() {
  const [clientes, setClientes] = useState<Cliente[]>([]);
  const [recherche, setRecherche] = useState('');
  const [chargement, setChargement] = useState(true);
  const [clienteSelectee, setClienteSelectee] = useState<Cliente | null>(null);
  const [ventesCliente, setVentesCliente] = useState<any[]>([]);
  const [chargementDetail, setChargementDetail] = useState(false);
  const isMobile = useIsMobile();

  useEffect(() => { chargerClientes(); }, []);

  const chargerClientes = async () => {
    const { data: clientesData } = await supabase.from('clientes').select('*').order('nom');
    if (!clientesData || clientesData.length === 0) { setClientes([]); setChargement(false); return; }
    const clienteIds = clientesData.map((c: any) => c.id);
    const { data: ventes } = await supabase.from('ventes').select('id, cliente_id, total, reste_a_payer, date_vente').eq('annulee', false).in('cliente_id', clienteIds);
    setClientes(clientesData.map((c: any) => {
      const vv = (ventes || []).filter((v: any) => v.cliente_id === c.id);
      const dates = vv.map((v: any) => v.date_vente).sort().reverse();
      return { ...c, nbVentes: vv.length, totalDepense: vv.reduce((s: number, v: any) => s + v.total, 0), resteAPayer: vv.reduce((s: number, v: any) => s + v.reste_a_payer, 0), derniereVisite: dates[0] || null };
    }));
    setChargement(false);
  };

  const voirDetail = async (c: Cliente) => {
    if (clienteSelectee?.id === c.id) { setClienteSelectee(null); setVentesCliente([]); return; }
    setClienteSelectee(c); setChargementDetail(true);
    const { data: ventesData } = await supabase.from('ventes').select('*').eq('cliente_id', c.id).eq('annulee', false).order('date_vente', { ascending: false });
    if (!ventesData || ventesData.length === 0) { setVentesCliente([]); setChargementDetail(false); return; }
    const venteIds = ventesData.map((v: any) => v.id);
    const { data: vp } = await supabase.from('vente_produits').select('*').in('vente_id', venteIds);
    const produitIds = [...new Set((vp || []).map((x: any) => x.produit_id))];
    const { data: produits } = produitIds.length > 0 ? await supabase.from('produits').select('id, nom').in('id', produitIds) : { data: [] };
    const userIds = [...new Set(ventesData.map((v: any) => v.vendeuse_id))];
    const { data: utilisateurs } = userIds.length > 0 ? await supabase.from('utilisateurs').select('id, nom').in('id', userIds) : { data: [] };
    setVentesCliente(ventesData.map((v: any) => ({ ...v, utilisateurs: (utilisateurs || []).find((u: any) => u.id === v.vendeuse_id) || null, vente_produits: (vp || []).filter((x: any) => x.vente_id === v.id).map((x: any) => ({ ...x, produits: (produits || []).find((p: any) => p.id === x.produit_id) || null })) })));
    setChargementDetail(false);
  };

  const filtrees = clientes.filter(c => c.nom.toLowerCase().includes(recherche.toLowerCase()) || (c.telephone && c.telephone.includes(recherche)));
  const totalCA = clientes.reduce((s, c) => s + c.totalDepense, 0);
  const totalAttente = clientes.reduce((s, c) => s + c.resteAPayer, 0);

  const miniStats = [
    { icon: 'groups', label: 'Clientes', value: clientes.length.toString(), col: BLUE },
    { icon: 'payments', label: 'CA total', value: `${fmt(totalCA)} FCFA`, col: '#1F9D6B' },
    { icon: 'pending_actions', label: 'En attente', value: `${fmt(totalAttente)} FCFA`, col: totalAttente > 0 ? '#C8891F' : '#1F9D6B' },
  ];

  return (
    <div className="fade-up">
      {/* Résumé */}
      <div style={{ ...carte, display: 'flex', flexWrap: 'wrap', marginBottom: '18px' }}>
        {miniStats.map((m, i) => (
          <div key={m.label} style={{ flex: 1, minWidth: '170px', display: 'flex', alignItems: 'center', gap: '13px', padding: '18px 22px', borderLeft: i === 0 ? 'none' : '1px solid #F1F4FA' }}>
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

      {/* Recherche */}
      <div style={{ position: 'relative', maxWidth: '420px', marginBottom: '16px' }}>
        <span className="ms" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '20px', color: MUTE }}>search</span>
        <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Rechercher par nom ou téléphone…" aria-label="Rechercher une cliente" style={{ height: '46px', width: '100%', padding: '0 14px 0 44px', borderRadius: '13px', border: '1px solid #E4E9F2', background: '#fff', outline: 'none', color: INK, fontSize: '14px' }} />
      </div>

      {/* 2-col layout */}
      <div style={{ display: 'grid', gridTemplateColumns: clienteSelectee && !isMobile ? '1fr 380px' : '1fr', gap: '16px', alignItems: 'start' }}>
        {/* Liste */}
        <div>
          {chargement ? (
            <div style={{ textAlign: 'center', padding: '60px', color: MUTE }}>Chargement…</div>
          ) : filtrees.length === 0 ? (
            <div style={{ ...carte, textAlign: 'center', padding: '60px', color: MUTE }}>
              <span className="ms" style={{ fontSize: '46px', display: 'block', marginBottom: '10px', color: '#C6D2E8' }}>groups</span>
              {recherche ? 'Aucune cliente trouvée.' : 'Aucune cliente enregistrée.'}
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {filtrees.map(c => (
                <button key={c.id} onClick={() => voirDetail(c)} style={{ width: '100%', padding: '16px 20px', borderRadius: '18px', background: clienteSelectee?.id === c.id ? '#F5F8FF' : '#fff', border: `1px solid ${clienteSelectee?.id === c.id ? 'rgba(37,99,235,.45)' : LINE}`, boxShadow: '0 4px 14px rgba(26,36,56,.04)', cursor: 'pointer', textAlign: 'left', transition: 'all .15s' }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
                      <div style={{ width: '42px', height: '42px', borderRadius: '13px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '18px', fontWeight: 800, color: BLUE, flexShrink: 0 }}>{c.nom[0].toUpperCase()}</div>
                      <div>
                        <div style={{ fontSize: '14.5px', fontWeight: 600, color: INK }}>{c.nom}</div>
                        {c.telephone ? (
                          <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '12px', color: MUTE }}>
                            <span className="ms" style={{ fontSize: '13px' }}>phone</span>{c.telephone}
                          </div>
                        ) : <div style={{ fontSize: '12px', color: '#B7C4DE' }}>Pas de téléphone</div>}
                      </div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '15px', fontWeight: 800, color: INK }}>{fmt(c.totalDepense)} <span style={{ fontSize: '11px', color: BLUE, fontWeight: 700 }}>FCFA</span></div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '6px', justifyContent: 'flex-end', marginTop: '4px' }}>
                        <span style={{ fontSize: '11.5px', background: '#EEF3FC', color: BLUE, padding: '3px 9px', borderRadius: '20px', fontWeight: 600 }}>{c.nbVentes} achat{c.nbVentes > 1 ? 's' : ''}</span>
                        {c.resteAPayer > 0 && <span style={{ fontSize: '11.5px', background: 'rgba(200,137,31,.14)', color: '#C8891F', padding: '3px 9px', borderRadius: '20px', fontWeight: 600 }}>-{fmt(c.resteAPayer)}</span>}
                      </div>
                    </div>
                  </div>
                  {c.derniereVisite && (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', marginTop: '8px', fontSize: '11.5px', color: '#A5AEBD' }}>
                      <span className="ms" style={{ fontSize: '13px' }}>schedule</span>
                      Dernière visite : {new Date(c.derniereVisite).toLocaleDateString('fr-FR')}
                    </div>
                  )}
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Detail */}
        {clienteSelectee && (
          <div style={{ position: isMobile ? 'static' : 'sticky', top: '90px', borderRadius: '18px', background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(26,36,56,.08)', overflow: 'hidden' }}>
            <div style={{ background: 'linear-gradient(135deg,#EEF3FC,#F7FAFF)', padding: '20px', borderBottom: '1px solid #E7EEFB' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '14px', marginBottom: '16px' }}>
                <div style={{ width: '50px', height: '50px', borderRadius: '15px', background: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid rgba(37,99,235,.25)', fontSize: '24px', fontWeight: 800, color: BLUE }}>{clienteSelectee.nom[0].toUpperCase()}</div>
                <div>
                  <div style={{ fontSize: '17px', fontWeight: 800, color: INK }}>{clienteSelectee.nom}</div>
                  {clienteSelectee.telephone ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px', fontSize: '13px', color: BLUE }}>
                      <span className="ms" style={{ fontSize: '14px' }}>phone</span>{clienteSelectee.telephone}
                    </div>
                  ) : <div style={{ fontSize: '12px', color: '#A5AEBD' }}>Pas de téléphone</div>}
                </div>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px' }}>
                {[
                  { label: 'Achats', value: clienteSelectee.nbVentes.toString(), warn: false },
                  { label: 'Total', value: fmt(clienteSelectee.totalDepense), warn: false },
                  { label: 'Reste', value: fmt(clienteSelectee.resteAPayer), warn: clienteSelectee.resteAPayer > 0 },
                ].map(s => (
                  <div key={s.label} style={{ background: '#fff', borderRadius: '12px', padding: '10px', textAlign: 'center', border: `1px solid ${s.warn ? 'rgba(200,137,31,.3)' : LINE}` }}>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: s.warn ? '#C8891F' : INK }}>{s.value}</div>
                    <div style={{ fontSize: '10px', color: SOFT, fontWeight: 600, letterSpacing: '.3px', textTransform: 'uppercase' }}>{s.label}</div>
                  </div>
                ))}
              </div>
            </div>
            <div style={{ padding: '16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '12px', fontSize: '13px', fontWeight: 700, color: INK }}>
                <span className="ms" style={{ fontSize: '18px', color: BLUE }}>shopping_bag</span>Historique
              </div>
              {chargementDetail ? (
                <div style={{ textAlign: 'center', padding: '20px', color: MUTE, fontSize: '13px' }}>Chargement…</div>
              ) : ventesCliente.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '20px', color: MUTE, fontSize: '13px' }}>Aucun achat.</div>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', maxHeight: '380px', overflowY: 'auto', paddingRight: '4px' }}>
                  {ventesCliente.map(v => (
                    <div key={v.id} style={{ padding: '12px 14px', borderRadius: '14px', background: '#FBFCFE', border: `1px solid ${LINE}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: '6px' }}>
                        <div>
                          <div style={{ fontSize: '12px', color: MUTE }}>{new Date(v.date_vente).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                          <div style={{ fontSize: '11.5px', color: '#A5AEBD' }}>par {v.utilisateurs?.nom || 'Inconnue'}</div>
                        </div>
                        <div style={{ textAlign: 'right' }}>
                          <div style={{ fontSize: '14px', fontWeight: 800, color: INK }}>{fmt(v.total)} <span style={{ fontSize: '10px', color: BLUE }}>FCFA</span></div>
                          <span style={v.statut_paiement === 'paye' ? BADGE_PAID : BADGE_PART}>{v.statut_paiement === 'paye' ? 'Payé' : `Reste : ${fmt(v.reste_a_payer)}`}</span>
                        </div>
                      </div>
                      {v.vente_produits?.length > 0 && (
                        <div style={{ borderTop: '1px solid #F1F4FA', paddingTop: '6px', display: 'flex', flexDirection: 'column', gap: '2px' }}>
                          {v.vente_produits.map((vp: any, i: number) => (
                            <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '12px' }}>
                              <span style={{ color: '#5A6472' }}>{vp.produits?.nom || 'Inconnu'} <span style={{ color: BLUE, fontWeight: 700 }}>x{vp.quantite}</span></span>
                              <span style={{ color: INK, fontWeight: 600 }}>{fmt(vp.prix_unitaire * vp.quantite)}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
