/** Runs the model in the browser (webllm.ts) off the main thread: WebLLM's own engine handler. */
import { WebWorkerMLCEngineHandler } from '@mlc-ai/web-llm'

const handler = new WebWorkerMLCEngineHandler()
self.onmessage = (msg: MessageEvent) => handler.onmessage(msg)
