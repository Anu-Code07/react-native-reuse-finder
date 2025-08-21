import { parse } from '@babel/parser';
import traverse from '@babel/traverse';
import * as t from '@babel/types';
import { CodeSnippet, SnippetType, ParserOptions } from '../types';

export class ASTParser {
  private options: ParserOptions;
  private maxSnippets: number;

  constructor(options: ParserOptions = {
    includeJSX: true,
    includeTypeScript: true,
    includeFlow: false,
    sourceType: 'unambiguous'
  }, maxSnippets: number = 50) {
    this.options = options;
    this.maxSnippets = maxSnippets;
  }

  parseFile(filePath: string, content: string): CodeSnippet[] {
    try {
      const ast = parse(content, {
        sourceType: this.options.sourceType,
        plugins: [
          ...(this.options.includeJSX ? ['jsx' as const] : []),
          ...(this.options.includeTypeScript ? ['typescript' as const] : []),
          ...(this.options.includeFlow ? ['flow' as const] : []),
          'decorators-legacy' as const,
          'classProperties' as const,
          'objectRestSpread' as const
        ]
      });

      const snippets: CodeSnippet[] = [];
      const extractedLocations = new Set<string>(); // Track already extracted locations
      
      traverse(ast, {
        FunctionDeclaration: (path) => {
          if (snippets.length >= this.maxSnippets) return;
          const snippet = this.extractFunctionSnippet(path, filePath, content);
          if (snippet && !extractedLocations.has(snippet.id)) {
            snippets.push(snippet);
            extractedLocations.add(snippet.id);
          }
        },
        FunctionExpression: (path) => {
          if (snippets.length >= this.maxSnippets) return;
          // Only extract if this is a top-level function expression, not nested
          if (!path.parent || !t.isFunction(path.parent)) {
            const snippet = this.extractFunctionSnippet(path, filePath, content);
            if (snippet && !extractedLocations.has(snippet.id)) {
              snippets.push(snippet);
              extractedLocations.add(snippet.id);
            }
          }
        },
        ArrowFunctionExpression: (path) => {
          if (snippets.length >= this.maxSnippets) return;
          // Only extract if this is a top-level arrow function, not nested
          if (!path.parent || !t.isFunction(path.parent)) {
            const snippet = this.extractFunctionSnippet(path, filePath, content);
            if (snippet && !extractedLocations.has(snippet.id)) {
              snippets.push(snippet);
              extractedLocations.add(snippet.id);
            }
          }
        },
        VariableDeclarator: (path) => {
          if (snippets.length >= this.maxSnippets) return;
          if (path.node.init && t.isFunction(path.node.init)) {
            // Check if this is a React component (exported function with JSX)
            if (path.node.id && 
                'name' in path.node.id && 
                typeof path.node.id.name === 'string' &&
                (path.node.id.name.endsWith('Component') || 
                 path.node.id.name.startsWith('Button') ||
                 path.node.id.name.startsWith('ButtonV2'))) {
              // Extract the entire component including the variable declaration
              const snippet = this.extractComponentSnippet(path, filePath, content);
              if (snippet && !extractedLocations.has(snippet.id)) {
                snippets.push(snippet);
                extractedLocations.add(snippet.id);
              }
            } else {
              const snippet = this.extractFunctionSnippet(path.node.init, filePath, content);
              if (snippet && !extractedLocations.has(snippet.id)) {
                snippets.push(snippet);
                extractedLocations.add(snippet.id);
              }
            }
          }
        },
        CallExpression: (path) => {
          if (snippets.length >= this.maxSnippets) return;
          if (this.isStyleSheetCreate(path)) {
            const snippet = this.extractStyleSheetSnippet(path, filePath, content);
            if (snippet && !extractedLocations.has(snippet.id)) {
              snippets.push(snippet);
              extractedLocations.add(snippet.id);
            }
          }
        },
        JSXElement: (path) => {
          if (snippets.length >= this.maxSnippets) return;
          // Only extract if this is a top-level JSX element, not nested
          if (!path.parent || !t.isJSXElement(path.parent)) {
            const snippet = this.extractComponentSnippet(path, filePath, content);
            if (snippet && !extractedLocations.has(snippet.id)) {
              snippets.push(snippet);
              extractedLocations.add(snippet.id);
            }
          }
        }
      });

      return snippets;
    } catch (error) {
      console.warn(`Failed to parse ${filePath}:`, error);
      return [];
    }
  }

  private extractComponentSnippet(path: any, filePath: string, content: string): CodeSnippet | null {
    const node = path.node;
    if (!node.loc) return null;

    // For components, extract only the component itself, not the entire file
    const startLine = node.loc.start.line;
    const endLine = node.loc.end.line;
    
    // Extract only the component code, not expanding to include styles or exports
    const code = this.extractCodeRange(content, startLine, endLine);
    
    if (!code || code.length < 50) return null; // Skip very small components

    const normalizedContent = this.normalizeCode(code);
    
    return {
      id: `${filePath}:${startLine}-${endLine}`,
      content: code,
      normalizedContent,
      type: SnippetType.COMPONENT,
      filePath,
      startLine,
      endLine,
      size: code.length,
      hash: this.generateHash(normalizedContent),
      simHash: this.generateSimHash(normalizedContent),
      churnWeight: 1.0 // Will be updated by churn analyzer
    };
  }

  private extractFunctionSnippet(path: any, filePath: string, content: string): CodeSnippet | null {
    const node = path.node;
    if (!node || !node.body || !node.loc) return null;

    const startLine = node.loc.start.line;
    const endLine = node.loc.end.line;
    const code = this.extractCodeRange(content, startLine, endLine);
    
    if (!code || code.length < 30) return null; // Skip very small functions

    const snippetType = this.determineFunctionType(path);
    const normalizedContent = this.normalizeCode(code);
    
    return {
      id: `${filePath}:${startLine}-${endLine}`,
      content: code,
      normalizedContent,
      type: snippetType,
      filePath,
      startLine,
      endLine,
      size: code.length,
      hash: this.generateHash(normalizedContent),
      simHash: this.generateSimHash(normalizedContent),
      churnWeight: 1.0 // Will be updated by churn analyzer
    };
  }

  private extractStyleSheetSnippet(path: any, filePath: string, content: string): CodeSnippet | null {
    const node = path.node;
    if (!node.loc) return null;

    const startLine = node.loc.start.line;
    const endLine = node.loc.end.line;
    const code = this.extractCodeRange(content, startLine, endLine);
    
    if (!code) return null;

    const normalizedContent = this.normalizeCode(code);
    
    return {
      id: `${filePath}:${startLine}-${endLine}`,
      content: code,
      normalizedContent,
      type: SnippetType.STYLESHEET,
      filePath,
      startLine,
      endLine,
      size: code.length,
      hash: this.generateHash(normalizedContent),
      simHash: this.generateSimHash(normalizedContent),
      churnWeight: 1.0
    };
  }

  private determineFunctionType(path: any): SnippetType {
    // Check if it's a React hook
    if (path.node.id && path.node.id.name && path.node.id.name.startsWith('use')) {
      return SnippetType.HOOK;
    }

    // Check if it's a component (returns JSX)
    if (this.returnsJSX(path)) {
      return SnippetType.COMPONENT;
    }

    // Check if it's an animation function
    if (this.isAnimationFunction(path)) {
      return SnippetType.ANIMATION;
    }

    // Check if it's an API client function
    if (this.isAPIClientFunction(path)) {
      return SnippetType.API_CLIENT;
    }

    return SnippetType.FUNCTION;
  }

  private returnsJSX(path: any): boolean {
    let returnsJSX = false;
    path.traverse({
      ReturnStatement: (returnPath: any) => {
        if (t.isJSXElement(returnPath.node.argument) || 
            t.isJSXFragment(returnPath.node.argument)) {
          returnsJSX = true;
        }
      }
    });
    return returnsJSX;
  }

  private isAnimationFunction(path: any): boolean {
    const functionName = path.node.id?.name || '';
    return functionName.includes('Animation') || 
           functionName.includes('animate') ||
           functionName.includes('motion');
  }

  private isAPIClientFunction(path: any): boolean {
    const functionName = path.node.id?.name || '';
    return functionName.includes('fetch') || 
           functionName.includes('api') ||
           functionName.includes('request');
  }

  private isStyleSheetCreate(path: any): boolean {
    return t.isMemberExpression(path.node.callee) &&
           t.isIdentifier(path.node.callee.object) &&
           path.node.callee.object.name === 'StyleSheet' &&
           t.isIdentifier(path.node.callee.property) &&
           path.node.callee.property.name === 'create';
  }

  private extractCodeRange(content: string, startLine: number, endLine: number): string {
    const lines = content.split('\n');
    return lines.slice(startLine - 1, endLine).join('\n');
  }

  private normalizeCode(code: string): string {
    // Optimized normalization for better performance
    let normalized = code;
    
    // Remove comments first (most expensive operation)
    normalized = normalized
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .replace(/\/\/.*$/gm, ''); // Remove line comments
    
    // Remove whitespace and normalize
    normalized = normalized
      .replace(/\s+/g, ' ') // Normalize whitespace
      .replace(/\s*([{}();,=])\s*/g, '$1') // Remove spaces around punctuation
      .replace(/\s+/g, '') // Remove all remaining whitespace
      .toLowerCase(); // Convert to lowercase for case-insensitive comparison
    
    return normalized;
  }

  private generateHash(content: string): string {
    let hash = 0;
    for (let i = 0; i < content.length; i++) {
      const char = content.charCodeAt(i);
      hash = ((hash << 5) - hash) + char;
      hash = hash & hash; // Convert to 32-bit integer
    }
    return hash.toString(36);
  }

  private generateSimHash(content: string): string {
    // Simple simhash implementation - in production, use a more sophisticated algorithm
    const tokens = content.split(/\s+/);
    const hash = tokens.reduce((acc: number, token: string) => {
      return acc + parseInt(this.generateHash(token), 36);
    }, 0);
    return hash.toString(36);
  }
}
