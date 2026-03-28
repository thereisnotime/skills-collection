# =============================================================================
# Example: Autonomi on Azure AKS
# =============================================================================
# Deploy Autonomi control plane to a new AKS cluster.
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

  # Uncomment to use Azure backend for remote state:
  # backend "azurerm" {
  #   resource_group_name  = "terraform-state-rg"
  #   storage_account_name = "tfstate"
  #   container_name       = "state"
  #   key                  = "autonomi/azure-aks/terraform.tfstate"
  # }
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "eastus"
}

variable "resource_group_name" {
  description = "Azure resource group name."
  type        = string
  default     = "autonomi-rg"
}

variable "cluster_name" {
  description = "AKS cluster name."
  type        = string
  default     = "autonomi"
}

variable "node_vm_size" {
  description = "VM size for worker nodes."
  type        = string
  default     = "Standard_D2s_v3"
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

module "autonomi" {
  source = "../../modules/azure"

  location            = var.location
  resource_group_name = var.resource_group_name
  cluster_name        = var.cluster_name
  node_vm_size        = var.node_vm_size
  node_count          = var.node_count
  domain_name         = var.domain_name

  tags = {
    Environment = "dev"
    ManagedBy   = "terraform"
    Project     = "autonomi"
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

output "storage_account_name" {
  value = module.autonomi.storage_account_name
}
