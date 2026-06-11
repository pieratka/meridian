import {
  boolean,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  serial,
  text,
  timestamp,
  vector,
  bigserial,
  unique,
} from 'drizzle-orm/pg-core';
import { sql } from 'drizzle-orm';
import type { DataSourceConfigWrapperType } from './validators/dataSourceConfig';
import type { AnalysisPayloadWrapper } from './validators/analysisPayload';

/**
 * Note: We use $ to denote the table objects
 * This frees up the uses of sources, articles, reports, etc as variables in the codebase
 **/

export const ingestedItemStatusEnum = pgEnum('ingested_item_status', [
  'NEW',
  'PENDING_PROCESSING',
  'PROCESSED',
  'FAILED_RENDER',
  'FAILED_FETCH',
  'FAILED_PROCESSING',
  'FAILED_EMBEDDING',
  'FAILED_R2_UPLOAD',
  'SKIPPED_PDF',
  'SKIPPED_TOO_OLD',
]);

export const sourceTypeEnum = pgEnum('source_type', ['RSS']);

export const $publishers = pgTable('publishers', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  base_url: text('base_url'),
  created_at: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
});

export const $data_sources = pgTable('data_sources', {
  id: serial('id').primaryKey(),
  name: text('name').notNull(),
  source_type: sourceTypeEnum().notNull(),
  config: jsonb('config').$type<DataSourceConfigWrapperType>().notNull(), // Stores source-specific config like {"url": "...", "config_schema_version": "1.0", "paywall": false, "category": "..."}
  config_version_hash: text('config_version_hash'), // Hash of config to detect changes
  publisher_id: integer('publisher_id').references(() => $publishers.id),
  scrape_frequency_minutes: integer('scrape_frequency_minutes').notNull().default(240), // Default: 4 hours
  lastChecked: timestamp('last_checked', { mode: 'date' }),
  do_initialized_at: timestamp('do_initialized_at', { mode: 'date' }),
  created_at: timestamp('created_at', { mode: 'date' }).defaultNow().notNull(),
  updated_at: timestamp('updated_at', { mode: 'date' }).defaultNow().notNull(),
});

export const $ingested_items = pgTable(
  'ingested_items',
  {
    id: bigserial('id', { mode: 'number' }).primaryKey(),

    item_id_from_source: text('item_id_from_source').notNull(), // RSS guid, Tweet ID, etc.
    raw_data_r2_key: text('raw_data_r2_key').notNull(), // R2 key for original payload

    display_title: text('display_title'), // nullable, might be derived later
    url_to_original: text('url_to_original').notNull().unique(),
    published_at: timestamp('published_at', { mode: 'date' }),

    status: ingestedItemStatusEnum().default('NEW'),

    content_body_r2_key: text('content_body_r2_key'), // R2 key for processed text
    content_body_text: text('content_body_text'), // inline snippet or full text if small
    word_count: integer('word_count'),

    embedding_text: text('embedding_text'), // text used to generate embedding
    analysis_payload: jsonb('analysis_payload').$type<typeof AnalysisPayloadWrapper>(), // structured LLM analysis
    source_specific_metadata: jsonb('source_specific_metadata'), // small, queryable metadata

    usedBrowser: boolean('used_browser'),
    embedding: vector('embedding', { dimensions: 1536 }),
    fail_reason: text('fail_reason'),

    data_source_id: integer('data_source_id')
      .references(() => $data_sources.id)
      .notNull(),

    processed_at: timestamp('processed_at', { mode: 'date' }),
    ingested_at: timestamp('ingested_at', { mode: 'date' }).default(sql`CURRENT_TIMESTAMP`),
  },
  table => [
    index('embeddingIndex').using('hnsw', table.embedding.op('vector_cosine_ops')),
    unique('uniqueSourceItem').on(table.data_source_id, table.item_id_from_source),
  ]
);

export const $reports = pgTable('reports', {
  id: serial('id').primaryKey(),
  title: text('title').notNull(),
  content: text('content').notNull(),

  totalArticles: integer('total_articles').notNull(),
  totalSources: integer('total_sources').notNull(),

  usedArticles: integer('used_articles').notNull(),
  usedSources: integer('used_sources').notNull(),

  tldr: text('tldr'),

  clustering_params: jsonb('clustering_params'),

  model_author: text('model_author'),

  createdAt: timestamp('created_at', { mode: 'date' })
    .default(sql`CURRENT_TIMESTAMP`)
    .notNull(),
});

export const $newsletter = pgTable('newsletter', {
  id: serial('id').primaryKey(),
  email: text('email').notNull().unique(),
  createdAt: timestamp('created_at', { mode: 'date' }).default(sql`CURRENT_TIMESTAMP`),
});
