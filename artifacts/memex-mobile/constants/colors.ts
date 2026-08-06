// Memex brand colours — synced from artifacts/knowledge-base/src/index.css
// Light: HSL → hex conversions for all :root tokens
// Dark: HSL → hex conversions for all .dark tokens

const colors = {
  light: {
    text: '#1f1f1f',
    tint: '#2d5349',
    background: '#f9f9f6',
    foreground: '#1f1f1f',
    card: '#ffffff',
    cardForeground: '#1f1f1f',
    primary: '#2d5349',       // hsl(165 30% 25%) Swiss Forest Green
    primaryForeground: '#ffffff',
    secondary: '#ededea',
    secondaryForeground: '#333333',
    muted: '#f0f0ec',
    mutedForeground: '#737373',
    accent: '#f0f0ec',
    accentForeground: '#1f1f1f',
    destructive: '#d31212',
    destructiveForeground: '#ffffff',
    border: '#e6e6e6',
    input: '#d9d9d9',
  },
  dark: {
    text: '#e6e6e6',
    tint: '#3d8f7a',
    background: '#0f0f0f',
    foreground: '#e6e6e6',
    card: '#141414',
    cardForeground: '#e6e6e6',
    primary: '#3d8f7a',       // hsl(165 40% 40%)
    primaryForeground: '#ffffff',
    secondary: '#262626',
    secondaryForeground: '#e6e6e6',
    muted: '#1f1f1f',
    mutedForeground: '#999999',
    accent: '#262626',
    accentForeground: '#f2f2f2',
    destructive: '#f23f3f',
    destructiveForeground: '#ffffff',
    border: '#262626',
    input: '#2e2e2e',
  },
  radius: 6,
};

export default colors;
