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

        VariableDeclarator: (path) => {
          if (snippets.length >= this.maxSnippets) return;
          if (path.node.init && t.isFunction(path.node.init)) {
            // Check if this is a React component (returns JSX)
            if (this.returnsJSX(path.node.init)) {
              // Extract the entire component including the variable declaration
              const snippet = this.extractComponentSnippet(path, filePath, content);
              if (snippet && !extractedLocations.has(snippet.id)) {
                snippets.push(snippet);
                extractedLocations.add(snippet.id);
              }
            } else {
              // Extract the entire variable declaration, not just the function
              const snippet = this.extractVariableSnippet(path, filePath, content);
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
        
        FunctionDeclaration: (path) => {
          if (snippets.length >= this.maxSnippets) return;
          
          // Check if it's a component (returns JSX)
          if (this.returnsJSX(path)) {
            const snippet = this.extractComponentSnippet(path, filePath, content);
            if (snippet && !extractedLocations.has(snippet.id)) {
              snippets.push(snippet);
              extractedLocations.add(snippet.id);
            }
          } else {
            // Extract the function
            const snippet = this.extractFunctionSnippet(path, filePath, content);
            if (snippet && !extractedLocations.has(snippet.id)) {
              snippets.push(snippet);
              extractedLocations.add(snippet.id);
            }
          }
        },
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

    // For components, extract the full component definition
    let startLine = node.loc.start.line;
    let endLine = node.loc.end.line;
    
    // If this is a VariableDeclarator, we need to capture the entire declaration
    if (path.isVariableDeclarator()) {
      // Get the parent VariableDeclaration to capture the full export statement
      const parentPath = path.parentPath;
      if (parentPath && parentPath.isVariableDeclaration()) {
        startLine = parentPath.node.loc.start.line;
        endLine = parentPath.node.loc.end.line;
        
        // Also check if there's an export statement above
        const grandParentPath = parentPath.parentPath;
        if (grandParentPath && grandParentPath.isExportNamedDeclaration()) {
          startLine = grandParentPath.node.loc.start.line;
        }
      }
    }
    
    // If this is a FunctionDeclaration, also check for export
    if (path.isFunctionDeclaration()) {
      const parentPath = path.parentPath;
      if (parentPath && parentPath.isExportNamedDeclaration()) {
        startLine = parentPath.node.loc.start.line;
      }
    }
    
    const code = this.extractCodeRange(content, startLine, endLine);
    
    if (!code || code.length < 20) return null; // Skip very small components

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

    // For functions, extract the full function definition
    let startLine = node.loc.start.line;
    let endLine = node.loc.end.line;
    
    // If this is a FunctionExpression inside a VariableDeclarator, capture the full declaration
    if (path.parentPath && path.parentPath.isVariableDeclarator()) {
      const parentPath = path.parentPath.parentPath;
      if (parentPath && parentPath.isVariableDeclaration()) {
        startLine = parentPath.node.loc.start.line;
        endLine = parentPath.node.loc.end.line;
      }
    }
    
    const code = this.extractCodeRange(content, startLine, endLine);
    
    if (!code || code.length < 15) return null; // Skip very small functions

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

  private extractVariableSnippet(path: any, filePath: string, content: string): CodeSnippet | null {
    const node = path.node;
    if (!node || !node.loc) return null;

    const startLine = node.loc.start.line;
    const endLine = node.loc.end.line;
    const code = this.extractCodeRange(content, startLine, endLine);
    
    if (!code || code.length < 15) return null; // Skip very small variables

    const snippetType = this.determineFunctionType(path.node.init);
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
    if (path && path.node && path.node.id && path.node.id.name && path.node.id.name.startsWith('use')) {
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
    // Check if the function returns JSX
    if (path && path.node && path.node.body) {
      // For arrow functions with expression body
      if (path.node.body.type === 'JSXElement') {
        return true;
      }
      
      // For functions with block body, check if they return JSX
      if (path.node.body.type === 'BlockStatement') {
        // Look for return statements with JSX
        for (const statement of path.node.body.body) {
          if (statement.type === 'ReturnStatement' && statement.argument) {
            if (statement.argument.type === 'JSXElement') {
              return true;
            }
            // Also check if the return value contains JSX
            const returnContent = JSON.stringify(statement.argument);
            if (returnContent.includes('<') && returnContent.includes('>')) {
              return true;
            }
          }
        }
      }
      
      // Fallback: check if body contains JSX
      const bodyContent = JSON.stringify(path.node.body);
      return bodyContent.includes('<') && bodyContent.includes('>');
    }
    return false;
  }

  private isAnimationFunction(path: any): boolean {
    if (!path || !path.node || !path.node.id) return false;
    const functionName = path.node.id.name || '';
    return functionName.includes('Animation') || 
           functionName.includes('animate') ||
           functionName.includes('motion');
  }

  private isAPIClientFunction(path: any): boolean {
    if (!path || !path.node || !path.node.id) return false;
    const functionName = path.node.id.name || '';
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
    // Less aggressive normalization for better duplicate detection
    let normalized = code;
    
    // Remove comments first
    normalized = normalized
      .replace(/\/\*[\s\S]*?\*\//g, '') // Remove block comments
      .replace(/\/\/.*$/gm, ''); // Remove line comments
    
    // Normalize whitespace but preserve structure
    normalized = normalized
      .replace(/\s+/g, ' ') // Normalize multiple spaces to single space
      .trim(); // Remove leading/trailing whitespace
    
    // Convert to lowercase for case-insensitive comparison
    normalized = normalized.toLowerCase();
    
    return normalized;
  }

  private generateHash(content: string): string {
    // Extract just the function body for more accurate duplicate detection
    let functionBody = content;
    
    // Remove export statement and function declaration, keep only the body
    functionBody = functionBody.replace(/export\s+const\s+\w+\s*=\s*\([^)]*\)\s*=>\s*/, '');
    functionBody = functionBody.replace(/export\s+function\s+\w+\s*\([^)]*\)\s*/, '');
    
    // Remove the closing semicolon if present
    functionBody = functionBody.replace(/;$/, '');
    
    let hash = 0;
    for (let i = 0; i < functionBody.length; i++) {
      const char = functionBody.charCodeAt(i);
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
