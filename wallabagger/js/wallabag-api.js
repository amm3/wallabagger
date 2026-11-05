import { browser } from './browser-polyfill.js';
import { FetchApi } from './fetch-api.js';

/**
 * @param {string} url
 * @returns {Promise<string>}
 * @see https://developer.mozilla.org/en-US/docs/Web/API/SubtleCrypto/digest#converting_a_digest_to_a_hex_string
 */
const hashUrl = function (url) {
    const urlByteArray = new TextEncoder().encode(url);
    return crypto.subtle.digest('SHA-1', urlByteArray).then(hashBuffer => {
        const hashArray = Array.from(new Uint8Array(hashBuffer));
        const hashHex = hashArray
            .map((b) => b.toString(16).padStart(2, '0'))
            .join(''); // convert bytes to hex string
        return hashHex;
    });
};

const WallabagApi = function (logger) {
    this.logger = logger;
};

WallabagApi.prototype = {

    defaultValues: {
        Url: null,
        ApiVersion: null,
        ClientId: null,
        ClientSecret: null,
        UserLogin: null,
        UserPassword: null,
        ApiToken: null,
        RefreshToken: null,
        ExpireDate: 0,
        isTokenExpired: true,
        isFetchPermissionGranted: null,
        AllowSpaceInTags: false,
        AllowExistCheck: false,
        AllowExistSafe: null,
        Debug: false,
        AutoAddSingleTag: false,
        ArchiveByDefault: false,
        sitesToFetchLocally: null,
        sitesToSendUrlOnly: null,
        FetchLocallyByDefault: false,
        LlmProvider: 'disabled',
        LlmApiKey: '',
        LlmModel: '',
        LlmBaseUrl: '',
        LlmOllamaUrl: '',
        LlmOllamaModel: '',
        LlmOllamaApiKey: ''
    },

    logger: null,

    data: {},

    fetchApi: null,

    tags: [],

    init: async function () {
        this.logger.groupCollapsed('init');
        this.logger.log('starting');
        Object.assign(this.data, this.defaultValues);
        this.fetchApi = new FetchApi();
        await this.load();
        this.setAllowExistSafe();
        this.logger.log('ending');
        this.logger.groupEnd();
    },

    forceInit: async function () {
        if (!this.data.ClientId) {
            await this.init();
        }
    },

    load: async function () {
        const result = await browser.storage.local.get('wallabagdata');

        if (result.wallabagdata != null) {
            this.set(result.wallabagdata);
            if (this.checkParams()) {
                return this.data;
            }
        }
        this.clear();

        return this.data;
    },

    needNewAppToken: function () {
        const need = (
            (this.data.ApiToken === '') ||
                  (this.data.ApiToken === null) ||
                  this.isTokenExpired()
        );
        return need;
    },

    checkParams: function () {
        return ((this.data.ClientId !== null) &&
                 (this.data.ClientSecret !== null) &&
                 (this.data.UserLogin !== null) &&
                 (this.data.UserPassword !== null) &&
                 (this.data.ClientId !== '') &&
                 (this.data.ClientSecret !== '') &&
                 (this.data.UserLogin !== '') &&
                 (this.data.UserPassword !== ''));
    },

    isTokenExpired: function () {
        return Date.now() > this.data.ExpireDate;
    },

    clear: function () {
        this.set(this.defaultValues);
        this.logger.log('Some parameters are empty. Check the settings');
    },

    set: function (params) {
        Object.assign(this.data, params);
    },

    saveParams: function (params) {
        this.logger.setDebug(params.Debug);
        this.set(params);
        browser.storage.local.set({ wallabagdata: this.data });
    },

    CheckUrl: function () {
        const url_ = this.data.Url + '/api/version';
        return this.fetchApi.Get(url_, '')
            .then(fetchData => {
                this.data.ApiVersion = fetchData;
                this.setAllowExistSafe();
                return fetchData;
            })
            .catch(error => {
                throw new Error(`Failed to get api version ${url_}
                ${error.message}`);
            });
    },

    setAllowExistSafe: async function () {
        if (typeof (this.data.Url) !== 'string') {
            return false;
        }
        this.data.AllowExistSafe = await this.SupportsHashedUrl();
    },

    /**
     * @returns {Promise<[number, number, number]>}
     */
    GetVersion: function () {
        if (this.data.ApiVersion) return Promise.resolve(this.data.ApiVersion.split('.').map(Number));
        return this.CheckUrl().then(() => this.GetVersion());
    },

    SupportsHashedUrl: function () {
        return this.GetVersion().then(([major, minor]) => {
            return (major > 2) || (major === 2 && minor >= 4);
        });
    },

    SaveTitle: function (articleId, articleTitle) {
        return this.PatchArticle(articleId, { title: articleTitle });
    },

    SaveStarred: function (articleId, articleStarred) {
        return this.PatchArticle(articleId, { starred: articleStarred });
    },

    SaveArchived: function (articleId, articleArchived) {
        return this.PatchArticle(articleId, { archive: articleArchived });
    },

    SaveTags: function (articleId, taglist) {
        return this.PatchArticle(articleId, { tags: taglist });
    },

    PatchArticle: function (articleId, content) {
        const entryUrl = `${this.data.Url}/api/entries/${articleId}.json`;
        return this.CheckToken().then(a =>
            this.fetchApi.Patch(entryUrl, this.data.ApiToken, content)
        )
            .catch(error => {
                throw new Error(`Failed to update article ${entryUrl}
                ${error.message}`);
            });
    },
    /** Delete article
     * @param articleId {number} Article identificator
     */
    DeleteArticle: function (articleId) {
        const entryUrl = `${this.data.Url}/api/entries/${articleId}.json`;
        return this.CheckToken().then(a =>
            this.fetchApi.Delete(entryUrl, this.data.ApiToken)
        )
            .catch(error => {
                throw new Error(`Failed to delete article ${entryUrl}
                ${error.message}`);
            });
    },

    DeleteArticleTag: function (articleId, tagid) {
        const entryUrl = `${this.data.Url}/api/entries/${articleId}/tags/${tagid}.json`;
        return this.CheckToken().then(a =>
            this.fetchApi.Delete(entryUrl, this.data.ApiToken)
        )
            .catch(error => {
                throw new Error(`Failed to delete article tag ${entryUrl}
                ${error.message}`);
            });
    },

    CheckToken: function () {
        return new Promise((resolve, reject) => {
            if (!this.checkParams()) {
                reject(new Error('Parameters not ok.'));
            }
            if (this.needNewAppToken()) {
                resolve(this.PasswordToken());
            }
            resolve('Token ok.');
        });
    },

    // With "all websites" on, browser content is the default and sitesToSendUrlOnly lists
    // the exceptions (sites where wallabag should fetch the URL itself). With it off, URL
    // submission is the default and sitesToFetchLocally lists the exceptions.
    IsSiteToFetchLocally: function (pageUrl) {
        const matches = (list) => !!list && list.split('\n').some(item => item && pageUrl.indexOf(item) === 0);
        if (this.data.FetchLocallyByDefault) {
            return !matches(this.data.sitesToSendUrlOnly);
        }
        return matches(this.data.sitesToFetchLocally);
    },

    SavePage: function (options) {
        const buildBody = (content) => {
            const body = { url: options.url };
            if (this.data.ArchiveByDefault === true) {
                body.archive = 1;
            }
            if (options.title) {
                body.title = options.title;
            }
            if (content) {
                this.logger.log('submitting content', content.length, 'chars');
                body.content = content;
            }
            if (options.author) {
                body.authors = options.author;
            }
            if (options.publishedAt) {
                body.published_at = options.publishedAt;
            }
            return body;
        };

        // Drops what costs the most bytes and is of no use to wallabag's extractor:
        // scripts (except JSON-LD, which graby reads for date/author), stylesheets,
        // comments, noscript/template blocks and base64-inlined assets. Usually removes
        // well over half of a modern article page.
        const shrinkHtml = (html) => html
            .replace(/<!--[\s\S]*?-->/g, '')
            .replace(/<script\b([^>]*)>[\s\S]*?<\/script\s*>/gi, (match, attrs) => /ld\+json/i.test(attrs) ? match : '')
            .replace(/<style\b[^>]*>[\s\S]*?<\/style\s*>/gi, '')
            .replace(/<noscript\b[^>]*>[\s\S]*?<\/noscript\s*>/gi, '')
            .replace(/<template\b[^>]*>[\s\S]*?<\/template\s*>/gi, '')
            .replace(/\s(?:src|srcset|href)\s*=\s*"data:[^"]*"/gi, '')
            .replace(/\s(?:src|srcset|href)\s*=\s*'data:[^']*'/gi, '');

        const extractArticle = (html) => {
            const start = html.indexOf('<article');
            if (start === -1) return null;
            const end = html.lastIndexOf('</article>');
            if (end === -1) return null;
            return html.slice(start, end + '</article>'.length);
        };

        // A JSON error body rejects with the parsed object, an HTML one (nginx's default
        // 413 page) with an Error - so check the status carried by both, and keep the
        // message check for anything that predates it.
        const is413 = (error) => Boolean(error) &&
            (error.status === 413 || (typeof error.message === 'string' && error.message.startsWith('HTTP 413')));

        // Progressively smaller payloads, tried in order as the server rejects each one as
        // too large. Only the final rung gives up on the locally fetched content and lets
        // wallabag fetch the page itself - which is exactly what fails on paywalled or
        // JS-rendered articles, leaving the entry holding wallabag's "can't retrieve
        // contents for this article" placeholder.
        const buildAttempts = () => {
            const attempts = [];
            if (options.content) {
                // Shrink up front rather than only as a 413 fallback. On a large news site
                // the scripts and inline preload JSON are most of the payload and none of it
                // is article content, so posting the raw document buys nothing and risks the
                // server's body limit - past which the ladder ends at a URL-only save and
                // wallabag has to fetch a page that may well block it.
                const shrunk = shrinkHtml(options.content);
                this.logger.log('shrunk content', options.content.length, '->', shrunk.length, 'chars');
                attempts.push({ label: 'content', content: shrunk });
                const article = extractArticle(shrunk);
                if (article && article.length < shrunk.length) {
                    attempts.push({ label: '<article> excerpt', content: article });
                }
            }
            attempts.push({ label: 'URL only', content: null });
            return attempts;
        };

        const entriesUrl = `${this.data.Url}/api/entries.json`;
        return this.CheckToken().then(async () => {
            const attempts = buildAttempts();
            for (let i = 0; i < attempts.length; i++) {
                try {
                    const saved = await this.fetchApi.Post(entriesUrl, this.data.ApiToken, buildBody(attempts[i].content));
                    if (saved && typeof saved === 'object') {
                        // Report which rung actually went out, and whether content was in
                        // play at all. The caller retries an unparsed entry only when no
                        // content was ever offered: if the ladder did offer it and the
                        // server rejected every rung as too large, sending it again is
                        // guaranteed to fail the same way.
                        saved.sentContent = Boolean(attempts[i].content);
                        saved.attemptedContent = Boolean(options.content);
                    }
                    return saved;
                } catch (error) {
                    const isLastAttempt = i === attempts.length - 1;
                    if (isLastAttempt || !is413(error)) {
                        throw new Error(`Failed to save page ${entriesUrl}
                ${error.message}`);
                    }
                    this.logger.log(`413 on ${attempts[i].label}, retrying with ${attempts[i + 1].label}`);
                }
            }
        });
    },

    RefreshToken: function () {
        const content = {
            grant_type: 'refresh_token',
            refresh_token: this.data.RefreshToken,
            client_id: this.data.ClientId,
            client_secret: this.data.ClientSecret
        };
        return this.GetAppToken(content);
    },

    PasswordToken: function () {
        const content = {
            grant_type: 'password',
            client_id: this.data.ClientId,
            client_secret: this.data.ClientSecret,
            username: this.data.UserLogin,
            password: this.data.UserPassword
        };
        return this.GetAppToken(content);
    },

    GetAppToken: function (content) {
        this.CheckUrl();
        const oauthurl = `${this.data.Url}/oauth/v2/token`;
        return this.fetchApi.Post(oauthurl, '', content)
            .then(data => {
                if (data !== '') {
                    this.data.ApiToken = data.access_token;
                    this.data.RefreshToken = data.refresh_token;
                    this.data.ExpireDate = Date.now() + data.expires_in * 1000;
                    this.data.isTokenExpired = this.isTokenExpired();
                    return data;
                }
            })
            .catch(error => {
                throw new Error(`Failed to refresh token ${oauthurl}
                ${error.message}`);
            });
    },

    GetTags: async function () {
        await this.forceInit();
        if (!this.checkParams()) {
            return false;
        }
        const entriesUrl = `${this.data.Url}/api/tags.json`;
        return this.CheckToken().then(a =>
            this.fetchApi.Get(entriesUrl, this.data.ApiToken)
        )
            .then(fetchData => {
                this.tags = fetchData;
                return fetchData;
            })
            .catch(error => {
                throw new Error(`Failed to get tags ${entriesUrl} ${error.message}`);
            });
    },

    EntryExists: function (url) {
        const existsUrl = `${this.data.Url}/api/entries/exists.json`;

        return this.CheckToken().then(() => {
            const paramAsync = this.data.AllowExistSafe ? hashUrl(url) : Promise.resolve(url);
            return paramAsync.then(param => `${existsUrl}?${this.data.AllowExistSafe ? 'hashed_url' : 'url'}=${encodeURIComponent(param)}`);
        })
            .then(url => this.fetchApi.Get(url, this.data.ApiToken))
            .catch(error => {
                throw new Error(`Failed to ask ${existsUrl} whether ${url} exists
                ${error.message}`);
            });
    },

    GetArticle: function (articleId) {
        const entriesUrl = `${this.data.Url}/api/entries/${articleId}.json`;
        return this.CheckToken().then(a =>
            this.fetchApi.Get(entriesUrl, this.data.ApiToken)
        )
            .catch(error => {
                throw new Error(`Failed to get article ${entriesUrl}
                ${error.message}`);
            });
    },

    GetArticleTags: function (articleId) {
        const entriesUrl = `${this.data.Url}/api/entries/${articleId}/tags.json`;
        return this.CheckToken().then(a =>
            this.fetchApi.Get(entriesUrl, this.data.ApiToken)
        )
            .catch(error => {
                throw new Error(`Failed to get article tags ${entriesUrl}
                ${error.message}`);
            });
    }
};

export { WallabagApi };
