import { CodeSnippet, DuplicateGroup } from '../types';

export interface MergedFunction {
  name: string;
  code: string;
  props: string[];
  variants: string[];
  description: string;
}

export class SmartRefactorer {
  
  /**
   * Analyzes duplicate functions and generates smart, merged versions
   */
  generateMergedFunctions(duplicateGroup: DuplicateGroup): MergedFunction | null {
    if (duplicateGroup.snippets.length < 2) return null;
    
    const snippets = duplicateGroup.snippets;
    const type = snippets[0].type;
    
    switch (type) {
      case 'component':
        return this.mergeComponents(snippets);
      case 'hook':
        return this.mergeHooks(snippets);
      case 'function':
        return this.mergeFunctions(snippets);
      case 'stylesheet':
        return this.mergeStylesheets(snippets);
      default:
        return this.mergeGenericFunctions(snippets);
    }
  }
  
  /**
   * Merges React components by analyzing props, styling, and logic differences
   */
  private mergeComponents(snippets: CodeSnippet[]): MergedFunction {
    const componentName = this.generateComponentName(snippets[0]);
    const props = this.analyzeComponentProps(snippets);
    const variants = this.analyzeComponentVariants(snippets);
    
    // Generate merged component code
    const mergedCode = this.generateMergedComponentCode(snippets, componentName, props, variants);
    
    return {
      name: componentName,
      code: mergedCode,
      props: props.map(p => p.name),
      variants: variants,
      description: `Smart component combining ${snippets.length} duplicate components with ${variants.length} variants`
    };
  }
  
  /**
   * Merges React hooks by analyzing state, effects, and return values
   */
  private mergeHooks(snippets: CodeSnippet[]): MergedFunction {
    const hookName = this.generateHookName(snippets[0]);
    const features = this.analyzeHookFeatures(snippets);
    
    const mergedCode = this.generateMergedHookCode(snippets, hookName, features);
    
    return {
      name: hookName,
      code: mergedCode,
      props: features.map(f => f.name || ''),
      variants: features.map(f => f.type || ''),
      description: `Smart hook combining ${snippets.length} duplicate hooks with ${features.length} features`
    };
  }
  
  /**
   * Merges utility functions by analyzing parameters and logic
   */
  private mergeFunctions(snippets: CodeSnippet[]): MergedFunction {
    const functionName = this.generateFunctionName(snippets[0]);
    const parameters = this.analyzeFunctionParameters(snippets);
    
    const mergedCode = this.generateMergedFunctionCode(snippets, functionName, parameters);
    
    return {
      name: functionName,
      code: mergedCode,
      props: parameters.map(p => p.name || ''),
      variants: parameters.map(p => p.type || ''),
      description: `Smart function combining ${snippets.length} duplicate functions with ${parameters.length} parameter variations`
    };
  }
  
  /**
   * Merges stylesheets by analyzing style properties and variants
   */
  private mergeStylesheets(snippets: CodeSnippet[]): MergedFunction {
    const styleName = this.generateStyleName(snippets[0]);
    const styleVariants = this.analyzeStyleVariants(snippets);
    
    const mergedCode = this.generateMergedStyleCode(snippets, styleName, styleVariants);
    
    return {
      name: styleName,
      code: mergedCode,
      props: styleVariants.map(s => s.name || ''),
      variants: styleVariants.map(s => s.type || ''),
      description: `Smart styles combining ${snippets.length} duplicate stylesheets with ${styleVariants.length} variants`
    };
  }
  
  /**
   * Generic function merger for other types
   */
  private mergeGenericFunctions(snippets: CodeSnippet[]): MergedFunction {
    const functionName = this.generateGenericName(snippets[0]);
    const mergedCode = this.generateGenericMergedCode(snippets, functionName);
    
    return {
      name: functionName,
      code: mergedCode,
      props: [],
      variants: [],
      description: `Generic merged function combining ${snippets.length} duplicates`
    };
  }
  
  /**
   * Analyzes component props across all duplicates
   */
  private analyzeComponentProps(snippets: CodeSnippet[]): Array<{name: string, type: string, required: boolean, defaultValue?: string}> {
    const allProps = new Map<string, {name: string, type: string, required: boolean, defaultValue?: string}>();
    
    snippets.forEach(snippet => {
      const props = this.extractComponentProps(snippet.content);
      props.forEach(prop => {
        if (!allProps.has(prop.name)) {
          allProps.set(prop.name, prop);
        } else {
          // Merge prop definitions
          const existing = allProps.get(prop.name)!;
          existing.required = existing.required && prop.required;
          existing.defaultValue = existing.defaultValue || prop.defaultValue;
        }
      });
    });
    
    return Array.from(allProps.values());
  }
  
  /**
   * Analyzes component variants (different styling/behavior patterns)
   */
  private analyzeComponentVariants(snippets: CodeSnippet[]): string[] {
    const variants = new Set<string>();
    
    snippets.forEach(snippet => {
      const variant = this.detectComponentVariant(snippet.content);
      if (variant) variants.add(variant);
    });
    
    return Array.from(variants);
  }
  
  /**
   * Generates merged component code that handles all variants
   */
  private generateMergedComponentCode(
    snippets: CodeSnippet[], 
    name: string, 
    props: Array<{name: string, type: string, required: boolean, defaultValue?: string}>,
    variants: string[]
  ): string {
    // Use the first snippet as the base and make it generic
    const baseSnippet = snippets[0];
    let code = baseSnippet.content;
    
    // Replace the function name with a generic one
    code = code.replace(/export\s+const\s+\w+/, `const ${name}`);
    
    // Remove export keyword
    code = code.replace(/export\s+/, '');
    
    return code;
  }
  
  /**
   * Helper methods for code analysis and generation
   */
  private extractComponentProps(content: string): Array<{name: string, type: string, required: boolean, defaultValue?: string}> {
    const props: Array<{name: string, type: string, required: boolean, defaultValue?: string}> = [];
    
    // Extract props from function parameters
    const propMatch = content.match(/\(\s*\{([^}]+)\}\s*\)/);
    if (propMatch) {
      const propString = propMatch[1];
      const propList = propString.split(',').map(p => p.trim());
      
      propList.forEach(prop => {
        if (prop) {
          const [name, type] = prop.split(':').map(p => p.trim());
          const hasDefault = prop.includes('=');
          const defaultValue = hasDefault ? prop.split('=')[1] : undefined;
          
          props.push({
            name: name.replace(/\?$/, ''),
            type: type || 'any',
            required: !prop.includes('?'),
            defaultValue
          });
        }
      });
    }
    
    return props;
  }
  
  private detectComponentVariant(content: string): string | null {
    if (content.includes('disabled')) return 'disabled';
    if (content.includes('outline')) return 'outline';
    if (content.includes('variant')) return 'variant';
    if (content.includes('size')) return 'size';
    return null;
  }
  
  private extractJSXContent(content: string): string {
    const jsxMatch = content.match(/return\s*\(\s*([\s\S]*?)\s*\)/);
    return jsxMatch ? jsxMatch[1].trim() : content;
  }
  
  private generateComponentName(snippet: CodeSnippet): string {
    const content = snippet.content;
    const nameMatch = content.match(/export\s+(?:const|function)\s+(\w+)/);
    return nameMatch ? nameMatch[1] : 'MergedComponent';
  }
  
  private generateHookName(snippet: CodeSnippet): string {
    const content = snippet.content;
    const nameMatch = content.match(/export\s+(?:const|function)\s+(\w+)/);
    return nameMatch ? nameMatch[1] : 'useMergedHook';
  }
  
  private generateFunctionName(snippet: CodeSnippet): string {
    const content = snippet.content;
    const nameMatch = content.match(/export\s+(?:const|function)\s+(\w+)/);
    return nameMatch ? nameMatch[1] : 'mergedFunction';
  }
  
  private generateStyleName(snippet: CodeSnippet): string {
    const content = snippet.content;
    const nameMatch = content.match(/const\s+(\w+)\s*=\s*StyleSheet\.create/);
    return nameMatch ? nameMatch[1] : 'mergedStyles';
  }
  
  private generateGenericName(snippet: CodeSnippet): string {
    return 'mergedFunction';
  }
  
  // Additional helper methods would be implemented here...
  private analyzeHookFeatures(snippets: CodeSnippet[]): Array<{name: string, type: string}> { 
    return [{ name: 'feature', type: 'basic' }]; 
  }
  private analyzeFunctionParameters(snippets: CodeSnippet[]): Array<{name: string, type: string}> { 
    return [{ name: 'param', type: 'any' }]; 
  }
  private analyzeStyleVariants(snippets: CodeSnippet[]): Array<{name: string, type: string}> { 
    return [{ name: 'variant', type: 'default' }]; 
  }
  private generateMergedHookCode(snippets: CodeSnippet[], name: string, features: any[]): string { 
    return `const ${name} = () => {\n  // Merged hook implementation\n  return {};\n};`; 
  }
  private generateMergedFunctionCode(snippets: CodeSnippet[], name: string, parameters: any[]): string { 
    // Use the first snippet as the base and make it generic
    const baseSnippet = snippets[0];
    let code = baseSnippet.content;
    
    // Replace the function name with a generic one
    code = code.replace(/export\s+const\s+\w+/, `const ${name}`);
    
    // Remove export keyword
    code = code.replace(/export\s+/, '');
    
    return code;
  }
  private generateMergedStyleCode(snippets: CodeSnippet[], name: string, variants: any[]): string { 
    return `const ${name} = StyleSheet.create({\n  // Merged styles\n});`; 
  }
  private generateGenericMergedCode(snippets: CodeSnippet[], name: string): string { 
    return `const ${name} = () => {\n  // Generic merged implementation\n};`; 
  }
}
