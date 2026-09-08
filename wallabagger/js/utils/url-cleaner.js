'use strict';

// Exact tracking parameter names we're highly confident are never needed to
// resolve/display the page they're attached to. Kept conservative on purpose:
// only well-known analytics/share trackers, never generic-looking names
// that some sites rely on functionally.
//
// 'via' and 'source' are deliberate, reviewed exceptions to that rule: they're
// common referral-tracking field names across many email/newsletter platforms
// (not just one publisher), so they're enumerated here despite being
// generic-looking - accepting the small risk that some site relies on one of
// them functionally, rather than leaving this obvious newsletter cruft in place.
const TRACKING_PARAM_NAMES = new Set([
    // click IDs
    'gclid', 'gclsrc', 'dclid', 'fbclid', 'msclkid', 'twclid', 'ttclid', 'yclid', 'igshid',
    // email/campaign trackers
    'mc_cid', 'mc_eid', 'mkt_tok', 'trk_contact', 'trk_msg', 'trk_module', 'trk_sid',
    // analytics
    '_ga', '_gl', 'ga_source', 'ga_medium', 'ga_campaign', 'ga_content', 'ga_term',
    // publisher-specific share trackers
    'smid', // NYT
    'ito', 'at_medium', 'at_campaign', 'at_custom1', 'at_custom2', 'at_custom3', 'at_custom4', // BBC
    'cmpid', 'wt.mc_id', 'wt_mc_id', // various publisher CMS trackers
    'guccounter', 'guce_referrer', 'guce_referrer_sig', // Yahoo/Guardian
    'sr_share',
    'spm', // Alibaba/Weibo
    'vero_id', 'vero_conv',
    'oly_enc_id', 'oly_anon_id',
    // generic-looking but reviewed exceptions (see comment above)
    'via', 'source'
]);

// Parameter *prefixes* that are unambiguous tracking families.
const TRACKING_PARAM_PREFIXES = ['utm_'];

// Generic-looking param names (e.g. "ref") aren't safe to strip outright since
// some sites rely on them functionally. But specific *values* of those params
// are still unambiguous trackers - e.g. Tangle (readtangle.com) stamps
// `ref=tangle-newsletter` on its own articles opened from its email, and
// `ref=readtangle.com` on outbound links it sends readers to. Scope the
// removal to those exact known values rather than the param name.
const TRACKING_PARAM_VALUE_DENYLIST = {
    ref: new Set(['tangle-newsletter', 'readtangle.com'])
};

// Generic-looking param names that are unsafe to strip globally, but are known to be
// pure tracking noise on specific domains regardless of value - e.g. WSJ's `mod=`
// param carries many different placement/attribution codes (djem10point, e2tw,
// hp_lede_pos1, ...) that all serve the same tracking purpose.
const DOMAIN_TRACKING_PARAM_NAMES = {
    'wsj.com': new Set(['mod'])
};

function isTrackingParam (name) {
    const lower = name.toLowerCase();
    return TRACKING_PARAM_NAMES.has(lower) || TRACKING_PARAM_PREFIXES.some(prefix => lower.startsWith(prefix));
}

function isTrackingParamValue (name, value) {
    const knownValues = TRACKING_PARAM_VALUE_DENYLIST[name.toLowerCase()];
    return knownValues !== undefined && knownValues.has(value.toLowerCase());
}

function isDomainMatch (hostname, domain) {
    return hostname === domain || hostname.endsWith(`.${domain}`);
}

function isDomainTrackingParam (hostname, name) {
    const lower = name.toLowerCase();
    return Object.entries(DOMAIN_TRACKING_PARAM_NAMES)
        .some(([domain, params]) => isDomainMatch(hostname, domain) && params.has(lower));
}

// Param names that carry *functional* access tokens - gift/friend links, signed
// URLs, draft previews. Their values are indistinguishable from tracking tokens on
// shape alone (Medium's friend-link `sk=` is exactly 32 hex chars, i.e. a perfect
// MD5 match), so the value-shape heuristic below must never touch them: stripping
// one downgrades the URL to the paywalled version of the article, and wallabag then
// stores an empty entry. Named rules above are unaffected - a param that is *also*
// on an explicit tracking list is still removed.
const FUNCTIONAL_PARAM_NAMES = new Set([
    'sk', // Medium friend link
    'token', 'access_token', 'auth', 'auth_token', 'authtoken',
    'key', 'apikey', 'api_key',
    'code', 'hash', 'sig', 'signature', 'secret',
    'share', 'gift', 'giftcode', 'preview', 'unlock'
]);

const FUNCTIONAL_PARAM_SUFFIXES = ['_token', '_code', '_key', '_hash', '_sig', '_signature', '_secret'];

function isFunctionalParam (name) {
    const lower = name.toLowerCase();
    return FUNCTIONAL_PARAM_NAMES.has(lower) || FUNCTIONAL_PARAM_SUFFIXES.some(suffix => lower.endsWith(suffix));
}

// Value-shape heuristic: catches opaque tracking tokens (hashed emails, campaign
// tags, ...) under field names we've never seen before - e.g. a newsletter ESP's
// own custom params - without maintaining a per-vendor name list. Deliberately
// scoped to hex-only values so it doesn't collide with slugs/base64 IDs.
const HASH_DIGEST_LENGTHS = new Set([32, 40, 64]); // MD5, SHA-1, SHA-256

// Any opaque value below this length is treated as too short to be confident
// about; short hex-ish strings are plausibly legitimate short IDs/codes.
const MIN_OPAQUE_HEX_LENGTH = 16;

// Hex charset AND at least one a-f letter - excludes plain decimal IDs (e.g.
// Snowflake/timestamp-style numeric ids are valid hex-charset but not hash-like).
function isHexHashLike (value) {
    return /^[0-9a-f]+$/i.test(value) && /[a-f]/i.test(value);
}

// A value whose length exactly matches a standard hash digest is safe to strip
// unconditionally: no legitimate article-routing id coincidentally lands on a
// cryptographic digest length.
function isHighConfidenceOpaqueValue (value) {
    return isHexHashLike(value) && HASH_DIGEST_LENGTHS.has(value.length);
}

// Hex-like but a non-standard length (e.g. a 24-char value, which is also the
// shape of a MongoDB ObjectId) is ambiguous on shape alone, so it's only treated
// as tracking noise when corroborated by another confirmed tracker in the same URL.
function isLowConfidenceOpaqueValue (value) {
    return isHexHashLike(value) && value.length >= MIN_OPAQUE_HEX_LENGTH && !HASH_DIGEST_LENGTHS.has(value.length);
}

/**
 * Removes known tracking query parameters (UTM*, smid, gclid, fbclid, ...), plus
 * opaque hash-like values under any field name, from a URL. Leaves any parameter
 * it isn't highly confident about untouched.
 * @param {string} urlString
 * @returns {string}
 */
function stripTrackingParams (urlString) {
    let url;
    try {
        url = new URL(urlString);
    } catch (error) {
        return urlString;
    }

    const entries = [...url.searchParams.entries()];
    const isNamedTrackingParam = ([name, value]) =>
        isTrackingParam(name) ||
        isTrackingParamValue(name, value) ||
        isDomainTrackingParam(url.hostname, name);
    const hasNamedTrackingSignal = entries.some(isNamedTrackingParam);

    const isOpaqueTrackingValue = ([name, value]) =>
        !isFunctionalParam(name) &&
        (isHighConfidenceOpaqueValue(value) || (hasNamedTrackingSignal && isLowConfidenceOpaqueValue(value)));

    const keysToDelete = entries
        .filter(entry => isNamedTrackingParam(entry) || isOpaqueTrackingValue(entry))
        .map(([name]) => name);
    if (keysToDelete.length === 0) {
        return urlString;
    }

    keysToDelete.forEach(key => url.searchParams.delete(key));
    return url.toString();
}

export { stripTrackingParams };
