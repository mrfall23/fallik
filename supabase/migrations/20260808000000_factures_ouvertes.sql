-- ═══════════════════════════════════════════════════════════════════════
-- FALLIK — Factures ouvertes (mode bar / restaurant)
--
-- Une "facture" est un ticket qui reste OUVERT : le serveur y ajoute des
-- produits au fil du service, puis l'encaisse. A l'encaissement, une vraie
-- `vente` est creee -> tableau de bord, rapports et reçu continuent de marcher.
--
-- Regle de stock : le stock est decompte DES l'ajout a la facture (temps reel),
-- restitue si on diminue/retire/annule, et NON retouche a l'encaissement.
--
-- La vente rapide (enregistrer_vente) reste inchangee et coexiste.
-- ═══════════════════════════════════════════════════════════════════════

-- Pour afficher "Table 4" au tableau de bord meme sans cliente enregistree.
alter table public.ventes add column if not exists nom_client text;

-- ─── Tables ────────────────────────────────────────────────────────────
create table public.factures (
  id              bigint generated always as identity primary key,
  organisation_id bigint not null references public.organisations (id) on delete cascade,
  vendeuse_id     bigint references public.utilisateurs (id),
  nom_client      text not null,
  statut          text not null default 'ouverte' check (statut in ('ouverte', 'payee', 'annulee')),
  total           numeric not null default 0,
  montant_paye    numeric not null default 0,
  mode_paiement   text,
  vente_id        bigint references public.ventes (id),
  created_at      timestamptz not null default now(),
  closed_at       timestamptz
);
create index factures_org_idx on public.factures (organisation_id);
create index factures_statut_idx on public.factures (organisation_id, statut);

create table public.facture_lignes (
  id            bigint generated always as identity primary key,
  facture_id    bigint not null references public.factures (id) on delete cascade,
  produit_id    bigint references public.produits (id),
  quantite      integer not null check (quantite > 0),
  prix_unitaire numeric not null,
  created_at    timestamptz not null default now()
);
create index facture_lignes_facture_idx on public.facture_lignes (facture_id);

-- ─── Droits ────────────────────────────────────────────────────────────
grant all on public.factures, public.facture_lignes to service_role;
grant select, insert, update, delete on public.factures, public.facture_lignes to authenticated;
grant usage, select on all sequences in schema public to authenticated, service_role;

-- ─── RLS : lecture isolee par organisation (ecriture = via RPC seulement) ─
alter table public.factures enable row level security;
alter table public.facture_lignes enable row level security;

-- Dans un bar, tous les serveurs de la boutique voient les tickets ouverts
-- (utile pour se relayer / transferer une table).
create policy "factures: mon org" on public.factures for select to authenticated
  using (organisation_id = prive.mon_organisation_id());
create policy "facture_lignes: suit la facture" on public.facture_lignes for select to authenticated
  using (exists (select 1 from public.factures f
    where f.id = facture_id and f.organisation_id = prive.mon_organisation_id()));

-- ─── Helper interne : recalcule le total d'une facture ──────────────────
create function prive.recalc_total_facture(p_facture_id bigint)
returns void language sql security definer set search_path = '' as $$
  update public.factures
     set total = coalesce((select sum(quantite * prix_unitaire)
                             from public.facture_lignes where facture_id = p_facture_id), 0)
   where id = p_facture_id;
$$;

-- ─── 1. Ouvrir une facture ─────────────────────────────────────────────
create function public.ouvrir_facture(p_nom_client text)
returns bigint language plpgsql security definer set search_path = '' as $$
declare v_org bigint; v_vend bigint; v_id bigint;
begin
  v_vend := prive.mon_utilisateur_id();
  v_org  := prive.mon_organisation_id();
  if v_vend is null or v_org is null then raise exception 'Non authentifie'; end if;
  if p_nom_client is null or btrim(p_nom_client) = '' then
    raise exception 'Donnez un nom au client (ex. Table 4)';
  end if;
  insert into public.factures (organisation_id, vendeuse_id, nom_client, statut)
  values (v_org, v_vend, btrim(p_nom_client), 'ouverte')
  returning id into v_id;
  return v_id;
end;
$$;

-- ─── 2. Definir la quantite d'un produit sur une facture ────────────────
-- Fonction unique pour ajouter / augmenter (+) / diminuer (-) / retirer (0).
-- Ajuste le stock du delta, avec verrou anti-conflit.
create function public.facture_definir_quantite(
  p_facture_id bigint, p_produit_id bigint, p_quantite integer
)
returns void language plpgsql security definer set search_path = '' as $$
declare
  v_org bigint; v_fact record; v_prod record; v_actuelle integer; v_delta integer;
begin
  v_org := prive.mon_organisation_id();
  if v_org is null then raise exception 'Non authentifie'; end if;
  if p_quantite < 0 then raise exception 'Quantite invalide'; end if;

  select id, statut into v_fact from public.factures
   where id = p_facture_id and organisation_id = v_org for update;
  if not found then raise exception 'Facture introuvable'; end if;
  if v_fact.statut <> 'ouverte' then raise exception 'Cette facture n''est plus ouverte'; end if;

  select id, prix, stock_restant into v_prod from public.produits
   where id = p_produit_id and organisation_id = v_org and actif = true for update;
  if not found then raise exception 'Produit introuvable ou inactif'; end if;

  select coalesce(quantite, 0) into v_actuelle from public.facture_lignes
   where facture_id = p_facture_id and produit_id = p_produit_id;
  v_actuelle := coalesce(v_actuelle, 0);
  v_delta := p_quantite - v_actuelle;

  if v_delta > 0 and v_prod.stock_restant < v_delta then
    raise exception 'Stock insuffisant';
  end if;

  -- Ajuste le stock du delta (negatif = on rend au stock).
  update public.produits set stock_restant = stock_restant - v_delta where id = p_produit_id;

  if p_quantite = 0 then
    delete from public.facture_lignes where facture_id = p_facture_id and produit_id = p_produit_id;
  elsif v_actuelle = 0 then
    insert into public.facture_lignes (facture_id, produit_id, quantite, prix_unitaire)
    values (p_facture_id, p_produit_id, p_quantite, v_prod.prix);
  else
    update public.facture_lignes set quantite = p_quantite
     where facture_id = p_facture_id and produit_id = p_produit_id;
  end if;

  perform prive.recalc_total_facture(p_facture_id);
end;
$$;

-- ─── 3. Annuler une facture (restitue tout le stock) ────────────────────
create function public.facture_annuler(p_facture_id bigint)
returns void language plpgsql security definer set search_path = '' as $$
declare v_org bigint; v_fact record; v_ligne record;
begin
  v_org := prive.mon_organisation_id();
  if v_org is null then raise exception 'Non authentifie'; end if;
  select id, statut into v_fact from public.factures
   where id = p_facture_id and organisation_id = v_org for update;
  if not found then raise exception 'Facture introuvable'; end if;
  if v_fact.statut <> 'ouverte' then raise exception 'Cette facture n''est plus ouverte'; end if;

  for v_ligne in select produit_id, quantite from public.facture_lignes where facture_id = p_facture_id
  loop
    if v_ligne.produit_id is not null then
      update public.produits set stock_restant = stock_restant + v_ligne.quantite
       where id = v_ligne.produit_id;
    end if;
  end loop;

  update public.factures set statut = 'annulee', closed_at = now() where id = p_facture_id;
end;
$$;

-- ─── 4. Encaisser (finaliser) : cree une vraie vente, sans retoucher stock ─
create function public.facture_finaliser(
  p_facture_id bigint, p_mode_paiement text, p_montant_paye numeric
)
returns bigint language plpgsql security definer set search_path = '' as $$
declare
  v_org bigint; v_fact record; v_vente_id bigint; v_final numeric; v_statut text; v_nb integer;
begin
  v_org := prive.mon_organisation_id();
  if v_org is null then raise exception 'Non authentifie'; end if;

  select * into v_fact from public.factures
   where id = p_facture_id and organisation_id = v_org for update;
  if not found then raise exception 'Facture introuvable'; end if;
  if v_fact.statut <> 'ouverte' then raise exception 'Cette facture n''est plus ouverte'; end if;

  select count(*) into v_nb from public.facture_lignes where facture_id = p_facture_id;
  if v_nb = 0 then raise exception 'La facture est vide'; end if;

  v_final := coalesce(p_montant_paye, v_fact.total);
  if v_final < 0 or v_final > v_fact.total then raise exception 'Montant paye invalide'; end if;
  v_statut := case when v_final >= v_fact.total then 'paye' else 'partiel' end;

  -- Cree la vente (cliente_id null : client de passage identifie par nom_client).
  insert into public.ventes
    (organisation_id, vendeuse_id, cliente_id, nom_client, total, montant_paye, reste_a_payer, statut_paiement, annulee)
  values
    (v_org, v_fact.vendeuse_id, null, v_fact.nom_client, v_fact.total, v_final,
     greatest(0, v_fact.total - v_final), v_statut, false)
  returning id into v_vente_id;

  -- Reprend les lignes SANS retoucher le stock (deja decompte a l'ajout).
  insert into public.vente_produits (vente_id, produit_id, quantite, prix_unitaire)
  select v_vente_id, produit_id, quantite, prix_unitaire
    from public.facture_lignes where facture_id = p_facture_id;

  insert into public.paiements (vente_id, montant, mode)
  values (v_vente_id, v_final, coalesce(nullif(btrim(p_mode_paiement), ''), 'cash'));

  update public.factures
     set statut = 'payee', mode_paiement = coalesce(nullif(btrim(p_mode_paiement), ''), 'cash'),
         montant_paye = v_final, vente_id = v_vente_id, closed_at = now()
   where id = p_facture_id;

  return v_vente_id;
end;
$$;

-- ─── Droits d'execution ────────────────────────────────────────────────
revoke execute on function public.ouvrir_facture(text),
  public.facture_definir_quantite(bigint, bigint, integer),
  public.facture_annuler(bigint),
  public.facture_finaliser(bigint, text, numeric) from public, anon;
grant execute on function public.ouvrir_facture(text),
  public.facture_definir_quantite(bigint, bigint, integer),
  public.facture_annuler(bigint),
  public.facture_finaliser(bigint, text, numeric) to authenticated;
