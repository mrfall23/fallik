-- ═══════════════════════════════════════════════════════════════════════
-- FALLIK — Phase 1 (securite des ventes)
--
--  1. Codes PIN (4 a 6 chiffres) : connexion des vendeuses sur un telephone
--     « caisse » partage, et validation des actions sensibles par le gerant.
--  2. Actions sensibles d'une vendeuse = validation du gerant obligatoire :
--     annuler une facture, retirer un article deja servi, accorder un credit.
--     Une vendeuse ne touche qu'a SES factures.
--  3. Journal d'activite : impossible a modifier ou a effacer.
--  4. Cloture de caisse : la vendeuse declare son argent, la base calcule l'ecart.
--  5. Inventaire : comptage physique, ecarts par produit.
--
-- Rejouable sans risque (if not exists / create or replace / drop if exists).
-- ═══════════════════════════════════════════════════════════════════════

create extension if not exists pgcrypto with schema extensions;

-- ─── 1. Tables ─────────────────────────────────────────────────────────

-- Codes PIN (hash bcrypt). Aucune policy : illisible depuis l'API.
create table if not exists public.codes_pin (
  utilisateur_id  bigint primary key references public.utilisateurs (id) on delete cascade,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  pin_hash        text not null,
  echecs          integer not null default 0,
  bloque_jusqua   timestamptz,
  modifie_le      timestamptz not null default now()
);

-- Validation du gerant : jeton a usage unique, lie a une action, une cible,
-- un montant maximum, la vendeuse qui l'a demande, et valable 5 minutes.
create table if not exists public.autorisations (
  id              uuid primary key default gen_random_uuid(),
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  action          text not null,
  cible           bigint,
  montant_max     numeric,
  demande_par     bigint not null references public.utilisateurs (id) on delete cascade,
  approuve_par    bigint not null references public.utilisateurs (id) on delete cascade,
  cree_le         timestamptz not null default now(),
  expire_le       timestamptz not null,
  utilisee_le     timestamptz
);

-- Essais de code (anti-devinette).
create table if not exists public.tentatives_pin (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  utilisateur_id  bigint references public.utilisateurs (id) on delete cascade,
  type            text not null check (type in ('autorisation', 'caisse')),
  reussie         boolean not null,
  cree_le         timestamptz not null default now()
);
create index if not exists tentatives_pin_idx on public.tentatives_pin (organisation_id, utilisateur_id, cree_le);

-- Journal d'activite (append-only).
create table if not exists public.journal_activite (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  utilisateur_id  bigint references public.utilisateurs (id) on delete set null,
  utilisateur_nom text,
  approuve_par    bigint references public.utilisateurs (id) on delete set null,
  approuve_nom    text,
  action          text not null,
  gravite         text not null default 'info' check (gravite in ('info', 'attention', 'alerte')),
  details         jsonb not null default '{}'::jsonb,
  montant         numeric,
  notifie         boolean not null default false,
  cree_le         timestamptz not null default now()
);
create index if not exists journal_org_date_idx on public.journal_activite (organisation_id, cree_le desc);
create index if not exists journal_a_notifier_idx on public.journal_activite (organisation_id) where notifie = false;

-- Telephones « caisse » (connexion des vendeuses par PIN).
create table if not exists public.postes_caisse (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  nom             text not null,
  jeton_hash      text not null unique,
  cree_par        bigint references public.utilisateurs (id) on delete set null,
  cree_le         timestamptz not null default now(),
  dernier_usage   timestamptz,
  actif           boolean not null default true
);

-- Clotures de caisse.
create table if not exists public.clotures_caisse (
  id               bigint generated always as identity primary key,
  organisation_id  bigint not null references public.organisations (id) on delete cascade,
  utilisateur_id   bigint references public.utilisateurs (id) on delete set null,
  utilisateur_nom  text,
  debut            timestamptz not null,
  fin              timestamptz not null default now(),
  attendu          jsonb not null default '{}'::jsonb,
  attendu_especes  numeric not null,
  declare_especes  numeric not null,
  ecart            numeric not null,
  nb_ventes        integer not null default 0,
  commentaire      text
);
create index if not exists clotures_org_idx on public.clotures_caisse (organisation_id, fin desc);

-- Inventaires.
create table if not exists public.inventaires (
  id               bigint generated always as identity primary key,
  organisation_id  bigint not null references public.organisations (id) on delete cascade,
  utilisateur_id   bigint references public.utilisateurs (id) on delete set null,
  utilisateur_nom  text,
  applique         boolean not null default false,
  nb_produits      integer not null default 0,
  nb_ecarts        integer not null default 0,
  valeur_ecart     numeric not null default 0,
  commentaire      text,
  cree_le          timestamptz not null default now()
);
create index if not exists inventaires_org_idx on public.inventaires (organisation_id, cree_le desc);

create table if not exists public.inventaire_lignes (
  id             bigint generated always as identity primary key,
  inventaire_id  bigint not null references public.inventaires (id) on delete cascade,
  produit_id     bigint references public.produits (id) on delete set null,
  produit_nom    text not null,
  theorique      integer not null,
  compte         integer not null check (compte >= 0),
  ecart          integer not null,
  prix           numeric not null default 0
);
create index if not exists inventaire_lignes_idx on public.inventaire_lignes (inventaire_id);

-- Qui a encaisse chaque paiement (pour la cloture de caisse).
alter table public.paiements add column if not exists encaisse_par bigint references public.utilisateurs (id) on delete set null;
update public.paiements p set encaisse_par = v.vendeuse_id
  from public.ventes v where v.id = p.vente_id and p.encaisse_par is null;
create index if not exists paiements_encaisse_idx on public.paiements (encaisse_par, created_at);

-- Derniere modification d'une ligne de facture (fenetre de correction).
alter table public.facture_lignes add column if not exists maj_le timestamptz not null default now();


-- ─── 2. Droits et RLS ──────────────────────────────────────────────────
alter table public.codes_pin         enable row level security;
alter table public.autorisations     enable row level security;
alter table public.tentatives_pin    enable row level security;
alter table public.journal_activite  enable row level security;
alter table public.postes_caisse     enable row level security;
alter table public.clotures_caisse   enable row level security;
alter table public.inventaires       enable row level security;
alter table public.inventaire_lignes enable row level security;

revoke all on public.codes_pin, public.autorisations, public.tentatives_pin, public.journal_activite,
  public.postes_caisse, public.clotures_caisse, public.inventaires, public.inventaire_lignes
  from anon, authenticated;
grant all on public.codes_pin, public.autorisations, public.tentatives_pin, public.journal_activite,
  public.postes_caisse, public.clotures_caisse, public.inventaires, public.inventaire_lignes
  to service_role;

-- Lecture seule pour l'app ; toutes les ecritures passent par les fonctions.
grant select on public.journal_activite, public.clotures_caisse, public.inventaires, public.inventaire_lignes
  to authenticated;
grant select (id, organisation_id, nom, cree_le, dernier_usage, actif) on public.postes_caisse to authenticated;

drop policy if exists "journal: gestion lit" on public.journal_activite;
create policy "journal: gestion lit" on public.journal_activite for select to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());

drop policy if exists "postes: gestion lit" on public.postes_caisse;
create policy "postes: gestion lit" on public.postes_caisse for select to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());

drop policy if exists "clotures: les siennes ou gestion" on public.clotures_caisse;
create policy "clotures: les siennes ou gestion" on public.clotures_caisse for select to authenticated
  using (organisation_id = prive.mon_organisation_id()
         and (utilisateur_id = prive.mon_utilisateur_id() or prive.est_admin()));

drop policy if exists "inventaires: gestion lit" on public.inventaires;
create policy "inventaires: gestion lit" on public.inventaires for select to authenticated
  using (organisation_id = prive.mon_organisation_id() and prive.est_admin());

drop policy if exists "inventaire_lignes: gestion lit" on public.inventaire_lignes;
create policy "inventaire_lignes: gestion lit" on public.inventaire_lignes for select to authenticated
  using (exists (select 1 from public.inventaires i where i.id = inventaire_id
    and i.organisation_id = prive.mon_organisation_id() and prive.est_admin()));


-- ─── 3. Journal inalterable ────────────────────────────────────────────
-- Seules modifications admises : passer « notifie » a vrai, et la mise a
-- null automatique quand un compte est supprime (le nom reste ecrit).
-- Suppression admise uniquement quand la boutique entiere est supprimee.
create or replace function prive.proteger_journal()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.organisations where id = old.organisation_id) then
      raise exception 'Le journal ne peut pas etre efface';
    end if;
    return old;
  end if;
  if new.organisation_id is distinct from old.organisation_id
     or new.action is distinct from old.action
     or new.gravite is distinct from old.gravite
     or new.details is distinct from old.details
     or new.montant is distinct from old.montant
     or new.cree_le is distinct from old.cree_le
     or new.utilisateur_nom is distinct from old.utilisateur_nom
     or new.approuve_nom is distinct from old.approuve_nom
     or (new.utilisateur_id is distinct from old.utilisateur_id and new.utilisateur_id is not null)
     or (new.approuve_par is distinct from old.approuve_par and new.approuve_par is not null)
     or (old.notifie and not new.notifie) then
    raise exception 'Le journal ne peut pas etre modifie';
  end if;
  return new;
end;
$$;
drop trigger if exists journal_protege on public.journal_activite;
create trigger journal_protege before update or delete on public.journal_activite
  for each row execute function prive.proteger_journal();

-- Ecrit une ligne de journal (noms recopies : l'historique survit aux comptes).
create or replace function prive.journaliser(
  p_action text, p_gravite text, p_details jsonb, p_montant numeric,
  p_approuve_par bigint default null, p_org bigint default null, p_utilisateur bigint default null
)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org bigint; v_user bigint;
begin
  v_user := coalesce(p_utilisateur, prive.mon_utilisateur_id());
  v_org  := coalesce(p_org, prive.mon_organisation_id(),
                     (select organisation_id from public.utilisateurs where id = v_user));
  -- Boutique absente ou en cours de suppression : rien a tracer.
  if v_org is null or not exists (select 1 from public.organisations where id = v_org) then return; end if;
  insert into public.journal_activite
    (organisation_id, utilisateur_id, utilisateur_nom, approuve_par, approuve_nom, action, gravite, details, montant)
  values (v_org, v_user, (select nom from public.utilisateurs where id = v_user),
          p_approuve_par, (select nom from public.utilisateurs where id = p_approuve_par),
          p_action, coalesce(p_gravite, 'info'), coalesce(p_details, '{}'::jsonb), p_montant);
end;
$$;


-- ─── 4. Codes PIN ──────────────────────────────────────────────────────
create or replace function prive.pin_valide(p_pin text)
returns boolean language sql immutable set search_path = '' as $$
  select p_pin ~ '^[0-9]{4,6}$'
     and p_pin !~ '^(.)\1+$'
     and position(p_pin in '0123456789') = 0
     and position(p_pin in '9876543210') = 0
$$;

create or replace function prive.enregistrer_pin(p_utilisateur bigint, p_org bigint, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
begin
  if p_pin is null or not prive.pin_valide(p_pin) then
    raise exception 'Code invalide : 4 a 6 chiffres, pas de suite (1234) ni de repetition (1111)';
  end if;
  insert into public.codes_pin (utilisateur_id, organisation_id, pin_hash, echecs, bloque_jusqua, modifie_le)
  values (p_utilisateur, p_org, extensions.crypt(p_pin, extensions.gen_salt('bf', 8)), 0, null, now())
  on conflict (utilisateur_id) do update
    set pin_hash = excluded.pin_hash, echecs = 0, bloque_jusqua = null, modifie_le = now();
end;
$$;

-- Chacun definit son propre code.
create or replace function public.definir_mon_pin(p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_moi bigint := prive.mon_utilisateur_id(); v_org bigint := prive.mon_organisation_id();
begin
  if v_moi is null then raise exception 'Non authentifie'; end if;
  perform prive.enregistrer_pin(v_moi, v_org, p_pin);
  perform prive.journaliser('pin_modifie', 'info', '{}'::jsonb, null);
end;
$$;

-- Le gerant / proprietaire definit le code d'une vendeuse de SA boutique.
create or replace function public.definir_pin_vendeuse(p_utilisateur_id bigint, p_pin text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org bigint := prive.mon_organisation_id(); v_cible record;
begin
  if not prive.est_admin() then raise exception 'Reserve au gerant ou au proprietaire'; end if;
  select id, nom, role into v_cible from public.utilisateurs
   where id = p_utilisateur_id and organisation_id = v_org;
  if not found or v_cible.role <> 'vendeuse' then raise exception 'Vendeuse introuvable'; end if;
  perform prive.enregistrer_pin(v_cible.id, v_org, p_pin);
  perform prive.journaliser('pin_vendeuse_modifie', 'info', jsonb_build_object('vendeuse', v_cible.nom), null);
end;
$$;

-- Qui a deja un code (affichage), sans jamais exposer les hash.
create or replace function public.etat_pins()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare v_moi bigint := prive.mon_utilisateur_id(); v_org bigint := prive.mon_organisation_id();
begin
  if v_moi is null then raise exception 'Non authentifie'; end if;
  return jsonb_build_object(
    'moi', exists (select 1 from public.codes_pin where utilisateur_id = v_moi),
    'utilisateurs', case when prive.est_admin() then coalesce((
      select jsonb_agg(c.utilisateur_id) from public.codes_pin c where c.organisation_id = v_org), '[]'::jsonb)
      else '[]'::jsonb end,
    'gerant_disponible', exists (
      select 1 from public.codes_pin c join public.utilisateurs u on u.id = c.utilisateur_id
       where u.organisation_id = v_org and u.actif and u.role in ('admin', 'proprietaire'))
  );
end;
$$;


-- ─── 5. Validation du gerant ───────────────────────────────────────────
-- Ne leve JAMAIS d'exception sur un mauvais code : l'essai rate doit rester
-- enregistre (une exception annulerait l'enregistrement du compteur).
create or replace function public.demander_autorisation(
  p_action text, p_cible bigint, p_montant numeric, p_code text
)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_moi bigint := prive.mon_utilisateur_id();
  v_org bigint := prive.mon_organisation_id();
  v_echecs_moi integer; v_echecs_org integer;
  v_gerant record; v_id uuid;
begin
  if v_moi is null then raise exception 'Non authentifie'; end if;
  if p_action not in ('annuler_facture', 'retirer_article', 'credit', 'remise') then
    raise exception 'Action inconnue';
  end if;

  select count(*) into v_echecs_moi from public.tentatives_pin
   where organisation_id = v_org and utilisateur_id = v_moi and type = 'autorisation'
     and not reussie and cree_le > now() - interval '15 minutes';
  select count(*) into v_echecs_org from public.tentatives_pin
   where organisation_id = v_org and type = 'autorisation'
     and not reussie and cree_le > now() - interval '15 minutes';
  if v_echecs_moi >= 5 or v_echecs_org >= 15 then
    return jsonb_build_object('ok', false, 'message', 'Trop d''essais ratés. Réessayez dans 15 minutes.');
  end if;

  if not exists (select 1 from public.codes_pin c join public.utilisateurs u on u.id = c.utilisateur_id
                  where u.organisation_id = v_org and u.actif and u.role in ('admin', 'proprietaire')) then
    return jsonb_build_object('ok', false, 'message',
      'Aucun gérant n''a encore défini son code (Paramètres → Mon code PIN).');
  end if;

  select u.id, u.nom into v_gerant
    from public.utilisateurs u join public.codes_pin c on c.utilisateur_id = u.id
   where u.organisation_id = v_org and u.actif and u.role in ('admin', 'proprietaire')
     and u.id <> v_moi
     and p_code ~ '^[0-9]{4,6}$'
     and c.pin_hash = extensions.crypt(p_code, c.pin_hash)
   limit 1;

  if v_gerant.id is null then
    insert into public.tentatives_pin (organisation_id, utilisateur_id, type, reussie)
    values (v_org, v_moi, 'autorisation', false);
    perform prive.journaliser('code_gerant_faux',
      case when v_echecs_moi + 1 >= 3 then 'alerte' else 'attention' end,
      jsonb_build_object('pour', p_action, 'essai', v_echecs_moi + 1), p_montant);
    return jsonb_build_object('ok', false, 'message', 'Code incorrect.',
      'restants', greatest(0, 4 - v_echecs_moi));
  end if;

  insert into public.tentatives_pin (organisation_id, utilisateur_id, type, reussie)
  values (v_org, v_moi, 'autorisation', true);
  insert into public.autorisations (organisation_id, action, cible, montant_max, demande_par, approuve_par, expire_le)
  values (v_org, p_action, p_cible, p_montant, v_moi, v_gerant.id, now() + interval '5 minutes')
  returning id into v_id;
  return jsonb_build_object('ok', true, 'autorisation', v_id, 'approuve_par', v_gerant.nom);
end;
$$;

-- Renvoie l'id du gerant qui valide, ou null si l'appelant est lui-meme
-- gerant/proprietaire. Leve une exception si la validation manque.
create or replace function prive.exiger_validation(
  p_autorisation uuid, p_action text, p_cible bigint, p_valeur numeric
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_appr bigint;
begin
  if prive.est_admin() then return null; end if;
  if p_autorisation is null then
    raise exception 'Validation du gérant requise';
  end if;
  update public.autorisations
     set utilisee_le = now()
   where id = p_autorisation
     and organisation_id = prive.mon_organisation_id()
     and demande_par = prive.mon_utilisateur_id()
     and action = p_action
     and cible is not distinct from p_cible
     and (montant_max is null or coalesce(p_valeur, 0) <= montant_max + 0.01)
     and utilisee_le is null
     and expire_le > now()
  returning approuve_par into v_appr;
  if v_appr is null then
    raise exception 'Validation du gérant requise (code expiré ou déjà utilisé)';
  end if;
  return v_appr;
end;
$$;


-- ─── 6. Ventes et factures : versions securisees ───────────────────────
-- Les anciennes signatures sont supprimees pour qu'aucun appel ne puisse
-- contourner les nouvelles regles.
drop function if exists public.enregistrer_vente(text, text, jsonb, text, numeric, text);
drop function if exists public.facture_definir_quantite(bigint, bigint, integer);
drop function if exists public.facture_annuler(bigint);
drop function if exists public.facture_finaliser(bigint, text, numeric);

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
  perform set_config('fallik.mouvement', '1', true);

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

-- Facture : verrouille et verifie que l'appelant peut y toucher.
create or replace function prive.ma_facture_ouverte(p_facture_id bigint)
returns public.factures language plpgsql security definer set search_path = '' as $$
declare v_fact public.factures;
begin
  select * into v_fact from public.factures
   where id = p_facture_id and organisation_id = prive.mon_organisation_id() for update;
  if not found then raise exception 'Facture introuvable'; end if;
  if v_fact.statut <> 'ouverte' then raise exception 'Cette facture n''est plus ouverte'; end if;
  if not prive.est_admin() and v_fact.vendeuse_id is distinct from prive.mon_utilisateur_id() then
    raise exception 'Cette facture appartient a une autre vendeuse';
  end if;
  return v_fact;
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
  perform set_config('fallik.mouvement', '1', true);

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
  perform set_config('fallik.mouvement', '1', true);
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

create or replace function public.facture_finaliser(
  p_facture_id bigint, p_mode_paiement text, p_montant_paye numeric, p_autorisation uuid default null
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_fact public.factures; v_vente_id bigint; v_final numeric; v_statut text; v_nb integer; v_appr bigint;
  v_mode text := coalesce(nullif(btrim(p_mode_paiement), ''), 'cash');
begin
  if prive.mon_organisation_id() is null then raise exception 'Non authentifie'; end if;
  v_fact := prive.ma_facture_ouverte(p_facture_id);

  select count(*) into v_nb from public.facture_lignes where facture_id = p_facture_id;
  if v_nb = 0 then raise exception 'La facture est vide'; end if;

  v_final := coalesce(p_montant_paye, v_fact.total);
  if v_final < 0 or v_final > v_fact.total then raise exception 'Montant paye invalide'; end if;
  v_statut := case when v_final >= v_fact.total then 'paye' else 'partiel' end;

  if v_final < v_fact.total then
    v_appr := prive.exiger_validation(p_autorisation, 'credit', p_facture_id, v_fact.total - v_final);
  end if;

  insert into public.ventes
    (organisation_id, vendeuse_id, cliente_id, nom_client, total, montant_paye, reste_a_payer, statut_paiement, annulee)
  values
    (v_fact.organisation_id, v_fact.vendeuse_id, null, v_fact.nom_client, v_fact.total, v_final,
     greatest(0, v_fact.total - v_final), v_statut, false)
  returning id into v_vente_id;

  insert into public.vente_produits (vente_id, produit_id, quantite, prix_unitaire)
  select v_vente_id, produit_id, quantite, prix_unitaire from public.facture_lignes where facture_id = p_facture_id;

  insert into public.paiements (vente_id, montant, mode, encaisse_par)
  values (v_vente_id, v_final, v_mode, prive.mon_utilisateur_id());

  update public.factures
     set statut = 'payee', mode_paiement = v_mode, montant_paye = v_final, vente_id = v_vente_id, closed_at = now()
   where id = p_facture_id;

  if v_final < v_fact.total then
    perform prive.journaliser('credit_accorde', 'attention',
      jsonb_build_object('vente', v_vente_id, 'facture', p_facture_id, 'client', v_fact.nom_client,
                         'total', v_fact.total, 'paye', v_final),
      v_fact.total - v_final, v_appr);
  end if;

  return v_vente_id;
end;
$$;


-- ─── 7. Stock : toute modification hors vente est tracee ───────────────
create or replace function prive.tracer_produit()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_auto boolean := coalesce(current_setting('fallik.mouvement', true), '') = '1';
begin
  if tg_op = 'INSERT' then
    perform prive.journaliser('produit_cree', 'info',
      jsonb_build_object('produit', new.nom, 'stock', new.stock_restant, 'prix', new.prix), null,
      null, new.organisation_id);
    return new;
  elsif tg_op = 'DELETE' then
    perform prive.journaliser('produit_supprime', 'attention',
      jsonb_build_object('produit', old.nom, 'stock', old.stock_restant, 'prix', old.prix), null,
      null, old.organisation_id);
    return old;
  end if;
  if new.stock_restant is distinct from old.stock_restant and not v_auto then
    perform prive.journaliser('stock_modifie',
      case when new.stock_restant < old.stock_restant then 'alerte' else 'attention' end,
      jsonb_build_object('produit', new.nom, 'avant', old.stock_restant, 'apres', new.stock_restant),
      (new.stock_restant - old.stock_restant) * new.prix, null, new.organisation_id);
  end if;
  if new.prix is distinct from old.prix then
    perform prive.journaliser('prix_modifie', 'attention',
      jsonb_build_object('produit', new.nom, 'avant', old.prix, 'apres', new.prix), null,
      null, new.organisation_id);
  end if;
  return new;
end;
$$;
drop trigger if exists produits_trace on public.produits;
create trigger produits_trace after insert or update or delete on public.produits
  for each row execute function prive.tracer_produit();


-- ─── 8. Cloture de caisse ──────────────────────────────────────────────
-- La vendeuse declare ses especes SANS voir le montant attendu ; la base
-- calcule l'attendu depuis sa derniere cloture (ou depuis minuit).
create or replace function public.cloturer_caisse(p_especes numeric, p_commentaire text default null)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare
  v_moi bigint := prive.mon_utilisateur_id(); v_org bigint := prive.mon_organisation_id();
  v_tz text; v_debut timestamptz; v_fin timestamptz := now();
  v_attendu jsonb; v_especes numeric; v_nb integer; v_ecart numeric; v_id bigint;
begin
  if v_moi is null then raise exception 'Non authentifie'; end if;
  if p_especes is null or p_especes < 0 then raise exception 'Montant declare invalide'; end if;

  select coalesce(fuseau_horaire, 'Africa/Douala') into v_tz from public.organisations where id = v_org;
  select max(fin) into v_debut from public.clotures_caisse where utilisateur_id = v_moi;
  v_debut := coalesce(v_debut, (date_trunc('day', now() at time zone v_tz)) at time zone v_tz);

  select coalesce(jsonb_object_agg(mode, total), '{}'::jsonb) into v_attendu from (
    select p.mode, sum(p.montant) as total
      from public.paiements p join public.ventes v on v.id = p.vente_id
     where p.encaisse_par = v_moi and v.organisation_id = v_org and v.annulee = false
       and p.created_at > v_debut and p.created_at <= v_fin
     group by p.mode) t;
  select count(distinct p.vente_id) into v_nb
    from public.paiements p join public.ventes v on v.id = p.vente_id
   where p.encaisse_par = v_moi and v.organisation_id = v_org and v.annulee = false
     and p.created_at > v_debut and p.created_at <= v_fin;

  v_especes := coalesce((v_attendu->>'cash')::numeric, 0);
  v_ecart := p_especes - v_especes;

  insert into public.clotures_caisse
    (organisation_id, utilisateur_id, utilisateur_nom, debut, fin, attendu, attendu_especes,
     declare_especes, ecart, nb_ventes, commentaire)
  values (v_org, v_moi, (select nom from public.utilisateurs where id = v_moi), v_debut, v_fin, v_attendu,
          v_especes, p_especes, v_ecart, v_nb, nullif(btrim(coalesce(p_commentaire, '')), ''))
  returning id into v_id;

  perform prive.journaliser('cloture_caisse',
    case when v_ecart < 0 then 'alerte' when v_ecart > 0 then 'attention' else 'info' end,
    jsonb_build_object('cloture', v_id, 'attendu', v_especes, 'declare', p_especes, 'ventes', v_nb),
    v_ecart);

  return jsonb_build_object('id', v_id, 'debut', v_debut, 'fin', v_fin, 'attendu', v_attendu,
    'attendu_especes', v_especes, 'declare_especes', p_especes, 'ecart', v_ecart, 'nb_ventes', v_nb);
end;
$$;


-- ─── 9. Inventaire (gerant / proprietaire) ─────────────────────────────
-- p_lignes = [{"produit_id": 1, "compte": 12}, ...]
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
  perform set_config('fallik.mouvement', '1', true);

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


-- ─── 10. Telephones caisse ─────────────────────────────────────────────
-- Le jeton est genere cote serveur ; seule son empreinte (sha256) est stockee.
create or replace function public.creer_poste_caisse(p_nom text, p_jeton_hash text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_id bigint;
begin
  if not prive.est_admin() then raise exception 'Reserve au gerant ou au proprietaire'; end if;
  if p_jeton_hash !~ '^[0-9a-f]{64}$' then raise exception 'Jeton invalide'; end if;
  insert into public.postes_caisse (organisation_id, nom, jeton_hash, cree_par)
  values (prive.mon_organisation_id(), coalesce(nullif(btrim(left(p_nom, 60)), ''), 'Caisse'), p_jeton_hash,
          prive.mon_utilisateur_id())
  returning id into v_id;
  perform prive.journaliser('poste_caisse_active', 'attention', jsonb_build_object('poste', p_nom), null);
  return v_id;
end;
$$;

create or replace function public.retirer_poste_caisse(p_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_nom text;
begin
  if not prive.est_admin() then raise exception 'Reserve au gerant ou au proprietaire'; end if;
  update public.postes_caisse set actif = false
   where id = p_id and organisation_id = prive.mon_organisation_id()
  returning nom into v_nom;
  if v_nom is null then raise exception 'Poste introuvable'; end if;
  perform prive.journaliser('poste_caisse_retire', 'info', jsonb_build_object('poste', v_nom), null);
end;
$$;

-- Les deux fonctions suivantes ne servent qu'aux routes serveur (cle secrete).
create or replace function public.caisse_poste(p_jeton_hash text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_poste record;
begin
  select pc.id, pc.nom, pc.organisation_id, o.nom as boutique into v_poste
    from public.postes_caisse pc join public.organisations o on o.id = pc.organisation_id
   where pc.jeton_hash = p_jeton_hash and pc.actif;
  if not found or not prive.organisation_accessible(v_poste.organisation_id) then
    return jsonb_build_object('ok', false);
  end if;
  update public.postes_caisse set dernier_usage = now() where id = v_poste.id;
  return jsonb_build_object('ok', true, 'poste', v_poste.nom, 'boutique', v_poste.boutique,
    'vendeuses', coalesce((
      select jsonb_agg(jsonb_build_object('id', u.id, 'nom', u.nom) order by u.nom)
        from public.utilisateurs u join public.codes_pin c on c.utilisateur_id = u.id
       where u.organisation_id = v_poste.organisation_id and u.actif and u.role = 'vendeuse'), '[]'::jsonb));
end;
$$;

create or replace function public.caisse_verifier_pin(p_jeton_hash text, p_utilisateur_id bigint, p_pin text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_poste record; v_user record; v_code record;
begin
  select id, nom, organisation_id into v_poste from public.postes_caisse
   where jeton_hash = p_jeton_hash and actif;
  if not found or not prive.organisation_accessible(v_poste.organisation_id) then
    return jsonb_build_object('ok', false, 'message', 'Ce téléphone n''est plus une caisse active.');
  end if;

  select id, nom, email, auth_id into v_user from public.utilisateurs
   where id = p_utilisateur_id and organisation_id = v_poste.organisation_id and actif and role = 'vendeuse';
  select * into v_code from public.codes_pin where utilisateur_id = p_utilisateur_id;
  if v_user.id is null or v_code.utilisateur_id is null then
    return jsonb_build_object('ok', false, 'message', 'Compte introuvable.');
  end if;
  if v_code.bloque_jusqua is not null and v_code.bloque_jusqua > now() then
    return jsonb_build_object('ok', false, 'message', 'Compte bloqué après trop d''essais. Réessayez plus tard ou demandez au gérant.');
  end if;

  if p_pin is null or p_pin !~ '^[0-9]{4,6}$' or v_code.pin_hash <> extensions.crypt(p_pin, v_code.pin_hash) then
    insert into public.tentatives_pin (organisation_id, utilisateur_id, type, reussie)
    values (v_poste.organisation_id, v_user.id, 'caisse', false);
    if v_code.echecs + 1 >= 5 then
      update public.codes_pin set echecs = 0, bloque_jusqua = now() + interval '15 minutes'
       where utilisateur_id = v_user.id;
      perform prive.journaliser('caisse_compte_bloque', 'alerte',
        jsonb_build_object('poste', v_poste.nom), null, null, v_poste.organisation_id, v_user.id);
      return jsonb_build_object('ok', false, 'message', 'Trop d''essais : compte bloqué 15 minutes.');
    end if;
    update public.codes_pin set echecs = echecs + 1 where utilisateur_id = v_user.id;
    return jsonb_build_object('ok', false, 'message', 'Code incorrect.', 'restants', 4 - v_code.echecs);
  end if;

  update public.codes_pin set echecs = 0, bloque_jusqua = null where utilisateur_id = v_user.id;
  update public.postes_caisse set dernier_usage = now() where id = v_poste.id;
  insert into public.tentatives_pin (organisation_id, utilisateur_id, type, reussie)
  values (v_poste.organisation_id, v_user.id, 'caisse', true);
  perform prive.journaliser('connexion_caisse', 'info', jsonb_build_object('poste', v_poste.nom), null,
    null, v_poste.organisation_id, v_user.id);
  return jsonb_build_object('ok', true, 'email', v_user.email, 'auth_id', v_user.auth_id, 'nom', v_user.nom);
end;
$$;


-- ─── 11. Droits d'execution ────────────────────────────────────────────
revoke execute on function prive.journaliser(text, text, jsonb, numeric, bigint, bigint, bigint),
  prive.pin_valide(text), prive.enregistrer_pin(bigint, bigint, text),
  prive.exiger_validation(uuid, text, bigint, numeric), prive.ma_facture_ouverte(bigint),
  prive.proteger_journal(), prive.tracer_produit()
  from public, anon, authenticated;

revoke execute on function
  public.definir_mon_pin(text), public.definir_pin_vendeuse(bigint, text), public.etat_pins(),
  public.demander_autorisation(text, bigint, numeric, text),
  public.enregistrer_vente(text, text, jsonb, text, numeric, text, uuid),
  public.facture_definir_quantite(bigint, bigint, integer, uuid),
  public.facture_annuler(bigint, uuid),
  public.facture_finaliser(bigint, text, numeric, uuid),
  public.cloturer_caisse(numeric, text),
  public.enregistrer_inventaire(jsonb, boolean, text),
  public.creer_poste_caisse(text, text), public.retirer_poste_caisse(bigint),
  public.caisse_poste(text), public.caisse_verifier_pin(text, bigint, text)
  from public, anon;

grant execute on function
  public.definir_mon_pin(text), public.definir_pin_vendeuse(bigint, text), public.etat_pins(),
  public.demander_autorisation(text, bigint, numeric, text),
  public.enregistrer_vente(text, text, jsonb, text, numeric, text, uuid),
  public.facture_definir_quantite(bigint, bigint, integer, uuid),
  public.facture_annuler(bigint, uuid),
  public.facture_finaliser(bigint, text, numeric, uuid),
  public.cloturer_caisse(numeric, text),
  public.enregistrer_inventaire(jsonb, boolean, text),
  public.creer_poste_caisse(text, text), public.retirer_poste_caisse(bigint)
  to authenticated;

-- Connexion caisse : cle secrete uniquement.
revoke execute on function public.caisse_poste(text), public.caisse_verifier_pin(text, bigint, text)
  from authenticated;
grant execute on function public.caisse_poste(text), public.caisse_verifier_pin(text, bigint, text)
  to service_role;

notify pgrst, 'reload schema';
