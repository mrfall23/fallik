-- ═══════════════════════════════════════════════════════════════════════
-- FALLIK — Phase 0 : abonnements, roles, reglages de boutique, securite
--
-- 1. Reglages de boutique sur organisations (logo, couleurs, devise, fuseau,
--    seuil de stock bas, plafond de remise, coordonnees). Modifiables par la
--    boutique, mais SEULEMENT ces colonnes (droits par colonne) : `actif` et
--    `slug` restent hors de portee.
-- 2. Table abonnements (plan Solo/Pro, statut, date d'expiration) : lisible
--    par le proprietaire, modifiable UNIQUEMENT cote serveur (cle secrete /
--    Fall Digital). Une boutique ne peut pas prolonger son propre abonnement.
-- 3. Acces coupe si la boutique est desactivee, suspendue, resiliee ou
--    expiree : les helpers prive.* renvoient null/false, donc TOUTES les
--    policies et RPC existantes bloquent sans etre reecrites.
-- 4. Role « proprietaire » (tout + abonnement). Le premier admin de chaque
--    boutique le devient. Garde-fous : seul un proprietaire change un role,
--    personne ne touche au proprietaire sauf un proprietaire, on ne peut ni
--    se retrograder ni se desactiver soi-meme, il reste toujours au moins un
--    proprietaire actif.
-- 5. Journal des inscriptions (limitation anti-abus, serveur uniquement).
--
-- A executer dans l'editeur SQL du projet Supabase FALLIK (pas Fallora).
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 1. Reglages de boutique ───────────────────────────────────────────
alter table public.organisations
  add column if not exists logo_url           text,
  add column if not exists couleur_principale text    not null default '#2563EB',
  add column if not exists couleur_secondaire text    not null default '#1D4FD0',
  add column if not exists devise             text    not null default 'FCFA',
  add column if not exists fuseau_horaire     text    not null default 'Africa/Douala',
  add column if not exists seuil_stock_bas    integer not null default 5,
  add column if not exists remise_max_pct     numeric not null default 20,
  add column if not exists telephone          text,
  add column if not exists adresse            text;

alter table public.organisations
  drop constraint if exists organisations_nom_check,
  drop constraint if exists organisations_couleur_principale_check,
  drop constraint if exists organisations_couleur_secondaire_check,
  drop constraint if exists organisations_devise_check,
  drop constraint if exists organisations_seuil_stock_bas_check,
  drop constraint if exists organisations_remise_max_pct_check,
  drop constraint if exists organisations_logo_url_check;
alter table public.organisations
  add constraint organisations_nom_check                check (char_length(btrim(nom)) between 1 and 80),
  add constraint organisations_couleur_principale_check check (couleur_principale ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint organisations_couleur_secondaire_check check (couleur_secondaire ~ '^#[0-9A-Fa-f]{6}$'),
  add constraint organisations_devise_check             check (char_length(btrim(devise)) between 1 and 8),
  add constraint organisations_seuil_stock_bas_check    check (seuil_stock_bas between 0 and 100000),
  add constraint organisations_remise_max_pct_check     check (remise_max_pct between 0 and 100),
  add constraint organisations_logo_url_check           check (logo_url is null or logo_url ~ '^https://');

-- Fuseau : doit exister (sinon les calculs « par jour / par mois » casseraient).
create or replace function prive.verifier_fuseau()
returns trigger language plpgsql set search_path = '' as $$
begin
  if not exists (select 1 from pg_catalog.pg_timezone_names where name = new.fuseau_horaire) then
    raise exception 'Fuseau horaire inconnu : %', new.fuseau_horaire;
  end if;
  return new;
end;
$$;
revoke execute on function prive.verifier_fuseau() from public, anon;
drop trigger if exists organisations_verifier_fuseau on public.organisations;
create trigger organisations_verifier_fuseau
  before insert or update of fuseau_horaire on public.organisations
  for each row execute function prive.verifier_fuseau();

-- Droits PAR COLONNE : la boutique ne peut modifier que ses reglages.
-- (actif, slug, id, created_at : serveur uniquement.)
revoke insert, update, delete on public.organisations from authenticated;
grant update (nom, logo_url, couleur_principale, couleur_secondaire, devise,
              fuseau_horaire, seuil_stock_bas, remise_max_pct, telephone, adresse)
  on public.organisations to authenticated;


-- ─── 2. Abonnements ────────────────────────────────────────────────────
create table if not exists public.abonnements (
  organisation_id bigint      primary key references public.organisations (id) on delete cascade,
  plan            text        not null default 'solo' check (plan in ('solo', 'pro')),
  statut          text        not null default 'essai'
                              check (statut in ('essai', 'actif', 'suspendu', 'resilie')),
  date_expiration timestamptz not null,
  note            text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);

create or replace function prive.horodater_abonnement()
returns trigger language plpgsql set search_path = '' as $$
begin
  new.updated_at := now();
  return new;
end;
$$;
revoke execute on function prive.horodater_abonnement() from public, anon;
drop trigger if exists abonnements_horodater on public.abonnements;
create trigger abonnements_horodater before update on public.abonnements
  for each row execute function prive.horodater_abonnement();

-- Boutiques deja creees : essai de 30 jours a partir d'aujourd'hui.
insert into public.abonnements (organisation_id, plan, statut, date_expiration, note)
select o.id, 'solo', 'essai', now() + interval '30 days', 'Cree par la migration phase 0'
  from public.organisations o
 where not exists (select 1 from public.abonnements a where a.organisation_id = o.id);

alter table public.abonnements enable row level security;
-- Lecture seule pour les connectes (filtree par la policy) ; aucune ecriture.
revoke all on public.abonnements from anon, authenticated;
grant select on public.abonnements to authenticated;
grant all on public.abonnements to service_role;


-- ─── 3. Roles : ajout de « proprietaire » ──────────────────────────────
alter table public.utilisateurs drop constraint if exists utilisateurs_role_check;
alter table public.utilisateurs
  add constraint utilisateurs_role_check check (role in ('proprietaire', 'admin', 'vendeuse'));

-- Le premier admin de chaque boutique (celui de l'inscription) devient
-- proprietaire, en base ET dans le jeton (app_metadata, lu par proxy.ts).
with premiers as (
  select distinct on (organisation_id) id
    from public.utilisateurs
   where role = 'admin'
   order by organisation_id, id
)
update public.utilisateurs u set role = 'proprietaire'
  from premiers p
 where u.id = p.id
   and not exists (select 1 from public.utilisateurs x
                    where x.organisation_id = u.organisation_id and x.role = 'proprietaire');

update auth.users au
   set raw_app_meta_data = coalesce(au.raw_app_meta_data, '{}'::jsonb) || jsonb_build_object('role', u.role)
  from public.utilisateurs u
 where u.auth_id = au.id
   and coalesce(au.raw_app_meta_data->>'role', '') is distinct from u.role;


-- ─── 4. Helpers d'identite : acces coupe si boutique non accessible ────
-- Memes signatures qu'avant (create or replace) : toutes les policies et
-- RPC existantes beneficient du controle sans etre reecrites.

create or replace function prive.organisation_accessible(p_org bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1
      from public.organisations o
      join public.abonnements a on a.organisation_id = o.id
     where o.id = p_org
       and o.actif = true
       and a.statut in ('essai', 'actif')
       and a.date_expiration > now()
  )
$$;

create or replace function prive.mon_utilisateur_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select u.id from public.utilisateurs u
   where u.auth_id = (select auth.uid()) and u.actif = true
     and prive.organisation_accessible(u.organisation_id)
$$;

create or replace function prive.mon_organisation_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select u.organisation_id from public.utilisateurs u
   where u.auth_id = (select auth.uid()) and u.actif = true
     and prive.organisation_accessible(u.organisation_id)
$$;

-- est_admin = gestion de la boutique : admin (gerant) OU proprietaire.
create or replace function prive.est_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.utilisateurs u
     where u.auth_id = (select auth.uid()) and u.actif = true
       and u.role in ('admin', 'proprietaire')
       and prive.organisation_accessible(u.organisation_id)
  )
$$;

create or replace function prive.est_proprietaire()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.utilisateurs u
     where u.auth_id = (select auth.uid()) and u.actif = true
       and u.role = 'proprietaire'
       and prive.organisation_accessible(u.organisation_id)
  )
$$;

create or replace function prive.est_connecte()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.utilisateurs u
     where u.auth_id = (select auth.uid()) and u.actif = true
       and prive.organisation_accessible(u.organisation_id)
  )
$$;

revoke execute on function prive.organisation_accessible(bigint), prive.est_proprietaire() from public, anon;
grant execute on function prive.organisation_accessible(bigint), prive.est_proprietaire() to authenticated, service_role;


-- ─── 5. Policies ───────────────────────────────────────────────────────

-- Organisations : modification des reglages par admin/proprietaire (les
-- colonnes autorisees sont limitees par les droits ci-dessus).
drop policy if exists "org: admin modifie la sienne" on public.organisations;
create policy "org: admin modifie la sienne" on public.organisations for update to authenticated
  using (id = prive.mon_organisation_id() and prive.est_admin())
  with check (id = prive.mon_organisation_id() and prive.est_admin());

-- Abonnement : seul le proprietaire de la boutique le lit.
drop policy if exists "abonnements: proprietaire lit" on public.abonnements;
create policy "abonnements: proprietaire lit" on public.abonnements for select to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_proprietaire());

-- Utilisateurs : chacun lit TOUJOURS sa propre fiche (meme boutique expiree),
-- pour que l'app puisse afficher l'ecran « abonnement expire ».
drop policy if exists "users: mon profil" on public.utilisateurs;
create policy "users: mon profil" on public.utilisateurs for select to authenticated
  using (auth_id = (select auth.uid()));

-- Utilisateurs : droits par colonne. Email, auth_id, organisation_id ne se
-- changent que cote serveur (/api/vendeuses, cle secrete).
revoke insert, update on public.utilisateurs from authenticated;
grant update (nom, actif, role) on public.utilisateurs to authenticated;


-- ─── 6. Garde-fous sur les roles ───────────────────────────────────────
create or replace function prive.proteger_utilisateurs()
returns trigger language plpgsql security definer set search_path = '' as $$
declare
  v_moi       uuid := (select auth.uid());
  v_cible     record;
  v_restants  integer;
begin
  -- Cle secrete (routes serveur) et editeur SQL : pas de session -> confiance.
  if v_moi is null then
    return case when tg_op = 'DELETE' then old else new end;
  end if;

  v_cible := old;

  -- Seul un proprietaire touche a une fiche proprietaire.
  if v_cible.role = 'proprietaire' and not prive.est_proprietaire() then
    raise exception 'Seul le proprietaire peut modifier ce compte';
  end if;

  if tg_op = 'UPDATE' then
    -- Seul un proprietaire change un role.
    if new.role is distinct from old.role and not prive.est_proprietaire() then
      raise exception 'Seul le proprietaire peut changer un role';
    end if;
    -- Personne ne se retrograde ni ne se desactive soi-meme.
    if old.auth_id = v_moi and (new.role is distinct from old.role or new.actif = false) then
      raise exception 'Vous ne pouvez pas changer votre propre role ni vous desactiver';
    end if;
    -- Toujours au moins un proprietaire actif.
    if old.role = 'proprietaire' and old.actif and (new.role <> 'proprietaire' or new.actif = false) then
      select count(*) into v_restants from public.utilisateurs
       where organisation_id = old.organisation_id and role = 'proprietaire' and actif and id <> old.id;
      if v_restants = 0 then
        raise exception 'La boutique doit garder au moins un proprietaire actif';
      end if;
    end if;
    return new;
  end if;

  -- DELETE
  if old.auth_id = v_moi then
    raise exception 'Vous ne pouvez pas supprimer votre propre compte';
  end if;
  if old.role = 'proprietaire' and old.actif then
    select count(*) into v_restants from public.utilisateurs
     where organisation_id = old.organisation_id and role = 'proprietaire' and actif and id <> old.id;
    if v_restants = 0 then
      raise exception 'La boutique doit garder au moins un proprietaire actif';
    end if;
  end if;
  return old;
end;
$$;
revoke execute on function prive.proteger_utilisateurs() from public, anon;

drop trigger if exists utilisateurs_proteger on public.utilisateurs;
create trigger utilisateurs_proteger
  before update or delete on public.utilisateurs
  for each row execute function prive.proteger_utilisateurs();


-- ─── 7. Etat d'acces pour l'interface ──────────────────────────────────
-- Toujours appelable (meme boutique expiree) : dit a l'app quoi afficher.
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


-- ─── 8. Journal des inscriptions (anti-abus) ───────────────────────────
create table if not exists public.inscriptions_journal (
  id         bigint generated always as identity primary key,
  ip_hash    text        not null,
  reussie    boolean     not null default false,
  created_at timestamptz not null default now()
);
create index if not exists inscriptions_journal_ip_idx on public.inscriptions_journal (ip_hash, created_at desc);
create index if not exists inscriptions_journal_date_idx on public.inscriptions_journal (created_at desc);
alter table public.inscriptions_journal enable row level security;
-- Aucune policy : serveur uniquement.
revoke all on public.inscriptions_journal from anon, authenticated;
grant all on public.inscriptions_journal to service_role;
