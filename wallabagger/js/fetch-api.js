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
                    err = new Error(`HTTP ${response.status} ${response.statusText}`);
                }
                return Promise.reject(err);
            });
        });
    }
};

export { FetchApi };
