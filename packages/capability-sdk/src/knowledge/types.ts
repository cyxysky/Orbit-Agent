export type KnowledgeDocument = {
  id: string; title: string; content: string; source?: string; metadata?: Record<string, unknown>;
  createdAt: string; updatedAt: string;
  packageId?: string; packageVersion?: string; recordId?: string; kind?: string; domain?: string;
  chapterId?: string; chapterTitle?: string; parentId?: string; entryId?: string; linkedIds?: string[];
  answerEligible?: boolean;
};
export type KnowledgeDocumentSummary = Omit<KnowledgeDocument, 'content'> & { contentChars: number };
export type KnowledgeSearchHit = Pick<KnowledgeDocument, 'id' | 'title' | 'source' | 'packageId' | 'packageVersion' | 'recordId' | 'kind' | 'domain' | 'chapterId' | 'chapterTitle'>
  & { text: string; score: number; excerptOffset: number; contentChars: number };
export type KnowledgeFilter = { packageId?: string; version?: string; kinds?: string[]; domain?: string; chapter?: string; includeReferences?: boolean };
export type KnowledgePackage = {
  id: string; name: string; version: string; description: string; enabled: boolean; recordCount: number;
  domains: string[]; importedAt: string; checksum: string; instructions?: string;
};
export type KnowledgePackageSummary = Omit<KnowledgePackage, 'instructions'>;
export type KnowledgePackageImport = { package: KnowledgePackage; documents: KnowledgeDocument[]; archive?: Uint8Array; archiveName?: string };
export type KnowledgeGroup = { id: string; title: string; packageId?: string; domain?: string; score: number; matchedRecords: number };
