## 🎨 art-vandelay

This is a containerized process to query object data from The Met's API in order to generate [CLIP](https://github.com/jina-ai/clip-as-service) image embeddings and load them into `art-vandelay-db`: a previously-deployed OpenSearch domain and S3 bucket for corresponding images.

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

## CI/CD

Deployed to AWS on commits to main.