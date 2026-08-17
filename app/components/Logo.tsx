/*
 * Logo Fallik — recréation vectorielle fidèle de la marque :
 * boîtes de stock + facture (coin plié + lignes) + verre à vin (mode bar),
 * en trait blanc sur carré arrondi bleu. Net à toutes les tailles.
 */

/** Le logo Fallik complet (carré bleu + pictogramme blanc). */
export function FallikLogo({ size = 40, shadow = false }: { size?: number; shadow?: boolean }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 512 512"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{
        borderRadius: `${size * 0.234}px`,
        flexShrink: 0,
        display: 'block',
        boxShadow: shadow ? '0 6px 16px rgba(37,99,235,.28)' : undefined,
      }}
    >
      <rect width="512" height="512" rx="120" fill="#1E4FD1" />
      <g stroke="#ffffff" strokeWidth="13" strokeLinecap="round" strokeLinejoin="round">
        <rect x="72" y="330" width="138" height="82" rx="5" fill="none" />
        <rect x="72" y="258" width="92" height="72" rx="5" fill="none" />
        <rect x="72" y="214" width="54" height="44" rx="5" fill="none" />
        <path d="M110 258 v-16 h34 v16" fill="none" />
        <path d="M146 330 v-16 h34 v16" fill="none" />
        <path d="M206 150 H292 L328 186 V410 H206 Z" fill="none" />
        <path d="M292 150 V186 H328" fill="none" />
        <path d="M230 212 H292" fill="none" />
        <path d="M230 242 H304" fill="none" />
        <path d="M230 272 H286" fill="none" />
        <path d="M230 302 H304" fill="none" />
        <path d="M230 332 H278" fill="none" />
        <path d="M230 362 H298" fill="none" />
        <path d="M312 206 Q372 228 432 206 C432 296 312 296 312 206 Z" fill="#1E4FD1" />
        <path d="M372 294 V370" fill="none" />
        <path d="M336 374 Q372 358 408 374" fill="none" />
      </g>
    </svg>
  );
}
