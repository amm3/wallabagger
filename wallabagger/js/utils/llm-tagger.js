'use strict';

/**
 * Strips HTML tags and normalises whitespace to produce plain text.
 * @param {string} html
 * @returns {string}
 */
function htmlToText(html) {
    if (!html) return '';
    let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, ' ');
    text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, ' ');
    text = text.replace(/<[^>]+>/g, ' ');
    text = text.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#039;/g, "'").replace(/&nbsp;/g, ' ');
    text = text.replace(/[ \t]+/g, ' ');
    text = text.replace(/\n\s*\n+/g, '\n\n');
    return text.trim();
}

const SYSTEM_PROMPT = `You are a tagging assistant for a personal reading archive. Your job is to select tags that describe what an article is ABOUT, not what it merely MENTIONS.

IMPORTANT GUIDELINES:
- Only select tags for topics that are CENTRAL to the article's main thesis or subject matter
- Do NOT tag based on passing mentions, background context, or tangential references
- Ask yourself: "Is this article primarily about [tag topic]?" If not, don't use that tag
- For people (e.g., politicians, celebrities): only tag if the article is specifically ABOUT that person, not just mentioning them in context
- For broad/abstract tags (e.g., "culture-war", "politics"): only use if the article is explicitly analyzing or discussing that phenomenon as its main subject
- Prefer specific tags over vague ones when both apply
- It's better to select fewer, highly-relevant tags than many loosely-related ones
- Select 1-4 tags typically; only use more if the article genuinely covers multiple distinct topics in depth
- STRICT EVIDENCE RULE: Before applying any tag, you must be able to point to specific text in the article that directly supports it. If a tag's subject is not explicitly named or clearly described in the article, do NOT apply that tag — even if you think it might be tangentially related.
- SUBSTRING RULE: A tag name must appear as a meaningful, standalone reference in the article — not merely as a substring within an unrelated word. For example, do NOT apply "vance" because the word "advanced" appears, "ice" because "service" appears, or "apt" because "chapter" appears.

Select tags from the allowed list ("existing").
Only put non-duplicates into "proposed_new" if a new tag would be clearly valuable and nothing in the allowed list fits.`;

/**
 * Guard against hallucinated tags.
 * For tags whose name contains words ≥5 chars (real words, not abbreviations like
 * "ai", "ice", "nato"), ALL such words must appear as whole words in the article text.
 * Short/abbreviation tags pass by default.
 * @param {string} tag
 * @param {string} articleText
 * @returns {boolean}
 */
function validateTagAgainstArticle(tag, articleText) {
    const textLower = articleText.toLowerCase().replace(/\s+/g, ' ');
    const keyWords = tag.toLowerCase().split(/[\s-]+/).filter(w => w.length >= 5);
    if (keyWords.length === 0) return true;
    return keyWords.every(kw => new RegExp(`\\b${kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`).test(textLower));
}

/**
 * Parse JSON from an LLM response, tolerating surrounding prose.
 * @param {string} text
 * @returns {object}
 */
function parseJsonResponse(text) {
    text = text.trim();
    try { return JSON.parse(text); } catch (e) {}
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start !== -1 && end > start) {
        try { return JSON.parse(text.slice(start, end + 1)); } catch (e) {}
    }
    return {};
}

/**
 * Request tag suggestions from an OpenAI-compatible API.
 * @param {string} apiKey
 * @param {string} model
 * @param {string} articleText
 * @param {string[]} allowedTags
 * @param {string} [baseUrl] - override base URL (for OpenAI-compatible endpoints)
 * @returns {Promise<string[]>} - selected tags from the allowed list
 */
async function getLlmTagsOpenAi(apiKey, model, articleText, allowedTags, baseUrl = 'https://api.openai.com') {
    const schema = {
        type: 'object',
        properties: {
            existing: {
                type: 'array',
                items: { type: 'string', enum: allowedTags },
                maxItems: 6
            },
            proposed_new: {
                type: 'array',
                items: { type: 'string' },
                maxItems: 3
            }
        },
        required: ['existing', 'proposed_new'],
        additionalProperties: false
    };

    const body = {
        model,
        messages: [
            { role: 'system', content: SYSTEM_PROMPT },
            { role: 'user', content: `Tag the following article:\n\n${articleText.slice(0, 12000)}` }
        ],
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: 'tag_selection',
                schema,
                strict: true
            }
        }
    };

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = parseJsonResponse(content);
    return (parsed.existing || []).filter(t => allowedTags.includes(t) && validateTagAgainstArticle(t, articleText));
}

/**
 * Request tag suggestions from an Ollama instance.
 * @param {string} ollamaUrl
 * @param {string} model
 * @param {string} articleText
 * @param {string[]} allowedTags
 * @param {string} [apiKey] - optional auth key sent as X-Ollama-Key
 * @returns {Promise<string[]>}
 */
async function getLlmTagsOllama(ollamaUrl, model, articleText, allowedTags, apiKey) {
    const tagsList = allowedTags.map(t => `"${t}"`).join(', ');

    const prompt = `${SYSTEM_PROMPT}

Allowed tags: [${tagsList}]

Respond with ONLY valid JSON in this exact format (no other text):
{"existing": ["tag1", "tag2"], "proposed_new": ["new_tag"]}

"existing" must only contain tags from the allowed list above (max 6).
"proposed_new" may contain up to 3 new tags only if nothing in the allowed list fits.

Tag the following article:

${articleText.slice(0, 12000)}`;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-Ollama-Key'] = apiKey;

    const response = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, prompt, stream: false })
    });

    if (!response.ok) {
        throw new Error(`Ollama API error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const parsed = parseJsonResponse(data.response || '{}');
    return (parsed.existing || []).filter(t => allowedTags.includes(t) && validateTagAgainstArticle(t, articleText));
}

const TWITTER_HEADLINE_SYSTEM_PROMPT = `You are a headline writer for a personal reading archive. Given the text of a tweet or Twitter/X post, write a single short, factual, descriptive headline.

Rules:
- Output ONLY the headline — no options, no alternatives, no explanation
- Be descriptive and informative, not creative or witty
- Do not use humor, puns, or rhetorical flair
- Keep it concise (typically 6–12 words)
- If the tweet is a quote-tweet responding to another post, describe the top (outer) post; you may note who is responding to whom if it is clear, but this is not required
- Do not start with 'Tweet:', 'Post:', or similar prefixes`;

/**
 * Generate a descriptive headline for a tweet using an OpenAI-compatible API.
 * @param {string} apiKey
 * @param {string} model
 * @param {string} tweetText
 * @param {string} [baseUrl]
 * @returns {Promise<string|null>}
 */
async function generateTwitterHeadlineOpenAi(apiKey, model, tweetText, baseUrl = 'https://api.openai.com') {
    const schema = {
        type: 'object',
        properties: {
            headline: { type: 'string' }
        },
        required: ['headline'],
        additionalProperties: false
    };

    const body = {
        model,
        messages: [
            { role: 'system', content: TWITTER_HEADLINE_SYSTEM_PROMPT },
            { role: 'user', content: `Write a headline for this tweet:\n\n${tweetText.slice(0, 4000)}` }
        ],
        response_format: {
            type: 'json_schema',
            json_schema: {
                name: 'headline',
                schema,
                strict: true
            }
        }
    };

    const response = await fetch(`${baseUrl.replace(/\/$/, '')}/v1/chat/completions`, {
        method: 'POST',
        headers: {
            'Authorization': `Bearer ${apiKey}`,
            'Content-Type': 'application/json'
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`OpenAI API error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const content = data.choices?.[0]?.message?.content || '{}';
    const parsed = parseJsonResponse(content);
    return parsed.headline || null;
}

/**
 * Generate a descriptive headline for a tweet using an Ollama instance.
 * @param {string} ollamaUrl
 * @param {string} model
 * @param {string} tweetText
 * @param {string} [apiKey]
 * @returns {Promise<string|null>}
 */
async function generateTwitterHeadlineOllama(ollamaUrl, model, tweetText, apiKey) {
    const prompt = `${TWITTER_HEADLINE_SYSTEM_PROMPT}

Respond with ONLY valid JSON in this exact format (no other text):
{"headline": "your headline here"}

Write a headline for this tweet:

${tweetText.slice(0, 4000)}`;

    const headers = { 'Content-Type': 'application/json' };
    if (apiKey) headers['X-Ollama-Key'] = apiKey;

    const response = await fetch(`${ollamaUrl.replace(/\/$/, '')}/api/generate`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, prompt, stream: false })
    });

    if (!response.ok) {
        throw new Error(`Ollama API error ${response.status}: ${await response.text()}`);
    }

    const data = await response.json();
    const parsed = parseJsonResponse(data.response || '{}');
    return parsed.headline || null;
}

export { htmlToText, getLlmTagsOpenAi, getLlmTagsOllama, generateTwitterHeadlineOpenAi, generateTwitterHeadlineOllama };
