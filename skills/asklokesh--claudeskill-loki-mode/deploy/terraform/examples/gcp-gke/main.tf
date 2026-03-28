# =============================================================================
# Example: Autonomi on GCP GKE
# =============================================================================
# Deploy Autonomi control plane to a new GKE cluster.
#
# Usage:
#   cp terraform.tfvars.example terraform.tfvars
#   # Edit terraform.tfvars with your values
#   terraform init
#   terraform plan
#   terraform apply
# =============================================================================

terraform {
  required_version = ">= 1.5"

  # Uncomment to use GCS backend for remote state:
  # backend "gcs" {
  #   bucket = "my-terraform-state"
  #   prefix = "autonomi/gcp-gke"
  # }
}

variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "GCP region."
  type        = string
  default     = "us-central1"
}

variable "cluster_name" {
  description = "GKE cluster name."
  type        = string
  default     = "autonomi"
}

variable "machine_type" {
  description = "Machine type for worker nodes."
  type        = string
  default     = "e2-standard-2"
}

variable "node_count" {
  description = "Number of nodes per zone."
  type        = number
  default     = 1
}

variable "domain_name" {
  description = "Domain name for the dashboard (leave empty to skip ingress)."
  type        = string
  default     = ""
}

module "autonomi" {
  source = "../../modules/gcp"

  project_id   = var.project_id
  region       = var.region
  cluster_name = var.cluster_name
  machine_type = var.machine_type
  node_count   = var.node_count
  domain_name  = var.domain_name

  tags = {
    environment = "dev"
    managed-by  = "terraform"
    project     = "autonomi"
  }
}

output "cluster_name" {
  value = module.autonomi.cluster_name
}

output "kubeconfig_command" {
  value = module.autonomi.kubeconfig_command
}

output "dashboard_url" {
  value = module.autonomi.dashboard_url
}

output "gcs_bucket_name" {
  value = module.autonomi.gcs_bucket_name
}
