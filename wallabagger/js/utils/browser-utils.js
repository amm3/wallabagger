'use strict';

import { browser } from '../browser-polyfill.js';

class BrowserUtils {
    #firefoxRestrictedPages = [
        'accounts-static.cdn.mozilla.net',
        'accounts.firefox.com',
        'addons.cdn.mozilla.net',
        'addons.mozilla.org',
        'api.accounts.firefox.com',
        'content.cdn.mozilla.net',
        'discovery.addons.mozilla.org',
        'oauth.accounts.firefox.com',
        'profile.accounts.firefox.com',
        'support.mozilla.org',
        'sync.services.mozilla.com'
    ];

    #chromeRestrictedPages = [
        'chromewebstore.google.com'
    ];

    #logger = null;

    constructor (logger) {
        this.#logger = logger;
    }

    isServicePage (url, apiUrl) {
        const isServicePageResult = !/^https?:\/\/.+/.test(url) || RegExp('^' + apiUrl).test(url);
        this.#logger.log('isServicePage', isServicePageResult);
        return isServicePageResult;
    };

    // patterns is the newline-separated "never save" setting. Each line is a URL prefix
    // in which * matches anything; a line without a scheme matches any scheme, so
    // "*.example.com" covers every subdomain over http and https.
    isBlockedPage (url, patterns) {
        const matchedPattern = (patterns || '').split('\n')
            .map(pattern => pattern.trim())
            .filter(pattern => pattern.length > 0)
            .find(pattern => {
                const withScheme = pattern.includes('://') ? pattern : `*://${pattern}`;
                const source = withScheme
                    .split('*')
                    .map(part => part.replace(/[.+?^${}()|[\]\\]/g, '\\$&'))
                    .join('.*');
                return new RegExp('^' + source, 'i').test(url);
            });
        const isBlockedPageResult = matchedPattern !== undefined;
        this.#logger.log('isBlockedPage', { matchedPattern, isBlockedPageResult });
        return isBlockedPageResult;
    };

    isRestrictedPage (url) {
        const restrictedPages = globalThis.wallabaggerBrowser === 'Firefox'
            ? this.#firefoxRestrictedPages
            : this.#chromeRestrictedPages;
        const hostname = new URL(url).hostname;
        const isRestrictedPageResult = restrictedPages.includes(hostname);
        this.#logger.log('isRestrictedPage', { restrictedPages, hostname, isRestrictedPageResult });
        return isRestrictedPageResult;
    };

    getActiveTab () {
        return new Promise((resolve, reject) => {
            browser.tabs.query({ active: true, currentWindow: true }, function (tabs) {
                if (tabs[0] != null) {
                    return resolve(tabs[0]);
                } else {
                    return reject(new Error('active tab not found'));
                }
            });
        });
    };
}

export { BrowserUtils };
