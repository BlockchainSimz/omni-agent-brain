export class KnowledgeService {
  constructor(pipeline) { this.pipeline = pipeline; }

  ingestDocument(document) {
    return this.pipeline.ingest(document);
  }

  ingestBatch(documents) {
    if (!Array.isArray(documents) || documents.length > 100) throw new Error('documents must be an array of at most 100 items');
    return documents.map(document => this.ingestDocument(document));
  }
}
