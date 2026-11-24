'use client';
import { useEffect, useState } from 'react';
import { supabase } from '@/lib/supabase';

const fmt = (n: number) => Math.round(n).toLocaleString('fr-FR');
const INK = '#1A2438', LINE = '#EAEEF5', MUTE = '#9AA3B2', VERT = '#1F9D6B';

// Jauge de l'objectif du mois de la vendeuse connectee (rien si pas d'objectif).
export default function MonObjectif({ rafraichir, devise, isMobile }: { rafraichir: number; devise: string; isMobile: boolean }) {
  const [o, setO] = useState<{ objectif: number; realise: number } | null>(null);

  useEffect(() => {
    let annule = false;
    supabase.rpc('mon_objectif').then(({ data }) => {
      if (!annule && data) setO({ objectif: Number(data.objectif) || 0, realise: Number(data.realise) || 0 });
    });
    return () => { annule = true; };
  }, [rafraichir]);

  if (!o || o.objectif <= 0) return null;
  const pct = Math.min(100, Math.round((o.realise / o.objectif) * 100));
  const atteint = o.realise >= o.objectif;
  const mois = new Date().toLocaleDateString('fr-FR', { month: 'long' });

  return (
    <div style={{ padding: isMobile ? '12px 16px 0' : '14px 32px 0', maxWidth: '1400px', margin: '0 auto' }}>
      <div style={{ background: '#fff', border: `1px solid ${atteint ? 'rgba(31,157,107,.3)' : LINE}`, borderRadius: '14px', padding: '12px 16px', maxWidth: '520px' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline', gap: '10px', fontSize: '13px' }}>
          <span style={{ fontWeight: 700, color: INK, display: 'flex', alignItems: 'center', gap: '6px' }}>
            <span className="ms" style={{ fontSize: '17px', color: atteint ? VERT : '#2563EB' }}>{atteint ? 'emoji_events' : 'flag'}</span>Mon objectif de {mois}
          </span>
          <span style={{ color: '#5A6472', whiteSpace: 'nowrap' }}><b style={{ color: INK }}>{fmt(o.realise)}</b> / {fmt(o.objectif)} {devise}</span>
        </div>
        <div style={{ height: '8px', background: '#EEF1F7', borderRadius: '6px', overflow: 'hidden', marginTop: '8px' }}>
          <div style={{ height: '100%', width: `${pct}%`, background: atteint ? 'linear-gradient(90deg,#34C08A,#1F9D6B)' : 'linear-gradient(90deg,#4B7DF5,#1D4FD0)', borderRadius: '6px', transition: 'width .3s' }} />
        </div>
        <div style={{ fontSize: '12px', color: atteint ? VERT : MUTE, fontWeight: 600, marginTop: '5px' }}>
          {atteint ? 'Objectif atteint, bravo !' : `${pct} % · encore ${fmt(o.objectif - o.realise)} ${devise}`}
        </div>
      </div>
    </div>
  );
}
