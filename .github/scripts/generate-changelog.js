#!/usr/bin/env node

/**
 * Changelog Generation Script
 * 
 * Generates structured changelog from git commits following Conventional Commits format
 * Parses commits between the previous tag and current tag (or HEAD)
 * Categorizes commits by type (feat, fix, perf, etc.) and generates Markdown output
 */

import { execSync } from 'child_process';
import fs from 'fs';

// Get the previous git tag
function getPreviousTag() {
  try {
    return execSync('git describe --tags --abbrev=0 HEAD^', { encoding: 'utf8' }).trim();
  } catch (e) {
    // No previous tag (first release)
    return null;
  }
}

// Get current tag or version
function getCurrentTag() {
  try {
    // Try GITHUB_REF_NAME first (in CI)
    if (process.env.GITHUB_REF_NAME) {
      return process.env.GITHUB_REF_NAME;
    }
    
    // Try current exact tag
    return execSync('git describe --tags --exact-match', { encoding: 'utf8' }).trim();
  } catch (e) {
    // Fallback to HEAD
    return 'HEAD';
  }
}

// Get commit messages in a range
function getCommits(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD';
  
  try {
    const output = execSync(
      `git log ${range} --pretty=format:"%H|%s|%an|%ae|%aI"`,
      { encoding: 'utf8' }
    );
    
    if (!output.trim()) {
      return [];
    }
    
    return output.trim().split('\n').map(line => {
      const [hash, subject, author, email, date] = line.split('|');
      return { hash, subject, author, email, date };
    });
  } catch (e) {
    console.error('Error getting commits:', e.message);
    return [];
  }
}

// Parse a commit message following Conventional Commits
function parseCommit(subject) {
  // Conventional Commits format: type(scope)!: description
  const match = subject.match(/^(\w+)(\(([^)]+)\))?(!)?:\s*(.+)$/);
  
  if (!match) {
    return {
      type: 'other',
      scope: null,
      breaking: false,
      message: subject
    };
  }
  
  const [, type, , scope, breaking, message] = match;
  
  return {
    type,
    scope: scope || null,
    breaking: !!breaking,
    message
  };
}

// Categorize commits by type
function categorizeCommits(commits) {
  const categories = {
    breaking: [],
    features: [],
    fixes: [],
    performance: [],
    refactor: [],
    docs: [],
    style: [],
    test: [],
    chore: [],
    others: []
  };
  
  commits.forEach(commit => {
    const parsed = parseCommit(commit.subject);
    const entry = { ...commit, ...parsed };
    
    if (parsed.breaking) {
      categories.breaking.push(entry);
    } else {
      switch (parsed.type) {
        case 'feat':
          categories.features.push(entry);
          break;
        case 'fix':
          categories.fixes.push(entry);
          break;
        case 'perf':
          categories.performance.push(entry);
          break;
        case 'refactor':
          categories.refactor.push(entry);
          break;
        case 'docs':
          categories.docs.push(entry);
          break;
        case 'style':
          categories.style.push(entry);
          break;
        case 'test':
          categories.test.push(entry);
          break;
        case 'chore':
          categories.chore.push(entry);
          break;
        default:
          categories.others.push(entry);
      }
    }
  });
  
  return categories;
}

// Generate Markdown changelog
function generateMarkdown(categories, version, previousTag) {
  const lines = [];
  
  // Header
  lines.push(`# ${version}\n`);
  lines.push(`**Release Date**: ${new Date().toISOString().split('T')[0]}\n`);
  
  // Breaking Changes (most important)
  if (categories.breaking.length > 0) {
    lines.push('## ⚠️ Breaking Changes\n');
    categories.breaking.forEach(c => {
      const scope = c.scope ? `**${c.scope}**: ` : '';
      lines.push(`- ${scope}${c.message} ([${c.hash.slice(0, 7)}](../../commit/${c.hash}))`);
    });
    lines.push('');
  }
  
  // Features
  if (categories.features.length > 0) {
    lines.push('## ✨ Features\n');
    categories.features.forEach(c => {
      const scope = c.scope ? `**${c.scope}**: ` : '';
      lines.push(`- ${scope}${c.message} ([${c.hash.slice(0, 7)}](../../commit/${c.hash}))`);
    });
    lines.push('');
  }
  
  // Bug Fixes
  if (categories.fixes.length > 0) {
    lines.push('## 🐛 Bug Fixes\n');
    categories.fixes.forEach(c => {
      const scope = c.scope ? `**${c.scope}**: ` : '';
      lines.push(`- ${scope}${c.message} ([${c.hash.slice(0, 7)}](../../commit/${c.hash}))`);
    });
    lines.push('');
  }
  
  // Performance Improvements
  if (categories.performance.length > 0) {
    lines.push('## ⚡ Performance Improvements\n');
    categories.performance.forEach(c => {
      const scope = c.scope ? `**${c.scope}**: ` : '';
      lines.push(`- ${scope}${c.message} ([${c.hash.slice(0, 7)}](../../commit/${c.hash}))`);
    });
    lines.push('');
  }
  
  // Refactoring
  if (categories.refactor.length > 0) {
    lines.push('## ♻️ Code Refactoring\n');
    categories.refactor.forEach(c => {
      const scope = c.scope ? `**${c.scope}**: ` : '';
      lines.push(`- ${scope}${c.message} ([${c.hash.slice(0, 7)}](../../commit/${c.hash}))`);
    });
    lines.push('');
  }
  
  // Documentation
  if (categories.docs.length > 0) {
    lines.push('## 📝 Documentation\n');
    categories.docs.forEach(c => {
      const scope = c.scope ? `**${c.scope}**: ` : '';
      lines.push(`- ${scope}${c.message} ([${c.hash.slice(0, 7)}](../../commit/${c.hash}))`);
    });
    lines.push('');
  }
  
  // Footer with comparison link
  if (previousTag) {
    const repoUrl = process.env.GITHUB_REPOSITORY 
      ? `https://github.com/${process.env.GITHUB_REPOSITORY}`
      : '';
    
    if (repoUrl) {
      lines.push('---\n');
      lines.push(`**Full Changelog**: [${previousTag}...${version}](${repoUrl}/compare/${previousTag}...${version})`);
    }
  }
  
  return lines.join('\n');
}

// Main function
function main() {
  console.log('🔍 Generating changelog...\n');
  
  const currentTag = getCurrentTag();
  const previousTag = getPreviousTag();
  
  console.log(`Current version: ${currentTag}`);
  console.log(`Previous version: ${previousTag || '(none - first release)'}\n`);
  
  const commits = getCommits(previousTag);
  
  if (commits.length === 0) {
    console.log('⚠️  No commits found in this range');
    
    const fallbackChangelog = `# ${currentTag}\n\nNo conventional commits found in this release.\n`;
    
    // Output for GitHub Actions
    if (process.env.GITHUB_OUTPUT) {
      const output = fallbackChangelog.replace(/\n/g, '%0A');
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `changelog=${output}\n`);
    }
    
    // Append to existing CHANGELOG.md or create new one
    let existingChangelog = '';
    if (fs.existsSync('CHANGELOG.md')) {
      existingChangelog = fs.readFileSync('CHANGELOG.md', 'utf8');
      
      // Check if this version already exists
      if (existingChangelog.includes(`# ${currentTag}\n`)) {
        console.log(`⚠️  Version ${currentTag} already exists in CHANGELOG.md`);
        console.log('Skipping changelog update to avoid duplicates\n');
        return;
      }
      
      console.log('📝 Appending to existing CHANGELOG.md\n');
    } else {
      console.log('📝 Creating new CHANGELOG.md\n');
    }
    
    // Prepend new changelog entry to existing content
    const fullChangelog = existingChangelog 
      ? `${fallbackChangelog}\n\n${existingChangelog}`
      : fallbackChangelog;
    
    fs.writeFileSync('CHANGELOG.md', fullChangelog);
    console.log('✅ Empty changelog generated\n');
    
    return;
  }
  
  console.log(`Found ${commits.length} commit(s)\n`);
  
  const categories = categorizeCommits(commits);
  const changelog = generateMarkdown(categories, currentTag, previousTag);
  
  // Summary
  console.log('📊 Changelog summary:');
  console.log(`  Breaking Changes: ${categories.breaking.length}`);
  console.log(`  Features: ${categories.features.length}`);
  console.log(`  Bug Fixes: ${categories.fixes.length}`);
  console.log(`  Performance: ${categories.performance.length}`);
  console.log(`  Refactoring: ${categories.refactor.length}`);
  console.log(`  Documentation: ${categories.docs.length}`);
  console.log(`  Other: ${categories.style.length + categories.test.length + categories.chore.length + categories.others.length}`);
  console.log('');
  
  // Output current version changelog for GitHub Actions
  if (process.env.GITHUB_OUTPUT) {
    // Escape special characters for GitHub Actions multiline output
    const escapedChangelog = changelog
      .replace(/%/g, '%25')
      .replace(/\n/g, '%0A')
      .replace(/\r/g, '%0D');
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `current_changelog<<EOF\n${changelog}\nEOF\n`);
    console.log('📄 Current version changelog saved to GITHUB_OUTPUT\n');
  }
  
  // Append to existing CHANGELOG.md or create new one
  let existingChangelog = '';
  if (fs.existsSync('CHANGELOG.md')) {
    existingChangelog = fs.readFileSync('CHANGELOG.md', 'utf8');
    
    // Check if this version already exists in the changelog
    if (existingChangelog.includes(`# ${currentTag}\n`)) {
      console.log(`⚠️  Version ${currentTag} already exists in CHANGELOG.md`);
      console.log('Skipping changelog update to avoid duplicates\n');
      return;
    }
    
    console.log('📝 Appending to existing CHANGELOG.md\n');
  } else {
    console.log('📝 Creating new CHANGELOG.md\n');
  }
  
  // Prepend new changelog entry to existing content
  const fullChangelog = existingChangelog 
    ? `${changelog}\n\n${existingChangelog}`
    : changelog;
  
  fs.writeFileSync('CHANGELOG.md', fullChangelog);
  
  console.log('✅ Changelog generated successfully!');
  console.log('📄 Output: CHANGELOG.md\n');
  
  // Print preview
  console.log('--- Preview ---');
  console.log(changelog.split('\n').slice(0, 20).join('\n'));
  if (changelog.split('\n').length > 20) {
    console.log('...\n(truncated)');
  }
  console.log('--- End Preview ---\n');
}

main();
