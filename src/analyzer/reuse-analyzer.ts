import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { ASTParser } from '../parser/ast-parser';
import { SimilarityDetector } from '../similarity/similarity-detector';
import { ChurnAnalyzer } from '../analysis/churn-analyzer';
import { 
  CodeSnippet, 
  AnalysisOptions, 
  AnalysisResult, 
  SnippetType,
  ParserOptions 
} from '../types';

export class ReuseAnalyzer {
  private parser: ASTParser;
  private similarityDetector: SimilarityDetector;
  private churnAnalyzer: ChurnAnalyzer;
  private options: AnalysisOptions;

  constructor(projectRoot: string, options: AnalysisOptions) {
    this.options = options;
    this.parser = new ASTParser({
      includeJSX: true,
      includeTypeScript: true,
      includeFlow: false,
      sourceType: 'unambiguous'
    });
    this.similarityDetector = new SimilarityDetector(7, options.minSimilarity);
    this.churnAnalyzer = new ChurnAnalyzer(projectRoot);
  }

  async analyzeProject(): Promise<AnalysisResult> {
    console.log('🔍 Starting React Native reuse analysis...');
    
    // Find all relevant files
    const files = await this.findSourceFiles();
    console.log(`📁 Found ${files.length} source files`);
    
    // Parse files and extract snippets
    const allSnippets = await this.parseFiles(files);
    console.log(`📝 Extracted ${allSnippets.length} code snippets`);
    
    // Filter snippets by type and size
    const filteredSnippets = this.filterSnippets(allSnippets);
    console.log(`✅ Filtered to ${filteredSnippets.length} relevant snippets`);
    
    // Analyze churn if enabled
    let snippetsWithChurn = filteredSnippets;
    if (this.options.enableChurnWeighting) {
      console.log('📊 Analyzing code churn...');
      snippetsWithChurn = await this.churnAnalyzer.analyzeChurn(filteredSnippets);
    }
    
    // Find duplicates
    console.log('🔍 Detecting code duplicates...');
    const duplicates = this.similarityDetector.findDuplicates(snippetsWithChurn);
    
    // Limit results
    const limitedDuplicates = duplicates.slice(0, this.options.maxResults);
    
    // Generate suggestions
    const suggestions = this.generateSuggestions(limitedDuplicates);
    
    // Calculate summary
    const summary = this.calculateSummary(files.length, snippetsWithChurn.length, limitedDuplicates);
    
    console.log(`🎯 Found ${limitedDuplicates.length} duplicate groups`);
    
    return {
      duplicates: limitedDuplicates,
      summary,
      suggestions
    };
  }

  private async findSourceFiles(): Promise<string[]> {
    const patterns = [
      '**/*.{js,jsx,ts,tsx}',
      '!**/node_modules/**',
      '!**/dist/**',
      '!**/build/**',
      '!**/.git/**',
      '!**/coverage/**'
    ];

    try {
      const files = await glob(patterns, {
        cwd: process.cwd(),
        absolute: true,
        ignore: ['**/node_modules/**', '**/dist/**', '**/build/**']
      });

      return files.filter(file => {
        const ext = path.extname(file).toLowerCase();
        return ['.js', '.jsx', '.ts', '.tsx'].includes(ext);
      });
    } catch (error) {
      console.error('Error finding source files:', error);
      return [];
    }
  }

  private async parseFiles(files: string[]): Promise<CodeSnippet[]> {
    const allSnippets: CodeSnippet[] = [];
    
    for (const file of files) {
      try {
        const content = fs.readFileSync(file, 'utf-8');
        const snippets = this.parser.parseFile(file, content);
        allSnippets.push(...snippets);
      } catch (error) {
        console.warn(`Failed to parse ${file}:`, error);
      }
    }
    
    return allSnippets;
  }

  private filterSnippets(snippets: CodeSnippet[]): CodeSnippet[] {
    return snippets.filter(snippet => {
      // Filter by type
      if (!this.options.includeTypes.includes(snippet.type)) {
        return false;
      }
      
      // Filter by size
      if (snippet.size < this.options.minSize) {
        return false;
      }
      
      return true;
    });
  }

  private generateSuggestions(duplicates: any[]): any[] {
    return duplicates.map(group => group.suggestion);
  }

  private calculateSummary(
    totalFiles: number, 
    totalSnippets: number, 
    duplicates: any[]
  ): AnalysisResult['summary'] {
    const totalDuplicates = duplicates.reduce((sum, group) => sum + group.snippets.length, 0);
    const estimatedSavings = duplicates.reduce((sum, group) => {
      const groupSize = group.snippets[0].size;
      const duplicationCount = group.snippets.length;
      return sum + (groupSize * (duplicationCount - 1));
    }, 0);

    return {
      totalFiles,
      totalSnippets,
      duplicateGroups: duplicates.length,
      estimatedSavings
    };
  }

  async analyzeSpecificFile(filePath: string): Promise<CodeSnippet[]> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      return this.parser.parseFile(filePath, content);
    } catch (error) {
      console.error(`Failed to analyze ${filePath}:`, error);
      return [];
    }
  }

  async analyzeDirectory(dirPath: string): Promise<CodeSnippet[]> {
    const files = await this.findSourceFiles();
    const dirFiles = files.filter(file => file.startsWith(dirPath));
    return this.parseFiles(dirFiles);
  }

  getParserOptions(): ParserOptions {
    return {
      includeJSX: true,
      includeTypeScript: true,
      includeFlow: false,
      sourceType: 'unambiguous'
    };
  }

  setParserOptions(options: Partial<ParserOptions>): void {
    this.parser = new ASTParser({
      ...this.getParserOptions(),
      ...options
    });
  }

  updateAnalysisOptions(options: Partial<AnalysisOptions>): void {
    this.options = { ...this.options, ...options };
    this.similarityDetector = new SimilarityDetector(7, this.options.minSimilarity);
  }
}
