var AWS = require("aws-sdk");
const docClient = new AWS.DynamoDB.DocumentClient();

const tableName = 'ws-connections';

exports.main = async (event: any) => {
  const token = { 'id':'wstest' }; //getContextData(event);
  switch (event.requestContext.routeKey) {
    case "$connect":
      const putParams = {
        TableName: tableName,
        Item: { userId: token.id, ...event.requestContext },
      };
      await docClient.put(putParams).promise();
      return {
        statusCode: 200,
        body: JSON.stringify({ msg: "Connected" })
      };
    case "$default":
      return {
        statusCode: 200,
        body: JSON.stringify({ msg: "Received" })
      };
    case "$disconnect":
      const queryParams = {
        TableName: tableName,
        IndexName: 'connectionId',
        KeyConditionExpression: "#connectionId = :v_connectionId",
        ExpressionAttributeNames: {
          '#connectionId': 'connectionId'
        },
        ExpressionAttributeValues: {
          ":v_connectionId": event.requestContext.connectionId
        },
      };
      const element = await docClient.query(queryParams).promise();
      const deleteParams = {
        TableName: tableName,
        Key: {
          userId: element.Items[0].userId,
          connectionId: event.requestContext.connectionId
        },
      };
      await docClient.delete(deleteParams).promise();
      return {
        statusCode: 200,
        body: JSON.stringify({ msg: "Disconnected" })
      };
  }
  return {
    statusCode: 200,
    body: JSON.stringify({ msg: "Message not acepted" })
  };

};

// this gets the userID from the IAM cognitoAuthenticationProvider
const getContextData = (event: any): ITokenData => {
  const authProvider = event.requestContext.identity.cognitoAuthenticationProvider;
  const parts = authProvider?.split(':');
  let userPoolUserId;
  if (parts) {
    userPoolUserId = parts[parts.length - 1];
  }
  return {
    id: userPoolUserId
  };
}

interface ITokenData {
  id: string;
}