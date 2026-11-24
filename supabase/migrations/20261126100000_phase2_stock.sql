-- ═══════════════════════════════════════════════════════════════════════
-- FALLIK — Phase 2 : produits et stock (reprise de Fallora)
--
--  1. Historique des mouvements de stock : un trigger sur produits trace
--     CHAQUE variation (vente, facture, annulation, reassort, correction,
--     inventaire, modification manuelle). Le type vient de la fonction
--     appelante (prive.contexte_stock, variables locales a la transaction).
--  2. reapprovisionner() et corriger_stock() (motif obligatoire), gerant.
--     Le stock d'un produit existant ne se modifie plus directement : seules
--     ces fonctions (et les ventes) le font, donc tout est trace.
--  3. Prix d'achat CONFIDENTIEL (gerant / proprietaire) : produits_couts, et
--     cout fige a chaque ligne de vente (vente_produits_couts) pour la marge.
--
-- Les fonctions de vente / facture / annulation / inventaire sont reprises A
-- L'IDENTIQUE de la phase 1 ; seule la pose du contexte de stock change.
-- Rejouable sans risque.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Mouvements de stock ────────────────────────────────────────────
create table if not exists public.mouvements_stock (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  produit_id      bigint not null references public.produits (id) on delete cascade,
  type            text not null check (type in ('ouverture', 'creation', 'vente', 'facture', 'annulation',
                                                'reappro', 'correction', 'inventaire', 'manuel')),
  quantite        integer not null,          -- variation signee (+ entree / - sortie)
  stock_apres     integer not null,
  vente_id        bigint references public.ventes (id) on delete set null,
  facture_id      bigint references public.factures (id) on delete set null,
  utilisateur_id  bigint references public.utilisateurs (id) on delete set null,
  motif           text,
  cree_le         timestamptz not null default now()
);
create index if not exists mouvements_stock_produit_idx on public.mouvements_stock (produit_id, cree_le desc);
create index if not exists mouvements_stock_org_idx on public.mouvements_stock (organisation_id, cree_le desc);

alter table public.mouvements_stock enable row level security;
revoke all on public.mouvements_stock from anon, authenticated;
grant select on public.mouvements_stock to authenticated;
grant all on public.mouvements_stock to service_role;
drop policy if exists "mouvements: gestion lit" on public.mouvements_stock;
create policy "mouvements: gestion lit" on public.mouvements_stock for select to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());

-- Contexte pose par les fonctions qui bougent le stock (local a la transaction).
create or replace function prive.contexte_stock(p_type text, p_vente bigint, p_facture bigint, p_motif text)
returns void language plpgsql set search_path = '' as $$
begin
  perform set_config('fallik.mouvement', '1', true);   -- pas de faux « stock modifie » au journal
  perform set_config('fallik.mvt_type', coalesce(p_type, ''), true);
  perform set_config('fallik.mvt_vente', coalesce(p_vente::text, ''), true);
  perform set_config('fallik.mvt_facture', coalesce(p_facture::text, ''), true);
  perform set_config('fallik.mvt_motif', coalesce(p_motif, ''), true);
end;
$$;

create or replace function prive.tracer_mouvement_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_delta integer;
begin
  if tg_op = 'INSERT' then
    v_type := 'creation';
    v_delta := coalesce(new.stock_restant, 0);
  else
    v_delta := coalesce(new.stock_restant, 0) - coalesce(old.stock_restant, 0);
    if v_delta = 0 then return new; end if;
    v_type := coalesce(nullif(current_setting('fallik.mvt_type', true), ''), 'manuel');
  end if;
  insert into public.mouvements_stock
    (organisation_id, produit_id, type, quantite, stock_apres, vente_id, facture_id, utilisateur_id, motif)
  values (new.organisation_id, new.id, v_type, v_delta, coalesce(new.stock_restant, 0),
          nullif(current_setting('fallik.mvt_vente', true), '')::bigint,
          nullif(current_setting('fallik.mvt_facture', true), '')::bigint,
          prive.mon_utilisateur_id(),
          nullif(current_setting('fallik.mvt_motif', true), ''));
  return new;
end;
$$;
drop trigger if exists produits_mouvements on public.produits;
create trigger produits_mouvements after insert or update of stock_restant on public.produits
  for each row execute function prive.tracer_mouvement_stock();

-- Point de depart : le stock actuel de chaque produit.
insert into public.mouvements_stock (organisation_id, produit_id, type, quantite, stock_apres, motif)
select p.organisation_id, p.id, 'ouverture', coalesce(p.stock_restant, 0), coalesce(p.stock_restant, 0),
       'Stock au démarrage de l''historique'
  from public.produits p
 where not exists (select 1 from public.mouvements_stock m where m.produit_id = p.id);

-- Le stock ne se modifie plus directement depuis l'app (seulement a la
-- creation du produit). Reassort / correction / inventaire passent par les
-- fonctions, qui tracent qui, quand et pourquoi.
revoke update on public.produits from authenticated;
grant update (nom, prix, description, image, actif) on public.produits to authenticated;


-- ─── 2. Reassort et correction (gerant / proprietaire) ─────────────────
create or replace function public.reapprovisionner(p_produit_id bigint, p_quantite integer, p_note text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prod record; v_note text := nullif(btrim(coalesce(p_note, '')), '');
begin
  if not prive.est_admin() then raise exception 'Reserve au gerant ou au proprietaire'; end if;
  if p_quantite is null or p_quantite <= 0 then raise exception 'La quantite doit etre positive'; end if;
  perform prive.contexte_stock('reappro', null, null, v_note);

  update public.produits
     set stock_restant = stock_restant + p_quantite, stock_initial = coalesce(stock_initial, 0) + p_quantite
   where id = p_produit_id and organisation_id = prive.mon_organisation_id()
  returning id, nom, prix, stock_restant into v_prod;
  if v_prod.id is null then raise exception 'Produit introuvable'; end if;

  perform prive.journaliser('reappro', 'info',
    jsonb_build_object('produit', v_prod.nom, 'quantite', p_quantite, 'apres', v_prod.stock_restant, 'note', v_note), null);
  return jsonb_build_object('produit_id', p_produit_id, 'stock_restant', v_prod.stock_restant);
end;
$$;

create or replace function public.corriger_stock(p_produit_id bigint, p_stock_reel integer, p_motif text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_prod record; v_ecart integer; v_motif text := nullif(btrim(coalesce(p_motif, '')), '');
begin
  if not prive.est_admin() then raise exception 'Reserve au gerant ou au proprietaire'; end if;
  if p_stock_reel is null or p_stock_reel < 0 then raise exception 'Le stock reel doit etre positif ou nul'; end if;
  if v_motif is null then raise exception 'Indiquez le motif de la correction'; end if;

  select id, nom, prix, stock_restant into v_prod from public.produits
   where id = p_produit_id and organisation_id = prive.mon_organisation_id() for update;
  if not found then raise exception 'Produit introuvable'; end if;
  v_ecart := p_stock_reel - v_prod.stock_restant;

  perform prive.contexte_stock('correction', null, null, v_motif);
  update public.produits
     set stock_restant = p_stock_reel, stock_initial = coalesce(stock_initial, 0) + v_ecart
   where id = p_produit_id;

  if v_ecart <> 0 then
    perform prive.journaliser('stock_corrige', case when v_ecart < 0 then 'alerte' else 'attention' end,
      jsonb_build_object('produit', v_prod.nom, 'avant', v_prod.stock_restant, 'apres', p_stock_reel, 'motif', v_motif),
      v_ecart * v_prod.prix);
  end if;
  return jsonb_build_object('produit_id', p_produit_id, 'ecart', v_ecart, 'stock_restant', p_stock_reel);
end;
$$;

revoke execute on function public.reapprovisionner(bigint, integer, text), public.corriger_stock(bigint, integer, text),
  prive.contexte_stock(text, bigint, bigint, text), prive.tracer_mouvement_stock() from public, anon;
grant execute on function public.reapprovisionner(bigint, integer, text), public.corriger_stock(bigint, integer, text)
  to authenticated;
revoke execute on function prive.contexte_stock(text, bigint, bigint, text), prive.tracer_mouvement_stock() from authenticated;


-- ─── 3. Prix d'achat (confidentiel) et cout fige par vente ─────────────
create table if not exists public.produits_couts (
  produit_id bigint primary key references public.produits (id) on delete cascade,
  prix_achat numeric not null check (prix_achat >= 0),
  maj_le     timestamptz not null default now()
);
alter table public.produits_couts enable row level security;
revoke all on public.produits_couts from anon, authenticated;
grant select, insert, update, delete on public.produits_couts to authenticated;
grant all on public.produits_couts to service_role;

drop policy if exists "couts: gestion" on public.produits_couts;
create policy "couts: gestion" on public.produits_couts for all to authenticated
  using (prive.est_admin() and exists (select 1 from public.produits p
         where p.id = produit_id and p.organisation_id = prive.mon_organisation_id()))
  with check (prive.est_admin() and exists (select 1 from public.produits p
         where p.id = produit_id and p.organisation_id = prive.mon_organisation_id()));

create table if not exists public.vente_produits_couts (
  vente_produit_id    bigint primary key references public.vente_produits (id) on delete cascade,
  prix_achat_unitaire numeric not null check (prix_achat_unitaire >= 0)
);
alter table public.vente_produits_couts enable row level security;
revoke all on public.vente_produits_couts from anon, authenticated;
grant select on public.vente_produits_couts to authenticated;
grant all on public.vente_produits_couts to service_role;

drop policy if exists "couts ventes: gestion lit" on public.vente_produits_couts;
create policy "couts ventes: gestion lit" on public.vente_produits_couts for select to authenticated
  using (prive.est_admin() and exists (
    select 1 from public.vente_produits vp join public.ventes v on v.id = vp.vente_id
     where vp.id = vente_produit_id and v.organisation_id = prive.mon_organisation_id()));

-- Cout fige a chaque ligne vendue (vente rapide ET facture encaissee).
create or replace function prive.figer_cout_vente()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vente_produits_couts (vente_produit_id, prix_achat_unitaire)
  select new.id, pc.prix_achat from public.produits_couts pc where pc.produit_id = new.produit_id
  on conflict (vente_produit_id) do nothing;
  return new;
end;
$$;
drop trigger if exists vente_produits_cout on public.vente_produits;
create trigger vente_produits_cout after insert on public.vente_produits
  for each row execute function prive.figer_cout_vente();

-- Un produit qui recoit un prix d'achat : ses ventes passees sans cout le
-- prennent (sinon tout l'historique resterait sans marge).
create or replace function prive.remplir_couts_passes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.vente_produits_couts (vente_produit_id, prix_achat_unitaire)
  select vp.id, new.prix_achat from public.vente_produits vp where vp.produit_id = new.produit_id
  on conflict (vente_produit_id) do nothing;
  return new;
end;
$$;
drop trigger if exists produits_couts_passes on public.produits_couts;
create trigger produits_couts_passes after insert or update of prix_achat on public.produits_couts
  for each row execute function prive.remplir_couts_passes();

revoke execute on function prive.figer_cout_vente(), prive.remplir_couts_passes() from public, anon, authenticated;


-- ─── 4. Fonctions existantes : pose du contexte de stock ───────────────
create or replace function public.enregistrer_vente(
  p_cliente_nom text,
  p_cliente_telephone text,
  p_produits jsonb,
  p_statut_paiement text,
  p_montant_paye numeric,
  p_mode_paiement text,
  p_autorisation uuid default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_vendeuse_id bigint; v_org_id bigint; v_cliente_id bigint; v_vente_id bigint;
  v_total numeric := 0; v_item jsonb; v_produit record; v_quantite integer;
  v_tel text; v_final numeric; v_appr bigint;
begin
  v_vendeuse_id := prive.mon_utilisateur_id();
  v_org_id      := prive.mon_organisation_id();
  if v_vendeuse_id is null or v_org_id is null then raise exception 'Non authentifie'; end if;
  perform prive.contexte_stock('vente', null, null, null);

  if p_cliente_nom is null or btrim(p_cliente_nom) = '' then
    raise exception 'Le nom de la cliente est obligatoire';
  end if;
  if p_produits is null or jsonb_array_length(p_produits) = 0 then raise exception 'Le panier est vide'; end if;
  if p_statut_paiement not in ('paye', 'partiel') then raise exception 'Statut de paiement invalide'; end if;

  v_tel := nullif(btrim(coalesce(p_cliente_telephone, '')), '');
  if v_tel is not null then
    select id into v_cliente_id from public.clientes where organisation_id = v_org_id and telephone = v_tel;
    if v_cliente_id is null then
      insert into public.clientes (organisation_id, nom, telephone)
      values (v_org_id, btrim(p_cliente_nom), v_tel) returning id into v_cliente_id;
    end if;
  else
    insert into public.clientes (organisation_id, nom, telephone)
    values (v_org_id, btrim(p_cliente_nom), null) returning id into v_cliente_id;
  end if;

  insert into public.ventes
    (organisation_id, vendeuse_id, cliente_id, total, montant_paye, reste_a_payer, statut_paiement, annulee)
  values (v_org_id, v_vendeuse_id, v_cliente_id, 0, 0, 0, p_statut_paiement, false)
  returning id into v_vente_id;
  perform set_config('fallik.mvt_vente', v_vente_id::text, true);

  for v_item in select * from jsonb_array_elements(p_produits)
  loop
    v_quantite := (v_item->>'quantite')::integer;
    if v_quantite is null or v_quantite <= 0 then raise exception 'Quantite invalide'; end if;
    select id, nom, prix, stock_restant into v_produit from public.produits
     where id = (v_item->>'produit_id')::bigint and organisation_id = v_org_id and actif = true
     for update;
    if not found then raise exception 'Produit introuvable ou inactif'; end if;
    if v_produit.stock_restant < v_quantite then raise exception 'Stock insuffisant pour %', v_produit.nom; end if;
    insert into public.vente_produits (vente_id, produit_id, quantite, prix_unitaire)
    values (v_vente_id, v_produit.id, v_quantite, v_produit.prix);
    update public.produits set stock_restant = stock_restant - v_quantite where id = v_produit.id;
    v_total := v_total + (v_produit.prix * v_quantite);
  end loop;

  v_final := case when p_statut_paiement = 'paye' then v_total else coalesce(p_montant_paye, 0) end;
  if v_final < 0 or v_final > v_total then raise exception 'Montant paye invalide'; end if;

  -- Credit (reste a payer) : validation du gerant.
  if v_final < v_total then
    v_appr := prive.exiger_validation(p_autorisation, 'credit', null, v_total - v_final);
    perform prive.journaliser('credit_accorde', 'attention',
      jsonb_build_object('vente', v_vente_id, 'client', btrim(p_cliente_nom), 'total', v_total, 'paye', v_final),
      v_total - v_final, v_appr);
  end if;

  update public.ventes
     set total = v_total, montant_paye = v_final, reste_a_payer = greatest(0, v_total - v_final),
         statut_paiement = case when v_final >= v_total then 'paye' else 'partiel' end
   where id = v_vente_id;

  insert into public.paiements (vente_id, montant, mode, encaisse_par)
  values (v_vente_id, v_final, coalesce(nullif(btrim(p_mode_paiement), ''), 'cash'), v_vendeuse_id);

  return v_vente_id;
end;
$$;

create or replace function public.facture_definir_quantite(
  p_facture_id bigint, p_produit_id bigint, p_quantite integer, p_autorisation uuid default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_fact public.factures; v_prod record; v_ligne record;
  v_actuelle integer; v_delta integer; v_appr bigint; v_recent boolean;
begin
  if prive.mon_organisation_id() is null then raise exception 'Non authentifie'; end if;
  if p_quantite is null or p_quantite < 0 then raise exception 'Quantite invalide'; end if;
  perform prive.contexte_stock('facture', null, p_facture_id, null);

  v_fact := prive.ma_facture_ouverte(p_facture_id);

  select id, nom, prix, stock_restant into v_prod from public.produits
   where id = p_produit_id and organisation_id = v_fact.organisation_id for update;
  if not found then raise exception 'Produit introuvable'; end if;

  select quantite, prix_unitaire, maj_le into v_ligne from public.facture_lignes
   where facture_id = p_facture_id and produit_id = p_produit_id;
  v_actuelle := coalesce(v_ligne.quantite, 0);
  v_delta := p_quantite - v_actuelle;
  if v_delta = 0 then return; end if;

  if v_delta > 0 then
    if not exists (select 1 from public.produits where id = p_produit_id and actif) then
      raise exception 'Produit introuvable ou inactif';
    end if;
    if v_prod.stock_restant < v_delta then raise exception 'Stock insuffisant'; end if;
  else
    -- Retrait : libre pendant 2 minutes (erreur de saisie), sinon gerant.
    v_recent := v_ligne.maj_le > now() - interval '2 minutes';
    if v_recent then
      perform prive.journaliser('correction_article', 'info',
        jsonb_build_object('facture', p_facture_id, 'client', v_fact.nom_client, 'produit', v_prod.nom,
                           'avant', v_actuelle, 'apres', p_quantite),
        -v_delta * v_ligne.prix_unitaire);
    else
      v_appr := prive.exiger_validation(p_autorisation, 'retirer_article', p_facture_id,
                                        -v_delta * v_ligne.prix_unitaire);
      perform prive.journaliser('article_retire', 'attention',
        jsonb_build_object('facture', p_facture_id, 'client', v_fact.nom_client, 'produit', v_prod.nom,
                           'avant', v_actuelle, 'apres', p_quantite),
        -v_delta * v_ligne.prix_unitaire, v_appr);
    end if;
  end if;

  update public.produits set stock_restant = stock_restant - v_delta where id = p_produit_id;

  if p_quantite = 0 then
    delete from public.facture_lignes where facture_id = p_facture_id and produit_id = p_produit_id;
  elsif v_actuelle = 0 then
    insert into public.facture_lignes (facture_id, produit_id, quantite, prix_unitaire, maj_le)
    values (p_facture_id, p_produit_id, p_quantite, v_prod.prix, now());
  else
    update public.facture_lignes
       set quantite = p_quantite, maj_le = case when v_delta > 0 then now() else maj_le end
     where facture_id = p_facture_id and produit_id = p_produit_id;
  end if;

  perform prive.recalc_total_facture(p_facture_id);
end;
$$;

create or replace function public.facture_annuler(p_facture_id bigint, p_autorisation uuid default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_fact public.factures; v_ligne record; v_appr bigint; v_articles jsonb;
begin
  if prive.mon_organisation_id() is null then raise exception 'Non authentifie'; end if;
  perform prive.contexte_stock('annulation', null, p_facture_id, 'Facture annulée');
  v_fact := prive.ma_facture_ouverte(p_facture_id);

  select coalesce(jsonb_agg(jsonb_build_object('produit', coalesce(p.nom, 'Produit'), 'quantite', l.quantite)), '[]'::jsonb)
    into v_articles
    from public.facture_lignes l left join public.produits p on p.id = l.produit_id
   where l.facture_id = p_facture_id;

  -- Une facture vide s'annule librement ; sinon, validation du gerant.
  if v_fact.total > 0 then
    v_appr := prive.exiger_validation(p_autorisation, 'annuler_facture', p_facture_id, v_fact.total);
    perform prive.journaliser('facture_annulee', 'alerte',
      jsonb_build_object('facture', p_facture_id, 'client', v_fact.nom_client, 'articles', v_articles),
      v_fact.total, v_appr);
  end if;

  for v_ligne in select produit_id, quantite from public.facture_lignes where facture_id = p_facture_id
  loop
    if v_ligne.produit_id is not null then
      update public.produits set stock_restant = stock_restant + v_ligne.quantite where id = v_ligne.produit_id;
    end if;
  end loop;

  update public.factures set statut = 'annulee', closed_at = now() where id = p_facture_id;
end;
$$;

create or replace function public.annuler_vente(p_vente_id bigint, p_motif text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_vente record; v_motif text; v_ligne record; v_remis integer := 0;
begin
  if not prive.est_admin() then raise exception 'Reserve au gerant ou au proprietaire'; end if;
  v_motif := nullif(btrim(coalesce(p_motif, '')), '');
  if v_motif is null then raise exception 'Indiquez le motif de l''annulation'; end if;
  perform prive.contexte_stock('annulation', p_vente_id, null, v_motif);

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

create or replace function public.enregistrer_inventaire(
  p_lignes jsonb, p_appliquer boolean, p_commentaire text default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_org bigint := prive.mon_organisation_id(); v_moi bigint := prive.mon_utilisateur_id();
  v_id bigint; v_item jsonb; v_prod record; v_compte integer;
  v_nb integer := 0; v_nb_ecarts integer := 0; v_valeur numeric := 0;
begin
  if not prive.est_admin() then raise exception 'Reserve au gerant ou au proprietaire'; end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    raise exception 'Aucun produit compte';
  end if;
  perform prive.contexte_stock('inventaire', null, null, nullif(btrim(coalesce(p_commentaire, '')), ''));

  insert into public.inventaires (organisation_id, utilisateur_id, utilisateur_nom, applique, commentaire)
  values (v_org, v_moi, (select nom from public.utilisateurs where id = v_moi), coalesce(p_appliquer, false),
          nullif(btrim(coalesce(p_commentaire, '')), ''))
  returning id into v_id;

  for v_item in select * from jsonb_array_elements(p_lignes)
  loop
    v_compte := (v_item->>'compte')::integer;
    if v_compte is null or v_compte < 0 then raise exception 'Quantite comptee invalide'; end if;
    select id, nom, prix, stock_restant into v_prod from public.produits
     where id = (v_item->>'produit_id')::bigint and organisation_id = v_org for update;
    if not found then raise exception 'Produit introuvable'; end if;

    insert into public.inventaire_lignes (inventaire_id, produit_id, produit_nom, theorique, compte, ecart, prix)
    values (v_id, v_prod.id, v_prod.nom, v_prod.stock_restant, v_compte, v_compte - v_prod.stock_restant, v_prod.prix);

    v_nb := v_nb + 1;
    if v_compte <> v_prod.stock_restant then
      v_nb_ecarts := v_nb_ecarts + 1;
      v_valeur := v_valeur + (v_compte - v_prod.stock_restant) * v_prod.prix;
      if coalesce(p_appliquer, false) then
        update public.produits set stock_restant = v_compte where id = v_prod.id;
      end if;
    end if;
  end loop;

  update public.inventaires set nb_produits = v_nb, nb_ecarts = v_nb_ecarts, valeur_ecart = v_valeur where id = v_id;

  perform prive.journaliser('inventaire', case when v_valeur < 0 then 'alerte' else 'info' end,
    jsonb_build_object('inventaire', v_id, 'produits', v_nb, 'ecarts', v_nb_ecarts, 'applique', coalesce(p_appliquer, false)),
    v_valeur);
  return v_id;
end;
$$;


notify pgrst, 'reload schema';
