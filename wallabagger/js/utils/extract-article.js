'use strict';

/**
 * Collects the article content and metadata of the page it runs in.
 *
 * Injected with browser.scripting.executeScript({ func: extractArticleFromPage }), which
 * serialises it to a string and runs it in the page's isolated world. It must therefore
 * stay entirely self-contained: no imports, no closure variables, no references to
 * anything in module scope.
 *
 * Returns { wallabagSaveArticleContent, wallabagMetadata } and also posts that payload
 * with chrome.runtime.sendMessage, because the popup consumes it via a message listener
 * while the background's callers read executeScript's InjectionResult.
 */
const extractArticleFromPage = () => {
    const doc = window.document;
    const metadata = {};

    // --- Generic: strip ad containers and third-party content-recommendation
    // widgets (Outbrain, Taboola). Not gated by hostname — aria-label="Advertisement"
    // is a standard a11y convention for ad slots, and Outbrain/Taboola widget
    // markup is identical across every site that embeds them.
    for (const el of doc.querySelectorAll('[aria-label*="advertisement" i], .OUTBRAIN, [id^="outbrain"], .trc_rr_container, [id^="taboola"], .taboola')) {
        el.remove();
    }

    // --- Generic: strip embedded video players ---
    // A JS video player renders its whole UI as real DOM: a shortcut-help
    // table, a caption-settings menu of colour/font/opacity options, a
    // related-videos rail, a "Next Up" teaser. All of that is genuine text, so
    // wallabag's extractor keeps it and the saved entry opens on the player's
    // menus rather than on the article. The video itself is unsavable anyway —
    // its src is a blob: URL bound to the live page.
    //
    // Not gated by hostname, for the same reason as the ad/recirc rule above:
    // each of these classes is the player library's own root class and its
    // markup is identical wherever it is embedded. Removing the root takes the
    // entire chrome subtree with it — on a Reuters article that is 429
    // elements holding no article text at all.
    //
    // Audio-only variants are deliberately excluded (no .plyr--audio, no
    // .mejs-container): the "listen to this article" rule below anchors on an
    // accessible name precisely so that a legitimate embedded podcast player
    // survives, and this rule keeps that promise.
    for (const el of doc.querySelectorAll('.jwplayer, .video-js, .plyr--video, .flowplayer')) {
        el.remove();
    }

    // --- Generic: strip Tailwind's bare "hidden"/"invisible" visibility-utility
    // class tokens (not their breakpoint-prefixed variants like "lg:block" or
    // "md:hidden", which are left alone). These tokens are meaningless without
    // Tailwind's own generated CSS, but many other CSS frameworks — including,
    // commonly, a reader theme's own stylesheet — define an unconditional same-
    // named utility (`.hidden { display: none }`, `.invisible { visibility:
    // hidden }`). A page that server-renders desktop/mobile variants behind
    // Tailwind's "hidden <breakpoint>:block" idiom then has its entire content
    // silently hidden once saved, even though the HTML still contains it in full.
    for (const el of doc.querySelectorAll('.hidden, .invisible')) {
        el.classList.remove('hidden', 'invisible');
    }

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

    // --- nationalreview.com cleanup ---
    const isNationalReview = /(^|\.)nationalreview\.com$/.test(window.location.hostname);
    if (isNationalReview) {
        // Strip the Carbonatix audio player, in-article "more from author"/ad
        // asides, share/comment button bars, the trailing comments widget
        // (and its scripts), and the "Most Popular" recirc article cards that
        // follow the real article — none of this is article content, but it
        // survives server-side extraction and pollutes the saved article.
        //
        // NR's own JavaScript relocates the share/comment controls out of
        // .article-share-bar before we capture the DOM, so the share button
        // reappears as .floating-share-buttons (a bare "Share" stranded after
        // the hero caption) and the comments toggle as .article-author--right
        // (a "352 Comments" button beside the byline). Both classes are absent
        // from the server markup and exist only in the live DOM, which is why
        // matching the static container alone misses them. The byline name and
        // the <time> we read publishedAt from sit in the sibling
        // .article-author--left, so dropping the right column keeps them.
        //
        // The tail of the page is likewise not article text: the "Next Article"
        // recirc link (a <span>, so the generic recirc-heading rule below never
        // sees it), the author-bio footer, and the Insticator comment panel,
        // whose nested divs render as an empty block. Removing all of it lets
        // the entry end on the article's last paragraph.
        for (const el of doc.querySelectorAll('.tts-player, .article-share-bar, .floating-share-buttons, .article-author--right, button.comments-toggle, aside, article.post-list-article, .article-below-content, .article-next-up, .article-footer-authors, .insticator-unit')) {
            el.remove();
        }
    }

    // --- Brix-template (POLITICO CMS) right rail + newsletter signup cleanup ---
    // Feature-detected via the template's own data-testid rather than hostname,
    // so it also covers other properties built on the same Brix templates.
    // The right column is a purely decorative ad/promo rail — a plain DOM
    // sibling of the real article content, with nothing marking it as
    // non-article — and the newsletter form is a promotional insert with no
    // article text of its own. Neither is article content, but both survive
    // server-side extraction and pollute the saved article.
    if (doc.querySelector('[data-testid="article-column-right"]')) {
        for (const el of doc.querySelectorAll('[data-testid="article-column-right"], .newsletter-signup')) {
            el.remove();
        }
    }

    // --- Generic: strip "listen to article" / "keep reading" widgets ---
    // Walk up from a marker element to the nearest ancestor whose *parent* is
    // a semantic content boundary, then remove that ancestor — the same
    // toolbar-removal shape as the thedispatch.com rule above, generalized so
    // it isn't tied to one site's markup.
    // Walking up to the child of the nearest ARTICLE/MAIN/SECTION assumes the widget
    // being removed sits in a shallow wrapper of its own. On a page whose whole story
    // is in one container inside <article>, that assumption deletes the article: a
    // single stray "listen to this article" button or "Keep reading" heading anywhere
    // inside is enough. Nothing downstream notices, because the page still has a head,
    // scripts and a headline - only the body is gone, and wallabag then stores its
    // "can't retrieve contents" placeholder for a save that looked successful.
    //
    // So bound it by how much text the candidate holds: keep climbing only while the
    // block stays small relative to the content root, and refuse to remove one that
    // does not. Short pages still work, since anything under the absolute floor is
    // removable whatever its share of the page.
    const MAX_REMOVABLE_TEXT_RATIO = 0.25;
    const MIN_ALWAYS_REMOVABLE_TEXT = 400;
    const textLength = (el) => (el.textContent || '').replace(/\s+/g, ' ').trim().length;

    const removeAncestorBlock = (el) => {
        const budget = Math.max(MIN_ALWAYS_REMOVABLE_TEXT, textLength(contentRoot) * MAX_REMOVABLE_TEXT_RATIO);
        let node = el;
        while (node.parentElement && node.parentElement !== doc.body) {
            const parent = node.parentElement;
            if (['ARTICLE', 'MAIN', 'SECTION'].includes(parent.tagName)) break;
            if (textLength(parent) > budget) break;
            node = parent;
        }
        if (textLength(node) > budget) {
            return null;
        }
        node.remove();
        return node;
    };
    const contentRoot = doc.querySelector('article, main') || doc.body;

    // A growing number of publishers ship a "listen to this article" TTS
    // control near the top of the article, often bundled in the same hero
    // wrapper as a duplicate <h1> headline. Anchor on the control's accessible
    // name (not just any <audio> tag) so a legitimate embedded audio/podcast
    // player in the body text is left alone; a substring match tolerates the
    // wording varying by site.
    const listenControl = [...contentRoot.querySelectorAll('button, [role="button"]')]
        .find(el => /\b(listen to (this |the )?(article|page)|play audio( of (this |the )?(page|article))?)\b/i
            .test((el.getAttribute('aria-label') || el.textContent || '').trim()));
    // Some sites bundle the article's own byline date as plain text (no
    // <time>/JSON-LD/meta) inside this same hero wrapper — salvage it before
    // the wrapper is discarded, as a last-resort fallback for date extraction
    // below. Detached nodes stay fully queryable after .remove(), so read from
    // the wrapper after removing it.
    let heroPublishDateText = null;
    if (listenControl) {
        const removedHero = removeAncestorBlock(listenControl);
        heroPublishDateText = removedHero
            ? [...removedHero.querySelectorAll('p, span, div')]
                .map(el => (el.textContent || '').trim())
                .find(t => t.length >= 6 && t.length <= 40 && /[A-Za-z]{3,}/.test(t) && /\b(19|20)\d{2}\b/.test(t) && parseToIso(t))
                || null
            : null;
    }

    // "Keep reading" / related-content recirculation carousels are promotional,
    // not article content, but survive extraction because they're made of real
    // anchor text. Match the *entire* heading text (not a substring) to keep
    // this from ever firing on a genuine subheading.
    const recircHeading = [...contentRoot.querySelectorAll('h1, h2, h3, h4, h5, h6')]
        .find(h => /^(keep reading|read more|related( articles?| stories| posts)?|you (might|may) also like|more (from|stories|like this)|recommended( for you)?|up next|continue reading|discover more)$/i
            .test((h.textContent || '').trim()));
    if (recircHeading) removeAncestorBlock(recircHeading);

    // --- openai.com (and any site sharing the same component) tag-list +
    // author-byline footer cleanup ---
    // Feature-detected via the template's own data-testid rather than hostname.
    // "Author" alone is too common a legitimate heading to pattern-match
    // generically (e.g. research write-ups, book reviews), so this one block
    // needs a selector specific to the template.
    for (const el of doc.querySelectorAll('[data-testid="citations"]')) {
        el.remove();
    }

    // --- Generic: flatten single-paragraph wrappers inside the article body ---
    // wallabag extracts server-side with graby, which prefers schema.org's
    // itemprop="articleBody" and then prunes the chosen container with
    // php-readability's cleanConditionally(). That pass judges div/table/ul
    // and removes them on link density, text length and class weight — but
    // never touches a bare <p>. CMSes that wrap each paragraph in its own
    // gating div (BLOX/TownNews, which powers a large share of US local
    // papers, puts every paragraph in .subscriber-only) therefore hand graby
    // a container whose every child is individually prunable, and the article
    // can be pruned away in full — leaving an entry with no text at all.
    // Hoisting the paragraphs out of those wrappers puts them beyond the
    // pruner's reach. Unwrapping only ever moves nodes, so this cannot lose
    // content, and pages with no articleBody marker are left untouched.
    for (const body of doc.querySelectorAll('[itemprop="articleBody"]')) {
        // <noscript> renders only with scripting off, so it is never what the
        // reader saw — and it survives pruning (it isn't a div), which is how
        // a paywall's "this page requires Javascript" nag can end up as the
        // entire saved article.
        for (const el of body.querySelectorAll('noscript')) {
            el.remove();
        }
        // Repeat to a fixed point: wrappers nest.
        for (let pass = 0; pass < 5; pass++) {
            const wrappers = [...body.querySelectorAll('div')].filter(el => {
                const kids = [...el.children];
                return kids.length > 0 && kids.every(k => k.tagName === 'P');
            });
            if (!wrappers.length) break;
            for (const el of wrappers) el.replaceWith(...el.childNodes);
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
    // 5. Byline date text salvaged before the hero/audio-player widget above
    // was stripped (plain text, no <time>/JSON-LD/meta backing it) — lowest
    // priority, since it's the least structured signal.
    if (!metadata.publishedAt && heroPublishDateText) {
        const iso = parseToIso(heroPublishDateText);
        if (iso) metadata.publishedAt = iso;
    }

    const payload = {
        wallabagSaveArticleContent: dispatchBody
            ? dispatchBody.innerHTML
            : window.document.documentElement.innerHTML,
        wallabagMetadata: metadata
    };

    // The popup listens for this message. The keyboard command and the context menu
    // run the same injection with no popup open, so nothing receives it there and
    // they read the returned value instead - swallow the resulting rejection.
    const posted = chrome.runtime.sendMessage(payload);
    if (posted && typeof posted.catch === 'function') {
        posted.catch(() => {});
    }

    return payload;
};

export { extractArticleFromPage };
