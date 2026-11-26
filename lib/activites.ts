// Types de commerce : Fallik adapte ses mots, ses menus et son catalogue de
// depart selon ce que vend la boutique. La valeur est stockee dans
// organisations.type_activite (la base n'accepte que ces cles).

export type TypeActivite = 'boutique' | 'bar' | 'restaurant' | 'pressing' | 'salon' | 'autre';

type ArticleDepart = { nom: string; prix: number; service?: boolean };

export type Activite = {
  nom: string;
  icone: string;          // Material Symbols
  description: string;
  menuArticles: string;   // libelle du menu « Stock »
  exempleNom: string;     // placeholder du nom de la boutique
  catalogue: ArticleDepart[];
};

export const ACTIVITES: Record<TypeActivite, Activite> = {
  boutique: {
    nom: 'Boutique', icone: 'storefront', description: 'Vêtements, cosmétiques, quincaillerie…',
    menuArticles: 'Stock', exempleNom: 'Ex. Boutique Awa', catalogue: [],
  },
  bar: {
    nom: 'Bar', icone: 'sports_bar', description: 'Boissons, bières, snack',
    menuArticles: 'Boissons', exempleNom: 'Ex. Bar du Coin',
    catalogue: [
      { nom: 'Bière 65 cl', prix: 700 }, { nom: 'Bière 33 cl', prix: 500 }, { nom: 'Guinness', prix: 700 },
      { nom: 'Sucrerie', prix: 500 }, { nom: 'Eau minérale 1,5 L', prix: 500 }, { nom: 'Whisky (verre)', prix: 1000 },
    ],
  },
  restaurant: {
    nom: 'Restaurant', icone: 'restaurant', description: 'Plats, menus, boissons',
    menuArticles: 'Menu', exempleNom: 'Ex. Chez Maman',
    catalogue: [
      { nom: 'Plat du jour', prix: 1500, service: true }, { nom: 'Poulet DG', prix: 3500, service: true },
      { nom: 'Poisson braisé', prix: 3000, service: true }, { nom: 'Ndolé', prix: 2000, service: true },
      { nom: 'Sucrerie', prix: 500 }, { nom: 'Eau minérale 1,5 L', prix: 500 },
    ],
  },
  pressing: {
    nom: 'Pressing', icone: 'local_laundry_service', description: 'Lavage, repassage, nettoyage à sec',
    menuArticles: 'Services & prix', exempleNom: 'Ex. Pressing Éclat',
    catalogue: [
      { nom: 'Chemise', prix: 500, service: true }, { nom: 'Pantalon', prix: 700, service: true },
      { nom: 'Veste', prix: 1500, service: true }, { nom: 'Costume 2 pièces', prix: 2500, service: true },
      { nom: 'Robe', prix: 1500, service: true }, { nom: 'Tenue traditionnelle', prix: 2000, service: true },
      { nom: 'Drap', prix: 1000, service: true }, { nom: 'Couette', prix: 3000, service: true },
    ],
  },
  salon: {
    nom: 'Salon / services', icone: 'content_cut', description: 'Coiffure, beauté, prestations',
    menuArticles: 'Prestations', exempleNom: 'Ex. Salon Belle',
    catalogue: [
      { nom: 'Coupe homme', prix: 1000, service: true }, { nom: 'Tresses', prix: 5000, service: true },
      { nom: 'Défrisage', prix: 3000, service: true }, { nom: 'Manucure', prix: 2000, service: true },
    ],
  },
  autre: {
    nom: 'Autre', icone: 'add_business', description: 'Tout autre commerce',
    menuArticles: 'Articles', exempleNom: 'Nom de votre commerce', catalogue: [],
  },
};

export const TYPES_ACTIVITE = Object.keys(ACTIVITES) as TypeActivite[];

export const activite = (t?: string | null): Activite => ACTIVITES[(t as TypeActivite)] || ACTIVITES.boutique;

/** Numero pour wa.me : chiffres seuls, indicatif Cameroun ajoute si besoin. */
export function numeroWhatsApp(tel?: string | null): string | null {
  let d = (tel || '').replace(/\D/g, '');
  if (d.startsWith('00')) d = d.slice(2);
  if (d.length === 9) d = '237' + d;
  return d.length >= 10 ? d : null;
}
