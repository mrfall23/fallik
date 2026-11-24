'use client';
import { useRef, useState } from 'react';
import Recu, { type RecuData } from './Recu';
import { partagerImageRecu, whatsappTexte, telechargerPdfRecu } from './recuPartage';
import type { Boutique } from '@/lib/boutique';

const BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', SOFT = '#8A94A6', LINE = '#EAEEF5';

// Fenetre du recu + envoi (image WhatsApp, texte, PDF). Partagee entre
// l'espace vendeuse (apres une vente, « Mes ventes ») et l'espace gerant.
export default function RecuModal({ data, onClose, libelleFermer = 'Fermer' }: {
  data: RecuData; onClose: () => void; libelleFermer?: string;
}) {
  const recuRef = useRef<HTMLDivElement>(null);
  const [erreur, setErreur] = useState('');
  const bouton: React.CSSProperties = { flex: 1, height: '46px', border: '1px solid rgba(37,99,235,.3)', borderRadius: '13px', cursor: 'pointer', background: '#fff', color: BLUE, fontSize: '13.5px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' };

  return (
    <div style={{ position: 'fixed', inset: 0, zIndex: 60, background: 'rgba(16,24,40,.5)', display: 'flex', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
      <div role="dialog" aria-modal="true" aria-label="Reçu" style={{ width: '100%', maxWidth: '400px', margin: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
          <div ref={recuRef} style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 20px 50px rgba(16,24,40,.28)' }}><Recu data={data} /></div>
        </div>
        <button onClick={async () => { if (recuRef.current) await partagerImageRecu(recuRef.current, data); }} style={{ height: '52px', border: 'none', borderRadius: '14px', cursor: 'pointer', background: GRAD, color: '#fff', fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', boxShadow: '0 8px 18px rgba(37,99,235,.28)' }}>
          <span className="ms" style={{ fontSize: '20px' }}>ios_share</span>Partager le reçu (WhatsApp)
        </button>
        <div style={{ display: 'flex', gap: '10px' }}>
          <button onClick={() => whatsappTexte(data)} style={bouton}><span className="ms" style={{ fontSize: '18px' }}>chat</span>Texte</button>
          <button onClick={async () => { setErreur(''); if (recuRef.current && !(await telechargerPdfRecu(recuRef.current, data))) setErreur('Échec de la création du PDF.'); }} style={bouton}>
            <span className="ms" style={{ fontSize: '18px' }}>picture_as_pdf</span>PDF
          </button>
        </div>
        {erreur && <div role="alert" style={{ color: '#fff', background: '#D24444', borderRadius: '10px', padding: '8px 12px', fontSize: '13px', textAlign: 'center' }}>{erreur}</div>}
        <button onClick={onClose} style={{ height: '46px', border: `1px solid ${LINE}`, borderRadius: '13px', cursor: 'pointer', background: '#fff', color: SOFT, fontSize: '14px', fontWeight: 600 }}>{libelleFermer}</button>
      </div>
    </div>
  );
}

/** En-tete du recu tire des reglages de la boutique. */
export function enteteRecu(b: Pick<Boutique, 'nom' | 'logo_url' | 'telephone' | 'adresse' | 'devise'> | null) {
  return {
    boutique: b?.nom || 'Ma boutique',
    logo: b?.logo_url || null,
    contact: [b?.telephone, b?.adresse].filter(Boolean).join(' · ') || null,
    devise: b?.devise || 'FCFA',
  };
}
export type EnteteRecu = ReturnType<typeof enteteRecu>;

const formatDate = (d: Date) => d.toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
export const numeroRecu = (id: number | string, d = new Date()) => `${d.getFullYear()}-${String(id).padStart(4, '0')}`;
export const dateRecu = (d = new Date()) => formatDate(d);

// Recu reconstruit depuis une vente enregistree. Reflete l'etat ACTUEL de la
// vente (acomptes inclus).
export function recuDepuisVente(v: {
  id: number; date_vente: string; total: number; montant_paye: number; reste_a_payer: number; statut_paiement: string;
  vendeuseNom?: string | null; clienteNom?: string | null; clienteTelephone?: string | null;
  items: { nom: string; quantite: number; prix: number }[]; mode?: string | null;
}, entete: EnteteRecu): RecuData {
  const d = new Date(v.date_vente);
  return {
    ...entete,
    numero: numeroRecu(v.id, d),
    date: formatDate(d),
    vendeuse: v.vendeuseNom || '',
    client: v.clienteNom || 'Client',
    telephone: v.clienteTelephone || null,
    items: v.items,
    total: Number(v.total) || 0,
    paye: Number(v.montant_paye) || 0,
    reste: Number(v.reste_a_payer) || 0,
    mode: v.mode || 'cash',
    statut: v.statut_paiement,
  };
}
