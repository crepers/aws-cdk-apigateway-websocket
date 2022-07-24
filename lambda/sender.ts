var AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();

const tableName = 'ws-connections';

interface IDynamoConnection {
  Items: IConnection[];
}
interface IConnection {
  userId: string;
  connectionId: string;
}

interface IRespMessage {
  destination?: string[] | string, // userId[] | userId
  message: object
}

const apigwManagementApi = new AWS.ApiGatewayManagementApi({
  apiVersion: "2018-11-29",
  endpoint: process.env.DOMAIN_NAME,
});

exports.main = async (event: any) => {
  const data = event.Records[0].Sns.Message;
  const message: IRespMessage = data && JSON.parse(data);

  if (!message.message) {
    // FIXME: ? what should we send to the UI?
    return;
  }
  let connectionData: IDynamoConnection;
  if (!message.destination) {
    connectionData = await docClient
    .scan({ TableName: tableName, ProjectionExpression: "userId, connectionId" })
    .promise();

  } else if (!Array.isArray(message.destination)) {
    const params = {
      TableName : tableName,
      KeyConditionExpression: "userId = :userId",
      ExpressionAttributeValues: {
        ":userId": message.destination
      }
    };
    connectionData = await docClient.query(params).promise();
  } else {

    const items: any = await Promise.all(message.destination.map(async destination => {
      const params = {
        TableName : tableName,
        KeyConditionExpression: "userId = :userId",
        ExpressionAttributeValues: {
          ":userId": destination
        }
      };
      const connData = await docClient.query(params).promise();
      return connData.Items;
    }));
    connectionData = {
      Items: items.flat(1)
    };
  }

  const postCalls = connectionData.Items.map(async ({ userId, connectionId }) => {
    try {
      console.log('Post to connection: '+connectionId);
      await apigwManagementApi
        .postToConnection({
          ConnectionId: connectionId,
          Data: JSON.stringify(message.message),
        })
        .promise();
    } catch (e) {
      if (e.statusCode === 410) {
        console.log(`Found stale connection, deleting ${connectionId}`);
        await docClient
          .delete({ TableName: tableName, Key: { 
            userId,
            connectionId
          } })
          .promise();
      } else {
        throw e;
      }
    }
  });
  try {
    await Promise.all(postCalls);
    return { statusCode: 200, body: "Data sent." };
  } catch (e) {
    return { statusCode: 500, body: e.stack };
  }
  
};