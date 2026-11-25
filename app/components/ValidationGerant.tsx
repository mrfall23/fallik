'use client';
import { useCallback, useRef, useState } from 'react';
import { supabase } from '@/lib/supabase';
import PinPad from './PinPad';

const INK = '#1A2438', SOFT = '#8A94A6', LINE = '#EAEEF5';
const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');

export type ActionSensible = 'annuler_facture' | 'retirer_article' | 'credit' | 'remise';

/** La base refuse l'action tant que le gerant ne l'a pas validee. */
export const validationRequise = (message?: string | null) => !!message && message.includes('Validation du gérant requise');

/** Previent le patron (notification) des actions sensibles deja journalisees. */
// Envoi des alertes en attente (push). Regroupe les appels
// rapproches (plusieurs articles ajoutes d'affilee) en un seul envoi.
let minuteurSignal: ReturnType<typeof setTimeout> | null = null;
export const signalerAuPatron = () => {
  if (minuteurSignal) clearTimeout(minuteurSignal);
  minuteurSignal = setTimeout(() => {
    minuteurSignal = null;
    fetch('/api/journal/notifier', { method: 'POST', keepalive: true }).catch(() => {});
  }, 1200);
};

type Demande = { action: ActionSensible; cible: number | null; montant: number; libelle: string };

/**
 * Fenetre « Code du gérant ». demander() s'ouvre, le gerant tape son code sur
 * le telephone de la vendeuse, la base delivre un jeton a usage unique (lie a
 * l'action, a la facture et au montant). Renvoie null si on abandonne.
 */
export function useValidationGerant() {
  const [demande, setDemande] = useState<Demande | null>(null);
  const [occupe, setOccupe] = useState(false);
  const [erreur, setErreur] = useState('');
  const resoudre = useRef<((jeton: string | null) => void) | null>(null);

  const demander = useCallback((action: ActionSensible, cible: number | null, montant: number, libelle: string) =>
    new Promise<string | null>((resolve) => {
      resoudre.current = resolve;
      setErreur('');
      setDemande({ action, cible, montant, libelle });
    }), []);

  const fermer = (jeton: string | null) => {
    resoudre.current?.(jeton);
    resoudre.current = null;
    setDemande(null);
  };

  const valider = useCallback(async (pin: string) => {
    if (!demande) return;
    setOccupe(true); setErreur('');
    const { data, error } = await supabase.rpc('demander_autorisation', {
      p_action: demande.action, p_cible: demande.cible, p_montant: demande.montant, p_code: pin,
    });
    setOccupe(false);
    if (error) { setErreur(error.message || 'Erreur.'); return; }
    if (!data?.ok) {
      const r = typeof data?.restants === 'number' ? ` (${data.restants} essai${data.restants > 1 ? 's' : ''} restant${data.restants > 1 ? 's' : ''})` : '';
      setErreur((data?.message || 'Code refusé.') + r);
      signalerAuPatron();
      return;
    }
    fermer(data.autorisation as string);
  }, [demande]);

  const element = demande ? (
    <div style={{ position: 'fixed', inset: 0, zIndex: 80, background: 'rgba(16,24,40,.55)', display: 'flex', justifyContent: 'center', alignItems: 'flex-start', padding: '20px', overflowY: 'auto' }}>
      <div role="dialog" aria-modal="true" aria-label="Validation du gérant" style={{ width: '100%', maxWidth: '360px', margin: 'auto', background: '#fff', border: `1px solid ${LINE}`, borderRadius: '20px', padding: '22px', boxShadow: '0 24px 60px rgba(16,24,40,.3)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '6px' }}>
          <span className="ms" style={{ fontSize: '24px', color: '#C8891F' }}>admin_panel_settings</span>
          <div style={{ fontSize: '17px', fontWeight: 800, color: INK }}>Code du gérant</div>
        </div>
        <div style={{ fontSize: '13.5px', color: SOFT, marginBottom: '4px' }}>{demande.libelle}</div>
        {demande.montant > 0 && <div style={{ fontSize: '13.5px', color: INK, fontWeight: 700, marginBottom: '16px' }}>{fmt(demande.montant)} FCFA</div>}
        <div style={{ fontSize: '12px', color: SOFT, marginBottom: '14px', lineHeight: 1.4 }}>Le gérant ou le propriétaire tape son code. L&apos;action est enregistrée au journal avec son nom.</div>
        <PinPad onValider={valider} occupe={occupe} erreur={erreur} libelleBouton="Valider l'action" />
        <button onClick={() => fermer(null)} style={{ width: '100%', height: '42px', marginTop: '10px', border: `1px solid ${LINE}`, borderRadius: '12px', background: '#fff', color: SOFT, fontSize: '14px', fontWeight: 600, cursor: 'pointer' }}>Abandonner</button>
      </div>
    </div>
  ) : null;

  return { demander, element };
}
