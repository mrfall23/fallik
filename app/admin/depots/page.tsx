'use client';
import Depots from '../../components/Depots';
import { useIsMobile } from '../../components/useMediaQuery';

export default function AdminDepots() {
  const isMobile = useIsMobile();
  // Le layout admin ajoute deja ses marges : on annule celles du composant.
  return <div style={{ margin: isMobile ? '-16px' : '-22px -32px' }}><Depots isMobile={isMobile} /></div>;
}
