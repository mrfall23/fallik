'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { supabase } from './supabase';
import { estGestion, accueilPourRole, type Acces } from './roles';

export type Utilisateur = {
  id: number;
  nom: string;
  email: string;
  role: string;
  actif: boolean;
};

/**
 * Recupere l'utilisateur connecte a partir de la session Supabase.
 *
 * Remplace l'ancien localStorage.getItem('fallora_user'), qui etait
 * modifiable depuis la console du navigateur.
 *
 * Ce hook sert le confort d'affichage (rediriger, saluer par son nom).
 * Il ne protege RIEN : la vraie barriere, ce sont les policies RLS. Un
 * utilisateur peut toujours contourner du JavaScript ; il ne contourne
 * pas Postgres.
 */
export function useUtilisateur(roleRequis?: 'admin' | 'vendeuse') {
  const [utilisateur, setUtilisateur] = useState<Utilisateur | null>(null);
  const [acces, setAcces] = useState<Acces | null>(null);
  const [chargement, setChargement] = useState(true);
  const router = useRouter();

  useEffect(() => {
    let annule = false;

    (async () => {
      // getUser() fait revalider le jeton par le serveur Supabase.
      // getSession() se contenterait de lire le stockage local sans controle.
      const {
        data: { user: authUser },
      } = await supabase.auth.getUser();

      if (!authUser) {
        router.replace('/');
        return;
      }

      const [{ data: profil }, { data: etat }] = await Promise.all([
        supabase.from('utilisateurs').select('id, nom, email, role, actif').eq('auth_id', authUser.id).single(),
        supabase.rpc('mon_acces'),
      ]);

      if (annule) return;

      // Compte supprime cote metier, ou desactive entre-temps : on coupe.
      if (!profil || !profil.actif) {
        await supabase.auth.signOut();
        router.replace('/');
        return;
      }

      // Boutique desactivee, abonnement suspendu / resilie / expire.
      const a = etat as Acces | null;
      if (!a || !a.acces) {
        router.replace('/abonnement');
        return;
      }

      // 'admin' = espace de gestion : proprietaire et gerant(e) y ont droit.
      // L'espace vendeuse est ouvert a tous les roles (le proprietaire vend aussi).
      if (roleRequis === 'admin' && !estGestion(profil.role)) {
        router.replace(accueilPourRole(profil.role));
        return;
      }

      setUtilisateur(profil);
      setAcces(a);
      setChargement(false);
    })();

    return () => {
      annule = true;
    };
  }, [roleRequis, router]);

  return { utilisateur, acces, chargement };
}

/** Ce navigateur est-il un telephone « caisse » partage ? (affichage seulement) */
export const estModeCaisse = () => typeof document !== 'undefined' && /(?:^|;\s*)fallik_caisse=1/.test(document.cookie);

/** Termine la session Supabase et renvoie au login (ou a l'ecran caisse). */
export async function seDeconnecter() {
  const caisse = estModeCaisse();
  // Sur la caisse partagee, on ne ferme que la session de cet appareil.
  await supabase.auth.signOut(caisse ? { scope: 'local' } : undefined);
  window.location.href = caisse ? '/caisse' : '/';
}
