# React Native Reuse Finder

🔍 **Detect reusable/duplicate React Native code (components, hooks, styles, utils) and suggest refactors. Ships as a CLI + Node API.**

[![npm version](https://badge.fury.io/js/react-native-reuse-finder.svg)](https://badge.fury.io/js/react-native-reuse-finder)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

## 🎯 Goals

- **Find Type-1/2/3 clones** (exact/renamed/near-miss) across RN projects
- **Rank by reuse value** (duplication × churn × size)
- **Output actionable suggestions** + extractable snippet templates
- **Autofix (optional)**: create shared module + codemod imports

## 🚀 Features

### Detection Strategy
- **Parse → AST** with Babel (@babel/parser) supporting TS + JSX
- **Normalize**: remove whitespace/comments, canonicalize identifiers, style object key order
- **Shingles & Hashing**: Token shingles (k=7–11), rolling hash (Rabin–Karp)
- **SimHash** for near-duplicate fingerprint per function/file
- **Optional MinHash + LSH** for scalable similarity

### Granularity
- Functions, custom hooks, components
- StyleSheet blocks
- Utility modules
- RN‑specific heuristics:
  - Group StyleSheet.create objects
  - Detect repeated navigation patterns (React Navigation)
  - Repeated API clients (fetch/axios wrappers)
  - Reused animations (reanimated/moti sequences)

### Scoring
- **score = size × similarity × duplication_count × churn_weight**
- **churn_weight** from git log (files edited often ⇒ higher benefit)

## 📦 Installation

```bash
npm install react-native-reuse-finder
# or
yarn add react-native-reuse-finder
```

## 🛠️ Usage

### CLI Usage

```bash
# Analyze current directory
npx rn-reuse-finder analyze

# Analyze specific project
npx rn-reuse-finder analyze /path/to/project

# Analyze with custom options
npx rn-reuse-finder analyze --types component,hook --similarity 0.9 --min-size 200

# Output as JSON
npx rn-reuse-finder analyze --output json

# Analyze specific file
npx rn-reuse-finder analyze --file src/components/Button.tsx

# Show configuration
npx rn-reuse-finder config
```

### CLI Options

| Option | Description | Default |
|--------|-------------|---------|
| `--types` | Comma-separated snippet types | `component,hook,stylesheet,utility` |
| `--similarity` | Minimum similarity threshold (0.0-1.0) | `0.8` |
| `--min-size` | Minimum snippet size in characters | `100` |
| `--max-results` | Maximum duplicate groups to return | `50` |
| `--no-churn` | Disable churn analysis | `false` |
| `--no-auto-fix` | Disable auto-fix suggestions | `false` |
| `--output` | Output format (json, table, summary) | `table` |
| `--file` | Analyze specific file only | - |
| `--directory` | Analyze specific directory only | - |

### Programmatic Usage

```typescript
import { ReuseAnalyzer, SnippetType } from 'react-native-reuse-finder';

// Create analyzer
const analyzer = new ReuseAnalyzer('./my-project', {
  includeTypes: [SnippetType.COMPONENT, SnippetType.HOOK],
  minSimilarity: 0.8,
  minSize: 100,
  maxResults: 50,
  enableChurnWeighting: true,
  enableAutoFix: true
});

// Analyze entire project
const result = await analyzer.analyzeProject();
console.log(`Found ${result.duplicates.length} duplicate groups`);

// Analyze specific file
const snippets = await analyzer.analyzeSpecificFile('./src/components/Button.tsx');

// Analyze specific directory
const snippets = await analyzer.analyzeDirectory('./src/components');
```

### Quick Analysis Functions

```typescript
import { analyzeProject, analyzeFile, analyzeDirectory } from 'react-native-reuse-finder';

// Quick project analysis
const result = await analyzeProject('./my-project', {
  includeTypes: ['component', 'hook'],
  minSimilarity: 0.9
});

// Quick file analysis
const snippets = await analyzeFile('./src/components/Button.tsx', {
  includeTypes: ['component']
});

// Quick directory analysis
const snippets = await analyzeDirectory('./src/components', {
  includeTypes: ['component', 'stylesheet']
});
```

## 📊 Output Format

### Analysis Result

```typescript
interface AnalysisResult {
  duplicates: DuplicateGroup[];
  summary: {
    totalFiles: number;
    totalSnippets: number;
    duplicateGroups: number;
    estimatedSavings: number;
  };
  suggestions: RefactorSuggestion[];
}
```

### Duplicate Group

```typescript
interface DuplicateGroup {
  id: string;
  snippets: CodeSnippet[];
  similarity: number;
  reuseScore: number;
  suggestion: RefactorSuggestion;
}
```

### Refactor Suggestion

```typescript
interface RefactorSuggestion {
  type: 'extract' | 'consolidate' | 'parameterize';
  description: string;
  targetModule: string;
  codeTemplate: string;
  estimatedEffort: 'low' | 'medium' | 'high';
  benefits: string[];
}
```

## 🔧 Configuration

### Supported Snippet Types

- `component` - React components (JSX returning functions)
- `hook` - Custom React hooks (use* functions)
- `stylesheet` - StyleSheet.create objects
- `utility` - Utility functions
- `animation` - Animation functions
- `navigation` - Navigation-related code
- `api_client` - API client functions
- `function` - General functions

### Analysis Options

```typescript
interface AnalysisOptions {
  includeTypes: SnippetType[];
  minSimilarity: number;        // 0.0 to 1.0
  minSize: number;              // Minimum characters
  maxResults: number;           // Maximum duplicate groups
  enableChurnWeighting: boolean; // Use git history for scoring
  enableAutoFix: boolean;       // Generate auto-fix suggestions
}
```

## 🧪 Examples

### Example 1: Component Duplication

```typescript
// Found duplicate components with 95% similarity
const result = await analyzeProject('./my-app', {
  includeTypes: ['component'],
  minSimilarity: 0.9
});

result.duplicates.forEach(group => {
  console.log(`Component: ${group.snippets[0].type}`);
  console.log(`Similarity: ${(group.similarity * 100).toFixed(1)}%`);
  console.log(`Duplicates: ${group.snippets.length}`);
  console.log(`Suggestion: ${group.suggestion.description}`);
});
```

### Example 2: Hook Analysis

```typescript
// Analyze custom hooks for duplication
const hooks = await analyzeFile('./src/hooks/useForm.ts', {
  includeTypes: ['hook']
});

hooks.forEach(hook => {
  console.log(`Hook: ${hook.id}`);
  console.log(`Size: ${hook.size} characters`);
  console.log(`Churn Weight: ${hook.churnWeight}`);
});
```

### Example 3: StyleSheet Analysis

```typescript
// Find duplicate styles
const styles = await analyzeDirectory('./src/styles', {
  includeTypes: ['stylesheet'],
  minSimilarity: 0.8
});

styles.forEach(style => {
  console.log(`Style: ${style.id}`);
  console.log(`Content: ${style.content.substring(0, 100)}...`);
});
```

## 🚀 Advanced Features

### Churn Analysis

The tool analyzes git history to determine which files change frequently:

```typescript
// Enable churn analysis for better scoring
const analyzer = new ReuseAnalyzer('./my-project', {
  enableChurnWeighting: true
});

// Files with high churn get higher reuse scores
const result = await analyzer.analyzeProject();
```

### Custom Parser Options

```typescript
// Configure parser for specific needs
analyzer.setParserOptions({
  includeJSX: true,
  includeTypeScript: true,
  includeFlow: false,
  sourceType: 'module'
});
```

### Output Formats

```typescript
// JSON output for programmatic processing
const result = await analyzer.analyzeProject();
const jsonOutput = JSON.stringify(result, null, 2);

// Summary output for quick overview
const summary = result.summary;
console.log(`Files: ${summary.totalFiles}, Snippets: ${summary.totalSnippets}`);
```

## 🤝 Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/amazing-feature`
3. Commit your changes: `git commit -m 'Add amazing feature'`
4. Push to the branch: `git push origin feature/amazing-feature`
5. Open a Pull Request

### Development Setup

```bash
git clone https://github.com/yourusername/react-native-reuse-finder.git
cd react-native-reuse-finder
npm install
npm run build
npm test
```
---

Made with ❤️ by Anurag for the React Native community
