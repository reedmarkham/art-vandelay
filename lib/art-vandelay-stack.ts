import * as cdk from 'aws-cdk-lib';
import { Construct } from 'constructs';
import * as ec2 from 'aws-cdk-lib/aws-ec2';
import * as ecs from 'aws-cdk-lib/aws-ecs';
import * as logs from 'aws-cdk-lib/aws-logs';
import * as secretsmanager from 'aws-cdk-lib/aws-secretsmanager';
import * as iam from 'aws-cdk-lib/aws-iam';
import * as s3 from 'aws-cdk-lib/aws-s3';

export class ArtVandelayStack extends cdk.Stack {
  constructor(scope: Construct, id: string, props?: cdk.StackProps) {
    super(scope, id, props);

    const vpc = new ec2.Vpc(this, 'ArtVandelayVpc', { maxAzs: 2 });
    const cluster = new ecs.Cluster(this, 'ArtVandelayCluster', { vpc });

    // Add an AutoScalingGroup with GPU instances to the cluster
    cluster.addCapacity('GpuAutoScalingGroup', {
      instanceType: new ec2.InstanceType('g4dn.xlarge'), // Or p3.2xlarge, etc.
      minCapacity: 1,
      machineImage: ecs.EcsOptimizedImage.amazonLinux2(ecs.AmiHardwareType.GPU),
      vpcSubnets: { subnetType: ec2.SubnetType.PUBLIC },
    });

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

    const s3BucketName = process.env.S3_BUCKET || 'art-vandelay';
    const bucket = new s3.Bucket(this, 'ArtVandelayBucket', {
      bucketName: s3BucketName,
      removalPolicy: cdk.RemovalPolicy.DESTROY,
      autoDeleteObjects: true,
    });

    bucket.grantReadWrite(taskRole);

    // GPU-enabled task definition
    const taskDef = new ecs.Ec2TaskDefinition(this, 'ArtVandelayGpuTaskDef', {
      networkMode: ecs.NetworkMode.AWS_VPC,
    });

    // Add GPU resource requirement
    taskDef.addContainer('ArtVandelayGpuContainer', {
      image: ecs.ContainerImage.fromRegistry(`${cdk.Aws.ACCOUNT_ID}.dkr.ecr.${cdk.Aws.REGION}.amazonaws.com/art-vandelay:latest`),
      memoryLimitMiB: 4096,
      cpu: 1024,
      gpuCount: 1,
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

    // Add ECS Service using EC2 launch type
    new ecs.Ec2Service(this, 'ArtVandelayGpuService', {
      cluster,
      taskDefinition: taskDef,
      desiredCount: 1,
      assignPublicIp: true,
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
