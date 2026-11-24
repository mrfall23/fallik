-- ═══════════════════════════════════════════════════════════════════════
-- FALLIK — Phase 1 (ventes, reprise de Fallora)
--
--  1. enregistrer_paiement : encaisser plus tard un acompte sur une vente
--     a credit (creance). Gerant / proprietaire.
--  2. annuler_vente : archive une vente (rien n'est supprime), remet le stock
--     en rayon, trace qui / quand / pourquoi. Gerant / proprietaire.
--  3. Plus aucune ecriture directe sur les ventes : tout passe par ces
--     fonctions, donc tout est journalise.
--
-- Differences avec Fallora : controle de la boutique (multi-boutiques),
-- qui a encaisse chaque paiement (cloture de caisse), journal d'activite.
-- Rejouable sans risque.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.ventes
  add column if not exists annulee_le       timestamptz,
  add column if not exists annulee_par      bigint references public.utilisateurs (id) on delete set null,
  add column if not exists motif_annulation text;

-- ─── 1. Encaisser un acompte sur une creance ───────────────────────────
create or replace function public.enregistrer_paiement(p_vente_id bigint, p_montant numeric, p_mode text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_vente record; v_reste numeric; v_paye numeric; v_nouveau_reste numeric; v_statut text;
  v_mode text := coalesce(nullif(btrim(p_mode), ''), 'cash');
begin
  if not prive.est_admin() then raise exception 'Reserve au gerant ou au proprietaire'; end if;
  if p_montant is null or p_montant <= 0 then raise exception 'Le montant doit etre positif'; end if;

  select v.id, v.total, v.annulee, coalesce(v.montant_paye, 0) as montant_paye,
         coalesce(c.nom, v.nom_client, 'Client') as client
    into v_vente
    from public.ventes v left join public.clientes c on c.id = v.cliente_id
   where v.id = p_vente_id and v.organisation_id = prive.mon_organisation_id()
   for update of v;
  if not found then raise exception 'Vente introuvable'; end if;
  if v_vente.annulee then raise exception 'Cette vente est annulee'; end if;

  v_reste := greatest(0, v_vente.total - v_vente.montant_paye);
  if v_reste <= 0 then raise exception 'Cette vente est deja soldee'; end if;
  if p_montant > v_reste then raise exception 'Montant superieur au reste du (% FCFA)', v_reste; end if;

  insert into public.paiements (vente_id, montant, mode, encaisse_par)
  values (p_vente_id, p_montant, v_mode, prive.mon_utilisateur_id());

  -- Recalcul depuis la table paiements : source de verite unique.
  select coalesce(sum(montant), 0) into v_paye from public.paiements where vente_id = p_vente_id;
  v_nouveau_reste := greatest(0, v_vente.total - v_paye);
  v_statut := case when v_nouveau_reste <= 0 then 'paye' else 'partiel' end;

  update public.ventes
     set montant_paye = v_paye, reste_a_payer = v_nouveau_reste, statut_paiement = v_statut
   where id = p_vente_id;

  perform prive.journaliser('creance_encaissee', 'info',
    jsonb_build_object('vente', p_vente_id, 'client', v_vente.client, 'mode', v_mode, 'reste', v_nouveau_reste),
    p_montant);

  return jsonb_build_object('vente_id', p_vente_id, 'montant_paye', v_paye,
    'reste_a_payer', v_nouveau_reste, 'statut_paiement', v_statut);
end;
$$;

-- ─── 2. Annuler une vente ──────────────────────────────────────────────
create or replace function public.annuler_vente(p_vente_id bigint, p_motif text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_vente record; v_motif text; v_ligne record; v_remis integer := 0;
begin
  if not prive.est_admin() then raise exception 'Reserve au gerant ou au proprietaire'; end if;
  v_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if v_motif is null then raise exception 'Indiquez le motif de l''annulation'; end if;
  perform set_config('fallik.mouvement', '1', true);

  select v.id, v.annulee, v.total, v.montant_paye, coalesce(c.nom, v.nom_client, 'Client') as client,
         u.nom as vendeuse
    into v_vente
    from public.ventes v
    left join public.clientes c on c.id = v.cliente_id
    left join public.utilisateurs u on u.id = v.vendeuse_id
   where v.id = p_vente_id and v.organisation_id = prive.mon_organisation_id()
   for update of v;
  if not found then raise exception 'Vente introuvable'; end if;
  if v_vente.annulee then raise exception 'Cette vente est deja annulee'; end if;

  -- Remise en stock, produit par produit.
  for v_ligne in
    select produit_id, sum(quantite)::integer as quantite
      from public.vente_produits where vente_id = p_vente_id and produit_id is not null
     group by produit_id
  loop
    update public.produits set stock_restant = stock_restant + v_ligne.quantite
     where id = v_ligne.produit_id and organisation_id = prive.mon_organisation_id();
    v_remis := v_remis + v_ligne.quantite;
  end loop;

  update public.ventes
     set annulee = true, annulee_le = now(), annulee_par = prive.mon_utilisateur_id(), motif_annulation = v_motif
   where id = p_vente_id;

  perform prive.journaliser('vente_annulee', 'alerte',
    jsonb_build_object('vente', p_vente_id, 'client', v_vente.client, 'vendeuse', v_vente.vendeuse,
                       'motif', v_motif, 'articles', v_remis, 'deja_paye', v_vente.montant_paye),
    v_vente.total);

  return jsonb_build_object('vente_id', p_vente_id, 'articles_remis', v_remis);
end;
$$;

-- ─── 3. Ventes : plus aucune ecriture directe depuis l'app ──────────────
-- Jusqu'ici un gerant pouvait modifier le total d'une vente ou la supprimer
-- directement par l'API, sans trace. Desormais, toute ecriture passe par
-- les fonctions ci-dessus (journalisees). Lecture inchangee.
drop policy if exists "ventes: admin modifie" on public.ventes;
drop policy if exists "ventes: admin supprime" on public.ventes;
drop policy if exists "vp: admin modifie" on public.vente_produits;
revoke insert, update, delete on public.ventes, public.vente_produits, public.paiements from authenticated, anon;

revoke execute on function public.enregistrer_paiement(bigint, numeric, text), public.annuler_vente(bigint, text)
  from public, anon;
grant execute on function public.enregistrer_paiement(bigint, numeric, text), public.annuler_vente(bigint, text)
  to authenticated;

notify pgrst, 'reload schema';
