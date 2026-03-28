# =============================================================================
# Autonomi -- AWS EKS Module
# =============================================================================
# Provisions:
#   - VPC with public/private subnets (or uses existing)
#   - EKS cluster with managed node group (or uses existing)
#   - S3 bucket for checkpoints and audit logs
#   - IAM roles for service accounts (IRSA) for S3 access
#   - ALB Ingress Controller via Helm
#   - Helm release of the Autonomi chart
#   - Security groups for cluster, workers, and ALB
# =============================================================================

provider "aws" {
  region = var.region
}

# -- Data sources -------------------------------------------------------------

data "aws_caller_identity" "current" {}

data "aws_availability_zones" "available" {
  state = "available"
}

locals {
  azs        = length(var.availability_zones) > 0 ? var.availability_zones : slice(data.aws_availability_zones.available.names, 0, 3)
  account_id = data.aws_caller_identity.current.account_id

  cluster_endpoint = var.create_cluster ? aws_eks_cluster.this[0].endpoint : data.aws_eks_cluster.existing[0].endpoint
  cluster_ca       = var.create_cluster ? aws_eks_cluster.this[0].certificate_authority[0].data : data.aws_eks_cluster.existing[0].certificate_authority[0].data
  cluster_token    = data.aws_eks_cluster_auth.this.token
}

data "aws_eks_cluster" "existing" {
  count = var.create_cluster ? 0 : 1
  name  = var.cluster_name
}

data "aws_eks_cluster_auth" "this" {
  name = var.cluster_name
}

# -- Kubernetes & Helm providers (configured after cluster exists) ------------

provider "kubernetes" {
  host                   = local.cluster_endpoint
  cluster_ca_certificate = base64decode(local.cluster_ca)
  token                  = local.cluster_token
}

provider "helm" {
  kubernetes {
    host                   = local.cluster_endpoint
    cluster_ca_certificate = base64decode(local.cluster_ca)
    token                  = local.cluster_token
  }
}

# =============================================================================
# VPC
# =============================================================================

resource "aws_vpc" "this" {
  count = var.vpc_id == "" ? 1 : 0

  cidr_block           = var.vpc_cidr
  enable_dns_hostnames = true
  enable_dns_support   = true

  tags = merge(var.tags, { Name = "${var.cluster_name}-vpc" })
}

locals {
  vpc_id = var.vpc_id != "" ? var.vpc_id : aws_vpc.this[0].id
}

# -- Internet Gateway ---------------------------------------------------------

resource "aws_internet_gateway" "this" {
  count  = var.vpc_id == "" ? 1 : 0
  vpc_id = local.vpc_id
  tags   = merge(var.tags, { Name = "${var.cluster_name}-igw" })
}

# -- Subnets ------------------------------------------------------------------

resource "aws_subnet" "public" {
  count = var.vpc_id == "" ? length(local.azs) : 0

  vpc_id                  = local.vpc_id
  cidr_block              = cidrsubnet(var.vpc_cidr, 8, count.index)
  availability_zone       = local.azs[count.index]
  map_public_ip_on_launch = true

  tags = merge(var.tags, {
    Name                                        = "${var.cluster_name}-public-${local.azs[count.index]}"
    "kubernetes.io/role/elb"                     = "1"
    "kubernetes.io/cluster/${var.cluster_name}"  = "shared"
  })
}

resource "aws_subnet" "private" {
  count = var.vpc_id == "" ? length(local.azs) : 0

  vpc_id            = local.vpc_id
  cidr_block        = cidrsubnet(var.vpc_cidr, 8, count.index + length(local.azs))
  availability_zone = local.azs[count.index]

  tags = merge(var.tags, {
    Name                                             = "${var.cluster_name}-private-${local.azs[count.index]}"
    "kubernetes.io/role/internal-elb"                 = "1"
    "kubernetes.io/cluster/${var.cluster_name}"       = "shared"
  })
}

# -- NAT Gateway (one per VPC for cost efficiency) ----------------------------

resource "aws_eip" "nat" {
  count  = var.vpc_id == "" ? 1 : 0
  domain = "vpc"
  tags   = merge(var.tags, { Name = "${var.cluster_name}-nat-eip" })
}

resource "aws_nat_gateway" "this" {
  count         = var.vpc_id == "" ? 1 : 0
  allocation_id = aws_eip.nat[0].id
  subnet_id     = aws_subnet.public[0].id
  tags          = merge(var.tags, { Name = "${var.cluster_name}-nat" })

  depends_on = [aws_internet_gateway.this]
}

# -- Route Tables -------------------------------------------------------------

resource "aws_route_table" "public" {
  count  = var.vpc_id == "" ? 1 : 0
  vpc_id = local.vpc_id
  tags   = merge(var.tags, { Name = "${var.cluster_name}-public-rt" })
}

resource "aws_route" "public_internet" {
  count                  = var.vpc_id == "" ? 1 : 0
  route_table_id         = aws_route_table.public[0].id
  destination_cidr_block = "0.0.0.0/0"
  gateway_id             = aws_internet_gateway.this[0].id
}

resource "aws_route_table_association" "public" {
  count          = var.vpc_id == "" ? length(local.azs) : 0
  subnet_id      = aws_subnet.public[count.index].id
  route_table_id = aws_route_table.public[0].id
}

resource "aws_route_table" "private" {
  count  = var.vpc_id == "" ? 1 : 0
  vpc_id = local.vpc_id
  tags   = merge(var.tags, { Name = "${var.cluster_name}-private-rt" })
}

resource "aws_route" "private_nat" {
  count                  = var.vpc_id == "" ? 1 : 0
  route_table_id         = aws_route_table.private[0].id
  destination_cidr_block = "0.0.0.0/0"
  nat_gateway_id         = aws_nat_gateway.this[0].id
}

resource "aws_route_table_association" "private" {
  count          = var.vpc_id == "" ? length(local.azs) : 0
  subnet_id      = aws_subnet.private[count.index].id
  route_table_id = aws_route_table.private[0].id
}

# =============================================================================
# Security Groups
# =============================================================================

resource "aws_security_group" "cluster" {
  count  = var.create_cluster ? 1 : 0
  name   = "${var.cluster_name}-cluster-sg"
  vpc_id = local.vpc_id

  ingress {
    description = "Allow worker nodes to communicate with the cluster API"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = [var.vpc_cidr]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.cluster_name}-cluster-sg" })
}

resource "aws_security_group" "workers" {
  count  = var.create_cluster ? 1 : 0
  name   = "${var.cluster_name}-workers-sg"
  vpc_id = local.vpc_id

  ingress {
    description = "Allow inter-node communication"
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    self        = true
  }

  ingress {
    description     = "Allow cluster API to reach workers"
    from_port       = 1025
    to_port         = 65535
    protocol        = "tcp"
    security_groups = [aws_security_group.cluster[0].id]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.cluster_name}-workers-sg" })
}

resource "aws_security_group" "alb" {
  count  = var.create_cluster ? 1 : 0
  name   = "${var.cluster_name}-alb-sg"
  vpc_id = local.vpc_id

  ingress {
    description = "HTTP"
    from_port   = 80
    to_port     = 80
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  ingress {
    description = "HTTPS"
    from_port   = 443
    to_port     = 443
    protocol    = "tcp"
    cidr_blocks = ["0.0.0.0/0"]
  }

  egress {
    from_port   = 0
    to_port     = 0
    protocol    = "-1"
    cidr_blocks = ["0.0.0.0/0"]
  }

  tags = merge(var.tags, { Name = "${var.cluster_name}-alb-sg" })
}

# =============================================================================
# EKS Cluster
# =============================================================================

resource "aws_iam_role" "cluster" {
  count = var.create_cluster ? 1 : 0
  name  = "${var.cluster_name}-cluster-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "eks.amazonaws.com"
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "cluster_policy" {
  count      = var.create_cluster ? 1 : 0
  role       = aws_iam_role.cluster[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSClusterPolicy"
}

resource "aws_iam_role_policy_attachment" "cluster_vpc_controller" {
  count      = var.create_cluster ? 1 : 0
  role       = aws_iam_role.cluster[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSVPCResourceController"
}

resource "aws_eks_cluster" "this" {
  count    = var.create_cluster ? 1 : 0
  name     = var.cluster_name
  version  = var.cluster_version
  role_arn = aws_iam_role.cluster[0].arn

  vpc_config {
    subnet_ids         = concat(aws_subnet.public[*].id, aws_subnet.private[*].id)
    security_group_ids = [aws_security_group.cluster[0].id]
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy_attachment.cluster_policy,
    aws_iam_role_policy_attachment.cluster_vpc_controller,
  ]
}

# -- Managed Node Group -------------------------------------------------------

resource "aws_iam_role" "node" {
  count = var.create_cluster ? 1 : 0
  name  = "${var.cluster_name}-node-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Action = "sts:AssumeRole"
      Effect = "Allow"
      Principal = {
        Service = "ec2.amazonaws.com"
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "node_worker" {
  count      = var.create_cluster ? 1 : 0
  role       = aws_iam_role.node[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKSWorkerNodePolicy"
}

resource "aws_iam_role_policy_attachment" "node_cni" {
  count      = var.create_cluster ? 1 : 0
  role       = aws_iam_role.node[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEKS_CNI_Policy"
}

resource "aws_iam_role_policy_attachment" "node_ecr" {
  count      = var.create_cluster ? 1 : 0
  role       = aws_iam_role.node[0].name
  policy_arn = "arn:aws:iam::aws:policy/AmazonEC2ContainerRegistryReadOnly"
}

resource "aws_eks_node_group" "this" {
  count           = var.create_cluster ? 1 : 0
  cluster_name    = aws_eks_cluster.this[0].name
  node_group_name = "${var.cluster_name}-default"
  node_role_arn   = aws_iam_role.node[0].arn
  subnet_ids      = aws_subnet.private[*].id
  instance_types  = [var.node_instance_type]

  scaling_config {
    desired_size = var.node_count
    min_size     = var.node_min_count
    max_size     = var.node_max_count
  }

  tags = var.tags

  depends_on = [
    aws_iam_role_policy_attachment.node_worker,
    aws_iam_role_policy_attachment.node_cni,
    aws_iam_role_policy_attachment.node_ecr,
  ]
}

# =============================================================================
# S3 Bucket (checkpoints + audit logs)
# =============================================================================

resource "random_id" "bucket_suffix" {
  byte_length = 4
}

resource "aws_s3_bucket" "autonomi" {
  bucket = "${var.s3_bucket_prefix}-${random_id.bucket_suffix.hex}"
  tags   = merge(var.tags, { Name = "${var.s3_bucket_prefix}-storage" })
}

resource "aws_s3_bucket_versioning" "autonomi" {
  bucket = aws_s3_bucket.autonomi.id
  versioning_configuration {
    status = "Enabled"
  }
}

resource "aws_s3_bucket_server_side_encryption_configuration" "autonomi" {
  bucket = aws_s3_bucket.autonomi.id
  rule {
    apply_server_side_encryption_by_default {
      sse_algorithm = "aws:kms"
    }
  }
}

resource "aws_s3_bucket_public_access_block" "autonomi" {
  bucket                  = aws_s3_bucket.autonomi.id
  block_public_acls       = true
  block_public_policy     = true
  ignore_public_acls      = true
  restrict_public_buckets = true
}

resource "aws_s3_bucket_lifecycle_configuration" "autonomi" {
  bucket = aws_s3_bucket.autonomi.id

  rule {
    id     = "audit-log-retention"
    status = "Enabled"

    filter {
      prefix = "audit/"
    }

    transition {
      days          = 90
      storage_class = "STANDARD_IA"
    }

    expiration {
      days = 365
    }
  }
}

# =============================================================================
# IRSA (IAM Roles for Service Accounts)
# =============================================================================

data "tls_certificate" "cluster" {
  count = var.create_cluster ? 1 : 0
  url   = aws_eks_cluster.this[0].identity[0].oidc[0].issuer
}

resource "aws_iam_openid_connect_provider" "cluster" {
  count           = var.create_cluster ? 1 : 0
  client_id_list  = ["sts.amazonaws.com"]
  thumbprint_list = [data.tls_certificate.cluster[0].certificates[0].sha1_fingerprint]
  url             = aws_eks_cluster.this[0].identity[0].oidc[0].issuer
  tags            = var.tags
}

locals {
  oidc_issuer = var.create_cluster ? replace(aws_eks_cluster.this[0].identity[0].oidc[0].issuer, "https://", "") : ""
  oidc_arn    = var.create_cluster ? aws_iam_openid_connect_provider.cluster[0].arn : ""
}

resource "aws_iam_role" "autonomi_s3" {
  count = var.create_cluster ? 1 : 0
  name  = "${var.cluster_name}-autonomi-s3-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.oidc_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_issuer}:sub" = "system:serviceaccount:${var.helm_namespace}:autonomi"
          "${local.oidc_issuer}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_role_policy" "autonomi_s3" {
  count = var.create_cluster ? 1 : 0
  name  = "${var.cluster_name}-autonomi-s3-policy"
  role  = aws_iam_role.autonomi_s3[0].id

  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "s3:GetObject",
          "s3:PutObject",
          "s3:ListBucket",
          "s3:DeleteObject",
        ]
        Resource = [
          aws_s3_bucket.autonomi.arn,
          "${aws_s3_bucket.autonomi.arn}/*",
        ]
      }
    ]
  })
}

# =============================================================================
# ALB Ingress Controller (via Helm)
# =============================================================================

resource "aws_iam_role" "alb_controller" {
  count = var.create_cluster ? 1 : 0
  name  = "${var.cluster_name}-alb-controller-role"

  assume_role_policy = jsonencode({
    Version = "2012-10-17"
    Statement = [{
      Effect = "Allow"
      Principal = {
        Federated = local.oidc_arn
      }
      Action = "sts:AssumeRoleWithWebIdentity"
      Condition = {
        StringEquals = {
          "${local.oidc_issuer}:sub" = "system:serviceaccount:kube-system:aws-load-balancer-controller"
          "${local.oidc_issuer}:aud" = "sts.amazonaws.com"
        }
      }
    }]
  })

  tags = var.tags
}

resource "aws_iam_policy" "alb_controller" {
  count  = var.create_cluster ? 1 : 0
  name   = "${var.cluster_name}-alb-controller"
  policy = jsonencode({
    Version = "2012-10-17"
    Statement = [
      {
        Effect = "Allow"
        Action = [
          "elasticloadbalancing:CreateLoadBalancer",
          "elasticloadbalancing:DeleteLoadBalancer",
          "elasticloadbalancing:DescribeLoadBalancers",
          "elasticloadbalancing:ModifyLoadBalancerAttributes",
          "elasticloadbalancing:DescribeLoadBalancerAttributes",
          "elasticloadbalancing:CreateTargetGroup",
          "elasticloadbalancing:DeleteTargetGroup",
          "elasticloadbalancing:DescribeTargetGroups",
          "elasticloadbalancing:ModifyTargetGroupAttributes",
          "elasticloadbalancing:RegisterTargets",
          "elasticloadbalancing:DeregisterTargets",
          "elasticloadbalancing:DescribeTargetHealth",
          "elasticloadbalancing:CreateListener",
          "elasticloadbalancing:DeleteListener",
          "elasticloadbalancing:DescribeListeners",
          "elasticloadbalancing:CreateRule",
          "elasticloadbalancing:DeleteRule",
          "elasticloadbalancing:DescribeRules",
          "elasticloadbalancing:AddTags",
          "elasticloadbalancing:RemoveTags",
          "elasticloadbalancing:DescribeTags",
          "ec2:DescribeSubnets",
          "ec2:DescribeSecurityGroups",
          "ec2:DescribeVpcs",
          "ec2:CreateSecurityGroup",
          "ec2:AuthorizeSecurityGroupIngress",
          "ec2:RevokeSecurityGroupIngress",
          "ec2:DeleteSecurityGroup",
          "ec2:DescribeInstances",
          "ec2:DescribeNetworkInterfaces",
          "ec2:DescribeAccountAttributes",
          "ec2:DescribeAddresses",
          "ec2:DescribeInternetGateways",
          "iam:CreateServiceLinkedRole",
          "cognito-idp:DescribeUserPoolClient",
          "acm:ListCertificates",
          "acm:DescribeCertificate",
          "wafv2:GetWebACLForResource",
          "wafv2:AssociateWebACL",
          "wafv2:DisassociateWebACL",
          "shield:GetSubscriptionState"
        ]
        Resource = "*"
      }
    ]
  })

  tags = var.tags
}

resource "aws_iam_role_policy_attachment" "alb_controller" {
  count      = var.create_cluster ? 1 : 0
  role       = aws_iam_role.alb_controller[0].name
  policy_arn = aws_iam_policy.alb_controller[0].arn
}

resource "helm_release" "alb_controller" {
  count      = var.create_cluster ? 1 : 0
  name       = "aws-load-balancer-controller"
  repository = "https://aws.github.io/eks-charts"
  chart      = "aws-load-balancer-controller"
  namespace  = "kube-system"
  version    = "1.7.2"

  set {
    name  = "clusterName"
    value = var.cluster_name
  }

  set {
    name  = "serviceAccount.create"
    value = "true"
  }

  set {
    name  = "serviceAccount.name"
    value = "aws-load-balancer-controller"
  }

  set {
    name  = "serviceAccount.annotations.eks\\.amazonaws\\.com/role-arn"
    value = aws_iam_role.alb_controller[0].arn
  }

  set {
    name  = "region"
    value = var.region
  }

  set {
    name  = "vpcId"
    value = local.vpc_id
  }

  depends_on = [aws_eks_node_group.this]
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

  depends_on = [aws_eks_node_group.this]
}

resource "helm_release" "autonomi" {
  name      = "autonomi"
  chart     = var.helm_chart_path
  namespace = var.helm_namespace

  values = [
    yamlencode({
      serviceAccount = {
        annotations = var.create_cluster ? {
          "eks.amazonaws.com/role-arn" = aws_iam_role.autonomi_s3[0].arn
        } : {}
      }
      ingress = {
        enabled   = var.domain_name != ""
        className = "alb"
        annotations = merge(
          {
            "alb.ingress.kubernetes.io/scheme"      = "internet-facing"
            "alb.ingress.kubernetes.io/target-type"  = "ip"
          },
          var.acm_certificate_arn != "" ? {
            "alb.ingress.kubernetes.io/certificate-arn" = var.acm_certificate_arn
            "alb.ingress.kubernetes.io/listen-ports"    = "[{\"HTTPS\":443}]"
            "alb.ingress.kubernetes.io/ssl-redirect"    = "443"
          } : {}
        )
        hosts = var.domain_name != "" ? [{
          host = var.domain_name
          paths = [{
            path     = "/"
            pathType = "Prefix"
          }]
        }] : []
      }
      config = {
        checkpointDir = "s3://${aws_s3_bucket.autonomi.id}/checkpoints"
        auditLogPath  = "s3://${aws_s3_bucket.autonomi.id}/audit"
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

  depends_on = [
    kubernetes_namespace.autonomi,
    helm_release.alb_controller,
  ]
}
