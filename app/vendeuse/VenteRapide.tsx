'use client';
import { useRef, useState } from 'react';
import Recu, { type RecuData } from '../components/Recu';
import { partagerImageRecu, whatsappTexte } from '../components/recuPartage';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const inputStyle: React.CSSProperties = { height: '44px', padding: '0 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px', width: '100%' };

// Vente rapide (achat au comptoir en un coup). Extrait de l'ancienne page
// vendeuse, inchangé dans son fonctionnement — passe par /api/ventes.
export default function VenteRapide({ produits, rechargerProduits, user, isMobile, boutiqueNom }: {
  produits: any[]; rechargerProduits: () => Promise<void>; user: any; isMobile: boolean; boutiqueNom: string;
}) {
  const [panier, setPanier] = useState<any[]>([]);
  const [cliente, setCliente] = useState({ nom: '', telephone: '' });
  const [modePaiement, setModePaiement] = useState('cash');
  const [montantPaye, setMontantPaye] = useState<number | ''>('');
  const [statutPaiement, setStatutPaiement] = useState<'paye' | 'partiel'>('paye');
  const [enregistrement, setEnregistrement] = useState(false);
  const [succes, setSucces] = useState('');
  const [erreur, setErreur] = useState('');
  const [recu, setRecu] = useState<RecuData | null>(null);
  const recuRef = useRef<HTMLDivElement>(null);

  const ajouterAuPanier = (produit: any) => {
    const reel = produits.find(p => p.id === produit.id);
    if (!reel) return;
    const existant = panier.find(p => p.id === produit.id);
    if ((existant?.quantite ?? 0) >= reel.stock_restant) return;
    if (existant) setPanier(panier.map(p => p.id === produit.id ? { ...p, quantite: p.quantite + 1 } : p));
    else setPanier([...panier, { ...reel, quantite: 1 }]);
  };
  const retirerDuPanier = (id: number) => {
    const ex = panier.find(p => p.id === id);
    if (!ex) return;
    if (ex.quantite === 1) setPanier(panier.filter(p => p.id !== id));
    else setPanier(panier.map(p => p.id === id ? { ...p, quantite: p.quantite - 1 } : p));
  };
  const supprimerDuPanier = (id: number) => setPanier(panier.filter(p => p.id !== id));

  const total = panier.reduce((s, p) => s + p.prix * p.quantite, 0);
  const montantPayeNum = Number(montantPaye) || 0;
  const montantEffectif = statutPaiement === 'paye' ? total : montantPayeNum;
  const resteAPayer = Math.max(0, total - montantEffectif);
  const nbArticles = panier.reduce((s, p) => s + p.quantite, 0);

  const enregistrerVente = async () => {
    if (panier.length === 0) { setErreur('Ajoutez des produits au panier.'); return; }
    if (!cliente.nom.trim()) { setErreur('Entrez le nom de la cliente.'); return; }
    if (statutPaiement === 'partiel' && (!montantPaye || montantPayeNum <= 0)) { setErreur('Entrez le montant payé.'); return; }
    setErreur(''); setEnregistrement(true);
    try {
      const reponse = await fetch('/api/ventes', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          cliente_nom: cliente.nom, cliente_telephone: cliente.telephone || null,
          produits: panier.map(p => ({ produit_id: p.id, quantite: p.quantite })),
          statut_paiement: statutPaiement, montant_paye: statutPaiement === 'paye' ? null : montantPayeNum,
          mode_paiement: modePaiement,
        }),
      });
      const resultat = await reponse.json().catch(() => ({}));
      if (!reponse.ok) { setErreur(resultat.message || 'Erreur lors de l\'enregistrement.'); return; }

      const numero = `${new Date().getFullYear()}-${String(resultat?.id ?? '').padStart(4, '0')}`;
      setRecu({
        boutique: boutiqueNom, numero,
        date: new Date().toLocaleString('fr-FR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' }),
        vendeuse: user?.nom || '', client: cliente.nom.trim(), telephone: cliente.telephone || null,
        items: panier.map(p => ({ nom: p.nom, quantite: p.quantite, prix: p.prix })),
        total, paye: montantEffectif, reste: resteAPayer, mode: modePaiement, statut: statutPaiement,
      });
      setSucces('Vente enregistrée avec succès !');
      setPanier([]); setCliente({ nom: '', telephone: '' }); setMontantPaye(''); setStatutPaiement('paye'); setModePaiement('cash');
      await rechargerProduits();
      setTimeout(() => setSucces(''), 4000);
    } catch { setErreur('Erreur inattendue. Veuillez réessayer.'); }
    finally { setEnregistrement(false); }
  };

  return (
    <div style={{ display: 'grid', gridTemplateColumns: isMobile ? '1fr' : '1fr 380px', gap: isMobile ? '18px' : '24px', padding: isMobile ? '18px 16px' : '28px 32px', maxWidth: '1400px', margin: '0 auto' }}>
      <div>
        <div style={{ fontSize: '15px', fontWeight: 700, color: INK, marginBottom: '16px' }}>
          Sélectionner des articles <span style={{ fontSize: '13px', color: MUTE, fontWeight: 400 }}>({produits.filter(p => p.stock_restant > 0).length} disponibles)</span>
        </div>
        {succes && <div style={{ padding: '12px 16px', borderRadius: '12px', background: 'rgba(31,157,107,.12)', border: '1px solid rgba(31,157,107,.28)', color: '#1F9D6B', fontSize: '13.5px', textAlign: 'center', marginBottom: '16px', fontWeight: 600 }}>{succes}</div>}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(170px,1fr))', gap: '14px' }}>
          {produits.map(produit => {
            const qte = panier.find(p => p.id === produit.id)?.quantite ?? 0;
            const stockRestant = produit.stock_restant - qte;
            const epuise = produit.stock_restant === 0;
            const plein = qte >= produit.stock_restant;
            return (
              <div key={produit.id} style={{ padding: '14px', borderRadius: '16px', background: '#fff', border: `1px solid ${qte > 0 ? 'rgba(37,99,235,.45)' : LINE}`, boxShadow: qte > 0 ? '0 4px 14px rgba(37,99,235,.12)' : '0 3px 10px rgba(26,36,56,.04)', opacity: epuise ? 0.55 : 1 }}>
                {produit.image ? <img src={produit.image} alt={produit.nom} style={{ width: '100%', height: '84px', objectFit: 'cover', borderRadius: '12px', marginBottom: '12px' }} />
                  : <div style={{ height: '84px', borderRadius: '12px', marginBottom: '12px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms" style={{ fontSize: '32px', color: '#B7C4DE' }}>image</span></div>}
                <div style={{ fontSize: '13.5px', fontWeight: 600, color: INK, lineHeight: 1.3, marginBottom: '4px' }}>{produit.nom}</div>
                <div style={{ fontSize: '11.5px', color: epuise ? '#D24444' : stockRestant <= 2 ? '#C8891F' : MUTE, marginBottom: '8px' }}>{epuise ? 'Épuisé' : `${stockRestant} disponible${stockRestant > 1 ? 's' : ''}`}</div>
                <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
                  <span style={{ fontSize: '13.5px', fontWeight: 700, color: BLUE }}>{fmt(produit.prix)} FCFA</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                    {qte > 0 && <>
                      <button onClick={() => retirerDuPanier(produit.id)} style={{ width: '28px', height: '28px', borderRadius: '8px', border: 'none', cursor: 'pointer', background: '#EEF3FC', color: BLUE, display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms" style={{ fontSize: '16px' }}>remove</span></button>
                      <span style={{ fontSize: '13px', fontWeight: 700, color: BLUE, minWidth: '16px', textAlign: 'center' }}>{qte}</span>
                    </>}
                    <button onClick={() => ajouterAuPanier(produit)} disabled={epuise || plein} style={{ width: '32px', height: '32px', borderRadius: '10px', border: 'none', cursor: epuise || plein ? 'not-allowed' : 'pointer', background: epuise || plein ? '#EEF1F7' : GRAD, color: epuise || plein ? '#B7C4DE' : '#fff', display: 'flex', alignItems: 'center', justifyContent: 'center' }}><span className="ms" style={{ fontSize: '20px' }}>add</span></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      </div>

      <div style={{ position: isMobile ? 'static' : 'sticky', top: '84px', padding: '24px', borderRadius: '18px', background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 8px 24px rgba(26,36,56,.07)', height: 'fit-content' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '18px' }}>
          <span className="ms" style={{ fontSize: '22px', color: BLUE }}>shopping_bag</span>
          <span style={{ fontSize: '16px', fontWeight: 700, color: INK }}>Panier</span>
          {nbArticles > 0 && <span style={{ marginLeft: 'auto', fontSize: '12px', fontWeight: 700, color: BLUE, background: '#EEF3FC', padding: '3px 10px', borderRadius: '20px' }}>{nbArticles} article{nbArticles > 1 ? 's' : ''}</span>}
        </div>
        {erreur && <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(210,68,68,.10)', border: '1px solid rgba(210,68,68,.25)', color: '#D24444', fontSize: '12.5px', marginBottom: '14px', textAlign: 'center' }}>{erreur}</div>}
        {panier.length === 0 ? (
          <div style={{ textAlign: 'center', padding: '24px 0', color: '#B7C4DE', fontSize: '13px' }}><span className="ms" style={{ fontSize: '36px', display: 'block', marginBottom: '8px' }}>shopping_cart</span>Panier vide</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '10px', marginBottom: '16px', maxHeight: '200px', overflowY: 'auto', paddingRight: '4px' }}>
            {panier.map(p => (
              <div key={p.id} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '30px', height: '30px', borderRadius: '9px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: 700, color: BLUE, flexShrink: 0 }}>{p.quantite}</div>
                <div style={{ flex: 1, minWidth: 0, fontSize: '13.5px', fontWeight: 500, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{p.nom}</div>
                <div style={{ fontSize: '13.5px', fontWeight: 700, color: INK, flexShrink: 0 }}>{fmt(p.prix * p.quantite)}</div>
                <button onClick={() => supprimerDuPanier(p.id)} style={{ background: 'transparent', border: 'none', cursor: 'pointer', color: '#D24444', padding: '4px', display: 'flex' }}><span className="ms" style={{ fontSize: '16px' }}>close</span></button>
              </div>
            ))}
          </div>
        )}
        <div style={{ height: '1px', background: LINE, margin: '4px 0 16px' }} />
        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase', marginBottom: '10px' }}>Informations cliente</div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '8px', marginBottom: '16px' }}>
          <input style={inputStyle} placeholder="Nom de la cliente *" value={cliente.nom} onChange={e => setCliente({ ...cliente, nom: e.target.value })} />
          <input style={inputStyle} placeholder="Téléphone (optionnel)" value={cliente.telephone} onChange={e => setCliente({ ...cliente, telephone: e.target.value })} />
        </div>
        <div style={{ display: 'flex', gap: '8px', marginBottom: '14px' }}>
          {([['paye', 'check_circle', 'Payé complet'], ['partiel', 'schedule', 'Partiel']] as const).map(([val, icon, label]) => (
            <button key={val} onClick={() => setStatutPaiement(val)} style={{ flex: 1, height: '42px', borderRadius: '11px', display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '7px', cursor: 'pointer', fontSize: '13px', fontWeight: 600, background: statutPaiement === val ? '#EEF3FC' : '#fff', border: `1px solid ${statutPaiement === val ? 'rgba(37,99,235,.45)' : '#E4E9F2'}`, color: statutPaiement === val ? BLUE : SOFT }}>
              <span className="ms" style={{ fontSize: '18px' }}>{icon}</span>{label}
            </button>
          ))}
        </div>
        <div style={{ display: 'flex', gap: '6px', marginBottom: '14px' }}>
          {[['cash', 'Cash'], ['mobile_money', 'Mobile Money'], ['orange_money', 'Orange']].map(([val, label]) => (
            <button key={val} onClick={() => setModePaiement(val)} style={{ flex: 1, height: '36px', borderRadius: '10px', border: `1px solid ${modePaiement === val ? 'rgba(37,99,235,.45)' : '#E4E9F2'}`, background: modePaiement === val ? '#EEF3FC' : '#fff', color: modePaiement === val ? BLUE : SOFT, fontSize: '11.5px', fontWeight: 600, cursor: 'pointer' }}>{label}</button>
          ))}
        </div>
        {statutPaiement === 'partiel' && (
          <div style={{ marginBottom: '14px' }}>
            <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.4px', color: SOFT, textTransform: 'uppercase', marginBottom: '6px' }}>Montant payé (FCFA) *</div>
            <input type="number" style={inputStyle} placeholder="0" value={montantPaye} onChange={e => setMontantPaye(e.target.value === '' ? '' : Number(e.target.value))} min="0" />
            {montantPayeNum > 0 && resteAPayer > 0 && <div style={{ marginTop: '8px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(200,137,31,.14)', border: '1px solid rgba(200,137,31,.3)', fontSize: '13px', color: '#C8891F', fontWeight: 600 }}>Reste à payer : {fmt(resteAPayer)} FCFA</div>}
          </div>
        )}
        {statutPaiement === 'paye' && montantPayeNum > total && <div style={{ marginBottom: '14px', padding: '10px 14px', borderRadius: '10px', background: 'rgba(31,157,107,.12)', border: '1px solid rgba(31,157,107,.28)', fontSize: '13px', color: '#1F9D6B', fontWeight: 600 }}>Monnaie à rendre : {fmt(montantPayeNum - total)} FCFA</div>}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', padding: '14px 0', marginBottom: '14px', borderTop: `1px solid ${LINE}` }}>
          <span style={{ fontSize: '14px', color: SOFT }}>Total</span>
          <span><span style={{ fontSize: '28px', fontWeight: 800, color: INK }}>{fmt(total)}</span><span style={{ fontSize: '13px', color: BLUE, fontWeight: 700, marginLeft: '5px' }}>FCFA</span></span>
        </div>
        <button onClick={enregistrerVente} disabled={enregistrement || panier.length === 0} style={{ width: '100%', height: '52px', border: 'none', borderRadius: '15px', cursor: enregistrement || panier.length === 0 ? 'not-allowed' : 'pointer', background: panier.length === 0 ? '#C7D6F5' : GRAD, color: '#fff', fontSize: '15px', fontWeight: 700, boxShadow: panier.length > 0 ? '0 8px 18px rgba(37,99,235,.28)' : 'none', opacity: enregistrement ? 0.7 : 1 }}>
          {enregistrement ? 'Enregistrement...' : 'Valider la vente'}
        </button>
      </div>

      {recu && (
        <div style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(16,24,40,.5)', display: 'flex', justifyContent: 'center', padding: '20px', overflowY: 'auto' }}>
          <div style={{ width: '100%', maxWidth: '400px', margin: 'auto', display: 'flex', flexDirection: 'column', gap: '14px' }}>
            <div style={{ display: 'flex', justifyContent: 'center', overflowX: 'auto' }}>
              <div ref={recuRef} style={{ borderRadius: '16px', overflow: 'hidden', boxShadow: '0 20px 50px rgba(16,24,40,.28)' }}><Recu data={recu} /></div>
            </div>
            <button onClick={async () => { if (recuRef.current) await partagerImageRecu(recuRef.current, recu); }} style={{ height: '52px', border: 'none', borderRadius: '14px', cursor: 'pointer', background: GRAD, color: '#fff', fontSize: '15px', fontWeight: 700, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '9px', boxShadow: '0 8px 18px rgba(37,99,235,.28)' }}><span className="ms" style={{ fontSize: '20px' }}>ios_share</span>Partager le reçu (WhatsApp)</button>
            <button onClick={() => whatsappTexte(recu)} style={{ height: '46px', border: '1px solid rgba(37,99,235,.3)', borderRadius: '13px', cursor: 'pointer', background: '#fff', color: BLUE, fontSize: '13.5px', fontWeight: 600, display: 'flex', alignItems: 'center', justifyContent: 'center', gap: '8px' }}><span className="ms" style={{ fontSize: '18px' }}>chat</span>Envoyer en texte</button>
            <button onClick={() => setRecu(null)} style={{ height: '46px', border: `1px solid ${LINE}`, borderRadius: '13px', cursor: 'pointer', background: '#fff', color: SOFT, fontSize: '14px', fontWeight: 600 }}>Nouvelle vente</button>
          </div>
        </div>
      )}
    </div>
  );
}
