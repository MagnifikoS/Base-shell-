import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'app.lovable.5decb3762f0948baba5920034cfaeb64',
  appName: 'base-shell-foundation',
  webDir: 'dist',
  server: {
    // Hot-reload from Lovable sandbox during development
    url: 'https://5decb376-2f09-48ba-ba59-20034cfaeb64.lovableproject.com?forceHideBadge=true',
    cleartext: true,
    // Handle SPA routing - all routes return index.html
    androidScheme: 'https',
  },
  // iOS safe areas
  ios: {
    contentInset: 'automatic',
  },
  // Android: handle back button for SPA
  android: {
    allowMixedContent: true,
  },
};

export default config;
