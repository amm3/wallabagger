const FetchApi = function () {};

FetchApi.prototype = {

    getRequestOptions: function (method, token, content) {
        let options = {
            method,
            headers: this.getHeaders(token),
            mode: 'cors',
            cache: 'default',
            credentials: 'omit'
        };
        if (content !== '') {
            options = Object.assign(options, { body: JSON.stringify(content) });
        }
        return options;
    },

    getHeaders: function (token) {
        const headers = {
            Accept: 'application/json',
            'Content-Type': 'application/json'
        };
        if (token !== '') {
            headers.Authorization = `Bearer ${token}`;
        }
        return headers;
    },

    Patch: function (url, token, content) {
        return this.Fetch(url, 'PATCH', token, content);
    },

    Post: function (url, token, content) {
        return this.Fetch(url, 'POST', token, content);
    },

    Delete: function (url, token) {
        return this.Fetch(url, 'DELETE', token, '');
    },

    Get: function (url, token) {
        return this.Fetch(url, 'GET', token, '');
    },

    Fetch: function (url, method, token, content) {
        const options = this.getRequestOptions(method, token, content);
        return fetch(url, options).then(response => {
            if (response.ok) {
                return response.json();
            }
            return response.text().then(text => {
                let err;
                try {
                    err = JSON.parse(text);
                } catch {
                    err = null;
                }
                if (err === null || typeof err !== 'object') {
                    err = new Error(`HTTP ${response.status} ${response.statusText}`);
                }
                // Always carry the numeric status on the rejection value. A JSON error
                // body parses into a plain object whose `message` (when it has one) is
                // the server's wording, so callers had no reliable way to recognise a
                // specific status - notably 413, which SavePage needs in order to retry
                // with a smaller payload instead of silently degrading to a URL-only save.
                err.status = response.status;
                return Promise.reject(err);
            });
        });
    }
};

export { FetchApi };
