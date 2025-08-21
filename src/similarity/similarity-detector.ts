import { CodeSnippet, DuplicateGroup } from '../types';

export class SimilarityDetector {
  private kGramSize: number;
  private minSimilarity: number;
  private fastMode: boolean;

  constructor(kGramSize: number = 7, minSimilarity: number = 0.8, fastMode: boolean = false) {
    this.kGramSize = kGramSize;
    this.minSimilarity = minSimilarity;
    this.fastMode = fastMode;
  }

  findDuplicates(snippets: CodeSnippet[]): DuplicateGroup[] {
    if (snippets.length === 0) return [];
    
    // Pre-filter by type for better performance
    const snippetsByType = new Map<string, CodeSnippet[]>();
    snippets.forEach(snippet => {
      if (!snippetsByType.has(snippet.type)) {
        snippetsByType.set(snippet.type, []);
      }
      snippetsByType.get(snippet.type)!.push(snippet);
    });

    const groups: DuplicateGroup[] = [];
    const processed = new Set<string>();

    // Process each type separately to reduce comparisons
    for (const [type, typeSnippets] of snippetsByType) {
      if (typeSnippets.length < 2) continue;
      
      // Use hash-based grouping for exact matches first (O(n))
      const hashGroups = this.groupByHash(typeSnippets);
      
      for (const [hash, hashSnippets] of hashGroups) {
        if (hashSnippets.length > 1) {
          const group = this.createDuplicateGroup(hashSnippets, 1.0);
          groups.push(group);
          hashSnippets.forEach(snippet => processed.add(snippet.id));
        }
      }
      
      // For remaining snippets, use optimized similarity detection
      const remainingSnippets = typeSnippets.filter(s => !processed.has(s.id));
      if (remainingSnippets.length > 1) {
        const similarityGroups = this.findSimilarSnippetsOptimized(remainingSnippets);
        groups.push(...similarityGroups);
        similarityGroups.forEach(group => 
          group.snippets.forEach(snippet => processed.add(snippet.id))
        );
      }
    }

    return groups.sort((a, b) => b.reuseScore - a.reuseScore);
  }

  private findSimilarSnippets(
    target: CodeSnippet, 
    allSnippets: CodeSnippet[], 
    startIndex: number
  ): DuplicateGroup | null {
    const similar: CodeSnippet[] = [target];
    let totalSimilarity = 1.0;

    for (let i = startIndex + 1; i < allSnippets.length; i++) {
      const snippet = allSnippets[i];
      if (snippet.type !== target.type) continue;
      
      // Skip if this is the same snippet (same file, same lines)
      if (snippet.id === target.id) continue;
      
      // Skip if this is the same content in the same file
      if (snippet.filePath === target.filePath && 
          snippet.startLine === target.startLine && 
          snippet.endLine === target.endLine) continue;
      
      // Skip if this is essentially the same location (within a few lines)
      if (snippet.filePath === target.filePath && 
          Math.abs(snippet.startLine - target.startLine) < 5) continue;

      const similarity = this.calculateSimilarity(target, snippet);
      if (similarity >= this.minSimilarity) {
        similar.push(snippet);
        totalSimilarity += similarity;
      }
    }

    // Only return a group if we found actual duplicates (more than 1 snippet)
    if (similar.length <= 1) {
      return null;
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
    // Fast path: exact hash match (most common case)
    if (snippet1.hash === snippet2.hash) {
      return 1.0;
    }
    
    // Fast path: simhash similarity (good for near-duplicates)
    const simHashSimilarity = this.calculateSimHashSimilarity(snippet1.simHash, snippet2.simHash);
    if (simHashSimilarity > 0.9) {
      return simHashSimilarity;
    }
    
    // In fast mode, skip expensive operations
    if (this.fastMode) {
      return simHashSimilarity;
    }
    
    // Only do expensive operations for potential matches
    if (simHashSimilarity < 0.5) {
      return simHashSimilarity;
    }
    
    // Calculate shingle similarity (medium cost)
    const shingleSimilarity = this.calculateShingleSimilarity(snippet1.normalizedContent, snippet2.normalizedContent);
    
    // Skip edit distance for very different content (most expensive operation)
    if (shingleSimilarity < 0.3) {
      return (simHashSimilarity + shingleSimilarity) / 2;
    }
    
    // Only calculate edit distance for very similar content
    const editDistanceSimilarity = this.calculateEditDistanceSimilarity(snippet1.normalizedContent, snippet2.normalizedContent);
    
    // Weighted combination for final similarity
    return (
      simHashSimilarity * 0.5 +
      shingleSimilarity * 0.3 +
      editDistanceSimilarity * 0.2
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
    // Early exit for very different lengths
    const lengthDiff = Math.abs(content1.length - content2.length);
    const maxLength = Math.max(content1.length, content2.length);
    if (lengthDiff / maxLength > 0.7) {
      return 0.0;
    }
    
    const shingles1 = this.generateShingles(content1);
    const shingles2 = this.generateShingles(content2);

    // Use more efficient intersection calculation
    let intersection = 0;
    for (const shingle of shingles1) {
      if (shingles2.has(shingle)) {
        intersection++;
      }
    }
    
    const union = shingles1.size + shingles2.size - intersection;
    return intersection / union;
  }

  private generateShingles(content: string): Set<string> {
    const shingles = new Set<string>();
    const tokens = content.split(/\s+/);
    
    // Limit shingles for performance
    const maxShingles = 100;
    let count = 0;

    for (let i = 0; i <= tokens.length - this.kGramSize && count < maxShingles; i++) {
      const shingle = tokens.slice(i, i + this.kGramSize).join(' ');
      shingles.add(shingle);
      count++;
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

  // Performance optimization helper methods
  private groupByHash(snippets: CodeSnippet[]): Map<string, CodeSnippet[]> {
    const groups = new Map<string, CodeSnippet[]>();
    snippets.forEach(snippet => {
      if (!groups.has(snippet.hash)) {
        groups.set(snippet.hash, []);
      }
      groups.get(snippet.hash)!.push(snippet);
    });
    return groups;
  }

  private createDuplicateGroup(snippets: CodeSnippet[], similarity: number): DuplicateGroup {
    const reuseScore = this.calculateReuseScore(snippets, similarity);
    return {
      id: `group-${snippets[0].id}`,
      snippets,
      similarity,
      reuseScore,
      suggestion: this.generateSuggestion(snippets, similarity)
    };
  }

  private findSimilarSnippetsOptimized(snippets: CodeSnippet[]): DuplicateGroup[] {
    const groups: DuplicateGroup[] = [];
    const processed = new Set<string>();

    for (let i = 0; i < snippets.length; i++) {
      if (processed.has(snippets[i].id)) continue;

      const group = this.findSimilarSnippets(snippets[i], snippets, i);
      if (group && group.snippets.length > 1) { // Only add if group exists and has duplicates
        // Additional check: ensure we don't have the same snippet multiple times
        const uniqueSnippets = group.snippets.filter((snippet, index, arr) => 
          arr.findIndex(s => s.id === snippet.id) === index
        );
        
        if (uniqueSnippets.length > 1) {
          const updatedGroup = {
            ...group,
            snippets: uniqueSnippets
          };
          groups.push(updatedGroup);
          uniqueSnippets.forEach(snippet => processed.add(snippet.id));
        }
      }
    }

    return groups;
  }
}
