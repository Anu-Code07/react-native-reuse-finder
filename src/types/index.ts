export interface CodeSnippet {
  id: string;
  content: string;
  normalizedContent: string;
  type: SnippetType;
  filePath: string;
  startLine: number;
  endLine: number;
  size: number;
  hash: string;
  simHash: string;
  churnWeight: number;
}

export enum SnippetType {
  FUNCTION = 'function',
  COMPONENT = 'component',
  HOOK = 'hook',
  STYLESHEET = 'stylesheet',
  UTILITY = 'utility',
  ANIMATION = 'animation',
  NAVIGATION = 'navigation',
  API_CLIENT = 'api_client'
}

export interface DuplicateGroup {
  id: string;
  snippets: CodeSnippet[];
  similarity: number;
  reuseScore: number;
  suggestion: RefactorSuggestion;
}

export interface RefactorSuggestion {
  type: 'extract' | 'consolidate' | 'parameterize';
  description: string;
  targetModule: string;
  codeTemplate: string;
  estimatedEffort: 'low' | 'medium' | 'high';
  benefits: string[];
}

export interface AnalysisOptions {
  includeTypes: SnippetType[];
  minSimilarity: number;
  minSize: number;
  maxResults: number;
  enableChurnWeighting: boolean;
  enableAutoFix: boolean;
}

export interface AnalysisResult {
  duplicates: DuplicateGroup[];
  summary: {
    totalFiles: number;
    totalSnippets: number;
    duplicateGroups: number;
    estimatedSavings: number;
  };
  suggestions: RefactorSuggestion[];
}

export interface ParserOptions {
  includeJSX: boolean;
  includeTypeScript: boolean;
  includeFlow: boolean;
  sourceType: 'module' | 'script' | 'unambiguous';
}
