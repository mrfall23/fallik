'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useUtilisateur, seDeconnecter } from '@/lib/utilisateur';
import { FalloraLogo } from '../components/Logo';
import { useIsMobile } from '../components/useMediaQuery';
import VenteRapide from './VenteRapide';
import FactureDetail from './FactureDetail';

export default function VendeusePage() {
  const { utilisateur: user } = useUtilisateur();
  const isMobile = useIsMobile();
  const [produits, setProduits] = useState<any[]>([]);
  const [factures, setFactures] = useState<any[]>([]);
  const [boutiqueNom, setBoutiqueNom] = useState('Ma boutique');
  const [chargement, setChargement] = useState(true);
  const [vue, setVue] = useState<'factures' | 'rapide'>('factures');
  const [factureActive, setFactureActive] = useState<number | null>(null);
  const [saisieNom, setSaisieNom] = useState(false);
  const [nomClient, setNomClient] = useState('');
  const [erreur, setErreur] = useState('');

  const chargerProduits = async () => {
    const { data } = await supabase.from('produits').select('*').order('nom');
    setProduits(data || []);
  };
  const chargerFactures = async () => {
    const { data } = await supabase
      .from('factures')
      .select('id, nom_client, total, created_at, facture_lignes(quantite)')
      .eq('statut', 'ouverte')
      .order('created_at', { ascending: false });
    setFactures(data || []);
  };

  useEffect(() => {
    (async () => {
      const { data: org } = await supabase.from('organisations').select('nom').limit(1).single();
      if (org?.nom) setBoutiqueNom(org.nom);
      await Promise.all([chargerProduits(), chargerFactures()]);
      setChargement(false);
    })();
  }, []);

  const creerFacture = async () => {
    if (!nomClient.trim()) return;
    setErreur('');
    const { data, error } = await supabase.rpc('ouvrir_facture', { p_nom_client: nomClient.trim() });
    if (error) { setErreur(error.message || 'Erreur.'); return; }
    setNomClient(''); setSaisieNom(false);
    await chargerFactures();
    setFactureActive(data);
  };

  const revenir = async () => {
    setFactureActive(null);
    await Promise.all([chargerProduits(), chargerFactures()]);
  };

  const nbArticles = (f: any) => (f.facture_lignes || []).reduce((s: number, l: any) => s + (l.quantite || 0), 0);

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: isMobile ? '14px 16px' : '16px 32px', background: 'rgba(236,229,214,.85)', backdropFilter: 'blur(16px)', borderBottom: '1px solid var(--line)' }}>
        <FalloraLogo layout="row" markSize={32} wordSize={22} tagline={boutiqueNom} />
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexShrink: 0 }}>
          {user && !isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '8px 14px', borderRadius: '12px', background: 'var(--surface)', border: '1px solid var(--line)' }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: 'var(--avatar)', display: 'flex', alignItems: 'center', justifyContent: 'center', border: '1px solid var(--accent-20)' }}>
                <span style={{ fontFamily: 'var(--font-cormorant), serif', fontSize: '14px', color: 'var(--accent)', fontWeight: 600 }}>{user.nom?.[0]?.toUpperCase()}</span>
              </div>
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: 'var(--ink)' }}>{user.nom}</span>
            </div>
          )}
          <button onClick={seDeconnecter} aria-label="Se déconnecter" style={{ background: 'transparent', border: '1px solid var(--line)', borderRadius: '10px', padding: '8px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--ink-55)', fontSize: '13px' }}>
            <span className="ms" style={{ fontSize: '18px' }}>logout</span>
          </button>
        </div>
      </header>

      {chargement ? (
        <div style={{ textAlign: 'center', padding: '80px', color: 'var(--ink-45)' }}>Chargement…</div>
      ) : factureActive ? (
        <FactureDetail factureId={factureActive} produits={produits} rechargerProduits={chargerProduits} user={user} isMobile={isMobile} boutiqueNom={boutiqueNom} onRetour={revenir} />
      ) : (
        <>
          {/* Bascule */}
          <div style={{ display: 'flex', gap: '8px', padding: isMobile ? '16px 16px 0' : '22px 32px 0', maxWidth: '1400px', margin: '0 auto' }}>
            {(['factures', 'rapide'] as const).map(v => (
              <button key={v} onClick={() => setVue(v)} style={{ height: '42px', padding: '0 18px', borderRadius: '12px', border: `1px solid ${vue === v ? 'var(--accent-30)' : 'var(--line)'}`, cursor: 'pointer', fontSize: '13.5px', fontWeight: 700, background: vue === v ? 'var(--accent-12)' : 'var(--surface)', color: vue === v ? 'var(--accent-deep)' : 'var(--ink-55)', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="ms" style={{ fontSize: '19px' }}>{v === 'factures' ? 'receipt_long' : 'bolt'}</span>
                {v === 'factures' ? 'Factures ouvertes' : 'Vente rapide'}
              </button>
            ))}
          </div>

          {vue === 'rapide' ? (
            <VenteRapide produits={produits} rechargerProduits={chargerProduits} user={user} isMobile={isMobile} boutiqueNom={boutiqueNom} />
          ) : (
            <div style={{ padding: isMobile ? '16px' : '22px 32px', maxWidth: '1400px', margin: '0 auto' }}>
              {/* Nouvelle facture */}
              {saisieNom ? (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', maxWidth: '460px' }}>
                  <input autoFocus value={nomClient} onChange={e => setNomClient(e.target.value)} onKeyDown={e => e.key === 'Enter' && creerFacture()} placeholder="Nom / Table (ex. Table 4)" style={{ flex: 1, height: '48px', padding: '0 16px', borderRadius: '13px', background: 'var(--surface-inset)', border: '1px solid var(--line)', outline: 'none', color: 'var(--ink)', fontSize: '15px' }} />
                  <button onClick={creerFacture} style={{ height: '48px', padding: '0 20px', border: 'none', borderRadius: '13px', cursor: 'pointer', background: 'var(--accent-grad)', color: 'var(--on-accent)', fontWeight: 700, fontSize: '14px' }}>Ouvrir</button>
                  <button onClick={() => { setSaisieNom(false); setNomClient(''); setErreur(''); }} aria-label="Annuler" style={{ width: '48px', height: '48px', border: '1px solid var(--line)', borderRadius: '13px', cursor: 'pointer', background: 'transparent', color: 'var(--ink-55)', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms">close</span></button>
                </div>
              ) : (
                <button onClick={() => setSaisieNom(true)} style={{ display: 'flex', alignItems: 'center', gap: '9px', height: '48px', padding: '0 22px', border: 'none', borderRadius: '14px', cursor: 'pointer', background: 'var(--accent-grad)', color: 'var(--on-accent)', fontSize: '14.5px', fontWeight: 700, boxShadow: 'var(--shadow-accent)', marginBottom: '18px' }}>
                  <span className="ms" style={{ fontSize: '21px' }}>add</span>Nouvelle facture
                </button>
              )}
              {erreur && <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'var(--danger-tint)', border: '1px solid var(--danger-line)', color: 'var(--danger)', fontSize: '13px', marginBottom: '14px', maxWidth: '460px' }}>{erreur}</div>}

              {/* Cartes des factures ouvertes */}
              {factures.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: 'var(--ink-45)' }}>
                  <span className="ms" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: 'var(--accent-30)' }}>receipt_long</span>
                  Aucune facture ouverte. Cliquez sur « Nouvelle facture ».
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '14px' }}>
                  {factures.map(f => (
                    <button key={f.id} onClick={() => setFactureActive(f.id)} style={{ textAlign: 'left', padding: '18px', borderRadius: '18px', background: 'var(--surface)', border: '1px solid var(--accent-20)', cursor: 'pointer', boxShadow: 'var(--shadow-md)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: 'var(--success)', flexShrink: 0 }} />
                        <span style={{ fontSize: '16px', fontWeight: 700, color: 'var(--ink)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nom_client}</span>
                      </div>
                      <div style={{ fontSize: '12.5px', color: 'var(--ink-45)', marginBottom: '12px' }}>{nbArticles(f)} article{nbArticles(f) > 1 ? 's' : ''}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <span><span style={{ fontSize: '22px', fontWeight: 800, color: 'var(--ink)' }}>{Number(f.total).toLocaleString()}</span><span style={{ fontSize: '11px', color: 'var(--accent)', fontWeight: 700, marginLeft: '3px' }}>FCFA</span></span>
                        <span style={{ fontSize: '12.5px', fontWeight: 700, color: 'var(--accent-deep)', display: 'flex', alignItems: 'center', gap: '2px' }}>Ouvrir<span className="ms" style={{ fontSize: '17px' }}>chevron_right</span></span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}
    </div>
  );
}
