-- ═══════════════════════════════════════════════════════════════════════
-- Phase 7 : type de commerce + mode Pressing
--
-- 1. organisations.type_activite : boutique, bar, restaurant, pressing,
--    salon, autre. Choisi a l'inscription, modifiable par la gestion.
-- 2. produits.suivi_stock : false = service (repassage, coupe...) sans stock.
--    Son stock est fige a 1 000 000 pour que les controles existants
--    (« stock insuffisant ») ne bloquent jamais, sans mouvement trace.
-- 3. Depots (pressing) : ticket numerote, etats depose -> en_cours -> pret
--    -> retire. Le depot cree une vente (chiffre d'affaires) ; l'acompte est
--    libre (les habits restent en gage) ; le reste est encaisse au retrait.
--    Acces par RPC uniquement : toute l'equipe voit tous les depots.
--
-- A executer dans l'editeur SQL du projet Supabase FALLIK (pas Fallora).
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 1. Type de commerce ───────────────────────────────────────────────
alter table public.organisations
  add column if not exists type_activite text not null default 'boutique';
alter table public.organisations drop constraint if exists organisations_type_activite_check;
alter table public.organisations add constraint organisations_type_activite_check
  check (type_activite in ('boutique', 'bar', 'restaurant', 'pressing', 'salon', 'autre'));
grant update (type_activite) on public.organisations to authenticated;

create or replace function public.mon_acces()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object(
    'utilisateur_id',      u.id,
    'nom',                 u.nom,
    'role',                u.role,
    'compte_actif',        u.actif,
    'organisation_id',     o.id,
    'organisation',        o.nom,
    'organisation_active', o.actif,
    'type_activite',       o.type_activite,
    'plan',                a.plan,
    'statut',              a.statut,
    'date_expiration',     a.date_expiration,
    'acces',               u.actif and prive.organisation_accessible(o.id)
  )
  from public.utilisateurs u
  join public.organisations o on o.id = u.organisation_id
  left join public.abonnements a on a.organisation_id = o.id
  where u.auth_id = (select auth.uid())
$$;
revoke execute on function public.mon_acces() from public, anon;
grant execute on function public.mon_acces() to authenticated;


-- ─── 2. Services (sans stock) ──────────────────────────────────────────
alter table public.produits add column if not exists suivi_stock boolean not null default true;
grant update (suivi_stock) on public.produits to authenticated;

create or replace function prive.stock_service()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not new.suivi_stock then
    new.stock_restant := 1000000;
    new.stock_initial := 1000000;
  elsif tg_op = 'UPDATE' and not old.suivi_stock then
    -- Un service redevient un article : il repart de zero (reapprovisionner ensuite).
    new.stock_restant := 0;
    new.stock_initial := 0;
  end if;
  return new;
end;
$$;
drop trigger if exists produits_stock_service on public.produits;
create trigger produits_stock_service before insert or update on public.produits
  for each row execute function prive.stock_service();

-- Pas de mouvement de stock pour un service (ni a sa creation, ni quand il
-- redevient un article).
create or replace function prive.tracer_mouvement_stock()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_type text; v_delta integer;
begin
  if not new.suivi_stock or (tg_op = 'UPDATE' and not old.suivi_stock) then return new; end if;
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
revoke execute on function prive.stock_service(), prive.tracer_mouvement_stock() from public, anon, authenticated;


-- ─── 3. Depots (pressing) ──────────────────────────────────────────────
create table if not exists public.depots (
  id                  bigint generated always as identity primary key,
  organisation_id     bigint not null references public.organisations (id) on delete cascade,
  numero              integer not null,
  vente_id            bigint not null unique references public.ventes (id) on delete cascade,
  statut              text not null default 'depose' check (statut in ('depose', 'en_cours', 'pret', 'retire')),
  date_retrait_prevue date,
  note                text check (note is null or char_length(note) <= 300),
  cree_par            bigint references public.utilisateurs (id) on delete set null,
  cree_le             timestamptz not null default now(),
  pret_le             timestamptz,
  retire_le           timestamptz,
  retire_par          bigint references public.utilisateurs (id) on delete set null,
  unique (organisation_id, numero)
);
create index if not exists depots_org_statut_idx on public.depots (organisation_id, statut, cree_le desc);
alter table public.depots enable row level security;
revoke all on public.depots from anon, authenticated;
grant all on public.depots to service_role;

create or replace function prive.exiger_pressing()
returns bigint language plpgsql stable security definer set search_path = '' as $$
declare v_org bigint := prive.mon_organisation_id();
begin
  if prive.mon_utilisateur_id() is null or v_org is null then raise exception 'Non authentifie'; end if;
  if (select type_activite from public.organisations where id = v_org) <> 'pressing' then
    raise exception 'Réservé aux pressings';
  end if;
  return v_org;
end;
$$;

-- Nouveau depot : client (telephone obligatoire, pour le prevenir), lignes
-- [{produit_id, quantite}], acompte libre (0 accepte).
create or replace function public.depot_creer(
  p_cliente_nom text,
  p_cliente_telephone text,
  p_produits jsonb,
  p_montant_paye numeric,
  p_mode_paiement text,
  p_date_retrait date default null,
  p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org bigint := prive.exiger_pressing(); v_moi bigint := prive.mon_utilisateur_id();
  v_tel text; v_cli bigint; v_vente bigint; v_total numeric := 0; v_item jsonb;
  v_prod record; v_q integer; v_paye numeric := coalesce(p_montant_paye, 0);
  v_num integer; v_id bigint;
begin
  if p_cliente_nom is null or btrim(p_cliente_nom) = '' then raise exception 'Le nom du client est obligatoire'; end if;
  v_tel := nullif(btrim(coalesce(p_cliente_telephone, '')), '');
  if v_tel is null then raise exception 'Le téléphone du client est obligatoire'; end if;
  if p_produits is null or jsonb_typeof(p_produits) <> 'array' or jsonb_array_length(p_produits) = 0 then
    raise exception 'Ajoutez au moins un vêtement';
  end if;
  if jsonb_array_length(p_produits) > 100 then raise exception 'Trop de lignes'; end if;
  if p_date_retrait is not null and p_date_retrait < current_date - 1 then raise exception 'Date de retrait déjà passée'; end if;
  if p_note is not null and char_length(p_note) > 300 then raise exception 'Note trop longue'; end if;
  perform prive.contexte_stock('vente', null, null, null);

  select id into v_cli from public.clientes where organisation_id = v_org and telephone = v_tel;
  if v_cli is null then
    insert into public.clientes (organisation_id, nom, telephone)
    values (v_org, btrim(p_cliente_nom), v_tel) returning id into v_cli;
  end if;

  insert into public.ventes
    (organisation_id, vendeuse_id, cliente_id, total, montant_paye, reste_a_payer, statut_paiement, annulee)
  values (v_org, v_moi, v_cli, 0, 0, 0, 'partiel', false)
  returning id into v_vente;
  perform set_config('fallik.mvt_vente', v_vente::text, true);

  for v_item in select * from jsonb_array_elements(p_produits)
  loop
    begin
      v_q := (v_item->>'quantite')::integer;
    exception when others then raise exception 'Quantité invalide';
    end;
    if v_q is null or v_q <= 0 or v_q > 1000 then raise exception 'Quantité invalide'; end if;
    select id, nom, prix, stock_restant, suivi_stock into v_prod from public.produits
     where id = (v_item->>'produit_id')::bigint and organisation_id = v_org and actif = true
     for update;
    if not found then raise exception 'Article introuvable ou inactif'; end if;
    if v_prod.suivi_stock and v_prod.stock_restant < v_q then raise exception 'Stock insuffisant pour %', v_prod.nom; end if;
    insert into public.vente_produits (vente_id, produit_id, quantite, prix_unitaire)
    values (v_vente, v_prod.id, v_q, v_prod.prix);
    if v_prod.suivi_stock then
      update public.produits set stock_restant = stock_restant - v_q where id = v_prod.id;
    end if;
    v_total := v_total + v_prod.prix * v_q;
  end loop;

  if v_paye < 0 or v_paye > v_total then raise exception 'Montant payé invalide'; end if;
  update public.ventes
     set total = v_total, montant_paye = v_paye, reste_a_payer = v_total - v_paye,
         statut_paiement = case when v_paye >= v_total then 'paye' else 'partiel' end
   where id = v_vente;
  if v_paye > 0 then
    insert into public.paiements (vente_id, montant, mode, encaisse_par)
    values (v_vente, v_paye, coalesce(nullif(btrim(p_mode_paiement), ''), 'cash'), v_moi);
  end if;

  perform pg_advisory_xact_lock(hashtext('fallik_depot_' || v_org));
  select coalesce(max(numero), 0) + 1 into v_num from public.depots where organisation_id = v_org;
  insert into public.depots (organisation_id, numero, vente_id, date_retrait_prevue, note, cree_par)
  values (v_org, v_num, v_vente, p_date_retrait, nullif(btrim(coalesce(p_note, '')), ''), v_moi)
  returning id into v_id;

  return jsonb_build_object('id', v_id, 'numero', v_num, 'vente_id', v_vente,
                            'total', v_total, 'paye', v_paye, 'reste', v_total - v_paye);
end;
$$;

-- Changer l'etat (depose / en_cours / pret). Le retrait passe par depot_retirer.
create or replace function public.depot_statut(p_id bigint, p_statut text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org bigint := prive.exiger_pressing(); v_dep record;
begin
  if p_statut not in ('depose', 'en_cours', 'pret') then raise exception 'État invalide'; end if;
  select d.id, d.statut, v.annulee into v_dep
    from public.depots d join public.ventes v on v.id = d.vente_id
   where d.id = p_id and d.organisation_id = v_org for update of d;
  if not found then raise exception 'Dépôt introuvable'; end if;
  if v_dep.annulee then raise exception 'Ce dépôt a été annulé'; end if;
  if v_dep.statut = 'retire' then raise exception 'Ce dépôt a déjà été retiré'; end if;
  update public.depots
     set statut = p_statut,
         pret_le = case when p_statut = 'pret' then coalesce(pret_le, now()) else null end
   where id = p_id;
end;
$$;

-- Retrait : encaisse le reste du (si besoin) puis cloture le depot.
create or replace function public.depot_retirer(p_id bigint, p_mode text default 'cash')
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org bigint := prive.exiger_pressing(); v_moi bigint := prive.mon_utilisateur_id();
  v_dep record; v_reste numeric; v_paye numeric;
begin
  select d.id, d.statut, d.vente_id, v.total, v.annulee into v_dep
    from public.depots d join public.ventes v on v.id = d.vente_id
   where d.id = p_id and d.organisation_id = v_org for update;
  if not found then raise exception 'Dépôt introuvable'; end if;
  if v_dep.annulee then raise exception 'Ce dépôt a été annulé'; end if;
  if v_dep.statut = 'retire' then raise exception 'Ce dépôt a déjà été retiré'; end if;

  select coalesce(sum(montant), 0) into v_paye from public.paiements where vente_id = v_dep.vente_id;
  v_reste := greatest(0, v_dep.total - v_paye);
  if v_reste > 0 then
    insert into public.paiements (vente_id, montant, mode, encaisse_par)
    values (v_dep.vente_id, v_reste, coalesce(nullif(btrim(p_mode), ''), 'cash'), v_moi);
    update public.ventes set montant_paye = v_dep.total, reste_a_payer = 0, statut_paiement = 'paye'
     where id = v_dep.vente_id;
  end if;
  update public.depots set statut = 'retire', retire_le = now(), retire_par = v_moi where id = p_id;
  return jsonb_build_object('encaisse', v_reste);
end;
$$;

-- Liste des depots : 'actifs' (pas encore retires, non annules), 'retires', 'tous'.
create or replace function public.depots_liste(p_filtre text default 'actifs', p_recherche text default null)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org bigint := prive.exiger_pressing(); v_r text := nullif(btrim(coalesce(p_recherche, '')), '');
begin
  return coalesce((
    select jsonb_agg(x order by x->>'tri' desc)
    from (
      select jsonb_build_object(
        'tri', lpad(d.id::text, 12, '0'),
        'id', d.id, 'numero', d.numero, 'statut', d.statut,
        'date_retrait_prevue', d.date_retrait_prevue, 'note', d.note,
        'cree_le', d.cree_le, 'pret_le', d.pret_le, 'retire_le', d.retire_le,
        'client', c.nom, 'telephone', c.telephone,
        'total', v.total, 'paye', v.montant_paye, 'reste', v.reste_a_payer, 'annulee', v.annulee,
        'en_retard', d.statut <> 'retire' and d.date_retrait_prevue is not null and d.date_retrait_prevue < current_date,
        'oublie', d.statut = 'pret' and d.pret_le < now() - interval '30 days',
        'lignes', (select coalesce(jsonb_agg(jsonb_build_object('nom', p.nom, 'quantite', vp.quantite, 'prix', vp.prix_unitaire) order by vp.id), '[]'::jsonb)
                     from public.vente_produits vp join public.produits p on p.id = vp.produit_id
                    where vp.vente_id = v.id)
      ) x
      from public.depots d
      join public.ventes v on v.id = d.vente_id
      left join public.clientes c on c.id = v.cliente_id
      where d.organisation_id = v_org
        and case coalesce(p_filtre, 'actifs')
              when 'actifs'  then d.statut <> 'retire' and not v.annulee
              when 'retires' then d.statut = 'retire'
              else true end
        and (v_r is null
             or (v_r ~ '^#[0-9]+$' and d.numero::text = substr(v_r, 2))
             or (v_r !~ '^#' and (d.numero::text = v_r or c.nom ilike '%' || v_r || '%' or c.telephone ilike '%' || v_r || '%')))
      order by d.id desc
      limit 300
    ) s
  ), '[]'::jsonb);
end;
$$;

revoke execute on function prive.exiger_pressing() from public, anon;
grant execute on function prive.exiger_pressing() to authenticated;
revoke execute on function public.depot_creer(text, text, jsonb, numeric, text, date, text),
  public.depot_statut(bigint, text), public.depot_retirer(bigint, text), public.depots_liste(text, text)
  from public, anon;
grant execute on function public.depot_creer(text, text, jsonb, numeric, text, date, text),
  public.depot_statut(bigint, text), public.depot_retirer(bigint, text), public.depots_liste(text, text)
  to authenticated;

notify pgrst, 'reload schema';
