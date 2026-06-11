import 'dotenv/config';

import { $data_sources } from './schema';
import { getDb } from './database';
import type { DataSourceConfigWrapperType } from './validators/dataSourceConfig';

type SeedSource = {
  id: number;
  name: string;
  url: string;
  scrape_frequency_minutes?: number;
  rss_paywall?: boolean;
};

// A small set of reliable, full-text RSS feeds to give the pipeline real material.
// Expand via the admin UI / sources router once running.
const SOURCES: SeedSource[] = [
  { id: 1, name: 'Hacker News', url: 'https://news.ycombinator.com/rss', scrape_frequency_minutes: 60 },
  { id: 2, name: 'BBC News - World', url: 'https://feeds.bbci.co.uk/news/world/rss.xml' },
  { id: 3, name: 'Al Jazeera', url: 'https://www.aljazeera.com/xml/rss/all.xml' },
  { id: 4, name: 'NPR News', url: 'https://feeds.npr.org/1001/rss.xml' },
  { id: 5, name: 'The Guardian - World', url: 'https://www.theguardian.com/world/rss' },
];

async function main() {
  const db = getDb(process.env.DATABASE_URL!);

  const rows = SOURCES.map(s => {
    const config: DataSourceConfigWrapperType = {
      source_type: 'RSS',
      config: {
        url: s.url,
        rss_paywall: s.rss_paywall ?? false,
        config_schema_version: '1.0',
      },
    };
    return {
      id: s.id,
      name: s.name,
      source_type: 'RSS' as const,
      config,
      scrape_frequency_minutes: s.scrape_frequency_minutes ?? 240,
    };
  });

  // Idempotent: explicit ids + skip on primary-key conflict, so re-running is safe.
  await db.insert($data_sources).values(rows).onConflictDoNothing();
}

main()
  .then(() => {
    console.log('✅ Seeded database');
    process.exit(0);
  })
  .catch(err => {
    console.error('Error seeding database', err);
    process.exit(1);
  });
