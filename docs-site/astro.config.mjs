import { defineConfig } from 'astro/config';
import starlight from '@astrojs/starlight';

export default defineConfig({
  site: 'https://docs.softdb.app',
  integrations: [
    starlight({
      title: 'SoftDB Docs',
      description: 'Documentation for SoftDB — Modern Database Management Tool',
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
          label: 'Guides',
          autogenerate: { directory: 'guides' },
        },
        {
          label: 'Databases',
          autogenerate: { directory: 'databases' },
        },
        {
          label: 'Reference',
          autogenerate: { directory: 'reference' },
        },
      ],
      head: [
        {
          tag: 'meta',
          attrs: { name: 'twitter:site', content: '@softdb' },
        },
      ],
      lastUpdated: true,
      pagination: true,
    }),
  ],
});
