/**
 * Empirical Challenger Opt-M4-1: Vite Packaging, ES2022 Target & CodeMirror Manual Chunk Splitting Suite
 * Location: test/unit/challenger-opt-m4-1.spec.ts
 *
 * Validates:
 * 1. Target 'es2022' configuration in vite.config.ts and syntax integrity of all emitted bundles.
 * 2. CodeMirror manualChunks splitting: chunk boundaries, size reduction, and non-pollution of popup/background/content.
 * 3. Module graph acyclicity (DAG) and zero broken exports across all emitted chunks.
 * 4. Runtime functional execution: instantiating, reconfiguring, and mutating CodeMirror directly from the split chunk.
 * 5. Extension HTML & Manifest integrity: valid script and preload module references.
 */

import { describe, it, expect } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

describe('Empirical Challenger Opt-M4-1: Vite Packaging, ES2022 Target & CodeMirror Chunking Suite', () => {
  const rootDir = process.cwd();
  const distDir = path.join(rootDir, 'dist');
  const distAssetsDir = path.join(distDir, 'assets');
  const viteConfigContent = fs.readFileSync(path.join(rootDir, 'vite.config.ts'), 'utf8');

  // Helper to get all JS files in dist/assets
  function getJsChunks(): { name: string; fullPath: string; content: string; size: number }[] {
    expect(fs.existsSync(distAssetsDir), 'dist/assets directory must exist (run build first)').toBe(true);
    const files = fs.readdirSync(distAssetsDir).filter(f => f.endsWith('.js'));
    return files.map(name => {
      const fullPath = path.join(distAssetsDir, name);
      const content = fs.readFileSync(fullPath, 'utf8');
      const size = fs.statSync(fullPath).size;
      return { name, fullPath, content, size };
    });
  }

  // =========================================================================
  // Subsystem 1: Vite Config & ES2022 Target Verification
  // =========================================================================
  describe('Subsystem 1: Vite Config & ES2022 Target Verification', () => {
    it('1.1: vite.config.ts explicitly sets build.target to es2022', () => {
      expect(viteConfigContent).toMatch(/target:\s*['"]es2022['"]/);
    });

    it('1.2: vite.config.ts configures chunkSizeWarningLimit to 600', () => {
      expect(viteConfigContent).toMatch(/chunkSizeWarningLimit:\s*600/);
    });

    it('1.3: all emitted JS chunks in dist/ pass node --check syntax validation (ES2022 native syntax)', () => {
      const chunks = getJsChunks();
      expect(chunks.length).toBeGreaterThan(5);

      for (const chunk of chunks) {
        let syntaxError = false;
        try {
          execSync(`node --check "${chunk.fullPath}"`, { stdio: 'pipe' });
        } catch (err: any) {
          syntaxError = true;
        }
        expect(syntaxError, `Chunk ${chunk.name} failed node --check syntax validation`).toBe(false);
      }

      // Also check service-worker-loader.js
      const swLoader = path.join(distDir, 'service-worker-loader.js');
      if (fs.existsSync(swLoader)) {
        let swSyntaxError = false;
        try {
          execSync(`node --check "${swLoader}"`, { stdio: 'pipe' });
        } catch {
          swSyntaxError = true;
        }
        expect(swSyntaxError, 'service-worker-loader.js failed node --check').toBe(false);
      }
    });
  });

  // =========================================================================
  // Subsystem 2: CodeMirror Manual Chunk Splitting & Boundaries
  // =========================================================================
  describe('Subsystem 2: CodeMirror Manual Chunk Splitting & Boundaries', () => {
    it('2.1: vite.config.ts manualChunks splits both @codemirror and codemirror packages', () => {
      expect(viteConfigContent).toContain('manualChunks');
      expect(viteConfigContent).toContain("id.includes('node_modules/@codemirror')");
      expect(viteConfigContent).toContain("id.includes('node_modules/codemirror')");
      expect(viteConfigContent).toContain("return 'codemirror'");

      // Extract and execute the manualChunks function body
      const fnMatch = viteConfigContent.match(/manualChunks\(id\)\s*\{([\s\S]*?)\n\s{8}\}/);
      expect(fnMatch).toBeDefined();
      const manualChunksFn = new Function('id', fnMatch![1]) as (id: string) => string | undefined;

      expect(manualChunksFn('node_modules/@codemirror/state/dist/index.js')).toBe('codemirror');
      expect(manualChunksFn('node_modules/@codemirror/view/dist/index.js')).toBe('codemirror');
      expect(manualChunksFn('node_modules/@codemirror/lang-javascript/dist/index.js')).toBe('codemirror');
      expect(manualChunksFn('node_modules/@codemirror/theme-one-dark/dist/index.js')).toBe('codemirror');
      expect(manualChunksFn('node_modules/codemirror/dist/index.js')).toBe('codemirror');

      // Other modules should not be in codemirror chunk
      expect(manualChunksFn('node_modules/vue/dist/vue.runtime.esm-bundler.js')).toBeUndefined();
      expect(manualChunksFn('src/dashboard/App.vue')).toBeUndefined();
      expect(manualChunksFn('src/popup/App.vue')).toBeUndefined();
      expect(manualChunksFn('src/background/index.ts')).toBeUndefined();
    });

    it('2.2: dist/assets contains a dedicated codemirror-*.js chunk under 600 kB', () => {
      const chunks = getJsChunks();
      const cmChunk = chunks.find(c => c.name.startsWith('codemirror-'));
      expect(cmChunk, 'Dedicated codemirror-*.js chunk must exist in dist/assets').toBeDefined();
      expect(cmChunk!.size).toBeGreaterThan(200 * 1024); // Contains editor engine
      expect(cmChunk!.size).toBeLessThan(600 * 1024); // Stays below 600 kB warning limit
    });

    it('2.3: dashboard script chunk size is reduced to < 50 kB and imports codemirror chunk', () => {
      const chunks = getJsChunks();
      const cmChunk = chunks.find(c => c.name.startsWith('codemirror-'));
      expect(cmChunk).toBeDefined();

      // Find dashboard HTML entry script
      const dashboardHtml = fs.readFileSync(path.join(distDir, 'src/dashboard/index.html'), 'utf8');
      const scriptMatch = dashboardHtml.match(/src="\/assets\/(index\.html-[^"]+\.js)"/);
      expect(scriptMatch, 'Dashboard entry script must be referenced in dashboard index.html').toBeDefined();

      const dashboardChunkName = scriptMatch![1];
      const dashboardChunk = chunks.find(c => c.name === dashboardChunkName);
      expect(dashboardChunk, 'Dashboard chunk must exist in dist/assets').toBeDefined();

      // Size must be compact (< 50 kB) because CodeMirror was separated
      expect(dashboardChunk!.size).toBeLessThan(50 * 1024);
      expect(dashboardChunk!.content).toContain(cmChunk!.name);
    });

    it('2.4: popup bundle does NOT import or reference the codemirror chunk', () => {
      const chunks = getJsChunks();
      const cmChunk = chunks.find(c => c.name.startsWith('codemirror-'));
      expect(cmChunk).toBeDefined();

      const popupHtml = fs.readFileSync(path.join(distDir, 'src/popup/index.html'), 'utf8');
      expect(popupHtml).not.toContain(cmChunk!.name);

      const scriptMatch = popupHtml.match(/src="\/assets\/(index\.html-[^"]+\.js)"/);
      expect(scriptMatch).toBeDefined();
      const popupChunkName = scriptMatch![1];
      const popupChunk = chunks.find(c => c.name === popupChunkName);
      expect(popupChunk).toBeDefined();

      expect(popupChunk!.content).not.toContain(cmChunk!.name);
      expect(popupChunk!.content).not.toContain('EditorView');
      expect(popupChunk!.content).not.toContain('oneDark');
      expect(popupChunk!.size).toBeLessThan(35 * 1024);
    });

    it('2.5: background service worker and content script do NOT reference the codemirror chunk', () => {
      const chunks = getJsChunks();
      const cmChunk = chunks.find(c => c.name.startsWith('codemirror-'));
      expect(cmChunk).toBeDefined();

      // Background SW entry
      const swLoader = fs.readFileSync(path.join(distDir, 'service-worker-loader.js'), 'utf8');
      const swEntryMatch = swLoader.match(/assets\/(index\.ts-[^.]+\.js)/);
      expect(swEntryMatch).toBeDefined();
      const swChunk = chunks.find(c => c.name === swEntryMatch![1]);
      expect(swChunk).toBeDefined();
      expect(swChunk!.content).not.toContain(cmChunk!.name);

      // Content script entry
      const manifest = JSON.parse(fs.readFileSync(path.join(distDir, 'manifest.json'), 'utf8'));
      const contentLoaderFile = manifest.content_scripts[0].js[0];
      const contentLoaderContent = fs.readFileSync(path.join(distDir, contentLoaderFile), 'utf8');
      const contentEntryMatch = contentLoaderContent.match(/assets\/(index\.ts-[^"]+\.js)/);
      expect(contentEntryMatch).toBeDefined();
      const contentChunk = chunks.find(c => c.name === contentEntryMatch![1]);
      expect(contentChunk).toBeDefined();
      expect(contentChunk!.content).not.toContain(cmChunk!.name);
    });
  });

  // =========================================================================
  // Subsystem 3: Chunk Dependency Graph & Zero Broken Exports
  // =========================================================================
  describe('Subsystem 3: Chunk Dependency Graph & Zero Broken Exports', () => {
    it('3.1: chunk dependency graph is strictly acyclic (DAG with zero circular dependencies)', () => {
      const chunks = getJsChunks();
      const adj: Record<string, string[]> = {};

      for (const chunk of chunks) {
        adj[chunk.name] = [];
        const re = /from\s*['"](\.\/[^'"]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = re.exec(chunk.content)) !== null) {
          const target = path.basename(m[1]);
          if (!adj[chunk.name].includes(target)) {
            adj[chunk.name].push(target);
          }
        }
      }

      const visited: Record<string, boolean> = {};
      const recStack: Record<string, boolean> = {};

      function hasCycle(node: string): boolean {
        visited[node] = true;
        recStack[node] = true;
        for (const neighbor of adj[node] || []) {
          if (!visited[neighbor]) {
            if (hasCycle(neighbor)) return true;
          } else if (recStack[neighbor]) {
            return true;
          }
        }
        recStack[node] = false;
        return false;
      }

      let cycleFound = false;
      for (const chunk of chunks) {
        if (!visited[chunk.name]) {
          if (hasCycle(chunk.name)) {
            cycleFound = true;
            break;
          }
        }
      }

      expect(cycleFound, 'Circular dependency cycle detected between dist chunks').toBe(false);
    });

    it('3.2: 100% of imported symbols across all chunks exist in the exporting chunk (zero broken exports)', () => {
      const chunks = getJsChunks();
      const chunkExports: Record<string, Set<string>> = {};

      // Collect exports from all chunks
      for (const chunk of chunks) {
        chunkExports[chunk.name] = new Set();
        const exportRe = /export\s*\{([^}]+)\}/g;
        let m: RegExpExecArray | null;
        while ((m = exportRe.exec(chunk.content)) !== null) {
          const parts = m[1].split(',');
          for (const p of parts) {
            const trimmed = p.trim();
            if (!trimmed) continue;
            const tokens = trimmed.split(/\s+as\s+/);
            const exportedName = tokens[tokens.length - 1].trim();
            chunkExports[chunk.name].add(exportedName);
          }
        }
        if (/export\s+default\b/.test(chunk.content)) {
          chunkExports[chunk.name].add('default');
        }
      }

      // Check all imports against chunkExports
      const brokenImports: string[] = [];

      for (const chunk of chunks) {
        const importRe = /import\s*\{([^}]+)\}\s*from\s*['"](\.\/[^'"]+)['"]/g;
        let m: RegExpExecArray | null;
        while ((m = importRe.exec(chunk.content)) !== null) {
          const importSpecs = m[1].split(',');
          const targetFile = path.basename(m[2]);
          const targetExports = chunkExports[targetFile];

          if (!targetExports) {
            brokenImports.push(`${chunk.name}: missing target file ${targetFile}`);
            continue;
          }

          for (const spec of importSpecs) {
            const trimmed = spec.trim();
            if (!trimmed) continue;
            const importedName = trimmed.split(/\s+as\s+/)[0].trim();
            if (!targetExports.has(importedName)) {
              brokenImports.push(`${chunk.name}: import '${importedName}' not exported by ${targetFile}`);
            }
          }
        }
      }

      expect(brokenImports, `Broken imports detected: ${brokenImports.join('; ')}`).toEqual([]);
    });

    it('3.3: codemirror chunk exports exactly 7 symbols required by dashboard ScriptEditor', () => {
      const chunks = getJsChunks();
      const cmChunk = chunks.find(c => c.name.startsWith('codemirror-'));
      expect(cmChunk).toBeDefined();

      const exportMatch = cmChunk!.content.match(/export\s*\{([^}]+)\}/);
      expect(exportMatch).toBeDefined();

      const exportedSymbols = exportMatch![1].split(',').map(s => {
        const tokens = s.trim().split(/\s+as\s+/);
        return tokens[tokens.length - 1].trim();
      });

      // 7 symbols: Compartment, EditorView, EditorState, basicSetup, javascript, oneDark, keymap
      expect(exportedSymbols.length).toBe(7);
      expect(exportedSymbols.sort()).toEqual(['C', 'E', 'a', 'b', 'j', 'k', 'o'].sort());
    });
  });

  // =========================================================================
  // Subsystem 4: Runtime Execution & Editor Functionality from Split Chunk
  // =========================================================================
  describe('Subsystem 4: Runtime Execution & Editor Functionality from Split Chunk', () => {
    it('4.1: loads codemirror chunk and instantiates EditorView with all 7 extensions', async () => {
      const chunks = getJsChunks();
      const cmChunk = chunks.find(c => c.name.startsWith('codemirror-'));
      expect(cmChunk).toBeDefined();

      const cmModule = await import(cmChunk!.fullPath);
      expect(cmModule).toBeDefined();

      const Compartment = cmModule.C;
      const EditorView = cmModule.E;
      const EditorState = cmModule.a;
      const basicSetup = cmModule.b;
      const javascript = cmModule.j;
      const oneDark = cmModule.o;
      const keymap = cmModule.k;

      expect(typeof Compartment).toBe('function');
      expect(typeof EditorView).toBe('function');
      expect(typeof EditorState).toBe('function');
      expect(typeof basicSetup).toBe('object');
      expect(typeof javascript).toBe('function');
      expect(typeof oneDark).toBe('object');
      expect(typeof keymap).toBe('object');

      const container = document.createElement('div');
      document.body.appendChild(container);

      const readonlyCompartment = new Compartment();
      const state = EditorState.create({
        doc: '// ==UserScript==\n// @name Test\n// ==/UserScript==\nconsole.log(42);',
        extensions: [
          basicSetup,
          javascript(),
          oneDark,
          keymap.of([{ key: 'Mod-s', run: () => true }]),
          readonlyCompartment.of(EditorState.readOnly.of(false))
        ]
      });

      const view = new EditorView({
        state,
        parent: container
      });

      expect(view).toBeDefined();
      expect(view.state.doc.toString()).toBe('// ==UserScript==\n// @name Test\n// ==/UserScript==\nconsole.log(42);');

      // Test reconfiguration
      view.dispatch({
        effects: readonlyCompartment.reconfigure(EditorState.readOnly.of(true))
      });
      expect(view.state.readOnly).toBe(true);

      // Test document transaction
      view.dispatch({
        changes: { from: 0, to: 0, insert: '// Header\n' }
      });
      expect(view.state.doc.toString().startsWith('// Header\n')).toBe(true);

      view.destroy();
      container.remove();
    });
  });

  // =========================================================================
  // Subsystem 5: HTML Preload & Manifest Reference Integrity
  // =========================================================================
  describe('Subsystem 5: HTML Preload & Manifest Reference Integrity', () => {
    it('5.1: dashboard index.html correctly preloads codemirror chunk and styles', () => {
      const dashboardHtml = fs.readFileSync(path.join(distDir, 'src/dashboard/index.html'), 'utf8');
      const chunks = getJsChunks();
      const cmChunk = chunks.find(c => c.name.startsWith('codemirror-'));
      expect(cmChunk).toBeDefined();

      expect(dashboardHtml).toContain(`href="/assets/${cmChunk!.name}"`);
      expect(dashboardHtml).toContain('rel="modulepreload"');
      expect(dashboardHtml).toContain('rel="stylesheet"');
    });

    it('5.2: manifest.json references only valid, existing files in dist', () => {
      const manifestPath = path.join(distDir, 'manifest.json');
      expect(fs.existsSync(manifestPath)).toBe(true);
      const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));

      expect(fs.existsSync(path.join(distDir, manifest.action.default_popup))).toBe(true);
      expect(fs.existsSync(path.join(distDir, manifest.options_ui.page))).toBe(true);
      expect(fs.existsSync(path.join(distDir, manifest.background.service_worker))).toBe(true);

      for (const cs of manifest.content_scripts) {
        for (const script of cs.js) {
          expect(fs.existsSync(path.join(distDir, script)), `Content script ${script} must exist`).toBe(true);
        }
      }

      for (const war of manifest.web_accessible_resources) {
        for (const res of war.resources) {
          expect(fs.existsSync(path.join(distDir, res)), `Web accessible resource ${res} must exist`).toBe(true);
        }
      }
    });
  });
});
