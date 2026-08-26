import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// https://vitejs.dev/config/
export default defineConfig({
  base: '/gtfs-sqljs-calendars-hints/',
  plugins: [react()],
  optimizeDeps: {
    exclude: ['gtfs-sqljs'],
    include: ['jszip', 'papaparse', 'sql.js', 'protobufjs'],
  },
  server: {
    fs: {
      // Le site importe src/calendar-hints.ts et data/school-calendar.json
      // depuis la racine du dépôt
      allow: ['..'],
    },
  },
})
