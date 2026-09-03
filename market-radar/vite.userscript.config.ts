import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';
import { normalizeDashboardOrigins, toUserscriptMatches } from './src/userscript/origins';

const dashboardOrigins = normalizeDashboardOrigins(process.env.MWI_RADAR_DASHBOARD_ORIGINS);
const dashboardMatches = toUserscriptMatches(dashboardOrigins);

export default defineConfig({
  define: {
    __MWI_RADAR_DASHBOARD_ORIGINS__: JSON.stringify(dashboardOrigins),
  },
  build: {
    outDir: 'dist',
    emptyOutDir: false,
  },
  plugins: [
    monkey({
      entry: 'src/userscript/main.ts',
      userscript: {
        name: 'MWI Market Radar Collector & Snapshot Exporter',
        namespace: 'local.mwi.market-radar',
        version: '0.1.6',
        match: [
          'https://www.milkywayidle.com/*',
          ...dashboardMatches,
        ],
        connect: ['www.milkywayidle.com'],
        'run-at': 'document-start',
        grant: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues', 'GM_setClipboard'],
      },
      build: {
        fileName: 'mwi-market-radar.user.js',
      },
    }),
  ],
});
