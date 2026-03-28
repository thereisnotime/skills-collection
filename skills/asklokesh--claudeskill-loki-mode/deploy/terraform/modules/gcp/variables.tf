# -----------------------------------------------------------------------------
# GCP Module Variables
# -----------------------------------------------------------------------------

variable "project_id" {
  description = "GCP project ID."
  type        = string
}

variable "region" {
  description = "GCP region for all resources."
  type        = string
  default     = "us-central1"
}

variable "zone" {
  description = "GCP zone for zonal resources."
  type        = string
  default     = "us-central1-a"
}

# -- Networking ---------------------------------------------------------------

variable "network_name" {
  description = "Name of an existing VPC network. Leave empty to create a new one."
  type        = string
  default     = ""
}

variable "subnet_cidr" {
  description = "CIDR for the GKE subnet (ignored when using existing network)."
  type        = string
  default     = "10.0.0.0/24"
}

variable "pods_cidr" {
  description = "Secondary CIDR for GKE pods."
  type        = string
  default     = "10.1.0.0/16"
}

variable "services_cidr" {
  description = "Secondary CIDR for GKE services."
  type        = string
  default     = "10.2.0.0/20"
}

# -- GKE Cluster --------------------------------------------------------------

variable "create_cluster" {
  description = "Whether to create a new GKE cluster. Set false to use an existing one."
  type        = bool
  default     = true
}

variable "cluster_name" {
  description = "Name of the GKE cluster."
  type        = string
  default     = "autonomi"
}

variable "machine_type" {
  description = "Machine type for default node pool."
  type        = string
  default     = "e2-standard-2"
}

variable "node_count" {
  description = "Initial number of nodes per zone."
  type        = number
  default     = 1
}

variable "node_min_count" {
  description = "Minimum nodes per zone for autoscaling."
  type        = number
  default     = 1
}

variable "node_max_count" {
  description = "Maximum nodes per zone for autoscaling."
  type        = number
  default     = 3
}

# -- Storage ------------------------------------------------------------------

variable "gcs_bucket_name" {
  description = "Name for the GCS bucket. A random suffix is appended."
  type        = string
  default     = "autonomi"
}

variable "gcs_location" {
  description = "Location for the GCS bucket."
  type        = string
  default     = "US"
}

# -- Ingress / TLS ------------------------------------------------------------

variable "domain_name" {
  description = "Domain name for the dashboard (used in managed cert and ingress)."
  type        = string
  default     = ""
}

# -- Helm ---------------------------------------------------------------------

variable "helm_chart_path" {
  description = "Path to the local Helm chart."
  type        = string
  default     = "../../../helm/autonomi"
}

variable "helm_namespace" {
  description = "Kubernetes namespace for the Helm release."
  type        = string
  default     = "autonomi"
}

variable "helm_values" {
  description = "Additional Helm values to merge (map of key = value)."
  type        = map(string)
  default     = {}
}

# -- Labels -------------------------------------------------------------------

variable "tags" {
  description = "Labels applied to all GCP resources."
  type        = map(string)
  default = {
    managed-by = "terraform"
    project    = "autonomi"
  }
}
