'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '22px' };

const MODE_LABELS: Record<string, string> = { cash: 'Espèces', mobile_money: 'Mobile Money', orange_money: 'Orange Money', carte: 'Carte', autre: 'Autre' };
const MODE_COLORS: Record<string, string> = { cash: '#2563EB', mobile_money: '#1F9D6B', orange_money: '#E8833A', carte: '#7C5CFC', autre: '#9AA3B2' };

type Segment = { label: string; value: number; color: string };

// Camembert (donut) en SVG pur — pas de librairie externe.
function Donut({ segments, centreValue, centreLabel }: { segments: Segment[]; centreValue: string; centreLabel: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const R = 56, SW = 20, C = 2 * Math.PI * R;
  let acc = 0;
  return (
    <svg viewBox="0 0 140 140" style={{ width: '140px', height: '140px', flexShrink: 0 }}>
      <circle cx={70} cy={70} r={R} fill="none" stroke="#EEF1F7" strokeWidth={SW} />
      <g transform="rotate(-90 70 70)">
        {segments.filter(s => s.value > 0).map((s, i) => {
          const len = (s.value / total) * C;
          const el = <circle key={i} cx={70} cy={70} r={R} fill="none" stroke={s.color} strokeWidth={SW} strokeDasharray={`${len} ${C - len}`} strokeDashoffset={-acc} />;
          acc += len;
          return el;
        })}
      </g>
      <text x={70} y={66} textAnchor="middle" fontSize={19} fontWeight={800} fill={INK}>{centreValue}</text>
      <text x={70} y={83} textAnchor="middle" fontSize={9} fontWeight={600} fill={MUTE} letterSpacing={0.5}>{centreLabel}</text>
    </svg>
  );
}

function Legende({ segments, total }: { segments: Segment[]; total: number }) {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', flex: 1, minWidth: 0 }}>
      {segments.map(s => (
        <div key={s.label} style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
          <span style={{ width: '10px', height: '10px', borderRadius: '3px', background: s.color, flexShrink: 0 }} />
          <span style={{ fontSize: '13px', color: '#5A6472', flex: 1, minWidth: 0, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{s.label}</span>
          <span style={{ fontSize: '13px', fontWeight: 700, color: INK, flexShrink: 0 }}>{total > 0 ? Math.round((s.value / total) * 100) : 0}%</span>
        </div>
      ))}
    </div>
  );
}

export default function Dashboard() {
  const [s, setS] = useState({ ca: 0, factures: 0, recentes: 0, encours: 0, aEncaisser: 0, valeurStock: 0, nbArticles: 0, ruptures: 0, panierMoyen: 0, ventesJour: 0, ventes7j: 0, nbClients: 0 });
  const [alertes, setAlertes] = useState<any[]>([]);
  const [chart, setChart] = useState<{ key: string; jour: string; montant: number }[]>([]);
  const [parPaiement, setParPaiement] = useState<Segment[]>([]);
  const [statutFactures, setStatutFactures] = useState<Segment[]>([]);
  const [topProduits, setTopProduits] = useState<{ nom: string; quantite: number; montant: number }[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    charger();
    const canal = supabase.channel('dash').on('postgres_changes', { event: '*', schema: 'public', table: 'ventes' }, () => charger()).subscribe();
    return () => { supabase.removeChannel(canal); };
  }, []);

  const charger = async () => {
    const [{ data: d }, { data: prods }, { data: ventes }, { count: nbClients }] = await Promise.all([
      supabase.rpc('tableau_de_bord_admin'),
      supabase.from('produits').select('id, nom, prix, stock_restant'),
      supabase.from('ventes').select('id, total, montant_paye, reste_a_payer, statut_paiement, date_vente').eq('annulee', false),
      supabase.from('clientes').select('*', { count: 'exact', head: true }),
    ]);

    const vv = ventes || [];
    const venteIds = vv.map((v: any) => v.id);
    const [{ data: vp }, { data: paiements }] = venteIds.length > 0
      ? await Promise.all([
          supabase.from('vente_produits').select('produit_id, quantite, prix_unitaire').in('vente_id', venteIds),
          supabase.from('paiements').select('mode, montant').in('vente_id', venteIds),
        ])
      : [{ data: [] as any[] }, { data: [] as any[] }];

    // Stock
    const valeurStock = (prods || []).reduce((a: number, p: any) => a + Number(p.prix) * Number(p.stock_restant), 0);
    const ruptures = (prods || []).filter((p: any) => p.stock_restant <= 0).length;
    const alerts = (prods || []).filter((p: any) => p.stock_restant <= 5).sort((a: any, b: any) => a.stock_restant - b.stock_restant).slice(0, 5);
    const nomProduit: Record<number, string> = {};
    (prods || []).forEach((p: any) => { nomProduit[p.id] = p.nom; });

    // Chart 14 jours
    const jours: { key: string; jour: string; montant: number }[] = [];
    for (let i = 13; i >= 0; i--) { const dte = new Date(); dte.setDate(dte.getDate() - i); jours.push({ key: dte.toISOString().slice(0, 10), jour: dte.toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }), montant: 0 }); }
    const auj = new Date().toISOString().slice(0, 10);
    const il7 = new Date(); il7.setDate(il7.getDate() - 6); il7.setHours(0, 0, 0, 0);
    let ventesJour = 0, ventes7j = 0, recentes = 0;
    vv.forEach((v: any) => {
      const jourStr = String(v.date_vente).slice(0, 10);
      const j = jours.find(x => x.key === jourStr); if (j) { j.montant += Number(v.total); recentes++; }
      if (jourStr === auj) ventesJour += Number(v.total);
      if (new Date(v.date_vente) >= il7) ventes7j += Number(v.total);
    });

    // Camembert moyens de paiement (depuis la table paiements)
    const paie: Record<string, number> = {};
    (paiements || []).forEach((p: any) => { const m = p.mode || 'autre'; paie[m] = (paie[m] || 0) + Number(p.montant || 0); });
    const segPaie: Segment[] = Object.entries(paie).filter(([, val]) => val > 0).sort((a, b) => b[1] - a[1])
      .map(([m, val]) => ({ label: MODE_LABELS[m] || m, value: val, color: MODE_COLORS[m] || '#9AA3B2' }));

    // Camembert statut des factures
    const payees = vv.filter((v: any) => v.statut_paiement === 'paye').length;
    const partielles = vv.length - payees;
    const segStatut: Segment[] = [
      { label: 'Payées', value: payees, color: '#1F9D6B' },
      { label: 'Partielles', value: partielles, color: '#C8891F' },
    ];

    // Top produits (par quantite)
    const agg: Record<number, { quantite: number; montant: number }> = {};
    (vp || []).forEach((x: any) => {
      if (!agg[x.produit_id]) agg[x.produit_id] = { quantite: 0, montant: 0 };
      agg[x.produit_id].quantite += Number(x.quantite);
      agg[x.produit_id].montant += Number(x.quantite) * Number(x.prix_unitaire);
    });
    const top = Object.entries(agg).map(([id, a]) => ({ nom: nomProduit[Number(id)] || `#${id}`, quantite: a.quantite, montant: a.montant }))
      .sort((a, b) => b.quantite - a.quantite).slice(0, 5);

    const ca = Number(d?.stats?.total_ventes || 0);
    setS({
      ca, factures: vv.length, recentes, encours: Number(d?.stats?.paiements_en_attente || 0),
      aEncaisser: vv.filter((v: any) => Number(v.reste_a_payer) > 0).length,
      valeurStock, nbArticles: (prods || []).length, ruptures,
      panierMoyen: vv.length > 0 ? ca / vv.length : 0, ventesJour, ventes7j, nbClients: nbClients || 0,
    });
    setAlertes(alerts);
    setChart(jours);
    setParPaiement(segPaie);
    setStatutFactures(segStatut);
    setTopProduits(top);
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

  const miniStats = [
    { icon: 'shopping_cart_checkout', label: 'Panier moyen', value: `${fmt(s.panierMoyen)} F`, col: BLUE },
    { icon: 'today', label: "Ventes aujourd'hui", value: `${fmt(s.ventesJour)} F`, col: '#1F9D6B' },
    { icon: 'date_range', label: 'Ventes 7 jours', value: `${fmt(s.ventes7j)} F`, col: '#7C5CFC' },
    { icon: 'groups', label: 'Clients', value: s.nbClients.toString(), col: '#E8833A' },
  ];

  const maxChart = Math.max(1, ...chart.map(c => c.montant));
  const totalPaie = parPaiement.reduce((a, x) => a + x.value, 0);
  const totalStatut = statutFactures.reduce((a, x) => a + x.value, 0);
  const maxTop = Math.max(1, ...topProduits.map(t => t.quantite));

  return (
    <div className="fade-up">
      {/* Cartes de stats */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(224px,1fr))', gap: '18px', marginBottom: '18px' }}>
        {CARTES.map(c => (
          <div key={c.label} style={carte}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '13px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="ms" style={{ fontSize: '23px', color: BLUE }}>{c.icon}</span>
              </div>
              <span style={badgeStyle(c.badgeColor)}>{c.badge}</span>
            </div>
            <div style={{ fontSize: '11.5px', fontWeight: 600, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase' }}>{c.label}</div>
            <div style={{ marginTop: '5px', display: 'flex', alignItems: 'baseline', gap: '6px' }}>
              <span style={{ fontSize: '27px', fontWeight: 800, color: INK, letterSpacing: '-.5px' }}>{c.value}</span>
              <span style={{ fontSize: '13px', fontWeight: 700, color: BLUE }}>{c.unit}</span>
            </div>
            <div style={{ fontSize: '12.5px', color: MUTE, marginTop: '6px' }}>{c.sub}</div>
          </div>
        ))}
      </div>

      {/* Mini-stats secondaires */}
      <div style={{ ...carte, padding: 0, display: 'flex', flexWrap: 'wrap', marginBottom: '18px' }}>
        {miniStats.map((m, i) => (
          <div key={m.label} style={{ flex: 1, minWidth: '160px', display: 'flex', alignItems: 'center', gap: '13px', padding: '18px 22px', borderLeft: i === 0 ? 'none' : '1px solid #F1F4FA' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span className="ms" style={{ fontSize: '22px', color: m.col }}>{m.icon}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase' }}>{m.label}</div>
              <div style={{ fontSize: '19px', fontWeight: 800, color: INK, marginTop: '2px', letterSpacing: '-.3px' }}>{m.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Encaissements + Top produits */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: '18px', marginBottom: '18px' }}>
        {/* Encaissements */}
        <div style={carte}>
          <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', marginBottom: '20px' }}>
            <div>
              <div style={{ fontSize: '16px', fontWeight: 700, color: INK }}>Encaissements</div>
              <div style={{ fontSize: '12.5px', color: MUTE, marginTop: '2px' }}>14 derniers jours · en FCFA</div>
            </div>
            <div style={{ display: 'flex', gap: '2px', background: '#F1F4FA', borderRadius: '10px', padding: '3px' }}>
              {['14 j', '30 j', 'Année'].map((t, i) => (
                <span key={t} style={{ fontSize: '12px', fontWeight: 600, padding: '6px 12px', borderRadius: '8px', color: i === 0 ? BLUE : SOFT, background: i === 0 ? '#fff' : 'transparent', boxShadow: i === 0 ? '0 1px 3px rgba(26,36,56,.1)' : 'none' }}>{t}</span>
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '180px' }}>
            {chart.map((c, i) => (
              <div key={c.key} title={`${c.jour} : ${fmt(c.montant)} FCFA`} style={{ flex: 1, height: `${Math.max(4, (c.montant / maxChart) * 100)}%`, background: i === chart.length - 1 ? BLUE : '#DCE7FB', borderRadius: '6px 6px 3px 3px', minHeight: '4px', transition: 'height .3s' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '11px', color: '#A5AEBD' }}>
            <span>{chart[0]?.jour}</span><span>{chart[Math.floor(chart.length / 2)]?.jour}</span><span>{chart[chart.length - 1]?.jour}</span>
          </div>
        </div>

        {/* Top produits */}
        <div style={carte}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: INK, marginBottom: '2px' }}>Top produits</div>
          <div style={{ fontSize: '12.5px', color: MUTE, marginBottom: '18px' }}>Les plus vendus · en quantité</div>
          {topProduits.length === 0 ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '30px 0' }}>Aucune vente pour l'instant.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {topProduits.map((t, i) => (
                <div key={t.nom + i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', marginBottom: '5px' }}>
                    <span style={{ fontSize: '13.5px', fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: '60%' }}>{t.nom}</span>
                    <span style={{ fontSize: '12.5px', color: SOFT }}><b style={{ color: BLUE }}>{t.quantite}</b> vendus · {fmt(t.montant)} F</span>
                  </div>
                  <div style={{ height: '9px', background: '#EEF1F7', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(t.quantite / maxTop) * 100}%`, background: 'linear-gradient(90deg,#4B7DF5,#1D4FD0)', borderRadius: '6px' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Camemberts + Alertes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '18px' }}>
        {/* Camembert moyens de paiement */}
        <div style={carte}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: INK, marginBottom: '18px' }}>Moyens de paiement</div>
          {totalPaie === 0 ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '40px 0' }}>Aucun encaissement.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <Donut segments={parPaiement} centreValue={fmt(totalPaie)} centreLabel="FCFA" />
              <Legende segments={parPaiement} total={totalPaie} />
            </div>
          )}
        </div>

        {/* Camembert statut factures */}
        <div style={carte}>
          <div style={{ fontSize: '16px', fontWeight: 700, color: INK, marginBottom: '18px' }}>Statut des factures</div>
          {totalStatut === 0 ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '40px 0' }}>Aucune facture.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <Donut segments={statutFactures} centreValue={totalStatut.toString()} centreLabel="factures" />
              <Legende segments={statutFactures} total={totalStatut} />
            </div>
          )}
        </div>

        {/* Alertes de stock */}
        <div style={carte}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={{ fontSize: '16px', fontWeight: 700, color: INK }}>Alertes de stock</div>
            <a href="/admin/produits" style={{ fontSize: '13px', color: BLUE, fontWeight: 600, textDecoration: 'none' }}>Réapprovisionner</a>
          </div>
          {chargement ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Chargement…</p>
          ) : alertes.length === 0 ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Aucune alerte — stock au vert ✅</p>
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
                      <div style={{ fontSize: '14px', fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nom}</div>
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
