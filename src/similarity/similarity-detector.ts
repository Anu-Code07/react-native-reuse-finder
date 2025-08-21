import { CodeSnippet, DuplicateGroup } from '../types';

export class SimilarityDetector {
  private kGramSize: number;
  private minSimilarity: number;

  constructor(kGramSize: number = 7, minSimilarity: number = 0.8) {
    this.kGramSize = kGramSize;
    this.minSimilarity = minSimilarity;
  }

  findDuplicates(snippets: CodeSnippet[]): DuplicateGroup[] {
    const groups: DuplicateGroup[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < snippets.length; i++) {
      if (processed.has(snippets[i].id)) continue;

      const group = this.findSimilarSnippets(snippets[i], snippets, i);
      if (group.snippets.length > 1) {
        groups.push(group);
        group.snippets.forEach(snippet => processed.add(snippet.id));
      }
    }

    return groups.sort((a, b) => b.reuseScore - a.reuseScore);
  }

  private findSimilarSnippets(
    target: CodeSnippet, 
    allSnippets: CodeSnippet[], 
    startIndex: number
  ): DuplicateGroup {
    const similar: CodeSnippet[] = [target];
    let totalSimilarity = 1.0;

    for (let i = startIndex + 1; i < allSnippets.length; i++) {
      const snippet = allSnippets[i];
      if (snippet.type !== target.type) continue;

      const similarity = this.calculateSimilarity(target, snippet);
      if (similarity >= this.minSimilarity) {
        similar.push(snippet);
        totalSimilarity += similarity;
      }
    }

    const avgSimilarity = totalSimilarity / similar.length;
    const reuseScore = this.calculateReuseScore(similar, avgSimilarity);

    return {
      id: `group-${target.id}`,
      snippets: similar,
      similarity: avgSimilarity,
      reuseScore,
      suggestion: this.generateSuggestion(similar, avgSimilarity)
    };
  }

  private calculateSimilarity(snippet1: CodeSnippet, snippet2: CodeSnippet): number {
    // Use multiple similarity metrics and combine them
    const exactHashSimilarity = snippet1.hash === snippet2.hash ? 1.0 : 0.0;
    const simHashSimilarity = this.calculateSimHashSimilarity(snippet1.simHash, snippet2.simHash);
    const shingleSimilarity = this.calculateShingleSimilarity(snippet1.normalizedContent, snippet2.normalizedContent);
    const editDistanceSimilarity = this.calculateEditDistanceSimilarity(snippet1.normalizedContent, snippet2.normalizedContent);

    // Weighted combination of similarity metrics
    return (
      exactHashSimilarity * 0.4 +
      simHashSimilarity * 0.3 +
      shingleSimilarity * 0.2 +
      editDistanceSimilarity * 0.1
    );
  }

  private calculateSimHashSimilarity(hash1: string, hash2: string): number {
    // Calculate Hamming distance between simhashes
    const maxLength = Math.max(hash1.length, hash2.length);
    let distance = 0;
    
    for (let i = 0; i < maxLength; i++) {
      const char1 = hash1[i] || '';
      const char2 = hash2[i] || '';
      if (char1 !== char2) distance++;
    }

    return 1 - (distance / maxLength);
  }

  private calculateShingleSimilarity(content1: string, content2: string): number {
    const shingles1 = this.generateShingles(content1);
    const shingles2 = this.generateShingles(content2);

    const intersection = new Set([...shingles1].filter(x => shingles2.has(x)));
    const union = new Set([...shingles1, ...shingles2]);

    return intersection.size / union.size;
  }

  private generateShingles(content: string): Set<string> {
    const shingles = new Set<string>();
    const tokens = content.split(/\s+/);

    for (let i = 0; i <= tokens.length - this.kGramSize; i++) {
      const shingle = tokens.slice(i, i + this.kGramSize).join(' ');
      shingles.add(shingle);
    }

    return shingles;
  }

  private calculateEditDistanceSimilarity(content1: string, content2: string): number {
    const distance = this.levenshteinDistance(content1, content2);
    const maxLength = Math.max(content1.length, content2.length);
    return 1 - (distance / maxLength);
  }

  private levenshteinDistance(str1: string, str2: string): number {
    const matrix = Array(str2.length + 1).fill(null).map(() => Array(str1.length + 1).fill(null));

    for (let i = 0; i <= str1.length; i++) matrix[0][i] = i;
    for (let j = 0; j <= str2.length; j++) matrix[j][0] = j;

    for (let j = 1; j <= str2.length; j++) {
      for (let i = 1; i <= str1.length; i++) {
        const indicator = str1[i - 1] === str2[j - 1] ? 0 : 1;
        matrix[j][i] = Math.min(
          matrix[j][i - 1] + 1, // deletion
          matrix[j - 1][i] + 1, // insertion
          matrix[j - 1][i - 1] + indicator // substitution
        );
      }
    }

    return matrix[str2.length][str1.length];
  }

  private calculateReuseScore(snippets: CodeSnippet[], similarity: number): number {
    const totalSize = snippets.reduce((sum, snippet) => sum + snippet.size, 0);
    const duplicationCount = snippets.length;
    const avgChurnWeight = snippets.reduce((sum, snippet) => sum + snippet.churnWeight, 0) / snippets.length;

    return totalSize * similarity * duplicationCount * avgChurnWeight;
  }

  private generateSuggestion(snippets: CodeSnippet[], similarity: number): any {
    const firstSnippet = snippets[0];
    const targetModule = this.suggestTargetModule(firstSnippet.type);
    
    let suggestionType: 'extract' | 'consolidate' | 'parameterize';
    let description: string;
    let estimatedEffort: 'low' | 'medium' | 'high';

    if (similarity > 0.95) {
      suggestionType = 'extract';
      description = `Extract ${firstSnippet.type} to shared module`;
      estimatedEffort = 'low';
    } else if (similarity > 0.85) {
      suggestionType = 'consolidate';
      description = `Consolidate similar ${firstSnippet.type}s with parameters`;
      estimatedEffort = 'medium';
    } else {
      suggestionType = 'parameterize';
      description = `Parameterize ${firstSnippet.type} for reuse`;
      estimatedEffort = 'high';
    }

    return {
      type: suggestionType,
      description,
      targetModule,
      codeTemplate: this.generateCodeTemplate(snippets, suggestionType),
      estimatedEffort,
      benefits: [
        `Reduce duplication by ${Math.round((1 - 1/snippets.length) * 100)}%`,
        `Improve maintainability`,
        `Enable consistent behavior across components`
      ]
    };
  }

  private suggestTargetModule(type: string): string {
    const moduleMap: Record<string, string> = {
      'component': 'shared/components',
      'hook': 'shared/hooks',
      'stylesheet': 'shared/styles',
      'utility': 'shared/utils',
      'animation': 'shared/animations',
      'navigation': 'shared/navigation',
      'api_client': 'shared/api',
      'function': 'shared/utils'
    };

    return moduleMap[type] || 'shared/utils';
  }

  private generateCodeTemplate(snippets: CodeSnippet[], type: string): string {
    // This would generate actual code templates based on the snippets
    // For now, return a placeholder
    return `// Generated template for ${snippets[0].type}\n// Replace with actual implementation`;
  }
}
