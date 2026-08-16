'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

// Plus de mot_de_passe : les mots de passe vivent dans auth.users, haches
// par Supabase. L'app ne peut plus les lire, et c'est le but.
type Vendeuse = { id: number; nom: string; email: string; actif: boolean; role: string };
const FORM_VIDE = { nom: '', email: '', mot_de_passe: '' };

const INK = '#1A2438', BLUE = '#2563EB', GRAD = 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', MUTE = '#9AA3B2', SOFT = '#8A94A6', LINE = '#EAEEF5';
const carte: React.CSSProperties = { background: '#fff', borderRadius: '18px', border: `1px solid ${LINE}`, boxShadow: '0 6px 20px rgba(26,36,56,.05)' };
const inputStyle: React.CSSProperties = { height: '44px', padding: '0 14px', borderRadius: '12px', background: '#F6F8FC', border: '1px solid #E4E9F2', outline: 'none', color: INK, fontSize: '14px', width: '100%' };
const labelStyle: React.CSSProperties = { fontSize: '11px', fontWeight: 600, color: SOFT, letterSpacing: '.5px', marginBottom: '6px', textTransform: 'uppercase' };

export default function AdminParametres() {
  const [vendeuses, setVendeuses] = useState<Vendeuse[]>([]);
  const [chargement, setChargement] = useState(true);
  const [formOuvert, setFormOuvert] = useState(false);
  const [editee, setEditee] = useState<Vendeuse | null>(null);
  const [form, setForm] = useState(FORM_VIDE);
  const [sauvegarde, setSauvegarde] = useState(false);
  const [message, setMessage] = useState('');
  const [erreur, setErreur] = useState('');

  useEffect(() => { chargerVendeuses(); }, []);

  const chargerVendeuses = async () => {
    const { data } = await supabase
      .from('utilisateurs')
      .select('id, nom, email, actif, role')
      .eq('role', 'vendeuse')
      .order('nom');
    setVendeuses(data || []);
    setChargement(false);
  };

  const ouvrirAjout = () => { setForm(FORM_VIDE); setEditee(null); setFormOuvert(true); setErreur(''); };
  // Le mot de passe part vide en edition : il n'est plus lisible, et le
  // laisser vide signifie « ne pas le changer ».
  const ouvrirEdit = (v: Vendeuse) => { setForm({ nom: v.nom, email: v.email, mot_de_passe: '' }); setEditee(v); setFormOuvert(true); setErreur(''); };
  const fermer = () => { setFormOuvert(false); setEditee(null); setErreur(''); };

  const afficherMessage = (msg: string) => { setMessage(msg); setTimeout(() => setMessage(''), 3000); };

  // Creer un compte exige la cle secrete, qui ne doit jamais atteindre le
  // navigateur : tout passe par /api/vendeuses, qui verifie cote serveur que
  // l'appelant est bien admin. Le controle d'unicite de l'email est laisse a
  // la contrainte UNIQUE en base — un pre-check ici laisserait une fenetre
  // entre la verification et l'insertion.
  const sauvegarder = async () => {
    if (!form.nom.trim() || !form.email.trim()) {
      setErreur('Le nom et l\'email sont obligatoires.'); return;
    }
    if (!editee && !form.mot_de_passe.trim()) {
      setErreur('Le mot de passe est obligatoire.'); return;
    }
    if (form.mot_de_passe && form.mot_de_passe.length < 6) {
      setErreur('Le mot de passe doit faire au moins 6 caractères.'); return;
    }

    setSauvegarde(true); setErreur('');

    const reponse = await fetch('/api/vendeuses', {
      method: editee ? 'PATCH' : 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        ...(editee ? { id: editee.id } : {}),
        nom: form.nom,
        email: form.email,
        motDePasse: form.mot_de_passe || undefined,
      }),
    });

    const resultat = await reponse.json().catch(() => ({}));
    setSauvegarde(false);

    if (!reponse.ok) {
      setErreur(resultat.message || 'Une erreur est survenue.');
      return;
    }

    afficherMessage(editee ? 'Compte mis à jour avec succès.' : 'Compte vendeuse créé avec succès.');
    await chargerVendeuses();
    fermer();
  };

  const toggleActif = async (v: Vendeuse) => {
    await supabase.from('utilisateurs').update({ actif: !v.actif }).eq('id', v.id);
    afficherMessage(v.actif ? `${v.nom} désactivée.` : `${v.nom} réactivée.`);
    await chargerVendeuses();
  };

  const actives = vendeuses.filter(v => v.actif);
  const inactives = vendeuses.filter(v => !v.actif);

  const miniStats = [
    { icon: 'group', label: 'Total comptes', value: vendeuses.length.toString(), col: BLUE },
    { icon: 'check_circle', label: 'Actives', value: actives.length.toString(), col: '#1F9D6B' },
    { icon: 'block', label: 'Désactivées', value: inactives.length.toString(), col: inactives.length > 0 ? '#D24444' : '#1F9D6B' },
  ];

  return (
    <div className="fade-up">
      {/* Résumé */}
      <div style={{ ...carte, display: 'flex', flexWrap: 'wrap', marginBottom: '18px' }}>
        {miniStats.map((m, i) => (
          <div key={m.label} style={{ flex: 1, minWidth: '160px', display: 'flex', alignItems: 'center', gap: '13px', padding: '18px 22px', borderLeft: i === 0 ? 'none' : '1px solid #F1F4FA' }}>
            <div style={{ width: '42px', height: '42px', borderRadius: '12px', background: '#EEF3FC', display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
              <span className="ms" style={{ fontSize: '22px', color: m.col }}>{m.icon}</span>
            </div>
            <div>
              <div style={{ fontSize: '11px', fontWeight: 600, letterSpacing: '.5px', color: SOFT, textTransform: 'uppercase' }}>{m.label}</div>
              <div style={{ fontSize: '20px', fontWeight: 800, color: INK, marginTop: '2px' }}>{m.value}</div>
            </div>
          </div>
        ))}
      </div>

      {/* Message succès */}
      {message && (
        <div style={{ padding: '12px 16px', borderRadius: '12px', background: 'rgba(31,157,107,.12)', border: '1px solid rgba(31,157,107,.28)', color: '#1F9D6B', fontSize: '13.5px', textAlign: 'center', marginBottom: '16px', fontWeight: 600 }}>
          <span className="ms" style={{ fontSize: '16px', verticalAlign: 'middle', marginRight: '6px' }}>check_circle</span>{message}
        </div>
      )}

      {/* Bouton ajouter */}
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: '16px' }}>
        <button onClick={ouvrirAjout} style={{ display: 'flex', alignItems: 'center', gap: '9px', height: '46px', padding: '0 22px', border: 'none', borderRadius: '13px', cursor: 'pointer', background: GRAD, color: '#fff', fontSize: '14.5px', fontWeight: 700, boxShadow: '0 8px 18px rgba(37,99,235,.28)' }}>
          <span className="ms" style={{ fontSize: '20px' }}>person_add</span>Ajouter une vendeuse
        </button>
      </div>

      {/* Formulaire modal */}
      {formOuvert && (
        <div onClick={fermer} style={{ position: 'fixed', inset: 0, background: 'rgba(16,24,40,.5)', display: 'flex', alignItems: 'flex-start', justifyContent: 'center', padding: '40px 16px', zIndex: 100, overflowY: 'auto' }}>
          <div onClick={e => e.stopPropagation()} style={{ background: '#fff', borderRadius: '20px', width: '100%', maxWidth: '560px', boxShadow: '0 24px 60px rgba(16,24,40,.28)', overflow: 'hidden' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '20px 24px', borderBottom: '1px solid #EEF2F8' }}>
              <div style={{ fontSize: '17px', fontWeight: 800, color: INK }}>{editee ? `Modifier — ${editee.nom}` : 'Nouveau compte vendeuse'}</div>
              <button onClick={fermer} aria-label="Fermer" style={{ width: '36px', height: '36px', borderRadius: '10px', border: 'none', background: '#F1F4FA', color: SOFT, cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
                <span className="ms" style={{ fontSize: '20px' }}>close</span>
              </button>
            </div>
            <div style={{ padding: '22px 24px' }}>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit,minmax(200px,1fr))', gap: '14px', marginBottom: '16px' }}>
                <div>
                  <div style={labelStyle}>Nom complet *</div>
                  <input style={inputStyle} placeholder="Ex : Mariam Koné" value={form.nom} onChange={e => setForm({ ...form, nom: e.target.value })} />
                </div>
                <div>
                  <div style={labelStyle}>Adresse email *</div>
                  <input style={inputStyle} type="email" placeholder="vendeuse@fallik.com" value={form.email} onChange={e => setForm({ ...form, email: e.target.value })} />
                </div>
                <div>
                  <div style={labelStyle}>{editee ? 'Nouveau mot de passe' : 'Mot de passe *'}</div>
                  <input style={inputStyle} type="password" placeholder={editee ? 'Laisser vide pour ne pas changer' : '6 caractères minimum'} value={form.mot_de_passe} onChange={e => setForm({ ...form, mot_de_passe: e.target.value })} />
                </div>
              </div>
              {erreur && (
                <div style={{ padding: '10px 14px', borderRadius: '10px', background: 'rgba(210,68,68,.10)', border: '1px solid rgba(210,68,68,.25)', color: '#D24444', fontSize: '13px', marginBottom: '14px' }}>{erreur}</div>
              )}
              <div style={{ display: 'flex', gap: '10px' }}>
                <button onClick={sauvegarder} disabled={sauvegarde} style={{ flex: 1, height: '46px', border: 'none', borderRadius: '13px', cursor: 'pointer', background: GRAD, color: '#fff', fontWeight: 700, fontSize: '14px', opacity: sauvegarde ? 0.7 : 1 }}>
                  {sauvegarde ? 'Sauvegarde…' : editee ? 'Enregistrer les modifications' : 'Créer le compte'}
                </button>
                <button onClick={fermer} style={{ height: '46px', padding: '0 22px', border: '1px solid #E4E9F2', borderRadius: '13px', cursor: 'pointer', background: '#fff', color: '#5A6472', fontSize: '14px', fontWeight: 600 }}>Annuler</button>
              </div>
            </div>
          </div>
        </div>
      )}

      {chargement ? (
        <div style={{ textAlign: 'center', padding: '60px', color: MUTE }}>Chargement…</div>
      ) : vendeuses.length === 0 ? (
        <div style={{ ...carte, textAlign: 'center', padding: '60px', color: MUTE }}>
          <span className="ms" style={{ fontSize: '46px', display: 'block', marginBottom: '10px', color: '#C6D2E8' }}>group</span>
          Aucune vendeuse. Commencez par en ajouter une.
        </div>
      ) : (
        <>
          {/* Vendeuses actives */}
          {actives.length > 0 && (
            <div style={{ marginBottom: '24px' }}>
              <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '1.2px', color: '#1F9D6B', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="ms" style={{ fontSize: '16px' }}>check_circle</span>Comptes actifs ({actives.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {actives.map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', rowGap: '12px', flexWrap: 'wrap', padding: '16px 20px', borderRadius: '16px', background: '#fff', border: `1px solid ${LINE}`, boxShadow: '0 4px 14px rgba(26,36,56,.04)' }}>
                    <div style={{ width: '46px', height: '46px', borderRadius: '14px', background: 'rgba(31,157,107,.12)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 800, color: '#1F9D6B', flexShrink: 0 }}>{v.nom[0].toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: INK }}>{v.nom}</div>
                      <div style={{ fontSize: '13px', color: MUTE, marginTop: '2px' }}>{v.email}</div>
                    </div>
                    <div style={{ padding: '4px 12px', borderRadius: '20px', background: 'rgba(31,157,107,.12)', fontSize: '12px', fontWeight: 700, color: '#1F9D6B' }}>Active</div>
                    <div style={{ display: 'flex', gap: '8px' }}>
                      <button onClick={() => ouvrirEdit(v)} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '38px', padding: '0 14px', borderRadius: '11px', cursor: 'pointer', background: '#EEF3FC', border: 'none', color: BLUE, fontSize: '13px', fontWeight: 600 }}>
                        <span className="ms" style={{ fontSize: '17px' }}>edit</span>Modifier
                      </button>
                      <button onClick={() => toggleActif(v)} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '38px', padding: '0 14px', borderRadius: '11px', cursor: 'pointer', background: 'rgba(210,68,68,.08)', border: 'none', color: '#D24444', fontSize: '13px', fontWeight: 600 }}>
                        <span className="ms" style={{ fontSize: '17px' }}>block</span>Désactiver
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Vendeuses inactives */}
          {inactives.length > 0 && (
            <div>
              <div style={{ fontSize: '12px', fontWeight: 700, letterSpacing: '1.2px', color: '#D24444', textTransform: 'uppercase', marginBottom: '12px', display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span className="ms" style={{ fontSize: '16px' }}>block</span>Comptes désactivés ({inactives.length})
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                {inactives.map(v => (
                  <div key={v.id} style={{ display: 'flex', alignItems: 'center', gap: '14px', rowGap: '12px', flexWrap: 'wrap', padding: '16px 20px', borderRadius: '16px', background: '#fff', border: `1px solid ${LINE}`, opacity: 0.72 }}>
                    <div style={{ width: '46px', height: '46px', borderRadius: '14px', background: '#EEF1F7', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '20px', fontWeight: 800, color: MUTE, flexShrink: 0 }}>{v.nom[0].toUpperCase()}</div>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontSize: '15px', fontWeight: 700, color: '#5A6472' }}>{v.nom}</div>
                      <div style={{ fontSize: '13px', color: '#A5AEBD', marginTop: '2px' }}>{v.email}</div>
                    </div>
                    <div style={{ padding: '4px 12px', borderRadius: '20px', background: 'rgba(210,68,68,.10)', fontSize: '12px', fontWeight: 700, color: '#D24444' }}>Désactivée</div>
                    <button onClick={() => toggleActif(v)} style={{ display: 'flex', alignItems: 'center', gap: '6px', height: '38px', padding: '0 14px', borderRadius: '11px', cursor: 'pointer', background: 'rgba(31,157,107,.12)', border: 'none', color: '#1F9D6B', fontSize: '13px', fontWeight: 600 }}>
                      <span className="ms" style={{ fontSize: '17px' }}>check_circle</span>Réactiver
                    </button>
                  </div>
                ))}
              </div>
            </div>
          )}
        </>
      )}
    </div>
  );
}
