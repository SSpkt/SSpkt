export const colors = {
  bg: '#0A0C0F',
  surface: '#12161B',
  surfaceRaised: '#1A1F26',
  border: '#252C35',
  borderStrong: '#364050',
  text: '#F2F4F7',
  textMuted: '#9BA6B4',
  textFaint: '#667284',
  accent: '#C8F250',
  accentPressed: '#B2DA3C',
  accentSoft: 'rgba(200, 242, 80, 0.12)',
  onAccent: '#0A0C0F',
  danger: '#FF6B6B',
  dangerSoft: 'rgba(255, 107, 107, 0.12)',
  success: '#4ADE80',
  successSoft: 'rgba(74, 222, 128, 0.12)',
  overlay: 'rgba(0, 0, 0, 0.72)',
} as const;

export const space = { xs: 4, sm: 8, md: 12, lg: 16, xl: 24, xxl: 32, xxxl: 48 } as const;

export const radius = { sm: 10, md: 14, lg: 20, pill: 999 } as const;

export const type = {
  display: { fontSize: 30, lineHeight: 36, fontWeight: '800', letterSpacing: -0.6 },
  title: { fontSize: 22, lineHeight: 28, fontWeight: '700', letterSpacing: -0.3 },
  heading: { fontSize: 17, lineHeight: 22, fontWeight: '600', letterSpacing: -0.2 },
  body: { fontSize: 15, lineHeight: 22, fontWeight: '400' },
  label: { fontSize: 13, lineHeight: 18, fontWeight: '600' },
  caption: { fontSize: 12, lineHeight: 16, fontWeight: '500' },
  overline: { fontSize: 11, lineHeight: 14, fontWeight: '700', letterSpacing: 1.2 },
} as const;

export const maxContentWidth = 560;
export const minTouchTarget = 44;
