'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { decrireEvenement, ICONES_JOURNAL, type LigneJournal } from '@/lib/journal';

const INK = '#1A2438', BLUE = '#2563EB', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const COULEURS = {
  alerte: { c: '#D24444', bg: 'rgba(210,68,68,.10)', l: 'Alerte' },
  attention: { c: '#C8891F', bg: 'rgba(200,137,31,.14)', l: 'À vérifier' },
  info: { c: '#5A6472', bg: '#F1F4FA', l: 'Info' },
} as const;
type Filtre = 'importants' | 'alerte' | 'tout';

// Journal d'activite : tout ce qui touche a l'argent et au stock. Ecrit par la
// base elle-meme ; personne (ni gerant, ni Fall Digital via l'app) ne peut
// modifier ou effacer une ligne.
export default function AdminJournal() {
  const [lignes, setLignes] = useState<LigneJournal[]>([]);
  const [filtre, setFiltre] = useState<Filtre>('importants');
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    let annule = false;
    (async () => {
      setChargement(true);
      let req = supabase.from('journal_activite')
        .select('id, action, gravite, utilisateur_nom, approuve_nom, details, montant, cree_le')
        .order('cree_le', { ascending: false }).limit(300);
      if (filtre === 'importants') req = req.in('gravite', ['attention', 'alerte']);
      if (filtre === 'alerte') req = req.eq('gravite', 'alerte');
      const { data } = await req;
      if (!annule) { setLignes((data as LigneJournal[]) || []); setChargement(false); }
    })();
    return () => { annule = true; };
  }, [filtre]);

  // Regroupement par jour.
  const jours: [string, LigneJournal[]][] = [];
  for (const l of lignes) {
    const j = new Date(l.cree_le).toLocaleDateString('fr-FR', { weekday: 'long', day: 'numeric', month: 'long' });
    const dernier = jours[jours.length - 1];
    if (dernier && dernier[0] === j) dernier[1].push(l); else jours.push([j, [l]]);
  }

  return (
    <div className="fade-up">
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '12px', marginBottom: '18px' }}>
        <div style={{ fontSize: '13.5px', color: SOFT, maxWidth: '620px', lineHeight: 1.5 }}>
          Annulations, retraits d&apos;articles, crédits, changements de stock et de prix, clôtures de caisse. Ce journal ne peut être ni modifié ni effacé.
        </div>
        <div style={{ display: 'flex', gap: '2px', background: '#EEF1F7', borderRadius: '12px', padding: '4px' }}>
          {([['importants', 'Importants'], ['alerte', 'Alertes'], ['tout', 'Tout']] as const).map(([v, l]) => (
            <button key={v} onClick={() => setFiltre(v)} style={{ height: '34px', padding: '0 14px', borderRadius: '9px', border: 'none', cursor: 'pointer', fontSize: '13px', fontWeight: 700, background: filtre === v ? '#fff' : 'transparent', color: filtre === v ? BLUE : SOFT }}>{l}</button>
          ))}
        </div>
      </div>

      {chargement ? (
        <div style={{ textAlign: 'center', padding: '60px', color: MUTE }}>Chargement…</div>
      ) : lignes.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: MUTE, background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}` }}>
          <span className="ms" style={{ fontSize: '44px', display: 'block', marginBottom: '10px', color: '#C6D2E8' }}>verified_user</span>
          Rien à signaler.
        </div>
      ) : jours.map(([jour, ls]) => (
        <div key={jour} style={{ marginBottom: '20px' }}>
          <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '1px', color: SOFT, textTransform: 'uppercase', marginBottom: '10px' }}>{jour}</div>
          <div style={{ background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, overflow: 'hidden' }}>
            {ls.map((l, i) => {
              const c = COULEURS[l.gravite] || COULEURS.info;
              return (
                <div key={l.id} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '14px 18px', borderTop: i ? '1px solid #F1F4FA' : 'none' }}>
                  <div style={{ width: '36px', height: '36px', borderRadius: '11px', background: c.bg, display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    <span className="ms" style={{ fontSize: '19px', color: c.c }}>{ICONES_JOURNAL[l.action] || 'history'}</span>
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '14px', color: INK, lineHeight: 1.45 }}>{decrireEvenement(l)}</div>
                    <div style={{ fontSize: '12px', color: MUTE, marginTop: '3px' }}>
                      {new Date(l.cree_le).toLocaleTimeString('fr-FR', { hour: '2-digit', minute: '2-digit' })}
                      <span style={{ marginLeft: '8px', fontWeight: 700, color: c.c }}>{c.l}</span>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}
