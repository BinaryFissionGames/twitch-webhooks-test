import {Sequelize, Model, DataTypes, NOW} from "sequelize";

class Message extends Model {}
function initModel(sequelize: Sequelize){
    Message.init({
        type: DataTypes.STRING,
        username: DataTypes.STRING,
        message: DataTypes.STRING,
        received_on: {type: DataTypes.DATE, defaultValue: NOW}
    }, {sequelize, modelName: 'message'});
}

export {
    Message,
    initModel
}