'use strict';

// Exact tracking parameter names we're highly confident are never needed to
// resolve/display the page they're attached to. Kept conservative on purpose:
// only well-known analytics/share trackers, never generic-looking names
// (e.g. "id", "ref", "source") that some sites rely on functionally.
const TRACKING_PARAM_NAMES = new Set([
    // click IDs
    'gclid', 'gclsrc', 'dclid', 'fbclid', 'msclkid', 'twclid', 'ttclid', 'yclid', 'igshid',
    // email/campaign trackers
    'mc_cid', 'mc_eid', 'mkt_tok', 'trk_contact', 'trk_msg', 'trk_module', 'trk_sid',
    // analytics
    '_ga', '_gl', 'ga_source', 'ga_medium', 'ga_campaign', 'ga_content', 'ga_term',
    // publisher-specific share trackers
    'smid', // NYT
    'ito', // BBC
    'cmpid', 'wt.mc_id', 'wt_mc_id', // various publisher CMS trackers
    'guccounter', 'guce_referrer', 'guce_referrer_sig', // Yahoo/Guardian
    'sr_share',
    'spm', // Alibaba/Weibo
    'vero_id', 'vero_conv',
    'oly_enc_id', 'oly_anon_id'
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

/**
 * Removes known tracking query parameters (UTM*, smid, gclid, fbclid, ...) from a URL.
 * Leaves any parameter it isn't highly confident about untouched.
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

    const keysToDelete = [...url.searchParams.entries()]
        .filter(([name, value]) =>
            isTrackingParam(name) ||
            isTrackingParamValue(name, value) ||
            isDomainTrackingParam(url.hostname, name))
        .map(([name]) => name);
    if (keysToDelete.length === 0) {
        return urlString;
    }

    keysToDelete.forEach(key => url.searchParams.delete(key));
    return url.toString();
}

export { stripTrackingParams };
