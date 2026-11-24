'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { lireParIds } from '@/lib/requetes';
import { signalerAuPatron } from '../../components/ValidationGerant';

// Panneau stock d'un produit (repris de Fallora) : reassort, correction avec
// motif, et historique des mouvements (trace par la base, rien n'y echappe).

const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';

const TYPES: Record<string, { label: string; icone: string }> = {
  ouverture: { label: 'Stock de départ', icone: 'flag' },
  creation: { label: 'Création du produit', icone: 'add_box' },
  vente: { label: 'Vente', icone: 'shopping_bag' },
  facture: { label: 'Facture (table)', icone: 'receipt_long' },
  annulation: { label: 'Annulation', icone: 'undo' },
  reappro: { label: 'Réassort', icone: 'local_shipping' },
  correction: { label: 'Correction', icone: 'tune' },
  inventaire: { label: 'Inventaire', icone: 'fact_check' },
  manuel: { label: 'Modifié hors de l\'application', icone: 'warning' },
};

const champ: React.CSSProperties = { height: '42px', padding: '0 12px', borderRadius: '11px', background: '#fff', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px' };

type Mouvement = { id: number; type: string; quantite: number; stock_apres: number; vente_id: number | null; facture_id: number | null; motif: string | null; cree_le: string; auteur: string | null };

export default function PanneauStock({ produit, onModifie }: {
  produit: { id: number; nom: string; stock_restant: number };
  onModifie: () => Promise<void> | void;
}) {
  const [mode, setMode] = useState<'reappro' | 'correction'>('reappro');
  const [quantite, setQuantite] = useState('');
  const [note, setNote] = useState('');
  const [envoi, setEnvoi] = useState(false);
  const [erreur, setErreur] = useState('');
  const [succes, setSucces] = useState('');
  const [mouvements, setMouvements] = useState<Mouvement[] | null>(null);
  const [version, setVersion] = useState(0);

  useEffect(() => {
    let annule = false;
    (async () => {
      const { data, error } = await supabase.from('mouvements_stock')
        .select('id, type, quantite, stock_apres, vente_id, facture_id, motif, cree_le, utilisateur_id')
        .eq('produit_id', produit.id).order('cree_le', { ascending: false }).order('id', { ascending: false }).limit(60);
      if (annule) return;
      if (error) { setErreur(`Historique indisponible : ${error.message}`); setMouvements([]); return; }
      const users = await lireParIds<any>('utilisateurs', 'id, nom', 'id', (data || []).map((m: any) => m.utilisateur_id));
      if (annule) return;
      const noms = new Map(users.map(u => [u.id, u.nom]));
      setMouvements((data || []).map((m: any) => ({ ...m, auteur: noms.get(m.utilisateur_id) || null })));
    })();
    return () => { annule = true; };
  }, [produit.id, version]);

  const valider = async () => {
    const n = Number(quantite);
    setErreur(''); setSucces('');
    if (quantite.trim() === '' || !Number.isInteger(n)) { setErreur('Entrez un nombre entier.'); return; }
    if (mode === 'reappro' && n <= 0) { setErreur('La quantité reçue doit être supérieure à 0.'); return; }
    if (mode === 'correction' && n < 0) { setErreur('Le stock compté ne peut pas être négatif.'); return; }
    if (mode === 'correction' && !note.trim()) { setErreur('Indiquez le motif (inventaire, casse, perte…).'); return; }
    setEnvoi(true);
    const { data, error } = mode === 'reappro'
      ? await supabase.rpc('reapprovisionner', { p_produit_id: produit.id, p_quantite: n, p_note: note.trim() })
      : await supabase.rpc('corriger_stock', { p_produit_id: produit.id, p_stock_reel: n, p_motif: note.trim() });
    setEnvoi(false);
    if (error) { setErreur(error.message); return; }
    if (mode === 'reappro') setSucces(`+${n} ajouté${n > 1 ? 's' : ''}. Stock : ${data?.stock_restant ?? '—'}.`);
    else {
      const ecart = Number(data?.ecart) || 0;
      setSucces(ecart === 0 ? 'Stock confirmé, aucun écart.' : `Écart de ${ecart > 0 ? '+' : ''}${ecart} enregistré. Stock : ${n}.`);
      if (ecart !== 0) signalerAuPatron();
    }
    setQuantite(''); setNote('');
    setVersion(v => v + 1);
    await onModifie();
  };

  return (
    <div style={{ padding: '16px', borderRadius: '14px', background: '#FBFCFE', border: `1px solid ${LINE}` }}>
      <div style={{ display: 'flex', gap: '6px', marginBottom: '12px', flexWrap: 'wrap' }}>
        {([['reappro', 'local_shipping', 'Réassort (livraison reçue)'], ['correction', 'tune', 'Correction (casse, perte, comptage)']] as const).map(([val, icone, label]) => (
          <button key={val} onClick={() => { setMode(val); setErreur(''); setSucces(''); setQuantite(''); }} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '36px', padding: '0 14px', borderRadius: '18px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, border: mode === val ? 'none' : `1px solid ${LINE}`, background: mode === val ? BLUE : '#fff', color: mode === val ? '#fff' : SOFT }}>
            <span className="ms" style={{ fontSize: '17px' }}>{icone}</span>{label}
          </button>
        ))}
      </div>
      <div style={{ fontSize: '12.5px', color: SOFT, marginBottom: '8px' }}>
        {mode === 'reappro'
          ? `Stock actuel : ${produit.stock_restant}. Tapez la quantité reçue : elle s'ajoute au stock.`
          : `Fallik compte ${produit.stock_restant}. Tapez ce que vous avez réellement ; l'écart est enregistré avec son motif et signalé au patron.`}
      </div>
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        <input type="number" inputMode="numeric" min={0} value={quantite} onChange={e => setQuantite(e.target.value)} placeholder={mode === 'reappro' ? 'Quantité reçue' : 'Stock compté'} aria-label={mode === 'reappro' ? 'Quantité reçue' : 'Stock compté'} style={{ ...champ, width: '150px' }} />
        <input value={note} onChange={e => setNote(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') valider(); }} placeholder={mode === 'reappro' ? 'Note (fournisseur, bon de livraison…) — optionnel' : 'Motif (obligatoire) : casse, perte, inventaire…'} aria-label="Note ou motif" style={{ ...champ, flex: 1, minWidth: '200px' }} />
        <button onClick={valider} disabled={envoi} style={{ height: '42px', padding: '0 18px', borderRadius: '11px', cursor: 'pointer', border: 'none', background: GRAD, color: '#fff', fontSize: '13.5px', fontWeight: 700, opacity: envoi ? 0.7 : 1 }}>
          {envoi ? 'Enregistrement…' : mode === 'reappro' ? 'Ajouter au stock' : 'Corriger le stock'}
        </button>
      </div>
      {erreur && <div role="alert" style={{ fontSize: '12.5px', color: '#D24444', marginTop: '8px' }}>{erreur}</div>}
      {succes && <div style={{ fontSize: '12.5px', color: '#1F9D6B', fontWeight: 600, marginTop: '8px' }}>{succes}</div>}

      <div style={{ fontSize: '11.5px', fontWeight: 700, letterSpacing: '.6px', textTransform: 'uppercase', color: MUTE, margin: '18px 0 6px' }}>Historique des mouvements</div>
      {mouvements === null ? (
        <div style={{ fontSize: '13px', color: MUTE }}>Chargement…</div>
      ) : mouvements.length === 0 ? (
        <div style={{ fontSize: '13px', color: MUTE }}>Aucun mouvement enregistré.</div>
      ) : (
        <div style={{ maxHeight: '320px', overflowY: 'auto' }}>
          {mouvements.map(m => {
            const t = TYPES[m.type] || { label: m.type, icone: 'swap_vert' };
            return (
              <div key={m.id} style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 0', borderBottom: `1px dashed ${LINE}`, fontSize: '13px' }}>
                <span className="ms" style={{ fontSize: '18px', color: m.type === 'manuel' ? '#D24444' : MUTE }}>{t.icone}</span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ color: INK, fontWeight: 600 }}>{t.label}{m.vente_id ? ` · vente n° ${m.vente_id}` : ''}{m.facture_id ? ` · facture n° ${m.facture_id}` : ''}</div>
                  <div style={{ fontSize: '11.5px', color: MUTE }}>
                    {new Date(m.cree_le).toLocaleString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })}
                    {m.auteur ? ` · ${m.auteur}` : ''}{m.motif && m.type !== 'ouverture' ? ` · « ${m.motif} »` : ''}
                  </div>
                </div>
                <div style={{ textAlign: 'right', whiteSpace: 'nowrap' }}>
                  <div style={{ fontWeight: 700, color: m.type === 'ouverture' ? SOFT : m.quantite >= 0 ? '#1F9D6B' : '#D24444' }}>
                    {m.type === 'ouverture' ? m.quantite : `${m.quantite > 0 ? '+' : ''}${m.quantite}`}
                  </div>
                  <div style={{ fontSize: '11px', color: MUTE }}>stock {m.stock_apres}</div>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
