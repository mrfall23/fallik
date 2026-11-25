'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', LINE = '#EAEEF5';
const VERT = '#1F9D6B', ROUGE = '#D24444';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '20px 22px', marginBottom: '22px' };
const bouton: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', gap: '7px', height: '40px', padding: '0 14px', borderRadius: '11px', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer' };
const code: React.CSSProperties = { display: 'block', background: '#0F172A', color: '#E2E8F0', borderRadius: '12px', padding: '12px 14px', fontSize: '12px', lineHeight: 1.6, overflowX: 'auto', whiteSpace: 'pre', fontFamily: 'ui-monospace, Menlo, Consolas, monospace' };

type Site = { cle_debut: string | null; maj_le: string } | null;

export default function SiteWeb({ estProprietaire, plan }: { estProprietaire: boolean; plan: string }) {
  const [site, setSite] = useState<Site | undefined>(undefined);
  const [cle, setCle] = useState<string | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);
  const pro = plan === 'pro';

  useEffect(() => {
    let annule = false;
    supabase.from('sites_web').select('cle_debut, maj_le').maybeSingle()
      .then(({ data }) => { if (!annule) setSite((data as Site) ?? null); });
    return () => { annule = true; };
  }, []);

  const generer = async () => {
    if (site?.cle_debut && !confirm("Générer une nouvelle clé ? L'ancienne cessera de marcher : il faudra mettre la nouvelle sur le site.")) return;
    setOccupe(true); setMessage(null);
    const r = await fetch('/api/site/cle', { method: 'POST' });
    const json = await r.json().catch(() => ({}));
    setOccupe(false);
    if (!r.ok) { setMessage({ ok: false, texte: json.message || 'Échec.' }); return; }
    setCle(json.cle);
    setSite({ cle_debut: json.cle.slice(0, 10), maj_le: new Date().toISOString() });
  };

  const couper = async () => {
    if (!confirm('Couper le lien ? Le site ne pourra plus lire le catalogue ni envoyer de commandes.')) return;
    setOccupe(true); setMessage(null);
    const { error } = await supabase.rpc('site_desactiver');
    setOccupe(false);
    if (error) { setMessage({ ok: false, texte: error.message }); return; }
    setCle(null); setSite({ cle_debut: null, maj_le: new Date().toISOString() });
  };

  const copier = async (texte: string) => {
    try { await navigator.clipboard.writeText(texte); setMessage({ ok: true, texte: 'Copié.' }); } catch { /* ignore */ }
  };

  const origine = typeof window === 'undefined' ? '' : window.location.origin;
  const actif = !!site?.cle_debut;
  const cleAffichee = cle || 'VOTRE_CLE';

  return (
    <div style={carte}>
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px', flexWrap: 'wrap' }}>
        <span className="ms" style={{ fontSize: '22px', color: BLUE }}>language</span>
        <div style={{ fontSize: '16px', fontWeight: 700, color: INK }}>Lien avec votre site web</div>
        <span style={{ fontSize: '11px', fontWeight: 700, color: BLUE, background: '#EEF3FC', padding: '3px 9px', borderRadius: '20px' }}>PRO</span>
        {actif && <span style={{ fontSize: '11px', fontWeight: 700, color: VERT, background: 'rgba(31,157,107,.12)', padding: '3px 9px', borderRadius: '20px' }}>ACTIF</span>}
      </div>
      <p style={{ fontSize: '13px', color: '#5A6472', lineHeight: 1.55, margin: '0 0 14px' }}>
        Votre site affiche vos produits, vos prix et votre stock en direct depuis Fallik. Les commandes passées sur le site arrivent dans
        <b style={{ color: INK }}> Commandes en ligne</b> : vous les validez (le stock est alors décompté) ou vous les refusez.
      </p>

      {!pro ? (
        <p style={{ fontSize: '13px', color: MUTE, margin: 0 }}>Réservé au plan Pro (30 000 FCFA / mois). Contactez Fall Digital pour changer de plan.</p>
      ) : site === undefined ? (
        <p style={{ fontSize: '13px', color: MUTE, margin: 0 }}>Chargement…</p>
      ) : !estProprietaire ? (
        <p style={{ fontSize: '13px', color: MUTE, margin: 0 }}>{actif ? `Lien actif (clé ${site?.cle_debut}…).` : 'Aucun site relié.'} Seul le propriétaire peut gérer la clé.</p>
      ) : (
        <>
          {cle ? (
            <div style={{ background: '#FFF8E6', border: '1px solid #F5DFA6', borderRadius: '12px', padding: '12px 14px', marginBottom: '14px' }}>
              <div style={{ fontSize: '13px', fontWeight: 700, color: '#8A5A00', marginBottom: '6px' }}>Votre clé : copiez-la maintenant, elle ne sera plus affichée.</div>
              <div style={{ display: 'flex', gap: '8px', alignItems: 'center', flexWrap: 'wrap' }}>
                <code style={{ fontSize: '13px', background: '#fff', border: `1px solid ${LINE}`, borderRadius: '8px', padding: '6px 10px', wordBreak: 'break-all' }}>{cle}</code>
                <button onClick={() => copier(cle)} style={{ ...bouton, height: '34px', border: 'none', background: '#EEF3FC', color: BLUE }}><span className="ms" style={{ fontSize: '17px' }}>content_copy</span>Copier</button>
              </div>
            </div>
          ) : actif ? (
            <p style={{ fontSize: '13px', color: '#5A6472', margin: '0 0 14px' }}>Clé active : <b style={{ color: INK }}>{site?.cle_debut}…</b> (si vous l&apos;avez perdue, générez-en une nouvelle).</p>
          ) : null}

          <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' }}>
            <button onClick={generer} disabled={occupe} style={{ ...bouton, border: 'none', background: GRAD, color: '#fff' }}>
              <span className="ms" style={{ fontSize: '18px' }}>key</span>{occupe ? 'Patientez…' : actif ? 'Nouvelle clé' : 'Relier mon site'}
            </button>
            {actif && (
              <button onClick={couper} disabled={occupe} style={{ ...bouton, border: `1px solid ${LINE}`, background: '#fff', color: ROUGE }}>
                <span className="ms" style={{ fontSize: '18px' }}>link_off</span>Couper le lien
              </button>
            )}
          </div>

          {(actif || cle) && (
            <details>
              <summary style={{ fontSize: '13px', fontWeight: 700, color: BLUE, cursor: 'pointer', marginBottom: '10px' }}>Instructions pour la personne qui fait votre site</summary>
              <div style={{ fontSize: '12.5px', color: '#5A6472', lineHeight: 1.6 }}>
                <p style={{ margin: '6px 0' }}>1. Lire le catalogue (produits actifs, prix, stock) :</p>
                <code style={code}>{`GET ${origine}/api/site/catalogue\nX-Fallik-Cle: ${cleAffichee}`}</code>
                <p style={{ margin: '12px 0 6px' }}>2. Envoyer une commande :</p>
                <code style={code}>{`POST ${origine}/api/site/commandes\nX-Fallik-Cle: ${cleAffichee}\nContent-Type: application/json\n\n{\n  "client": { "nom": "Awa", "telephone": "690000000",\n              "adresse": "Bastos", "note": "Livrer après 17 h" },\n  "lignes": [ { "produit_id": 12, "quantite": 2 } ]\n}`}</code>
                <p style={{ margin: '12px 0 0' }}>Réponse : <code>{'{ "ok": true, "reference": "CMD-…", "total": 0 }'}</code> ou <code>{'{ "ok": false, "erreur": "…" }'}</code>. Le prix et le stock sont toujours ceux de Fallik.</p>
              </div>
            </details>
          )}
        </>
      )}
      {message && <div style={{ marginTop: '12px', fontSize: '13px', color: message.ok ? VERT : ROUGE }}>{message.texte}</div>}
    </div>
  );
}
