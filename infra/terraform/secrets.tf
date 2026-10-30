resource "google_secret_manager_secret" "database_url" {
  depends_on = [google_project_service.required]

  project   = var.project_id
  secret_id = "database-url"

  replication {
    auto {}
  }
}

resource "google_secret_manager_secret_iam_member" "runtime_database_url" {
  project   = var.project_id
  secret_id = google_secret_manager_secret.database_url.secret_id
  role      = "roles/secretmanager.secretAccessor"
  member    = "serviceAccount:${google_service_account.runtime.email}"
}
