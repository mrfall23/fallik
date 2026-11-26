'use client';
import { useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { supabase } from '@/lib/supabase';
import { lireBoutique, SEUIL_STOCK_BAS_DEFAUT } from '@/lib/boutique';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const VERT = '#1F9D6B', ORANGE = '#C8891F', ROUGE = '#D24444';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '22px' };
const titreCarte: React.CSSProperties = { fontSize: '16px', fontWeight: 700, color: INK };
const sousTitre: React.CSSProperties = { fontSize: '12.5px', color: MUTE, marginTop: '2px' };

const MODE_LABELS: Record<string, string> = { cash: 'Espèces', mobile_money: 'Mobile Money', orange_money: 'Orange Money', carte: 'Carte', autre: 'Autre' };
const MODE_COLORS: Record<string, string> = { cash: '#2563EB', mobile_money: '#1F9D6B', orange_money: '#E8833A', carte: '#7C5CFC', autre: '#9AA3B2' };

type Segment = { label: string; value: number; color: string };
type Produit = { nom: string; quantite: number; ca: number; benefice?: number };
type Tableau = {
  periode: { id: number; nom: string; debut: string } | null;
  stats: Record<string, number>;
  produits_vendus: number;
  comparatif: Record<string, number>;
  jours: { jour: string; ca: number; nb: number }[];
  ca_par_mode: { mode: string; total: number }[];
  produits_ca: Produit[];
  produits_quantite: Produit[];
  produits_marge: Produit[];
  marge: Record<string, number>;
  top_vendeuses: { id: number; nom: string; nb: number; total: number }[];
};

// Variation en % ; null quand il n'y a pas de reference.
function variation(courant: number, precedent: number): number | null {
  if (precedent <= 0) return null;
  return Math.round(((courant - precedent) / precedent) * 100);
}

function Donut({ segments, centreValue, centreLabel }: { segments: Segment[]; centreValue: string; centreLabel: string }) {
  const total = segments.reduce((a, s) => a + s.value, 0) || 1;
  const R = 56, SW = 20, C = 2 * Math.PI * R;
  const arcs = segments.filter(s => s.value > 0).map(s => ({ color: s.color, len: (s.value / total) * C }));
  const debuts = arcs.map((_, i) => arcs.slice(0, i).reduce((a, x) => a + x.len, 0));
  return (
    <svg viewBox="0 0 140 140" style={{ width: '140px', height: '140px', flexShrink: 0 }}>
      <circle cx={70} cy={70} r={R} fill="none" stroke="#EEF1F7" strokeWidth={SW} />
      <g transform="rotate(-90 70 70)">
        {arcs.map((a, i) => (
          <circle key={i} cx={70} cy={70} r={R} fill="none" stroke={a.color} strokeWidth={SW} strokeDasharray={`${a.len} ${C - a.len}`} strokeDashoffset={-debuts[i]} />
        ))}
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

async function lireTout() {
  const [{ data, error }, { data: prods }, boutique] = await Promise.all([
    supabase.rpc('tableau_de_bord_admin'),
    supabase.from('produits').select('id, nom, prix, stock_restant, actif, suivi_stock'),
    lireBoutique(),
  ]);
  return { d: error ? null : (data as Tableau), erreur: error?.message || '', prods: prods || [], boutique };
}

export default function Dashboard() {
  const [d, setD] = useState<Tableau | null>(null);
  const [erreur, setErreur] = useState('');
  const [prods, setProds] = useState<any[]>([]);
  const [devise, setDevise] = useState('FCFA');
  const [seuil, setSeuil] = useState(SEUIL_STOCK_BAS_DEFAUT);
  const [chargement, setChargement] = useState(true);
  const [classement, setClassement] = useState<'quantite' | 'ca' | 'benefice'>('quantite');
  const [clotureOuverte, setClotureOuverte] = useState(false);
  const [nomPeriode, setNomPeriode] = useState('');
  const [enCloture, setEnCloture] = useState(false);
  const [erreurCloture, setErreurCloture] = useState('');
  const [bilan, setBilan] = useState<{ ca: number; nb: number; nom: string } | null>(null);

  const appliquer = useCallback((r: Awaited<ReturnType<typeof lireTout>>) => {
    setD(r.d); setErreur(r.erreur); setProds(r.prods);
    if (r.boutique) { setDevise(r.boutique.devise || 'FCFA'); setSeuil(r.boutique.seuil_stock_bas ?? SEUIL_STOCK_BAS_DEFAUT); }
    setChargement(false);
  }, []);
  const recharger = useCallback(() => lireTout().then(appliquer), [appliquer]);

  useEffect(() => {
    let annule = false;
    lireTout().then(r => { if (!annule) appliquer(r); });
    const canal = supabase.channel('dash').on('postgres_changes', { event: '*', schema: 'public', table: 'ventes' }, () => { recharger(); }).subscribe();
    return () => { annule = true; supabase.removeChannel(canal); };
  }, [appliquer, recharger]);

  const cloturer = async () => {
    setEnCloture(true); setErreurCloture('');
    const nom = nomPeriode.trim();
    const { data, error } = await supabase.rpc('cloturer_periode', { p_nom: nom || null });
    setEnCloture(false);
    if (error) { setErreurCloture(error.message); return; }
    setClotureOuverte(false); setNomPeriode('');
    setBilan({ ca: Number(data?.ca) || 0, nb: Number(data?.nb_ventes) || 0, nom: nom || 'Période' });
    recharger();
  };

  if (chargement) return <div style={{ textAlign: 'center', padding: '60px', color: MUTE }}>Chargement…</div>;
  if (!d) return <div style={{ ...carte, color: ROUGE }}>Tableau de bord indisponible : {erreur}</div>;

  const st = d.stats || {}, cmp = d.comparatif || {}, mg = d.marge || {};
  const N = (x: unknown) => Number(x) || 0;
  const ca = N(st.total_ventes), nb = N(st.nb_ventes);

  // Stock (produits en vente uniquement)
  const actifs = prods.filter((p: any) => p.actif !== false && p.suivi_stock !== false); // services : pas de stock
  const valeurStock = actifs.reduce((a: number, p: any) => a + Number(p.prix) * Math.max(0, Number(p.stock_restant)), 0);
  const ruptures = actifs.filter((p: any) => p.stock_restant <= 0).length;
  const alertes = actifs.filter((p: any) => p.stock_restant <= seuil).sort((a: any, b: any) => a.stock_restant - b.stock_restant).slice(0, 5);

  const couverture = N(mg.ca_lignes_periode) > 0 ? N(mg.ca_couvert_periode) / N(mg.ca_lignes_periode) : 0;
  const CARTES = [
    { icon: 'payments', label: "Chiffre d'affaires", value: fmt(ca), unit: devise, sub: `${nb} vente${nb > 1 ? 's' : ''} sur la période`, badge: 'Période', color: 'succes' },
    { icon: 'savings', label: 'Bénéfice', value: fmt(N(mg.benefice_periode)), unit: devise,
      sub: couverture === 0 ? "Renseignez les prix d'achat (Stock)" : couverture < 0.999 ? `Calculé sur ${Math.round(couverture * 100)} % des ventes` : `Marge ${N(mg.ca_couvert_periode) > 0 ? Math.round((N(mg.benefice_periode) / N(mg.ca_couvert_periode)) * 100) : 0} %`,
      badge: couverture === 0 ? 'À compléter' : 'Période', color: couverture === 0 ? 'warn' : 'succes' },
    { icon: 'hourglass_top', label: 'Dettes clients', value: fmt(N(st.paiements_en_attente)), unit: devise, sub: 'Reste à encaisser (toutes périodes)', badge: `${N(st.nb_a_encaisser)} à encaisser`, color: N(st.nb_a_encaisser) > 0 ? 'warn' : 'succes' },
    { icon: 'inventory', label: 'Valeur du stock', value: fmt(valeurStock), unit: devise, sub: `${actifs.length} produits en vente · prix de vente`, badge: ruptures > 0 ? `${ruptures} rupture${ruptures > 1 ? 's' : ''}` : 'OK', color: ruptures > 0 ? 'danger' : 'succes' },
  ];
  const badgeStyle = (c: string): React.CSSProperties => {
    const m: Record<string, [string, string]> = { succes: [VERT, 'rgba(31,157,107,.12)'], warn: [ORANGE, 'rgba(200,137,31,.14)'], danger: [ROUGE, 'rgba(210,68,68,.12)'] };
    const [col, bg] = m[c] || m.succes;
    return { fontSize: '12px', fontWeight: 700, color: col, background: bg, padding: '4px 10px', borderRadius: '20px', whiteSpace: 'nowrap' };
  };

  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long' });
  const COMPARATIFS = [
    { label: `CA de ${mois}`, courant: N(cmp.ca_mois), ref: N(cmp.ca_mois_prec_meme_date), total: N(cmp.ca_mois_prec), unit: devise },
    { label: `Ventes de ${mois}`, courant: N(cmp.nb_mois), ref: N(cmp.nb_mois_prec_meme_date), total: N(cmp.nb_mois_prec), unit: 'ventes' },
    { label: `Bénéfice de ${mois}`, courant: N(mg.benefice_mois), ref: N(mg.benefice_mois_prec_meme_date), total: N(mg.benefice_mois_prec), unit: devise },
  ];

  const miniStats = [
    { icon: 'today', label: "Aujourd'hui", value: `${fmt(N(st.ca_jour))} ${devise}`, sub: `${N(st.nb_jour)} vente${N(st.nb_jour) > 1 ? 's' : ''}`, col: VERT },
    { icon: 'date_range', label: '7 derniers jours', value: `${fmt(N(st.ca_7j))} ${devise}`, col: '#7C5CFC' },
    { icon: 'shopping_cart_checkout', label: 'Panier moyen', value: `${fmt(nb > 0 ? ca / nb : 0)} ${devise}`, col: BLUE },
    { icon: 'shopping_bag', label: 'Articles vendus', value: fmt(N(d.produits_vendus)), sub: 'sur la période', col: '#E8833A' },
  ];

  const jours = (d.jours || []).map(j => ({ ...j, ca: N(j.ca), label: new Date(`${j.jour}T12:00:00`).toLocaleDateString('fr-FR', { day: 'numeric', month: 'short' }) }));
  const maxJour = Math.max(1, ...jours.map(j => j.ca));
  const total14 = jours.reduce((a, j) => a + j.ca, 0);

  const parMode: Segment[] = (d.ca_par_mode || []).map(m => ({ label: MODE_LABELS[m.mode] || m.mode, value: N(m.total), color: MODE_COLORS[m.mode] || '#9AA3B2' }));
  const totalMode = parMode.reduce((a, x) => a + x.value, 0);
  const statuts: Segment[] = [
    { label: 'Payées', value: N(st.nb_payees), color: VERT },
    { label: 'Avec reste à payer', value: N(st.nb_partielles), color: ORANGE },
  ];

  const listes = { quantite: d.produits_quantite || [], ca: d.produits_ca || [], benefice: d.produits_marge || [] };
  const top = listes[classement];
  const valeurTop = (p: Produit) => N(classement === 'quantite' ? p.quantite : classement === 'ca' ? p.ca : p.benefice);
  const maxTop = Math.max(1, ...top.map(valeurTop));

  const debutPeriode = d.periode?.debut ? new Date(d.periode.debut).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '';

  return (
    <div className="fade-up">
      {/* Période en cours + clôture */}
      <div style={{ ...carte, padding: '14px 18px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', flexWrap: 'wrap', marginBottom: '18px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', minWidth: 0 }}>
          <span className="ms" style={{ fontSize: '22px', color: BLUE }}>event_available</span>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.4px', color: SOFT, textTransform: 'uppercase' }}>Période en cours</div>
            <div style={{ fontSize: '15px', fontWeight: 700, color: INK }}>{d.periode?.nom || 'Période en cours'}{debutPeriode ? ` · depuis le ${debutPeriode}` : ''}</div>
          </div>
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <Link href="/admin/calendrier" style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '40px', padding: '0 14px', borderRadius: '12px', fontSize: '13.5px', fontWeight: 600, background: '#EEF3FC', color: BLUE, textDecoration: 'none' }}>
            <span className="ms" style={{ fontSize: '18px' }}>calendar_month</span>Périodes passées
          </Link>
          <button onClick={() => { setErreurCloture(''); setNomPeriode(''); setClotureOuverte(true); }}
            style={{ display: 'flex', alignItems: 'center', gap: '7px', height: '40px', padding: '0 14px', borderRadius: '12px', cursor: 'pointer', fontSize: '13.5px', fontWeight: 700, background: 'rgba(200,137,31,.12)', color: ORANGE, border: '1px solid rgba(200,137,31,.3)' }}>
            <span className="ms" style={{ fontSize: '18px' }}>restart_alt</span>Clôturer et remettre à zéro
          </button>
        </div>
      </div>

      {bilan && (
        <div style={{ ...carte, padding: '14px 18px', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '10px', background: 'rgba(31,157,107,.07)', borderColor: 'rgba(31,157,107,.25)' }}>
          <span className="ms" style={{ fontSize: '22px', color: VERT }}>task_alt</span>
          <div style={{ flex: 1, fontSize: '13.5px', color: INK }}>« {bilan.nom} » clôturée : <b>{fmt(bilan.ca)} {devise}</b> sur {bilan.nb} vente{bilan.nb > 1 ? 's' : ''}. Les compteurs repartent de zéro ; rien n&apos;a été supprimé.</div>
          <button onClick={() => setBilan(null)} aria-label="Fermer" style={{ background: 'transparent', border: 'none', cursor: 'pointer', display: 'flex' }}><span className="ms" style={{ fontSize: '20px', color: MUTE }}>close</span></button>
        </div>
      )}

      {/* Cartes principales */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(224px,1fr))', gap: '18px', marginBottom: '18px' }}>
        {CARTES.map(c => (
          <div key={c.label} style={carte}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
              <div style={{ width: '44px', height: '44px', borderRadius: '13px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="ms" style={{ fontSize: '23px', color: BLUE }}>{c.icon}</span>
              </div>
              <span style={badgeStyle(c.color)}>{c.badge}</span>
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

      {/* Mois en cours vs mois précédent à la même date */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(240px,1fr))', gap: '18px', marginBottom: '18px' }}>
        {COMPARATIFS.map(c => {
          const v = variation(c.courant, c.ref);
          const hausse = v !== null && v >= 0;
          return (
            <div key={c.label} style={{ ...carte, padding: '18px 20px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: '8px' }}>
                <div style={{ fontSize: '11.5px', fontWeight: 600, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase' }}>{c.label}</div>
                {v !== null && (
                  <span style={{ display: 'flex', alignItems: 'center', gap: '3px', fontSize: '12px', fontWeight: 700, color: hausse ? VERT : ROUGE, background: hausse ? 'rgba(31,157,107,.12)' : 'rgba(210,68,68,.10)', padding: '3px 9px', borderRadius: '20px' }}>
                    <span className="ms" style={{ fontSize: '15px' }}>{hausse ? 'trending_up' : 'trending_down'}</span>{hausse ? '+' : ''}{v} %
                  </span>
                )}
              </div>
              <div style={{ marginTop: '6px', fontSize: '23px', fontWeight: 800, color: INK }}>{fmt(c.courant)} <span style={{ fontSize: '12px', color: BLUE }}>{c.unit}</span></div>
              <div style={{ fontSize: '12px', color: MUTE, marginTop: '4px' }}>
                {c.ref > 0 || c.total > 0 ? `${fmt(c.ref)} à la même date le mois dernier · ${fmt(c.total)} sur tout le mois` : 'Pas de comparaison : aucune vente le mois dernier'}
              </div>
            </div>
          );
        })}
      </div>

      {/* Mini-stats */}
      <div style={{ ...carte, padding: 0, display: 'flex', flexWrap: 'wrap', marginBottom: '18px' }}>
        {miniStats.map((m, i) => (
          <div key={m.label} style={{ flex: 1, minWidth: '170px', display: 'flex', alignItems: 'center', gap: '13px', padding: '18px 22px', borderLeft: i === 0 ? 'none' : '1px solid #F1F4FA' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span className="ms" style={{ fontSize: '22px', color: m.col }}>{m.icon}</span>
            </div>
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase' }}>{m.label}</div>
              <div style={{ fontSize: '18px', fontWeight: 800, color: INK, marginTop: '2px' }}>{m.value}</div>
              {m.sub && <div style={{ fontSize: '11.5px', color: MUTE }}>{m.sub}</div>}
            </div>
          </div>
        ))}
      </div>

      {/* 14 jours + top produits */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: '18px', marginBottom: '18px' }}>
        <div style={carte}>
          <div style={{ marginBottom: '20px' }}>
            <div style={titreCarte}>Ventes des 14 derniers jours</div>
            <div style={sousTitre}>{fmt(total14)} {devise} au total</div>
          </div>
          <div style={{ display: 'flex', alignItems: 'flex-end', gap: '4px', height: '180px' }}>
            {jours.map((j, i) => (
              <div key={j.jour} title={`${j.label} : ${fmt(j.ca)} ${devise} (${j.nb} vente${j.nb > 1 ? 's' : ''})`}
                style={{ flex: 1, height: `${Math.max(3, (j.ca / maxJour) * 100)}%`, background: i === jours.length - 1 ? BLUE : '#DCE7FB', borderRadius: '6px 6px 3px 3px', transition: 'height .3s' }} />
            ))}
          </div>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: '10px', fontSize: '11px', color: '#A5AEBD' }}>
            <span>{jours[0]?.label}</span><span>{jours[Math.floor(jours.length / 2)]?.label}</span><span>Aujourd&apos;hui</span>
          </div>
        </div>

        <div style={carte}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: '10px', marginBottom: '18px', flexWrap: 'wrap' }}>
            <div>
              <div style={titreCarte}>Top produits</div>
              <div style={sousTitre}>Sur la période en cours</div>
            </div>
            <div style={{ display: 'flex', gap: '2px', background: '#F1F4FA', borderRadius: '10px', padding: '3px' }}>
              {([['quantite', 'Quantité'], ['ca', 'CA'], ['benefice', 'Bénéfice']] as const).map(([k, l]) => (
                <button key={k} onClick={() => setClassement(k)} style={{ fontSize: '12px', fontWeight: 600, padding: '6px 11px', borderRadius: '8px', border: 'none', cursor: 'pointer', color: classement === k ? BLUE : SOFT, background: classement === k ? '#fff' : 'transparent', boxShadow: classement === k ? '0 1px 3px rgba(26,36,56,.1)' : 'none' }}>{l}</button>
              ))}
            </div>
          </div>
          {top.length === 0 ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '30px 0' }}>
              {classement === 'benefice' ? "Aucun bénéfice calculable : renseignez les prix d'achat dans Stock." : 'Aucune vente sur la période.'}
            </p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
              {top.map((t, i) => (
                <div key={t.nom + i}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '8px', marginBottom: '5px' }}>
                    <span style={{ fontSize: '13.5px', fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', minWidth: 0 }}>{t.nom}</span>
                    <span style={{ fontSize: '12.5px', color: SOFT, whiteSpace: 'nowrap' }}>
                      <b style={{ color: BLUE }}>{fmt(N(t.quantite))}</b> vendus · {fmt(N(t.ca))} {devise}
                      {classement === 'benefice' && <> · <b style={{ color: VERT }}>+{fmt(N(t.benefice))}</b></>}
                    </span>
                  </div>
                  <div style={{ height: '9px', background: '#EEF1F7', borderRadius: '6px', overflow: 'hidden' }}>
                    <div style={{ height: '100%', width: `${(valeurTop(t) / maxTop) * 100}%`, background: classement === 'benefice' ? 'linear-gradient(90deg,#34C08A,#1F9D6B)' : 'linear-gradient(90deg,#4B7DF5,#1D4FD0)', borderRadius: '6px' }} />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Vendeuses, paiements, statuts, alertes */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(300px,1fr))', gap: '18px' }}>
        <div style={carte}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div style={titreCarte}>Meilleures vendeuses</div>
            <Link href="/admin/vendeuses" style={{ fontSize: '13px', color: BLUE, fontWeight: 600, textDecoration: 'none' }}>Objectifs</Link>
          </div>
          {(d.top_vendeuses || []).length === 0 ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '30px 0' }}>Aucune vente sur la période.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
              {d.top_vendeuses.map((v, i) => (
                <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ width: '30px', height: '30px', borderRadius: '10px', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '14px', fontWeight: 800, color: ['#B8912E', '#8C9099', '#A5673B'][i], background: ['rgba(184,145,46,.14)', 'rgba(140,144,153,.14)', 'rgba(165,103,59,.15)'][i] }}>{i + 1}</span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', fontWeight: 600, color: INK }}>{v.nom}</div>
                    <div style={{ fontSize: '11.5px', color: MUTE }}>{N(v.nb)} vente{N(v.nb) > 1 ? 's' : ''}</div>
                  </div>
                  <span style={{ fontSize: '14px', fontWeight: 800, color: INK }}>{fmt(N(v.total))} <span style={{ fontSize: '11px', color: BLUE }}>{devise}</span></span>
                </div>
              ))}
            </div>
          )}
        </div>

        <div style={carte}>
          <div style={{ ...titreCarte, marginBottom: '18px' }}>Moyens de paiement</div>
          {totalMode === 0 ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '40px 0' }}>Aucun encaissement sur la période.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <Donut segments={parMode} centreValue={fmt(totalMode)} centreLabel={devise} />
              <Legende segments={parMode} total={totalMode} />
            </div>
          )}
        </div>

        <div style={carte}>
          <div style={{ ...titreCarte, marginBottom: '18px' }}>Statut des ventes</div>
          {nb === 0 ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '40px 0' }}>Aucune vente sur la période.</p>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: '18px' }}>
              <Donut segments={statuts} centreValue={String(nb)} centreLabel="ventes" />
              <Legende segments={statuts} total={nb} />
            </div>
          )}
        </div>

        <div style={carte}>
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: '16px' }}>
            <div style={titreCarte}>Alertes de stock</div>
            <Link href="/admin/produits" style={{ fontSize: '13px', color: BLUE, fontWeight: 600, textDecoration: 'none' }}>Réapprovisionner</Link>
          </div>
          {alertes.length === 0 ? (
            <p style={{ color: MUTE, fontSize: '13px', textAlign: 'center', padding: '20px 0' }}>Aucune alerte : stock au vert.</p>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
              {alertes.map((p: any) => {
                const epuise = p.stock_restant <= 0;
                const col = epuise ? ROUGE : ORANGE;
                const bg = epuise ? 'rgba(210,68,68,.10)' : 'rgba(200,137,31,.12)';
                return (
                  <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '8px 4px' }}>
                    <div style={{ width: '36px', height: '36px', borderRadius: '11px', background: bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      <span className="ms" style={{ fontSize: '20px', color: col }}>{epuise ? 'error' : 'warning'}</span>
                    </div>
                    <div style={{ flex: 1, minWidth: 0, fontSize: '14px', fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nom}</div>
                    <span style={{ fontSize: '12px', fontWeight: 700, color: col, background: bg, padding: '5px 11px', borderRadius: '20px', whiteSpace: 'nowrap' }}>{epuise ? 'Épuisé' : `${p.stock_restant} restant${p.stock_restant > 1 ? 's' : ''}`}</span>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      </div>

      {/* Fenêtre de clôture */}
      {clotureOuverte && (
        <div onClick={() => !enCloture && setClotureOuverte(false)} style={{ position: 'fixed', inset: 0, background: 'rgba(15,23,42,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px', zIndex: 50 }}>
          <div onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Clôturer la période" style={{ ...carte, width: '100%', maxWidth: '440px', padding: '24px' }}>
            <div style={{ fontSize: '18px', fontWeight: 800, color: INK, marginBottom: '8px' }}>Clôturer la période ?</div>
            <p style={{ fontSize: '13.5px', color: '#5A6472', lineHeight: 1.5, margin: '0 0 16px' }}>
              Les compteurs du tableau de bord (chiffre d&apos;affaires, bénéfice, classements) repartent de zéro. <b>Aucune vente n&apos;est supprimée</b> : la période reste consultable dans le calendrier. Les dettes clients restent dues.
            </p>
            <label style={{ fontSize: '11px', fontWeight: 600, color: SOFT, letterSpacing: '.5px', textTransform: 'uppercase' }}>Nom de la période (facultatif)</label>
            <input value={nomPeriode} onChange={e => setNomPeriode(e.target.value)} maxLength={80} placeholder="Ex. : Fêtes de fin d'année"
              style={{ marginTop: '6px', height: '44px', padding: '0 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px', width: '100%' }} />
            {erreurCloture && <div style={{ marginTop: '10px', fontSize: '13px', color: ROUGE }}>{erreurCloture}</div>}
            <div style={{ display: 'flex', gap: '10px', marginTop: '18px', justifyContent: 'flex-end' }}>
              <button onClick={() => setClotureOuverte(false)} disabled={enCloture} style={{ height: '42px', padding: '0 16px', borderRadius: '12px', border: `1px solid ${LINE}`, background: '#fff', color: '#5A6472', fontWeight: 600, cursor: 'pointer' }}>Annuler</button>
              <button onClick={cloturer} disabled={enCloture} style={{ height: '42px', padding: '0 16px', borderRadius: '12px', border: 'none', background: ORANGE, color: '#fff', fontWeight: 700, cursor: 'pointer', opacity: enCloture ? 0.6 : 1 }}>{enCloture ? 'Clôture…' : 'Clôturer'}</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
