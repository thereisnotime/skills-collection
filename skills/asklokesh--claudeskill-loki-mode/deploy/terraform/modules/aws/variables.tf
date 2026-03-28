# -----------------------------------------------------------------------------
# AWS Module Variables
# -----------------------------------------------------------------------------

variable "region" {
  description = "AWS region for all resources."
  type        = string
  default     = "us-west-2"
}

# -- Networking ---------------------------------------------------------------

variable "vpc_id" {
  description = "ID of an existing VPC. Leave empty to create a new one."
  type        = string
  default     = ""
}

variable "vpc_cidr" {
  description = "CIDR block for the new VPC (ignored when vpc_id is set)."
  type        = string
  default     = "10.0.0.0/16"
}

variable "availability_zones" {
  description = "List of AZs. Defaults to first 3 AZs in the region."
  type        = list(string)
  default     = []
}

# -- EKS Cluster --------------------------------------------------------------

variable "create_cluster" {
  description = "Whether to create a new EKS cluster. Set false to use an existing one."
  type        = bool
  default     = true
}

variable "cluster_name" {
  description = "Name of the EKS cluster (existing or new)."
  type        = string
  default     = "autonomi"
}

variable "cluster_version" {
  description = "Kubernetes version for EKS."
  type        = string
  default     = "1.29"
}

variable "node_instance_type" {
  description = "EC2 instance type for the managed node group."
  type        = string
  default     = "t3.large"
}

variable "node_count" {
  description = "Desired number of worker nodes."
  type        = number
  default     = 3
}

variable "node_min_count" {
  description = "Minimum number of worker nodes for autoscaling."
  type        = number
  default     = 1
}

variable "node_max_count" {
  description = "Maximum number of worker nodes for autoscaling."
  type        = number
  default     = 6
}

# -- Storage ------------------------------------------------------------------

variable "s3_bucket_prefix" {
  description = "Prefix for the S3 bucket name. A random suffix is appended."
  type        = string
  default     = "autonomi"
}

# -- Ingress / TLS ------------------------------------------------------------

variable "acm_certificate_arn" {
  description = "ARN of an ACM certificate for the ALB. Leave empty to skip HTTPS."
  type        = string
  default     = ""
}

variable "domain_name" {
  description = "Domain name for the dashboard (used in ingress host)."
  type        = string
  default     = ""
}

# -- Helm ---------------------------------------------------------------------

variable "helm_chart_path" {
  description = "Path to the local Helm chart. Relative paths are resolved from the module."
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

# -- Tags ---------------------------------------------------------------------

variable "tags" {
  description = "Tags applied to all AWS resources."
  type        = map(string)
  default = {
    ManagedBy = "terraform"
    Project   = "autonomi"
  }
}
