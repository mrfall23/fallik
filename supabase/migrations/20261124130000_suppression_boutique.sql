-- ═══════════════════════════════════════════════════════════════════════
-- FALLIK — Suppression complete d'une boutique
--
-- Probleme : supprimer une organisation qui a des ventes echouait
-- (« violates foreign key constraint vente_produits_produit_id_fkey »).
-- La cascade supprime les produits AVANT que les lignes de vente qui les
-- referencent soient elles-memes supprimees, et ces cles etrangeres
-- (sans ON DELETE) sont verifiees immediatement.
--
-- Correctif : ces cles deviennent DEFERRABLE INITIALLY DEFERRED, c'est-a-dire
-- verifiees a la fin de la transaction. Supprimer une boutique entiere
-- fonctionne alors (tout part ensemble), et les protections restent :
-- supprimer un produit deja vendu, ou un compte qui a des ventes, echoue
-- toujours (au moment du commit).
--
-- Rejouable sans risque.
-- ═══════════════════════════════════════════════════════════════════════

alter table public.vente_produits alter constraint vente_produits_produit_id_fkey deferrable initially deferred;
alter table public.ventes         alter constraint ventes_vendeuse_id_fkey        deferrable initially deferred;
alter table public.ventes         alter constraint ventes_cliente_id_fkey         deferrable initially deferred;
alter table public.factures       alter constraint factures_vendeuse_id_fkey      deferrable initially deferred;
alter table public.factures       alter constraint factures_vente_id_fkey         deferrable initially deferred;
alter table public.facture_lignes alter constraint facture_lignes_produit_id_fkey deferrable initially deferred;
