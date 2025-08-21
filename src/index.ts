// Main exports
export { ReuseAnalyzer } from './analyzer/reuse-analyzer';
export { ASTParser } from './parser/ast-parser';
export { SimilarityDetector } from './similarity/similarity-detector';
export { ChurnAnalyzer } from './analysis/churn-analyzer';

// Types and interfaces
export * from './types';

// Import for utility functions
import { ReuseAnalyzer } from './analyzer/reuse-analyzer';

// Utility functions
export const createAnalyzer = (projectRoot: string, options: any) => {
  return new ReuseAnalyzer(projectRoot, options);
};

export const analyzeProject = async (projectRoot: string, options: any) => {
  const analyzer = new ReuseAnalyzer(projectRoot, options);
  return analyzer.analyzeProject();
};

export const analyzeFile = async (filePath: string, options: any) => {
  const analyzer = new ReuseAnalyzer(process.cwd(), options);
  return analyzer.analyzeSpecificFile(filePath);
};

export const analyzeDirectory = async (dirPath: string, options: any) => {
  const analyzer = new ReuseAnalyzer(process.cwd(), options);
  return analyzer.analyzeDirectory(dirPath);
};
