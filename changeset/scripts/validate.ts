#!/usr/bin/env node

import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';

import { findMonorepoRoot } from './lib/runtime';

const { values: args } = parseArgs({
  options: {
    help: { type: 'boolean', default: false },
    quiet: { type: 'boolean', default: false },
  },
  allowPositionals: true,
});

function printHelp(): void {
  console.log(`
Usage: validate-changeset [options]

Validates that a changeset file exists in the .changeset directory.
Exits with code 0 if valid, 1 if no changeset found.

Options:
  --quiet    Suppress output
  --help     Show this help
  `);
}

interface ValidationResult {
  valid: boolean;
  changesetFiles: string[];
  isEmpty: boolean;
  message: string;
}

function validate(cwd: string): ValidationResult {
  const changesetDir = join(cwd, '.changeset');

  if (!existsSync(changesetDir)) {
    return {
      valid: false,
      changesetFiles: [],
      isEmpty: false,
      message: 'No .changeset directory found',
    };
  }

  // Find all .md files except README.md and config files
  const files = readdirSync(changesetDir).filter(
    (f) =>
      f.endsWith('.md') &&
      f !== 'README.md' &&
      !f.startsWith('.')
  );

  if (files.length === 0) {
    return {
      valid: false,
      changesetFiles: [],
      isEmpty: false,
      message: 'No changeset files found',
    };
  }

  // Check if all changesets are empty (internal changes only)
  let allEmpty = true;
  for (const file of files) {
    const content = readFileSync(join(changesetDir, file), 'utf-8');
    // Check if frontmatter has any package bumps
    const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---/);
    if (frontmatterMatch) {
      const frontmatter = frontmatterMatch[1].trim();
      if (frontmatter.length > 0) {
        allEmpty = false;
        break;
      }
    }
  }

  return {
    valid: true,
    changesetFiles: files,
    isEmpty: allEmpty,
    message: allEmpty
      ? `Found ${files.length} changeset(s) (empty - internal changes only)`
      : `Found ${files.length} changeset(s)`,
  };
}

function main(): void {
  if (args.help) {
    printHelp();
    process.exit(0);
  }

  const cwd = findMonorepoRoot(process.cwd()) || process.cwd();
  const result = validate(cwd);

  if (!args.quiet) {
    if (result.valid) {
      console.log(`✓ ${result.message}`);
      for (const file of result.changesetFiles) {
        console.log(`  - ${file}`);
      }
    } else {
      console.error(`✗ ${result.message}`);
      console.error('');
      console.error('To create a changeset, run:');
      console.error('  pnpm changeset:create');
      console.error('');
      console.error('For internal changes only:');
      console.error('  pnpm changeset --empty');
    }
  }

  process.exit(result.valid ? 0 : 1);
}

main();
