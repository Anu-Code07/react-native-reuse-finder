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
  .option('-o, --output <format>', 'Output format (json, table, summary)', 'table')
  .option('-f, --file <file>', 'Analyze specific file only')
  .option('-d, --directory <dir>', 'Analyze specific directory only')
  .action(async (projectPath, options) => {
    try {
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
        enableAutoFix: options.autoFix !== false
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
        });
        
        const content = await import('fs').then(fs => fs.readFileSync(filePath, 'utf-8'));
        const snippets = parser.parseFile(filePath, content);
        
        // Create similarity detector to find duplicates
        const { SimilarityDetector } = await import('./similarity/similarity-detector');
        const similarityDetector = new SimilarityDetector(7, analysisOptions.minSimilarity);
        const duplicates = similarityDetector.findDuplicates(snippets);
        
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
          suggestions
        };
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
      outputResults(result, options.output);

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

function outputResults(result: any, format: string) {
  console.log('');
  
  switch (format.toLowerCase()) {
    case 'json':
      console.log(JSON.stringify(result, null, 2));
      break;
      
    case 'summary':
      outputSummary(result);
      break;
      
    case 'table':
    default:
      outputTable(result);
      break;
  }
}

function outputSummary(result: any) {
  const { summary, duplicates } = result;
  
  console.log(chalk.green('📊 Analysis Summary'));
  console.log('='.repeat(50));
  console.log(`Total Files Analyzed: ${summary.totalFiles}`);
  console.log(`Total Snippets Found: ${summary.totalSnippets}`);
  console.log(`Duplicate Groups: ${summary.duplicateGroups}`);
  console.log(`Estimated Savings: ${summary.estimatedSavings} characters`);
  console.log('');
  
  if (duplicates.length > 0) {
    console.log(chalk.yellow('🚨 Top Duplication Issues:'));
    duplicates.slice(0, 5).forEach((group: any, index: number) => {
      const firstSnippet = group.snippets[0];
      console.log(`${index + 1}. ${firstSnippet.type} (${group.snippets.length} duplicates)`);
      console.log(`   Similarity: ${(group.similarity * 100).toFixed(1)}%`);
      console.log(`   Reuse Score: ${group.reuseScore.toFixed(0)}`);
      console.log(`   Suggestion: ${group.suggestion.description}`);
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
  
  console.log(chalk.blue('📋 Detailed Duplicate Groups'));
  console.log('='.repeat(80));
  
  duplicates.forEach((group: any, index: number) => {
    const firstSnippet = group.snippets[0];
    
    console.log(chalk.cyan(`\nGroup ${index + 1}: ${firstSnippet.type.toUpperCase()}`));
    console.log('-'.repeat(40));
    console.log(`Similarity: ${(group.similarity * 100).toFixed(1)}%`);
    console.log(`Reuse Score: ${group.reuseScore.toFixed(0)}`);
    console.log(`Duplicates: ${group.snippets.length}`);
    console.log(`Suggestion: ${group.suggestion.description}`);
    console.log(`Effort: ${group.suggestion.estimatedEffort}`);
    console.log(`Target Module: ${group.suggestion.targetModule}`);
    
    console.log('\nFiles:');
    group.snippets.forEach((snippet: any) => {
      const relativePath = path.relative(process.cwd(), snippet.filePath);
      console.log(`  - ${relativePath}:${snippet.startLine}-${snippet.endLine} (${snippet.size} chars)`);
    });
    
    if (group.suggestion.benefits.length > 0) {
      console.log('\nBenefits:');
      group.suggestion.benefits.forEach((benefit: string) => {
        console.log(`  • ${benefit}`);
      });
    }
  });
}
