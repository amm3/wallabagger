'use strict';

import { encodeToBase64 } from '../../utils/sanitize.js';

export class EuropresseProvider {
    #url = 'https://nouveau-europresse-com.bnf.idm.oclc.org/Search';
    #titlePageSelector = '.titreArticle';
    #siteNamePageSelector = '.DocPublicationName';
    #ophirofoxPageSelector = '[name="ophirofox-origin-url"]';

    isCurrentUrl(url) {
        return url.startsWith(this.#url);
    }

    getEntry(entryUrl, entryDocument) {
        const entryTitle = entryDocument.querySelector(this.#titlePageSelector).innerText;
        const ophirofoxOriginUrlMetaElement = entryDocument.querySelector(this.#ophirofoxPageSelector);
        const urlParams = ophirofoxOriginUrlMetaElement ?
            `url=${ophirofoxOriginUrlMetaElement.content}` : this.#defaultData(entryDocument, entryTitle);

        const data = {
            content: entryDocument.documentElement.innerHTML,
            title: entryTitle,
            url: `${entryUrl}?${urlParams}`,
            originUrl: ophirofoxOriginUrlMetaElement?.content
        };
        return data;
    }

    #defaultData(entryDocument, title) {
        // @TODO add an advice to use Ophirofox
        const siteName = entryDocument.querySelectorAll(this.#siteNamePageSelector)[0]?.firstChild.textContent.trim();
        const hashedTitle = `wallabagtitlebase64=${encodeToBase64(title)}`;
        const hashedSiteName = siteName ?
            `wallabagsitenamebase64=${encodeToBase64(siteName)}` : '';
        // Used to create a unique URL for wallabag
        // instead of the same one from Europresse
        return `${hashedTitle}&${hashedSiteName}`;
    }
}
