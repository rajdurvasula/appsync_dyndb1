import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as dynamodb from 'aws-cdk-lib/aws-dynamodb';
import * as appsync from 'aws-cdk-lib/aws-appsync';
import * as lambda from 'aws-cdk-lib/aws-lambda';
import * as ecr from 'aws-cdk-lib/aws-ecr';
import { DockerImageAsset, NetworkMode, Platform } from 'aws-cdk-lib/aws-ecr-assets';
import * as path from 'path';

export class RegnDiscovery1Stack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const accountId = cdk.Stack.of(this).account;
    const region = cdk.Stack.of(this).region;

    // role for lambda to invoke appsync
    const appsyncExecRole = new iam.Role(this, 'appsync-exec-role', {
      assumedBy: new iam.ServicePrincipal('lambda.amazonaws.com'),
      description: 'appsync exec role',
      roleName: 'appsync-exec-role'
    });
    appsyncExecRole.attachInlinePolicy(new iam.Policy(this, 'lambda-cw-logs', {
      statements: [
        new iam.PolicyStatement({
          actions: [
            'logs:CreateLogGroup',
            'logs:CreateLogStream',
            'logs:PutLogEvents'
          ],
          effect: iam.Effect.ALLOW,
          resources: [ '*' ]
        })
      ]
    }));

    // appsync GraphQL API
    const booksApi = new appsync.GraphqlApi(this, 'books-api', {
      name: 'books-api',
      schema: appsync.SchemaFile.fromAsset(path.join(__dirname, '../src/schemas/books.graphql')),
      authorizationConfig: {
        defaultAuthorization: {
          authorizationType: appsync.AuthorizationType.IAM
        }
      }
    });
    booksApi.grant(appsyncExecRole, appsync.IamResource.all(), 'appsync:GraphQL');

    const booksTable = new dynamodb.Table(this, 'books-db', {
      partitionKey: {
        name: 'id',
        type: dynamodb.AttributeType.STRING
      }
    });
    booksTable.grantFullAccess(appsyncExecRole);

    const booksDS = booksApi.addDynamoDbDataSource('books-ds', booksTable);

    const queryResolver = booksDS.createResolver('QueryBooks', {
      typeName: 'Query',
      fieldName: 'getBook',
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbGetItem('id', 'id'),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem()
    });

    const createResolver = booksDS.createResolver('CreateBooks', {
      typeName: 'Mutation',
      fieldName: 'createBook',
      requestMappingTemplate: appsync.MappingTemplate.dynamoDbPutItem(
        appsync.PrimaryKey.partition('id').auto(),
        appsync.Values.projecting('input')
      ),
      responseMappingTemplate: appsync.MappingTemplate.dynamoDbResultItem()
    });

    // ECR Repo
    const ecrRepo = ecr.Repository.fromRepositoryName(this, 'books-repo', 'bookssample');

    // ECR Image Asset
    const funcAsset = new DockerImageAsset(this, 'appsync-func-asset', {
      directory: path.join(__dirname, '../src/lambda'),
      networkMode: NetworkMode.DEFAULT,
      platform: Platform.LINUX_AMD64
    });

    // Lambda to invoke GraphQL
    const appSyncFunc = new lambda.Function(this, 'appsync-func', {
      code: lambda.Code.fromEcrImage(funcAsset.repository, {
        tagOrDigest: funcAsset.imageTag
      }),
      runtime: lambda.Runtime.FROM_IMAGE,
      handler: lambda.Handler.FROM_IMAGE,
      role: appsyncExecRole,
      environment: {
        'appsync_endpoint': booksApi.graphqlUrl
      }
    });

/*
    const appsyncTestFunc = new lambda.Function(this, 'appsync-test', {
      functionName: 'appsync-test',
      runtime: lambda.Runtime.PYTHON_3_9,
      handler: 'BooksFunction.index_handler',
      code: lambda.Code.fromAsset(path.join(__dirname, '../src/lambda')),
      role: appsyncExecRole,
      environment: {
        'appsync_endpoint': booksApi.graphqlUrl
      }
    });
*/
  }
}
