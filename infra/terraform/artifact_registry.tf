resource "google_artifact_registry_repository" "docker" {
  depends_on = [google_project_service.required]

  project       = var.project_id
  location      = var.region
  repository_id = var.artifact_repository_id
  description   = "Docker images for ${var.service_name}"
  format        = "DOCKER"

  cleanup_policy_dry_run = false

  cleanup_policies {
    id     = "keep-recent-versions"
    action = "KEEP"
    most_recent_versions {
      keep_count = 5
    }
  }

  cleanup_policies {
    id     = "delete-untagged-old"
    action = "DELETE"
    condition {
      tag_state  = "UNTAGGED"
      older_than = "604800s"
    }
  }
}
