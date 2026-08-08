-- ═══════════════════════════════════════════════════════════════════════
-- FALLIK — Schema initial multi-entreprises (multi-tenant)
--
-- Chaque commerçant = une "organisation". Toutes les donnees metier portent
-- un organisation_id, et la RLS garantit qu'un utilisateur ne voit QUE les
-- donnees de son organisation. Modele repris de Fallora (RLS + security
-- definer + search_path vide), etendu a l'isolation par organisation.
--
-- L'inscription (creation compte + organisation + 1er admin) se fait par une
-- route serveur a cle secrete (/api/inscription), pas ici : createUser vit
-- dans auth, cote serveur.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── Schema prive : helpers d'identite, hors de l'API REST ──────────────
create schema if not exists prive;
revoke all on schema prive from public, anon;
grant usage on schema prive to authenticated, service_role;

-- ─── 1. Tables ─────────────────────────────────────────────────────────

create table public.organisations (
  id         bigint generated always as identity primary key,
  nom        text not null,
  slug       text unique,
  actif      boolean not null default true,
  created_at timestamptz not null default now()
);

create table public.utilisateurs (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  auth_id         uuid unique references auth.users (id) on delete cascade,
  nom             text not null,
  email           text not null,
  role            text not null default 'vendeuse' check (role in ('admin', 'vendeuse')),
  actif           boolean not null default true,
  created_at      timestamptz not null default now()
);
-- Email unique globalement (auth.users l'exige aussi), insensible a la casse.
create unique index utilisateurs_email_unique on public.utilisateurs (lower(email));
create index utilisateurs_org_idx on public.utilisateurs (organisation_id);

create table public.produits (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  nom             text not null,
  prix            numeric not null default 0 check (prix >= 0),
  description     text,
  stock_restant   integer not null default 0 check (stock_restant >= 0),
  stock_initial   integer not null default 0,
  image           text,
  actif           boolean not null default true,
  created_at      timestamptz not null default now()
);
create index produits_org_idx on public.produits (organisation_id);

create table public.clientes (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  nom             text not null,
  telephone       text,
  created_at      timestamptz not null default now()
);
-- Dedup par telephone PAR organisation (un client de la boutique A n'est pas
-- celui de la boutique B).
create unique index clientes_org_tel_unique
  on public.clientes (organisation_id, telephone)
  where telephone is not null;
create index clientes_org_idx on public.clientes (organisation_id);

create table public.ventes (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  vendeuse_id     bigint references public.utilisateurs (id),
  cliente_id      bigint references public.clientes (id),
  total           numeric not null default 0,
  montant_paye    numeric not null default 0,
  reste_a_payer   numeric not null default 0,
  statut_paiement text not null check (statut_paiement in ('paye', 'partiel')),
  annulee         boolean not null default false,
  date_vente      timestamptz not null default now()
);
create index ventes_org_idx on public.ventes (organisation_id);
create index ventes_vendeuse_idx on public.ventes (vendeuse_id);

create table public.vente_produits (
  id            bigint generated always as identity primary key,
  vente_id      bigint not null references public.ventes (id) on delete cascade,
  produit_id    bigint references public.produits (id),
  quantite      integer not null check (quantite > 0),
  prix_unitaire numeric not null
);
create index vente_produits_vente_idx on public.vente_produits (vente_id);

create table public.paiements (
  id         bigint generated always as identity primary key,
  vente_id   bigint not null references public.ventes (id) on delete cascade,
  montant    numeric not null,
  mode       text not null default 'cash',
  created_at timestamptz not null default now()
);
create index paiements_vente_idx on public.paiements (vente_id);

create table public.push_subscriptions (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  utilisateur_id  bigint not null references public.utilisateurs (id) on delete cascade,
  endpoint        text not null unique,
  p256dh          text not null,
  auth            text not null,
  created_at      timestamptz not null default now()
);
create index push_subscriptions_org_idx on public.push_subscriptions (organisation_id);

-- ─── 2. Droits de base ─────────────────────────────────────────────────
-- service_role (cle secrete) doit pouvoir tout faire (routes serveur).
-- Lecon Fallora : sans grant explicite, "permission denied" cote serveur.
grant all on all tables in schema public to service_role;
grant usage, select on all sequences in schema public to service_role;
alter default privileges in schema public grant all on tables to service_role;
alter default privileges in schema public grant usage, select on sequences to service_role;

-- anon n'a rien a faire dans public (auth se joue dans le schema auth).
revoke all on all tables in schema public from anon;
alter default privileges in schema public revoke all on tables from anon;

-- ─── 3. Helpers d'identite (security definer, search_path vide) ─────────

create function prive.mon_utilisateur_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select id from public.utilisateurs
  where auth_id = (select auth.uid()) and actif = true
$$;

create function prive.mon_organisation_id()
returns bigint language sql stable security definer set search_path = '' as $$
  select organisation_id from public.utilisateurs
  where auth_id = (select auth.uid()) and actif = true
$$;

create function prive.est_admin()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.utilisateurs
    where auth_id = (select auth.uid()) and actif = true and role = 'admin'
  )
$$;

create function prive.est_connecte()
returns boolean language sql stable security definer set search_path = '' as $$
  select exists (
    select 1 from public.utilisateurs
    where auth_id = (select auth.uid()) and actif = true
  )
$$;

revoke execute on function prive.mon_utilisateur_id(), prive.mon_organisation_id(),
  prive.est_admin(), prive.est_connecte() from public, anon;
grant execute on function prive.mon_utilisateur_id(), prive.mon_organisation_id(),
  prive.est_admin(), prive.est_connecte() to authenticated;

-- ─── 4. Enregistrement d'une vente (atomique, org-aware) ───────────────

create function public.enregistrer_vente(
  p_cliente_nom text,
  p_cliente_telephone text,
  p_produits jsonb,
  p_statut_paiement text,
  p_montant_paye numeric,
  p_mode_paiement text
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_vendeuse_id bigint;
  v_org_id      bigint;
  v_cliente_id  bigint;
  v_vente_id    bigint;
  v_total       numeric := 0;
  v_item        jsonb;
  v_produit     record;
  v_quantite    integer;
  v_tel         text;
  v_final       numeric;
begin
  v_vendeuse_id := prive.mon_utilisateur_id();
  v_org_id      := prive.mon_organisation_id();
  if v_vendeuse_id is null or v_org_id is null then
    raise exception 'Non authentifie';
  end if;

  if p_cliente_nom is null or btrim(p_cliente_nom) = '' then
    raise exception 'Le nom de la cliente est obligatoire';
  end if;
  if p_produits is null or jsonb_array_length(p_produits) = 0 then
    raise exception 'Le panier est vide';
  end if;
  if p_statut_paiement not in ('paye', 'partiel') then
    raise exception 'Statut de paiement invalide';
  end if;

  -- Cliente : dedup par telephone DANS l'organisation.
  v_tel := nullif(btrim(coalesce(p_cliente_telephone, '')), '');
  if v_tel is not null then
    select id into v_cliente_id from public.clientes
     where organisation_id = v_org_id and telephone = v_tel;
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

  for v_item in select * from jsonb_array_elements(p_produits)
  loop
    v_quantite := (v_item->>'quantite')::integer;
    if v_quantite is null or v_quantite <= 0 then
      raise exception 'Quantite invalide';
    end if;

    -- Verrou + controle d'appartenance a l'organisation.
    select id, nom, prix, stock_restant into v_produit
      from public.produits
     where id = (v_item->>'produit_id')::bigint
       and organisation_id = v_org_id
       and actif = true
     for update;
    if not found then
      raise exception 'Produit introuvable ou inactif';
    end if;
    if v_produit.stock_restant < v_quantite then
      raise exception 'Stock insuffisant pour %', v_produit.nom;
    end if;

    insert into public.vente_produits (vente_id, produit_id, quantite, prix_unitaire)
    values (v_vente_id, v_produit.id, v_quantite, v_produit.prix);

    update public.produits set stock_restant = stock_restant - v_quantite
     where id = v_produit.id;

    v_total := v_total + (v_produit.prix * v_quantite);
  end loop;

  v_final := case when p_statut_paiement = 'paye' then v_total else coalesce(p_montant_paye, 0) end;
  if v_final < 0 or v_final > v_total then
    raise exception 'Montant paye invalide';
  end if;

  update public.ventes
     set total = v_total, montant_paye = v_final, reste_a_payer = greatest(0, v_total - v_final)
   where id = v_vente_id;

  insert into public.paiements (vente_id, montant, mode)
  values (v_vente_id, v_final, coalesce(nullif(btrim(p_mode_paiement), ''), 'cash'));

  return v_vente_id;
end;
$$;

revoke execute on function public.enregistrer_vente(text, text, jsonb, text, numeric, text) from public, anon;
grant execute on function public.enregistrer_vente(text, text, jsonb, text, numeric, text) to authenticated;

-- ─── 5. Tableau de bord admin (agregation, org-aware) ──────────────────

create function public.tableau_de_bord_admin()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_org bigint;
  v_result jsonb;
begin
  if not prive.est_admin() then
    raise exception 'Acces reserve a l''administratrice';
  end if;
  v_org := prive.mon_organisation_id();

  select jsonb_build_object(
    'stats', jsonb_build_object(
      'total_ventes', coalesce((select sum(total) from public.ventes where organisation_id = v_org and annulee = false), 0),
      'produits_vendus', coalesce((select sum(vp.quantite) from public.vente_produits vp
        join public.ventes v on v.id = vp.vente_id where v.organisation_id = v_org and v.annulee = false), 0),
      'stock_restant', coalesce((select sum(stock_restant) from public.produits where organisation_id = v_org), 0),
      'paiements_en_attente', coalesce((select sum(reste_a_payer) from public.ventes where organisation_id = v_org and annulee = false), 0)
    ),
    'ventes_recentes', coalesce((
      select jsonb_agg(r order by r.date_vente desc) from (
        select v.id, v.date_vente,
               coalesce(c.nom, 'Inconnue') as cliente_nom,
               coalesce(u.nom, 'Inconnue') as vendeuse_nom,
               v.total, v.statut_paiement
          from public.ventes v
          left join public.clientes c on c.id = v.cliente_id
          left join public.utilisateurs u on u.id = v.vendeuse_id
         where v.organisation_id = v_org and v.annulee = false
         order by v.date_vente desc limit 5
      ) r
    ), '[]'::jsonb),
    'top_vendeuses', coalesce((
      select jsonb_agg(t order by t.total desc) from (
        select u.id, u.nom, count(v.id) as nb, coalesce(sum(v.total), 0) as total
          from public.ventes v
          join public.utilisateurs u on u.id = v.vendeuse_id
         where v.organisation_id = v_org and v.annulee = false
         group by u.id, u.nom order by total desc limit 3
      ) t
    ), '[]'::jsonb)
  ) into v_result;

  return v_result;
end;
$$;

revoke execute on function public.tableau_de_bord_admin() from public, anon;
grant execute on function public.tableau_de_bord_admin() to authenticated;

-- ─── 6. RLS : isolation par organisation ───────────────────────────────

alter table public.organisations     enable row level security;
alter table public.utilisateurs      enable row level security;
alter table public.produits          enable row level security;
alter table public.clientes          enable row level security;
alter table public.ventes            enable row level security;
alter table public.vente_produits    enable row level security;
alter table public.paiements         enable row level security;
alter table public.push_subscriptions enable row level security;

-- organisations : chacun voit/modifie la sienne
create policy "org: la sienne" on public.organisations for select to authenticated
  using (id = prive.mon_organisation_id());
create policy "org: admin modifie la sienne" on public.organisations for update to authenticated
  using (id = prive.mon_organisation_id() and prive.est_admin())
  with check (id = prive.mon_organisation_id() and prive.est_admin());

-- utilisateurs : voir ses collegues de l'org ; admin gere (insert via API serveur)
create policy "users: mon organisation" on public.utilisateurs for select to authenticated
  using (organisation_id = prive.mon_organisation_id());
create policy "users: admin modifie" on public.utilisateurs for update to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin())
  with check (organisation_id = prive.mon_organisation_id() and prive.est_admin());
create policy "users: admin supprime" on public.utilisateurs for delete to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());

-- produits : lecture pour l'org ; ecriture admin
create policy "produits: mon org" on public.produits for select to authenticated
  using (organisation_id = prive.mon_organisation_id());
create policy "produits: admin ecrit" on public.produits for insert to authenticated
  with check (organisation_id = prive.mon_organisation_id() and prive.est_admin());
create policy "produits: admin modifie" on public.produits for update to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin())
  with check (organisation_id = prive.mon_organisation_id() and prive.est_admin());
create policy "produits: admin supprime" on public.produits for delete to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());

-- clientes : lecture pour l'org (pot commun interne) ; ecriture admin/RPC
create policy "clientes: mon org" on public.clientes for select to authenticated
  using (organisation_id = prive.mon_organisation_id());
create policy "clientes: admin ecrit" on public.clientes for insert to authenticated
  with check (organisation_id = prive.mon_organisation_id() and prive.est_admin());
create policy "clientes: admin modifie" on public.clientes for update to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin())
  with check (organisation_id = prive.mon_organisation_id() and prive.est_admin());
create policy "clientes: admin supprime" on public.clientes for delete to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());

-- ventes : les siennes (vendeuse), ou toutes si admin, dans l'org
create policy "ventes: org + siennes/admin" on public.ventes for select to authenticated
  using (organisation_id = prive.mon_organisation_id()
         and (vendeuse_id = prive.mon_utilisateur_id() or prive.est_admin()));
create policy "ventes: admin modifie" on public.ventes for update to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin())
  with check (organisation_id = prive.mon_organisation_id() and prive.est_admin());
create policy "ventes: admin supprime" on public.ventes for delete to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());

-- vente_produits : suit la vente parente
create policy "vp: suit la vente" on public.vente_produits for select to authenticated
  using (exists (select 1 from public.ventes v where v.id = vente_id
    and v.organisation_id = prive.mon_organisation_id()
    and (v.vendeuse_id = prive.mon_utilisateur_id() or prive.est_admin())));
create policy "vp: admin modifie" on public.vente_produits for update to authenticated
  using (exists (select 1 from public.ventes v where v.id = vente_id
    and v.organisation_id = prive.mon_organisation_id() and prive.est_admin()));

-- paiements : suit la vente parente
create policy "paiements: suit la vente" on public.paiements for select to authenticated
  using (exists (select 1 from public.ventes v where v.id = vente_id
    and v.organisation_id = prive.mon_organisation_id()
    and (v.vendeuse_id = prive.mon_utilisateur_id() or prive.est_admin())));

-- push_subscriptions : aucune policy — acces uniquement via routes serveur (cle secrete)

-- ─── 7. Auto-remplissage de organisation_id ────────────────────────────
-- Les inserts directs depuis l'app (ex. l'admin ajoute un produit) n'envoient
-- pas organisation_id : la base le remplit elle-meme depuis l'utilisateur
-- connecte. Impossible ainsi d'inserer dans la mauvaise boutique.
create function prive.remplir_organisation_id()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if new.organisation_id is null then
    new.organisation_id := prive.mon_organisation_id();
  end if;
  return new;
end;
$$;

create trigger produits_org_auto before insert on public.produits
  for each row execute function prive.remplir_organisation_id();
create trigger clientes_org_auto before insert on public.clientes
  for each row execute function prive.remplir_organisation_id();
