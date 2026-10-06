import { readFileSync } from 'node:fs';
import type { ManifestType } from '@extension/shared';

const packageJson = JSON.parse(readFileSync('./package.json', 'utf8'));

/**
 * @prop default_locale
 * if you want to support multiple languages, you can use the following reference
 * https://developer.mozilla.org/en-US/docs/Mozilla/Add-ons/WebExtensions/Internationalization
 *
 * @prop browser_specific_settings
 * Must be unique to your extension to upload to addons.mozilla.org
 * (you can delete if you only want a chrome extension)
 *
 * @prop permissions
 * Firefox doesn't support sidePanel (It will be deleted in manifest parser)
 *
 * @prop content_scripts
 * css: ['content.css'], // public folder
 */
const manifest = {
  manifest_version: 3,
  default_locale: 'en',
  name: '__MSG_extensionName__',
  browser_specific_settings: {
    gecko: {
      id: 'example@example.com',
      strict_min_version: '109.0',
    },
  },
  version: packageJson.version,
  description: '__MSG_extensionDescription__',
  permissions: ['storage', 'contextMenus', 'tabs', 'activeTab'],
  options_page: 'options/index.html',
  commands: {
    'save-page': {
      suggested_key: {
        default: 'Ctrl+Shift+S',
        mac: 'Command+Shift+S',
      },
      description: 'Save current page to Read Later',
    },
  },
  background: {
    service_worker: 'background.js',
    type: 'module',
  },
  action: {
    default_popup: 'popup/index.html',
    default_icon: {
      '16': 'icons/icon-16-light.png',
      '32': 'icons/icon-32-light.png',
    },
  },
  icons: {
    '128': 'icon-128.png',
  },
  web_accessible_resources: [
    {
      resources: [
        'icons/icon-16-light.png',
        'icons/icon-16-dark.png',
        'icons/icon-32-light.png',
        'icons/icon-32-dark.png'
      ],
      matches: ['<all_urls>'],
    },
  ],
} satisfies ManifestType;

export default manifest;
