'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

export default function Dashboard() {
  const [s, setS] = useState({ ca: 0, factures: 0, recentes: 0, encours: 0, aEncaisser: 0, valeurStock: 0, nbArticles: 0, ruptures: 0 });
  const [alertes, setAlertes] = useState<any[]>([]);
  const [chart, setChart] = useState<{ key: string; jour: string; montant: number }[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    charger();
    const canal = supabase.channel('dash').on('postgres_changes', { event: '*', schema: 'public', table: 'ventes' }, () => charger()).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, []);

  const charger = async () => {
    const [{ data: d }, { data: prods }, { count: nbFactures }, { count: aEncaisser }] = await Promise.all([
      supabase.rpc('tableau_de_bord_admin'),
      supabase.from('produits').select('id, nom, prix, stock_restant'),
      supabase.from('ventes').select('*', { count: 'exact', head: true }).eq('annulee', false),
      supabase.from('ventes').select('*', { count: 'exact', head: true }).eq('annulee', false).gt('reste_a_payer', 0),
    ]);

    const depuis = new Date(); depuis.setDate(depuis.getDate() - 13); depuis.setHours(0, 0, 0, 0);
    const { data: v14 } = await supabase.from('ventes').select('total, date_vente').eq('annulee', false).gte('date_vente', depuis.toISOString());

    const valeurStock = (prods || []).reduce((a: number, p: any) => a + Number(p.prix) * Number(p.stock_restant), 0);
    const ruptures = (prods || []).filter((p: any) => p.stock_restant <= 0).length;
    const alerts = (prods || []).filter((p: any) => p.stock_restant <= 5).sort((a: any, b: any) => a.stock_restant - b.stock_restant).slice(0, 5);

    const jours: { key: string; jour: string; montant: number }[] = [];
    for (let i = 13; i >= 0; i--) { const dte = new Date(); dte.setDate(dte.getDate() - i); jours.push({ key: dte.toISOString().slice(0, 10), jour: dte.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), montant: 0 }); }
    (v14 || []).forEach((v: any) => { const j = jours.find(x => x.key === String(v.date_vente).slice(0, 10)); if (j) j.montant += Number(v.total); });

    setS({ ca: Number(d?.stats?.total_ventes || 0), factures: nbFactures || 0, recentes: (v14 || []).length, encours: Number(d?.stats?.paiements_en_attente || 0), aEncaisser: aEncaisser || 0, valeurStock, nbArticles: (prods || []).length, ruptures });
    setAlertes(alerts);
    setChart(jours);
    setChargement(false);
  };

  const CARTES = [
    { icon: 'payments', label: "Chiffre d'affaires", value: fmt(s.ca), unit: 'FCFA', sub: 'Toutes les ventes', badge: 'Cumul', badgeColor: 'succes' },
    { icon: 'receipt_long', label: 'Factures émises', value: s.factures.toString(), unit: 'docs', sub: 'Documents émis', badge: `+${s.recentes} récentes`, badgeColor: 'succes' },
    { icon: 'hourglass_top', label: 'Encours client', value: fmt(s.encours), unit: 'FCFA', sub: 'Reste à payer', badge: `${s.aEncaisser} à encaisser`, badgeColor: 'warn' },
    { icon: 'inventory', label: 'Valeur du stock', value: fmt(s.valeurStock), unit: 'FCFA', sub: `${s.nbArticles} articles référencés`, badge: s.ruptures > 0 ? `${s.ruptures} ruptures` : 'OK', badgeColor: s.ruptures > 0 ? 'danger' : 'succes' },
  ];
  const badgeStyle = (c: string): React.CSSProperties => {
    const m: Record<string, [string, string]> = { succes: ['#1F9D6B', 'rgba(31,157,107,.12)'], warn: ['#C8891F', 'rgba(200,137,31,.14)'], danger: ['#D24444', 'rgba(210,68,68,.12)'] };
    const [col, bg] = m[c] || m.succes;
    return { fontSize: '12px', fontWeight: 700, color: col, background: bg, padding: '4px 10px', borderRadius: '20px', whiteSpace: 'nowrap' };
  };

  const maxChart = Math.max(1, ...chart.map(c => c.montant));

  const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: '1px solid #EAEEF5', boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '22px' };

  return (
    <div className="fade-up">
      {/* Cartes de stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(224px,1fr))', gap: '18px', marginBottom: '20px' }}>
        {CARTES.map(c => (
          <div key={c.label} style={carte}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '13px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="ms" style={{ fontSize: '23px', color: '#2563EB' }}>{c.icon}</span>
              </div>
              <span style={badgeStyle(c.badgeColor)}>{c.badge}</span>
            </div>
            <div style={{ fontSize: '11.5px', fontWeight: 600, letterSpacing: '.5px', color: '#8A94A6', textTransform: 'uppercase' }}>{c.label}</div>
            <div style={{ marginTop: '5px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span style={{ fontSize: '27px', fontWeight: 800, color: '#1A2438', letterSpacing: '-.5px' }}>{c.value}</span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: '#2563EB' }}>{c.unit}</span>
            </div>
            <div style={{ fontSize: '12.5px', color: '#9AA3B2', marginTop: '6px' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Graphique + alertes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: '18px' }}>
        {/* Encaissements */}
        <div style={{ ...carte, gridColumn: 'auto' }}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A2438' }}>Encaissements</div>
              <div style={{ fontSize: '12.5px', color: '#9AA3B2', marginTop: '2px' }}>14 derniers jours · en FCFA</div>
            </div>
            <div style={{ display: 'flex', gap: '2px', background: '#F1F4FA', borderRadius: '10px', padding: '3px' }}>
              {['14 j', '30 j', 'Année'].map((t, i) => (
                <span key={t} style={{ fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '8px', color: i === 0 ? '#2563EB' : '#8A94A6', background: i === 0 ? '#fff' : 'transparent', boxShadow: i === 0 ? '0 1px 3px rgba(26,36,56,.1)' : 'none' }}>{t}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '180px' }}>
            {chart.map((c, i) => (
              <div key={c.key} title={`${c.jour} : ${fmt(c.montant)} FCFA`} style={{ flex: 1, height: `${Math.max(4, (c.montant / maxChart) * 100)}%`, background: i === chart.length - 1 ? '#2563EB' : '#DCE7FB', borderRadius: '6px 6px 3px 3px', minHeight: '4px', transition: 'height .3s' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '11px', color: '#A5AEBD' }}>
            <span>{chart[0]?.jour}</span><span>{chart[Math.floor(chart.length / 2)]?.jour}</span><span>{chart[chart.length - 1]?.jour}</span>
          </div>
        </div>

        {/* Alertes de stock */}
        <div style={carte}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: '#1A2438' }}>Alertes de stock</div>
            <a href="/admin/produits" style={{ fontSize: '13px', color: '#2563EB', fontWeight: 600, textDecoration: 'none' }}>Réapprovisionner</a>
          </div>
          {chargement ? (
            <p style={{ color: '#9AA3B2', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Chargement…</p>
          ) : alertes.length === 0 ? (
            <p style={{ color: '#9AA3B2', fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Aucune alerte — stock au vert ✅</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {alertes.map(p => {
                const epuise = p.stock_restant <= 0;
                const col = epuise ? '#D24444' : '#C8891F';
                const bg = epuise ? 'rgba(210,68,68,.10)' : 'rgba(200,137,31,.12)';
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 6px' }}>
                    <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="ms" style={{ fontSize: '20px', color: col }}>{epuise ? 'error' : 'warning'}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '14px', fontWeight: 600, color: '#1A2438', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nom}</div>
                      <div style={{ fontSize: '11.5px', color: '#A5AEBD' }}>Réf. #{p.id}</div>
                    </div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: col, background: bg, padding: '5px 11px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{epuise ? 'Épuisé' : `${p.stock_restant} restant${p.stock_restant > 1 ? 's' : ''}`}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
