# =============================================================================
# Example: Autonomi on AWS EKS
# =============================================================================
# Deploy Autonomi control plane to a new EKS cluster.
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

  # Uncomment to use S3 backend for remote state:
  # backend "s3" {
  #   bucket = "my-terraform-state"
  #   key    = "autonomi/aws-eks/terraform.tfstate"
  #   region = "us-west-2"
  # }
}

variable "region" {
  description = "AWS region."
  type        = string
  default     = "us-west-2"
}

variable "cluster_name" {
  description = "EKS cluster name."
  type        = string
  default     = "autonomi"
}

variable "node_instance_type" {
  description = "EC2 instance type for worker nodes."
  type        = string
  default     = "t3.large"
}

variable "node_count" {
  description = "Number of worker nodes."
  type        = number
  default     = 3
}

variable "domain_name" {
  description = "Domain name for the dashboard (leave empty to skip ingress)."
  type        = string
  default     = ""
}

variable "acm_certificate_arn" {
  description = "ACM certificate ARN for HTTPS (leave empty for HTTP only)."
  type        = string
  default     = ""
}

module "autonomi" {
  source = "../../modules/aws"

  region              = var.region
  cluster_name        = var.cluster_name
  node_instance_type  = var.node_instance_type
  node_count          = var.node_count
  domain_name         = var.domain_name
  acm_certificate_arn = var.acm_certificate_arn

  tags = {
    Environment = "dev"
    ManagedBy   = "terraform"
    Project     = "autonomi"
  }
}

output "cluster_endpoint" {
  value = module.autonomi.cluster_endpoint
}

output "kubeconfig_command" {
  value = module.autonomi.kubeconfig_command
}

output "dashboard_url" {
  value = module.autonomi.dashboard_url
}

output "s3_bucket_name" {
  value = module.autonomi.s3_bucket_name
}
