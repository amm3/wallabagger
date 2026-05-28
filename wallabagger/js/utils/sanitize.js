'use strict';

const entitiesMap = {
    '&': '&amp;',
    '\'': '&#039;',
    '"': '&quot;',
    '<': '&lt;',
    '>': '&gt;'
};

const decodeStr = (param) => {
    const propRegExp = new RegExp(Object.values(entitiesMap).join('|'), 'g');
    const getKeyByValue = (object, value) => {
        return Object.keys(object).find(key => object[key] === value);
    };

    return param.replace(propRegExp, match => getKeyByValue(entitiesMap, match));
};

const encodeStr = (str) => {
    return entitiesMap[str];
};

const sanitize = (param) => {
    const propRegExp = new RegExp(Object.keys(entitiesMap).join("|"), 'g');
    return param.replace(propRegExp, match => encodeStr(match));
};

const encodeToBase64 = (str) => {
    var encoder = new TextEncoder();
    var utf8Bytes = encoder.encode(str);
    return btoa(String.fromCharCode(...utf8Bytes));
};

export { decodeStr, encodeToBase64, sanitize };
