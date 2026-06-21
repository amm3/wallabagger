import { browser } from './browser-polyfill.js';
import { Common } from './common.js';
import { PortManager } from './port-manager.js';
import { BrowserUtils } from './utils/browser-utils.js';
import { Logger } from './utils/logger.js';

const PopupController = function () {
    this.mainCard = document.getElementById('main-card');
    this.errorToast = document.getElementById('error-toast');
    this.infoToast = document.getElementById('info-toast');
    this.cardTitle = document.getElementById('card-title');
    this.entryUrl = document.getElementById('entry-url');
    this.cardImage = document.getElementById('card-image');
    this.tagsInputContainer = document.getElementById('tags-input-container');
    this.tagsInput = document.getElementById('tags-input');
    this.tagsAutoCompleteList = document.getElementById('tags-autocomplete-list');
    this.editIcon = document.getElementById('edit-icon');
    this.saveTitleButton = document.getElementById('save-title-button');
    this.cancelTitleButton = document.getElementById('cancel-title-button');
    this.deleteIcon = document.getElementById('delete-icon');
    this.closeConfirmation = document.getElementById('close-confirmation');
    this.cancelConfirmation = document.getElementById('cancel-confirmation');
    this.deleteArticleButton = document.getElementById('delete-article');
    this.archivedIcon = document.getElementById('archived-icon');
    this.deleteConfirmationCard = document.getElementById('delete_confirmation');
    this.titleInput = document.getElementById('title-input');
    this.cardHeader = document.getElementById('card-header');
    this.cardBody = document.getElementById('card-body');
    this.starredIcon = document.getElementById('starred-icon');
    this.articleId = -1;
    this.addListeners();
    this.logger = new Logger('popup');
    this.browserUtils = new BrowserUtils(this.logger);
};

PopupController.prototype = {

    mainCard: null,
    errorToast: null,
    infoToast: null,
    apiUrl: null,
    entryUrl: null,
    cardTitle: null,
    cardImage: null,
    tagsInputContainer: null,
    tagsInput: null,
    tagsAutoCompleteList: null,

    articleId: null,
    editIcon: null,
    saveTitleButton: null,
    cancelTitleButton: null,
    deleteIcon: null,
    closeConfirmation: null,
    cancelConfirmation: null,
    deleteArticleButton: null,
    archivedIcon: null,
    deleteConfirmationCard: null,
    titleInput: null,
    cardHeader: null,
    cardBody: null,

    starredIcon: null,

    articleTags: [],
    allTags: [],
    dirtyTags: [],
    foundTags: [],

    starred: 0,
    archived: 0,
    tmpTagId: 0,
    AllowSpaceInTags: false,
    AutoAddSingleTag: false,
    tabUrl: null,

    port: null,

    encodeMap: { '&': '&amp;', '\'': '&#039;', '"': '&quot;', '<': '&lt;', '>': '&gt;' },
    decodeMap: { '&amp;': '&', '&#039;': '\'', '&quot;': '"', '&lt;': '<', '&gt;': '>' },

    selectedTag: -1,
    selectedFoundTag: 0,
    backspacePressed: false,

    getSaveHtml: function (param) {
        return param.replace(/[<'&">]/g, symb => this.encodeMap[symb]);
    },

    decodeStr: function (param) {
        for (const prop in this.decodeMap) {
            const propRegExp = new RegExp(prop, 'g');
            param = param.replace(propRegExp, this.decodeMap[prop]);
        }
        return param;
    },

    addListeners: function () {
        this.cardTitle.addEventListener('click', this.openUrl);
        this.entryUrl.addEventListener('click', this.openUrl);
        this.editIcon.addEventListener('click', this.editIconClick.bind(this));
        this.saveTitleButton.addEventListener('click', this.saveTitleClick.bind(this));
        this.cancelTitleButton.addEventListener('click', this.cancelTitleClick.bind(this));

        this.deleteIcon.addEventListener('click', this.deleteConfirmation.bind(this));
        this.closeConfirmation.addEventListener('click', this.cancelDelete.bind(this));
        this.cancelConfirmation.addEventListener('click', this.cancelDelete.bind(this));
        this.deleteArticleButton.addEventListener('click', this.deleteArticle.bind(this));

        this.tagsInput.addEventListener('input', this.onTagsInputChanged.bind(this));
        this.tagsInput.addEventListener('keyup', this.onTagsInputKeyUp.bind(this));
        this.tagsInput.addEventListener('keydown', this.onTagsInputKeyDown.bind(this));

        this.starredIcon.addEventListener('click', this.onIconClick.bind(this));
        this.archivedIcon.addEventListener('click', this.onIconClick.bind(this));
    },

    onIconClick: function (event) {
        event.preventDefault();
        const icon = event.currentTarget;
        this.toggleIcon(icon);
        this.toggleAction(icon);
        if (icon.id === 'starred-icon') {
            this.starred = (this.starred + 1) % 2;
        } else {
            this.archived = (this.archived + 1) % 2;
        }
        this.tagsInput.focus();
    },

    toggleIcon: function (icon) {
        let currentState = JSON.parse(icon.dataset.isset);

        icon.classList.remove(currentState ? icon.dataset.seticon : icon.dataset.unseticon);
        icon.classList.add(currentState ? icon.dataset.unseticon : icon.dataset.seticon);

        currentState = !currentState;
        icon.dataset.isset = JSON.stringify(currentState);
        const title = JSON.parse(icon.dataset.isset) ? icon.dataset.unseticonTitle : icon.dataset.seticonTitle;
        icon.title = Common.translate(title);
    },

    toggleAction: function (icon) {
        this.port.postMessage({ request: icon.dataset.apicall, articleId: this.articleId, value: JSON.parse(icon.dataset.isset) + 0, tabUrl: this.tabUrl });
    },

    onTagsInputKeyDown: function (event) {
        if (event.key === 'Backspace') this.backspacePressed = true;
        if ((event.key === 'Backspace') && (event.target.value === '')) {
            const lastChip = event.target.previousElementSibling;
            if (lastChip.classList.contains('chip')) {
                const cross = lastChip.childNodes[1];
                if (cross.classList.contains('btn-clear')) {
                    const s = lastChip.dataset.taglabel;
                    this.tagsInput.value = s + '!';
                    cross.click();
                }
            }
        }
        if (((event.key === 'ArrowLeft') || (event.key === 'Left')) && (this.selectedFoundTag === 0)) {
            this.selectPreviousTag();
        }
        if (((event.key === 'ArrowRight') || (event.key === 'Right')) && (this.selectedFoundTag === 0)) {
            this.selectNextTag();
        }
        if ((this.selectedTag >= 0) && (event.key === 'Delete')) {
            this.DeleteSelectedTag();
        }
    },

    onTagsInputKeyUp: function (event) {
        if ((event.key === 'ArrowRight') || (event.key === 'Right')) {
            if (!event.ctrlKey) { this.addFoundTag(this.selectedFoundTag); } else {
                if ((this.foundTags.length > 1) && (this.selectedFoundTag < this.foundTags.length - 1)) {
                    this.selectNextFoundTag();
                }
            };
        }
        if (((event.key === 'ArrowLeft') || (event.key === 'Left')) && (event.ctrlKey)) {
            if ((this.foundTags.length > 1) && (this.selectedFoundTag > 0)) {
                this.selectPreviousFoundTag();
            }
        }
        if (event.key === 'Enter') {
            if (this.selectedFoundTag > 0) {
                this.addFoundTag(this.selectedFoundTag);
            } else {
                if (this.tagsInput.value.trim() !== '') {
                    this.addTag(this.tmpTagId, this.tagsInput.value.trim());
                }
            }
        };
    },

    disableTagsInput: function () {
        this.foundTags.length = 0;
        this.tagsInput.value = '';
        this.tagsInput.placeholder = Common.translate('Saving_tags');
        this.tagsInput.disabled = true;
    },

    enableTagsInput: function () {
        this.tagsInput.placeholder = Common.translate('Enter_your_tags_here');
        this.tagsInput.disabled = false;
        this.tagsInput.focus();
    },

    onFoundTagChipClick: function (event) {
        this.addTag(event.currentTarget.dataset.tagid, event.currentTarget.dataset.taglabel);
        event.currentTarget.parentNode.removeChild(event.currentTarget);
    },

    addFirstFoundTag: function () {
        if (this.foundTags.length > 0) {
            this.addTag(this.foundTags[0].id, this.foundTags[0].label);
        }
    },

    addFoundTag: function (index) {
        if (this.foundTags.length > 0) {
            this.addTag(this.foundTags[index].id, this.foundTags[index].label);
        }
    },

    addTag: function (tagid, taglabel) {
        this.disableTagsInput();
        if (this.articleTags.concat(this.dirtyTags).map(t => t.label.toUpperCase()).indexOf(taglabel.toUpperCase()) === -1) {
            this.dirtyTags.push({
                id: tagid,
                label: taglabel,
                slug: taglabel
            });
            this.tagsInputContainer.insertBefore(
                this.createTagChip(tagid, taglabel),
                this.tagsInput);
            this.enableTagsInput();
            if (tagid <= 0) {
                this.tmpTagId = this.tmpTagId - 1;
            }
            this.port.postMessage({ request: 'saveTags', articleId: this.articleId, tags: this.getSaveHtml(this.getTagsStr()), tabUrl: this.tabUrl });
            this.checkAutocompleteState();
        } else {
            this.tagsInput.placeholder = Common.translate('Tag_already_exists');
            const self = this;
            setTimeout(function () { self.enableTagsInput(); }, 1000);
        }
        this.selectedFoundTag = 0;
        this.selectedTag = -1;
    },

    deleteChip: function (ev) {
        const chip = ev.currentTarget.parentNode;
        this.deleteTag(chip);
    },

    DeleteSelectedTag: function () {
        const chip = this.tagsInputContainer.children[this.selectedTag + 1];
        this.deleteTag(chip);
        this.selectedTag = -1;
    },

    deleteTag: function (chip) {
        const tagid = chip.dataset.tagid;
        this.dirtyTags = this.dirtyTags.filter(tag => tag.id !== tagid);
        chip.parentNode.removeChild(chip);
        this.port.postMessage({ request: 'deleteArticleTag', articleId: this.articleId, tagId: tagid, tags: this.getSaveHtml(this.getTagsStr()), tabUrl: this.tabUrl });
        this.checkAutocompleteState();
        this.tagsInput.focus();
    },

    getTagsStr: function () {
        return Array.prototype.slice.call(this.tagsInputContainer.childNodes)
            .filter(e => (e.classList != null) && e.classList.contains('chip'))
            .map(e => e.dataset.taglabel).join(',');
    },

    clearAutocompleteList: function () {
        this.foundTags.length = 0;

        Array.prototype.slice.call(this.tagsAutoCompleteList.childNodes)
            .filter(e => (e.classList != null) && e.classList.contains('chip'))
            .map(e => this.tagsAutoCompleteList.removeChild(e));
    },

    findTags: function (search) {
        this.foundTags = this.allTags.filter(tag =>
            (
                (this.articleTags.concat(this.dirtyTags).map(t => t.id).indexOf(tag.id) === -1) &&
                (this.tagsInput.value.length >= 3 &&
                tag.label.toUpperCase().indexOf(this.tagsInput.value.toUpperCase()) !== -1)
            ) ||
            (
                (this.tagsInput.value === tag.label) &&
                (this.articleTags.concat(this.dirtyTags).map(t => t.label).indexOf(this.tagsInput.value) === -1)
            )
        );

        this.foundTags.map(tag => this.tagsAutoCompleteList.appendChild(this.createTagChipNoClose(tag.id, tag.label)));
        if (this.foundTags.length > 2) {
            this.selectFoundTag(0);
            this.selectedFoundTag = 0;
        }
    },

    selectTag: function (index) {
        //  alert(`index=${index} tag=${this.tagsInputContainer.children[index + 1].dataset.taglabel}`);
        [...this.tagsInputContainer.children].map(e => e.classList.remove('chip-selected'));
        if ((index >= 0) && (index < (this.articleTags.length + this.dirtyTags.length))) {
            this.tagsInputContainer.children[index + 1].classList.add('chip-selected');
        }
        this.tagsInput.focus();
    },

    selectPreviousTag: function () {
        if (this.selectedTag === -1) {
            this.selectedTag = this.articleTags.length + this.dirtyTags.length - 1;
            this.selectTag(this.selectedTag);
        } else {
            this.selectTag(--this.selectedTag);
        }
    },

    selectNextTag: function () {
        if (this.selectedTag === -1) { return; }
        if (this.selectedTag === this.articleTags.length + this.dirtyTags.length - 1) {
            this.selectTag(-1);
            this.selectedTag = -1;
        } else {
            this.selectTag(++this.selectedTag);
        }
    },

    selectFoundTag: function (index) {
        for (let i = 0; i < this.tagsAutoCompleteList.children.length; i++) {
            this.tagsAutoCompleteList.children[i].classList.remove('chip-selected');
        }
        this.tagsAutoCompleteList.children[index + 1].classList.add('chip-selected');
    },

    selectNextFoundTag: function () {
        this.selectFoundTag(++this.selectedFoundTag);
    },

    selectPreviousFoundTag: function () {
        this.selectFoundTag(--this.selectedFoundTag);
    },

    checkAutocompleteState: function () {
        if (this.foundTags.length > 0) {
            this.mainCard.classList.add('pb-30');
            this.show(this.tagsAutoCompleteList);
        } else {
            this.mainCard.classList.remove('pb-30');
            this.hide(this.tagsAutoCompleteList);
        }
    },

    onTagsInputChanged: function (e) {
        e.preventDefault();
        if (this.tagsInput.value !== '') {
            this.logger.log('backspace pressed', this.backspacePressed);
            const lastChar = this.tagsInput.value.slice(-1);
            const value = this.tagsInput.value.slice(0, -1);
            if ((lastChar === ',') || (lastChar === ';') || ((lastChar === ' ') && (!this.AllowSpaceInTags) && (this.selectedFoundTag <= 0))) {
                if (value !== '') {
                    this.addTag(this.tmpTagId, this.tagsInput.value.slice(0, -1));
                }
                this.tagsInput.value = '';
            } else if ((lastChar === ' ') && (this.selectedFoundTag > 0)) {
                this.addFoundTag(this.selectedFoundTag);
            } else {
                this.clearAutocompleteList();
                this.findTags(this.tagsInput.value);
                if ((!this.backspacePressed) && (this.AutoAddSingleTag) && (this.foundSingleTag())) {
                    this.addFoundTag(this.selectedFoundTag);
                }
            }
            this.backspacePressed = false;
        }
        this.checkAutocompleteState();
    },

    deleteArticle: function (e) {
        e.preventDefault();
        this.port.postMessage({ request: 'deleteArticle', articleId: this.articleId, tabUrl: this.tabUrl });
        this.deleteConfirmationCard.classList.remove('active');
        window.close();
    },

    cancelDelete: function (e) {
        e.preventDefault();
        this.deleteConfirmationCard.classList.remove('active');
    },

    deleteConfirmation: function (e) {
        e.preventDefault();
        this.deleteConfirmationCard.classList.add('active');
    },

    editIconClick: function (e) {
        e.preventDefault();
        if (this.isHidden(this.cardBody)) {
            this.titleInput.value = this.cardTitle.textContent;
            this.hide(this.cardHeader);
            this.show(this.cardBody);
            this.titleInput.focus();
        } else {
            this.hide(this.cardBody);
            this.show(this.cardHeader);
            this.tagsInput.focus();
        }
    },

    saveTitleClick: function (e) {
        e.preventDefault();
        this.port.postMessage({ request: 'saveTitle', articleId: this.articleId, title: this.getSaveHtml(this.titleInput.value), tabUrl: this.tabUrl });
        this.cardTitle.textContent = this.titleInput.value;
        this.hide(this.cardBody);
        this.show(this.cardHeader);
    },

    cancelTitleClick: function (e) {
        e.preventDefault();
        this.hide(this.cardBody);
        this.show(this.cardHeader);
        this.tagsInput.focus();
    },

    openUrl: function (e) {
        e.preventDefault();
        browser.tabs.create({ url: this.href });
        window.close();
    },

    _createContainerEl: function (id, label) {
        const container = document.createElement('div');
        container.setAttribute('class', 'chip');
        container.setAttribute('data-tagid', id);
        container.setAttribute('data-taglabel', label);
        container.appendChild(this._createTagEl(label));
        return container;
    },

    _createTagEl: (label) => {
        const tag = document.createElement('button');
        tag.setAttribute('class', 'chip-name');
        tag.textContent = label;
        return tag;
    },

    createTagChip: function (id, label) {
        const container = this._createContainerEl(id, label);

        const button = document.createElement('button');
        button.setAttribute('class', 'btn btn-clear');
        button.addEventListener('click', this.deleteChip.bind(this));

        container.appendChild(button);

        return container;
    },

    createTagChipNoClose: function (id, label) {
        const container = this._createContainerEl(id, label);
        container.addEventListener('click', this.onFoundTagChipClick.bind(this));
        container.setAttribute('style', 'cursor: pointer;');
        return container;
    },

    clearTagInput: function () {
        const tagsA = Array.prototype.slice.call(this.tagsInputContainer.childNodes);
        return tagsA.filter(e => (e.classList != null) && e.classList.contains('chip'))
            .map(e => { this.tagsInputContainer.removeChild(e); return 0; });
    },

    createTags: function (data) {
        this.articleTags = data;
        this.dirtyTags = this.dirtyTags.filter(tag => this.articleTags.filter(atag => atag.label.toLowerCase() === tag.label.toLowerCase()).length === 0);
        this.clearTagInput();
        this.articleTags.concat(this.dirtyTags).map(tag => this.tagsInputContainer.insertBefore(this.createTagChip(tag.id, tag.label), this.tagsInput));
    },

    setArticle: function (data) {
        this.articleId = data.id;
        if (data.title !== undefined) { this.cardTitle.textContent = this.decodeStr(data.title); }
        this.cardTitle.href = data.id === -1 ? '#' : `${this.apiUrl}/view/${this.articleId}`;
        if (data.domain_name !== undefined) { this.entryUrl.textContent = data.domain_name; }
        this.entryUrl.href = data.url;

        if (typeof (data.preview_picture) === 'string' &&
            data.preview_picture.length > 0 &&
            data.preview_picture.indexOf('http') === 0) {
            this.cardImage.classList.remove('card-image--default');
            this.cardImage.src = data.preview_picture;
        }

        if (data.is_starred !== undefined) {
            if (this.starred !== data.is_starred) {
                this.toggleIcon(this.starredIcon);
            }
            this.starred = data.is_starred;
        }
        if (data.is_archived !== undefined) {
            if (this.archived !== data.is_archived) {
                this.toggleIcon(this.archivedIcon);
            }
            this.archived = data.is_archived;
        }
        if (data.id === -1 && data.tagList !== undefined) {
            this.dirtyTags = data.tagList.split(',').map(taglabel => {
                this.tmpTagId = this.tmpTagId - 1;
                return {
                    id: this.tmpTagId,
                    label: taglabel,
                    slug: taglabel
                };
            });
            this.createTags([]);
        } else {
            this.createTags(data.tags);
        }
        this.enableTagsInput();
    },

    messageListener: function (msg) {
        switch (msg.response) {
            case 'info':
                this.showInfo(msg.text);
                break;
            case 'error':
                this.showError(msg.error.message);
                break;
            case 'article':
                this.hide(this.infoToast);
                if (msg.article !== null) {
                    this.setArticle(msg.article);
                    this.show(this.mainCard);
                } else {
                    this.showError(Common.translate('Error_empty_data'));
                }
                break;
            case 'tags':
                this.allTags = msg.tags;
                break;
            case 'setup':
                this.AllowSpaceInTags = msg.data.AllowSpaceInTags || 0;
                this.AutoAddSingleTag = msg.data.AutoAddSingleTag || 0;
                this.apiUrl = msg.data.Url;
                this.afterSetup();
                break;
            case 'articleTags':
                this.createTags(msg.tags);
                break;
            case 'action':
                this.archived = msg.value.archived;
                this.starred = msg.value.starred;
                break;
            case 'close':
                window.close();
                break;
            case PortManager.backgroundPortIsConnectedEventName:
                this.logger.log(PortManager.backgroundPortIsConnectedEventName);
                this.port.backgroundPortIsConnected();
                break;
            default:
                this.logger.error('unknown message:', msg);
        };
    },

    init: function () {
        this.port = new PortManager('popup', this.messageListener.bind(this), this.logger);
        this.port.postMessage({ request: 'setup' });
    },

    showError: function (infoString) {
        this.hide(this.infoToast);
        this.hide(this.mainCard);
        this.errorToast.textContent = infoString;
        this.show(this.errorToast);
    },

    showInfo: function (infoString) {
        this.infoToast.textContent = infoString;
        this.show(this.infoToast);
    },

    hide: function (element) {
        element.classList.add('d-hide');
    },

    show: function (element) {
        element.classList.remove('d-hide');
    },

    isHidden: function (element) {
        return element.classList.contains('d-hide');
    },

    afterSetup: function () {
        this.port.postMessage({ request: 'tags' });
        this.saveArticle();
    },

    saveArticle: function () {
        this.browserUtils.getActiveTab().then(tab => {
            if (this.browserUtils.isServicePage(tab.url, this.apiUrl)) {
                this.showError(Common.translate('Service_pages_can_t_be_stored'));
                return;
            }
            this.tabUrl = tab.url;
            this.cardTitle.textContent = tab.title;
            try {
                this.entryUrl.textContent = /(\w+:\/\/)([^/]+)\/(.*)/.exec(tab.url)[2];
            } catch (error) {
                this.showError(error);
            }
            this.enableTagsInput();

            browser.runtime.onMessage.addListener(event => {
                if (typeof event.wallabagSaveArticleContent === 'undefined') {
                    return;
                }

                this.logger.log('postMessage');
                const saveMsg = { request: 'save', tabUrl: tab.url, title: tab.title, content: event.wallabagSaveArticleContent };
                if (event.wallabagMetadata) {
                    if (event.wallabagMetadata.author) saveMsg.author = event.wallabagMetadata.author;
                    if (event.wallabagMetadata.publishedAt) saveMsg.publishedAt = event.wallabagMetadata.publishedAt;
                }
                this.port.postMessage(saveMsg);
            });

            try {
                const isLocalFetchAction = !this.browserUtils.isRestrictedPage(tab.url);
                if (isLocalFetchAction) {
                    browser.scripting.executeScript({
                        target: { tabId: tab.id },
                        // Note: this function runs in the page's isolated context.
                        // It must be self-contained (no imports, no closure variables).
                        func: () => {
                            const doc = window.document;
                            const metadata = {};

                            // Helper: recursively find a key in a nested object/array
                            const findInObj = (obj, key, depth) => {
                                if (depth > 6 || typeof obj !== 'object' || !obj) return null;
                                if (Array.isArray(obj)) {
                                    for (const item of obj) {
                                        const r = findInObj(item, key, depth + 1);
                                        if (r != null) return r;
                                    }
                                } else {
                                    if (key in obj) return obj[key];
                                    for (const v of Object.values(obj)) {
                                        const r = findInObj(v, key, depth + 1);
                                        if (r != null) return r;
                                    }
                                }
                                return null;
                            };

                            // Helper: parse a date string to ISO 8601 via Date()
                            const parseToIso = (val) => {
                                if (!val) return null;
                                try {
                                    const d = new Date(val);
                                    if (!isNaN(d.getTime()) && d.getFullYear() > 1990) return d.toISOString();
                                } catch (e) {}
                                return null;
                            };

                            // --- Twitter/X specific extraction ---
                            const isTwitter = /^(twitter|x)\.com$/.test(window.location.hostname);
                            if (isTwitter) {
                                // Build <p> elements from a tweetText element's text content.
                                // Twitter stores paragraph breaks as \n\n in text, not as HTML block elements.
                                const buildParaParts = (el) => {
                                    const text = (el.innerText || el.textContent || '');
                                    const paragraphs = text.split(/\n\n+/);
                                    const parts = [];
                                    for (const para of paragraphs) {
                                        const trimmed = para.trim();
                                        if (!trimmed) continue;
                                        const lines = trimmed.split('\n').filter(l => l.trim());
                                        const escaped = lines.map(l => l.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;'));
                                        parts.push(`<p>${escaped.join('<br>')}</p>`);
                                    }
                                    return parts;
                                };

                                // Extract linked article URL and headline from a tweet's card preview, if present.
                                const extractArticleCard = (article) => {
                                    const card = article.querySelector('[data-testid="card.wrapper"]');
                                    if (!card) return { url: null, headline: null };
                                    const anchor = card.querySelector('a[role="link"]');
                                    if (!anchor) return { url: null, headline: null };
                                    const url = (anchor.getAttribute('href') || '').trim() || null;
                                    if (!url) return { url: null, headline: null };
                                    // Primary: parse headline from aria-label "domain.com Headline text"
                                    let headline = null;
                                    const aria = anchor.getAttribute('aria-label') || '';
                                    const ariaParts = aria.split(' ');
                                    if (ariaParts.length >= 2) {
                                        const candidate = ariaParts.slice(1).join(' ').trim();
                                        if (candidate) headline = candidate;
                                    }
                                    // Fallback: first non-empty innermost span text
                                    if (!headline) {
                                        for (const span of anchor.querySelectorAll('span')) {
                                            if (span.querySelector('span')) continue; // skip wrappers
                                            const text = span.textContent.trim();
                                            if (text) { headline = text; break; }
                                        }
                                    }
                                    return { url, headline };
                                };

                                // Extract author handle from UserAvatar-Container-{handle} data-testid.
                                const extractHandle = (article) => {
                                    const avatar = article.querySelector('[data-testid^="UserAvatar-Container-"]');
                                    if (!avatar) return null;
                                    const testid = avatar.getAttribute('data-testid') || '';
                                    const prefix = 'UserAvatar-Container-';
                                    return testid.startsWith(prefix) ? testid.slice(prefix.length) : null;
                                };

                                // Extract "Display Name (@handle)" from a User-Name element.
                                const extractAuthorFromUserName = (el) => {
                                    let displayName = null, handle = null;
                                    const spans = el.querySelectorAll('span');
                                    for (const span of spans) {
                                        if (span.querySelector('span')) continue; // skip wrappers
                                        const text = span.textContent.trim();
                                        if (!text) continue;
                                        if (text.startsWith('@') && !handle) handle = text;
                                        else if (!text.startsWith('@') && !displayName) displayName = text;
                                        if (displayName && handle) break;
                                    }
                                    if (displayName && handle) return `${displayName} (${handle})`;
                                    return displayName || handle;
                                };

                                // Extract <img> elements for photos attached to a tweet article.
                                const extractTweetPhotos = (article) => {
                                    const imgs = [];
                                    for (const div of article.querySelectorAll('[data-testid="tweetPhoto"]')) {
                                        for (const img of div.querySelectorAll('img[src]')) {
                                            let src = (img.getAttribute('src') || '').trim();
                                            if (!src) continue;
                                            src = src.replace(/name=small\b/, 'name=large').replace(/name=medium\b/, 'name=large');
                                            const alt = (img.getAttribute('alt') || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                            const escapedSrc = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                                            imgs.push(`<img src="${escapedSrc}" alt="${alt}" style="max-width:100%;">`);
                                        }
                                    }
                                    return imgs;
                                };

                                const tweetDivs = [...doc.querySelectorAll('[data-testid="tweetText"]')];
                                if (tweetDivs.length > 0) {
                                    const articles = [...doc.querySelectorAll('article[data-testid="tweet"]')];
                                    const outputParts = [];

                                    if (articles.length > 0) {
                                        // Article-based extraction: detect thread (consecutive same-author articles)
                                        const firstHandle = extractHandle(articles[0]);
                                        const threadArticles = [];
                                        for (const article of articles) {
                                            if (firstHandle && extractHandle(article) === firstHandle) {
                                                threadArticles.push(article);
                                            } else {
                                                break;
                                            }
                                        }

                                        for (let i = 0; i < threadArticles.length; i++) {
                                            const article = threadArticles[i];
                                            const articleTweetDivs = [...article.querySelectorAll('[data-testid="tweetText"]')];
                                            const userNames = [...article.querySelectorAll('[data-testid="User-Name"]')];
                                            if (!articleTweetDivs.length) continue;
                                            if (i > 0) outputParts.push('<hr>');
                                            for (let j = 0; j < articleTweetDivs.length; j++) {
                                                const parts = buildParaParts(articleTweetDivs[j]);
                                                if (j === 0) {
                                                    outputParts.push(...parts);
                                                    outputParts.push(...extractTweetPhotos(article));
                                                } else {
                                                    outputParts.push('<hr>');
                                                    const quotedAuthor = j < userNames.length ? extractAuthorFromUserName(userNames[j]) : null;
                                                    const header = quotedAuthor ? `<p><strong>Quoting ${quotedAuthor}</strong></p>` : '<p><strong>Quoted tweet</strong></p>';
                                                    outputParts.push(header, '<blockquote>', ...parts, '</blockquote>');
                                                }
                                            }
                                            // Append linked article annotation if tweet has a card
                                            const { url: cardUrl, headline: cardHeadline } = extractArticleCard(article);
                                            if (cardUrl) {
                                                const escapedUrl = cardUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                                                const linkText = (cardHeadline || cardUrl).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                                outputParts.push(`<p><em>Linking to: <a href="${escapedUrl}">${linkText}</a></em></p>`);
                                            }
                                        }
                                    }

                                    if (outputParts.length === 0) {
                                        // Fallback flat extraction when no article elements found
                                        const userNameEls = [...doc.querySelectorAll('[data-testid="User-Name"]')];
                                        for (let i = 0; i < tweetDivs.length; i++) {
                                            const parts = buildParaParts(tweetDivs[i]);
                                            if (i === 0) {
                                                outputParts.push(...parts);
                                                // Extract photos from tweetPhoto elements (flat path, no article elements)
                                                for (const div of doc.querySelectorAll('[data-testid="tweetPhoto"]')) {
                                                    for (const img of div.querySelectorAll('img[src]')) {
                                                        let src = (img.getAttribute('src') || '').trim();
                                                        if (!src) continue;
                                                        src = src.replace(/name=small\b/, 'name=large').replace(/name=medium\b/, 'name=large');
                                                        const alt = (img.getAttribute('alt') || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                                        const escapedSrc = src.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                                                        outputParts.push(`<img src="${escapedSrc}" alt="${alt}" style="max-width:100%;">`);
                                                    }
                                                }
                                            } else {
                                                outputParts.push('<hr>');
                                                const quotedAuthor = i < userNameEls.length ? extractAuthorFromUserName(userNameEls[i]) : null;
                                                const header = quotedAuthor ? `<p><strong>Quoting ${quotedAuthor}</strong></p>` : '<p><strong>Quoted tweet</strong></p>';
                                                outputParts.push(header, '<blockquote>', ...parts, '</blockquote>');
                                            }
                                        }
                                        // Card annotations for flat path (no article elements)
                                        for (const card of doc.querySelectorAll('[data-testid="card.wrapper"]')) {
                                            const anchor = card.querySelector('a[role="link"]');
                                            if (!anchor) continue;
                                            const cardUrl = (anchor.getAttribute('href') || '').trim();
                                            if (!cardUrl) continue;
                                            let cardHeadline = null;
                                            const aria = anchor.getAttribute('aria-label') || '';
                                            const ariaParts = aria.split(' ');
                                            if (ariaParts.length >= 2) {
                                                const candidate = ariaParts.slice(1).join(' ').trim();
                                                if (candidate) cardHeadline = candidate;
                                            }
                                            if (!cardHeadline) {
                                                for (const span of anchor.querySelectorAll('span')) {
                                                    if (span.querySelector('span')) continue;
                                                    const text = span.textContent.trim();
                                                    if (text) { cardHeadline = text; break; }
                                                }
                                            }
                                            const escapedUrl = cardUrl.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
                                            const linkText = (cardHeadline || cardUrl).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                            outputParts.push(`<p><em>Linking to: <a href="${escapedUrl}">${linkText}</a></em></p>`);
                                        }
                                    }

                                    // Extract author from first User-Name element
                                    const userNameEl = doc.querySelector('[data-testid="User-Name"]');
                                    if (userNameEl) metadata.author = extractAuthorFromUserName(userNameEl);

                                    // Extract date from first time[datetime]
                                    const timeEl = doc.querySelector('time[datetime]');
                                    if (timeEl) {
                                        let dt = timeEl.getAttribute('datetime') || '';
                                        if (dt.endsWith('Z')) dt = dt.slice(0, -1) + '+00:00';
                                        const iso = parseToIso(dt);
                                        if (iso) metadata.publishedAt = iso;
                                    }

                                    chrome.runtime.sendMessage({
                                        wallabagSaveArticleContent: `<div class="twitter-content">${outputParts.join('')}</div>`,
                                        wallabagMetadata: metadata
                                    });
                                    return;
                                }
                                // No tweetText elements found — fall through to generic extraction
                            }

                            // --- Facebook specific extraction ---
                            const isFacebook = /^(www\.)?facebook\.com$/.test(window.location.hostname);
                            if (isFacebook) {
                                // HTML-escape plain text for insertion into <p> bodies
                                const escText = (s) => (s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

                                // Extract author name from page title
                                const extractFbAuthorFromTitle = (title) => {
                                    let m = (title || '').match(/^\(\d+\)\s+(.+?)\s+-\s+/);
                                    if (m) return m[1];
                                    m = (title || '').match(/^(.+?)\s+-\s+/);
                                    if (m) {
                                        const candidate = m[1];
                                        if (candidate && candidate.length < 100 && !candidate.toLowerCase().includes('facebook.com'))
                                            return candidate;
                                    }
                                    return null;
                                };

                                // Skip the "Notifications" panel dialog; return first non-notifications dialog
                                const findFbMainDialog = (dialogs) => {
                                    for (const d of dialogs) {
                                        if (!d.textContent.trim().startsWith('Notifications')) return d;
                                    }
                                    return dialogs[0];
                                };

                                // Find the author profile link inside the dialog
                                const findFbAuthorLink = (dialog, authorName) => {
                                    const anchors = [...dialog.querySelectorAll('a[href]')];
                                    // First pass: match by extracted author name
                                    if (authorName) {
                                        for (const a of anchors) {
                                            const href = a.getAttribute('href') || '';
                                            if (!href.includes('comment_id') && a.textContent.trim() === authorName)
                                                return a;
                                        }
                                    }
                                    // Fallback: first profile-like link
                                    const skip = new Set(['Facebook', 'Like', 'Comment', 'Share', '']);
                                    for (const a of anchors) {
                                        const href = a.getAttribute('href') || '';
                                        const text = a.textContent.trim();
                                        if (!href.includes('comment_id')
                                            && href.includes('facebook.com/')
                                            && text.length > 1
                                            && !skip.has(text)
                                            && !text.startsWith('http'))
                                            return a;
                                    }
                                    return null;
                                };

                                // Walk up from authorLink to find the post content container
                                const findFbPostContent = (authorLink) => {
                                    let parent = authorLink;
                                    for (let i = 0; i < 30; i++) {
                                        parent = parent.parentElement;
                                        if (!parent) break;
                                        const sib = parent.nextElementSibling;
                                        if (sib) {
                                            const text = sib.textContent;
                                            if (text.length > 200
                                                && !text.includes('LikeCommentShare')
                                                && !text.includes('All reactions'))
                                                return sib;
                                        }
                                    }
                                    return null;
                                };

                                // Extract post text as <p> elements, preserving Facebook's paragraph structure
                                const extractFbParagraphs = (node) => {
                                    const parts = [];
                                    // Facebook renders each paragraph as a leaf div[dir][style]
                                    const paraDivs = [...node.querySelectorAll('div[dir][style]')];
                                    const leafDivs = paraDivs.filter(d => d.querySelector('div[dir][style]') === null);
                                    if (leafDivs.length > 0) {
                                        for (const d of leafDivs) {
                                            const text = d.textContent.trim();
                                            if (text) parts.push(`<p>${escText(text)}</p>`);
                                        }
                                    } else {
                                        // Fallback: split textContent on double newlines
                                        const raw = node.textContent.trim();
                                        if (raw) {
                                            for (const para of raw.split(/\n\n+/)) {
                                                const trimmed = para.trim();
                                                if (!trimmed) continue;
                                                const lines = trimmed.split('\n').filter(l => l.trim()).map(l => escText(l.trim()));
                                                if (lines.length) parts.push(`<p>${lines.join('<br>')}</p>`);
                                            }
                                        }
                                    }
                                    return parts;
                                };

                                // Extract source name and article text from a shared content card
                                const extractFbSharedCard = (cardNode) => {
                                    let sourceName = null;
                                    let articleText = null;
                                    const h4s = [...cardNode.querySelectorAll('h4')];
                                    let targetH4 = null;
                                    for (const h4 of h4s) {
                                        const firstLink = h4.querySelector('a');
                                        if (firstLink) {
                                            sourceName = firstLink.textContent.trim() || null;
                                            targetH4 = h4;
                                            break;
                                        }
                                    }
                                    if (targetH4) {
                                        let node = targetH4;
                                        for (let i = 0; i < 15; i++) {
                                            const sib = node.nextElementSibling;
                                            if (sib) {
                                                const text = sib.textContent.trim();
                                                if (text.length > 50 && !text.includes('Shared with')) {
                                                    articleText = text;
                                                    break;
                                                }
                                            }
                                            node = node.parentElement;
                                            if (!node) break;
                                        }
                                    }
                                    return { sourceName, articleText };
                                };

                                // Extract post creation time from embedded JSON in the page source
                                const extractFbCreationTime = (authorLink) => {
                                    const href = authorLink.getAttribute('href') || '';
                                    let slug;
                                    try {
                                        slug = new URL(href).pathname.replace(/^\/|\/$/g, '');
                                    } catch (e) {
                                        slug = href.replace(/^.*facebook\.com\//, '').replace(/\/$/, '');
                                    }
                                    if (!slug) return null;
                                    const escapedSlug = slug.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
                                    // Facebook JSON-encodes slashes as \/ in inline script blobs
                                    const pattern = new RegExp(
                                        '"story":\\{"creation_time":(\\d+),"url":"https:\\\\/\\\\/www\\.facebook\\.com\\\\/' +
                                        escapedSlug + '\\\\/'
                                    );
                                    const m = window.document.documentElement.innerHTML.match(pattern);
                                    if (!m) return null;
                                    return new Date(parseInt(m[1], 10) * 1000).toISOString();
                                };

                                // --- Main Facebook extraction logic ---
                                const pageTitle = doc.title || '';
                                const authorFromTitle = extractFbAuthorFromTitle(pageTitle);

                                const allDialogs = [...doc.querySelectorAll('div[role="dialog"]')];
                                if (allDialogs.length > 0) {
                                    const mainDialog = findFbMainDialog(allDialogs);
                                    const authorLink = findFbAuthorLink(mainDialog, authorFromTitle);

                                    if (authorLink !== null) {
                                        const author = authorFromTitle || authorLink.textContent.trim() || null;
                                        const postContentNode = findFbPostContent(authorLink);

                                        if (postContentNode !== null) {
                                            // Split main post text from optional shared content card
                                            const elementChildren = [...postContentNode.children];
                                            let mainTextNode, sharedCardNode;
                                            if (elementChildren.length === 0) {
                                                mainTextNode = postContentNode;
                                                sharedCardNode = null;
                                            } else if (elementChildren.length === 1) {
                                                mainTextNode = elementChildren[0];
                                                sharedCardNode = null;
                                            } else {
                                                mainTextNode = elementChildren[0];
                                                const candidate = elementChildren[1];
                                                sharedCardNode = candidate.textContent.trim().length > 50 ? candidate : null;
                                            }

                                            const outputParts = extractFbParagraphs(mainTextNode);

                                            if (sharedCardNode !== null) {
                                                const { sourceName, articleText } = extractFbSharedCard(sharedCardNode);
                                                if (articleText) {
                                                    outputParts.push('<hr>');
                                                    const label = sourceName ? `Shared: ${sourceName}` : 'Shared content';
                                                    outputParts.push(`<p><strong>${escText(label)}</strong></p>`);
                                                    outputParts.push('<blockquote>');
                                                    for (const para of articleText.split(/\n\n+/)) {
                                                        const t = para.trim();
                                                        if (t) outputParts.push(`<p>${escText(t)}</p>`);
                                                    }
                                                    outputParts.push('</blockquote>');
                                                }
                                            }

                                            if (outputParts.length > 0) {
                                                if (author) metadata.author = author;

                                                // publishedAt: try embedded JSON first, then <time datetime>
                                                const creationTime = extractFbCreationTime(authorLink);
                                                if (creationTime) {
                                                    metadata.publishedAt = creationTime;
                                                } else {
                                                    const timeEl = doc.querySelector('time[datetime]');
                                                    if (timeEl) {
                                                        let dt = timeEl.getAttribute('datetime') || '';
                                                        if (dt.endsWith('Z')) dt = dt.slice(0, -1) + '+00:00';
                                                        const iso = parseToIso(dt);
                                                        if (iso) metadata.publishedAt = iso;
                                                    }
                                                }

                                                chrome.runtime.sendMessage({
                                                    wallabagSaveArticleContent: `<div class="facebook-content">${outputParts.join('')}</div>`,
                                                    wallabagMetadata: metadata
                                                });
                                                return;
                                            }
                                            // outputParts empty — fall through to generic extraction
                                        }
                                        // postContentNode not found — fall through to generic extraction
                                    }
                                    // authorLink not found — fall through to generic extraction
                                }
                                // No dialogs or all fallthrough paths — generic extraction continues
                            }

                            // --- LinkedIn specific extraction ---
                            const isLinkedIn = /^(www\.)?linkedin\.com$/.test(window.location.hostname);
                            if (isLinkedIn) {
                                // Author: actor meta link aria-label e.g. "View: Jane Smith Premium • ..."
                                const extractLinkedInAuthor = () => {
                                    const links = doc.querySelectorAll('[class*="update-components-actor__meta-link"]');
                                    for (const link of links) {
                                        let aria = (link.getAttribute('aria-label') || '').trim();
                                        if (aria.startsWith('View:')) {
                                            let name = aria.slice('View:'.length).trim();
                                            const m = name.match(/^(.+?)(?:\s+(?:Premium|Creator|Open to Work|Hiring)\s*•|\s*•)/);
                                            if (m) return m[1].trim();
                                            if (name.includes(' • ')) return name.split(' • ')[0].trim();
                                            return name;
                                        }
                                    }
                                    // Fallback: actor title span
                                    const titles = doc.querySelectorAll('[class*="update-components-actor__title"]');
                                    for (const el of titles) {
                                        const text = el.textContent.trim();
                                        if (text) return text.split('\n')[0].trim();
                                    }
                                    return null;
                                };

                                const linkedInAuthor = extractLinkedInAuthor();
                                if (linkedInAuthor) metadata.author = linkedInAuthor;

                                // Content: update-components-update-v2__commentary
                                const commentaryEl = doc.querySelector('[class*="update-components-update-v2__commentary"]');
                                if (commentaryEl) {
                                    const escText = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
                                    const collectText = (el) => {
                                        const parts = [];
                                        if (el.nodeType === Node.TEXT_NODE) return [el.textContent];
                                        for (const child of el.childNodes) {
                                            if (child.nodeName === 'BR') { parts.push('\n'); }
                                            else { parts.push(...collectText(child)); }
                                        }
                                        return parts;
                                    };
                                    const raw = collectText(commentaryEl).join('').trim();
                                    if (raw) {
                                        const outputParts = [];
                                        for (const para of raw.split(/\n\n+/)) {
                                            const lines = para.split('\n').map(l => l.trim()).filter(Boolean);
                                            if (lines.length) outputParts.push(`<p>${lines.map(escText).join('<br>')}</p>`);
                                        }
                                        if (outputParts.length) {
                                            chrome.runtime.sendMessage({
                                                wallabagSaveArticleContent: `<div class="linkedin-content">${outputParts.join('')}</div>`,
                                                wallabagMetadata: metadata
                                            });
                                            return;
                                        }
                                    }
                                }
                                // Commentary not found or empty — fall through to generic extraction
                            }

                            // --- thedispatch.com toolbar cleanup and content extraction ---
                            const isDispatch = /thedispatch\.com$/.test(window.location.hostname);
                            const dispatchBody = isDispatch ? doc.getElementById('article-body') : null;
                            if (isDispatch) {
                                // Remove the article action toolbar (audio, text size, gift, share, comments).
                                // The toolbar is not article content; its tooltip divs survive server-side
                                // sanitization and appear as junk text in the saved article.
                                const audioTooltip = doc.getElementById('audio-tooltip');
                                if (audioTooltip) {
                                    // Walk up to find the toolbar container (the outermost div ancestor
                                    // that is a direct child of a semantic content element or body).
                                    let toolbar = audioTooltip;
                                    while (toolbar.parentElement && toolbar.parentElement !== doc.body) {
                                        const parent = toolbar.parentElement;
                                        // Stop when the parent is a semantic content element
                                        if (['ARTICLE', 'MAIN', 'SECTION'].includes(parent.tagName)) break;
                                        toolbar = parent;
                                    }
                                    toolbar.remove();
                                }
                            }

                            // --- Extract author ---
                            // 1. JSON-LD
                            for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
                                try {
                                    const data = JSON.parse(script.textContent);
                                    const author = findInObj(data, 'author', 0);
                                    if (author) {
                                        if (typeof author === 'string' && author.trim()) {
                                            metadata.author = author.trim(); break;
                                        }
                                        if (!Array.isArray(author) && typeof author === 'object' && author.name) {
                                            metadata.author = author.name; break;
                                        }
                                        if (Array.isArray(author) && author[0]) {
                                            if (typeof author[0] === 'string') { metadata.author = author[0]; break; }
                                            if (author[0].name) { metadata.author = author[0].name; break; }
                                        }
                                    }
                                } catch (e) {}
                            }
                            // 2. Meta tags
                            if (!metadata.author) {
                                for (const name of ['author', 'article:author', 'og:article:author']) {
                                    const meta = doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                                    const val = meta && meta.getAttribute('content');
                                    if (val && val.trim()) { metadata.author = val.trim(); break; }
                                }
                            }
                            // 3. Semantic byline elements
                            if (!metadata.author) {
                                for (const sel of ['[rel="author"]', '[itemprop="author"]', '.byline', '.author-name', '.author']) {
                                    const el = doc.querySelector(sel);
                                    const text = el && el.textContent && el.textContent.trim();
                                    if (text && text.length > 0 && text.length < 100) { metadata.author = text; break; }
                                }
                            }

                            // --- Extract published date ---
                            // 1. JSON-LD
                            for (const script of doc.querySelectorAll('script[type="application/ld+json"]')) {
                                try {
                                    const data = JSON.parse(script.textContent);
                                    for (const key of ['datePublished', 'publishedAt', 'published_at', 'dateModified']) {
                                        const val = findInObj(data, key, 0);
                                        if (val && typeof val === 'string') {
                                            const iso = parseToIso(val.trim());
                                            if (iso) { metadata.publishedAt = iso; break; }
                                        }
                                    }
                                } catch (e) {}
                                if (metadata.publishedAt) break;
                            }
                            // 2. Meta tags
                            if (!metadata.publishedAt) {
                                for (const name of ['article:published_time', 'og:article:published_time', 'published_time', 'date', 'DC.date.issued']) {
                                    const meta = doc.querySelector(`meta[name="${name}"], meta[property="${name}"]`);
                                    const val = meta && meta.getAttribute('content');
                                    if (val && val.trim()) {
                                        const iso = parseToIso(val.trim());
                                        if (iso) { metadata.publishedAt = iso; break; }
                                    }
                                }
                            }
                            // 3. <article> element data-* attributes
                            if (!metadata.publishedAt) {
                                const article = doc.querySelector('article');
                                if (article) {
                                    for (const attr of ['data-published', 'data-published-at', 'data-publish-date', 'data-publish-time', 'data-publication-date', 'data-last-updated', 'data-updated', 'data-created']) {
                                        const val = article.getAttribute(attr);
                                        if (val) {
                                            const iso = parseToIso(val.trim());
                                            if (iso) { metadata.publishedAt = iso; break; }
                                        }
                                    }
                                }
                            }
                            // 4. <time datetime> elements (prefer those in headers or with pub-related class names)
                            if (!metadata.publishedAt) {
                                const pubClasses = ['pubdate', 'publish', 'published', 'date', 'timestamp', 'post-date'];
                                let best = null;
                                let bestScore = -1;
                                for (const el of doc.querySelectorAll('time[datetime]')) {
                                    const dt = el.getAttribute('datetime');
                                    if (!dt || !dt.trim()) continue;
                                    let score = 0;
                                    const cls = (el.className || '').toLowerCase();
                                    if (pubClasses.some(t => cls.includes(t))) score += 2;
                                    let parent = el.parentElement;
                                    while (parent) {
                                        if (parent.tagName === 'HEADER') { score += 1; break; }
                                        parent = parent.parentElement;
                                    }
                                    if (score > bestScore) { bestScore = score; best = dt.trim(); }
                                }
                                if (best) {
                                    const iso = parseToIso(best);
                                    if (iso) metadata.publishedAt = iso;
                                }
                            }

                            chrome.runtime.sendMessage({
                                wallabagSaveArticleContent: dispatchBody
                                    ? dispatchBody.innerHTML
                                    : window.document.documentElement.innerHTML,
                                wallabagMetadata: metadata
                            });
                        }
                    });
                } else {
                    this.port.postMessage({ request: 'save', tabUrl: tab.url });
                }
            } catch (error) {
                this.showError(error);
            }
        });
    },

    foundSingleTag: function () {
        return this.foundTags.length === 1;
    }

};

Common.translateAll();
const PC = new PopupController();
PC.init();
