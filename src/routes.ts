import {Application} from "express";
import {refreshToken} from "twitch-oauth-authorization-code-express";
import {TwitchRequestError} from "@binaryfissiongames/twitch-webhooks/dist/errors";
import * as https from "https";
import {TwitchWebhookManager, Webhook, WebhookOptions} from "@binaryfissiongames/twitch-webhooks/dist/webhooks";
import express = require("express");
import * as fs from "fs";
import {Message} from "./model/message";

function setupRoutes(app: Application, webhookManager: TwitchWebhookManager, subscriptions: Webhook[]) {
    app.get('/success', (req, res) => {
        res.end("Auth token: " + req.session.access_token + ", Refresh token: " + req.session.refresh_token);

        sendGetTwitchRequest("https://id.twitch.tv/oauth2/validate", req.session.access_token, async () => {
            const info = await refreshToken(req.session.refresh_token, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
            req.session.access_token = info.access_token;
            req.session.refresh_token = info.access_token;
            return info.access_token;
        }).then(async (body) => {
            let jsonBody = JSON.parse(body);
            let promises = [];
            let users = JSON.parse(fs.readFileSync("streamers.json").toString("utf8"));
            for (let user of users) {
                promises.push(addListenerForUser(user, req.session, webhookManager, subscriptions)
                    .catch((e: TwitchRequestError) => {
                        console.error(e);
                        console.error(e.toString())
                    }));
            }
            return await Promise.all(promises);
        }, (e) => {
            console.error(e);
            console.error(e.toString())
        });
    });

    app.get('/refresh', (req, res) => {
        //This endpoint will use the refresh token to refresh the OAuth token.
        refreshToken(req.session.refresh_token, process.env.CLIENT_ID, process.env.CLIENT_SECRET).then((tokenInfo) => {
            req.session.access_token = tokenInfo.access_token;
            req.session.refresh_token = tokenInfo.refresh_token;
            res.end("New auth token: " + req.session.access_token + ", New refresh token: " + req.session.refresh_token);
        });
    });

    app.get('/add', async (req, res) => {
        if (req.query.userName) {
            let username = req.query.userName.toString();
            await addListenerForUser(username, req.session, webhookManager, subscriptions)
                .catch((e) => {
                    console.error(e);
                    console.error(e.toString())
                });
        } else {
            console.error("Could not add user, no name was given");
        }
        res.end("Done.");
    });

    app.get('/deleteAll', async (req, res) => {
        for (let hook of subscriptions) {
            try {
                await webhookManager.unsubscribe(hook);
            } catch (e) {
                console.log(`Failed to unsub from endpoint '${hook.computedTopicUrl}'`);
            }
        }
        subscriptions.length = 0;
        res.end();
    });

    //Endpoint for ACME challenge
    app.use('/.well-known', express.static('www/.well-known', {
        index: false,
        dotfiles: "allow"
    }));
}

async function addListenerForUser(userName: string, session: any, webhookManager: TwitchWebhookManager, subscriptions: Webhook[]) {
    let body = await sendGetTwitchRequest(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(userName)}`, session.access_token, async () => {
        const info = await refreshToken(session.refresh_token, process.env.CLIENT_ID, process.env.CLIENT_SECRET);
        session.access_token = info.access_token;
        session.refresh_token = info.access_token;
        return info.access_token;
    });

    console.log("Adding listener for user " + userName);

    let jsonBody = JSON.parse(body);

    let id: string = jsonBody.data[0].id;

    function getOptions(type: string): WebhookOptions {
        return {
            errorCallback: e => console.error(e),
            onReceivedCallback: msg => {
                console.log(`Got message for user ${userName}(${id}):`);
                console.log(msg);
                Message.create({
                    type: type,
                    username: userName,
                    message: JSON.stringify(msg)
                });
            },
            getOAuthToken: async () => session.access_token,
            refreshOAuthToken: () => refreshToken(session.refresh_token, process.env.CLIENT_ID, process.env.CLIENT_SECRET)
                .then((tokenInfo) => {
                    session.access_token = tokenInfo.access_token;
                    session.refresh_token = tokenInfo.refresh_token;
                    return tokenInfo.access_token;
                }),
            lease_seconds: Number.parseInt(process.env.WEBHOOK_LEASE_SECONDS),
            secret: process.env.WEBHOOK_SECRET
        };
    }

    try {
        subscriptions.push(await webhookManager.addUserFollowsSubscription(getOptions("UserFollows"), id));
    } catch (e) {
        console.error("Tried to create a webhook listening to follows to user " + userName + ", but this is not allowed");
        console.log(e);
    }

    try {
        subscriptions.push(await webhookManager.addStreamChangedSubscription(getOptions("StreamChanged"), id));
    } catch (e) {
        console.error("Tried to create a webhook listening to stream changed to user " + userName + ", but this is not allowed");
        console.log(e);
    }

    try {
        subscriptions.push(await webhookManager.addModeratorChangedEvent(getOptions("ModeratorChanged"), id));
    } catch (e) {
        console.error("Tried to create a webhook listening to mod changed to user " + userName + ", but this is not allowed");
        console.log(e);
    }

    try {
        subscriptions.push(await webhookManager.addChannelBanChangedEvent(getOptions("ChannelBanChanged"), id));
    } catch (e) {
        console.error("Tried to create a webhook listening to channel ban event to user " + userName + ", but this is not allowed");
        console.log(e);
    }

    try {
        subscriptions.push(await webhookManager.addSubscriptionEvent(getOptions("Subscription"), id));
    } catch (e) {
        console.error("Tried to create a webhook listening to subs to user " + userName + ", but this is not allowed (probably bad oauth scope)");
        console.error(e);
    }
}

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

export {
    setupRoutes,
    sendGetTwitchRequest
}