import { $data_sources, $ingested_items, and, eq, gte, isNotNull, lte, not } from '@meridian/database';
import { Hono } from 'hono';
import type { HonoEnv } from '../app';
import { getDb, hasValidAuthToken } from '../lib/utils';

const route = new Hono<HonoEnv>().get('/', async c => {
  // require bearer auth token
  const hasValidToken = hasValidAuthToken(c);
  if (!hasValidToken) {
    return c.json({ error: 'Unauthorized' }, 401);
  }

  // Check if a date query parameter was provided in yyyy-mm-dd format
  const dateParam = c.req.query('date');

  let endDate: Date;
  if (dateParam) {
    // Parse the date parameter explicitly with UTC
    // Append T07:00:00Z to ensure it's 7am UTC
    endDate = new Date(`${dateParam}T07:00:00Z`);
    // Check if date is valid
    if (Number.isNaN(endDate.getTime())) {
      return c.json({ error: 'Invalid date format. Please use yyyy-mm-dd' }, 400);
    }
  } else {
    // Use current date if no date parameter was provided
    endDate = new Date();
    // Set to 7am UTC today
    endDate.setUTCHours(7, 0, 0, 0);
  }

  // Create a 30-hour window ending at 7am UTC on the specified date
  const startDate = new Date(endDate.getTime() - 30 * 60 * 60 * 1000);

  const db = getDb(c.env.HYPERDRIVE);
  const [allSources, events] = await Promise.all([
    db.select({ id: $data_sources.id, name: $data_sources.name }).from($data_sources),
    db
      .select({
        id: $ingested_items.id,
        sourceId: $ingested_items.data_source_id,
        url: $ingested_items.url_to_original,
        title: $ingested_items.display_title,
        publishDate: $ingested_items.published_at,
        contentFileKey: $ingested_items.raw_data_r2_key,
        // processed article text (truncated to ~10KB in DB; full copy in content_body_r2_key) +
        // the structured representation used for the embedding. Needed by the brief stage's
        // cluster-review and deep-analysis prompts.
        content: $ingested_items.content_body_text,
        embeddingText: $ingested_items.embedding_text,
        wordCount: $ingested_items.word_count,
        embedding: $ingested_items.embedding,
        createdAt: $ingested_items.ingested_at,
      })
      .from($ingested_items)
      .where(
        and(
          isNotNull($ingested_items.embedding),
          gte($ingested_items.published_at, startDate),
          lte($ingested_items.published_at, endDate),
          isNotNull($ingested_items.processed_at)
        )
      ),
  ]);

  return c.json({
    sources: allSources,
    events,
    dateRange: {
      startDate: startDate.toISOString(),
      endDate: endDate.toISOString(),
    },
  });
});

export default route;
