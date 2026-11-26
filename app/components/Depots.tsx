'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { lireBoutique, type Boutique } from '@/lib/boutique';
import { numeroWhatsApp } from '@/lib/activites';

// Pressing : depots de vetements. Toute l'equipe (vendeuses comprises) voit
// et traite tous les depots ; la base verifie tout (RPC depot_*).

const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const VERT = '#1F9D6B', ORANGE = '#C8891F', ROUGE = '#D24444';
const fmt = (n: number) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const carte: React.CSSProperties = { background: '#fff', borderRadius: '16px', border: `1px solid ${LINE}`, boxShadow: '0 4px 14px rgba(26,36,56,.04)' };
const inputStyle: React.CSSProperties = { height: '44px', padding: '0 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px', width: '100%' };
const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: SOFT, letterSpacing: '.5px', marginBottom: '6px', textTransform: 'uppercase' };
const bouton: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '38px', padding: '0 12px', borderRadius: '11px', cursor: 'pointer', border: 'none', fontSize: '13px', fontWeight: 700 };
const MODES: [string, string][] = [['cash', 'Espèces'], ['orange_money', 'Orange Money'], ['mobile_money', 'Mobile Money'], ['carte', 'Carte'], ['autre', 'Autre']];

const ETATS: Record<string, { nom: string; col: string; bg: string; icone: string }> = {
  depose:   { nom: 'Déposé',   col: SOFT,   bg: '#F1F4FA',               icone: 'inventory' },
  en_cours: { nom: 'En lavage', col: BLUE,  bg: '#EEF3FC',               icone: 'local_laundry_service' },
  pret:     { nom: 'Prêt',     col: VERT,   bg: 'rgba(31,157,107,.12)',  icone: 'check_circle' },
  retire:   { nom: 'Retiré',   col: MUTE,   bg: '#F4F6FA',               icone: 'done_all' },
};

type Ligne = { nom: string; quantite: number; prix: number };
type Depot = {
  id: number; numero: number; statut: string; date_retrait_prevue: string | null; note: string | null;
  cree_le: string; pret_le: string | null; retire_le: string | null; client: string; telephone: string | null;
  total: number; paye: number; reste: number; annulee: boolean; en_retard: boolean; oublie: boolean; lignes: Ligne[];
};
type Produit = { id: number; nom: string; prix: number; actif: boolean };

const dateCourte = (d?: string | null) => d ? new Date(d.length === 10 ? d + 'T12:00:00' : d).toLocaleDateString('fr-FR', { weekday: 'short', day: 'numeric', month: 'short' }) : '';
const dansJours = (n: number) => { const d = new Date(); d.setDate(d.getDate() + n); return d.toISOString().slice(0, 10); };
const echapper = (s: string) => s.replace(/[&<>"]/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]!));

function texteTicket(d: Depot, b: Boutique | null) {
  const dev = b?.devise || 'FCFA';
  return [
    `${b?.nom || 'Pressing'} — Ticket n° ${d.numero}`,
    `Client : ${d.client}`,
    `Déposé le ${dateCourte(d.cree_le)}${d.date_retrait_prevue ? ` · retrait prévu ${dateCourte(d.date_retrait_prevue)}` : ''}`,
    ...d.lignes.map(l => `${l.quantite} × ${l.nom} : ${fmt(l.quantite * l.prix)} ${dev}`),
    `Total : ${fmt(d.total)} ${dev} · Payé : ${fmt(d.paye)} ${dev} · Reste : ${fmt(d.reste)} ${dev}`,
    ...(d.note ? [`Note : ${d.note}`] : []),
    ...(b?.telephone ? [`Contact : ${b.telephone}`] : []),
  ].join('\n');
}

function imprimerTicket(d: Depot, b: Boutique | null) {
  const w = window.open('', '_blank', 'width=380,height=600');
  if (!w) return;
  const lignes = texteTicket(d, b).split('\n').map(l => `<div>${echapper(l)}</div>`).join('');
  w.document.write(`<!doctype html><html><head><meta charset="utf-8"><title>Ticket ${d.numero}</title>
    <style>body{font-family:Arial,sans-serif;font-size:13px;padding:14px;max-width:300px}div{margin:4px 0}.n{font-size:30px;font-weight:800;text-align:center;border:2px dashed #000;padding:8px;margin:10px 0}</style>
    </head><body><div class="n">N° ${d.numero}</div>${lignes}<script>window.onload=function(){window.print()}<\/script></body></html>`);
  w.document.close();
}

const lienWhatsApp = (tel: string | null, texte: string) => {
  const n = numeroWhatsApp(tel);
  return n ? `https://wa.me/${n}?text=${encodeURIComponent(texte)}` : null;
};

export default function Depots({ isMobile }: { isMobile: boolean }) {
  const [filtre, setFiltre] = useState<'actifs' | 'retires' | 'tous'>('actifs');
  const [recherche, setRecherche] = useState('');
  const [depots, setDepots] = useState<Depot[] | null>(null);
  const [boutique, setBoutique] = useState<Boutique | null>(null);
  const [produits, setProduits] = useState<Produit[]>([]);
  const [erreur, setErreur] = useState('');
  const [occupe, setOccupe] = useState<number | null>(null);
  const [nouveau, setNouveau] = useState(false);
  const [ticket, setTicket] = useState<Depot | null>(null);
  const [retrait, setRetrait] = useState<Depot | null>(null);

  const charger = useCallback(async () => {
    const { data, error } = await supabase.rpc('depots_liste', { p_filtre: filtre, p_recherche: recherche.trim() || null });
    if (error) { setErreur(error.message); setDepots([]); return; }
    setDepots((data as Depot[]) || []);
  }, [filtre, recherche]);

  useEffect(() => {
    const t = setTimeout(charger, recherche ? 300 : 0);
    return () => clearTimeout(t);
  }, [charger, recherche]);
  useEffect(() => {
    lireBoutique().then(setBoutique);
    supabase.from('produits').select('id, nom, prix, actif').eq('actif', true).order('nom').then(({ data }) => setProduits((data as Produit[]) || []));
  }, []);

  const changerEtat = async (d: Depot, statut: string) => {
    setOccupe(d.id); setErreur('');
    const { error } = await supabase.rpc('depot_statut', { p_id: d.id, p_statut: statut });
    setOccupe(null);
    if (error) { setErreur(error.message); return; }
    await charger();
  };

  const compte = useMemo(() => {
    const l = filtre === 'actifs' ? depots || [] : [];
    return { depose: l.filter(d => d.statut === 'depose').length, en_cours: l.filter(d => d.statut === 'en_cours').length,
             pret: l.filter(d => d.statut === 'pret').length, retard: l.filter(d => d.en_retard).length };
  }, [depots, filtre]);
  const dev = boutique?.devise || 'FCFA';

  return (
    <div style={{ padding: isMobile ? '16px' : '22px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Barre d'outils */}
      <div style={{ display: 'flex', gap: '10px', flexWrap: 'wrap', alignItems: 'center', marginBottom: '14px' }}>
        <button onClick={() => setNouveau(true)} style={{ ...bouton, height: '46px', padding: '0 20px', background: GRAD, color: '#fff', fontSize: '14.5px', boxShadow: '0 8px 18px rgba(37,99,235,.28)' }}>
          <span className="ms" style={{ fontSize: '21px' }}>add</span>Nouveau dépôt
        </button>
        <div style={{ display: 'flex', gap: '2px', background: '#EEF1F7', borderRadius: '12px', padding: '4px' }}>
          {([['actifs', 'En cours'], ['retires', 'Retirés'], ['tous', 'Tous']] as const).map(([k, l]) => (
            <button key={k} onClick={() => setFiltre(k)} style={{ ...bouton, height: '36px', background: filtre === k ? '#fff' : 'transparent', color: filtre === k ? BLUE : SOFT, boxShadow: filtre === k ? '0 1px 3px rgba(26,36,56,.12)' : 'none' }}>{l}</button>
          ))}
        </div>
        <div style={{ position: 'relative', flex: 1, minWidth: '200px', maxWidth: '360px' }}>
          <span className="ms" style={{ position: 'absolute', left: '12px', top: '50%', transform: 'translateY(-50%)', fontSize: '20px', color: MUTE }}>search</span>
          <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="N° de ticket (#12), nom ou téléphone" style={{ ...inputStyle, background: '#fff', paddingLeft: '40px' }} />
        </div>
      </div>

      {filtre === 'actifs' && depots && (
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          {[['Déposés', compte.depose, SOFT], ['En lavage', compte.en_cours, BLUE], ['Prêts à retirer', compte.pret, VERT], ['En retard', compte.retard, ROUGE]].map(([l, n, c]) => (
            <div key={l as string} style={{ ...carte, padding: '10px 14px', display: 'flex', alignItems: 'baseline', gap: '8px' }}>
              <span style={{ fontSize: '20px', fontWeight: 800, color: c as string }}>{n as number}</span>
              <span style={{ fontSize: '12.5px', color: SOFT, fontWeight: 600 }}>{l as string}</span>
            </div>
          ))}
        </div>
      )}

      {erreur && <div role="alert" style={{ padding: '10px 14px', borderRadius: '12px', background: 'rgba(210,68,68,.10)', border: '1px solid rgba(210,68,68,.25)', color: ROUGE, fontSize: '13.5px', marginBottom: '14px' }}>{erreur}</div>}

      {depots === null ? (
        <p style={{ color: MUTE, textAlign: 'center', padding: '50px 0' }}>Chargement…</p>
      ) : depots.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px 20px', color: MUTE }}>
          <span className="ms" style={{ fontSize: '48px', display: 'block', marginBottom: '10px', color: '#C6D2E8' }}>local_laundry_service</span>
          {recherche ? 'Aucun dépôt ne correspond.' : filtre === 'actifs' ? 'Aucun vêtement en cours. Cliquez sur « Nouveau dépôt ».' : 'Aucun dépôt.'}
        </div>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : 'repeat(auto-fill,minmax(340px,1fr))', gap: '12px' }}>
          {depots.map(d => {
            const e = d.annulee ? { nom: 'Annulé', col: ROUGE, bg: 'rgba(210,68,68,.10)', icone: 'block' } : ETATS[d.statut];
            const wa = lienWhatsApp(d.telephone, `Bonjour ${d.client}, vos vêtements (ticket n° ${d.numero}) sont prêts chez ${boutique?.nom || 'nous'}.${Number(d.reste) > 0 ? ` Reste à payer : ${fmt(d.reste)} ${dev}.` : ''} Merci !`);
            const actif = !d.annulee && d.statut !== 'retire';
            return (
              <div key={d.id} style={{ ...carte, padding: '14px 16px', borderColor: d.en_retard && actif ? 'rgba(210,68,68,.4)' : LINE }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '8px' }}>
                  <div style={{ fontSize: '20px', fontWeight: 800, color: INK, minWidth: '46px' }}>#{d.numero}</div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14.5px', fontWeight: 700, color: INK, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{d.client}</div>
                    <div style={{ fontSize: '12px', color: SOFT }}>{d.telephone}</div>
                  </div>
                  <span style={{ display: 'inline-flex', alignItems: 'center', gap: '4px', fontSize: '12px', fontWeight: 700, color: e.col, background: e.bg, padding: '4px 10px', borderRadius: '20px', whiteSpace: 'nowrap' }}>
                    <span className="ms" style={{ fontSize: '15px' }}>{e.icone}</span>{e.nom}
                  </span>
                </div>
                <div style={{ fontSize: '13px', color: '#5A6472', lineHeight: 1.5, marginBottom: '6px' }}>
                  {d.lignes.map(l => `${l.quantite} × ${l.nom}`).join(', ')}
                </div>
                {d.note && <div style={{ fontSize: '12.5px', color: ORANGE, marginBottom: '6px' }}>Note : {d.note}</div>}
                <div style={{ display: 'flex', flexWrap: 'wrap', gap: '4px 14px', fontSize: '12.5px', color: SOFT, marginBottom: '10px' }}>
                  <span>Déposé {dateCourte(d.cree_le)}</span>
                  {d.date_retrait_prevue && d.statut !== 'retire' && <span style={{ color: d.en_retard ? ROUGE : SOFT, fontWeight: d.en_retard ? 700 : 400 }}>{d.en_retard ? 'En retard · prévu ' : 'Retrait prévu '}{dateCourte(d.date_retrait_prevue)}</span>}
                  {d.retire_le && <span>Retiré {dateCourte(d.retire_le)}</span>}
                  {d.oublie && <span style={{ color: ROUGE, fontWeight: 700 }}>Pas récupéré depuis plus de 30 jours</span>}
                </div>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '12px', marginBottom: '12px' }}>
                  <span style={{ fontSize: '16px', fontWeight: 800, color: INK }}>{fmt(d.total)} {dev}</span>
                  {Number(d.reste) > 0
                    ? <span style={{ fontSize: '12.5px', fontWeight: 700, color: ORANGE }}>Reste {fmt(d.reste)} à payer</span>
                    : <span style={{ fontSize: '12.5px', fontWeight: 700, color: VERT }}>Payé</span>}
                </div>
                <div style={{ display: 'flex', gap: '6px', flexWrap: 'wrap' }}>
                  {actif && d.statut === 'depose' && (
                    <button disabled={occupe === d.id} onClick={() => changerEtat(d, 'en_cours')} style={{ ...bouton, background: '#EEF3FC', color: BLUE }}><span className="ms" style={{ fontSize: '17px' }}>local_laundry_service</span>En lavage</button>
                  )}
                  {actif && (d.statut === 'depose' || d.statut === 'en_cours') && (
                    <button disabled={occupe === d.id} onClick={() => changerEtat(d, 'pret')} style={{ ...bouton, background: 'rgba(31,157,107,.12)', color: VERT }}><span className="ms" style={{ fontSize: '17px' }}>check_circle</span>Prêt</button>
                  )}
                  {actif && d.statut === 'pret' && (
                    <button disabled={occupe === d.id} onClick={() => setRetrait(d)} style={{ ...bouton, background: GRAD, color: '#fff' }}><span className="ms" style={{ fontSize: '17px' }}>done_all</span>Remis au client</button>
                  )}
                  {actif && d.statut === 'pret' && wa && (
                    <a href={wa} target="_blank" rel="noopener noreferrer" style={{ ...bouton, background: 'rgba(37,211,102,.14)', color: '#128C4B', textDecoration: 'none' }}><span className="ms" style={{ fontSize: '17px' }}>chat</span>Prévenir</a>
                  )}
                  <button onClick={() => setTicket(d)} style={{ ...bouton, background: '#F1F4FA', color: '#5A6472' }}><span className="ms" style={{ fontSize: '17px' }}>receipt</span>Ticket</button>
                  {actif && d.statut === 'pret' && (
                    <button disabled={occupe === d.id} onClick={() => changerEtat(d, 'en_cours')} title="Remettre en lavage" style={{ ...bouton, width: '38px', padding: 0, background: '#F1F4FA', color: SOFT }}><span className="ms" style={{ fontSize: '17px' }}>undo</span></button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {nouveau && <NouveauDepot produits={produits} dev={dev} onFermer={() => setNouveau(false)} onCree={async (id) => {
        setNouveau(false);
        const { data } = await supabase.rpc('depots_liste', { p_filtre: 'tous', p_recherche: null });
        const d = ((data as Depot[]) || []).find(x => x.id === id) || null;
        setTicket(d); await charger();
      }} />}
      {ticket && <TicketModal d={ticket} b={boutique} onFermer={() => setTicket(null)} />}
      {retrait && <RetraitModal d={retrait} dev={dev} onFermer={() => setRetrait(null)} onFait={async () => { setRetrait(null); await charger(); }} />}
    </div>
  );
}

function Modal({ titre, onFermer, children, large }: { titre: string; onFermer: () => void; children: React.ReactNode; large?: boolean }) {
  return (
    <div onClick={onFermer} style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '32px 12px', zIndex: 100, overflowY: 'auto' }}>
      <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px', width: '100%', maxWidth: large ? '640px' : '440px', boxShadow: '0 24px 60px rgba(16,24,40,.28)' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '16px 20px', borderBottom: '1px solid #EEF2F8' }}>
          <div style={{ fontSize: '17px', fontWeight: 800, color: INK }}>{titre}</div>
          <button onClick={onFermer} aria-label="Fermer" style={{ width: '36px', height: '36px', borderRadius: '10px', border: 'none', background: '#F1F4FA', color: SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms" style={{ fontSize: '20px' }}>close</span></button>
        </div>
        <div style={{ padding: '18px 20px' }}>{children}</div>
      </div>
    </div>
  );
}

function NouveauDepot({ produits, dev, onFermer, onCree }: { produits: Produit[]; dev: string; onFermer: () => void; onCree: (id: number) => void }) {
  const [nom, setNom] = useState('');
  const [tel, setTel] = useState('');
  const [qte, setQte] = useState<Record<number, number>>({});
  const [acompte, setAcompte] = useState('');
  const [mode, setMode] = useState('cash');
  const [date, setDate] = useState(dansJours(2));
  const [note, setNote] = useState('');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');

  const total = produits.reduce((a, p) => a + (qte[p.id] || 0) * Number(p.prix), 0);
  const nbPieces = Object.values(qte).reduce((a, n) => a + n, 0);
  const ajuster = (id: number, d: number) => setQte(q => ({ ...q, [id]: Math.max(0, (q[id] || 0) + d) }));

  const valider = async () => {
    setErreur('');
    if (!nom.trim()) return setErreur('Le nom du client est obligatoire.');
    if (!tel.trim()) return setErreur('Le téléphone du client est obligatoire (pour le prévenir).');
    if (nbPieces === 0) return setErreur('Ajoutez au moins un vêtement.');
    const paye = acompte.trim() === '' ? 0 : Number(acompte);
    if (isNaN(paye) || paye < 0 || paye > total) return setErreur(`L'acompte doit être entre 0 et ${fmt(total)} ${dev}.`);
    setOccupe(true);
    const { data, error } = await supabase.rpc('depot_creer', {
      p_cliente_nom: nom.trim(), p_cliente_telephone: tel.trim(),
      p_produits: Object.entries(qte).filter(([, n]) => n > 0).map(([id, n]) => ({ produit_id: Number(id), quantite: n })),
      p_montant_paye: paye, p_mode_paiement: mode, p_date_retrait: date || null, p_note: note.trim() || null,
    });
    setOccupe(false);
    if (error) return setErreur(error.message);
    onCree((data as { id: number }).id);
  };

  return (
    <Modal titre="Nouveau dépôt" onFermer={onFermer} large>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(180px,1fr))', gap: '12px', marginBottom: '14px' }}>
        <div><div style={labelStyle}>Nom du client *</div><input autoFocus style={inputStyle} value={nom} onChange={e => setNom(e.target.value)} placeholder="Ex. Bella" /></div>
        <div><div style={labelStyle}>Téléphone *</div><input style={inputStyle} type="tel" value={tel} onChange={e => setTel(e.target.value)} placeholder="Ex. 677 12 34 56" /></div>
      </div>
      <div style={labelStyle}>Vêtements</div>
      {produits.length === 0 ? (
        <p style={{ fontSize: '13px', color: SOFT }}>Aucun service. Ajoutez vos prix dans le menu « Services & prix ».</p>
      ) : (
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: '8px', marginBottom: '14px' }}>
          {produits.map(p => {
            const n = qte[p.id] || 0;
            return (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 10px', borderRadius: '12px', border: `1px solid ${n ? 'rgba(37,99,235,.45)' : LINE}`, background: n ? '#F5F8FF' : '#fff' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: INK, lineHeight: 1.2 }}>{p.nom}</div>
                  <div style={{ fontSize: '11.5px', color: BLUE, fontWeight: 700 }}>{fmt(p.prix)}</div>
                </div>
                {n > 0 && <button onClick={() => ajuster(p.id, -1)} aria-label={`Retirer ${p.nom}`} style={{ ...bouton, width: '30px', height: '30px', padding: 0, background: '#EEF3FC', color: BLUE }}><span className="ms" style={{ fontSize: '16px' }}>remove</span></button>}
                {n > 0 && <span style={{ fontSize: '14px', fontWeight: 800, color: INK, minWidth: '16px', textAlign: 'center' }}>{n}</span>}
                <button onClick={() => ajuster(p.id, 1)} aria-label={`Ajouter ${p.nom}`} style={{ ...bouton, width: '30px', height: '30px', padding: 0, background: GRAD, color: '#fff' }}><span className="ms" style={{ fontSize: '16px' }}>add</span></button>
              </div>
            );
          })}
        </div>
      )}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', padding: '10px 14px', borderRadius: '12px', background: '#F6F8FC', marginBottom: '14px' }}>
        <span style={{ fontSize: '13px', color: SOFT }}>{nbPieces} pièce{nbPieces > 1 ? 's' : ''}</span>
        <span style={{ fontSize: '18px', fontWeight: 800, color: INK }}>{fmt(total)} {dev}</span>
      </div>
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(150px,1fr))', gap: '12px', marginBottom: '12px' }}>
        <div><div style={labelStyle}>Payé maintenant</div><input style={inputStyle} type="number" min={0} value={acompte} onChange={e => setAcompte(e.target.value)} placeholder="0 (paie au retrait)" /></div>
        <div><div style={labelStyle}>Mode</div><select style={inputStyle} value={mode} onChange={e => setMode(e.target.value)}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
        <div><div style={labelStyle}>Retrait prévu</div><input style={inputStyle} type="date" value={date} onChange={e => setDate(e.target.value)} /></div>
      </div>
      <div style={{ marginBottom: '14px' }}><div style={labelStyle}>Note (tache, bouton manquant…)</div><input style={inputStyle} maxLength={300} value={note} onChange={e => setNote(e.target.value)} placeholder="Facultatif" /></div>
      {erreur && <div role="alert" style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(210,68,68,.10)', color: ROUGE, fontSize: '13px', marginBottom: '12px' }}>{erreur}</div>}
      <button onClick={valider} disabled={occupe} style={{ ...bouton, width: '100%', height: '48px', background: GRAD, color: '#fff', fontSize: '15px', opacity: occupe ? 0.7 : 1 }}>
        {occupe ? 'Enregistrement…' : `Enregistrer le dépôt · ${fmt(total)} ${dev}`}
      </button>
    </Modal>
  );
}

function TicketModal({ d, b, onFermer }: { d: Depot; b: Boutique | null; onFermer: () => void }) {
  const wa = lienWhatsApp(d.telephone, texteTicket(d, b));
  return (
    <Modal titre={`Ticket n° ${d.numero}`} onFermer={onFermer}>
      <div style={{ textAlign: 'center', fontSize: '40px', fontWeight: 800, color: INK, border: `2px dashed ${LINE}`, borderRadius: '14px', padding: '10px', marginBottom: '14px' }}>N° {d.numero}</div>
      <pre style={{ whiteSpace: 'pre-wrap', fontFamily: 'inherit', fontSize: '13px', color: '#5A6472', lineHeight: 1.6, margin: '0 0 16px' }}>{texteTicket(d, b)}</pre>
      <p style={{ fontSize: '12.5px', color: SOFT, margin: '0 0 12px' }}>Écrivez aussi le n° {d.numero} sur une étiquette attachée aux vêtements.</p>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <button onClick={() => imprimerTicket(d, b)} style={{ ...bouton, flex: 1, height: '44px', background: '#EEF3FC', color: BLUE }}><span className="ms" style={{ fontSize: '18px' }}>print</span>Imprimer</button>
        {wa && <a href={wa} target="_blank" rel="noopener noreferrer" style={{ ...bouton, flex: 1, height: '44px', background: 'rgba(37,211,102,.14)', color: '#128C4B', textDecoration: 'none' }}><span className="ms" style={{ fontSize: '18px' }}>chat</span>Envoyer par WhatsApp</a>}
      </div>
    </Modal>
  );
}

function RetraitModal({ d, dev, onFermer, onFait }: { d: Depot; dev: string; onFermer: () => void; onFait: () => void }) {
  const [mode, setMode] = useState('cash');
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const reste = Number(d.reste) || 0;
  const valider = async () => {
    setOccupe(true); setErreur('');
    const { error } = await supabase.rpc('depot_retirer', { p_id: d.id, p_mode: mode });
    setOccupe(false);
    if (error) return setErreur(error.message);
    onFait();
  };
  return (
    <Modal titre={`Remettre le n° ${d.numero}`} onFermer={onFermer}>
      <p style={{ fontSize: '14px', color: INK, margin: '0 0 12px' }}>
        <b>{d.client}</b> récupère : {d.lignes.map(l => `${l.quantite} × ${l.nom}`).join(', ')}.
      </p>
      {reste > 0 ? (
        <>
          <div style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(200,137,31,.12)', color: '#8A5A00', fontSize: '14px', marginBottom: '12px' }}>
            Encaissez le reste : <b style={{ fontSize: '18px' }}>{fmt(reste)} {dev}</b>
          </div>
          <div style={{ marginBottom: '14px' }}><div style={labelStyle}>Mode de paiement</div>
            <select style={inputStyle} value={mode} onChange={e => setMode(e.target.value)}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          </div>
        </>
      ) : (
        <div style={{ padding: '12px 14px', borderRadius: '12px', background: 'rgba(31,157,107,.12)', color: VERT, fontSize: '14px', fontWeight: 700, marginBottom: '14px' }}>Déjà payé en entier.</div>
      )}
      {erreur && <div role="alert" style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(210,68,68,.10)', color: ROUGE, fontSize: '13px', marginBottom: '12px' }}>{erreur}</div>}
      <button onClick={valider} disabled={occupe} style={{ ...bouton, width: '100%', height: '48px', background: GRAD, color: '#fff', fontSize: '15px', opacity: occupe ? 0.7 : 1 }}>
        {occupe ? 'Un instant…' : reste > 0 ? `Encaisser ${fmt(reste)} ${dev} et remettre` : 'Confirmer la remise'}
      </button>
    </Modal>
  );
}
