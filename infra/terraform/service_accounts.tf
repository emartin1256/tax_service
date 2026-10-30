resource "google_service_account" "runtime" {
  depends_on = [google_project_service.required]

  project      = var.project_id
  account_id   = "tax-service-runtime"
  display_name = "Tax service Cloud Run runtime"
}

resource "google_service_account" "deployer" {
  depends_on = [google_project_service.required]

  project      = var.project_id
  account_id   = "tax-service-deployer"
  display_name = "Tax service GitHub Actions deployer (WIF only)"
}

resource "google_project_iam_member" "deployer_artifact_writer" {
  project = var.project_id
  role    = "roles/artifactregistry.writer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_project_iam_member" "deployer_run_developer" {
  project = var.project_id
  role    = "roles/run.developer"
  member  = "serviceAccount:${google_service_account.deployer.email}"
}

resource "google_service_account_iam_member" "deployer_act_as_runtime" {
  service_account_id = google_service_account.runtime.name
  role               = "roles/iam.serviceAccountUser"
  member             = "serviceAccount:${google_service_account.deployer.email}"
}
