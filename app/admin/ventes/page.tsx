'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';

const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)' };
const th: React.CSSProperties = { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', textAlign: 'left', padding: '13px 20px', background: '#FBFCFE', borderBottom: '1px solid #EEF2F8', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '13px 20px', borderBottom: '1px solid #F1F4FA', verticalAlign: 'middle' };

type Filtre = 'toutes' | 'paye' | 'partiel';

export default function AdminVentes() {
  const [ventes, setVentes] = useState<any[]>([]);
  const [chargement, setChargement] = useState(true);
  const [q, setQ] = useState('');
  const [filtre, setFiltre] = useState<Filtre>('toutes');

  useEffect(() => { chargerVentes(); }, []);

  const chargerVentes = async () => {
    const { data: ventesData } = await supabase.from('ventes').select('*').eq('annulee', false).order('date_vente', { ascending: false });
    if (!ventesData || ventesData.length === 0) { setVentes([]); setChargement(false); return; }
    const clienteIds = [...new Set(ventesData.map((v: any) => v.cliente_id).filter(Boolean))];
    const { data: clientes } = clienteIds.length > 0 ? await supabase.from('clientes').select('id, nom, telephone').in('id', clienteIds) : { data: [] };
    const userIds = [...new Set(ventesData.map((v: any) => v.vendeuse_id).filter(Boolean))];
    const { data: utilisateurs } = userIds.length > 0 ? await supabase.from('utilisateurs').select('id, nom').in('id', userIds) : { data: [] };
    const assembled = ventesData.map((v: any) => ({
      ...v,
      cliente: (clientes || []).find((c: any) => c.id === v.cliente_id) || null,
      vendeuse: (utilisateurs || []).find((u: any) => u.id === v.vendeuse_id) || null,
    }));
    setVentes(assembled);
    setChargement(false);
  };

  const nomClient = (v: any) => v.cliente?.nom || v.nom_client || 'Client comptoir';

  const stats = useMemo(() => {
    let facture = 0, encaisse = 0, reste = 0;
    ventes.forEach(v => { facture += Number(v.total || 0); reste += Number(v.reste_a_payer || 0); encaisse += Number(v.total || 0) - Number(v.reste_a_payer || 0); });
    return { facture, encaisse, reste };
  }, [ventes]);

  const filtres = useMemo(() => {
    const t = q.trim().toLowerCase();
    return ventes.filter(v => {
      if (filtre === 'paye' && v.statut_paiement !== 'paye') return false;
      if (filtre === 'partiel' && v.statut_paiement === 'paye') return false;
      if (t) {
        const hay = `${nomClient(v)} ${v.cliente?.telephone || ''} ${v.vendeuse?.nom || ''} #${v.id}`.toLowerCase();
        if (!hay.includes(t)) return false;
      }
      return true;
    });
  }, [ventes, q, filtre]);

  const miniStats = [
    { icon: 'receipt_long', label: 'Total facturé', value: `${fmt(stats.facture)} FCFA`, col: BLUE },
    { icon: 'payments', label: 'Encaissé', value: `${fmt(stats.encaisse)} FCFA`, col: '#1F9D6B' },
    { icon: 'hourglass_top', label: 'Reste à encaisser', value: `${fmt(stats.reste)} FCFA`, col: stats.reste > 0 ? '#C8891F' : '#1F9D6B' },
  ];

  const onglets: { k: Filtre; label: string }[] = [
    { k: 'toutes', label: 'Toutes' },
    { k: 'paye', label: 'Payées' },
    { k: 'partiel', label: 'À encaisser' },
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
        <div style={{ position: 'relative', flex: 1, minWidth: '220px', maxWidth: '380px' }}>
          <span className="ms" style={{ position: 'absolute', left: '14px', top: '50%', transform: 'translateY(-50%)', fontSize: '20px', color: MUTE }}>search</span>
          <input value={q} onChange={e => setQ(e.target.value)} placeholder="Rechercher client, vendeuse, #facture…" style={{ height: '46px', width: '100%', padding: '0 14px 0 44px', borderRadius: '13px', border: '1px solid #E4E9F2', background: '#fff', outline: 'none', fontSize: '14px', color: INK }} />
        </div>
        <div style={{ display: 'flex', gap: '2px', background: '#EEF1F7', borderRadius: '12px', padding: '4px' }}>
          {onglets.map(o => (
            <button key={o.k} onClick={() => setFiltre(o.k)} style={{ fontSize: '13px', fontWeight: 600, padding: '8px 16px', borderRadius: '9px', border: 'none', cursor: 'pointer', color: filtre === o.k ? BLUE : SOFT, background: filtre === o.k ? '#fff' : 'transparent', boxShadow: filtre === o.k ? '0 1px 3px rgba(26,36,56,.12)' : 'none' }}>{o.label}</button>
          ))}
        </div>
      </div>

      {/* Tableau */}
      <div style={{ ...carte, overflow: 'hidden' }}>
        {chargement ? (
          <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '50px 0' }}>Chargement…</p>
        ) : filtres.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px 20px', color: MUTE }}>
            <span className="ms" style={{ fontSize: '46px', display: 'block', marginBottom: '10px', color: '#C6D2E8' }}>receipt_long</span>
            {ventes.length === 0 ? 'Aucune facture enregistrée.' : 'Aucune facture ne correspond à ce filtre.'}
          </div>
        ) : (
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '680px' }}>
              <thead>
                <tr>
                  <th style={th}>Facture</th>
                  <th style={th}>Vendeuse</th>
                  <th style={{ ...th, textAlign: 'right' }}>Montant</th>
                  <th style={{ ...th, textAlign: 'center' }}>Statut</th>
                  <th style={{ ...th, textAlign: 'right' }}>Date</th>
                </tr>
              </thead>
              <tbody>
                {filtres.map(v => {
                  const paye = v.statut_paiement === 'paye';
                  return (
                    <tr key={v.id}>
                      <td style={td}>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                          <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0, fontSize: '15px', fontWeight: 800, color: BLUE }}>
                            {nomClient(v).charAt(0).toUpperCase()}
                          </div>
                          <div style={{ minWidth: 0 }}>
                            <div style={{ fontSize: '14.5px', fontWeight: 600, color: INK }}>{nomClient(v)}</div>
                            <div style={{ fontSize: '12px', color: MUTE, marginTop: '1px' }}>Facture #{v.id}{v.cliente?.telephone ? ` · ${v.cliente.telephone}` : ''}</div>
                          </div>
                        </div>
                      </td>
                      <td style={{ ...td, fontSize: '14px', color: '#5A6472' }}>{v.vendeuse?.nom || '—'}</td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap' }}>
                        <span style={{ fontSize: '15px', fontWeight: 800, color: INK }}>{fmt(v.total)}</span>
                        <span style={{ fontSize: '11.5px', fontWeight: 700, color: BLUE, marginLeft: '4px' }}>FCFA</span>
                        {v.reste_a_payer > 0 && <div style={{ fontSize: '11.5px', color: '#C8891F', marginTop: '2px', fontWeight: 600 }}>Reste : {fmt(v.reste_a_payer)}</div>}
                      </td>
                      <td style={{ ...td, textAlign: 'center' }}>
                        <span style={{ fontSize: '12px', fontWeight: 700, color: paye ? '#1F9D6B' : '#C8891F', background: paye ? 'rgba(31,157,107,.12)' : 'rgba(200,137,31,.14)', padding: '5px 12px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{paye ? 'Payé' : 'Partiel'}</span>
                      </td>
                      <td style={{ ...td, textAlign: 'right', whiteSpace: 'nowrap', fontSize: '13.5px', color: '#5A6472' }}>
                        {new Date(v.date_vente).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: '2-digit' })}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </div>
  );
}
