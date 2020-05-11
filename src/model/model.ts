import {Sequelize, Model, DataTypes, NOW} from "sequelize";
import {WebhookType} from "@binaryfissiongames/twitch-webhooks/dist/webhooks";

class Webhook extends Model {
    public id!: string;
    public type: WebhookType;
    public href: string;
    public subscribed: boolean;
    public subscriptionStart: Date;
    public subscriptionEnd: Date;
    public secret: string;
    public leaseSeconds: number;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

class Message extends Model {
    public type: string;
    public username: string;
    public message: string;
    public received_on: Date;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

class User extends Model {
    public twitchUserName!: string;
    public twitchId!: string;
    public oAuthToken: string;
    public refreshToken: string;
    public tokenExpiry: Date;
    public scopes: string;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

class Token extends Model {
    public oAuthToken!: string;
    public tokenExpiry: Date;
    public scopes: string;
    public readonly createdAt!: Date;
    public readonly updatedAt!: Date;
}

function initModel(sequelize: Sequelize){
    Message.init({
        type: DataTypes.STRING,
        username: DataTypes.STRING,
        message: DataTypes.STRING,
        received_on: {type: DataTypes.DATE, defaultValue: NOW}
    }, {sequelize, modelName: 'message'});

    Webhook.init({
        id: {type: DataTypes.STRING, allowNull: false, primaryKey: true},
        type: {type: DataTypes.INTEGER},
        href: {type: DataTypes.STRING},
        subscribed: {type: DataTypes.BOOLEAN},
        subscriptionStart: {type: DataTypes.DATE},
        subscriptionEnd: {type: DataTypes.DATE},
        secret: {type: DataTypes.STRING},
        leaseSeconds: {type: DataTypes.INTEGER}
    }, {sequelize, modelName: 'webhook'});

    User.init({
        twitchUserName: {type: DataTypes.STRING, allowNull: false},
        twitchId: {type: DataTypes.STRING, allowNull: false, unique: true},
        oAuthToken: {type: DataTypes.STRING, unique: true},
        refreshToken: {type: DataTypes.STRING},
        tokenExpiry: {type: DataTypes.STRING},
        scopes: {type: DataTypes.STRING}
    }, {sequelize, modelName: 'user'});

    Token.init({
        oAuthToken: {type: DataTypes.STRING, primaryKey: true},
        tokenExpiry: {type: DataTypes.DATE},
        scopes: {type: DataTypes.STRING}
    }, {sequelize, modelName: 'token'})
}

export {
    Message,
    Webhook,
    User,
    Token,
    initModel
}