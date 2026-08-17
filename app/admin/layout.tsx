'use client';
import { useState } from 'react';
import { useRouter, usePathname } from 'next/navigation';
import { useUtilisateur, seDeconnecter } from '@/lib/utilisateur';
import { useIsMobile } from '../components/useMediaQuery';
import PushToggle from '../components/PushToggle';
import { FallikLogo } from '../components/Logo';

const NAV = [
  { href: '/admin', icon: 'space_dashboard', label: 'Tableau de bord' },
  { href: '/admin/produits', icon: 'inventory_2', label: 'Stock' },
  { href: '/admin/ventes', icon: 'receipt_long', label: 'Factures' },
  { href: '/admin/clients', icon: 'groups', label: 'Clients' },
  { href: '/admin/vendeuses', icon: 'badge', label: 'Vendeuses' },
  { href: '/admin/rapports', icon: 'bar_chart', label: 'Rapports' },
  { href: '/admin/parametres', icon: 'settings', label: 'Paramètres' },
];

const TITRES: Record<string, [string, string]> = {
  '/admin': ['Tableau de bord', "Vue d'ensemble de l'activité"],
  '/admin/produits': ['Stock', 'Catalogue et niveaux de stock'],
  '/admin/ventes': ['Factures', 'Historique des ventes et factures'],
  '/admin/vendeuses': ['Vendeuses', 'Performance et classement'],
  '/admin/clients': ['Clients', 'Profils et historique des achats'],
  '/admin/rapports': ['Rapports', 'Exports Excel de votre activité'],
  '/admin/parametres': ['Paramètres', 'Comptes et réglages'],
};

export default function AdminLayout({ children }: { children: React.ReactNode }) {
  const { utilisateur: user } = useUtilisateur('admin');
  const router = useRouter();
  const pathname = usePathname();
  const isMobile = useIsMobile();
  const [menuOuvert, setMenuOuvert] = useState(false);

  if (!user) return <div style={{ minHeight: '100vh', background: 'var(--bg)' }} />;

  const [pageTitle, pageSub] = TITRES[pathname] || ['', ''];
  const initial = user.nom?.trim()[0]?.toUpperCase() || 'A';
  const naviguer = (href: string) => { router.push(href); setMenuOuvert(false); };
  const dateJour = new Date().toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });

  const asideStyle: React.CSSProperties = isMobile
    ? { position: 'fixed', top: 0, left: 0, height: '100vh', width: '264px', zIndex: 60, transform: menuOuvert ? 'translateX(0)' : 'translateX(-100%)', transition: 'transform .28s ease', display: 'flex', flexDirection: 'column', padding: '20px 16px', background: '#fff', borderRight: '1px solid #EAEEF5', boxShadow: menuOuvert ? '0 0 60px rgba(26,36,56,.18)' : 'none' }
    : { position: 'sticky', top: 0, height: '100vh', display: 'flex', flexDirection: 'column', padding: '22px 16px', background: '#fff', borderRight: '1px solid #EAEEF5' };

  return (
    <div style={{ display: isMobile ? 'block' : 'grid', gridTemplateColumns: '264px 1fr', minHeight: '100vh', background: 'var(--bg)' }}>
      {isMobile && menuOuvert && <div onClick={() => setMenuOuvert(false)} style={{ position: 'fixed', inset: 0, zIndex: 55, background: 'rgba(26,36,56,.4)' }} />}

      {/* ── SIDEBAR ── */}
      <aside style={asideStyle}>
        {/* Logo */}
        <div style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '4px 8px 22px' }}>
          <FallikLogo size={40} shadow />
          <div>
            <div style={{ fontSize: '17px', fontWeight: 800, color: '#1A2438', lineHeight: 1 }}>Fallik</div>
            <div style={{ fontSize: '9.5px', fontWeight: 700, letterSpacing: '1.3px', color: '#9AA3B2', marginTop: '3px' }}>STOCK &amp; FACTURATION</div>
          </div>
        </div>

        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.2px', color: '#9AA3B2', padding: '0 10px 10px' }}>PILOTAGE</div>
        <nav style={{ display: 'flex', flexDirection: 'column', gap: '3px' }}>
          {NAV.map(item => {
            const active = item.href === '/admin' ? pathname === '/admin' : pathname.startsWith(item.href);
            return (
              <button key={item.href} onClick={() => naviguer(item.href)}
                style={{ display: 'flex', alignItems: 'center', gap: '13px', padding: '11px 12px', borderRadius: '11px', cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left', fontSize: '14px', fontWeight: active ? 700 : 500, background: active ? '#EDF2FD' : 'transparent', color: active ? '#2563EB' : '#5A6478' }}>
                <span className="ms" style={{ fontSize: '21px', color: active ? '#2563EB' : '#9AA3B2' }}>{item.icon}</span>
                <span>{item.label}</span>
              </button>
            );
          })}
        </nav>

        <div style={{ fontSize: '11px', fontWeight: 700, letterSpacing: '1.2px', color: '#9AA3B2', padding: '20px 10px 10px' }}>ESPACES</div>
        <button onClick={() => router.push('/vendeuse')} style={{ display: 'flex', alignItems: 'center', gap: '13px', padding: '11px 12px', borderRadius: '11px', cursor: 'pointer', border: 'none', width: '100%', textAlign: 'left', fontSize: '14px', fontWeight: 500, background: 'transparent', color: '#5A6478' }}>
          <span className="ms" style={{ fontSize: '21px', color: '#9AA3B2' }}>point_of_sale</span>Espace vendeuse
        </button>

        {/* Notifications + Profil / déconnexion */}
        <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: '10px' }}>
          <PushToggle />
          <div style={{ display: 'flex', alignItems: 'center', gap: '11px', padding: '12px', borderRadius: '14px', background: '#F4F6FB', border: '1px solid #EAEEF5' }}>
          <div style={{ width: '38px', height: '38px', borderRadius: '11px', background: 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', display: 'flex', alignItems: 'center', justifyContent: 'center', color: '#fff', fontWeight: 700, flexShrink: 0 }}>{initial}</div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: '13.5px', fontWeight: 700, color: '#1A2438', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{user.nom}</div>
            <div style={{ fontSize: '11.5px', color: '#8A94A6' }}>Administratrice</div>
          </div>
          <button onClick={seDeconnecter} title="Déconnexion" aria-label="Se déconnecter" style={{ background: 'transparent', border: 'none', cursor: 'pointer', padding: '6px', display: 'flex', color: '#8A94A6' }}>
            <span className="ms" style={{ fontSize: '20px' }}>logout</span>
          </button>
          </div>
        </div>
      </aside>

      {/* ── MAIN ── */}
      <main style={{ display: 'flex', flexDirection: 'column', minWidth: 0 }}>
        <header style={{ position: 'sticky', top: 0, zIndex: 5, display: 'flex', alignItems: 'center', gap: '16px', padding: isMobile ? '14px 16px' : '20px 32px', background: '#fff', borderBottom: '1px solid #EAEEF5' }}>
          {isMobile && (
            <button onClick={() => setMenuOuvert(true)} aria-label="Menu" style={{ background: '#fff', border: '1px solid var(--line)', borderRadius: '11px', width: '42px', height: '42px', display: 'flex', alignItems: 'center', justifyContent: 'center', cursor: 'pointer', flexShrink: 0 }}>
              <span className="ms" style={{ fontSize: '24px', color: '#1A2438' }}>menu</span>
            </button>
          )}
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: isMobile ? '20px' : '26px', fontWeight: 800, color: '#1A2438', lineHeight: 1.1, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{pageTitle}</div>
            {!isMobile && <div style={{ fontSize: '13.5px', color: '#8A94A6', marginTop: '3px' }}>{pageSub}{pathname === '/admin' ? ` · ${dateJour}` : ''}</div>}
          </div>
          {!isMobile && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '11px', height: '44px', padding: '0 16px', borderRadius: '12px', background: '#fff', border: '1px solid #E5EAF2', minWidth: '260px' }}>
              <span className="ms" style={{ fontSize: '20px', color: '#9AA3B2' }}>search</span>
              <input placeholder="Rechercher facture, article…" aria-label="Rechercher" style={{ flex: 1, background: 'transparent', border: 'none', outline: 'none', color: '#1A2438', fontSize: '14px' }} />
            </div>
          )}
          <button onClick={() => router.push('/vendeuse')} style={{ display: 'flex', alignItems: 'center', gap: '8px', height: '44px', padding: isMobile ? '0 14px' : '0 20px', border: 'none', borderRadius: '12px', cursor: 'pointer', background: 'linear-gradient(135deg,#4B7DF5,#1D4FD0)', color: '#fff', fontSize: '14px', fontWeight: 700, boxShadow: '0 8px 20px rgba(37,99,235,.25)', flexShrink: 0 }}>
            <span className="ms" style={{ fontSize: '20px' }}>add</span>{!isMobile && 'Nouvelle facture'}
          </button>
        </header>

        <div style={{ padding: isMobile ? '18px 16px 48px' : '26px 32px 56px' }}>{children}</div>
      </main>
    </div>
  );
}
