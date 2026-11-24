'use client';
import { useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useBoutique, SEUIL_STOCK_BAS_DEFAUT } from '@/lib/boutique';
import {
  aujourdhui, minuitLocal, decalerJour, debutMois, fmtDate, slug, lireVentes, lireDetails, agreger,
  feuillesPeriode, feuilleStock, feuilleDettes, feuilleMouvements, feuilleJournal, telechargerExcel, telechargerPdf,
  type Bornes, type Vente,
} from '@/lib/rapports';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const VERT = '#1F9D6B', ORANGE = '#C8891F', ROUGE = '#D24444';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)' };
const champ: React.CSSProperties = { height: '42px', padding: '0 12px', borderRadius: '12px', background: '#fff', border: '1px solid #E4E9F2', color: INK, fontSize: '14px', outline: 'none' };

type Periode = { id: number; nom: string; debut: string; fin: string | null };
type Choix = 'periode' | 'mois' | 'mois_prec' | 'jour' | '7j' | 'dates' | 'tout' | `p${number}`;

export default function AdminRapports() {
  const boutique = useBoutique();
  const dev = boutique?.devise || 'FCFA';
  const tz = boutique?.fuseau_horaire || 'Africa/Douala';
  const nomBoutique = boutique?.nom || 'Ma boutique';

  const [periodes, setPeriodes] = useState<Periode[]>([]);
  const [choix, setChoix] = useState<Choix>('periode');
  const [du, setDu] = useState('');
  const [au, setAu] = useState('');
  const [ventes, setVentes] = useState<Vente[]>([]);
  const [chargeePour, setChargeePour] = useState<string | null>(null);
  const [enCours, setEnCours] = useState<string | null>(null);
  const [erreur, setErreur] = useState('');

  useEffect(() => {
    let annule = false;
    supabase.from('periodes').select('id, nom, debut, fin').order('debut', { ascending: false })
      .then(({ data }) => { if (!annule) setPeriodes((data || []) as Periode[]); });
    return () => { annule = true; };
  }, []);

  // Bornes [debut, fin) de la selection, au fuseau de la boutique.
  const bornes: Bornes | null = useMemo(() => {
    const auj = aujourdhui(tz);
    const iso = (ymd: string) => minuitLocal(ymd, tz).toISOString();
    const plageJours = (a: string, b: string) => `${fmtDate(minuitLocal(a, tz), tz)} — ${fmtDate(minuitLocal(b, tz), tz)}`;
    const active = periodes.find(p => !p.fin);
    switch (choix) {
      case 'periode':
        if (!active) return null;
        return { debut: active.debut, fin: null, libelle: active.nom === 'Période en cours' ? 'Période en cours' : active.nom, plage: `depuis le ${fmtDate(active.debut, tz)}` };
      case 'jour': return { debut: iso(auj), fin: iso(decalerJour(auj, 1)), libelle: "Aujourd'hui", plage: fmtDate(minuitLocal(auj, tz), tz) };
      case '7j': return { debut: iso(decalerJour(auj, -6)), fin: iso(decalerJour(auj, 1)), libelle: '7 derniers jours', plage: plageJours(decalerJour(auj, -6), auj) };
      case 'mois': {
        const d = debutMois(auj);
        const nom = minuitLocal(d, tz).toLocaleDateString('fr-FR', { timeZone: tz, month: 'long', year: 'numeric' });
        return { debut: iso(d), fin: iso(debutMois(auj, 1)), libelle: nom.charAt(0).toUpperCase() + nom.slice(1), plage: plageJours(d, auj) };
      }
      case 'mois_prec': {
        const d = debutMois(auj, -1), f = debutMois(auj);
        const nom = minuitLocal(d, tz).toLocaleDateString('fr-FR', { timeZone: tz, month: 'long', year: 'numeric' });
        return { debut: iso(d), fin: iso(f), libelle: nom.charAt(0).toUpperCase() + nom.slice(1), plage: plageJours(d, decalerJour(f, -1)) };
      }
      case 'dates':
        if (!du || !au || au < du) return null;
        return { debut: iso(du), fin: iso(decalerJour(au, 1)), libelle: du === au ? `Journée du ${fmtDate(minuitLocal(du, tz), tz)}` : `Du ${fmtDate(minuitLocal(du, tz), tz)} au ${fmtDate(minuitLocal(au, tz), tz)}`, plage: plageJours(du, au) };
      case 'tout': return { debut: null, fin: null, libelle: 'Toute l\'activité', plage: 'toutes les ventes' };
      default: {
        const p = periodes.find(x => `p${x.id}` === choix);
        if (!p) return null;
        return { debut: p.debut, fin: p.fin, libelle: p.nom, plage: `${fmtDate(p.debut, tz)} — ${p.fin ? fmtDate(p.fin, tz) : 'en cours'}` };
      }
    }
  }, [choix, du, au, periodes, tz]);

  const cleBornes = bornes ? `${bornes.debut}|${bornes.fin}` : '';
  useEffect(() => {
    if (!bornes) return;
    let annule = false;
    lireVentes(bornes)
      .then(v => { if (!annule) { setVentes(v); setErreur(''); setChargeePour(cleBornes); } })
      .catch(e => { if (!annule) { setVentes([]); setErreur(`Lecture impossible : ${e?.message || e}`); setChargeePour(cleBornes); } });
    return () => { annule = true; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cleBornes]);

  const chargement = chargeePour !== cleBornes;

  const valides = ventes.filter(v => !v.annulee);
  const ca = valides.reduce((a, v) => a + Number(v.total), 0);
  const encaisse = valides.reduce((a, v) => a + Number(v.montant_paye), 0);
  const reste = valides.reduce((a, v) => a + Number(v.reste_a_payer), 0);
  const nbAnnulees = ventes.length - valides.length;
  const suffixe = bornes ? slug(`${bornes.libelle}`) : 'rapport';

  // Chaque export affiche son etat et ses erreurs sans bloquer les autres.
  const lancer = async (cle: string, f: () => Promise<void>) => {
    setEnCours(cle); setErreur('');
    try { await f(); } catch (e: any) { setErreur(`Export impossible : ${e?.message || e}`); }
    setEnCours(null);
  };

  const exportPdf = () => lancer('pdf', async () => {
    if (!bornes) return;
    const d = await lireDetails(bornes, ventes);
    const a = agreger(ventes, d);
    const { data: dettes } = await supabase.from('ventes').select('reste_a_payer').eq('annulee', false).gt('reste_a_payer', 0);
    const dette = (dettes || []).reduce((s: number, v: any) => s + Number(v.reste_a_payer), 0);
    await telechargerPdf(bornes, a, dev, tz, nomBoutique, dette, `rapport_${slug(nomBoutique)}_${suffixe}.pdf`);
  });
  const exportExcel = () => lancer('excel', async () => {
    if (!bornes) return;
    const d = await lireDetails(bornes, ventes);
    await telechargerExcel(feuillesPeriode(bornes, ventes, d, agreger(ventes, d), dev, tz, nomBoutique), `rapport_${slug(nomBoutique)}_${suffixe}.xlsx`);
  });
  const exportStock = () => lancer('stock', async () => {
    await telechargerExcel(await feuilleStock(dev, boutique?.seuil_stock_bas ?? SEUIL_STOCK_BAS_DEFAUT), `stock_${slug(nomBoutique)}_${aujourdhui(tz)}.xlsx`);
  });
  const exportDettes = () => lancer('dettes', async () => {
    await telechargerExcel(await feuilleDettes(dev, tz), `dettes_clients_${slug(nomBoutique)}_${aujourdhui(tz)}.xlsx`);
  });
  const exportMouvements = () => lancer('mvts', async () => {
    if (!bornes) return;
    await telechargerExcel(await feuilleMouvements(bornes, tz), `mouvements_stock_${suffixe}.xlsx`);
  });
  const exportJournal = () => lancer('journal', async () => {
    if (!bornes) return;
    await telechargerExcel(await feuilleJournal(bornes, tz), `journal_${suffixe}.xlsx`);
  });

  const CARTES = [
    { cle: 'pdf', icon: 'picture_as_pdf', titre: 'Rapport de la période (PDF)', desc: "Synthèse prête à imprimer : chiffre d'affaires, bénéfice, vendeuses, produits, encaissements par mode, ventes annulées.", action: exportPdf, cta: 'Télécharger le PDF', principal: true, periode: true },
    { cle: 'excel', icon: 'table_view', titre: 'Rapport complet (Excel)', desc: 'Un classeur avec la synthèse, chaque vente, chaque article vendu (avec bénéfice), par vendeuse, par produit, les encaissements et les annulations.', action: exportExcel, cta: 'Télécharger Excel', periode: true },
    { cle: 'mvts', icon: 'swap_vert', titre: 'Mouvements de stock (Excel)', desc: 'Toutes les entrées et sorties de la période : ventes, réassorts, corrections, inventaires, avec qui et pourquoi.', action: exportMouvements, cta: 'Télécharger Excel', periode: true },
    { cle: 'journal', icon: 'shield', titre: 'Journal (Excel)', desc: 'Les actions sensibles de la période : annulations, retraits, crédits, codes faux, clôtures de caisse.', action: exportJournal, cta: 'Télécharger Excel', periode: true },
    { cle: 'stock', icon: 'inventory_2', titre: 'État du stock (Excel)', desc: "Stock actuel de chaque produit, alertes, prix d'achat, marge et valeur du stock (au prix de vente et d'achat).", action: exportStock, cta: 'Télécharger Excel', periode: false },
    { cle: 'dettes', icon: 'credit_card_clock', titre: 'Dettes clients (Excel)', desc: 'Tout ce qui reste à encaisser, par client et vente par vente, avec téléphone et ancienneté.', action: exportDettes, cta: 'Télécharger Excel', periode: false },
  ];

  const OPTIONS: [Choix, string][] = [
    ['periode', 'Période en cours'], ['jour', "Aujourd'hui"], ['7j', '7 derniers jours'], ['mois', 'Ce mois-ci'],
    ['mois_prec', 'Le mois dernier'], ['dates', 'Choisir des dates…'], ['tout', 'Toute l\'activité'],
  ];
  const passees = periodes.filter(p => p.fin);

  return (
    <div className="fade-up">
      {/* Choix de la période */}
      <div style={{ ...carte, padding: '16px 18px', marginBottom: '18px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
        <span className="ms" style={{ fontSize: '21px', color: BLUE }}>date_range</span>
        <label htmlFor="choix-periode" style={{ fontSize: '13.5px', fontWeight: 600, color: '#5A6472' }}>Période du rapport</label>
        <select id="choix-periode" value={choix} onChange={e => setChoix(e.target.value as Choix)} style={{ ...champ, fontWeight: 600, cursor: 'pointer', minWidth: '200px' }}>
          {OPTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
          {passees.length > 0 && (
            <optgroup label="Périodes clôturées">
              {passees.map(p => <option key={p.id} value={`p${p.id}`}>{p.nom} ({fmtDate(p.debut, tz)} — {fmtDate(p.fin!, tz)})</option>)}
            </optgroup>
          )}
        </select>
        {choix === 'dates' && (
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' }}>
            <input type="date" value={du} max={au || undefined} onChange={e => setDu(e.target.value)} aria-label="Du" style={champ} />
            <span style={{ color: MUTE }}>au</span>
            <input type="date" value={au} min={du || undefined} onChange={e => setAu(e.target.value)} aria-label="Au" style={champ} />
          </div>
        )}
        {bornes && <span style={{ fontSize: '12.5px', color: MUTE }}>{bornes.plage}</span>}
      </div>

      {erreur && <div style={{ ...carte, padding: '12px 18px', marginBottom: '16px', color: ROUGE, fontSize: '13.5px' }}>{erreur}</div>}

      {!bornes ? (
        <div style={{ ...carte, padding: '40px', textAlign: 'center', color: MUTE }}>{choix === 'dates' ? 'Choisissez la date de début et la date de fin.' : 'Chargement…'}</div>
      ) : (
        <>
          <div style={{ ...carte, display: 'flex', flexWrap: 'wrap', marginBottom: '20px' }}>
            {[
              { label: 'Ventes', value: chargement ? '…' : String(valides.length), unit: nbAnnulees ? `+ ${nbAnnulees} annulée${nbAnnulees > 1 ? 's' : ''}` : '', col: INK },
              { label: "Chiffre d'affaires", value: chargement ? '…' : fmt(ca), unit: dev, col: INK },
              { label: 'Payé à la vente', value: chargement ? '…' : fmt(encaisse), unit: dev, col: VERT },
              { label: 'Reste dû', value: chargement ? '…' : fmt(reste), unit: dev, col: ORANGE },
            ].map((s, i) => (
              <div key={s.label} style={{ flex: 1, minWidth: '160px', padding: '18px 22px', textAlign: 'center', borderLeft: i === 0 ? 'none' : '1px solid #F1F4FA' }}>
                <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', marginBottom: '6px' }}>{s.label}</div>
                <div style={{ fontSize: '21px', fontWeight: 800, color: s.col }}>{s.value} <span style={{ fontSize: '12px', color: s.label === 'Ventes' ? ROUGE : BLUE, fontWeight: 600 }}>{s.unit}</span></div>
              </div>
            ))}
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(270px,1fr))', gap: '18px' }}>
            {CARTES.map(c => {
              const occupe = enCours === c.cle;
              const bloque = enCours !== null || (c.periode && chargement);
              return (
                <div key={c.cle} style={{ ...carte, display: 'flex', flexDirection: 'column', padding: '22px', borderColor: c.principal ? '#C9D9F8' : LINE }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '12px' }}>
                    <div style={{ width: '46px', height: '46px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'center', background: c.principal ? '#EEF3FC' : 'rgba(31,157,107,.12)', flexShrink: 0 }}>
                      <span className="ms" style={{ fontSize: '24px', color: c.principal ? BLUE : VERT }}>{c.icon}</span>
                    </div>
                    <div>
                      <div style={{ fontSize: '16px', fontWeight: 700, color: INK }}>{c.titre}</div>
                      <div style={{ fontSize: '11.5px', fontWeight: 600, color: c.periode ? BLUE : SOFT }}>{c.periode ? bornes.libelle : 'À la date du jour'}</div>
                    </div>
                  </div>
                  <div style={{ fontSize: '13px', lineHeight: 1.55, color: '#6B7688', marginBottom: '18px', flex: 1 }}>{c.desc}</div>
                  <button onClick={c.action} disabled={bloque}
                    style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '44px', border: c.principal ? 'none' : `1px solid ${LINE}`, borderRadius: '13px', cursor: bloque ? 'default' : 'pointer', background: c.principal ? GRAD : '#fff', color: c.principal ? '#fff' : INK, fontSize: '14px', fontWeight: 700, opacity: bloque && !occupe ? 0.55 : 1 }}>
                    <span className="ms" style={{ fontSize: '19px', color: c.principal ? '#fff' : VERT }}>{occupe ? 'hourglass_top' : 'download'}</span>{occupe ? 'Préparation…' : c.cta}
                  </button>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
