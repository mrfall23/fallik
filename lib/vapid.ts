// Cle publique VAPID — NON secrete par nature (elle est de toute facon envoyee
// au navigateur pour s'abonner aux notifications). On peut donc l'ecrire en dur :
// ca evite une variable d'environnement cote build. Seule la cle PRIVEE
// (VAPID_PRIVATE_KEY) reste un secret, cote serveur uniquement.
export const VAPID_PUBLIC_KEY =
  'BD_IAAV4pMyyrsZevns7-rMXmm4q-iAg_3VxzYfcq-QzmnmCQ_lfUlQp1S8JF0fKkl4ZEhjQ3zFdYHyWXsSaJZU';
