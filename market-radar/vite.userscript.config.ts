import { defineConfig } from 'vite';
import monkey from 'vite-plugin-monkey';

const dashboardOrigins = (process.env.MWI_RADAR_DASHBOARD_ORIGINS ?? 'http://localhost:4173')
  .split(',')
  .map((value) => value.trim())
  .filter(Boolean);

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
        name: 'MWI Market Radar Collector',
        namespace: 'local.mwi.market-radar',
        version: '0.1.0',
        match: [
          'https://www.milkywayidle.com/*',
          'http://localhost:4173/*',
        ],
        connect: ['www.milkywayidle.com'],
        grant: ['GM_getValue', 'GM_setValue', 'GM_deleteValue', 'GM_listValues'],
      },
      build: {
        fileName: 'mwi-market-radar.user.js',
      },
    }),
  ],
});
