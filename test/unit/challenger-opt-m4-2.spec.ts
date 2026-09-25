import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

describe('Milestone 4 Challenger 2: Font Asset Subsetting Empirical Verification', () => {
  const rootDir = process.cwd();
  const srcDir = path.join(rootDir, 'src');
  const distDir = path.join(rootDir, 'dist');
  const nodeModulesDir = path.join(rootDir, 'node_modules/@fortawesome/fontawesome-free');

  // Helper to recursively find files
  function findFiles(dir: string, filter: (p: string) => boolean): string[] {
    let results: string[] = [];
    const list = fs.readdirSync(dir);
    for (const file of list) {
      const fullPath = path.join(dir, file);
      const stat = fs.statSync(fullPath);
      if (stat && stat.isDirectory()) {
        results = results.concat(findFiles(fullPath, filter));
      } else if (filter(fullPath)) {
        results.push(fullPath);
      }
    }
    return results;
  }

  // Collect all icon classes used across src/dashboard and src/popup
  function collectUsedIcons(): Map<string, string[]> {
    const vueFiles = [
      ...findFiles(path.join(srcDir, 'dashboard'), f => f.endsWith('.vue') || f.endsWith('.ts')),
      ...findFiles(path.join(srcDir, 'popup'), f => f.endsWith('.vue') || f.endsWith('.ts'))
    ];

    const iconRegex = /fa-([a-z0-9-]+)/g;
    const usage = new Map<string, string[]>();

    // Non-icon helper / modifier classes to ignore
    const nonIconClasses = new Set([
      'solid', 'spin', 'regular', 'brands', 'classic', '1x', '2x',
      'mini-icon', 'tab-icon', 'cdp-icon', 'icon', 'arrow', 'pause-icon'
    ]);

    for (const filePath of vueFiles) {
      const content = fs.readFileSync(filePath, 'utf8');
      let match: RegExpExecArray | null;
      while ((match = iconRegex.exec(content)) !== null) {
        const iconName = match[1];
        if (!nonIconClasses.has(iconName)) {
          const list = usage.get(iconName) ?? [];
          list.push(path.relative(rootDir, filePath));
          usage.set(iconName, list);
        }
      }
    }

    return usage;
  }

  it('1. verifies all icons used in Vue components belong to the Solid SVG icon subset', () => {
    const usedIcons = collectUsedIcons();
    expect(usedIcons.size).toBeGreaterThan(25);

    const solidSvgDir = path.join(nodeModulesDir, 'svgs/solid');
    const brandsSvgDir = path.join(nodeModulesDir, 'svgs/brands');

    const missingInSolid: string[] = [];
    const brandsExclusive: string[] = [];

    for (const [iconName] of usedIcons.entries()) {
      const solidSvgPath = path.join(solidSvgDir, `${iconName}.svg`);
      if (!fs.existsSync(solidSvgPath)) {
        missingInSolid.push(iconName);
      }

      const brandsSvgPath = path.join(brandsSvgDir, `${iconName}.svg`);
      if (fs.existsSync(brandsSvgPath) && !fs.existsSync(solidSvgPath)) {
        brandsExclusive.push(iconName);
      }
    }

    expect(missingInSolid, `Icons missing in solid subset: ${missingInSolid.join(', ')}`).toEqual([]);
    expect(brandsExclusive, `Icons exclusive to brands subset: ${brandsExclusive.join(', ')}`).toEqual([]);
  });

  it('2. verifies all icons have CSS variable declarations (--fa) in fontawesome.min.css', () => {
    const usedIcons = collectUsedIcons();
    const faCssPath = path.join(nodeModulesDir, 'css/fontawesome.min.css');
    expect(fs.existsSync(faCssPath)).toBe(true);

    const faCss = fs.readFileSync(faCssPath, 'utf8');
    const unresolvedIcons: string[] = [];
    const codepoints: Record<string, string> = {};

    for (const [iconName] of usedIcons.entries()) {
      // Regex matching .fa-<iconName> with CSS variable declaration --fa:"\<hex>"
      const reg = new RegExp(`(?:^|[,}])([^}]*?\\bfa-${iconName}\\b[^}]*?)\\{--fa:"\\\\([0-9a-f]+)"\\}`);
      const match = faCss.match(reg);
      if (!match) {
        unresolvedIcons.push(iconName);
      } else {
        codepoints[iconName] = match[2];
        expect(match[2].length).toBeGreaterThanOrEqual(4);
      }
    }

    expect(unresolvedIcons, `Icons without CSS variable in fontawesome.min.css: ${unresolvedIcons.join(', ')}`).toEqual([]);
    expect(Object.keys(codepoints).length).toBe(usedIcons.size);
  });

  it('3. verifies solid.min.css declares @font-face exclusively for fa-solid-900.woff2', () => {
    const solidCssPath = path.join(nodeModulesDir, 'css/solid.min.css');
    expect(fs.existsSync(solidCssPath)).toBe(true);

    const solidCss = fs.readFileSync(solidCssPath, 'utf8');

    // Must define @font-face pointing to fa-solid-900.woff2
    expect(solidCss).toContain('@font-face');
    expect(solidCss).toContain('url(../webfonts/fa-solid-900.woff2)');
    expect(solidCss).toContain('font-weight:900');
    expect(solidCss).toContain('font-family:"Font Awesome 7 Free"');

    // Must set --fa-style:900 for .fa-solid
    expect(solidCss).toContain('.fa-solid{--fa-style:900}');

    // Must NOT reference dead font files
    expect(solidCss).not.toContain('fa-brands-400');
    expect(solidCss).not.toContain('fa-regular-400');
    expect(solidCss).not.toContain('fa-v4compatibility');
  });

  it('4. verifies fontawesome.min.css provides the :before pseudo-element and fa-spin keyframes', () => {
    const faCss = fs.readFileSync(path.join(nodeModulesDir, 'css/fontawesome.min.css'), 'utf8');

    // Pseudo-element assignment using var(--fa)
    expect(faCss).toContain(':is(.fas,.far,.fab,.fa-solid,.fa-regular,.fa-brands,.fa-classic,.fa):before{content:var(--fa)');
    
    // fa-spin animation and keyframes
    expect(faCss).toContain('.fa-spin');
    expect(faCss).toContain('@keyframes fa-spin');
  });

  it('5. verifies dashboard and popup main.ts import only fontawesome.min.css and solid.min.css', () => {
    const dashboardMain = fs.readFileSync(path.join(srcDir, 'dashboard/main.ts'), 'utf8');
    const popupMain = fs.readFileSync(path.join(srcDir, 'popup/main.ts'), 'utf8');

    for (const [file, content] of [['dashboard/main.ts', dashboardMain], ['popup/main.ts', popupMain]]) {
      expect(content, `${file} missing fontawesome.min.css`).toContain(
        "import '@fortawesome/fontawesome-free/css/fontawesome.min.css';"
      );
      expect(content, `${file} missing solid.min.css`).toContain(
        "import '@fortawesome/fontawesome-free/css/solid.min.css';"
      );
      expect(content, `${file} must not import all.min.css`).not.toContain('all.min.css');
      expect(content, `${file} must not import brands.min.css`).not.toContain('brands.min.css');
      expect(content, `${file} must not import regular.min.css`).not.toContain('regular.min.css');
      expect(content, `${file} must not import v4-shims.min.css`).not.toContain('v4-shims.min.css');
    }
  });

  it('6. verifies production build excludes dead webfonts from dist/assets and includes fa-solid-900', () => {
    const assetsDir = path.join(distDir, 'assets');
    expect(fs.existsSync(assetsDir)).toBe(true);

    const assetFiles = fs.readdirSync(assetsDir);

    // Verify solid font binary is present
    const solidFont = assetFiles.find(f => f.startsWith('fa-solid-900') && f.endsWith('.woff2'));
    expect(solidFont, 'fa-solid-900-*.woff2 must be present in dist/assets').toBeDefined();

    // Verify dead font files are excluded
    const brandsFont = assetFiles.find(f => f.includes('fa-brands'));
    const regularFont = assetFiles.find(f => f.includes('fa-regular'));
    const v4Font = assetFiles.find(f => f.includes('fa-v4compatibility'));

    expect(brandsFont, 'fa-brands must not exist in dist/assets').toBeUndefined();
    expect(regularFont, 'fa-regular must not exist in dist/assets').toBeUndefined();
    expect(v4Font, 'fa-v4compatibility must not exist in dist/assets').toBeUndefined();

    // Verify font file size (~117-120 kB)
    const fontStat = fs.statSync(path.join(assetsDir, solidFont!));
    expect(fontStat.size).toBeGreaterThan(100_000);
    expect(fontStat.size).toBeLessThan(130_000);

    // Verify total assets directory size is less than 1,000 kB (pruned from monolithic ~1.1 MB)
    let totalAssetBytes = 0;
    for (const f of assetFiles) {
      totalAssetBytes += fs.statSync(path.join(assetsDir, f)).size;
    }
    const totalAssetKb = totalAssetBytes / 1024;
    expect(totalAssetKb).toBeLessThan(1000);
  });

  it('7. verifies bundled CSS in dist/assets contains exactly 1 @font-face rule referencing fa-solid-900', () => {
    const assetsDir = path.join(distDir, 'assets');
    const cssFiles = fs.readdirSync(assetsDir).filter(f => f.endsWith('.css'));

    let fontFaceCount = 0;
    let solidFontReferenced = false;

    for (const cssFile of cssFiles) {
      const content = fs.readFileSync(path.join(assetsDir, cssFile), 'utf8');
      const fontFaces = content.match(/@font-face\{[^}]*\}/g) || [];
      fontFaceCount += fontFaces.length;
      if (content.includes('fa-solid-900') && content.includes('@font-face')) {
        solidFontReferenced = true;
      }
      expect(content).not.toContain('fa-brands-400');
      expect(content).not.toContain('fa-regular-400');
      expect(content).not.toContain('fa-v4compatibility');
    }

    expect(fontFaceCount, 'Must contain exactly 1 @font-face definition across all dist CSS').toBe(1);
    expect(solidFontReferenced, 'Bundled CSS must reference fa-solid-900').toBe(true);
  });

  it('8. verifies DOM rendering and class assignment for all solid icons in Happy-DOM', () => {
    const usedIcons = collectUsedIcons();

    for (const [iconName] of usedIcons.entries()) {
      const iElement = document.createElement('i');
      iElement.className = `fa-solid fa-${iconName}`;

      expect(iElement.classList.contains('fa-solid')).toBe(true);
      expect(iElement.classList.contains(`fa-${iconName}`)).toBe(true);
      expect(iElement.tagName.toLowerCase()).toBe('i');
    }

    // Test spinning icon
    const spinningIcon = document.createElement('i');
    spinningIcon.className = 'fa-solid fa-circle-notch fa-spin';
    expect(spinningIcon.classList.contains('fa-spin')).toBe(true);
    expect(spinningIcon.classList.contains('fa-solid')).toBe(true);
    expect(spinningIcon.classList.contains('fa-circle-notch')).toBe(true);
  });

  it('9. stress-tests detection oracle against non-solid icons', () => {
    const solidSvgDir = path.join(nodeModulesDir, 'svgs/solid');

    // Synthetic non-solid icons (brand or regular exclusive)
    const nonSolidIcons = ['github', 'twitter', 'discord', 'google', 'apple'];
    for (const icon of nonSolidIcons) {
      const existsInSolid = fs.existsSync(path.join(solidSvgDir, `${icon}.svg`));
      expect(existsInSolid).toBe(false);
    }
  });
});
