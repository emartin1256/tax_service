output "workload_identity_provider" {
  description = "Full resource name for GitHub Actions google-github-actions/auth workload_identity_provider"
  value       = google_iam_workload_identity_pool_provider.github.name
}

output "deployer_service_account_email" {
  description = "Deployer service account email for GitHub Actions auth"
  value       = google_service_account.deployer.email
}

output "runtime_service_account_email" {
  description = "Cloud Run runtime service account email"
  value       = google_service_account.runtime.email
}

output "cloud_run_service_name" {
  description = "Cloud Run service name"
  value       = google_cloud_run_v2_service.tax_service.name
}

output "artifact_registry_repository" {
  description = "Artifact Registry Docker repository resource ID"
  value       = google_artifact_registry_repository.docker.id
}
