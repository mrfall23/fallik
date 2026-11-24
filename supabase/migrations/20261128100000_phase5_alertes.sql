-- ═══════════════════════════════════════════════════════════════════════
-- Phase 5 — Alertes (notifications push + Telegram par boutique)
--
--   1. reglages_alertes : ce que chaque boutique veut recevoir (ventes,
--      stock bas, actions sensibles, resume du soir) et SON Telegram.
--      Un seul bot Fallik ; chaque boutique relie sa propre conversation par
--      un code a usage unique (15 min). Seul le PROPRIETAIRE change ces
--      reglages : un gerant ne peut pas couper les alertes qui le surveillent
--      (et toute modification est inscrite au journal).
--   2. alertes_file : file d'envoi remplie par la base (nouvelle vente, y
--      compris facture encaissee ; produit qui passe sous le seuil de stock).
--      Le serveur la vide avec la cle secrete ; personne d'autre n'y accede.
--   3. resume_du_jour(org) : chiffres de la journee pour le resume du soir.
-- Rejouable.
-- ═══════════════════════════════════════════════════════════════════════

-- ─── 1. Reglages ───────────────────────────────────────────────────────
create table if not exists public.reglages_alertes (
  organisation_id     bigint primary key references public.organisations (id) on delete cascade,
  ventes              boolean not null default true,
  stock_bas           boolean not null default true,
  actions_sensibles   boolean not null default true,
  resume_soir         boolean not null default true,
  telegram_chat_id    text,
  telegram_titre      text,
  telegram_lie_le     timestamptz,
  telegram_code_hash  text,
  telegram_code_expire timestamptz,
  maj_le              timestamptz not null default now()
);

alter table public.reglages_alertes enable row level security;
revoke all on public.reglages_alertes from anon, authenticated;
-- Lecture des colonnes utiles a l'ecran ; jamais le code de liaison.
grant select (organisation_id, ventes, stock_bas, actions_sensibles, resume_soir, telegram_titre, telegram_lie_le, maj_le)
  on public.reglages_alertes to authenticated;
grant all on public.reglages_alertes to service_role;

drop policy if exists "alertes: gestion lit" on public.reglages_alertes;
create policy "alertes: gestion lit" on public.reglages_alertes for select to authenticated
  using (prive.est_admin() and organisation_id = prive.mon_organisation_id());

insert into public.reglages_alertes (organisation_id)
select id from public.organisations on conflict do nothing;

create or replace function prive.creer_reglages_alertes()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.reglages_alertes (organisation_id) values (new.id) on conflict do nothing;
  return new;
end;
$$;
drop trigger if exists organisations_reglages_alertes on public.organisations;
create trigger organisations_reglages_alertes after insert on public.organisations
  for each row execute function prive.creer_reglages_alertes();

-- Choix des alertes (proprietaire seulement).
create or replace function public.definir_alertes(p_ventes boolean, p_stock_bas boolean, p_actions_sensibles boolean, p_resume_soir boolean)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org bigint := prive.mon_organisation_id(); v_avant record;
begin
  if not prive.est_proprietaire() then
    raise exception 'Reserve au proprietaire';
  end if;
  insert into public.reglages_alertes (organisation_id) values (v_org) on conflict do nothing;
  select * into v_avant from public.reglages_alertes where organisation_id = v_org for update;
  update public.reglages_alertes
     set ventes = coalesce(p_ventes, ventes), stock_bas = coalesce(p_stock_bas, stock_bas),
         actions_sensibles = coalesce(p_actions_sensibles, actions_sensibles),
         resume_soir = coalesce(p_resume_soir, resume_soir), maj_le = now()
   where organisation_id = v_org;
  -- Couper la surveillance des actions sensibles merite une alerte.
  perform prive.journaliser('alertes_modifiees',
    case when v_avant.actions_sensibles and p_actions_sensibles = false then 'alerte' else 'info' end,
    jsonb_build_object('ventes', coalesce(p_ventes, v_avant.ventes), 'stock_bas', coalesce(p_stock_bas, v_avant.stock_bas),
                       'actions_sensibles', coalesce(p_actions_sensibles, v_avant.actions_sensibles),
                       'resume_soir', coalesce(p_resume_soir, v_avant.resume_soir)), null);
end;
$$;

-- Prepare la liaison Telegram : enregistre l'empreinte d'un code genere par
-- le serveur (le code en clair n'est jamais stocke).
create or replace function public.telegram_preparer_liaison(p_code_hash text)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org bigint := prive.mon_organisation_id();
begin
  if not prive.est_proprietaire() then
    raise exception 'Reserve au proprietaire';
  end if;
  if p_code_hash is null or p_code_hash !~ '^[0-9a-f]{64}$' then
    raise exception 'Code invalide';
  end if;
  insert into public.reglages_alertes (organisation_id) values (v_org) on conflict do nothing;
  update public.reglages_alertes
     set telegram_code_hash = p_code_hash, telegram_code_expire = now() + interval '15 minutes'
   where organisation_id = v_org;
end;
$$;

create or replace function public.telegram_delier()
returns void language plpgsql security definer set search_path = '' as $$
declare v_org bigint := prive.mon_organisation_id(); v_titre text;
begin
  if not prive.est_proprietaire() then
    raise exception 'Reserve au proprietaire';
  end if;
  select telegram_titre into v_titre from public.reglages_alertes where organisation_id = v_org;
  update public.reglages_alertes
     set telegram_chat_id = null, telegram_titre = null, telegram_lie_le = null,
         telegram_code_hash = null, telegram_code_expire = null, maj_le = now()
   where organisation_id = v_org;
  perform prive.journaliser('telegram_delie', 'alerte', jsonb_build_object('conversation', v_titre), null);
end;
$$;

-- Appelee par le webhook du bot (cle secrete) quand quelqu'un envoie
-- « /start CODE » : relie la conversation a la boutique du code.
create or replace function public.telegram_lier(p_code_hash text, p_chat_id text, p_titre text)
returns jsonb language plpgsql security definer set search_path = '' as $$
declare v_org bigint; v_nom text;
begin
  update public.reglages_alertes
     set telegram_chat_id = p_chat_id, telegram_titre = left(coalesce(nullif(btrim(p_titre), ''), 'Telegram'), 80),
         telegram_lie_le = now(), telegram_code_hash = null, telegram_code_expire = null, maj_le = now()
   where telegram_code_hash = p_code_hash and telegram_code_expire > now()
  returning organisation_id into v_org;
  if v_org is null then
    return jsonb_build_object('ok', false);
  end if;
  select nom into v_nom from public.organisations where id = v_org;
  perform prive.journaliser('telegram_lie', 'attention', jsonb_build_object('conversation', p_titre), null, null, v_org,
    (select id from public.utilisateurs where organisation_id = v_org and role = 'proprietaire' order by id limit 1));
  return jsonb_build_object('ok', true, 'boutique', v_nom);
end;
$$;

-- « /stop » dans Telegram : cette conversation ne recoit plus rien.
create or replace function public.telegram_arreter(p_chat_id text)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_n integer; v_org bigint;
begin
  for v_org in select organisation_id from public.reglages_alertes where telegram_chat_id = p_chat_id loop
    perform prive.journaliser('telegram_delie', 'alerte', jsonb_build_object('conversation', 'arrêt depuis Telegram'), null, null, v_org,
      (select id from public.utilisateurs where organisation_id = v_org and role = 'proprietaire' order by id limit 1));
  end loop;
  update public.reglages_alertes
     set telegram_chat_id = null, telegram_titre = null, telegram_lie_le = null, maj_le = now()
   where telegram_chat_id = p_chat_id;
  get diagnostics v_n = row_count;
  return v_n;
end;
$$;


-- ─── 2. File d'envoi ───────────────────────────────────────────────────
create table if not exists public.alertes_file (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  type            text not null check (type in ('vente', 'stock_bas')),
  ref             bigint not null,
  cree_le         timestamptz not null default now(),
  traite_le       timestamptz
);
create index if not exists alertes_file_a_traiter_idx on public.alertes_file (organisation_id, id) where traite_le is null;

alter table public.alertes_file enable row level security;
revoke all on public.alertes_file from anon, authenticated;
grant all on public.alertes_file to service_role;

create or replace function prive.file_vente()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  insert into public.alertes_file (organisation_id, type, ref) values (new.organisation_id, 'vente', new.id);
  return new;
end;
$$;
drop trigger if exists ventes_alerte on public.ventes;
create trigger ventes_alerte after insert on public.ventes
  for each row execute function prive.file_vente();

-- Une seule alerte quand le produit FRANCHIT le seuil (pas a chaque vente).
create or replace function prive.file_stock_bas()
returns trigger language plpgsql security definer set search_path = '' as $$
declare v_seuil integer;
begin
  select seuil_stock_bas into v_seuil from public.organisations where id = new.organisation_id;
  if new.actif and new.stock_restant <= coalesce(v_seuil, 5) and old.stock_restant > coalesce(v_seuil, 5) then
    insert into public.alertes_file (organisation_id, type, ref) values (new.organisation_id, 'stock_bas', new.id);
  end if;
  return new;
end;
$$;
drop trigger if exists produits_alerte_stock on public.produits;
create trigger produits_alerte_stock after update of stock_restant on public.produits
  for each row execute function prive.file_stock_bas();

-- Reserve les alertes a envoyer d'une boutique (sans doublon si deux envois
-- se croisent) et purge l'historique de plus de 7 jours.
create or replace function public.alertes_a_envoyer(p_org bigint)
returns table (id bigint, type text, ref bigint, cree_le timestamptz)
language plpgsql security definer set search_path = '' as $$
begin
  delete from public.alertes_file f where f.organisation_id = p_org and f.traite_le < now() - interval '7 days';
  return query
  update public.alertes_file f set traite_le = now()
   where f.id in (select x.id from public.alertes_file x
                   where x.organisation_id = p_org and x.traite_le is null
                   order by x.id limit 100 for update skip locked)
  returning f.id, f.type, f.ref, f.cree_le;
end;
$$;


-- ─── 3. Resume du soir ─────────────────────────────────────────────────
create or replace function public.resume_du_jour(p_org bigint)
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare
  v_tz    text := prive.fuseau(p_org);
  v_debut timestamptz := date_trunc('day', now() at time zone v_tz) at time zone v_tz;
  v_seuil integer := coalesce((select seuil_stock_bas from public.organisations where id = p_org), 5);
begin
  return jsonb_build_object(
    'jour', to_char(now() at time zone v_tz, 'YYYY-MM-DD'),
    'ventes', (select jsonb_build_object('nb', count(*), 'ca', coalesce(sum(total), 0), 'reste', coalesce(sum(reste_a_payer), 0))
                 from public.ventes where organisation_id = p_org and annulee = false and date_vente >= v_debut),
    'annulees', (select jsonb_build_object('nb', count(*), 'montant', coalesce(sum(total), 0))
                   from public.ventes where organisation_id = p_org and annulee = true and annulee_le >= v_debut),
    'benefice', (select jsonb_build_object('benefice', coalesce(sum((vp.prix_unitaire - c.prix_achat_unitaire) * vp.quantite), 0),
                                           'ca_couvert', coalesce(sum(vp.prix_unitaire * vp.quantite) filter (where c.vente_produit_id is not null), 0))
                   from public.ventes v join public.vente_produits vp on vp.vente_id = v.id
                   left join public.vente_produits_couts c on c.vente_produit_id = vp.id
                  where v.organisation_id = p_org and v.annulee = false and v.date_vente >= v_debut),
    'encaissements', coalesce((select jsonb_agg(m order by m.total desc) from (
                       select coalesce(nullif(btrim(p.mode), ''), 'cash') as mode, sum(p.montant) as total
                         from public.paiements p join public.ventes v on v.id = p.vente_id
                        where v.organisation_id = p_org and p.created_at >= v_debut
                        group by 1) m), '[]'::jsonb),
    'top_produits', coalesce((select jsonb_agg(t) from (
                       select coalesce(pr.nom, 'Produit supprimé') as nom, sum(vp.quantite) as quantite
                         from public.ventes v join public.vente_produits vp on vp.vente_id = v.id
                         left join public.produits pr on pr.id = vp.produit_id
                        where v.organisation_id = p_org and v.annulee = false and v.date_vente >= v_debut
                        group by vp.produit_id, pr.nom order by sum(vp.quantite) desc limit 3) t), '[]'::jsonb),
    'vendeuses', coalesce((select jsonb_agg(t) from (
                       select coalesce(u.nom, '—') as nom, count(*) as nb, sum(v.total) as ca
                         from public.ventes v left join public.utilisateurs u on u.id = v.vendeuse_id
                        where v.organisation_id = p_org and v.annulee = false and v.date_vente >= v_debut
                        group by u.nom order by sum(v.total) desc) t), '[]'::jsonb),
    'clotures', (select jsonb_build_object('nb', count(*), 'ecart', coalesce(sum(ecart), 0))
                   from public.clotures_caisse where organisation_id = p_org and fin >= v_debut),
    'alertes_journal', (select count(*) from public.journal_activite
                         where organisation_id = p_org and gravite = 'alerte' and cree_le >= v_debut),
    'dettes', (select coalesce(sum(reste_a_payer), 0) from public.ventes where organisation_id = p_org and annulee = false),
    'stock_bas', coalesce((select jsonb_agg(s) from (
                       select nom, stock_restant as stock from public.produits
                        where organisation_id = p_org and actif = true and stock_restant <= v_seuil
                        order by stock_restant, nom limit 10) s), '[]'::jsonb)
  );
end;
$$;


-- ─── 4. Droits ─────────────────────────────────────────────────────────
revoke execute on function prive.creer_reglages_alertes(), prive.file_vente(), prive.file_stock_bas()
  from public, anon, authenticated;

revoke execute on function public.definir_alertes(boolean, boolean, boolean, boolean),
  public.telegram_preparer_liaison(text), public.telegram_delier(),
  public.telegram_lier(text, text, text), public.telegram_arreter(text),
  public.alertes_a_envoyer(bigint), public.resume_du_jour(bigint)
  from public, anon, authenticated;

grant execute on function public.definir_alertes(boolean, boolean, boolean, boolean),
  public.telegram_preparer_liaison(text), public.telegram_delier()
  to authenticated;
-- Uniquement pour le serveur (cle secrete) : webhook Telegram et envois.
grant execute on function public.telegram_lier(text, text, text), public.telegram_arreter(text),
  public.alertes_a_envoyer(bigint), public.resume_du_jour(bigint)
  to service_role;

notify pgrst, 'reload schema';
