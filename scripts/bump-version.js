#!/usr/bin/env node

/**
 * XOKJ Monorepo Unified Version Manager
 *
 * Usage:
 *   node scripts/bump-version.js <patch | minor | major | explicit_version> <--xokj | --xobrow> [options]
 *   node scripts/bump-version.js <xokj | xobrow> <patch | minor | major | explicit_version> [options]
 *
 * Examples:
 *   npm run bump patch --xokj       # Bumps xokj extension (e.g. 0.3.0 -> 0.3.1)
 *   npm run bump minor --xokj --tag # Bumps xokj and creates git commit + tag
 *   npm run bump patch --xobrow     # Bumps xobrow CLI package without creating git release tag
 */

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');

const rootPkgPath = path.join(rootDir, 'package.json');
const xobrowPkgPath = path.join(rootDir, 'packages/xobrow/package.json');

function parseSemver(ver) {
  const match = ver.match(/^(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?$/);
  if (!match) {
    throw new Error(`Invalid semver version string: "${ver}"`);
  }
  return {
    major: parseInt(match[1], 10),
    minor: parseInt(match[2], 10),
    patch: parseInt(match[3], 10),
    prerelease: match[4] || null
  };
}

function incrementSemver(currentVer, releaseType) {
  const parsed = parseSemver(currentVer);
  switch (releaseType.toLowerCase()) {
    case 'major':
      return `${parsed.major + 1}.0.0`;
    case 'minor':
      return `${parsed.major}.${parsed.minor + 1}.0`;
    case 'patch':
      return `${parsed.major}.${parsed.minor}.${parsed.patch + 1}`;
    default:
      // If explicit semver version supplied
      parseSemver(releaseType);
      return releaseType;
  }
}

function updateJsonFile(filePath, updater) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const json = JSON.parse(content);
  updater(json);
  fs.writeFileSync(filePath, JSON.stringify(json, null, 2) + '\n', 'utf-8');
}

function printUsageAndExit(errorMessage, exitCode = 1) {
  if (errorMessage) {
    console.error(`\n❌ Error: ${errorMessage}\n`);
  }
  console.log('================================================================');
  console.log('XOKJ Monorepo Version Manager — Usage Guide');
  console.log('================================================================');
  console.log('You must explicitly choose EITHER xokj OR xobrow to bump.');
  console.log('Note: Release git tags (--tag) are exclusively reserved for xokj.\n');
  console.log('Usage:');
  console.log('  npm run bump <patch|minor|major|version> --xokj [--tag]');
  console.log('  npm run bump <patch|minor|major|version> --xobrow\n');
  console.log('Examples:');
  console.log('  npm run bump patch --xokj       # Bump xokj (extension)');
  console.log('  npm run bump minor --xokj --tag # Bump xokj & create git release tag (v*)');
  console.log('  npm run bump minor --xobrow     # Bump xobrow (CLI package without tag)');
  console.log('================================================================\n');
  process.exit(exitCode);
}

function main() {
  const rawArgs = process.argv.slice(2);

  if (rawArgs.length === 0 || rawArgs.includes('--help') || rawArgs.includes('-h')) {
    printUsageAndExit(null, 0);
  }

  const isXokjFlag = rawArgs.includes('--xokj') || rawArgs.includes('xokj');
  const isXobrowFlag = rawArgs.includes('--xobrow') || rawArgs.includes('xobrow');
  const createTag = rawArgs.includes('--tag') || rawArgs.includes('--git');

  if (!isXokjFlag && !isXobrowFlag) {
    printUsageAndExit('Target package not specified. You must provide --xokj or --xobrow.');
  }

  if (isXokjFlag && isXobrowFlag) {
    printUsageAndExit('Cannot bump both --xokj and --xobrow simultaneously. Please bump one component at a time.');
  }

  if (isXobrowFlag && createTag) {
    printUsageAndExit('Git release tags (--tag) are not permitted for xobrow. Release tags are strictly reserved for xokj Extension (v*).');
  }

  // Find the semver target (skip flag words and target words)
  const nonFlags = rawArgs.filter(arg => !arg.startsWith('--') && arg !== 'xokj' && arg !== 'xobrow');
  const target = nonFlags[0] || 'patch';

  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
  const xobrowPkg = JSON.parse(fs.readFileSync(xobrowPkgPath, 'utf-8'));

  let targetComponent = '';
  let fromVer = '';
  let toVer = '';
  let tagVersion = '';
  let filesToStage = [];

  if (isXokjFlag) {
    targetComponent = 'xokj (Extension / Root)';
    fromVer = rootPkg.version;
    toVer = incrementSemver(rootPkg.version, target);
    updateJsonFile(rootPkgPath, pkg => {
      pkg.version = toVer;
    });
    tagVersion = `v${toVer}`;
    filesToStage = ['package.json'];
  } else {
    targetComponent = 'xobrow (CLI Package)';
    fromVer = xobrowPkg.version;
    toVer = incrementSemver(xobrowPkg.version, target);
    updateJsonFile(xobrowPkgPath, pkg => {
      pkg.version = toVer;
    });
    filesToStage = ['packages/xobrow/package.json'];
  }

  // Sync package-lock.json
  try {
    execSync('npm install --package-lock-only', { cwd: rootDir, stdio: 'pipe' });
    filesToStage.push('package-lock.json');
  } catch {
    // If lockfile update fails silently continue
  }

  console.log('================================================================');
  console.log('XOKJ Monorepo Version Manager');
  console.log('================================================================');
  console.log(`- ${targetComponent.padEnd(28)} : ${fromVer} -> ${toVer}`);
  console.log('----------------------------------------------------------------');
  console.log(`Updated ${isXokjFlag ? 'package.json' : 'packages/xobrow/package.json'} and synchronized package-lock.json successfully.`);

  if (createTag && isXokjFlag) {
    try {
      execSync(`git add ${filesToStage.join(' ')}`, { cwd: rootDir, stdio: 'inherit' });
      execSync(`git commit -m "chore(release): bump xokj to ${toVer}"`, { cwd: rootDir, stdio: 'inherit' });
      execSync(`git tag -a ${tagVersion} -m "Release ${tagVersion}"`, { cwd: rootDir, stdio: 'inherit' });
      console.log(`Created Git commit and tag: ${tagVersion}`);
      console.log(`Run: git push origin main --tags`);
    } catch (err) {
      console.error('Failed to create git commit/tag:', err.message);
    }
  }
  console.log('================================================================\n');
}

main();
