import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://softdb.site',
  integrations: [
    starlight({
      title: 'SoftDB Docs',
      description: 'Documentation for SoftDB — Modern Database Management Tool',
      favicon: '/favicon.png',
      logo: {
        src: './src/assets/logo.png',
      },
      social: [
        { icon: 'github', label: 'GitHub', href: 'https://github.com/zane-tv/soft-db' },
      ],
      editLink: {
        baseUrl: 'https://github.com/zane-tv/soft-db/edit/main/docs-site/',
      },
      sidebar: [
        {
          label: 'Getting Started',
          items: [
            { label: 'Introduction', slug: 'getting-started/introduction' },
            { label: 'Installation', slug: 'getting-started/installation' },
            { label: 'Quick Start', slug: 'getting-started/quick-start' },
          ],
        },
        {
          label: 'Features',
          items: [
            { label: 'SQL Editor', slug: 'features/sql-editor' },
            { label: 'Data Grid', slug: 'features/data-grid' },
            { label: 'AI Assistant', slug: 'features/ai-assistant' },
            { label: 'Table Structure', slug: 'features/table-structure' },
            { label: 'ER Diagram', slug: 'features/er-diagram' },
            { label: 'Query Builder', slug: 'features/query-builder' },
            { label: 'Query History & Snippets', slug: 'features/query-history' },
            { label: 'Import & Export', slug: 'features/import-export' },
            { label: 'Keyboard Shortcuts', slug: 'features/keyboard-shortcuts' },
            { label: 'Safe Mode', slug: 'features/safe-mode' },
          ],
        },
        {
          label: 'Databases',
          items: [
            { label: 'Connection Management', slug: 'databases/overview' },
            { label: 'PostgreSQL', slug: 'databases/postgresql' },
            { label: 'MySQL / MariaDB', slug: 'databases/mysql' },
            { label: 'SQLite', slug: 'databases/sqlite' },
            { label: 'MongoDB', slug: 'databases/mongodb' },
            { label: 'Redshift', slug: 'databases/redshift' },
            { label: 'Redis', slug: 'databases/redis' },
            { label: 'SSH Tunneling', slug: 'databases/ssh-tunneling' },
          ],
        },
        {
          label: 'Customization',
          items: [
            { label: 'Settings Overview', slug: 'customization/settings' },
            { label: 'Appearance', slug: 'customization/appearance' },
          ],
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
        {
          label: 'Security',
          items: [
            { label: 'Security & Encryption', slug: 'security/security' },
          ],
        },
      ],
      customCss: ['./src/styles/custom.css'],
      head: [
        {
          tag: 'meta',
          attrs: { name: 'twitter:site', content: '@softdb' },
        },
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://fonts.googleapis.com' },
        },
        {
          tag: 'link',
          attrs: { rel: 'preconnect', href: 'https://fonts.gstatic.com', crossorigin: '' },
        },
      ],
      lastUpdated: true,
      pagination: true,
    }),
  ],
});
