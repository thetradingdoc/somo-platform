# Staging scheduled jobs (Cloud Scheduler)

Trial maintenance and optional DLQ workers on **staging** (`api.myskinandcare.com`).

## Jobs

| Job | Schedule (UTC) | Command |
|-----|----------------|---------|
| Trial expiry sweep | `0 6 * * *` (daily 06:00) | `npm run trial:expiry-sweep:apply` |
| Trial nudge emails | `0 14 * * *` (daily 14:00) | `npm run trial:nudge-sweep` |

## Cloud Run Job pattern

Create one job image (same as `myskin-middleware`) with overridden command:

```bash
export PROJECT=doctor-little-c688d
export REGION=us-central1
export JOB=somo-staging-cron-trial-expiry

gcloud run jobs create "$JOB" \
  --project="$PROJECT" \
  --region="$REGION" \
  --image="gcr.io/${PROJECT}/myskin-middleware:latest" \
  --set-cloudsql-instances="${PROJECT}:${REGION}:somo-staging-pg" \
  --set-env-vars="CLOUDRUN_PROFILE=staging" \
  --command="npm" \
  --args="run,trial:expiry-sweep:apply" \
  --tasks=1 \
  --max-retries=1
```

Repeat for `somo-staging-cron-trial-nudge` with args `run,trial:nudge-sweep`.

## Cloud Scheduler

```bash
gcloud scheduler jobs create http somo-staging-trial-expiry \
  --project="$PROJECT" \
  --location="$REGION" \
  --schedule="0 6 * * *" \
  --uri="https://${REGION}-run.googleapis.com/apis/run.googleapis.com/v1/namespaces/${PROJECT}/jobs/${JOB}:run" \
  --http-method=POST \
  --oauth-service-account-email="somo-staging-scheduler@${PROJECT}.iam.gserviceaccount.com"
```

Grant the scheduler SA `roles/run.invoker` on the job.

## Local dry-run

```bash
cd middleware-platform
npm run trial:expiry-sweep          # dry-run
npm run trial:nudge-sweep
```

## Related

- Trial rollout: [STAGING_TRIAL_ROLLOUT.md](./STAGING_TRIAL_ROLLOUT.md)
- Bootstrap: `npm run bootstrap:staging --prefix middleware-platform`
