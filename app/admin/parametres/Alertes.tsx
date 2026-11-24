'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import PushToggle from '../../components/PushToggle';

const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', LINE = '#EAEEF5';
const VERT = '#1F9D6B', ROUGE = '#D24444';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '20px 22px' };
const bouton: React.CSSProperties = { display: 'flex', alignItems: 'center', gap: '7px', height: '40px', padding: '0 14px', borderRadius: '11px', fontSize: '13.5px', fontWeight: 700, cursor: 'pointer' };

type Reglages = { ventes: boolean; stock_bas: boolean; actions_sensibles: boolean; resume_soir: boolean; telegram_titre: string | null; telegram_lie_le: string | null };
type Etat = { actif: boolean; bot: string | null; reglages: Reglages | null };

const CHOIX: { cle: keyof Pick<Reglages, 'ventes' | 'stock_bas' | 'actions_sensibles' | 'resume_soir'>; titre: string; desc: string }[] = [
  { cle: 'ventes', titre: 'Chaque vente', desc: 'Vente rapide ou facture encaissée : vendeuse, articles, montant, crédit éventuel.' },
  { cle: 'stock_bas', titre: 'Stock bas', desc: 'Quand un produit passe sous le seuil d\'alerte (une seule fois, pas à chaque vente).' },
  { cle: 'actions_sensibles', titre: 'Actions à vérifier', desc: 'Annulations, retraits d\'articles, crédits, codes gérant faux, écarts de caisse, corrections de stock.' },
  { cle: 'resume_soir', titre: 'Résumé du soir', desc: 'Vers 21 h : chiffre du jour, bénéfice, encaissements, vendeuses, dettes, stock bas.' },
];

async function lire(): Promise<Etat | null> {
  const r = await fetch('/api/alertes/telegram', { cache: 'no-store' });
  return r.ok ? r.json() : null;
}

export default function Alertes({ estProprietaire }: { estProprietaire: boolean }) {
  const [etat, setEtat] = useState<Etat | null>(null);
  const [lien, setLien] = useState<string | null>(null);
  const [occupe, setOccupe] = useState<string | null>(null);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  useEffect(() => {
    let annule = false;
    lire().then(e => { if (!annule) setEtat(e); });
    return () => { annule = true; };
  }, []);

  const recharger = async () => setEtat(await lire());

  const basculer = async (cle: (typeof CHOIX)[number]['cle']) => {
    if (!etat?.reglages || !estProprietaire) return;
    const valeur = !etat.reglages[cle];
    setOccupe(cle); setMessage(null);
    const { error } = await supabase.rpc('definir_alertes', {
      p_ventes: cle === 'ventes' ? valeur : null, p_stock_bas: cle === 'stock_bas' ? valeur : null,
      p_actions_sensibles: cle === 'actions_sensibles' ? valeur : null, p_resume_soir: cle === 'resume_soir' ? valeur : null,
    });
    setOccupe(null);
    if (error) { setMessage({ ok: false, texte: error.message }); return; }
    setEtat({ ...etat, reglages: { ...etat.reglages, [cle]: valeur } });
  };

  const action = async (nom: string, init: RequestInit) => {
    setOccupe(nom); setMessage(null);
    const r = await fetch('/api/alertes/telegram', init);
    const json = await r.json().catch(() => ({}));
    setOccupe(null);
    return { ok: r.ok, json };
  };

  const relier = async () => {
    const { ok, json } = await action('lier', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'lier' }) });
    if (!ok) { setMessage({ ok: false, texte: json.message || 'Échec.' }); return; }
    setLien(json.lien);
    window.open(json.lien, '_blank', 'noopener');
  };
  const tester = async () => {
    const { ok, json } = await action('test', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ action: 'test' }) });
    setMessage(ok ? { ok: true, texte: 'Message de test envoyé : regardez Telegram.' } : { ok: false, texte: json.message || 'Échec.' });
  };
  const delier = async () => {
    if (!confirm('Ne plus recevoir les alertes sur ce Telegram ?')) return;
    const { ok, json } = await action('delier', { method: 'DELETE' });
    if (!ok) { setMessage({ ok: false, texte: json.message || 'Échec.' }); return; }
    setLien(null); await recharger();
  };

  const r = etat?.reglages;
  const lie = !!r?.telegram_lie_le;

  return (
    <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(320px,1fr))', gap: '18px', marginBottom: '22px' }}>
      {/* Telegram */}
      <div style={carte}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span className="ms" style={{ fontSize: '22px', color: '#229ED9' }}>send</span>
          <div style={{ fontSize: '16px', fontWeight: 700, color: INK }}>Telegram</div>
          {lie && <span style={{ fontSize: '11px', fontWeight: 700, color: VERT, background: 'rgba(31,157,107,.12)', padding: '3px 9px', borderRadius: '20px' }}>RELIÉ</span>}
        </div>
        {!etat ? (
          <p style={{ fontSize: '13px', color: MUTE }}>Chargement…</p>
        ) : !etat.actif ? (
          <p style={{ fontSize: '13px', color: '#5A6472', lineHeight: 1.55 }}>Les alertes Telegram ne sont pas encore activées sur Fallik. Les notifications sur téléphone fonctionnent déjà.</p>
        ) : lie ? (
          <>
            <p style={{ fontSize: '13px', color: '#5A6472', lineHeight: 1.55, margin: '0 0 14px' }}>
              Les alertes arrivent dans <b style={{ color: INK }}>{r?.telegram_titre}</b> depuis le {new Date(r!.telegram_lie_le!).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' })}.
            </p>
            {estProprietaire && (
              <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                <button onClick={tester} disabled={!!occupe} style={{ ...bouton, border: 'none', background: '#EEF3FC', color: BLUE }}><span className="ms" style={{ fontSize: '18px' }}>send</span>{occupe === 'test' ? 'Envoi…' : 'Envoyer un test'}</button>
                <button onClick={delier} disabled={!!occupe} style={{ ...bouton, border: `1px solid ${LINE}`, background: '#fff', color: ROUGE }}><span className="ms" style={{ fontSize: '18px' }}>link_off</span>Délier</button>
              </div>
            )}
          </>
        ) : (
          <>
            <p style={{ fontSize: '13px', color: '#5A6472', lineHeight: 1.55, margin: '0 0 14px' }}>
              Recevez les alertes de la boutique sur Telegram, sur votre téléphone ou dans un groupe avec vos associés.
            </p>
            {estProprietaire ? (
              lien ? (
                <div style={{ fontSize: '13px', color: '#5A6472', lineHeight: 1.6 }}>
                  <ol style={{ margin: '0 0 12px', paddingLeft: '18px' }}>
                    <li>Telegram s&apos;est ouvert sur le bot <b>@{etat.bot}</b> (sinon <a href={lien} target="_blank" rel="noopener noreferrer" style={{ color: BLUE, fontWeight: 600 }}>ouvrez ce lien</a>).</li>
                    <li>Appuyez sur <b>Démarrer</b>. Pour un groupe : ajoutez le bot au groupe et envoyez-y le même lien.</li>
                    <li>Revenez ici et touchez « Vérifier ». Le lien est valable 15 minutes.</li>
                  </ol>
                  <button onClick={recharger} style={{ ...bouton, border: 'none', background: GRAD, color: '#fff' }}><span className="ms" style={{ fontSize: '18px' }}>refresh</span>Vérifier</button>
                </div>
              ) : (
                <button onClick={relier} disabled={!!occupe} style={{ ...bouton, border: 'none', background: GRAD, color: '#fff' }}>
                  <span className="ms" style={{ fontSize: '18px' }}>link</span>{occupe === 'lier' ? 'Préparation…' : 'Relier mon Telegram'}
                </button>
              )
            ) : (
              <p style={{ fontSize: '12.5px', color: MUTE, margin: 0 }}>Seul le propriétaire peut relier Telegram.</p>
            )}
          </>
        )}
        {message && <div style={{ marginTop: '12px', fontSize: '13px', color: message.ok ? VERT : ROUGE }}>{message.texte}</div>}

        <div style={{ borderTop: '1px solid #F1F4FA', marginTop: '16px', paddingTop: '14px' }}>
          <div style={{ fontSize: '13px', fontWeight: 700, color: INK, marginBottom: '8px' }}>Notifications sur cet appareil</div>
          <PushToggle />
        </div>
      </div>

      {/* Choix des alertes */}
      <div style={carte}>
        <div style={{ fontSize: '16px', fontWeight: 700, color: INK, marginBottom: '4px' }}>Que recevoir ?</div>
        <p style={{ fontSize: '12.5px', color: MUTE, margin: '0 0 12px' }}>
          {estProprietaire ? 'Sur Telegram et sur les appareils où les notifications sont activées.' : 'Seul le propriétaire peut modifier ces choix.'}
        </p>
        {!r ? <p style={{ fontSize: '13px', color: MUTE }}>Chargement…</p> : CHOIX.map(c => (
          <label key={c.cle} style={{ display: 'flex', alignItems: 'flex-start', gap: '12px', padding: '10px 0', borderBottom: '1px solid #F6F8FC', cursor: estProprietaire ? 'pointer' : 'default' }}>
            <input type="checkbox" checked={r[c.cle]} disabled={!estProprietaire || occupe === c.cle} onChange={() => basculer(c.cle)}
              style={{ width: '18px', height: '18px', marginTop: '2px', accentColor: BLUE, flexShrink: 0 }} />
            <span>
              <span style={{ display: 'block', fontSize: '14px', fontWeight: 600, color: INK }}>{c.titre}</span>
              <span style={{ display: 'block', fontSize: '12.5px', color: '#6B7688', lineHeight: 1.45 }}>{c.desc}</span>
            </span>
          </label>
        ))}
      </div>
    </div>
  );
}
