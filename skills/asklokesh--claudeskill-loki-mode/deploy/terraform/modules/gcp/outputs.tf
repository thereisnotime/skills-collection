# -----------------------------------------------------------------------------
# GCP Module Outputs
# -----------------------------------------------------------------------------

output "cluster_name" {
  description = "Name of the GKE cluster."
  value       = var.cluster_name
}

output "dashboard_url" {
  description = "URL to access the Autonomi dashboard."
  value       = var.domain_name != "" ? "https://${var.domain_name}" : "http://<LB_IP>:57374"
}

output "kubeconfig_command" {
  description = "Command to configure kubectl."
  value       = "gcloud container clusters get-credentials ${var.cluster_name} --region ${var.region} --project ${var.project_id}"
}

output "gcs_bucket_name" {
  description = "Name of the GCS bucket for checkpoints and audit."
  value       = google_storage_bucket.autonomi.name
}
