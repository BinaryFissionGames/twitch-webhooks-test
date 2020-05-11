import {
    TwitchWebhookManager,
    TwitchWebhookPersistenceManager,
    WebhookPersistenceObject
} from "@binaryfissiongames/twitch-webhooks/dist";
import {Message, User, Webhook} from "./model/model";
import {WebhookId, WebhookType} from "@binaryfissiongames/twitch-webhooks/dist/webhooks";
import {WebhookPayload} from "@binaryfissiongames/twitch-webhooks/dist/payload_types";
import {getOAuthToken, refreshToken, sendGetTwitchRequest} from "./request";
import * as fs from "fs";
import {TwitchRequestError} from "@binaryfissiongames/twitch-webhooks/dist/errors";

class SequelizeTwitchWebhookPersistenceManager implements TwitchWebhookPersistenceManager {

    async deleteWebhook(webhookId: string): Promise<void> {
        let webhook = <Webhook>await Webhook.findOne({where: {id: webhookId}});
        if (webhook) {
            webhook.destroy();
        }
    }

    async destroy(): Promise<void> {
    }

    async getAllWebhooks(): Promise<WebhookPersistenceObject[]> {
        let webhooks = await Webhook.findAll();
        console.log(webhooks);
        return webhooks.map(this.modelToObject);
    }

    async getWebhookById(webhookId: string): Promise<WebhookPersistenceObject> {
        let webhook = await Webhook.findOne({where: {id: webhookId}});
        console.log(webhookId);
        console.log(webhook);
        if(webhook === null){
            return null;
        }
        return this.modelToObject(webhook);
    }

    async persistWebhook(webhook: WebhookPersistenceObject): Promise<void> {
        console.log("Persisting", webhook);
        await Webhook.create(webhook);
    }

    async saveWebhook(webhook: WebhookPersistenceObject): Promise<void> {
        console.log('Saving', webhook);
        await Webhook.update(webhook, {where: {id: webhook.id}});
    }

    modelToObject(webhook: Webhook): WebhookPersistenceObject {
        return {
            id: webhook.id,
            type: webhook.type,
            href: webhook.href,
            subscribed: webhook.subscribed,
            subscriptionStart: webhook.subscriptionStart,
            subscriptionEnd: webhook.subscriptionEnd,
            secret: webhook.secret,
            leaseSeconds: webhook.leaseSeconds
        }
    }

}

function getWebhookMessageCallback(manager: TwitchWebhookManager) {
    return async function onWebhookMessage(type: WebhookType, webhookId: WebhookId, msg: WebhookPayload) {
        console.log("Got message: ");
        console.log(msg);
        let webhook = await manager.config.persistenceManager.getWebhookById(webhookId);
        let url = new URL(webhook.href);

        switch (type) {
            case WebhookType.UserFollows:
                Message.create({
                    type: "UserFollows",
                    username: msg.data[0].to_name,
                    message: JSON.stringify(msg),
                    received_on: new Date()
                });
                break;
            case WebhookType.ChannelBanChange:
                Message.create({
                    type: "ChannelBanChange",
                    username: msg.data[0].event_data.broadcaster_name,
                    message: JSON.stringify(msg),
                    received_on: new Date()
                });
                break;
            case WebhookType.ExtensionTransactionCreated:
                Message.create({
                    type: "ExtensionTransactionCreated",
                    username: msg.data[0].broadcaster_name,
                    message: JSON.stringify(msg),
                    received_on: new Date()
                });
                break;
            case WebhookType.ModeratorChange:
                Message.create({
                    type: "ModeratorChange",
                    username: msg.data[0].event_data.broadcaster_name,
                    message: JSON.stringify(msg),
                    received_on: new Date()
                });
                break;
            case WebhookType.StreamChanged:
                Message.create({
                    type: "StreamChanged",
                    username: (await User.findOne({where: {twitchId: url.searchParams.get('broadcaster_id')}})).twitchUserName,
                    message: JSON.stringify(msg),
                    received_on: new Date()
                });
                break;
            case WebhookType.Subscription:
                Message.create({
                    type: "Subscription",
                    username: msg.data[0].event_data.broadcaster_name,
                    message: JSON.stringify(msg),
                    received_on: new Date()
                });
                break;
            case WebhookType.UserChanged:
                Message.create({
                    type: "UserChanged",
                    username: msg.data[0].login,
                    message: JSON.stringify(msg),
                    received_on: new Date()
                });
                break;
            default:
                Message.create({
                    type: "Unknown",
                    username: "Unknown",
                    message: JSON.stringify(msg),
                    received_on: new Date()
                });

        }
    }
}

async function addListenerForUser(userName: string, hasOauthToken: boolean, webhookManager: TwitchWebhookManager) {
    let token = await getOAuthToken();
    let body = await sendGetTwitchRequest(`https://api.twitch.tv/helix/users?login=${encodeURIComponent(userName)}`, token, () => refreshToken(token));

    console.log("Adding listener for user " + userName);

    let jsonBody = JSON.parse(body);

    let id: string = jsonBody.data[0].id;

    await User.findOrCreate({where: {twitchId: id}, defaults: {twitchUserName: userName, twitchId: id}});

    try {
        await webhookManager.addUserFollowsSubscription({
            leaseSeconds: Number.parseInt(process.env.WEBHOOK_LEASE_SECONDS),
            secret: process.env.WEBHOOK_SECRET
        }, id);
    } catch (e) {
        console.error("Tried to create a webhook listening to follows to user " + userName + ", but this is not allowed");
        console.log(e);
    }

    try {
        await webhookManager.addStreamChangedSubscription({
            leaseSeconds: Number.parseInt(process.env.WEBHOOK_LEASE_SECONDS),
            secret: process.env.WEBHOOK_SECRET
        }, id);
    } catch (e) {
        console.error("Tried to create a webhook listening to stream changed to user " + userName + ", but this is not allowed");
        console.log(e);
    }

    if (hasOauthToken) {
        try {
            await webhookManager.addModeratorChangedEvent({
                leaseSeconds: Number.parseInt(process.env.WEBHOOK_LEASE_SECONDS),
                secret: process.env.WEBHOOK_SECRET
            }, id);
        } catch (e) {
            console.error("Tried to create a webhook listening to mod changed to user " + userName + ", but this is not allowed");
            console.log(e);
        }
    }

    if (hasOauthToken) {
        try {
            await webhookManager.addChannelBanChangedEvent({
                leaseSeconds: Number.parseInt(process.env.WEBHOOK_LEASE_SECONDS),
                secret: process.env.WEBHOOK_SECRET
            }, id);
        } catch (e) {
            console.error("Tried to create a webhook listening to channel ban event to user " + userName + ", but this is not allowed");
            console.log(e);
        }
    }

    if (hasOauthToken) {
        try {
            await webhookManager.addSubscriptionEvent({
                leaseSeconds: Number.parseInt(process.env.WEBHOOK_LEASE_SECONDS),
                secret: process.env.WEBHOOK_SECRET
            }, id);
        } catch (e) {
            console.error("Tried to create a webhook listening to subs to user " + userName + ", but this is not allowed (probably bad oauth scope)");
            console.error(e);
        }
    }
}

async function addListenToRandomStreamers(webhookManager: TwitchWebhookManager) {
    let users = JSON.parse(fs.readFileSync("streamers.json").toString("utf8"));
    for (let user of users) {
        await addListenerForUser(user, false, webhookManager)
            .catch((e: TwitchRequestError) => {
                console.error(`Failed to add listener to user ${user}`);
                console.error(e);
                console.error(e.toString())
            });
    }
}

export {
    SequelizeTwitchWebhookPersistenceManager,
    getWebhookMessageCallback,
    addListenerForUser,
    addListenToRandomStreamers
}