import { simpleGit, SimpleGit } from 'simple-git';
import { CodeSnippet } from '../types';
import * as path from 'path';

export class ChurnAnalyzer {
  private git: SimpleGit;
  private projectRoot: string;

  constructor(projectRoot: string) {
    this.projectRoot = projectRoot;
    this.git = simpleGit(projectRoot);
  }

  async analyzeChurn(snippets: CodeSnippet[]): Promise<CodeSnippet[]> {
    try {
      // Check if this is a git repository
      const isRepo = await this.git.checkIsRepo();
      if (!isRepo) {
        console.warn('Not a git repository, skipping churn analysis');
        return snippets.map(snippet => ({ ...snippet, churnWeight: 1.0 }));
      }

      // Get git log for the project
      const log = await this.git.log({ maxCount: 1000 });
      
      // Analyze churn for each snippet
      const updatedSnippets = await Promise.all(
        snippets.map(snippet => this.calculateChurnWeight(snippet, log))
      );

      return updatedSnippets;
    } catch (error) {
      console.warn('Failed to analyze churn:', error);
      return snippets.map(snippet => ({ ...snippet, churnWeight: 1.0 }));
    }
  }

  private async calculateChurnWeight(snippet: CodeSnippet, log: any): Promise<CodeSnippet> {
    try {
      const filePath = snippet.filePath;
      const relativePath = path.relative(this.projectRoot, filePath);
      
      // Get file-specific git log
      const fileLog = await this.git.log({
        file: relativePath,
        maxCount: 100
      });

      // Calculate churn metrics
      const churnMetrics = this.calculateChurnMetrics(fileLog, snippet);
      
      // Normalize churn weight (0.5 to 2.0 range)
      const churnWeight = this.normalizeChurnWeight(churnMetrics);

      return {
        ...snippet,
        churnWeight
      };
    } catch (error) {
      console.warn(`Failed to calculate churn for ${snippet.filePath}:`, error);
      return { ...snippet, churnWeight: 1.0 };
    }
  }

  private calculateChurnMetrics(fileLog: any, snippet: CodeSnippet): {
    commitCount: number;
    recentCommits: number;
    authorDiversity: number;
    timeSpan: number;
  } {
    const commits = fileLog.all || [];
    
    // Total commit count
    const commitCount = commits.length;
    
    // Recent commits (last 30 days)
    const thirtyDaysAgo = new Date();
    thirtyDaysAgo.setDate(thirtyDaysAgo.getDate() - 30);
    const recentCommits = commits.filter((commit: any) => 
      new Date(commit.date) > thirtyDaysAgo
    ).length;
    
    // Author diversity
    const authors = new Set(commits.map((commit: any) => commit.author_name));
    const authorDiversity = authors.size;
    
    // Time span of changes
    let timeSpan = 0;
    if (commits.length > 1) {
      const firstCommit = new Date(commits[commits.length - 1].date);
      const lastCommit = new Date(commits[0].date);
      timeSpan = (lastCommit.getTime() - firstCommit.getTime()) / (1000 * 60 * 60 * 24); // days
    }

    return {
      commitCount,
      recentCommits,
      authorDiversity,
      timeSpan
    };
  }

  private normalizeChurnWeight(metrics: {
    commitCount: number;
    recentCommits: number;
    authorDiversity: number;
    timeSpan: number;
  }): number {
    // Base weight
    let weight = 1.0;
    
    // Adjust based on commit frequency
    if (metrics.commitCount > 20) weight += 0.3;
    else if (metrics.commitCount > 10) weight += 0.2;
    else if (metrics.commitCount > 5) weight += 0.1;
    
    // Adjust based on recent activity
    if (metrics.recentCommits > 5) weight += 0.4;
    else if (metrics.recentCommits > 2) weight += 0.2;
    
    // Adjust based on author diversity (multiple developers = higher churn)
    if (metrics.authorDiversity > 3) weight += 0.2;
    else if (metrics.authorDiversity > 1) weight += 0.1;
    
    // Adjust based on time span (longer history = more stable)
    if (metrics.timeSpan > 365) weight -= 0.1;
    else if (metrics.timeSpan < 30) weight += 0.2;
    
    // Clamp to reasonable range
    return Math.max(0.5, Math.min(2.0, weight));
  }

  async getFileChurnSummary(filePath: string): Promise<{
    totalCommits: number;
    lastModified: Date | null;
    authors: string[];
    churnScore: number;
  }> {
    try {
      const relativePath = path.relative(this.projectRoot, filePath);
      const fileLog = await this.git.log({
        file: relativePath,
        maxCount: 100
      });

      const commits = fileLog.all || [];
      const authors = [...new Set(commits.map((commit: any) => commit.author_name))];
      const lastModified = commits.length > 0 ? new Date(commits[0].date) : null;
      
      const churnScore = this.calculateChurnScore(Array.from(commits));

      return {
        totalCommits: commits.length,
        lastModified,
        authors,
        churnScore
      };
    } catch (error) {
      console.warn(`Failed to get churn summary for ${filePath}:`, error);
      return {
        totalCommits: 0,
        lastModified: null,
        authors: [],
        churnScore: 0
      };
    }
  }

  private calculateChurnScore(commits: any[]): number {
    if (commits.length === 0) return 0;
    
    let score = 0;
    const now = new Date();
    
    // Weight commits by recency
    commits.forEach((commit: any, index: number) => {
      const commitDate = new Date(commit.date);
      const daysAgo = (now.getTime() - commitDate.getTime()) / (1000 * 60 * 60 * 24);
      
      // Exponential decay: more recent commits have higher weight
      const recencyWeight = Math.exp(-daysAgo / 30); // 30-day half-life
      score += recencyWeight;
    });
    
    return score;
  }
}
