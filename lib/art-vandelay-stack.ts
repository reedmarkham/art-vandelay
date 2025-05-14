import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as ecsPatterns from 'aws-cdk-lib/aws-ecs-patterns';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class ArtVandelayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'ArtVandelayVpc', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'ArtVandelayCluster', { vpc });
    const metApiSecret = secretsmanager.Secret.fromSecretNameV2(this, 'MetApiKeySecret', 'MET_API_KEY');

    const taskRole = new iam.Role(this, 'ArtVandelayTaskRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });

    const iamUserArn = process.env.AWS_IAM_ARN;
    if (!iamUserArn) {
      throw new Error('Environment variable AWS_IAM_ARN is not defined');
    }
    const iamUser = iam.User.fromUserArn(this, 'ArtVandelayIamUser', iamUserArn);

    taskRole.grantAssumeRole(iamUser);

    metApiSecret.grantRead(taskRole);

    const logGroup = new logs.LogGroup(this, 'ArtVandelayLogGroup');

    const executionRole = new iam.Role(this, 'ArtVandelayExecutionRole', {
      assumedBy: new iam.ServicePrincipal('ecs-tasks.amazonaws.com'),
    });
    executionRole.addToPolicy(new iam.PolicyStatement({
      actions: [
        "ecr:GetAuthorizationToken",
        "ecr:BatchCheckLayerAvailability",
        "ecr:GetDownloadUrlForLayer",
        "ecr:BatchGetImage",
        "logs:CreateLogStream",
        "logs:PutLogEvents"
      ],
      resources: ["*"],
    }));

    const taskDef = new ecs.FargateTaskDefinition(this, 'ArtVandelayTaskDef', {
      memoryLimitMiB: 512,
      cpu: 256,
      taskRole,
      executionRole,
    });

    const s3BucketName = process.env.S3_BUCKET || 'art-vandelay';
    const bucket = new s3.Bucket(this, 'ArtVandelayBucket', {
      bucketName: s3BucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    bucket.grantReadWrite(taskRole);

    taskDef.addContainer('ArtVandelayContainer', {
      image: ecs.ContainerImage.fromRegistry(`${cdk.Aws.ACCOUNT_ID}.dkr.ecr.${cdk.Aws.REGION}.amazonaws.com/art-vandelay:latest`),
      logging: ecs.LogDriver.awsLogs({
        streamPrefix: 'art-vandelay',
        logGroup,
      }),
      environment: {
        S3_BUCKET: bucket.bucketName,
      },
      secrets: {
        MET_API_KEY: ecs.Secret.fromSecretsManager(metApiSecret, 'MET_API_KEY'),
      },
    });

    new ecsPatterns.ScheduledFargateTask(this, 'ScheduledArtVandelayTask', {
      cluster,
      scheduledFargateTaskDefinitionOptions: {
        taskDefinition: taskDef,
      },
      schedule: cdk.aws_events.Schedule.cron({ weekDay: 'MON', hour: '12', minute: '0' }),
      subnetSelection: { subnetType: ec2.SubnetType.PUBLIC },
      platformVersion: ecs.FargatePlatformVersion.LATEST,
    });

    new cdk.CfnOutput(this, 'AdHocTaskCommand', {
      value: `aws ecs run-task \\
        --cluster ${cluster.clusterName} \\
        --launch-type FARGATE \\
        --network-configuration "awsvpcConfiguration={subnets=[${vpc.publicSubnets[0].subnetId}],securityGroups=[],assignPublicIp=ENABLED}" \\
        --task-definition ${taskDef.taskDefinitionArn}`,
    });
  }
}
