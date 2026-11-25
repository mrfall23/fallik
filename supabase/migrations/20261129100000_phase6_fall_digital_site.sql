-- ═══════════════════════════════════════════════════════════════════════
-- FALLIK — Phase 6 : console Fall Digital, plans Solo / Pro, site web (Pro)
--
-- 1. super_admins : comptes Fall Digital. Table invisible (aucun droit pour
--    les connectes) ; prive.est_super_admin() la lit. Les RPC sa_* refusent
--    tout appel qui ne vient pas d'un super-admin. Fall Digital ne voit que
--    des chiffres agreges des boutiques, jamais leurs ventes en detail.
-- 2. Abonnements pilotes par Fall Digital : prolonger (paiement enregistre),
--    changer plan / statut / echeance, activer / desactiver une boutique.
--    Tout est historise (abonnements_historique, abonnements_paiements).
-- 3. Plan Solo : 2 vendeuses actives au maximum (controle EN BASE, quel que
--    soit le chemin : route serveur, cle secrete, SQL).
-- 4. Site web (Pro) : une cle par boutique. Le site lit le catalogue (prix,
--    stock) et envoie des commandes ; elles arrivent en « commandes en ligne »
--    que le gerant valide (=> vente, stock decompte) ou refuse.
--    Le site ne parle qu'au serveur Fallik (cle secrete), jamais a la base.
--
-- Rejouable. A executer dans l'editeur SQL du projet Supabase FALLIK.
-- Apres l'execution : declarer le compte Fall Digital (voir tout en bas).
-- ═══════════════════════════════════════════════════════════════════════


-- ─── 1. Super-admins ───────────────────────────────────────────────────
create table if not exists public.super_admins (
  auth_id uuid        primary key references auth.users (id) on delete cascade,
  nom     text        not null default 'Fall Digital',
  cree_le timestamptz not null default now()
);
alter table public.super_admins enable row level security;
revoke all on public.super_admins from anon, authenticated;
grant all on public.super_admins to service_role;

create or replace function prive.est_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (select 1 from public.super_admins where auth_id = (select auth.uid()))
$$;
revoke execute on function prive.est_super_admin() from public, anon;
grant execute on function prive.est_super_admin() to authenticated, service_role;

create or replace function public.suis_super_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select prive.est_super_admin()
$$;
revoke execute on function public.suis_super_admin() from public, anon;
grant execute on function public.suis_super_admin() to authenticated;

create or replace function prive.exiger_super_admin()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if not prive.est_super_admin() then raise exception 'Réservé à Fall Digital'; end if;
end;
$$;
revoke execute on function prive.exiger_super_admin() from public, anon;
grant execute on function prive.exiger_super_admin() to authenticated, service_role;

create or replace function prive.prix_plan(p_plan text)
returns numeric language sql immutable set search_path = '' as $$
  select case p_plan when 'pro' then 30000 else 15000 end::numeric
$$;
revoke execute on function prive.prix_plan(text) from public, anon;
grant execute on function prive.prix_plan(text) to authenticated, service_role;


-- ─── 2. Historique et paiements d'abonnement ───────────────────────────
create table if not exists public.abonnements_paiements (
  id              bigint generated always as identity primary key,
  organisation_id bigint      not null references public.organisations (id) on delete cascade,
  montant         numeric     not null check (montant >= 0),
  mode            text        not null default 'mobile_money',
  reference       text,
  plan            text        not null check (plan in ('solo', 'pro')),
  mois            integer     not null check (mois between 1 and 24),
  du              timestamptz not null,
  au              timestamptz not null,
  enregistre_par  uuid,
  cree_le         timestamptz not null default now()
);
create index if not exists abonnements_paiements_org_idx on public.abonnements_paiements (organisation_id, cree_le desc);
alter table public.abonnements_paiements enable row level security;
revoke all on public.abonnements_paiements from anon, authenticated;
grant select (id, organisation_id, montant, mode, reference, plan, mois, du, au, cree_le)
  on public.abonnements_paiements to authenticated;
grant all on public.abonnements_paiements to service_role;
-- Le proprietaire voit les paiements de SA boutique (meme expiree : c'est
-- justement la qu'il en a besoin), rien d'autre.
drop policy if exists "paiements abonnement: proprietaire lit" on public.abonnements_paiements;
create policy "paiements abonnement: proprietaire lit" on public.abonnements_paiements for select to authenticated
  using (organisation_id = (select u.organisation_id from public.utilisateurs u
                             where u.auth_id = (select auth.uid()) and u.actif and u.role = 'proprietaire'));

create table if not exists public.abonnements_historique (
  id              bigint generated always as identity primary key,
  organisation_id bigint      not null references public.organisations (id) on delete cascade,
  action          text        not null,
  avant           jsonb,
  apres           jsonb,
  note            text,
  par             uuid,
  cree_le         timestamptz not null default now()
);
create index if not exists abonnements_historique_org_idx on public.abonnements_historique (organisation_id, id desc);
alter table public.abonnements_historique enable row level security;
revoke all on public.abonnements_historique from anon, authenticated;
grant all on public.abonnements_historique to service_role;

create or replace function prive.etat_abonnement(p_org bigint)
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('plan', a.plan, 'statut', a.statut, 'date_expiration', a.date_expiration, 'actif', o.actif)
    from public.organisations o left join public.abonnements a on a.organisation_id = o.id
   where o.id = p_org
$$;
revoke execute on function prive.etat_abonnement(bigint) from public, anon;
grant execute on function prive.etat_abonnement(bigint) to authenticated, service_role;


-- ─── 3. Console Fall Digital ───────────────────────────────────────────

-- Liste des boutiques avec leurs chiffres cles (agreges uniquement).
create or replace function public.sa_boutiques()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform prive.exiger_super_admin();
  return coalesce((
    select jsonb_agg(x order by x->>'date_expiration')
      from (
        select jsonb_build_object(
          'id', o.id, 'nom', o.nom, 'slug', o.slug, 'actif', o.actif, 'cree_le', o.created_at,
          'telephone', o.telephone, 'devise', o.devise,
          'plan', a.plan, 'statut', a.statut, 'date_expiration', a.date_expiration, 'note', a.note,
          'accessible', prive.organisation_accessible(o.id),
          'proprietaire', (select jsonb_build_object('nom', u.nom, 'email', u.email)
                             from public.utilisateurs u
                            where u.organisation_id = o.id and u.role = 'proprietaire'
                            order by u.actif desc, u.id limit 1),
          'nb_vendeuses', (select count(*) from public.utilisateurs u
                            where u.organisation_id = o.id and u.role = 'vendeuse' and u.actif),
          'nb_comptes', (select count(*) from public.utilisateurs u where u.organisation_id = o.id and u.actif),
          'nb_produits', (select count(*) from public.produits p where p.organisation_id = o.id and p.actif),
          'ventes_30j', (select count(*) from public.ventes v
                          where v.organisation_id = o.id and not v.annulee and v.date_vente > now() - interval '30 days'),
          'ca_30j', (select coalesce(sum(v.total), 0) from public.ventes v
                      where v.organisation_id = o.id and not v.annulee and v.date_vente > now() - interval '30 days'),
          'derniere_vente', (select max(v.date_vente) from public.ventes v where v.organisation_id = o.id),
          'site_actif', exists (select 1 from public.sites_web s where s.organisation_id = o.id and s.cle_hash is not null),
          'total_paye', (select coalesce(sum(p.montant), 0) from public.abonnements_paiements p where p.organisation_id = o.id)
        ) x
          from public.organisations o
          left join public.abonnements a on a.organisation_id = o.id
      ) t
  ), '[]'::jsonb);
end;
$$;

-- Chiffres globaux de Fall Digital.
create or replace function public.sa_tableau()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_debut_mois timestamptz := date_trunc('month', now() at time zone 'Africa/Douala') at time zone 'Africa/Douala';
begin
  perform prive.exiger_super_admin();
  return jsonb_build_object(
    'boutiques', (select count(*) from public.organisations),
    'accessibles', (select count(*) from public.organisations o where prive.organisation_accessible(o.id)),
    'essai', (select count(*) from public.abonnements a join public.organisations o on o.id = a.organisation_id
               where o.actif and a.statut = 'essai' and a.date_expiration > now()),
    'payantes', (select count(*) from public.abonnements a join public.organisations o on o.id = a.organisation_id
                  where o.actif and a.statut = 'actif' and a.date_expiration > now()),
    'pro', (select count(*) from public.abonnements a join public.organisations o on o.id = a.organisation_id
             where o.actif and a.statut = 'actif' and a.date_expiration > now() and a.plan = 'pro'),
    'expirees', (select count(*) from public.abonnements a
                  where a.statut in ('essai', 'actif') and a.date_expiration <= now()),
    'expirent_7j', (select count(*) from public.abonnements a join public.organisations o on o.id = a.organisation_id
                     where o.actif and a.statut in ('essai', 'actif')
                       and a.date_expiration > now() and a.date_expiration <= now() + interval '7 days'),
    'revenu_mensuel', (select coalesce(sum(prive.prix_plan(a.plan)), 0) from public.abonnements a
                        join public.organisations o on o.id = a.organisation_id
                       where o.actif and a.statut = 'actif' and a.date_expiration > now()),
    'encaisse_mois', (select coalesce(sum(p.montant), 0) from public.abonnements_paiements p where p.cree_le >= v_debut_mois),
    'encaisse_total', (select coalesce(sum(p.montant), 0) from public.abonnements_paiements p),
    'inscriptions_30j', (select count(*) from public.organisations o where o.created_at > now() - interval '30 days')
  );
end;
$$;

-- Prolonger un abonnement apres paiement. Repart de l'echeance si elle est
-- dans le futur (aucun jour perdu), sinon d'aujourd'hui.
create or replace function public.sa_prolonger(
  p_org bigint, p_mois integer, p_montant numeric, p_mode text, p_reference text default null, p_plan text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_ab public.abonnements; v_avant jsonb; v_du timestamptz; v_au timestamptz; v_plan text;
begin
  perform prive.exiger_super_admin();
  if p_mois is null or p_mois not between 1 and 24 then raise exception 'Durée invalide (1 à 24 mois)'; end if;
  if p_montant is null or p_montant < 0 then raise exception 'Montant invalide'; end if;
  if p_plan is not null and p_plan not in ('solo', 'pro') then raise exception 'Plan invalide'; end if;

  select * into v_ab from public.abonnements where organisation_id = p_org for update;
  if not found then
    if not exists (select 1 from public.organisations where id = p_org) then raise exception 'Boutique introuvable'; end if;
    insert into public.abonnements (organisation_id, plan, statut, date_expiration)
    values (p_org, coalesce(p_plan, 'solo'), 'essai', now()) returning * into v_ab;
  end if;
  v_avant := prive.etat_abonnement(p_org);
  v_plan := coalesce(p_plan, v_ab.plan);
  v_du := greatest(now(), v_ab.date_expiration);
  v_au := v_du + make_interval(months => p_mois);

  update public.abonnements set plan = v_plan, statut = 'actif', date_expiration = v_au
   where organisation_id = p_org;
  insert into public.abonnements_paiements (organisation_id, montant, mode, reference, plan, mois, du, au, enregistre_par)
  values (p_org, p_montant, coalesce(nullif(btrim(p_mode), ''), 'mobile_money'), nullif(btrim(coalesce(p_reference, '')), ''),
          v_plan, p_mois, v_du, v_au, (select auth.uid()));
  insert into public.abonnements_historique (organisation_id, action, avant, apres, note, par)
  values (p_org, 'prolongation', v_avant, prive.etat_abonnement(p_org),
          format('%s mois, %s', p_mois, p_montant), (select auth.uid()));
  return prive.etat_abonnement(p_org);
end;
$$;

-- Correction manuelle (plan, statut, echeance, note). Les parametres null
-- ne changent rien.
create or replace function public.sa_modifier_abonnement(
  p_org bigint, p_plan text default null, p_statut text default null,
  p_date_expiration timestamptz default null, p_note text default null
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_avant jsonb;
begin
  perform prive.exiger_super_admin();
  if p_plan is not null and p_plan not in ('solo', 'pro') then raise exception 'Plan invalide'; end if;
  if p_statut is not null and p_statut not in ('essai', 'actif', 'suspendu', 'resilie') then raise exception 'Statut invalide'; end if;
  if not exists (select 1 from public.abonnements where organisation_id = p_org) then raise exception 'Boutique introuvable'; end if;
  v_avant := prive.etat_abonnement(p_org);
  update public.abonnements
     set plan = coalesce(p_plan, plan), statut = coalesce(p_statut, statut),
         date_expiration = coalesce(p_date_expiration, date_expiration),
         note = case when p_note is null then note else nullif(btrim(p_note), '') end
   where organisation_id = p_org;
  insert into public.abonnements_historique (organisation_id, action, avant, apres, note, par)
  values (p_org, 'modification', v_avant, prive.etat_abonnement(p_org), p_note, (select auth.uid()));
  return prive.etat_abonnement(p_org);
end;
$$;

-- Activer / desactiver une boutique (coupe l'acces de tous ses comptes).
create or replace function public.sa_activer_boutique(p_org bigint, p_actif boolean)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_avant jsonb;
begin
  perform prive.exiger_super_admin();
  if p_actif is null then raise exception 'Valeur invalide'; end if;
  v_avant := prive.etat_abonnement(p_org);
  if v_avant is null then raise exception 'Boutique introuvable'; end if;
  update public.organisations set actif = p_actif where id = p_org;
  insert into public.abonnements_historique (organisation_id, action, avant, apres, par)
  values (p_org, case when p_actif then 'activation' else 'desactivation' end, v_avant, prive.etat_abonnement(p_org), (select auth.uid()));
  return prive.etat_abonnement(p_org);
end;
$$;

-- Historique d'une boutique (paiements + changements).
create or replace function public.sa_historique(p_org bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
begin
  perform prive.exiger_super_admin();
  return jsonb_build_object(
    'paiements', coalesce((select jsonb_agg(to_jsonb(p) - 'enregistre_par' order by p.id desc)
                             from public.abonnements_paiements p where p.organisation_id = p_org), '[]'::jsonb),
    'changements', coalesce((select jsonb_agg(to_jsonb(h) - 'par' order by h.id desc)
                               from (select * from public.abonnements_historique
                                      where organisation_id = p_org order by id desc limit 50) h), '[]'::jsonb)
  );
end;
$$;

revoke execute on function public.sa_boutiques(), public.sa_tableau(),
  public.sa_prolonger(bigint, integer, numeric, text, text, text),
  public.sa_modifier_abonnement(bigint, text, text, timestamptz, text),
  public.sa_activer_boutique(bigint, boolean), public.sa_historique(bigint)
  from public, anon;
grant execute on function public.sa_boutiques(), public.sa_tableau(),
  public.sa_prolonger(bigint, integer, numeric, text, text, text),
  public.sa_modifier_abonnement(bigint, text, text, timestamptz, text),
  public.sa_activer_boutique(bigint, boolean), public.sa_historique(bigint)
  to authenticated;


-- ─── 4. Plan Solo : 2 vendeuses actives ────────────────────────────────
create or replace function prive.limite_vendeuses(p_org bigint)
returns integer language sql stable security definer set search_path = '' as $$
  select case when a.plan = 'pro' then null else 2 end
    from public.abonnements a where a.organisation_id = p_org
$$;
revoke execute on function prive.limite_vendeuses(bigint) from public, anon;
grant execute on function prive.limite_vendeuses(bigint) to authenticated, service_role;

create or replace function prive.controler_limite_vendeuses()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_limite integer; v_nb integer;
begin
  if new.role <> 'vendeuse' or not new.actif then return new; end if;
  if tg_op = 'UPDATE' and old.role = 'vendeuse' and old.actif and old.organisation_id = new.organisation_id then
    return new; -- deja comptee
  end if;
  v_limite := prive.limite_vendeuses(new.organisation_id);
  if v_limite is null then return new; end if;
  -- Verrou par boutique : deux creations simultanees ne depassent pas la limite.
  perform pg_advisory_xact_lock(hashtextextended('fallik_vendeuses_' || new.organisation_id, 0));
  select count(*) into v_nb from public.utilisateurs
   where organisation_id = new.organisation_id and role = 'vendeuse' and actif and id <> coalesce(new.id, -1);
  if v_nb >= v_limite then
    raise exception 'Plan Solo : % vendeuses actives au maximum. Passez au plan Pro pour en ajouter.', v_limite;
  end if;
  return new;
end;
$$;
revoke execute on function prive.controler_limite_vendeuses() from public, anon;
drop trigger if exists utilisateurs_limite_plan on public.utilisateurs;
create trigger utilisateurs_limite_plan before insert or update of role, actif, organisation_id on public.utilisateurs
  for each row execute function prive.controler_limite_vendeuses();


-- ─── 5. Site web (Pro) ─────────────────────────────────────────────────
create table if not exists public.sites_web (
  organisation_id bigint      primary key references public.organisations (id) on delete cascade,
  cle_hash        text        unique,
  cle_debut       text,
  cree_le         timestamptz not null default now(),
  maj_le          timestamptz not null default now()
);
alter table public.sites_web enable row level security;
revoke all on public.sites_web from anon, authenticated;
grant select (organisation_id, cle_debut, cree_le, maj_le) on public.sites_web to authenticated;
grant all on public.sites_web to service_role;
drop policy if exists "sites: gestion lit" on public.sites_web;
create policy "sites: gestion lit" on public.sites_web for select to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());

create or replace function prive.est_pro(p_org bigint)
returns boolean language sql stable security definer set search_path = '' as $$
  select prive.organisation_accessible(p_org)
     and exists (select 1 from public.abonnements a where a.organisation_id = p_org and a.plan = 'pro')
$$;
revoke execute on function prive.est_pro(bigint) from public, anon;
grant execute on function prive.est_pro(bigint) to authenticated, service_role;

-- Le serveur tire la cle au hasard, la montre UNE fois au proprietaire et
-- n'envoie ici que son empreinte (sha256, 64 hex).
create or replace function public.site_generer_cle(p_cle_hash text, p_cle_debut text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org bigint := prive.mon_organisation_id();
begin
  if v_org is null or not prive.est_proprietaire() then raise exception 'Réservé au propriétaire'; end if;
  if not prive.est_pro(v_org) then raise exception 'Le lien avec un site web est réservé au plan Pro'; end if;
  if p_cle_hash is null or p_cle_hash !~ '^[0-9a-f]{64}$' then raise exception 'Clé invalide'; end if;
  insert into public.sites_web (organisation_id, cle_hash, cle_debut)
  values (v_org, p_cle_hash, left(coalesce(p_cle_debut, ''), 12))
  on conflict (organisation_id) do update
    set cle_hash = excluded.cle_hash, cle_debut = excluded.cle_debut, maj_le = now();
  perform prive.journaliser('site_cle_generee', 'attention', jsonb_build_object('debut', left(coalesce(p_cle_debut, ''), 12)), null);
end;
$$;

create or replace function public.site_desactiver()
returns void language plpgsql security definer set search_path = '' as $$
declare v_org bigint := prive.mon_organisation_id();
begin
  if v_org is null or not prive.est_proprietaire() then raise exception 'Réservé au propriétaire'; end if;
  update public.sites_web set cle_hash = null, cle_debut = null, maj_le = now() where organisation_id = v_org;
  perform prive.journaliser('site_desactive', 'attention', '{}'::jsonb, null);
end;
$$;

create table if not exists public.commandes_en_ligne (
  id               bigint generated always as identity primary key,
  organisation_id  bigint      not null references public.organisations (id) on delete cascade,
  reference        text        not null,
  client_nom       text        not null,
  client_telephone text        not null,
  client_adresse   text,
  note             text,
  total            numeric     not null default 0,
  statut           text        not null default 'nouvelle' check (statut in ('nouvelle', 'validee', 'refusee')),
  vente_id         bigint      references public.ventes (id) on delete set null,
  motif_refus      text,
  traitee_par      bigint      references public.utilisateurs (id) on delete set null,
  traitee_le       timestamptz,
  ip_hash          text,
  cree_le          timestamptz not null default now(),
  unique (organisation_id, reference)
);
create index if not exists commandes_en_ligne_org_idx on public.commandes_en_ligne (organisation_id, id desc);
create index if not exists commandes_en_ligne_ip_idx on public.commandes_en_ligne (organisation_id, ip_hash, cree_le desc);

create table if not exists public.commande_en_ligne_lignes (
  id            bigint generated always as identity primary key,
  commande_id   bigint  not null references public.commandes_en_ligne (id) on delete cascade,
  produit_id    bigint  references public.produits (id) on delete set null,
  nom           text    not null,
  quantite      integer not null check (quantite > 0),
  prix_unitaire numeric not null check (prix_unitaire >= 0)
);
create index if not exists commande_en_ligne_lignes_cmd_idx on public.commande_en_ligne_lignes (commande_id);

alter table public.commandes_en_ligne enable row level security;
alter table public.commande_en_ligne_lignes enable row level security;
revoke all on public.commandes_en_ligne, public.commande_en_ligne_lignes from anon, authenticated;
grant select (id, organisation_id, reference, client_nom, client_telephone, client_adresse, note, total, statut,
              vente_id, motif_refus, traitee_par, traitee_le, cree_le)
  on public.commandes_en_ligne to authenticated;
grant select on public.commande_en_ligne_lignes to authenticated;
grant all on public.commandes_en_ligne, public.commande_en_ligne_lignes to service_role;

drop policy if exists "commandes: gestion lit" on public.commandes_en_ligne;
create policy "commandes: gestion lit" on public.commandes_en_ligne for select to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());
drop policy if exists "commandes lignes: gestion lit" on public.commande_en_ligne_lignes;
create policy "commandes lignes: gestion lit" on public.commande_en_ligne_lignes for select to authenticated
  using (exists (select 1 from public.commandes_en_ligne c
                  where c.id = commande_id and c.organisation_id = prive.mon_organisation_id() and prive.est_admin()));

-- File d'alertes : nouveau type « commande ».
alter table public.alertes_file drop constraint if exists alertes_file_type_check;
alter table public.alertes_file add constraint alertes_file_type_check check (type in ('vente', 'stock_bas', 'commande'));

-- Boutique d'une cle (Pro, accessible, cle active), sinon null.
create or replace function prive.boutique_du_site(p_cle_hash text)
returns bigint language sql stable security definer set search_path = '' as $$
  select s.organisation_id from public.sites_web s
   where p_cle_hash is not null and s.cle_hash = p_cle_hash and prive.est_pro(s.organisation_id)
$$;
revoke execute on function prive.boutique_du_site(text) from public, anon;
grant execute on function prive.boutique_du_site(text) to service_role;

-- Catalogue public (serveur uniquement : la route /api/site/catalogue).
create or replace function public.site_catalogue(p_cle_hash text)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_org bigint := prive.boutique_du_site(p_cle_hash);
begin
  if v_org is null then return null; end if;
  return jsonb_build_object(
    'boutique', (select jsonb_build_object('nom', o.nom, 'devise', o.devise, 'telephone', o.telephone,
                                           'adresse', o.adresse, 'logo_url', o.logo_url, 'couleur', o.couleur_principale)
                   from public.organisations o where o.id = v_org),
    'produits', coalesce((select jsonb_agg(jsonb_build_object(
                   'id', p.id, 'nom', p.nom, 'prix', p.prix, 'description', p.description, 'image', p.image,
                   'stock', p.stock_restant, 'disponible', p.stock_restant > 0) order by p.nom)
                   from public.produits p where p.organisation_id = v_org and p.actif), '[]'::jsonb)
  );
end;
$$;

-- Commande envoyee par le site (serveur uniquement). Rien n'est decompte du
-- stock tant que le gerant n'a pas valide.
create or replace function public.site_commander(p_cle_hash text, p_client jsonb, p_lignes jsonb, p_ip_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_org bigint := prive.boutique_du_site(p_cle_hash);
  v_nom text; v_tel text; v_cmd bigint; v_ref text; v_total numeric := 0;
  v_item jsonb; v_prod record; v_q integer;
begin
  if v_org is null then return jsonb_build_object('ok', false, 'erreur', 'Boutique introuvable ou site désactivé.'); end if;
  v_nom := left(btrim(coalesce(p_client->>'nom', '')), 120);
  v_tel := left(regexp_replace(coalesce(p_client->>'telephone', ''), '[^0-9+]', '', 'g'), 20);
  if v_nom = '' then return jsonb_build_object('ok', false, 'erreur', 'Votre nom est obligatoire.'); end if;
  if length(v_tel) < 6 then return jsonb_build_object('ok', false, 'erreur', 'Votre numéro de téléphone est obligatoire.'); end if;
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) = 0 then
    return jsonb_build_object('ok', false, 'erreur', 'Le panier est vide.');
  end if;
  if jsonb_array_length(p_lignes) > 50 then return jsonb_build_object('ok', false, 'erreur', 'Trop d''articles.'); end if;

  -- Anti-abus : 10 commandes / heure / client, 200 / heure / boutique.
  if p_ip_hash is not null and (select count(*) from public.commandes_en_ligne
       where organisation_id = v_org and ip_hash = p_ip_hash and cree_le > now() - interval '1 hour') >= 10 then
    return jsonb_build_object('ok', false, 'erreur', 'Trop de commandes. Réessayez plus tard.');
  end if;
  if (select count(*) from public.commandes_en_ligne
       where organisation_id = v_org and cree_le > now() - interval '1 hour') >= 200 then
    return jsonb_build_object('ok', false, 'erreur', 'Trop de commandes. Réessayez plus tard.');
  end if;

  v_ref := 'CMD-' || upper(substr(md5(random()::text || clock_timestamp()::text), 1, 6));
  insert into public.commandes_en_ligne (organisation_id, reference, client_nom, client_telephone, client_adresse, note, ip_hash)
  values (v_org, v_ref, v_nom, v_tel,
          nullif(left(btrim(coalesce(p_client->>'adresse', '')), 200), ''),
          nullif(left(btrim(coalesce(p_client->>'note', '')), 500), ''), p_ip_hash)
  returning id into v_cmd;

  for v_item in select * from jsonb_array_elements(p_lignes) loop
    begin
      v_q := (v_item->>'quantite')::integer;
    exception when others then v_q := null;
    end;
    if v_q is null or v_q <= 0 or v_q > 999 then raise exception 'Quantité invalide'; end if;
    select id, nom, prix, stock_restant into v_prod from public.produits
     where id = (case when (v_item->>'produit_id') ~ '^[0-9]{1,18}$' then (v_item->>'produit_id')::bigint end)
       and organisation_id = v_org and actif;
    if not found then raise exception 'Produit introuvable'; end if;
    if v_prod.stock_restant < v_q then raise exception 'Stock insuffisant pour %', v_prod.nom; end if;
    insert into public.commande_en_ligne_lignes (commande_id, produit_id, nom, quantite, prix_unitaire)
    values (v_cmd, v_prod.id, v_prod.nom, v_q, v_prod.prix);
    v_total := v_total + v_prod.prix * v_q;
  end loop;

  update public.commandes_en_ligne set total = v_total where id = v_cmd;
  insert into public.alertes_file (organisation_id, type, ref) values (v_org, 'commande', v_cmd);
  return jsonb_build_object('ok', true, 'reference', v_ref, 'total', v_total, 'organisation_id', v_org);
exception
  when raise_exception then
    return jsonb_build_object('ok', false, 'erreur', sqlerrm);
end;
$$;

revoke execute on function public.site_catalogue(text), public.site_commander(text, jsonb, jsonb, text)
  from public, anon, authenticated;
grant execute on function public.site_catalogue(text), public.site_commander(text, jsonb, jsonb, text) to service_role;
revoke execute on function public.site_generer_cle(text, text), public.site_desactiver() from public, anon;
grant execute on function public.site_generer_cle(text, text), public.site_desactiver() to authenticated;

-- Validation par le gerant : la commande devient une vente (prix et stock
-- du moment, memes regles qu'une vente en boutique).
create or replace function public.commande_valider(p_id bigint, p_mode text, p_montant_paye numeric default null)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_cmd public.commandes_en_ligne; v_produits jsonb; v_vente bigint; v_total numeric;
begin
  if prive.mon_organisation_id() is null or not prive.est_admin() then raise exception 'Réservé au gérant'; end if;
  select * into v_cmd from public.commandes_en_ligne
   where id = p_id and organisation_id = prive.mon_organisation_id() for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if v_cmd.statut <> 'nouvelle' then raise exception 'Commande déjà traitée'; end if;
  if exists (select 1 from public.commande_en_ligne_lignes where commande_id = p_id and produit_id is null) then
    raise exception 'Un produit de la commande a été supprimé';
  end if;
  select jsonb_agg(jsonb_build_object('produit_id', produit_id, 'quantite', quantite)), sum(quantite * prix_unitaire)
    into v_produits, v_total
    from public.commande_en_ligne_lignes where commande_id = p_id;
  if v_produits is null then raise exception 'Commande vide'; end if;

  v_vente := public.enregistrer_vente(
    v_cmd.client_nom, v_cmd.client_telephone, v_produits,
    case when p_montant_paye is null then 'paye' else 'partiel' end,
    p_montant_paye, p_mode, null);

  update public.commandes_en_ligne
     set statut = 'validee', vente_id = v_vente, traitee_par = prive.mon_utilisateur_id(), traitee_le = now()
   where id = p_id;
  perform prive.journaliser('commande_validee', 'info',
    jsonb_build_object('commande', v_cmd.reference, 'vente', v_vente, 'client', v_cmd.client_nom), v_total);
  return v_vente;
end;
$$;

create or replace function public.commande_refuser(p_id bigint, p_motif text default null)
returns void language plpgsql security definer set search_path = '' as $$
declare v_cmd public.commandes_en_ligne;
begin
  if prive.mon_organisation_id() is null or not prive.est_admin() then raise exception 'Réservé au gérant'; end if;
  select * into v_cmd from public.commandes_en_ligne
   where id = p_id and organisation_id = prive.mon_organisation_id() for update;
  if not found then raise exception 'Commande introuvable'; end if;
  if v_cmd.statut <> 'nouvelle' then raise exception 'Commande déjà traitée'; end if;
  update public.commandes_en_ligne
     set statut = 'refusee', motif_refus = nullif(left(btrim(coalesce(p_motif, '')), 300), ''),
         traitee_par = prive.mon_utilisateur_id(), traitee_le = now()
   where id = p_id;
  perform prive.journaliser('commande_refusee', 'info',
    jsonb_build_object('commande', v_cmd.reference, 'client', v_cmd.client_nom, 'motif', p_motif), v_cmd.total);
end;
$$;
revoke execute on function public.commande_valider(bigint, text, numeric), public.commande_refuser(bigint, text) from public, anon;
grant execute on function public.commande_valider(bigint, text, numeric), public.commande_refuser(bigint, text) to authenticated;

notify pgrst, 'reload schema';


-- ─── Apres l'execution : declarer le compte Fall Digital ───────────────
-- Remplacer l'email par celui du compte Fallik qui doit acceder a la
-- console /fall-digital, puis executer SEULEMENT ces deux lignes :
--
--   insert into public.super_admins (auth_id)
--   select id from auth.users where email = 'VOTRE_EMAIL' on conflict do nothing;
