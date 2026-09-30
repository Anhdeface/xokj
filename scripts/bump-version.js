#!/usr/bin/env node

/**
 * XOKJ Monorepo Unified Version Manager
 *
 * Usage:
 *   node scripts/bump-version.js [patch | minor | major | <explicit_version>] [options]
 *
 * Examples:
 *   npm run bump patch          # Bumps 0.2.0 -> 0.2.1 across monorepo
 *   npm run bump minor          # Bumps 0.2.0 -> 0.3.0 across monorepo
 *   npm run bump 1.0.0          # Sets version to 1.0.0
 *   npm run bump patch --xobrow # Bumps only packages/xobrow
 *   npm run bump patch --xokj   # Bumps only xokj extension
 *   npm run bump minor --tag    # Bumps and creates git commit + tag
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

function main() {
  const args = process.argv.slice(2);
  const target = args.find(arg => !arg.startsWith('--')) || 'patch';
  const onlyXobrow = args.includes('--xobrow');
  const onlyXokj = args.includes('--xokj');
  const createTag = args.includes('--tag') || args.includes('--git');

  const rootPkg = JSON.parse(fs.readFileSync(rootPkgPath, 'utf-8'));
  const xobrowPkg = JSON.parse(fs.readFileSync(xobrowPkgPath, 'utf-8'));

  const changes = [];

  let newRootVer = rootPkg.version;
  let newXobrowVer = xobrowPkg.version;

  if (!onlyXobrow) {
    newRootVer = incrementSemver(rootPkg.version, target);
    updateJsonFile(rootPkgPath, pkg => {
      pkg.version = newRootVer;
    });
    changes.push({ component: 'xokj (Extension / Root)', from: rootPkg.version, to: newRootVer });
  }

  if (!onlyXokj) {
    newXobrowVer = incrementSemver(xobrowPkg.version, target);
    updateJsonFile(xobrowPkgPath, pkg => {
      pkg.version = newXobrowVer;
    });
    changes.push({ component: 'xobrow (CLI Package)', from: xobrowPkg.version, to: newXobrowVer });
  }

  console.log('================================================================');
  console.log('XOKJ Monorepo Version Manager');
  console.log('================================================================');
  for (const c of changes) {
    console.log(`- ${c.component.padEnd(28)} : ${c.from} -> ${c.to}`);
  }
  console.log('----------------------------------------------------------------');
  console.log('Updated package.json files successfully.');

  if (createTag) {
    try {
      const tagVersion = `v${newRootVer}`;
      execSync(`git add package.json packages/xobrow/package.json`, { cwd: rootDir, stdio: 'inherit' });
      execSync(`git commit -m "chore(release): bump version to ${newRootVer}"`, { cwd: rootDir, stdio: 'inherit' });
      execSync(`git tag ${tagVersion}`, { cwd: rootDir, stdio: 'inherit' });
      console.log(`Created Git commit and tag: ${tagVersion}`);
      console.log(`Run: git push origin main --tags`);
    } catch (err) {
      console.error('Failed to create git commit/tag:', err.message);
    }
  }
  console.log('================================================================\n');
}

main();
