## 🎨 art-vandelay

This is a containerized workflow to query object data from [The Met's API](https://metmuseum.github.io/), generate OpenAI's [CLIP](https://github.com/jina-ai/clip-as-service) image embeddings, and load them into `art-vandelay-db`: an OpenSearch vector database as well as S3 bucket for corresponding images. The process is accelerated by GPU.

## Folder Structure

```
poll-position/
├── .github/
│   └── workflows/
│       └── deploy.yml              # GitHub Actions workflow for CI/CD
├── bin/
│   └── art-vandelay.ts            # CDK entrypoint
├── lib/
│   └── art-vandelay-stack.ts      # CDK stack definition (S3, VPC, ECS, Fargate, Logs, Secrets, etc.)
├── app/
│   ├── main.py                     # Python app to get raw data from API and upload to S3
│   ├── Dockerfile                  # Dockerfile for containerizing the app
│   └── requirements.txt            # Python dependencies for the app
├── package.json                    # NPM dependencies for CDK
├── tsconfig.json                   # TypeScript configuration
├── cdk.json                        # CDK app configuration
└── cdk.context.json                # CDK context for environment-specific configurations (auto-generated)
```

## Prerequisites

* AWS account and IAM user with minimal policy, like:
```
```
* A deployment of requisite infrastructure like [art-vandelay-db](github.com/reedmarkham/art-vandelay-db)
* Before running the workflow, add the following secrets to your GitHub repository’s **Settings > Secrets and variables > Actions > repository secrets**:

| Secret Name         | Description                                              | Example                |
|---------------------|---------------------------------------------------------|--------------------------------------|
| `AWS_ACCESS_KEY_ID` | AWS access key with permissions for ECS, S3, OpenSearch | `AKIA...`                            |
| `AWS_SECRET_ACCESS_KEY` | AWS secret key for the above access key             | `wJalrXUtnFEMI/K7MDENG/bPxRfiCY...`  |
| `AWS_REGION`        | AWS region for deployment                               | `us-east-1`                          |
| `AWS_IAM_ARN`       | ARN of IAM user allowed to assume ECS task role         | `arn:aws:iam::123456789012:user/ci`  |
| `S3_BUCKET`         | Name of the S3 bucket for storing data and images       | `art-vandelay`                       |
| `OPENSEARCH_DOMAIN_ARN` | ARN of the OpenSearch domain                       | `arn:aws:es:us-east-1:...:domain/...`|

## CI/CD

Deployed to AWS on commits to main.