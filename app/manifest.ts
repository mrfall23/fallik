import type { MetadataRoute } from 'next';

// Genere /manifest.webmanifest. Next ajoute automatiquement <link rel="manifest">
// dans le <head>. Rend l'app installable (ecran d'accueil) et affichable en
// plein ecran, aux couleurs de la marque.
export default function manifest(): MetadataRoute.Manifest {
  return {
    name: 'Fallik — Stock & Facturation',
    short_name: 'Fallik',
    description: 'Gestion de stock et facturation pour votre boutique',
    start_url: '/',
    display: 'standalone',
    orientation: 'portrait',
    background_color: '#F4F6FB',
    theme_color: '#2563EB',
    lang: 'fr',
    icons: [
      { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
      { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any' },
      { src: '/icon-maskable-512.png', sizes: '512x512', type: 'image/png', purpose: 'maskable' },
    ],
  };
}
