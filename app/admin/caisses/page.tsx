'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const th: React.CSSProperties = { fontSize: '11.5px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', textAlign: 'left', padding: '13px 18px', background: '#FBFCFE', borderBottom: '1px solid #EEF2F8', whiteSpace: 'nowrap' };
const td: React.CSSProperties = { padding: '13px 18px', borderBottom: '1px solid #F1F4FA', fontSize: '14px', color: INK, verticalAlign: 'top' };
const heure = (d: string) => new Date(d).toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });

// Clotures de caisse des vendeuses : especes attendues (calculees par la base)
// contre especes declarees. Un ecart negatif = argent manquant.
export default function AdminCaisses() {
  const [clotures, setClotures] = useState<any[]>([]);
  const [chargement, setChargement] = useState(true);

  useEffect(() => {
    supabase.from('clotures_caisse').select('*').order('fin', { ascending: false }).limit(200)
      .then(({ data }) => { setClotures(data || []); setChargement(false); });
  }, []);

  const manque = clotures.filter(c => Number(c.ecart) < 0).reduce((s, c) => s + Number(c.ecart), 0);

  return (
    <div className="fade-up">
      <div style={{ fontSize: '13.5px', color: SOFT, lineHeight: 1.5, marginBottom: '16px', maxWidth: '680px' }}>
        En fin de service, chaque vendeuse touche <b>Clôturer ma caisse</b> et déclare ses espèces sans voir le montant attendu. Fallik calcule ce qu&apos;elle aurait dû avoir.
      </div>
      {manque < 0 && (
        <div style={{ padding: '12px 16px', borderRadius: '12px', background: 'rgba(210,68,68,.10)', color: '#D24444', fontSize: '14px', fontWeight: 700, marginBottom: '16px' }}>
          Total des manques sur la liste : {fmt(-manque)} FCFA
        </div>
      )}
      {chargement ? (
        <div style={{ textAlign: 'center', padding: '60px', color: MUTE }}>Chargement…</div>
      ) : clotures.length === 0 ? (
        <div style={{ textAlign: 'center', padding: '60px', color: MUTE, background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}` }}>Aucune clôture pour l&apos;instant.</div>
      ) : (
        <div style={{ background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, overflow: 'hidden' }}>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: '720px' }}>
              <thead><tr>
                <th style={th}>Vendeuse</th><th style={th}>Période</th><th style={{ ...th, textAlign: 'right' }}>Attendu</th>
                <th style={{ ...th, textAlign: 'right' }}>Déclaré</th><th style={{ ...th, textAlign: 'right' }}>Écart</th><th style={th}>Commentaire</th>
              </tr></thead>
              <tbody>
                {clotures.map(c => {
                  const e = Number(c.ecart);
                  return (
                    <tr key={c.id}>
                      <td style={{ ...td, fontWeight: 700 }}>{c.utilisateur_nom || '—'}<div style={{ fontSize: '12px', color: MUTE, fontWeight: 400 }}>{c.nb_ventes} vente{c.nb_ventes > 1 ? 's' : ''}</div></td>
                      <td style={{ ...td, fontSize: '13px', color: SOFT, whiteSpace: 'nowrap' }}>{heure(c.debut)} → {heure(c.fin)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmt(c.attendu_especes)}</td>
                      <td style={{ ...td, textAlign: 'right' }}>{fmt(c.declare_especes)}</td>
                      <td style={{ ...td, textAlign: 'right', fontWeight: 800, color: e < 0 ? '#D24444' : e > 0 ? '#C8891F' : '#1F9D6B' }}>{e > 0 ? '+' : ''}{fmt(e)}</td>
                      <td style={{ ...td, fontSize: '13px', color: SOFT }}>{c.commentaire || ''}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </div>
      )}
    </div>
  );
}
