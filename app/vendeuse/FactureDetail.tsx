'use client';
import { useEffect, useRef, useState, useCallback } from 'react';
import { supabase } from '@/lib/supabase';
import Recu, { type RecuData } from '../components/Recu';
import { partagerImageRecu, whatsappTexte } from '../components/recuPartage';

const MODES: [string, string][] = [['cash', 'Espèces'], ['mobile_money', 'Mobile Money'], ['orange_money', 'Orange Money'], ['carte', 'Carte'], ['autre', 'Autre']];

// Détail d'une facture ouverte (mode bar) : ajout/retrait de produits en temps
// réel (stock géré en base), puis encaissement -> reçu.
export default function FactureDetail({ factureId, produits, rechargerProduits, user, isMobile, boutiqueNom, onRetour }: {
  factureId: number; produits: any[]; rechargerProduits: () => Promise<void>; user: any; isMobile: boolean; boutiqueNom: string; onRetour: () => void;
}) {
  const [facture, setFacture] = useState<any>(null);
  const [lignes, setLignes] = useState<any[]>([]);
  const [busy, setBusy] = useState(false);
  const [erreur, setErreur] = useState('');
  const [encaisse, setEncaisse] = useState(false);
  const [mode, setMode] = useState('cash');
  const [montant, setMontant] = useState<number | ''>('');
  const [telephone, setTelephone] = useState('');
  const [recu, setRecu] = useState<RecuData | null>(null);
  const recuRef = useRef<HTMLDivElement>(null);

  const charger = useCallback(async () => {
    const { data: f } = await supabase.from('factures').select('*').eq('id', factureId).single();
    const { data: l } = await supabase.from('facture_lignes').select('id, produit_id, quantite, prix_unitaire, produits(nom)').eq('facture_id', factureId).order('created_at');
    setFacture(f); setLignes(l || []);
  }, [factureId]);

  useEffect(() => { charger(); }, [charger]);

  const qteMap: Record<number, number> = {};
  lignes.forEach(l => { qteMap[l.produit_id] = l.quantite; });
  const total = Number(facture?.total ?? 0);

  const definir = async (produitId: number, quantite: number) => {
    if (busy) return;
    setBusy(true); setErreur('');
    const { error } = await supabase.rpc('facture_definir_quantite', { p_facture_id: factureId, p_produit_id: produitId, p_quantite: Math.max(0, quantite) });
    if (error) setErreur(error.message || 'Erreur.');
    await Promise.all([rechargerProduits(), charger()]);
    setBusy(false);
  };

  const annuler = async () => {
    if (!confirm('Annuler cette facture ? Le stock sera restitué.')) return;
    setBusy(true);
    const { error } = await supabase.rpc('facture_annuler', { p_facture_id: factureId });
    if (error) { setErreur(error.message || 'Erreur.'); setBusy(false); return; }
    await rechargerProduits();
    onRetour();
  };

  const confirmerEncaissement = async () => {
    const paye = montant === '' ? total : Number(montant);
    setBusy(true); setErreur('');
    const { data: venteId, error } = await supabase.rpc('facture_finaliser', { p_facture_id: factureId, p_mode_paiement: mode, p_montant_paye: paye });
    if (error) { setErreur(error.message || 'Erreur.'); setBusy(false); return; }
    setRecu({
      boutique: boutiqueNom,
      numero: `${new Date().getFullYear()}-${String(venteId).padStart(4, '0')}`,
      date: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
      vendeuse: user?.nom || '', client: facture?.nom_client || '', telephone: telephone || null,
      items: lignes.map(l => ({ nom: (l.produits?.nom) || 'Produit', quantite: l.quantite, prix: Number(l.prix_unitaire) })),
      total, paye, reste: Math.max(0, total - paye), mode, statut: paye >= total ? 'paye' : 'partiel',
    });
    setEncaisse(false);
    await rechargerProduits();
  };

  if (!facture) return <div style={{ textAlign: 'center', padding: '60px', color: 'var(--ink-45)' }}>Chargement…</div>;

  return (
    <div style={{ padding: isMobile ? '16px' : '24px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      {/* Barre titre facture */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '18px' }}>
        <button onClick={onRetour} aria-label="Retour" style={{ width: '40px', height: '40px', borderRadius: '11px', border: '1px solid var(--line)', background: 'var(--surface)', cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
          <span className="ms" style={{ fontSize: '22px', color: 'var(--ink)' }}>arrow_back</span>
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontFamily: 'var(--font-cormorant), serif', fontSize: '26px', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{facture.nom_client}</div>
          <div style={{ fontSize: '12.5px', color: 'var(--ink-45)' }}>Facture ouverte</div>
        </div>
      </div>

      {erreur && <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--danger-tint)', border: '1px solid var(--danger-line)', color: 'var(--danger)', fontSize: '13px', marginBottom: '14px', textAlign: 'center' }}>{erreur}</div>}

      <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 360px', gap: isMobile ? '18px' : '24px' }}>
        {/* Grille produits */}
        <div>
          <div style={{ fontSize: '14px', fontWeight: 700, color: 'var(--ink)', marginBottom: '14px' }}>Ajouter des produits</div>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(150px,1fr))', gap: '12px' }}>
            {produits.map(p => {
              const qte = qteMap[p.id] || 0;
              const epuise = p.stock_restant <= 0 && qte === 0;
              return (
                <div key={p.id} style={{ padding: '12px', borderRadius: '14px', background: 'var(--surface)', border: `1px solid ${qte > 0 ? 'var(--accent-30)' : 'var(--line)'}`, opacity: epuise ? 0.5 : 1 }}>
                  <div style={{ fontSize: '13px', fontWeight: 600, color: 'var(--ink)', lineHeight: 1.25, marginBottom: '3px' }}>{p.nom}</div>
                  <div style={{ fontSize: '11px', color: p.stock_restant <= 0 ? 'var(--danger)' : p.stock_restant <= 2 ? 'var(--warn)' : 'var(--ink-45)', marginBottom: '8px' }}>{p.stock_restant <= 0 ? 'Épuisé' : `${p.stock_restant} dispo`}</div>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '6px' }}>
                    <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--accent)' }}>{p.prix?.toLocaleString()}</span>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                      {qte > 0 && <>
                        <button disabled={busy} onClick={() => definir(p.id, qte - 1)} style={{ width: '30px', height: '30px', borderRadius: '9px', border: 'none', cursor: busy ? 'wait' : 'pointer', background: 'var(--accent-16)', color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms" style={{ fontSize: '18px' }}>remove</span></button>
                        <span style={{ fontSize: '14px', fontWeight: 700, color: 'var(--accent-deep)', minWidth: '18px', textAlign: 'center' }}>{qte}</span>
                      </>}
                      <button disabled={busy || p.stock_restant <= 0} onClick={() => definir(p.id, qte + 1)} style={{ width: '34px', height: '34px', borderRadius: '10px', border: 'none', cursor: busy || p.stock_restant <= 0 ? 'not-allowed' : 'pointer', background: p.stock_restant <= 0 ? 'var(--surface-inset)' : 'var(--accent-grad)', color: p.stock_restant <= 0 ? 'var(--ink-25)' : 'var(--on-accent)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms" style={{ fontSize: '20px' }}>add</span></button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>

        {/* Panneau facture */}
        <div style={{ position: isMobile ? 'static' : 'sticky', top: '88px', padding: '22px', borderRadius: '20px', background: 'var(--surface-2)', border: '1px solid var(--accent-20)', backdropFilter: 'blur(22px)', boxShadow: 'var(--shadow-lg)', height: 'fit-content' }}>
          <div style={{ fontSize: '15px', fontWeight: 700, color: 'var(--ink)', marginBottom: '14px' }}>Facture</div>
          {lignes.length === 0 ? (
            <div style={{ textAlign: 'center', padding: '20px 0', color: 'var(--ink-35)', fontSize: '13px' }}>Ajoutez des produits →</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: '9px', marginBottom: '14px', maxHeight: '280px', overflowY: 'auto', paddingRight: '4px' }}>
              {lignes.map(l => (
                <div key={l.id} style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                  <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--accent-12)', border: '1px solid var(--accent-20)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '12.5px', fontWeight: 700, color: 'var(--accent-deep)', flexShrink: 0 }}>{l.quantite}</div>
                  <div style={{ flex: 1, minWidth: 0, fontSize: '13px', fontWeight: 500, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{l.produits?.nom || 'Produit'}</div>
                  <div style={{ fontSize: '13px', fontWeight: 700, color: 'var(--ink)', flexShrink: 0 }}>{(l.quantite * Number(l.prix_unitaire)).toLocaleString()}</div>
                  <button disabled={busy} onClick={() => definir(l.produit_id, 0)} aria-label="Retirer" style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: '3px', display: 'flex' }}><span className="ms" style={{ fontSize: '16px' }}>close</span></button>
                </div>
              ))}
            </div>
          )}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '12px 0', borderTop: '1px solid var(--line)', marginBottom: '14px' }}>
            <span style={{ fontSize: '14px', color: 'var(--ink-55)' }}>Total</span>
            <span><span style={{ fontSize: '26px', fontWeight: 800, color: 'var(--ink)' }}>{total.toLocaleString()}</span><span style={{ fontSize: '12px', color: 'var(--accent)', fontWeight: 700, marginLeft: '4px' }}>FCFA</span></span>
          </div>
          <button disabled={busy || lignes.length === 0} onClick={() => { setMontant(''); setEncaisse(true); }} style={{ width: '100%', height: '50px', border: 'none', borderRadius: '14px', cursor: busy || lignes.length === 0 ? 'not-allowed' : 'pointer', background: lignes.length === 0 ? 'var(--accent-20)' : 'var(--accent-grad)', color: 'var(--on-accent)', fontSize: '15px', fontWeight: 700, boxShadow: lignes.length ? 'var(--shadow-accent)' : 'none', marginBottom: '10px' }}>Encaisser</button>
          <button disabled={busy} onClick={annuler} style={{ width: '100%', height: '42px', border: '1px solid var(--danger-line)', borderRadius: '12px', cursor: 'pointer', background: 'var(--danger-tint)', color: 'var(--danger)', fontSize: '13.5px', fontWeight: 600 }}>Annuler la facture</button>
        </div>
      </div>

      {/* Modal encaissement */}
      {encaisse && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(62,44,32,.55)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '20px', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: '400px', margin: 'auto', background: 'var(--surface-2)', border: '1px solid var(--accent-20)', borderRadius: '20px', padding: '24px', boxShadow: 'var(--shadow-lg)' }}>
            <div style={{ fontSize: '17px', fontWeight: 700, color: 'var(--ink)', marginBottom: '4px' }}>Encaisser — {facture.nom_client}</div>
            <div style={{ fontSize: '13px', color: 'var(--ink-55)', marginBottom: '18px' }}>Total : <b style={{ color: 'var(--ink)' }}>{total.toLocaleString()} FCFA</b></div>

            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.4px', color: 'var(--ink-45)', textTransform: 'uppercase', marginBottom: '8px' }}>Moyen de paiement</div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px', marginBottom: '16px' }}>
              {MODES.map(([val, label]) => (
                <button key={val} onClick={() => setMode(val)} style={{ flex: '1 1 30%', height: '38px', borderRadius: '10px', border: `1px solid ${mode === val ? 'var(--accent-30)' : 'var(--line)'}`, background: mode === val ? 'var(--accent-12)' : 'transparent', color: mode === val ? 'var(--accent-deep)' : 'var(--ink-55)', fontSize: '12px', fontWeight: 600, cursor: 'pointer' }}>{label}</button>
              ))}
            </div>

            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.4px', color: 'var(--ink-45)', textTransform: 'uppercase', marginBottom: '8px' }}>Montant reçu (laisser vide = payé en entier)</div>
            <input type="number" value={montant} onChange={e => setMontant(e.target.value === '' ? '' : Number(e.target.value))} placeholder={total.toLocaleString()} style={{ height: '46px', padding: '0 14px', borderRadius: '12px', background: 'var(--surface-inset)', border: '1px solid var(--line)', outline: 'none', color: 'var(--ink)', fontSize: '15px', width: '100%', marginBottom: '14px' }} />

            <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.4px', color: 'var(--ink-45)', textTransform: 'uppercase', marginBottom: '8px' }}>Téléphone du client (pour le reçu WhatsApp)</div>
            <input value={telephone} onChange={e => setTelephone(e.target.value)} placeholder="Optionnel" style={{ height: '46px', padding: '0 14px', borderRadius: '12px', background: 'var(--surface-inset)', border: '1px solid var(--line)', outline: 'none', color: 'var(--ink)', fontSize: '15px', width: '100%', marginBottom: '18px' }} />

            <button disabled={busy} onClick={confirmerEncaissement} style={{ width: '100%', height: '50px', border: 'none', borderRadius: '14px', cursor: busy ? 'wait' : 'pointer', background: 'var(--accent-grad)', color: 'var(--on-accent)', fontSize: '15px', fontWeight: 700, boxShadow: 'var(--shadow-accent)', marginBottom: '10px', opacity: busy ? 0.7 : 1 }}>{busy ? 'Encaissement…' : 'Confirmer le paiement'}</button>
            <button onClick={() => setEncaisse(false)} style={{ width: '100%', height: '42px', border: '1px solid var(--line)', borderRadius: '12px', cursor: 'pointer', background: 'transparent', color: 'var(--ink-55)', fontSize: '14px', fontWeight: 600 }}>Retour</button>
          </div>
        </div>
      )}

      {/* Reçu après encaissement */}
      {recu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(62,44,32,.55)', backdropFilter: 'blur(3px)', display: 'flex', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: '400px', margin: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
              <div ref={recuRef} style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: 'var(--shadow-lg)' }}><Recu data={recu} /></div>
            </div>
            <button onClick={async () => { if (recuRef.current) await partagerImageRecu(recuRef.current, recu); }} style={{ height: '52px', border: 'none', borderRadius: '14px', cursor: 'pointer', background: 'var(--accent-grad)', color: 'var(--on-accent)', fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', boxShadow: 'var(--shadow-accent)' }}><span className="ms" style={{ fontSize: '20px' }}>ios_share</span>Partager le reçu (WhatsApp)</button>
            <button onClick={() => whatsappTexte(recu)} style={{ height: '46px', border: '1px solid var(--accent-25)', borderRadius: '13px', cursor: 'pointer', background: 'var(--surface)', color: 'var(--accent-deep)', fontSize: '13.5px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><span className="ms" style={{ fontSize: '18px' }}>chat</span>Envoyer en texte</button>
            <button onClick={onRetour} style={{ height: '46px', border: '1px solid var(--line)', borderRadius: '13px', cursor: 'pointer', background: 'transparent', color: 'var(--ink-55)', fontSize: '14px', fontWeight: 600 }}>Terminé</button>
          </div>
        </div>
      )}
    </div>
  );
}
