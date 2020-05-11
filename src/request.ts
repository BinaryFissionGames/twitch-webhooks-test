import * as https from "https";
import * as oauth from "twitch-oauth-authorization-code-express"
import {Token, User} from "./model/model";

async function sendGetTwitchRequest(url: string, token: string, refreshToken: () => Promise<string>): Promise<string> {
    let runRequest = function (resolve, reject, token: string, tryAgain: boolean) {
        let httpsReq = https.request(url, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Client-ID": process.env.CLIENT_ID,
            },
            method: "GET"
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', () => {
                resolve(body);
            });
        });

        httpsReq.on('error', () => {
            console.error("Failed to call validate endpoint.");
            if (tryAgain) {
                refreshToken().then((token) => {
                    runRequest(resolve, reject, token, false);
                });
            } else {
                reject(new Error("Http request failed."));
            }
        });

        httpsReq.end();
    };

    return new Promise((resolve, reject) => {
        runRequest(resolve, reject, token, true);
    });
}

async function sendPostTwitchRequest(url: string, token: string, refreshToken: () => Promise<string>, body?: object): Promise<string> {
    let runRequest = function (resolve: { (value?: string | PromiseLike<string>): void; (arg0: string): void; }, reject: { (reason?: any): void; (arg0: Error): void; }, token: string, tryAgain: boolean) {
        let httpsReq = https.request(url, {
            headers: {
                "Authorization": `Bearer ${token}`,
                "Client-ID": process.env.CLIENT_ID,
            },
            method: "POST"
        }, (res) => {
            let body = '';
            res.on('data', (chunk) => {
                body += chunk;
            });

            res.on('end', () => {
                resolve(body);
            });
        });

        httpsReq.on('error', () => {
            console.error("Failed to call validate endpoint.");
            if (tryAgain) {
                refreshToken().then((token) => {
                    runRequest(resolve, reject, token, false);
                });
            } else {
                reject(new Error("Http request failed."));
            }
        });
        if (body) {
            httpsReq.write(JSON.stringify(body));
        }
        httpsReq.end();
    };

    return new Promise((resolve, reject) => {
        runRequest(resolve, reject, token, true);
    });
}

async function getOAuthToken(userId?: string): Promise<string> {
    if (userId) {
        let user = await User.findOne({where: {twitchId: userId}});
        return user.oAuthToken;
    } else {
        let token = await Token.findOne({});
        if (token) {
            return token.oAuthToken;
        }

        return (await requestAppToken([])).oAuthToken;
    }
}

async function refreshToken(oAuthToken: string): Promise<string> {
    let token = await Token.findOne({where: {oAuthToken: oAuthToken}});
    if (token) {
        let scopes = token.scopes;
        let scopeArray: string[];
        if (scopes !== '') {
            scopeArray = scopes.split(' ');
        }

        if (!scopeArray) {
            scopeArray = [];
        }

        token.destroy();
        return (await requestAppToken(scopeArray)).oAuthToken;
    } else {
        let user = await User.findOne({where: {oAuthToken: oAuthToken}});
        let scopes = user.scopes;
        let scopeArray = [];
        if (scopes !== '') {
            scopeArray = scopes.split(' ');
        }
        let info = await oauth.refreshToken(user.refreshToken, process.env.CLIENT_ID, process.env.CLIENT_SECRET, scopeArray);
        user.oAuthToken = info.access_token;
        user.refreshToken = info.refresh_token;
        //TODO: Update refresh token endpoint to return token expiry and stuff
        user.save();
        return info.access_token;
    }
}

async function requestAppToken(scopes: string[]): Promise<Token> {
    return new Promise((resolve, reject) => {
        let scopeString = scopes.length >= 1 ? '&' + encodeURIComponent(scopes.join(' ')) : '';
        let request = https.request(`https://id.twitch.tv/oauth2/token?client_id=${process.env.CLIENT_ID}&client_secret=${process.env.CLIENT_SECRET}&grant_type=client_credentials${scopeString}`,
            {method: 'POST'},
            (res) => {
                let body = "";
                res.on('data', (chunk) => {
                    body += chunk;
                });

                res.on("end", () => {
                    let token_info = JSON.parse(body);
                    Token.create({
                        oAuthToken: token_info.access_token,
                        tokenExpiry: new Date(Date.now() + token_info.expires_in * 1000),
                        scopes: token_info.scope.join(' ')
                    }).then(token => {
                        resolve(token)
                    }).catch((e) => {
                        reject(e);
                    });
                });
            });

        request.on('error', (e) => {
            reject(e);
        });

        request.end();
    });
}

export {
    sendGetTwitchRequest,
    sendPostTwitchRequest,
    getOAuthToken,
    refreshToken
}