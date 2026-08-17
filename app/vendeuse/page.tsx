'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';
import { useUtilisateur, seDeconnecter } from '@/lib/utilisateur';
import { useIsMobile } from '../components/useMediaQuery';
import { FallikLogo } from '../components/Logo';
import VenteRapide from './VenteRapide';
import FactureDetail from './FactureDetail';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';

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
    <div style={{ minHeight: '100vh', background: '#F4F6FB' }}>
      {/* Header */}
      <header style={{ position: 'sticky', top: 0, zIndex: 10, display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: '12px', padding: isMobile ? '12px 16px' : '14px 28px', background: '#fff', borderBottom: `1px solid ${LINE}` }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', minWidth: 0 }}>
          <FallikLogo size={40} shadow />
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: '17px', fontWeight: 800, color: INK, lineHeight: 1 }}>Fallik</div>
            <div style={{ fontSize: '11.5px', fontWeight: 600, color: MUTE, marginTop: '3px', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{boutiqueNom}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', flexShrink: 0 }}>
          {user && !isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', padding: '7px 14px 7px 8px', borderRadius: '12px', background: '#F6F8FC', border: `1px solid ${LINE}` }}>
              <div style={{ width: '28px', height: '28px', borderRadius: '8px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 800, color: BLUE }}>{user.nom?.[0]?.toUpperCase()}</div>
              <span style={{ fontSize: '13.5px', fontWeight: 600, color: INK }}>{user.nom}</span>
            </div>
          )}
          <button onClick={seDeconnecter} aria-label="Se déconnecter" style={{ background: '#fff', border: `1px solid ${LINE}`, borderRadius: '10px', padding: '9px 12px', cursor: 'pointer', display: 'flex', alignItems: 'center', color: SOFT }}>
            <span className="ms" style={{ fontSize: '18px' }}>logout</span>
          </button>
        </div>
      </header>

      {chargement ? (
        <div style={{ textAlign: 'center', padding: '80px', color: MUTE }}>Chargement…</div>
      ) : factureActive ? (
        <FactureDetail factureId={factureActive} produits={produits} rechargerProduits={chargerProduits} user={user} isMobile={isMobile} boutiqueNom={boutiqueNom} onRetour={revenir} />
      ) : (
        <>
          {/* Bascule */}
          <div style={{ display: 'flex', padding: isMobile ? '16px 16px 0' : '22px 32px 0', maxWidth: '1400px', margin: '0 auto' }}>
            <div style={{ display: 'flex', gap: '2px', background: '#EEF1F7', borderRadius: '13px', padding: '4px' }}>
              {(['factures', 'rapide'] as const).map(v => (
                <button key={v} onClick={() => setVue(v)} style={{ height: '40px', padding: '0 18px', borderRadius: '10px', border: 'none', cursor: 'pointer', fontSize: '13.5px', fontWeight: 700, background: vue === v ? '#fff' : 'transparent', color: vue === v ? BLUE : SOFT, boxShadow: vue === v ? '0 1px 3px rgba(26,36,56,.12)' : 'none', display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span className="ms" style={{ fontSize: '19px' }}>{v === 'factures' ? 'receipt_long' : 'bolt'}</span>
                  {v === 'factures' ? 'Factures ouvertes' : 'Vente rapide'}
                </button>
              ))}
            </div>
          </div>

          {vue === 'rapide' ? (
            <VenteRapide produits={produits} rechargerProduits={chargerProduits} user={user} isMobile={isMobile} boutiqueNom={boutiqueNom} />
          ) : (
            <div style={{ padding: isMobile ? '16px' : '22px 32px', maxWidth: '1400px', margin: '0 auto' }}>
              {/* Nouvelle facture */}
              {saisieNom ? (
                <div style={{ display: 'flex', gap: '8px', marginBottom: '18px', maxWidth: '460px' }}>
                  <input autoFocus value={nomClient} onChange={e => setNomClient(e.target.value)} onKeyDown={e => e.key === 'Enter' && creerFacture()} placeholder="Nom / Table (ex. Table 4)" style={{ flex: 1, height: '48px', padding: '0 16px', borderRadius: '13px', background: '#fff', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '15px' }} />
                  <button onClick={creerFacture} style={{ height: '48px', padding: '0 20px', border: 'none', borderRadius: '13px', cursor: 'pointer', background: GRAD, color: '#fff', fontWeight: 700, fontSize: '14px' }}>Ouvrir</button>
                  <button onClick={() => { setSaisieNom(false); setNomClient(''); setErreur(''); }} aria-label="Annuler" style={{ width: '48px', height: '48px', border: `1px solid ${LINE}`, borderRadius: '13px', cursor: 'pointer', background: '#fff', color: SOFT, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms">close</span></button>
                </div>
              ) : (
                <button onClick={() => setSaisieNom(true)} style={{ display: 'flex', alignItems: 'center', gap: '9px', height: '48px', padding: '0 22px', border: 'none', borderRadius: '14px', cursor: 'pointer', background: GRAD, color: '#fff', fontSize: '14.5px', fontWeight: 700, boxShadow: '0 8px 18px rgba(37,99,235,.28)', marginBottom: '18px' }}>
                  <span className="ms" style={{ fontSize: '21px' }}>add</span>Nouvelle facture
                </button>
              )}
              {erreur && <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(210,68,68,.10)', border: '1px solid rgba(210,68,68,.25)', color: '#D24444', fontSize: '13px', marginBottom: '14px', maxWidth: '460px' }}>{erreur}</div>}

              {/* Cartes des factures ouvertes */}
              {factures.length === 0 ? (
                <div style={{ textAlign: 'center', padding: '60px', color: MUTE }}>
                  <span className="ms" style={{ fontSize: '48px', display: 'block', marginBottom: '12px', color: '#C6D2E8' }}>receipt_long</span>
                  Aucune facture ouverte. Cliquez sur « Nouvelle facture ».
                </div>
              ) : (
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(220px,1fr))', gap: '14px' }}>
                  {factures.map(f => (
                    <button key={f.id} onClick={() => setFactureActive(f.id)} style={{ textAlign: 'left', padding: '18px', borderRadius: '18px', background: '#fff', border: `1px solid ${LINE}`, cursor: 'pointer', boxShadow: '0 6px 20px rgba(26,36,56,.05)' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '7px', marginBottom: '10px' }}>
                        <span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#1F9D6B', flexShrink: 0 }} />
                        <span style={{ fontSize: '16px', fontWeight: 700, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{f.nom_client}</span>
                      </div>
                      <div style={{ fontSize: '12.5px', color: MUTE, marginBottom: '12px' }}>{nbArticles(f)} article{nbArticles(f) > 1 ? 's' : ''}</div>
                      <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between' }}>
                        <span><span style={{ fontSize: '22px', fontWeight: 800, color: INK }}>{fmt(f.total)}</span><span style={{ fontSize: '11px', color: BLUE, fontWeight: 700, marginLeft: '3px' }}>FCFA</span></span>
                        <span style={{ fontSize: '12.5px', fontWeight: 700, color: BLUE, display: 'flex', alignItems: 'center', gap: '2px' }}>Ouvrir<span className="ms" style={{ fontSize: '17px' }}>chevron_right</span></span>
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
