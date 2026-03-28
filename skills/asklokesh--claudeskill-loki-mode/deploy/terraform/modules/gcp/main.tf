# =============================================================================
# Autonomi -- GCP GKE Module
# =============================================================================
# Provisions:
#   - VPC network with subnet (or uses existing)
#   - GKE cluster with node pool (or uses existing)
#   - GCS bucket for checkpoints and audit
#   - Workload Identity for GCS access
#   - Cloud Load Balancer with managed certificate
#   - Helm release of the Autonomi chart
# =============================================================================

provider "google" {
  project = var.project_id
  region  = var.region
}

# =============================================================================
# VPC Network
# =============================================================================

resource "google_compute_network" "this" {
  count                   = var.network_name == "" ? 1 : 0
  name                    = "${var.cluster_name}-vpc"
  project                 = var.project_id
  auto_create_subnetworks = false
}

resource "google_compute_subnetwork" "gke" {
  count         = var.network_name == "" ? 1 : 0
  name          = "${var.cluster_name}-gke-subnet"
  project       = var.project_id
  region        = var.region
  network       = google_compute_network.this[0].id
  ip_cidr_range = var.subnet_cidr

  secondary_ip_range {
    range_name    = "pods"
    ip_cidr_range = var.pods_cidr
  }

  secondary_ip_range {
    range_name    = "services"
    ip_cidr_range = var.services_cidr
  }
}

locals {
  network    = var.network_name != "" ? var.network_name : google_compute_network.this[0].name
  subnetwork = var.network_name != "" ? "" : google_compute_subnetwork.gke[0].name
}

# -- Cloud Router + NAT (for private nodes) -----------------------------------

resource "google_compute_router" "this" {
  count   = var.network_name == "" ? 1 : 0
  name    = "${var.cluster_name}-router"
  project = var.project_id
  region  = var.region
  network = google_compute_network.this[0].id
}

resource "google_compute_router_nat" "this" {
  count                              = var.network_name == "" ? 1 : 0
  name                               = "${var.cluster_name}-nat"
  project                            = var.project_id
  router                             = google_compute_router.this[0].name
  region                             = var.region
  nat_ip_allocate_option             = "AUTO_ONLY"
  source_subnetwork_ip_ranges_to_nat = "ALL_SUBNETWORKS_ALL_IP_RANGES"
}

# =============================================================================
# GKE Cluster
# =============================================================================

resource "google_container_cluster" "this" {
  count    = var.create_cluster ? 1 : 0
  name     = var.cluster_name
  project  = var.project_id
  location = var.region

  network    = local.network
  subnetwork = local.subnetwork

  # We manage the node pool separately
  remove_default_node_pool = true
  initial_node_count       = 1

  ip_allocation_policy {
    cluster_secondary_range_name  = "pods"
    services_secondary_range_name = "services"
  }

  workload_identity_config {
    workload_pool = "${var.project_id}.svc.id.goog"
  }

  release_channel {
    channel = "REGULAR"
  }

  resource_labels = var.tags
}

resource "google_container_node_pool" "default" {
  count      = var.create_cluster ? 1 : 0
  name       = "default-pool"
  project    = var.project_id
  location   = var.region
  cluster    = google_container_cluster.this[0].name
  node_count = var.node_count

  autoscaling {
    min_node_count = var.node_min_count
    max_node_count = var.node_max_count
  }

  node_config {
    machine_type = var.machine_type
    disk_size_gb = 50
    disk_type    = "pd-standard"

    oauth_scopes = [
      "https://www.googleapis.com/auth/cloud-platform",
    ]

    workload_metadata_config {
      mode = "GKE_METADATA"
    }

    labels = var.tags
  }

  management {
    auto_repair  = true
    auto_upgrade = true
  }
}

# -- Data source for existing cluster ----------------------------------------

data "google_container_cluster" "existing" {
  count    = var.create_cluster ? 0 : 1
  name     = var.cluster_name
  location = var.region
  project  = var.project_id
}

locals {
  cluster_endpoint = var.create_cluster ? google_container_cluster.this[0].endpoint : data.google_container_cluster.existing[0].endpoint
  cluster_ca       = var.create_cluster ? google_container_cluster.this[0].master_auth[0].cluster_ca_certificate : data.google_container_cluster.existing[0].master_auth[0].cluster_ca_certificate
}

# -- Kubernetes & Helm providers ----------------------------------------------

data "google_client_config" "default" {}

provider "kubernetes" {
  host                   = "https://${local.cluster_endpoint}"
  cluster_ca_certificate = base64decode(local.cluster_ca)
  token                  = data.google_client_config.default.access_token
}

provider "helm" {
  kubernetes {
    host                   = "https://${local.cluster_endpoint}"
    cluster_ca_certificate = base64decode(local.cluster_ca)
    token                  = data.google_client_config.default.access_token
  }
}

# =============================================================================
# GCS Bucket (checkpoints + audit logs)
# =============================================================================

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "google_storage_bucket" "autonomi" {
  name          = "${var.gcs_bucket_name}-${random_id.bucket_suffix.hex}"
  project       = var.project_id
  location      = var.gcs_location
  force_destroy = false

  uniform_bucket_level_access = true

  versioning {
    enabled = true
  }

  lifecycle_rule {
    condition {
      age = 90
      matches_prefix = ["audit/"]
    }
    action {
      type          = "SetStorageClass"
      storage_class = "NEARLINE"
    }
  }

  lifecycle_rule {
    condition {
      age = 365
      matches_prefix = ["audit/"]
    }
    action {
      type = "Delete"
    }
  }

  labels = var.tags
}

# =============================================================================
# Workload Identity (GKE -> GCS)
# =============================================================================

resource "google_service_account" "autonomi" {
  account_id   = "${var.cluster_name}-autonomi"
  display_name = "Autonomi Workload Identity SA"
  project      = var.project_id
}

resource "google_project_iam_member" "autonomi_gcs" {
  project = var.project_id
  role    = "roles/storage.objectAdmin"
  member  = "serviceAccount:${google_service_account.autonomi.email}"
}

resource "google_service_account_iam_member" "workload_identity" {
  count              = var.create_cluster ? 1 : 0
  service_account_id = google_service_account.autonomi.name
  role               = "roles/iam.workloadIdentityUser"
  member             = "serviceAccount:${var.project_id}.svc.id.goog[${var.helm_namespace}/autonomi]"
}

# =============================================================================
# Managed SSL Certificate (optional)
# =============================================================================

resource "google_compute_managed_ssl_certificate" "autonomi" {
  count   = var.domain_name != "" ? 1 : 0
  name    = "${var.cluster_name}-cert"
  project = var.project_id

  managed {
    domains = [var.domain_name]
  }
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

  depends_on = [google_container_node_pool.default]
}

resource "helm_release" "autonomi" {
  name      = "autonomi"
  chart     = var.helm_chart_path
  namespace = var.helm_namespace

  values = [
    yamlencode({
      serviceAccount = {
        annotations = {
          "iam.gke.io/gcp-service-account" = google_service_account.autonomi.email
        }
      }
      ingress = {
        enabled   = var.domain_name != ""
        className = "gce"
        annotations = var.domain_name != "" ? {
          "networking.gke.io/managed-certificates" = "${var.cluster_name}-cert"
          "kubernetes.io/ingress.global-static-ip-name" = "${var.cluster_name}-ip"
        } : {}
        hosts = var.domain_name != "" ? [{
          host = var.domain_name
          paths = [{
            path     = "/"
            pathType = "Prefix"
          }]
        }] : []
      }
      config = {
        checkpointDir = "gs://${google_storage_bucket.autonomi.name}/checkpoints"
        auditLogPath  = "gs://${google_storage_bucket.autonomi.name}/audit"
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
