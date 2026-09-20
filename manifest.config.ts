import { defineManifest } from '@crxjs/vite-plugin';
import packageJson from './package.json';

const { version, name, description } = packageJson;

export default defineManifest(async () => ({
  manifest_version: 3,
  name: name || 'XOKJ - CDP Userscript Manager',
  version: version,
  description: description || 'Chromium Userscript Manager with Hybrid CDP Control Plane',
  action: {
    default_popup: 'src/popup/index.html',
    default_title: 'XOKJ Control Panel'
  },
  options_ui: {
    page: 'src/dashboard/index.html',
    open_in_tab: true
  },
  background: {
    service_worker: 'src/background/index.ts',
    type: 'module'
  },
  content_scripts: [
    {
      matches: ['<all_urls>'],
      js: ['src/content/index.ts'],
      run_at: 'document_start',
      all_frames: true
    }
  ],
  permissions: [
    'storage',
    'tabs',
    'activeTab',
    'debugger',
    'webNavigation',
    'scripting'
  ],
  host_permissions: [
    '<all_urls>'
  ]
}));
