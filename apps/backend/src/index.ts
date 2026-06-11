import app from './app';
import { DataSourceIngestorDO } from './durable_objects/dataSourceIngestorDO';
import { Logger } from './lib/logger';
import { type ProcessArticlesParams, startProcessArticleWorkflow } from './workflows/processIngestedItem.workflow';

export type Env = {
  // Bindings
  ARTICLES_BUCKET: R2Bucket;
  ARTICLE_PROCESSING_QUEUE: Queue<ProcessArticlesParams>;
  DATA_SOURCE_INGESTOR: DurableObjectNamespace<DataSourceIngestorDO>;
  PROCESS_INGESTED_ITEM: Workflow<ProcessArticlesParams>;
  HYPERDRIVE: Hyperdrive;

  // Secrets
  API_TOKEN: string;

  AXIOM_DATASET: string | undefined; // optional, use if you want to send logs to axiom
  AXIOM_TOKEN: string | undefined; // optional, use if you want to send logs to axiom

  CLOUDFLARE_API_TOKEN: string;
  CLOUDFLARE_ACCOUNT_ID: string;

  DATABASE_URL: string;

  GEMINI_API_KEY: string;
  GEMINI_BASE_URL: string;
};

// Create a base logger for the queue handler
const queueLogger = new Logger({ service: 'article-queue-handler' });

export default {
  fetch: app.fetch,
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const batchLogger = queueLogger.child({ batch_size: batch.messages.length });
    batchLogger.info('Received batch of articles to process');

    const articlesToProcess: number[] = [];
    for (const message of batch.messages) {
      const { ingested_item_ids } = message.body as ProcessArticlesParams;
      batchLogger.debug('Processing message', { message_id: message.id, article_count: ingested_item_ids.length });

      for (const id of ingested_item_ids) {
        articlesToProcess.push(id);
      }
    }

    batchLogger.info('Articles extracted from batch', { total_articles: articlesToProcess.length });

    if (articlesToProcess.length === 0) {
      batchLogger.info('Queue batch was empty, nothing to process');
      batch.ackAll(); // Acknowledge the empty batch
      return;
    }

    // Process articles in chunks of 96
    const CHUNK_SIZE = 96;
    const articleChunks = [];
    for (let i = 0; i < articlesToProcess.length; i += CHUNK_SIZE) {
      articleChunks.push(articlesToProcess.slice(i, i + CHUNK_SIZE));
    }

    batchLogger.info('Split articles into chunks', { chunk_count: articleChunks.length });

    // Process each chunk sequentially
    for (const chunk of articleChunks) {
      const workflowResult = await startProcessArticleWorkflow(env, { ingested_item_ids: chunk });
      if (workflowResult.isErr()) {
        batchLogger.error(
          'Failed to trigger ProcessArticles Workflow',
          { error_message: workflowResult.error.message, chunk_size: chunk.length },
          workflowResult.error
        );
        // Retry the entire batch if Workflow creation failed
        batch.retryAll({ delaySeconds: 30 }); // Retry after 30 seconds
        return;
      }

      batchLogger.info('Successfully triggered ProcessArticles Workflow for chunk', {
        workflow_id: workflowResult.value.id,
        chunk_size: chunk.length,
      });
    }

    batch.ackAll(); // Acknowledge the entire batch after all chunks are processed
  },
} satisfies ExportedHandler<Env>;

export { DataSourceIngestorDO };
export { ProcessIngestedItemWorkflow } from './workflows/processIngestedItem.workflow';
