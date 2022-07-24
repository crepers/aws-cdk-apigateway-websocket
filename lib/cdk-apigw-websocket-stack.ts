import { Duration, Stack, StackProps, RemovalPolicy } from 'aws-cdk-lib';
import { Construct, DependencyGroup } from 'constructs';

import * as ssm from 'aws-cdk-lib/aws-ssm';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import {NodejsFunction} from 'aws-cdk-lib/aws-lambda-nodejs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as apigateway from 'aws-cdk-lib/aws-apigatewayv2';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as path from 'path';

export class CdkApigwWebsocketStack extends Stack {
  constructor(scope: Construct, id: string, props?: StackProps) {
    super(scope, id, props);

    const domainName = 'test';//ssm.StringParameter.valueForStringParameter(this, '/ws-domain-name');
    // const wsCertificate = ssm.StringParameter.valueForStringParameter(this, '/ws-certificate');
    
    // RECEIVER
    const lambdaAPIsocket = new NodejsFunction(this, 'wsReceiver', {
      functionName: 'wsReceiver',
      runtime: lambda.Runtime.NODEJS_12_X,
      tracing: lambda.Tracing.ACTIVE,
      handler: 'main',
      timeout: Duration.seconds(30),
      entry: path.join(__dirname, `/../lambda/receiver.ts`)
    });
    
    // SENDER
    const lambdaSender = new NodejsFunction(this, 'wsSender', {
      functionName: 'wsSender',
      runtime: lambda.Runtime.NODEJS_12_X,
      tracing: lambda.Tracing.ACTIVE,
      timeout: Duration.seconds(60),
      handler: 'main',
      entry: path.join(__dirname, `/../lambda/sender.ts`),
      environment: {
        DOMAIN_NAME: domainName
      }
    });
    
    lambdaSender.addToRolePolicy(new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: ["arn:aws:execute-api:*:*:*/@connections/*"],
      actions: ["execute-api:ManageConnections"]
    }));
    
    // WEBSOCKET api
    const apigatewaysocket = new apigateway.CfnApi(this, "apigatewaysocket", {
      name: "WDISSockets",
      protocolType: "WEBSOCKET",
      routeSelectionExpression: "$request.body.message"
    });

    // const authRole = iam.Role.fromRoleArn(this, 'AuthRole', `arn:aws:iam::${Stack.of(this).region}:${Stack.of(this).account}:role/CognitoDefaultAuthenticatedRole`);

    // const repositoryName = 'Apigw-WS'
    // // Policy for Cognito invoking API Gateway
    // new iam.Policy(this, `${repositoryName}-Policy`, {
    //   policyName: `${repositoryName}-Policy`,
    //   roles: [authRole],
    //   statements: [
    //     new iam.PolicyStatement({
    //       effect: iam.Effect.ALLOW,
    //       resources: [
    //         `arn:aws:execute-api:${Stack.of(this).region}:${Stack.of(this).account}:${apigatewaysocket.ref}/*/$connect`
    //       ],
    //       actions: [            
    //         'execute-api:Invoke'
    //       ]
    //     }),
    //     new iam.PolicyStatement({
    //       effect: iam.Effect.DENY,
    //       resources: [
    //         `arn:aws:execute-api:${Stack.of(this).region}:${Stack.of(this).account}:${apigatewaysocket.ref}/*/secret`
    //       ],
    //       actions: [            
    //         'execute-api:Invoke'
    //       ]
    //     }),
    //     new iam.PolicyStatement({
    //       effect: iam.Effect.DENY,
    //       resources: [
    //         `arn:aws:execute-api:${Stack.of(this).region}:${Stack.of(this).account}:${apigatewaysocket.ref}/*`
    //       ],
    //       actions: [            
    //         'execute-api:ManageConnections'
    //       ]
    //     })
    //   ]
    // });
    
    const wsConnections = new dynamodb.Table(this, 'WSconnections', {
      tableName: 'ws-connections',
      partitionKey: { name: 'userId', type: dynamodb.AttributeType.STRING },
      sortKey: { name: 'connectionId', type: dynamodb.AttributeType.STRING },
      billingMode: dynamodb.BillingMode.PAY_PER_REQUEST,
      stream: dynamodb.StreamViewType.NEW_IMAGE,
      removalPolicy: RemovalPolicy.DESTROY,
    });
    
    wsConnections.addGlobalSecondaryIndex({
      indexName: 'connectionId',
      partitionKey: {
        name: 'connectionId',
        type: dynamodb.AttributeType.STRING
      }
    });
    
    wsConnections.grantReadWriteData(lambdaAPIsocket);
    
    const roleapigatewaysocketapi = new iam.Role(this, "roleapigatewaysocketapi", {
      assumedBy: new iam.ServicePrincipal("apigateway.amazonaws.com")
    });
    
    // access role for the socket api to access the socket lambda
    const policy = new iam.PolicyStatement({
      effect: iam.Effect.ALLOW,
      resources: [lambdaAPIsocket.functionArn],
      actions: ["lambda:InvokeFunction"]
    });
    
    roleapigatewaysocketapi.addToPolicy(policy);
    
    // connect route
    const apigatewayroutesocketconnect = new apigateway.CfnRoute(this, "apigatewayroutesocketconnect", {
      apiId:apigatewaysocket.ref,
      routeKey: "$connect",
      // authorizationType: "AWS_IAM",
      authorizationType: "NONE",
      apiKeyRequired: false,
      operationName: "ConnectRoute",
      target: "integrations/"+new apigateway.CfnIntegration(this, "apigatewayintegrationsocketconnect", {
        apiId: apigatewaysocket.ref,
        integrationType: "AWS_PROXY",
        integrationUri: "arn:aws:apigateway:" + Stack.of(this).region + ":lambda:path/2015-03-31/functions/" + lambdaAPIsocket.functionArn+"/invocations",
        credentialsArn: roleapigatewaysocketapi.roleArn
      }).ref
    });
    
    // disconnect route
    const apigatewayroutesocketdisconnect = new apigateway.CfnRoute(this, "apigatewayroutesocketdisconnect", {
      apiId:apigatewaysocket.ref,
      routeKey: "$disconnect",
      apiKeyRequired: false,
      authorizationType: "NONE",
      operationName: "DisconnectRoute",
      target: "integrations/"+new apigateway.CfnIntegration(this, "apigatewayintegrationsocketdisconnect", {
        apiId:apigatewaysocket.ref,
        integrationType: "AWS_PROXY",
        integrationUri: "arn:aws:apigateway:"+Stack.of(this).region+":lambda:path/2015-03-31/functions/" + lambdaAPIsocket.functionArn + "/invocations",
        credentialsArn: roleapigatewaysocketapi.roleArn
      }).ref
    });
    
    // message route
    const apigatewayroutesocketdefault = new apigateway.CfnRoute(this, "apigatewayroutesocketdefault", {
      apiId:apigatewaysocket.ref,
      routeKey: "$default",
      apiKeyRequired: false,
      authorizationType: "NONE",
      operationName: "SendRoute",
      target: "integrations/"+new apigateway.CfnIntegration(this, "apigatewayintegrationsocketdefault", {
        apiId:apigatewaysocket.ref,
        integrationType: "AWS_PROXY",
        integrationUri: "arn:aws:apigateway:"+Stack.of(this).region+":lambda:path/2015-03-31/functions/"+lambdaAPIsocket.functionArn+"/invocations",
        credentialsArn: roleapigatewaysocketapi.roleArn
      }).ref
    });
    
    // DEPLOY ------------------------------------------------------------------

    // deployment
    const apigatewaydeploymentsocket = new apigateway.CfnDeployment(this, "apigatewaydeploymentsocket", {
      apiId: apigatewaysocket.ref
    });
    
    // stage
    const apigatewaystagesocket = new apigateway.CfnStage(this, "apigatewaystagesocket", {
      apiId: apigatewaysocket.ref,
      deploymentId: apigatewaydeploymentsocket.ref,
      stageName: "prod",
      defaultRouteSettings:{
        dataTraceEnabled: true,
        detailedMetricsEnabled: true,
        loggingLevel: 'ERROR'
      }
    });
    
    // all the routes are dependencies of the deployment
    const routes = new DependencyGroup();//new cdk.ConcreteDependable();
    routes.add(apigatewayroutesocketconnect);
    routes.add(apigatewayroutesocketdisconnect);
    routes.add(apigatewayroutesocketdefault);
    
    // Add the dependency
    apigatewaydeploymentsocket.node.addDependency(routes);
  }
}
