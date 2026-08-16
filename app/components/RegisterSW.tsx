'use client';
import { useEffect } from 'react';

/**
 * Gestion du service worker (PWA).
 *
 * - En PRODUCTION : enregistre /sw.js (installable, secours hors-ligne).
 * - En DEVELOPPEMENT : fait l'inverse — desinstalle tout SW existant et vide
 *   tous les caches. Un service worker en dev n'apporte rien et sert du vieux
 *   JavaScript en cache (cache-first sur /_next/static), ce qui masque les
 *   changements de code malgre un Ctrl+F5. On l'ecarte donc completement.
 */
export default function RegisterSW() {
  useEffect(() => {
    if (!('serviceWorker' in navigator)) return;

    const enProd = process.env.NODE_ENV === 'production';

    if (enProd) {
      const register = () => navigator.serviceWorker.register('/sw.js').catch(() => {});
      if (document.readyState === 'complete') register();
      else {
        window.addEventListener('load', register, { once: true });
        return () => window.removeEventListener('load', register);
      }
      return;
    }

    // Developpement : on nettoie tout pour ne jamais servir du code perime.
    (async () => {
      try {
        const regs = await navigator.serviceWorker.getRegistrations();
        await Promise.all(regs.map((r) => r.unregister()));
        if ('caches' in window) {
          const keys = await caches.keys();
          await Promise.all(keys.map((k) => caches.delete(k)));
        }
      } catch {
        /* silencieux */
      }
    })();
  }, []);
  return null;
}
