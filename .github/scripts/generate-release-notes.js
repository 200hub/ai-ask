#!/usr/bin/env node

/**
 * Generate Release Notes (current version only, no file writes)
 *
 * - Parses commits since previous tag (or entire history if no previous tag)
 * - Groups by Conventional Commits types
 * - Outputs Markdown to GitHub Actions as `notes`
 */

import { execSync } from 'child_process';
import fs from 'fs';

function sh(cmd) {
  return execSync(cmd, { encoding: 'utf8' }).trim();
}

function trySh(cmd) {
  try { return sh(cmd); } catch { return null; }
}

function getCurrentRef() {
  // 1) In CI on tag push, GitHub provides GITHUB_REF_NAME (e.g., v1.2.3)
  if (process.env.GITHUB_REF_NAME) return process.env.GITHUB_REF_NAME;
  // 2) Try exact tag at HEAD
  const exact = trySh('git describe --tags --exact-match');
  return exact || 'HEAD';
}

function getPreviousTag(currentRef) {
  // If currentRef is a tag like v1.2.3, describe previous via ^
  if (currentRef && currentRef !== 'HEAD' && /^v?\d+\.\d+\.\d+/.test(currentRef)) {
    const prev = trySh(`git describe --tags --abbrev=0 ${currentRef}^`);
    if (prev) return prev;
  }
  // Fallback: previous tag before HEAD
  const prevHead = trySh('git describe --tags --abbrev=0 HEAD^');
  return prevHead; // may be null on first release
}

function getCommits(fromTag) {
  const range = fromTag ? `${fromTag}..HEAD` : 'HEAD';
  const log = trySh(`git log ${range} --pretty=format:"%H|%s|%an|%ae|%aI"`);
  if (!log) return [];
  return log.split('\n').filter(Boolean).map(line => {
    const [hash, subject, author, email, date] = line.split('|');
    return { hash, subject, author, email, date };
  });
}

function parseCommit(subject) {
  const m = subject.match(/^(\w+)(\(([^)]+)\))?(!)?:\s*(.+)$/);
  if (!m) return { type: 'other', scope: null, breaking: false, message: subject };
  const [, type, , scope, breaking, message] = m;
  return { type, scope: scope || null, breaking: !!breaking, message };
}

function categorize(commits) {
  const cat = {
    breaking: [],
    features: [],
    fixes: [],
    performance: [],
    refactor: [],
    docs: [],
    style: [],
    test: [],
    chore: [],
    others: [],
  };
  for (const c of commits) {
    const p = parseCommit(c.subject);
    const entry = { ...c, ...p };
    if (entry.breaking) { cat.breaking.push(entry); continue; }
    switch (entry.type) {
      case 'feat': cat.features.push(entry); break;
      case 'fix': cat.fixes.push(entry); break;
      case 'perf': cat.performance.push(entry); break;
      case 'refactor': cat.refactor.push(entry); break;
      case 'docs': cat.docs.push(entry); break;
      case 'style': cat.style.push(entry); break;
      case 'test': cat.test.push(entry); break;
      case 'chore': cat.chore.push(entry); break;
      default: cat.others.push(entry);
    }
  }
  return cat;
}

function section(title, items) {
  if (!items.length) return '';
  const lines = [`## ${title}`];
  for (const c of items) {
    const scope = c.scope ? `**${c.scope}**: ` : '';
    lines.push(`- ${scope}${c.message} ([${c.hash.slice(0,7)}](../../commit/${c.hash}))`);
  }
  lines.push('');
  return lines.join('\n');
}

function renderMarkdown(categories, headerTitle) {
  const lines = [];
  lines.push(`# ${headerTitle}`);
  lines.push('');
  lines.push(section('⚠️ Breaking Changes', categories.breaking));
  lines.push(section('✨ Features', categories.features));
  lines.push(section('🐛 Bug Fixes', categories.fixes));
  lines.push(section('⚡ Performance Improvements', categories.performance));
  lines.push(section('♻️ Code Refactoring', categories.refactor));
  lines.push(section('📝 Documentation', categories.docs));
  const othersCount = categories.style.length + categories.test.length + categories.chore.length + categories.others.length;
  if (othersCount) {
    const misc = [...categories.style, ...categories.test, ...categories.chore, ...categories.others];
    lines.push('## Misc');
    for (const c of misc) {
      lines.push(`- ${c.message} ([${c.hash.slice(0,7)}](../../commit/${c.hash}))`);
    }
    lines.push('');
  }
  return lines.filter(Boolean).join('\n');
}

function main() {
  console.log('🧾 Generating custom release notes (no file writes)...');
  const currentRef = getCurrentRef();
  const previousTag = getPreviousTag(currentRef);
  console.log(`Current ref: ${currentRef}`);
  console.log(`Previous tag: ${previousTag || '(none)'}`);

  const commits = getCommits(previousTag);
  if (!commits.length) {
    const fallback = '# Release Notes\n\nNo conventional commits found for this release.';
    if (process.env.GITHUB_OUTPUT) {
      fs.appendFileSync(process.env.GITHUB_OUTPUT, `notes<<EOF\n${fallback}\nEOF\n`);
    }
    console.log('No commits found in range; emitted fallback notes.');
    return;
  }

  const categories = categorize(commits);
  const header = currentRef === 'HEAD' ? 'Release Notes' : currentRef;
  const markdown = renderMarkdown(categories, header);

  if (process.env.GITHUB_OUTPUT) {
    fs.appendFileSync(process.env.GITHUB_OUTPUT, `notes<<EOF\n${markdown}\nEOF\n`);
  }
  console.log('✅ Release notes generated and set to GITHUB_OUTPUT as "notes"');
}

main();
