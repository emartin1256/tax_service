variable "project_id" {
  description = "GCP project ID"
  type        = string
  default     = "tax-service-513123"
}

variable "project_number" {
  description = "GCP project number"
  type        = string
  default     = "338378273837"
}

variable "region" {
  description = "GCP region for Cloud Run and Artifact Registry"
  type        = string
  default     = "us-central1"
}

variable "service_name" {
  description = "Cloud Run service name"
  type        = string
  default     = "tax-service"
}

variable "artifact_repository_id" {
  description = "Artifact Registry Docker repository ID"
  type        = string
  default     = "tax-service"
}

variable "github_repository" {
  description = "GitHub repository allowed to authenticate via WIF (owner/repo). Set via TF_VAR_github_repository before apply."
  type        = string
}
