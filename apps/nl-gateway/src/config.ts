import fs from 'node:fs'
import path from 'node:path'

/** Load the repo-root .env (if present) and read NL settings. */
export function loadConfig() {
  const envFile = path.resolve(import.meta.dirname, '../../../.env')
  if (fs.existsSync(envFile)) process.loadEnvFile(envFile)
  return {
    apiKey: process.env.OPENROUTER_API_KEY ?? process.env.OPENROUTER_KEY ?? '',
    deciderModel: process.env.NL_DECIDER_MODEL ?? 'typesafe/jev-1.14',
    extractorModel: process.env.NL_EXTRACTOR_MODEL ?? 'mistralai/mistral-nemo',
    embedModel: process.env.NL_EMBED_MODEL ?? 'sentence-transformers/all-minilm-l6-v2',
    port: Number(process.env.NL_GATEWAY_PORT ?? 8787),
  }
}
