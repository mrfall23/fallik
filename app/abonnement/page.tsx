'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { seDeconnecter } from '@/lib/utilisateur';
import { accueilPourRole, LIBELLES_STATUT, PLANS, type Acces } from '@/lib/roles';
import { FallikLogo } from '../components/Logo';

// Ecran affiche quand la boutique n'est plus accessible (desactivee,
// abonnement suspendu, resilie ou expire). Les donnees restent intactes en
// base : elles sont simplement bloquees par la RLS tant que l'acces n'est pas
// retabli par Fall Digital.

const CONTACT = process.env.NEXT_PUBLIC_CONTACT_WHATSAPP || '';

export default function AbonnementPage() {
  const router = useRouter();
  const [etat, setEtat] = useState<Acces | null>(null);
  const [charge, setCharge] = useState(false);

  useEffect(() => {
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }
      const { data } = await supabase.rpc('mon_acces');
      const a = data as Acces | null;
      if (a?.acces) { router.replace(accueilPourRole(a.role)); return; }
      setEtat(a);
      setCharge(true);
    })();
  }, [router]);

  if (!charge) return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />;

  const proprietaire = etat?.role === 'proprietaire';
  const expire = etat?.date_expiration ? new Date(etat.date_expiration) : null;
  const raison = !etat
    ? "Votre compte n'est rattaché à aucune boutique."
    : !etat.compte_actif
      ? 'Votre compte a été désactivé par la boutique.'
      : !etat.organisation_active
        ? 'Cette boutique a été désactivée.'
        : etat.statut === 'suspendu' || etat.statut === 'resilie'
          ? `Abonnement ${LIBELLES_STATUT[etat.statut].toLowerCase()}.`
          : `L'abonnement a expiré${expire ? ` le ${expire.toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' })}` : ''}.`;

  const message = encodeURIComponent(`Bonjour Fall Digital, je souhaite renouveler l'abonnement Fallik de la boutique « ${etat?.organisation || ''} ».`);

  return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '24px 16px', background: 'var(--bg)' }}>
      <div style={{ width: '100%', maxWidth: '460px', background: '#fff', borderRadius: '20px', border: '1px solid #EAEEF5', boxShadow: '0 12px 40px rgba(26,36,56,.08)', padding: '32px 28px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', marginBottom: '26px' }}>
          <FallikLogo size={42} shadow />
          <div style={{ fontSize: '18px', fontWeight: 800, color: '#1A2438' }}>{etat?.organisation || 'Fallik'}</div>
        </div>

        <div style={{ width: '54px', height: '54px', borderRadius: '16px', background: 'rgba(200,137,31,.14)', display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: '16px' }}>
          <span className="ms" style={{ fontSize: '30px', color: '#C8891F' }}>lock_clock</span>
        </div>
        <div style={{ fontSize: '22px', fontWeight: 800, color: '#1A2438', marginBottom: '8px' }}>Accès suspendu</div>
        <div style={{ fontSize: '14.5px', color: '#5A6478', lineHeight: 1.55, marginBottom: '18px' }}>
          {raison} Vos données sont conservées et seront de nouveau accessibles dès le renouvellement.
        </div>

        {proprietaire && etat?.plan && (
          <div style={{ padding: '14px 16px', borderRadius: '14px', background: '#F4F6FB', border: '1px solid #EAEEF5', fontSize: '13.5px', color: '#1A2438', marginBottom: '18px' }}>
            Offre <b>{PLANS[etat.plan]?.nom || etat.plan}</b> — {(PLANS[etat.plan]?.prix || 0).toLocaleString('fr-FR')} FCFA / mois
          </div>
        )}
        {!proprietaire && etat && (
          <div style={{ fontSize: '13.5px', color: '#8A94A6', marginBottom: '18px' }}>Prévenez le propriétaire de la boutique.</div>
        )}

        {proprietaire && CONTACT && (
          <a href={`https://wa.me/${CONTACT}?text=${message}`} target="_blank" rel="noopener noreferrer"
            style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px', height: '48px', borderRadius: '13px', background: '#1F9D6B', color: '#fff', fontWeight: 700, fontSize: '14.5px', textDecoration: 'none', marginBottom: '10px' }}>
            <span className="ms" style={{ fontSize: '20px' }}>chat</span>Renouveler avec Fall Digital
          </a>
        )}
        <button onClick={seDeconnecter} style={{ width: '100%', height: '48px', border: '1px solid #E1E7F2', borderRadius: '13px', cursor: 'pointer', background: '#fff', color: '#1A2438', fontSize: '14.5px', fontWeight: 600 }}>
          Se déconnecter
        </button>
      </div>
    </div>
  );
}
