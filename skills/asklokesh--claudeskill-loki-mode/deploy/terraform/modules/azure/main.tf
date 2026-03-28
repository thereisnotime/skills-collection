# =============================================================================
# Autonomi -- Azure AKS Module
# =============================================================================
# Provisions:
#   - Resource group
#   - VNet with subnet (or uses existing)
#   - AKS cluster with node pool (or uses existing)
#   - Azure Blob Storage for checkpoints and audit
#   - Managed identity for AKS + storage access
#   - Application Gateway ingress via annotations
#   - Helm release of the Autonomi chart
# =============================================================================

provider "azurerm" {
  features {}
}

# -- Resource Group -----------------------------------------------------------

resource "azurerm_resource_group" "this" {
  name     = var.resource_group_name
  location = var.location
  tags     = var.tags
}

# =============================================================================
# VNet
# =============================================================================

resource "azurerm_virtual_network" "this" {
  count               = var.vnet_id == "" ? 1 : 0
  name                = "${var.cluster_name}-vnet"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  address_space       = [var.vnet_cidr]
  tags                = var.tags
}

resource "azurerm_subnet" "aks" {
  count                = var.vnet_id == "" ? 1 : 0
  name                 = "${var.cluster_name}-aks-subnet"
  resource_group_name  = azurerm_resource_group.this.name
  virtual_network_name = azurerm_virtual_network.this[0].name
  address_prefixes     = [var.subnet_cidr]
}

locals {
  subnet_id = var.vnet_id != "" ? var.vnet_id : azurerm_subnet.aks[0].id
}

# =============================================================================
# AKS Cluster
# =============================================================================

resource "azurerm_kubernetes_cluster" "this" {
  count               = var.create_cluster ? 1 : 0
  name                = var.cluster_name
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  dns_prefix          = var.cluster_name
  kubernetes_version  = var.kubernetes_version

  default_node_pool {
    name                = "default"
    vm_size             = var.node_vm_size
    node_count          = var.node_count
    min_count           = var.node_min_count
    max_count           = var.node_max_count
    enable_auto_scaling = true
    vnet_subnet_id      = local.subnet_id
    os_disk_size_gb     = 50

    tags = var.tags
  }

  identity {
    type = "SystemAssigned"
  }

  network_profile {
    network_plugin    = "azure"
    network_policy    = "calico"
    load_balancer_sku = "standard"
  }

  tags = var.tags
}

# -- Data source for existing cluster ----------------------------------------

data "azurerm_kubernetes_cluster" "existing" {
  count               = var.create_cluster ? 0 : 1
  name                = var.cluster_name
  resource_group_name = var.resource_group_name
}

locals {
  cluster_host       = var.create_cluster ? azurerm_kubernetes_cluster.this[0].kube_config[0].host : data.azurerm_kubernetes_cluster.existing[0].kube_config[0].host
  cluster_ca         = var.create_cluster ? azurerm_kubernetes_cluster.this[0].kube_config[0].cluster_ca_certificate : data.azurerm_kubernetes_cluster.existing[0].kube_config[0].cluster_ca_certificate
  cluster_token      = var.create_cluster ? azurerm_kubernetes_cluster.this[0].kube_config[0].password : data.azurerm_kubernetes_cluster.existing[0].kube_config[0].password
  client_certificate = var.create_cluster ? azurerm_kubernetes_cluster.this[0].kube_config[0].client_certificate : data.azurerm_kubernetes_cluster.existing[0].kube_config[0].client_certificate
  client_key         = var.create_cluster ? azurerm_kubernetes_cluster.this[0].kube_config[0].client_key : data.azurerm_kubernetes_cluster.existing[0].kube_config[0].client_key
}

# -- Kubernetes & Helm providers ----------------------------------------------

provider "kubernetes" {
  host                   = local.cluster_host
  cluster_ca_certificate = base64decode(local.cluster_ca)
  client_certificate     = base64decode(local.client_certificate)
  client_key             = base64decode(local.client_key)
}

provider "helm" {
  kubernetes {
    host                   = local.cluster_host
    cluster_ca_certificate = base64decode(local.cluster_ca)
    client_certificate     = base64decode(local.client_certificate)
    client_key             = base64decode(local.client_key)
  }
}

# =============================================================================
# Azure Blob Storage
# =============================================================================

resource "random_id" "storage_suffix" {
  byte_length = 4
}

resource "azurerm_storage_account" "autonomi" {
  name                     = "${var.storage_account_name}${random_id.storage_suffix.hex}"
  resource_group_name      = azurerm_resource_group.this.name
  location                 = azurerm_resource_group.this.location
  account_tier             = "Standard"
  account_replication_type = "LRS"
  min_tls_version          = "TLS1_2"

  blob_properties {
    versioning_enabled = true
    delete_retention_policy {
      days = 30
    }
  }

  tags = var.tags
}

resource "azurerm_storage_container" "autonomi" {
  name                  = "autonomi"
  storage_account_name  = azurerm_storage_account.autonomi.name
  container_access_type = "private"
}

# -- Managed Identity for storage access --------------------------------------

resource "azurerm_role_assignment" "aks_storage" {
  count                = var.create_cluster ? 1 : 0
  scope                = azurerm_storage_account.autonomi.id
  role_definition_name = "Storage Blob Data Contributor"
  principal_id         = azurerm_kubernetes_cluster.this[0].kubelet_identity[0].object_id
}

# =============================================================================
# Helm Release -- Autonomi
# =============================================================================

resource "kubernetes_namespace" "autonomi" {
  metadata {
    name = var.helm_namespace
    labels = {
      "app.kubernetes.io/managed-by" = "terraform"
    }
  }
}

resource "helm_release" "autonomi" {
  name      = "autonomi"
  chart     = var.helm_chart_path
  namespace = var.helm_namespace

  values = [
    yamlencode({
      ingress = {
        enabled   = var.domain_name != ""
        className = "azure-application-gateway"
        annotations = {
          "appgw.ingress.kubernetes.io/ssl-redirect" = "true"
        }
        hosts = var.domain_name != "" ? [{
          host = var.domain_name
          paths = [{
            path     = "/"
            pathType = "Prefix"
          }]
        }] : []
      }
      config = {
        checkpointDir = "az://${azurerm_storage_account.autonomi.name}/${azurerm_storage_container.autonomi.name}/checkpoints"
        auditLogPath  = "az://${azurerm_storage_account.autonomi.name}/${azurerm_storage_container.autonomi.name}/audit"
      }
    })
  ]

  dynamic "set" {
    for_each = var.helm_values
    content {
      name  = set.key
      value = set.value
    }
  }

  depends_on = [kubernetes_namespace.autonomi]
}
