# -----------------------------------------------------------------------------
# Azure Module Variables
# -----------------------------------------------------------------------------

variable "location" {
  description = "Azure region for all resources."
  type        = string
  default     = "eastus"
}

variable "resource_group_name" {
  description = "Name of the Azure resource group."
  type        = string
  default     = "autonomi-rg"
}

# -- Networking ---------------------------------------------------------------

variable "vnet_id" {
  description = "ID of an existing VNet. Leave empty to create a new one."
  type        = string
  default     = ""
}

variable "vnet_cidr" {
  description = "Address space for the new VNet (ignored when vnet_id is set)."
  type        = string
  default     = "10.0.0.0/16"
}

variable "subnet_cidr" {
  description = "CIDR for the default AKS subnet (ignored when vnet_id is set)."
  type        = string
  default     = "10.0.1.0/24"
}

# -- AKS Cluster --------------------------------------------------------------

variable "create_cluster" {
  description = "Whether to create a new AKS cluster. Set false to use an existing one."
  type        = bool
  default     = true
}

variable "cluster_name" {
  description = "Name of the AKS cluster."
  type        = string
  default     = "autonomi"
}

variable "kubernetes_version" {
  description = "Kubernetes version for AKS."
  type        = string
  default     = "1.29"
}

variable "node_vm_size" {
  description = "VM size for the default node pool."
  type        = string
  default     = "Standard_D2s_v3"
}

variable "node_count" {
  description = "Number of nodes in the default pool."
  type        = number
  default     = 3
}

variable "node_min_count" {
  description = "Minimum node count for autoscaling."
  type        = number
  default     = 1
}

variable "node_max_count" {
  description = "Maximum node count for autoscaling."
  type        = number
  default     = 6
}

# -- Storage ------------------------------------------------------------------

variable "storage_account_name" {
  description = "Name for the Azure Storage Account (must be globally unique, 3-24 lowercase alphanumeric)."
  type        = string
  default     = "autonomistorage"
}

# -- Ingress / TLS ------------------------------------------------------------

variable "domain_name" {
  description = "Domain name for the dashboard (used in ingress host)."
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

# -- Tags ---------------------------------------------------------------------

variable "tags" {
  description = "Tags applied to all Azure resources."
  type        = map(string)
  default = {
    ManagedBy = "terraform"
    Project   = "autonomi"
  }
}
