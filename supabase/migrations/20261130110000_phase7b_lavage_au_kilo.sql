-- ═══════════════════════════════════════════════════════════════════════
-- Phase 7 b : lavage au kilo (pressing)
--
-- produits.unite : 'piece' (defaut) ou 'kg'. Un article au kilo est
-- forcement un service (sans stock).
-- Dans un depot, une ligne au kilo porte un poids (0,1 a 200 kg, decimales
-- acceptees) : elle est enregistree comme 1 ligne dont le prix =
-- prix au kilo x poids (arrondi au franc), et le poids est garde dans
-- vente_produits.poids_kg pour le ticket et l'historique.
--
-- A executer dans l'editeur SQL du projet Supabase FALLIK (pas Fallora),
-- APRES la migration 20261130100000_phase7_activite_pressing.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.produits add column if not exists unite text not null default 'piece';
alter table public.produits drop constraint if exists produits_unite_check;
alter table public.produits add constraint produits_unite_check
  check (unite in ('piece', 'kg') and (unite = 'piece' or not suivi_stock));
grant update (unite) on public.produits to authenticated;

alter table public.vente_produits add column if not exists poids_kg numeric;
alter table public.vente_produits drop constraint if exists vente_produits_poids_kg_check;
alter table public.vente_produits add constraint vente_produits_poids_kg_check
  check (poids_kg is null or (poids_kg > 0 and poids_kg <= 200));

-- Lignes : [{produit_id, quantite}] pour les pieces, [{produit_id, poids}]
-- pour les articles au kilo.
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
  v_prod record; v_q integer; v_poids numeric; v_prix numeric; v_paye numeric := coalesce(p_montant_paye, 0);
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
    select id, nom, prix, stock_restant, suivi_stock, unite into v_prod from public.produits
     where id = (v_item->>'produit_id')::bigint and organisation_id = v_org and actif = true
     for update;
    if not found then raise exception 'Article introuvable ou inactif'; end if;

    if v_prod.unite = 'kg' then
      begin
        v_poids := round((v_item->>'poids')::numeric, 2);
      exception when others then raise exception 'Poids invalide';
      end;
      if v_poids is null or v_poids <= 0 or v_poids > 200 then raise exception 'Poids invalide pour %', v_prod.nom; end if;
      v_prix := round(v_prod.prix * v_poids);
      insert into public.vente_produits (vente_id, produit_id, quantite, prix_unitaire, poids_kg)
      values (v_vente, v_prod.id, 1, v_prix, v_poids);
      v_total := v_total + v_prix;
    else
      begin
        v_q := (v_item->>'quantite')::integer;
      exception when others then raise exception 'Quantité invalide';
      end;
      if v_q is null or v_q <= 0 or v_q > 1000 then raise exception 'Quantité invalide'; end if;
      if v_prod.suivi_stock and v_prod.stock_restant < v_q then raise exception 'Stock insuffisant pour %', v_prod.nom; end if;
      insert into public.vente_produits (vente_id, produit_id, quantite, prix_unitaire)
      values (v_vente, v_prod.id, v_q, v_prod.prix);
      if v_prod.suivi_stock then
        update public.produits set stock_restant = stock_restant - v_q where id = v_prod.id;
      end if;
      v_total := v_total + v_prod.prix * v_q;
    end if;
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

-- Liste : chaque ligne porte aussi son poids (null pour une piece).
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
        'lignes', (select coalesce(jsonb_agg(jsonb_build_object('nom', p.nom, 'quantite', vp.quantite, 'prix', vp.prix_unitaire, 'poids', vp.poids_kg) order by vp.id), '[]'::jsonb)
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

revoke execute on function public.depot_creer(text, text, jsonb, numeric, text, date, text), public.depots_liste(text, text) from public, anon;
grant execute on function public.depot_creer(text, text, jsonb, numeric, text, date, text), public.depots_liste(text, text) to authenticated;

notify pgrst, 'reload schema';
