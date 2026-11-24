'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { toutLire, lireParIds } from '@/lib/requetes';
import { useBoutique } from '@/lib/boutique';

const fmt = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const VERT = '#1F9D6B', ORANGE = '#C8891F', ROUGE = '#D24444';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)' };
const BADGE_PAYE = { fontSize: '11px', fontWeight: 700, color: VERT, background: 'rgba(31,157,107,.12)', padding: '3px 9px', borderRadius: '20px', whiteSpace: 'nowrap' } as const;
const BADGE_RESTE = { fontSize: '11px', fontWeight: 700, color: ORANGE, background: 'rgba(200,137,31,.14)', padding: '3px 9px', borderRadius: '20px', whiteSpace: 'nowrap' } as const;

type Vue = 'periode' | 'mois' | 'semaine';
type Groupe = { id?: number; cle?: string; nom?: string; debut: string; fin: string | null; active?: boolean; nb: number; ca: number; encaisse: number; attente: number };
type Vente = { id: number; total: number; reste_a_payer: number; statut_paiement: string; date_vente: string; vendeuse: string; client: string };

const fmtDate = (s: string | Date) => new Date(s).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' });
// Les bornes viennent de la base au fuseau de la boutique : on affiche le jour
// local de la boutique, pas celui du navigateur.
const jourLocal = (s: string, tz: string, opts: Intl.DateTimeFormatOptions) => new Date(s).toLocaleDateString('fr-FR', { timeZone: tz, ...opts });

function titreGroupe(g: Groupe, vue: Vue, tz: string) {
  if (vue === 'periode') return g.nom || 'Période';
  if (vue === 'mois') { const t = jourLocal(g.debut, tz, { month: 'long', year: 'numeric' }); return t.charAt(0).toUpperCase() + t.slice(1); }
  return `Semaine du ${jourLocal(g.debut, tz, { day: '2-digit', month: 'long', year: 'numeric' })}`;
}

async function lireGroupes(vue: Vue) {
  const { data, error } = await supabase.rpc('calendrier_ventes', { p_vue: vue });
  return { groupes: (data || []) as Groupe[], erreur: error?.message || '' };
}

export default function AdminCalendrier() {
  const boutique = useBoutique();
  const dev = boutique?.devise || 'FCFA';
  const tz = boutique?.fuseau_horaire || 'Africa/Douala';
  const [vue, setVue] = useState<Vue>('periode');
  const [groupes, setGroupes] = useState<Groupe[]>([]);
  const [erreur, setErreur] = useState('');
  const [chargement, setChargement] = useState(true);
  const [ouvert, setOuvert] = useState<string | null>(null);
  const [detail, setDetail] = useState<Vente[]>([]);
  const [chargementDetail, setChargementDetail] = useState(false);
  const [renommage, setRenommage] = useState<{ id: number; nom: string } | null>(null);
  const [erreurNom, setErreurNom] = useState('');

  useEffect(() => {
    let annule = false;
    lireGroupes(vue).then(r => { if (!annule) { setGroupes(r.groupes); setErreur(r.erreur); setChargement(false); } });
    return () => { annule = true; };
  }, [vue]);

  const changerVue = (v: Vue) => { if (v === vue) return; setChargement(true); setOuvert(null); setVue(v); };

  const cleDe = (g: Groupe) => `${vue}-${g.id ?? g.cle}`;

  const basculer = async (g: Groupe) => {
    const cle = cleDe(g);
    if (ouvert === cle) { setOuvert(null); return; }
    setOuvert(cle); setDetail([]); setChargementDetail(true);
    try {
      const ventes = await toutLire(() => {
        let r = supabase.from('ventes').select('id, total, reste_a_payer, statut_paiement, date_vente, vendeuse_id, cliente_id')
          .eq('annulee', false).gte('date_vente', g.debut);
        if (g.fin) r = r.lt('date_vente', g.fin);
        return r.order('date_vente', { ascending: false }).order('id', { ascending: false });
      });
      const [users, clients] = await Promise.all([
        lireParIds('utilisateurs', 'id, nom', 'id', ventes.map((v: any) => v.vendeuse_id)),
        lireParIds('clientes', 'id, nom', 'id', ventes.map((v: any) => v.cliente_id)),
      ]);
      const nomU = new Map(users.map((u: any) => [u.id, u.nom]));
      const nomC = new Map(clients.map((c: any) => [c.id, c.nom]));
      setDetail(ventes.map((v: any) => ({ ...v, vendeuse: nomU.get(v.vendeuse_id) || '—', client: nomC.get(v.cliente_id) || 'Client de passage' })));
    } catch (e: any) {
      setErreur(`Détail indisponible : ${e?.message || e}`);
    }
    setChargementDetail(false);
  };

  const renommer = async () => {
    if (!renommage) return;
    setErreurNom('');
    const { error } = await supabase.rpc('renommer_periode', { p_id: renommage.id, p_nom: renommage.nom });
    if (error) { setErreurNom(error.message); return; }
    setRenommage(null);
    const r = await lireGroupes(vue); setGroupes(r.groupes);
  };

  const ONGLETS: { cle: Vue; label: string; icon: string }[] = [
    { cle: 'periode', label: 'Par période', icon: 'event_available' },
    { cle: 'mois', label: 'Par mois', icon: 'calendar_month' },
    { cle: 'semaine', label: 'Par semaine', icon: 'date_range' },
  ];

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', gap: '8px', marginBottom: '20px', flexWrap: 'wrap' }}>
        {ONGLETS.map(o => {
          const actif = vue === o.cle;
          return (
            <button key={o.cle} onClick={() => changerVue(o.cle)}
              style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '44px', padding: '0 16px', borderRadius: '13px', cursor: 'pointer', fontSize: '13.5px', fontWeight: 700, background: actif ? '#EEF3FC' : '#fff', color: actif ? BLUE : SOFT, border: `1px solid ${actif ? '#C9D9F8' : LINE}` }}>
              <span className="ms" style={{ fontSize: '19px' }}>{o.icon}</span>{o.label}
            </button>
          );
        })}
      </div>

      {vue === 'periode' && (
        <p style={{ fontSize: '13px', color: MUTE, margin: '-8px 0 16px' }}>
          Une nouvelle période commence chaque fois que vous cliquez « Clôturer et remettre à zéro » sur le tableau de bord.
        </p>
      )}
      {erreur && <div style={{ ...carte, padding: '14px 18px', marginBottom: '14px', color: ROUGE, fontSize: '13.5px' }}>{erreur}</div>}

      {chargement ? (
        <div style={{ textAlign: 'center', padding: '60px', color: MUTE }}>Chargement…</div>
      ) : groupes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '80px', color: MUTE }}>
          <span className="ms" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: '#C9D9F8' }}>calendar_month</span>
          Aucune vente pour le moment.
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: '12px' }}>
          {groupes.map(g => {
            const cle = cleDe(g);
            const estOuvert = ouvert === cle;
            const sous = vue === 'periode'
              ? `${fmtDate(g.debut)} — ${g.fin ? fmtDate(g.fin) : 'en cours'}`
              : '';
            return (
              <div key={cle} style={{ ...carte, overflow: 'hidden', borderColor: g.active ? '#C9D9F8' : LINE }}>
                <button onClick={() => basculer(g)} aria-expanded={estOuvert}
                  style={{ width: '100%', display: 'flex', alignItems: 'center', gap: '14px', padding: '16px 20px', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
                      <span style={{ fontSize: '15px', fontWeight: 700, color: INK }}>{titreGroupe(g, vue, tz)}</span>
                      {g.active && <span style={{ fontSize: '10.5px', fontWeight: 700, color: BLUE, background: '#EEF3FC', padding: '2px 8px', borderRadius: '20px' }}>EN COURS</span>}
                    </div>
                    <div style={{ fontSize: '12px', color: MUTE, marginTop: '2px' }}>{sous ? `${sous} · ` : ''}{Number(g.nb)} vente{Number(g.nb) > 1 ? 's' : ''}</div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ fontSize: '16px', fontWeight: 800, color: INK }}>{fmt(g.ca)} <span style={{ fontSize: '11px', color: BLUE }}>{dev}</span></div>
                    {Number(g.attente) > 0 && <div style={{ fontSize: '11.5px', color: ORANGE, fontWeight: 600 }}>reste {fmt(g.attente)}</div>}
                  </div>
                  <span className="ms" style={{ fontSize: '22px', color: MUTE, transform: estOuvert ? 'rotate(180deg)' : 'none', transition: 'transform .2s' }}>expand_more</span>
                </button>

                {estOuvert && (
                  <div style={{ borderTop: '1px solid #F1F4FA', padding: '8px 12px 12px' }}>
                    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '8px', margin: '8px 4px 12px' }}>
                      {[{ l: 'Chiffre', v: g.ca, c: INK }, { l: 'Encaissé', v: g.encaisse, c: VERT }, { l: 'Reste dû', v: g.attente, c: ORANGE }].map(s => (
                        <div key={s.l} style={{ textAlign: 'center', padding: '10px 6px', borderRadius: '12px', background: '#F6F8FC', border: `1px solid ${LINE}` }}>
                          <div style={{ fontSize: '15px', fontWeight: 800, color: s.c }}>{fmt(s.v)}</div>
                          <div style={{ fontSize: '10px', color: MUTE, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '.3px' }}>{s.l}</div>
                        </div>
                      ))}
                    </div>

                    {vue === 'periode' && g.id !== undefined && (
                      renommage?.id === g.id ? (
                        <div style={{ display: 'flex', gap: '8px', margin: '0 4px 12px', flexWrap: 'wrap' }}>
                          <input value={renommage.nom} onChange={e => setRenommage({ id: g.id!, nom: e.target.value })} maxLength={80} aria-label="Nom de la période"
                            style={{ flex: 1, minWidth: '160px', height: '38px', padding: '0 12px', borderRadius: '10px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px' }} />
                          <button onClick={renommer} style={{ height: '38px', padding: '0 14px', borderRadius: '10px', border: 'none', background: BLUE, color: '#fff', fontWeight: 700, cursor: 'pointer' }}>Enregistrer</button>
                          <button onClick={() => { setRenommage(null); setErreurNom(''); }} style={{ height: '38px', padding: '0 12px', borderRadius: '10px', border: `1px solid ${LINE}`, background: '#fff', color: '#5A6472', fontWeight: 600, cursor: 'pointer' }}>Annuler</button>
                          {erreurNom && <div style={{ width: '100%', fontSize: '12.5px', color: ROUGE }}>{erreurNom}</div>}
                        </div>
                      ) : (
                        <button onClick={() => { setErreurNom(''); setRenommage({ id: g.id!, nom: g.nom || '' }); }}
                          style={{ display: 'flex', alignItems: 'center', gap: '5px', margin: '0 4px 12px', fontSize: '12.5px', fontWeight: 600, color: BLUE, background: '#EEF3FC', border: 'none', borderRadius: '9px', padding: '6px 12px', cursor: 'pointer' }}>
                          <span className="ms" style={{ fontSize: '15px' }}>edit</span>Renommer
                        </button>
                      )
                    )}

                    {chargementDetail ? (
                      <div style={{ textAlign: 'center', padding: '16px', color: MUTE, fontSize: '13px' }}>Chargement…</div>
                    ) : detail.length === 0 ? (
                      <div style={{ textAlign: 'center', padding: '16px', color: MUTE, fontSize: '13px' }}>Aucune vente.</div>
                    ) : (
                      <div style={{ display: 'flex', flexDirection: 'column', gap: '6px', maxHeight: '380px', overflowY: 'auto' }}>
                        {detail.map(v => (
                          <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '12px', padding: '10px 12px', borderRadius: '11px', background: '#F6F8FC' }}>
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: '13.5px', fontWeight: 600, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{v.client}</div>
                              <div style={{ fontSize: '11.5px', color: MUTE }}>n° {v.id} · {new Date(v.date_vente).toLocaleString('fr-FR', { timeZone: tz, day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' })} · {v.vendeuse}</div>
                            </div>
                            <div style={{ fontSize: '13.5px', fontWeight: 700, color: INK, whiteSpace: 'nowrap' }}>{fmt(v.total)}</div>
                            <span style={v.statut_paiement === 'paye' ? BADGE_PAYE : BADGE_RESTE}>{v.statut_paiement === 'paye' ? 'Payé' : `Reste ${fmt(v.reste_a_payer)}`}</span>
                          </div>
                        ))}
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
