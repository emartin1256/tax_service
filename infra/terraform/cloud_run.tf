resource "google_cloud_run_v2_service" "tax_service" {
  depends_on = [
    google_project_service.required,
    google_secret_manager_secret_iam_member.runtime_database_url,
  ]

  name     = var.service_name
  project  = var.project_id
  location = var.region
  ingress  = "INGRESS_TRAFFIC_ALL"

  template {
    service_account = google_service_account.runtime.email

    scaling {
      min_instance_count = 0
      max_instance_count = 2
    }

    max_instance_request_concurrency = 80
    timeout                          = "60s"

    containers {
      name  = "tax-service"
      image = "us-docker.pkg.dev/cloudrun/container/hello"

      ports {
        container_port = 8080
      }

      resources {
        limits = {
          cpu    = "1"
          memory = "512Mi"
        }
        cpu_idle = true
      }

      env {
        name  = "NODE_ENV"
        value = "production"
      }

      env {
        name  = "LOG_LEVEL"
        value = "info"
      }

      env {
        name  = "OTEL_ENABLED"
        value = "true"
      }

      env {
        name  = "PORT"
        value = "8080"
      }

      env {
        name = "DATABASE_URL"
        value_source {
          secret_key_ref {
            secret  = google_secret_manager_secret.database_url.secret_id
            version = "latest"
          }
        }
      }

      startup_probe {
        tcp_socket {
          port = 8080
        }
        initial_delay_seconds = 0
        timeout_seconds       = 1
        period_seconds        = 3
        failure_threshold     = 3
      }
    }
  }

  lifecycle {
    ignore_changes = [
      template[0].containers[0].image,
    ]
  }
}

resource "google_cloud_run_v2_service_iam_member" "public_invoker" {
  project  = var.project_id
  location = google_cloud_run_v2_service.tax_service.location
  name     = google_cloud_run_v2_service.tax_service.name
  role     = "roles/run.invoker"
  member   = "allUsers"
}
