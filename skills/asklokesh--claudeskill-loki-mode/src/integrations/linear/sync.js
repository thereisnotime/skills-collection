'use strict';

const crypto = require('crypto');
const { IntegrationAdapter } = require('../adapter');
const { LinearClient, LinearApiError } = require('./client');
const { loadConfig, validateConfig, DEFAULT_STATUS_MAPPING } = require('./config');

/** Maximum webhook request body size in bytes (1 MB). */
const MAX_WEBHOOK_BODY_BYTES = 1 * 1024 * 1024;

/** Valid RARV status values accepted by syncStatus. */
const VALID_RARV_STATUSES = new Set(['REASON', 'ACT', 'REFLECT', 'VERIFY', 'DONE']);

const PRIORITY_MAP = {
  0: 'none',
  1: 'urgent',
  2: 'high',
  3: 'medium',
  4: 'low',
};

class LinearSync extends IntegrationAdapter {
  constructor(config, options = {}) {
    super('linear', options);
    this.config = config || null;
    this.client = null;
    this._stateCache = new Map();
  }

  init(configDir) {
    if (!this.config) {
      this.config = loadConfig(configDir);
    }
    if (!this.config) return false;
    const validation = validateConfig(this.config);
    if (!validation.valid) {
      throw new Error(`Invalid Linear config: ${validation.errors.join(', ')}`);
    }
    this.client = new LinearClient(this.config.apiKey);
    return true;
  }

  async importProject(externalId) {
    this._ensureInitialized();
    return this.withRetry('importProject', async () => {
      let issue;
      try {
        issue = await this.client.getIssue(externalId);
      } catch (e) {
        const isNotFound = (
          (e instanceof LinearApiError && e.statusCode === 404) ||
          (e instanceof LinearApiError && /not found/i.test(e.message))
        );
        if (!isNotFound) {
          throw e;
        }
        const project = await this.client.getProject(externalId);
        return this._projectToPrd(project);
      }
      if (!issue) {
        const project = await this.client.getProject(externalId);
        return this._projectToPrd(project);
      }
      return this._issueToPrd(issue);
    });
  }

  async syncStatus(projectId, status, details) {
    this._ensureInitialized();
    if (!VALID_RARV_STATUSES.has(status)) {
      throw new Error(
        `Unknown RARV status "${status}". Valid values: ${[...VALID_RARV_STATUSES].join(', ')}`
      );
    }
    const mapping = this.config.statusMapping || DEFAULT_STATUS_MAPPING;
    const linearStatus = mapping[status];
    return this.withRetry('syncStatus', async () => {
      const teamId = this._requireTeamId();
      const stateId = await this._resolveStateId(teamId, linearStatus);
      const result = await this.client.updateIssue(projectId, { stateId });
      if (details && details.message) {
        const commentBody = `**Loki Mode [${status}]**: ${details.message}`;
        await this.client.createComment(projectId, commentBody);
      }
      this.emit('status-synced', { externalId: projectId, status, linearStatus, stateId });
      return result;
    });
  }

  async postComment(externalId, content) {
    this._ensureInitialized();
    return this.withRetry('postComment', async () => {
      const result = await this.client.createComment(externalId, content);
      this.emit('comment-posted', { externalId, commentId: result.comment?.id });
      return result;
    });
  }

  async createSubtasks(externalId, tasks) {
    this._ensureInitialized();
    return this.withRetry('createSubtasks', async () => {
      const issue = await this.client.getIssue(externalId);
      const teamId = this._requireTeamId();
      const existingTitles = new Set(
        (issue?.children?.nodes || []).map((c) => c.title)
      );
      const results = [];
      for (const task of tasks) {
        if (existingTitles.has(task.title)) {
          continue;
        }
        const result = await this.client.createSubIssue(
          externalId, teamId, task.title, task.description || ''
        );
        results.push(result);
      }
      this.emit('subtasks-created', { externalId, count: results.length });
      return results;
    });
  }

  getWebhookHandler() {
    const self = this;
    return function webhookHandler(req, res) {
      let body = '';
      let bodySize = 0;
      let aborted = false;
      req.on('data', (chunk) => {
        if (aborted) return;
        bodySize += chunk.length;
        if (bodySize > MAX_WEBHOOK_BODY_BYTES) {
          aborted = true;
          req.destroy();
          res.writeHead(413, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Payload too large' }));
          return;
        }
        body += chunk;
      });
      req.on('end', () => {
        if (aborted) return;
        if (self.config && self.config.webhookSecret) {
          const signature = req.headers['linear-signature'];
          if (!self._verifyWebhookSignature(body, signature)) {
            res.writeHead(401, { 'Content-Type': 'application/json' });
            res.end(JSON.stringify({ error: 'Invalid signature' }));
            return;
          }
        }
        let payload;
        try {
          payload = JSON.parse(body);
        } catch (e) {
          res.writeHead(400, { 'Content-Type': 'application/json' });
          res.end(JSON.stringify({ error: 'Invalid JSON' }));
          return;
        }
        const event = self._processWebhookEvent(payload);
        self.emit('webhook', event);
        res.writeHead(200, { 'Content-Type': 'application/json' });
        res.end(JSON.stringify({ received: true }));
      });
    };
  }

  _ensureInitialized() {
    if (!this.client) {
      throw new Error('LinearSync not initialized. Call init() first.');
    }
  }

  _issueToPrd(issue) {
    const labels = (issue.labels?.nodes || []).map((l) => l.name);
    const priority = PRIORITY_MAP[issue.priority] || 'medium';
    const dependencies = (issue.relations?.nodes || [])
      .filter((r) => r.type === 'blocks' || r.type === 'related')
      .map((r) => ({
        id: r.relatedIssue.id,
        identifier: r.relatedIssue.identifier,
        title: r.relatedIssue.title,
        type: r.type,
      }));
    const subtasks = (issue.children?.nodes || []).map((child) => ({
      id: child.id,
      identifier: child.identifier,
      title: child.title,
      status: child.state?.name || 'unknown',
    }));
    return {
      source: 'linear',
      externalId: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || '',
      priority,
      labels,
      status: issue.state?.name || 'unknown',
      statusType: issue.state?.type || 'unknown',
      assignee: issue.assignee ? {
        name: issue.assignee.name,
        email: issue.assignee.email,
      } : null,
      url: issue.url,
      dependencies,
      subtasks,
      prd: {
        overview: issue.title,
        description: issue.description || '',
        requirements: this._extractRequirements(issue.description || ''),
        priority,
        tags: labels,
      },
    };
  }

  _projectToPrd(project) {
    const issues = (project.issues?.nodes || []).map((issue) => ({
      id: issue.id,
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description || '',
      priority: PRIORITY_MAP[issue.priority] || 'medium',
      status: issue.state?.name || 'unknown',
      labels: (issue.labels?.nodes || []).map((l) => l.name),
    }));
    return {
      source: 'linear',
      externalId: project.id,
      title: project.name,
      description: project.description || '',
      status: project.state,
      url: project.url,
      lead: project.lead ? project.lead.name : null,
      issues,
      prd: {
        overview: project.name,
        description: project.description || '',
        requirements: issues.map((i) => i.title),
        tasks: issues,
      },
    };
  }

  _extractRequirements(description) {
    if (!description) return [];
    const lines = description.split('\n');
    const reqs = [];
    for (const line of lines) {
      const trimmed = line.trim();
      if (/^[-*]\s+/.test(trimmed) || /^\d+\.\s+/.test(trimmed)) {
        reqs.push(trimmed.replace(/^[-*\d.]+\s+/, ''));
      }
    }
    return reqs;
  }

  async _resolveStateId(teamId, statusName) {
    if (!this._stateCache.has(teamId)) {
      const states = await this.client.getTeamStates(teamId);
      this._stateCache.set(teamId, states);
    }
    const states = this._stateCache.get(teamId);
    const state = states.find(
      (s) => s && s.name && s.name.toLowerCase() === statusName.toLowerCase()
    );
    if (!state) {
      throw new Error(`State "${statusName}" not found for team ${teamId}`);
    }
    return state.id;
  }

  _requireTeamId() {
    if (this.config.teamId) return this.config.teamId;
    throw new Error(
      'team_id is required in Linear integration config. Set team_id in .loki/config.yaml.'
    );
  }

  _verifyWebhookSignature(body, signature) {
    if (!signature || !this.config.webhookSecret) return false;
    const hmac = crypto.createHmac('sha256', this.config.webhookSecret);
    hmac.update(body);
    const expected = hmac.digest('hex');
    const normalizedSig = signature.toLowerCase().trim();
    if (normalizedSig.length !== expected.length) return false;
    const sigBuf = Buffer.from(normalizedSig, 'hex');
    const expBuf = Buffer.from(expected, 'hex');
    if (sigBuf.length !== expBuf.length) return false;
    return crypto.timingSafeEqual(sigBuf, expBuf);
  }

  _processWebhookEvent(payload) {
    const { action, type, data, updatedFrom } = payload;
    return {
      action: action || 'unknown',
      type: type || 'unknown',
      data: data || {},
      updatedFrom: updatedFrom || null,
      timestamp: new Date().toISOString(),
      processed: true,
    };
  }
}

module.exports = { LinearSync, PRIORITY_MAP, VALID_RARV_STATUSES, MAX_WEBHOOK_BODY_BYTES };
