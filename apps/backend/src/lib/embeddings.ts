import { createGoogleGenerativeAI } from '@ai-sdk/google';
import { embedMany } from 'ai';
import { err, ok } from 'neverthrow';
import type { Env } from '../index';
import { tryCatchAsync } from './tryCatchAsync';

// Dimensions of the stored `embedding` vector column (see packages/database schema).
// gemini-embedding-001 is Matryoshka: we truncate to this size at request time.
const EMBEDDING_DIMENSIONS = 1536;

/**
 * Generates embeddings for the given texts using Gemini (gemini-embedding-001).
 *
 * Reuses the same Gemini credentials as the rest of the workflow. The embeddings
 * feed cluster analysis in the brief stage, so we request taskType CLUSTERING,
 * which optimizes the vector geometry for grouping rather than query/document
 * retrieval asymmetry.
 */
export async function createEmbeddings(env: Env, texts: string[]) {
  const google = createGoogleGenerativeAI({
    apiKey: env.GEMINI_API_KEY,
    baseURL: env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta',
  });

  const result = await tryCatchAsync(
    embedMany({
      model: google.textEmbeddingModel('gemini-embedding-001', {
        outputDimensionality: EMBEDDING_DIMENSIONS,
        taskType: 'CLUSTERING',
      }),
      values: texts,
    })
  );
  if (result.isErr()) {
    return err(result.error);
  }

  return ok(result.value.embeddings);
}
