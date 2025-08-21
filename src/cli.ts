#!/usr/bin/env node

import { Command } from 'commander';
import chalk from 'chalk';
import * as path from 'path';
import { ReuseAnalyzer } from './analyzer/reuse-analyzer';
import { AnalysisOptions, SnippetType } from './types';

const program = new Command();

program
  .name('rn-reuse-finder')
  .description('Detect reusable/duplicate React Native code and suggest refactors')
  .version('1.0.0');

program
  .command('analyze')
  .description('Analyze a React Native project for code duplication')
  .argument('[path]', 'Path to the project directory', '.')
  .option('-t, --types <types>', 'Comma-separated list of snippet types to analyze', 'component,hook,stylesheet,utility')
  .option('-s, --similarity <threshold>', 'Minimum similarity threshold (0.0-1.0)', '0.8')
  .option('-m, --min-size <size>', 'Minimum snippet size in characters', '100')
  .option('-r, --max-results <count>', 'Maximum number of duplicate groups to return', '50')
  .option('--no-churn', 'Disable churn analysis')
  .option('--no-auto-fix', 'Disable auto-fix suggestions')
  .option('-o, --output <format>', 'Output format (json, table, summary, code)', 'table')
  .option('-f, --file <file>', 'Analyze specific file only')
  .option('-d, --directory <dir>', 'Analyze specific directory only')
  .option('--fast', 'Enable fast mode (skip expensive similarity calculations)', false)
  .option('--max-snippets <count>', 'Maximum snippets to analyze per file (default: 50)', '50')
  .option('--output-file <path>', 'Output results to file (works with json and code formats)')
  .action(async (projectPath, options) => {
    try {
      const startTime = Date.now();
      const resolvedPath = path.resolve(projectPath);
      console.log(chalk.blue(`🔍 Analyzing React Native project at: ${resolvedPath}`));

      // Parse snippet types
      const snippetTypes = options.types.split(',').map((type: string) => {
        const trimmed = type.trim();
        if (Object.values(SnippetType).includes(trimmed as SnippetType)) {
          return trimmed as SnippetType;
        }
        console.warn(chalk.yellow(`Warning: Unknown snippet type '${trimmed}', skipping`));
        return null;
      }).filter(Boolean) as SnippetType[];

      if (snippetTypes.length === 0) {
        console.error(chalk.red('Error: No valid snippet types specified'));
        process.exit(1);
      }

      // Create analysis options
      const analysisOptions: AnalysisOptions = {
        includeTypes: snippetTypes,
        minSimilarity: parseFloat(options.similarity),
        minSize: parseInt(options.minSize),
        maxResults: parseInt(options.maxResults),
        enableChurnWeighting: options.churn !== false,
        enableAutoFix: options.autoFix !== false,
        fastMode: options.fast || false,
        maxSnippetsPerFile: parseInt(options.maxSnippets) || 50
      };

      let result;
      if (options.file) {
        const filePath = path.resolve(options.file);
        console.log(chalk.blue(`📄 Analyzing specific file: ${filePath}`));
        
        // For single file analysis, use ASTParser directly
        const { ASTParser } = await import('./parser/ast-parser');
        const parser = new ASTParser({
          includeJSX: true,
          includeTypeScript: true,
          includeFlow: false,
          sourceType: 'unambiguous'
        }, analysisOptions.maxSnippetsPerFile);
        
        console.log(chalk.yellow('🔄 Parsing file...'));
        const content = await import('fs').then(fs => fs.readFileSync(filePath, 'utf-8'));
        const snippets = parser.parseFile(filePath, content);
        console.log(chalk.green(`✅ Found ${snippets.length} code snippets`));
        
        if (snippets.length === 0) {
          console.log(chalk.yellow('⚠️  No code snippets found to analyze'));
          result = {
            duplicates: [],
            summary: {
              totalFiles: 1,
              totalSnippets: 0,
              duplicateGroups: 0,
              estimatedSavings: 0
            },
            suggestions: []
          };
        } else {
          console.log(chalk.yellow('🔍 Detecting duplicates...'));
          // Create similarity detector to find duplicates
          const { SimilarityDetector } = await import('./similarity/similarity-detector');
          const similarityDetector = new SimilarityDetector(7, analysisOptions.minSimilarity, analysisOptions.fastMode);
          const duplicates = similarityDetector.findDuplicates(snippets);
          console.log(chalk.green(`✅ Found ${duplicates.length} duplicate groups`));
          
          // Generate suggestions manually
          const suggestions = duplicates.map(group => group.suggestion);
          
          result = {
            duplicates,
            summary: {
              totalFiles: 1,
              totalSnippets: snippets.length,
              duplicateGroups: duplicates.length,
              estimatedSavings: duplicates.reduce((sum: number, group: any) => sum + (group.snippets[0].size * (group.snippets.length - 1)), 0)
            },
            suggestions,
            performance: {
              fastMode: analysisOptions.fastMode,
              maxSnippetsPerFile: analysisOptions.maxSnippetsPerFile,
              analysisTime: Date.now() - startTime
            }
          };
        }
      } else if (options.directory) {
        const dirPath = path.resolve(options.directory);
        console.log(chalk.blue(`📁 Analyzing specific directory: ${dirPath}`));
        
        const analyzer = new ReuseAnalyzer(dirPath, analysisOptions);
        const snippets = await analyzer.analyzeDirectory(dirPath);
        
        // Create similarity detector to find duplicates
        const similarityDetector = new (await import('./similarity/similarity-detector')).SimilarityDetector(7, analysisOptions.minSimilarity);
        const duplicates = similarityDetector.findDuplicates(snippets);
        
        // Generate suggestions manually
        const suggestions = duplicates.map(group => group.suggestion);
        
        result = {
          duplicates,
          summary: {
            totalFiles: 0,
            totalSnippets: snippets.length,
            duplicateGroups: duplicates.length,
            estimatedSavings: duplicates.reduce((sum: number, group: any) => sum + (group.snippets[0].size * (group.snippets.length - 1)), 0)
          },
          suggestions
        };
      } else {
        // Analyze entire project
        const analyzer = new ReuseAnalyzer(resolvedPath, analysisOptions);
        result = await analyzer.analyzeProject();
      }

      // Output results
      outputResults(result, options.output, options.outputFile);

    } catch (error) {
      console.error(chalk.red('Error during analysis:'), error);
      process.exit(1);
    }
  });

program
  .command('config')
  .description('Show current configuration')
  .action(() => {
    console.log(chalk.blue('📋 React Native Reuse Finder Configuration'));
    console.log('');
    console.log('Default Analysis Options:');
    console.log('  - Snippet Types: component, hook, stylesheet, utility');
    console.log('  - Min Similarity: 0.8');
    console.log('  - Min Size: 100 characters');
    console.log('  - Max Results: 50');
    console.log('  - Churn Analysis: enabled');
    console.log('  - Auto-fix: enabled');
    console.log('');
    console.log('Supported Snippet Types:');
    Object.values(SnippetType).forEach(type => {
      console.log(`  - ${type}`);
    });
  });

program.parse();

export default program;

function outputResults(result: any, format: string, outputFile?: string) {
  console.log('');
  
  let output: string;
  
  switch (format.toLowerCase()) {
    case 'json':
      output = JSON.stringify(result, null, 2);
      break;
      
    case 'code':
      output = outputCode(result);
      break;
      
    case 'summary':
      outputSummary(result);
      return;
      
    case 'table':
    default:
      outputTable(result);
      return;
  }
  
  // Output to console
  console.log(output);
  
  // Output to file if specified
  if (outputFile) {
    try {
      const fs = require('fs');
      fs.writeFileSync(outputFile, output);
      console.log(chalk.green(`\n💾 Results saved to: ${outputFile}`));
    } catch (error) {
      console.error(chalk.red(`\n❌ Failed to write to file: ${error}`));
    }
  }
}

function outputCode(result: any): string {
  let output = '';
  
  // Simple header
  output += '// React Native Reuse Finder - Generated Refactored Components\n';
  output += '// Generated on: ' + new Date().toISOString() + '\n';
  output += '// Total Duplicates Found: ' + result.duplicates.length + '\n';
  output += '// Estimated Savings: ' + result.summary.estimatedSavings + ' characters\n\n';
  
  if (result.duplicates.length === 0) {
    output += '// No duplicates found to refactor.\n';
    return output;
  }
  
  // Group duplicates by type
  const duplicatesByType = new Map();
  result.duplicates.forEach((group: any) => {
    const type = group.snippets[0].type;
    if (!duplicatesByType.has(type)) {
      duplicatesByType.set(type, []);
    }
    duplicatesByType.get(type).push(group);
  });
  
  // Generate code for each type
  for (const [type, groups] of duplicatesByType) {
    output += `// ===== ${type.toUpperCase()} REFACTORING =====\n\n`;
    
    groups.forEach((group: any, index: number) => {
      const firstSnippet = group.snippets[0];
      const componentName = generateComponentName(firstSnippet, index);
      
      // Component header
      output += `// ${componentName} - Extracted from ${group.snippets.length} duplicates\n`;
      output += `// Original: ${firstSnippet.filePath}:${firstSnippet.startLine}-${firstSnippet.endLine}\n`;
      output += `// Estimated Savings: ${firstSnippet.size * (group.snippets.length - 1)} characters\n\n`;
      
      // Refactored component code
      const refactoredCode = generateRefactoredComponent(firstSnippet, componentName, group.snippets.length);
      output += refactoredCode;
      output += '\n\n';
      
      // Simple usage instructions
      output += `// Usage: Save to shared/${type}s/${componentName}.tsx\n`;
      output += `// Replace duplicates with: import { ${componentName} } from './shared/${type}s/${componentName}';\n\n`;
      
      output += '// ===== END ${componentName} =====\n\n';
    });
  }
  
  return output;
}

function generateComponentName(snippet: any, index: number): string {
  // Try to extract component name from content
  const content = snippet.content;
  const componentMatch = content.match(/export\s+(?:const|function)\s+(\w+)/);
  if (componentMatch) {
    return componentMatch[1];
  }
  
  // Fallback to generic name
  return `${snippet.type.charAt(0).toUpperCase() + snippet.type.slice(1)}${index + 1}`;
}

function generateRefactoredComponent(snippet: any, componentName: string, duplicateCount: number): string {
  const content = snippet.content;
  
  // Clean header comment
  let refactored = '';
  refactored += `/**\n`;
  refactored += ` * ${componentName}\n`;
  refactored += ` * Extracted from ${duplicateCount} duplicate instances\n`;
  refactored += ` * Estimated savings: ${snippet.size * (duplicateCount - 1)} characters\n`;
  refactored += ` */\n\n`;
  
  // Add necessary imports for React Native components
  if (content.includes('React') || content.includes('react')) {
    refactored += `import React from 'react';\n`;
  }
  
  // Extract and add React Native imports
  const rnImports = extractReactNativeImports(content);
  if (rnImports.length > 0) {
    refactored += `import { ${rnImports.join(', ')} } from 'react-native';\n`;
  }
  
  // Extract and add other imports (excluding relative imports)
  const otherImports = extractOtherImports(content);
  if (otherImports.length > 0) {
    otherImports.forEach(imp => {
      refactored += `${imp}\n`;
    });
  }
  
  refactored += '\n';
  
  // Clean the component code - remove export, comments, and make it generic
  let componentCode = content
    .replace(/export\s+/, '')
    .replace(/import\s+.*?from\s+['"][^'"]*['"];?\s*/g, '')
    .replace(/\/\/.*$/gm, '') // Remove single-line comments
    .replace(/\/\*[\s\S]*?\*\//g, '') // Remove multi-line comments
    .trim();
  
  // Ensure proper spacing
  componentCode = componentCode.replace(/\n{3,}/g, '\n\n');
  
  // Add the clean component code
  refactored += componentCode;
  
  // Add export statement at the end
  refactored += `\n\nexport default ${componentName};\n`;
  
  return refactored;
}

function extractReactNativeImports(content: string): string[] {
  const rnComponents = [
    // Core components
    'View', 'Text', 'TouchableOpacity', 'TouchableHighlight', 'TouchableWithoutFeedback',
    'ScrollView', 'FlatList', 'SectionList', 'Image', 'ImageBackground', 'TextInput',
    'Switch', 'Slider', 'Picker', 'Modal', 'Alert', 'Animated', 'PanGestureHandler',
    'StyleSheet', 'Dimensions', 'Platform', 'StatusBar', 'SafeAreaView', 'KeyboardAvoidingView',
    
    // Additional components
    'Pressable', 'ActivityIndicator', 'RefreshControl', 'SectionList', 'VirtualizedList',
    'DrawerLayoutAndroid', 'InputAccessoryView', 'MaskedView', 'ProgressBarAndroid',
    'ProgressViewIOS', 'SegmentedControlIOS', 'Slider', 'Switch', 'TabBarIOS',
    
    // Hooks and utilities
    'useWindowDimensions', 'useColorScheme', 'useAccessibilityInfo', 'useLayoutEffect',
    'useCallback', 'useMemo', 'useRef', 'useState', 'useEffect', 'useReducer', 'useContext'
  ];
  
  const found = rnComponents.filter(component => 
    content.includes(component) && 
    !content.includes(`import.*${component}`)
  );
  
  return found;
}

function extractOtherImports(content: string): string[] {
  const imports: string[] = [];
  const importRegex = /import\s+.*?from\s+['"](?!\.)[^'"]*['"];?/g;
  let match;
  
  while ((match = importRegex.exec(content)) !== null) {
    const importStatement = match[0];
    // Skip React Native imports as they're handled separately
    if (!importStatement.includes("'react-native'") && !importStatement.includes('"react-native"')) {
      imports.push(importStatement);
    }
  }
  
  return imports;
}

function outputSummary(result: any) {
  const { summary, duplicates } = result;
  
  console.log(chalk.green('📊 ANALYSIS SUMMARY'));
  console.log(chalk.green('='.repeat(50)));
  console.log(`📁 Total Files: ${chalk.yellow(summary.totalFiles)}`);
  console.log(`🔍 Total Snippets: ${chalk.yellow(summary.totalSnippets)}`);
  console.log(`🔄 Duplicate Groups: ${chalk.yellow(summary.duplicateGroups)}`);
  console.log(`💾 Estimated Savings: ${chalk.green(summary.estimatedSavings + ' characters')}`);
  console.log('');
  
  if (duplicates.length > 0) {
    console.log(chalk.yellow('🚨 TOP DUPLICATION ISSUES:'));
    console.log(chalk.yellow('-'.repeat(50)));
    duplicates.slice(0, 5).forEach((group: any, index: number) => {
      const firstSnippet = group.snippets[0];
      const savings = firstSnippet.size * (group.snippets.length - 1);
      
      console.log(`${chalk.cyan(index + 1)}. ${chalk.white(firstSnippet.type)} (${chalk.yellow(group.snippets.length)} duplicates)`);
      console.log(`   📊 Similarity: ${chalk.yellow((group.similarity * 100).toFixed(1) + '%')}`);
      console.log(`   💾 Savings: ${chalk.green(savings + ' characters')}`);
      console.log('');
    });
  } else {
    console.log(chalk.green('✅ No significant code duplication found!'));
  }
}

function outputTable(result: any) {
  const { summary, duplicates } = result;
  
  // Output summary first
  outputSummary(result);
  
  if (duplicates.length === 0) return;
  
  console.log(chalk.blue('📋 DETAILED DUPLICATE ANALYSIS'));
  console.log(chalk.blue('='.repeat(80)));
  
  duplicates.forEach((group: any, index: number) => {
    const firstSnippet = group.snippets[0];
    
    // Group header
    console.log(chalk.cyan(`\n🔍 DUPLICATE GROUP ${index + 1}: ${firstSnippet.type.toUpperCase()}`));
    console.log(chalk.cyan('-'.repeat(80)));
    
    // Key metrics
    console.log(chalk.white('📊 METRICS:'));
    console.log(`   • Similarity: ${chalk.yellow((group.similarity * 100).toFixed(1) + '%')}`);
    console.log(`   • Duplicates: ${chalk.yellow(group.snippets.length)}`);
    console.log(`   • Estimated Savings: ${chalk.green(firstSnippet.size * (group.snippets.length - 1) + ' characters')}`);
    
    // Files with duplicates
    console.log(chalk.white('\n📁 DUPLICATE LOCATIONS:'));
    group.snippets.forEach((snippet: any, snippetIndex: number) => {
      const relativePath = path.relative(process.cwd(), snippet.filePath);
      const isOriginal = snippetIndex === 0;
      const marker = isOriginal ? '🟢 ORIGINAL' : '🔴 DUPLICATE';
      
      if (isOriginal) {
        console.log(`   ${marker} ${chalk.green(relativePath)}:${chalk.cyan(snippet.startLine)}-${chalk.cyan(snippet.endLine)}`);
      } else {
        console.log(`   ${marker} ${chalk.red(relativePath)}:${chalk.cyan(snippet.startLine)}-${chalk.cyan(snippet.endLine)}`);
      }
    });
    
    // Component code preview
    console.log(chalk.white('\n💻 COMPONENT CODE PREVIEW:'));
    console.log(chalk.gray('+'.repeat(78)));
    
    // Show first few lines of the component
    const codeLines = firstSnippet.content.split('\n');
    const previewLines = codeLines.slice(0, 6);
    
    previewLines.forEach((line: string, lineIndex: number) => {
      const lineNumber = firstSnippet.startLine + lineIndex;
      const paddedLineNumber = lineNumber.toString().padStart(4);
      const truncatedLine = line.length > 70 ? line.substring(0, 67) + '...' : line;
      console.log(chalk.gray(`| ${paddedLineNumber} | ${chalk.white(truncatedLine.padEnd(70))} |`));
    });
    
    if (codeLines.length > 6) {
      const remainingLines = codeLines.length - 6;
      console.log(chalk.gray(`|     | ${chalk.yellow(`... (${remainingLines} more lines)`).padEnd(70)} |`));
    }
    
    console.log(chalk.gray('+'.repeat(78)));
    
    // Refactoring action
    console.log(chalk.white('\n🔄 REFACTORING ACTION:'));
    const componentName = generateComponentName(firstSnippet, index);
    console.log(`   • Extract to: ${chalk.cyan(group.suggestion.targetModule)}/${chalk.yellow(componentName)}.tsx`);
    console.log(`   • Replace ${chalk.yellow(group.snippets.length - 1)} duplicate instances`);
    
    console.log(chalk.blue('\n' + '='.repeat(80)));
  });
  
  // Final summary
  console.log(chalk.green('\n🎯 REFACTORING SUMMARY:'));
  console.log(chalk.green('='.repeat(80)));
  console.log(`Total duplicate groups to refactor: ${chalk.yellow(duplicates.length)}`);
  console.log(`Total estimated savings: ${chalk.yellow(summary.estimatedSavings)} characters`);
}
