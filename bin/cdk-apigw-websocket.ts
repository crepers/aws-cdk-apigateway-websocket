#!/usr/bin/env node
import * as cdk from 'aws-cdk-lib';
import { CdkApigwWebsocketStack } from '../lib/cdk-apigw-websocket-stack';

const app = new cdk.App();
new CdkApigwWebsocketStack(app, 'CdkApigwWebsocketStack');
