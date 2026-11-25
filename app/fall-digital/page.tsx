'use client';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from '@/lib/supabase';
import { seDeconnecter } from '@/lib/utilisateur';
import { FallikLogo } from '../components/Logo';
import { PLANS, LIBELLES_STATUT } from '@/lib/roles';

// Console Fall Digital : toutes les boutiques, leurs abonnements, et les
// actions de gestion (prolonger apres paiement, changer de plan, suspendre).
// Toutes les donnees viennent des RPC sa_* : la base refuse quiconque n'est
// pas dans super_admins. Seuls des chiffres agreges sont visibles.

const fmt = (n: unknown) => Math.round(Number(n) || 0).toLocaleString('fr-FR');
const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', LINE = '#EAEEF5';
const VERT = '#1F9D6B', ROUGE = '#D24444', ORANGE = '#B26A00';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)', padding: '18px 20px' };
const champ: React.CSSProperties = { height: '40px', padding: '0 12px', borderRadius: '11px', background: '#fff', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '13.5px', width: '100%' };
const bouton: React.CSSProperties = { display: 'inline-flex', alignItems: 'center', justifyContent: 'center', gap: '6px', height: '36px', padding: '0 12px', borderRadius: '10px', fontSize: '13px', fontWeight: 700, cursor: 'pointer' };
const label: React.CSSProperties = { display: 'block', fontSize: '11px', fontWeight: 700, color: '#8A94A6', letterSpacing: '.4px', margin: '10px 0 5px' };
const MODES: [string, string][] = [['mobile_money', 'Mobile Money'], ['orange_money', 'Orange Money'], ['cash', 'Espèces'], ['virement', 'Virement'], ['offert', 'Offert']];

type Boutique = {
  id: number; nom: string; actif: boolean; cree_le: string; telephone: string | null;
  plan: string | null; statut: string | null; date_expiration: string | null; note: string | null; accessible: boolean;
  proprietaire: { nom: string; email: string } | null; nb_vendeuses: number; nb_comptes: number; nb_produits: number;
  ventes_30j: number; ca_30j: number; derniere_vente: string | null; site_actif: boolean; total_paye: number;
};
type Tableau = Record<string, number>;
type Historique = {
  paiements: { id: number; montant: number; mode: string; reference: string | null; plan: string; mois: number; au: string; cree_le: string }[];
  changements: { id: number; action: string; note: string | null; avant: Record<string, unknown> | null; apres: Record<string, unknown> | null; cree_le: string }[];
};
type Modale = { type: 'prolonger' | 'modifier' | 'historique'; b: Boutique } | null;

const jours = (d: string | null) => d ? Math.ceil((new Date(d).getTime() - Date.now()) / 86400000) : null;
const dateFr = (d: string | null) => d ? new Date(d).toLocaleDateString('fr-FR', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';

export default function ConsoleFallDigital() {
  const router = useRouter();
  const [autorise, setAutorise] = useState<boolean | null>(null);
  const [boutiques, setBoutiques] = useState<Boutique[]>([]);
  const [tableau, setTableau] = useState<Tableau | null>(null);
  const [recherche, setRecherche] = useState('');
  const [filtre, setFiltre] = useState('toutes');
  const [modale, setModale] = useState<Modale>(null);
  const [histo, setHisto] = useState<Historique | null>(null);
  const [form, setForm] = useState({ mois: '1', montant: '', mode: 'mobile_money', reference: '', plan: 'solo', statut: 'actif', expiration: '', note: '' });
  const [occupe, setOccupe] = useState(false);
  const [message, setMessage] = useState<{ ok: boolean; texte: string } | null>(null);

  const lire = useCallback(async () => {
    const [b, t] = await Promise.all([supabase.rpc('sa_boutiques'), supabase.rpc('sa_tableau')]);
    return { b: (b.data || []) as Boutique[], t: (t.data || null) as Tableau | null, erreur: b.error?.message || t.error?.message };
  }, []);

  useEffect(() => {
    let annule = false;
    (async () => {
      const { data: { user } } = await supabase.auth.getUser();
      if (!user) { router.replace('/'); return; }
      const { data } = await supabase.rpc('suis_super_admin');
      if (annule) return;
      if (data !== true) { setAutorise(false); return; }
      const r = await lire();
      if (annule) return;
      setBoutiques(r.b); setTableau(r.t); setAutorise(true);
    })();
    return () => { annule = true; };
  }, [lire, router]);

  const recharger = async () => { const r = await lire(); setBoutiques(r.b); setTableau(r.t); if (r.erreur) setMessage({ ok: false, texte: r.erreur }); };

  const liste = useMemo(() => {
    const t = recherche.trim().toLowerCase();
    return boutiques.filter(b => {
      if (t && !`${b.nom} ${b.proprietaire?.nom || ''} ${b.proprietaire?.email || ''} ${b.telephone || ''}`.toLowerCase().includes(t)) return false;
      const j = jours(b.date_expiration);
      if (filtre === 'essai') return b.statut === 'essai';
      if (filtre === 'payantes') return b.statut === 'actif' && b.accessible;
      if (filtre === 'bientot') return b.accessible && j !== null && j <= 7;
      if (filtre === 'coupees') return !b.accessible;
      return true;
    });
  }, [boutiques, recherche, filtre]);

  const ouvrir = async (type: NonNullable<Modale>['type'], b: Boutique) => {
    setMessage(null); setHisto(null);
    const plan = b.plan || 'solo';
    setForm({
      mois: '1', montant: String(PLANS[plan]?.prix ?? 15000), mode: 'mobile_money', reference: '', plan,
      statut: b.statut || 'actif', expiration: b.date_expiration ? b.date_expiration.slice(0, 10) : '', note: b.note || '',
    });
    setModale({ type, b });
    if (type === 'historique') {
      const { data, error } = await supabase.rpc('sa_historique', { p_org: b.id });
      if (error) setMessage({ ok: false, texte: error.message }); else setHisto(data as Historique);
    }
  };
  const maj = (k: keyof typeof form, v: string) => {
    const f = { ...form, [k]: v };
    if ((k === 'mois' || k === 'plan') && modale?.type === 'prolonger') f.montant = String((PLANS[f.plan]?.prix ?? 15000) * (Number(f.mois) || 1));
    setForm(f);
  };

  const executer = async (fn: () => PromiseLike<{ error: { message: string } | null }>, ok: string) => {
    setOccupe(true); setMessage(null);
    const { error } = await fn();
    setOccupe(false);
    if (error) { setMessage({ ok: false, texte: error.message }); return; }
    setModale(null); setMessage({ ok: true, texte: ok }); await recharger();
  };

  const prolonger = (b: Boutique) => executer(() => supabase.rpc('sa_prolonger', {
    p_org: b.id, p_mois: Number(form.mois), p_montant: Number(form.montant) || 0, p_mode: form.mode,
    p_reference: form.reference.trim() || null, p_plan: form.plan,
  }), `${b.nom} : abonnement prolongé de ${form.mois} mois.`);

  const modifier = (b: Boutique) => executer(() => supabase.rpc('sa_modifier_abonnement', {
    p_org: b.id, p_plan: form.plan, p_statut: form.statut,
    p_date_expiration: form.expiration ? new Date(`${form.expiration}T23:59:00`).toISOString() : null, p_note: form.note,
  }), `${b.nom} : abonnement modifié.`);

  const basculer = (b: Boutique) => {
    if (!confirm(b.actif ? `Désactiver ${b.nom} ? Plus aucun compte de la boutique ne pourra travailler.` : `Réactiver ${b.nom} ?`)) return;
    executer(() => supabase.rpc('sa_activer_boutique', { p_org: b.id, p_actif: !b.actif }), b.actif ? `${b.nom} désactivée.` : `${b.nom} réactivée.`);
  };

  if (autorise === null) return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />;
  if (!autorise) return (
    <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'var(--bg)', padding: '16px' }}>
      <div style={{ ...carte, maxWidth: '380px', textAlign: 'center' }}>
        <span className="ms" style={{ fontSize: '40px', color: ROUGE }}>lock</span>
        <div style={{ fontSize: '17px', fontWeight: 800, color: INK, margin: '8px 0' }}>Accès réservé à Fall Digital</div>
        <button onClick={() => router.push('/')} style={{ ...bouton, border: 'none', background: GRAD, color: '#fff', marginTop: '8px' }}>Retour</button>
      </div>
    </div>
  );

  const tuiles: [string, string, string, string][] = tableau ? [
    ['storefront', 'Boutiques', fmt(tableau.boutiques), `${fmt(tableau.accessibles)} ouvertes`],
    ['workspace_premium', 'Payantes', fmt(tableau.payantes), `dont ${fmt(tableau.pro)} Pro`],
    ['hourglass_top', 'En essai', fmt(tableau.essai), `${fmt(tableau.inscriptions_30j)} inscrites en 30 j`],
    ['event_busy', 'Expirent sous 7 j', fmt(tableau.expirent_7j), `${fmt(tableau.expirees)} déjà expirées`],
    ['trending_up', 'Revenu mensuel', `${fmt(tableau.revenu_mensuel)} F`, 'abonnements payants'],
    ['payments', 'Encaissé ce mois', `${fmt(tableau.encaisse_mois)} F`, `${fmt(tableau.encaisse_total)} F au total`],
  ] : [];

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      <header style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: '12px', padding: '14px 16px', background: '#fff', borderBottom: `1px solid ${LINE}` }}>
        <FallikLogo size={36} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: '18px', fontWeight: 800, color: INK, lineHeight: 1.1 }}>Console Fall Digital</div>
          <div style={{ fontSize: '12px', color: '#8A94A6' }}>Boutiques et abonnements Fallik</div>
        </div>
        <button onClick={() => router.push('/admin')} title="Ma boutique" style={{ ...bouton, border: `1px solid ${LINE}`, background: '#fff', color: '#5A6478' }}><span className="ms" style={{ fontSize: '18px' }}>store</span></button>
        <button onClick={seDeconnecter} title="Déconnexion" style={{ ...bouton, border: `1px solid ${LINE}`, background: '#fff', color: '#5A6478' }}><span className="ms" style={{ fontSize: '18px' }}>logout</span></button>
      </header>

      <main style={{ maxWidth: '1200px', margin: '0 auto', padding: '18px 16px 40px' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(170px,1fr))', gap: '12px', marginBottom: '18px' }}>
          {tuiles.map(([ic, l, v, s]) => (
            <div key={l} style={{ ...carte, padding: '14px 16px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '12px', fontWeight: 600, color: '#8A94A6' }}><span className="ms" style={{ fontSize: '18px', color: BLUE }}>{ic}</span>{l}</div>
              <div style={{ fontSize: '22px', fontWeight: 800, color: INK, marginTop: '6px' }}>{v}</div>
              <div style={{ fontSize: '11.5px', color: MUTE, marginTop: '2px' }}>{s}</div>
            </div>
          ))}
        </div>

        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px' }}>
          <input value={recherche} onChange={e => setRecherche(e.target.value)} placeholder="Chercher une boutique, un propriétaire, un téléphone…" style={{ ...champ, flex: 1, minWidth: '220px', width: 'auto' }} />
          {[['toutes', 'Toutes'], ['payantes', 'Payantes'], ['essai', 'Essai'], ['bientot', 'Expirent bientôt'], ['coupees', 'Coupées']].map(([k, l]) => (
            <button key={k} onClick={() => setFiltre(k)} style={{ ...bouton, height: '40px', border: filtre === k ? 'none' : `1px solid ${LINE}`, background: filtre === k ? GRAD : '#fff', color: filtre === k ? '#fff' : '#5A6478' }}>{l}</button>
          ))}
        </div>
        {message && !modale && <div style={{ marginBottom: '12px', fontSize: '13.5px', fontWeight: 600, color: message.ok ? VERT : ROUGE }}>{message.texte}</div>}

        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill,minmax(330px,1fr))', gap: '12px' }}>
          {liste.map(b => {
            const j = jours(b.date_expiration);
            const etat = !b.actif ? ['Désactivée', ROUGE] : !b.accessible ? [b.statut === 'suspendu' || b.statut === 'resilie' ? LIBELLES_STATUT[b.statut] : 'Expirée', ROUGE]
              : j !== null && j <= 7 ? [`${j} j restants`, ORANGE] : [LIBELLES_STATUT[b.statut || ''] || '—', VERT];
            return (
              <div key={b.id} style={carte}>
                <div style={{ display: 'flex', alignItems: 'flex-start', gap: '10px' }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '15.5px', fontWeight: 800, color: INK, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.nom}</div>
                    <div style={{ fontSize: '12.5px', color: '#6B7688', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{b.proprietaire ? `${b.proprietaire.nom} · ${b.proprietaire.email}` : 'Sans propriétaire'}</div>
                    {b.telephone && <div style={{ fontSize: '12.5px', color: '#6B7688' }}>{b.telephone}</div>}
                  </div>
                  <span style={{ fontSize: '11px', fontWeight: 800, color: b.plan === 'pro' ? '#fff' : BLUE, background: b.plan === 'pro' ? GRAD : '#EEF3FC', padding: '3px 9px', borderRadius: '20px' }}>{PLANS[b.plan || 'solo']?.nom || b.plan}</span>
                </div>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', margin: '10px 0', fontSize: '12.5px' }}>
                  <span style={{ fontWeight: 700, color: etat[1] }}>{etat[0]}</span>
                  <span style={{ color: '#6B7688' }}>Échéance {dateFr(b.date_expiration)}</span>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: 'repeat(3,1fr)', gap: '6px', fontSize: '12px', color: '#6B7688', background: '#F8FAFD', borderRadius: '12px', padding: '9px 10px' }}>
                  <div><b style={{ color: INK, fontSize: '13.5px' }}>{fmt(b.ventes_30j)}</b><br />ventes 30 j</div>
                  <div><b style={{ color: INK, fontSize: '13.5px' }}>{fmt(b.ca_30j)}</b><br />CA 30 j</div>
                  <div><b style={{ color: INK, fontSize: '13.5px' }}>{fmt(b.nb_vendeuses)}</b><br />vendeuses</div>
                  <div><b style={{ color: INK, fontSize: '13.5px' }}>{fmt(b.nb_produits)}</b><br />produits</div>
                  <div><b style={{ color: INK, fontSize: '13.5px' }}>{fmt(b.total_paye)}</b><br />payé (F)</div>
                  <div><b style={{ color: INK, fontSize: '13.5px' }}>{b.derniere_vente ? dateFr(b.derniere_vente).slice(0, 6) : '—'}</b><br />dern. vente</div>
                </div>
                {(b.note || b.site_actif) && <div style={{ fontSize: '12px', color: '#6B7688', marginTop: '8px' }}>{b.site_actif && '🌐 Site relié. '}{b.note}</div>}
                <div style={{ display: 'flex', gap: '6px', marginTop: '12px', flexWrap: 'wrap' }}>
                  <button onClick={() => ouvrir('prolonger', b)} style={{ ...bouton, border: 'none', background: GRAD, color: '#fff', flex: 1 }}><span className="ms" style={{ fontSize: '17px' }}>add_card</span>Paiement</button>
                  <button onClick={() => ouvrir('modifier', b)} style={{ ...bouton, border: `1px solid ${LINE}`, background: '#fff', color: INK }}><span className="ms" style={{ fontSize: '17px' }}>edit</span></button>
                  <button onClick={() => ouvrir('historique', b)} style={{ ...bouton, border: `1px solid ${LINE}`, background: '#fff', color: INK }}><span className="ms" style={{ fontSize: '17px' }}>history</span></button>
                  <button onClick={() => basculer(b)} title={b.actif ? 'Désactiver' : 'Réactiver'} style={{ ...bouton, border: `1px solid ${LINE}`, background: '#fff', color: b.actif ? ROUGE : VERT }}><span className="ms" style={{ fontSize: '17px' }}>{b.actif ? 'block' : 'check_circle'}</span></button>
                </div>
              </div>
            );
          })}
          {liste.length === 0 && <div style={{ ...carte, color: MUTE, fontSize: '13.5px' }}>Aucune boutique.</div>}
        </div>
      </main>

      {modale && (
        <div onClick={() => setModale(null)} style={{ position: 'fixed', inset: 0, zIndex: 50, background: 'rgba(26,36,56,.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', padding: '16px' }}>
          <div onClick={e => e.stopPropagation()} style={{ ...carte, width: '100%', maxWidth: modale.type === 'historique' ? '560px' : '420px', maxHeight: '88vh', overflowY: 'auto' }}>
            <div style={{ fontSize: '17px', fontWeight: 800, color: INK }}>
              {modale.type === 'prolonger' ? 'Enregistrer un paiement' : modale.type === 'modifier' ? 'Modifier l’abonnement' : 'Historique'}
            </div>
            <div style={{ fontSize: '13px', color: '#6B7688', marginBottom: '6px' }}>{modale.b.nom} · échéance actuelle {dateFr(modale.b.date_expiration)}</div>

            {modale.type === 'prolonger' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div><span style={label}>PLAN</span><select value={form.plan} onChange={e => maj('plan', e.target.value)} style={champ}>{Object.entries(PLANS).map(([k, p]) => <option key={k} value={k}>{p.nom} ({fmt(p.prix)} F)</option>)}</select></div>
                  <div><span style={label}>DURÉE (MOIS)</span><select value={form.mois} onChange={e => maj('mois', e.target.value)} style={champ}>{[1, 2, 3, 6, 12].map(m => <option key={m} value={m}>{m}</option>)}</select></div>
                  <div><span style={label}>MONTANT REÇU (F)</span><input inputMode="numeric" value={form.montant} onChange={e => setForm({ ...form, montant: e.target.value.replace(/[^0-9]/g, '') })} style={champ} /></div>
                  <div><span style={label}>MODE</span><select value={form.mode} onChange={e => setForm({ ...form, mode: e.target.value })} style={champ}>{MODES.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                </div>
                <span style={label}>RÉFÉRENCE DE LA TRANSACTION</span>
                <input value={form.reference} onChange={e => setForm({ ...form, reference: e.target.value })} placeholder="ex. MP2411…" style={champ} />
                <p style={{ fontSize: '12px', color: MUTE, margin: '10px 0 0' }}>L’échéance repart de l’actuelle si elle n’est pas dépassée (aucun jour perdu), sinon d’aujourd’hui. Statut : actif.</p>
              </>
            )}

            {modale.type === 'modifier' && (
              <>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
                  <div><span style={label}>PLAN</span><select value={form.plan} onChange={e => setForm({ ...form, plan: e.target.value })} style={champ}>{Object.entries(PLANS).map(([k, p]) => <option key={k} value={k}>{p.nom}</option>)}</select></div>
                  <div><span style={label}>STATUT</span><select value={form.statut} onChange={e => setForm({ ...form, statut: e.target.value })} style={champ}>{Object.entries(LIBELLES_STATUT).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select></div>
                </div>
                <span style={label}>ÉCHÉANCE</span>
                <input type="date" value={form.expiration} onChange={e => setForm({ ...form, expiration: e.target.value })} style={champ} />
                <span style={label}>NOTE INTERNE</span>
                <input value={form.note} onChange={e => setForm({ ...form, note: e.target.value })} placeholder="ex. paie le 5 du mois" style={champ} />
                <p style={{ fontSize: '12px', color: MUTE, margin: '10px 0 0' }}>Pour un paiement, utilisez plutôt « Paiement » : il est enregistré dans l’historique.</p>
              </>
            )}

            {modale.type === 'historique' && (
              !histo ? <p style={{ fontSize: '13px', color: MUTE }}>Chargement…</p> : (
                <div style={{ fontSize: '13px', color: '#5A6472' }}>
                  <div style={{ fontWeight: 700, color: INK, margin: '10px 0 6px' }}>Paiements</div>
                  {histo.paiements.length === 0 ? <div style={{ color: MUTE }}>Aucun paiement.</div> : histo.paiements.map(p => (
                    <div key={p.id} style={{ display: 'flex', justifyContent: 'space-between', gap: '10px', padding: '6px 0', borderBottom: '1px solid #F1F4FA' }}>
                      <span>{dateFr(p.cree_le)} · {PLANS[p.plan]?.nom} {p.mois} mois · {MODES.find(m => m[0] === p.mode)?.[1] || p.mode}{p.reference ? ` · ${p.reference}` : ''}</span>
                      <b style={{ color: INK, whiteSpace: 'nowrap' }}>{fmt(p.montant)} F</b>
                    </div>
                  ))}
                  <div style={{ fontWeight: 700, color: INK, margin: '14px 0 6px' }}>Changements</div>
                  {histo.changements.length === 0 ? <div style={{ color: MUTE }}>Aucun changement.</div> : histo.changements.map(h => (
                    <div key={h.id} style={{ padding: '6px 0', borderBottom: '1px solid #F1F4FA' }}>
                      <b style={{ color: INK }}>{dateFr(h.cree_le)} · {h.action}</b>
                      <div style={{ fontSize: '12px' }}>
                        {String(h.avant?.plan ?? '—')}/{String(h.avant?.statut ?? '—')} → {String(h.apres?.plan ?? '—')}/{String(h.apres?.statut ?? '—')}, échéance {dateFr((h.apres?.date_expiration as string) || null)}{h.note ? ` · ${h.note}` : ''}
                      </div>
                    </div>
                  ))}
                </div>
              )
            )}

            {message && <div style={{ marginTop: '10px', fontSize: '13px', color: message.ok ? VERT : ROUGE }}>{message.texte}</div>}
            <div style={{ display: 'flex', gap: '8px', marginTop: '16px', justifyContent: 'flex-end' }}>
              <button onClick={() => setModale(null)} style={{ ...bouton, height: '40px', border: `1px solid ${LINE}`, background: '#fff', color: '#5A6478' }}>Fermer</button>
              {modale.type !== 'historique' && (
                <button disabled={occupe} onClick={() => (modale.type === 'prolonger' ? prolonger(modale.b) : modale.type === 'modifier' ? modifier(modale.b) : null)}
                  style={{ ...bouton, height: '40px', border: 'none', background: GRAD, color: '#fff' }}>{occupe ? 'Patientez…' : 'Enregistrer'}</button>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
