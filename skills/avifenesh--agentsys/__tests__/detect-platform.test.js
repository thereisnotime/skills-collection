/**
 * Tests for detect-platform.js
 */

const path = require('path');
const fs = require('fs');

// Mock fs module
jest.mock('fs', () => ({
  promises: {
    access: jest.fn(),
    readFile: jest.fn()
  }
}));

// Mock child_process
jest.mock('child_process', () => ({
  exec: jest.fn()
}));

const { exec } = require('child_process');

// Import after mocking
const {
  detect,
  invalidateCache,
  detectCI,
  detectDeployment,
  detectProjectType,
  detectPackageManager,
  detectBranchStrategy,
  detectMainBranch
} = require('../lib/platform/detect-platform');

describe('detect-platform', () => {
  beforeEach(() => {
    jest.clearAllMocks();
    invalidateCache();
    fs.promises.access.mockRejectedValue(new Error('ENOENT'));
  });

  describe('detectCI', () => {
    it('should detect github-actions when .github/workflows exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === '.github/workflows'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectCI()).toBe('github-actions');
    });

    it('should detect gitlab-ci when .gitlab-ci.yml exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === '.gitlab-ci.yml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectCI()).toBe('gitlab-ci');
    });

    it('should detect circleci when .circleci/config.yml exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === '.circleci/config.yml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectCI()).toBe('circleci');
    });

    it('should detect jenkins when Jenkinsfile exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'Jenkinsfile'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectCI()).toBe('jenkins');
    });

    it('should detect travis when .travis.yml exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === '.travis.yml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectCI()).toBe('travis');
    });

    it('should return null when no CI config found', async () => {
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));
      expect(await detectCI()).toBeNull();
    });

    describe('multi-CI precedence', () => {
      it('should prioritize github-actions over all others', async () => {
        fs.promises.access.mockImplementation((path) =>
          ['.github/workflows', '.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile', '.travis.yml'].includes(path)
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );
        expect(await detectCI()).toBe('github-actions');
      });

      it('should prioritize gitlab-ci when github-actions absent', async () => {
        fs.promises.access.mockImplementation((path) =>
          ['.gitlab-ci.yml', '.circleci/config.yml', 'Jenkinsfile', '.travis.yml'].includes(path)
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );
        expect(await detectCI()).toBe('gitlab-ci');
      });

      it('should prioritize circleci when github-actions and gitlab absent', async () => {
        fs.promises.access.mockImplementation((path) =>
          ['.circleci/config.yml', 'Jenkinsfile', '.travis.yml'].includes(path)
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );
        expect(await detectCI()).toBe('circleci');
      });

      it('should prioritize jenkins when only jenkins and travis present', async () => {
        fs.promises.access.mockImplementation((path) =>
          ['Jenkinsfile', '.travis.yml'].includes(path)
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );
        expect(await detectCI()).toBe('jenkins');
      });

      it('should return travis only when no other CI present', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === '.travis.yml'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );
        expect(await detectCI()).toBe('travis');
      });
    });
  });

  describe('detectDeployment', () => {
    it('should detect railway when railway.json exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'railway.json'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectDeployment()).toBe('railway');
    });

    it('should detect vercel when vercel.json exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'vercel.json'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectDeployment()).toBe('vercel');
    });

    it('should detect netlify when netlify.toml exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'netlify.toml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectDeployment()).toBe('netlify');
    });

    it('should detect fly when fly.toml exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'fly.toml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectDeployment()).toBe('fly');
    });

    it('should return null when no deployment config found', async () => {
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));
      expect(await detectDeployment()).toBeNull();
    });
  });

  describe('detectProjectType', () => {
    it('should detect nodejs when package.json exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'package.json'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectProjectType()).toBe('nodejs');
    });

    it('should detect python when requirements.txt exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'requirements.txt'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectProjectType()).toBe('python');
    });

    it('should detect python when pyproject.toml exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'pyproject.toml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectProjectType()).toBe('python');
    });

    it('should detect rust when Cargo.toml exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'Cargo.toml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectProjectType()).toBe('rust');
    });

    it('should detect go when go.mod exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'go.mod'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectProjectType()).toBe('go');
    });

    it('should detect java when pom.xml exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'pom.xml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectProjectType()).toBe('java');
    });

    it('should return unknown when no project file found', async () => {
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));
      expect(await detectProjectType()).toBe('unknown');
    });
  });

  describe('detectPackageManager', () => {
    it('should detect pnpm when pnpm-lock.yaml exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'pnpm-lock.yaml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectPackageManager()).toBe('pnpm');
    });

    it('should detect yarn when yarn.lock exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'yarn.lock'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectPackageManager()).toBe('yarn');
    });

    it('should detect npm when package-lock.json exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'package-lock.json'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectPackageManager()).toBe('npm');
    });

    it('should detect bun when bun.lockb exists', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'bun.lockb'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      expect(await detectPackageManager()).toBe('bun');
    });

    it('should return null when no lockfile found', async () => {
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));
      expect(await detectPackageManager()).toBeNull();
    });
  });

  describe('detectMainBranch', () => {
    it('should return main branch from git symbolic-ref', async () => {
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' });
      });

      expect(await detectMainBranch()).toBe('main');
    });

    it('should fallback to main if symbolic-ref fails but main exists', async () => {
      let callCount = 0;
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        callCount++;
        if (callCount === 1) {
          cb(new Error('not found'), { stdout: '', stderr: '' });
        } else {
          cb(null, { stdout: 'abc123', stderr: '' });
        }
      });

      expect(await detectMainBranch()).toBe('main');
    });

    it('should fallback to master if main does not exist', async () => {
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(new Error('not found'), { stdout: '', stderr: '' });
      });

      expect(await detectMainBranch()).toBe('master');
    });
  });

  describe('detect (main function)', () => {
    it('should return cached result on subsequent calls', async () => {
      fs.promises.access.mockImplementation((path) =>
        path === 'package.json'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' });
      });

      const result1 = await detect();
      const result2 = await detect();

      expect(result1).toBe(result2);
      expect(result1.projectType).toBe('nodejs');
    });

    it('should refresh cache when forceRefresh is true', async () => {
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' });
      });

      const result1 = await detect();
      expect(result1.projectType).toBe('unknown');

      invalidateCache();
      fs.promises.access.mockImplementation((path) =>
        path === 'Cargo.toml'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );

      const result2 = await detect(true);
      expect(result2.projectType).toBe('rust');
    });

    it('should include timestamp in result', async () => {
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' });
      });
      const result = await detect();
      expect(result.timestamp).toBeDefined();
      expect(typeof result.timestamp).toBe('string');
    });

    it('should handle all detection functions failing gracefully', async () => {
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(new Error('git error'), { stdout: '', stderr: '' });
      });

      const result = await detect();

      expect(result).toBeDefined();
      expect(result.ci).toBeNull();
      expect(result.deployment).toBeNull();
      expect(result.projectType).toBe('unknown');
      expect(result.packageManager).toBeNull();
      expect(result.timestamp).toBeDefined();
    });
  });

  describe('invalidateCache', () => {
    it('should force new detection on next call', async () => {
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' });
      });

      await detect();
      invalidateCache();

      fs.promises.access.mockImplementation((path) =>
        path === 'go.mod'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );

      const result = await detect();
      expect(result.projectType).toBe('go');
    });
  });

  describe('cache behavior', () => {
    describe('detection result caching', () => {
      it('should return same reference for cached results within TTL', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === 'package.json'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );
        exec.mockImplementation((cmd, opts, cb) => {
          if (typeof opts === 'function') cb = opts;
          cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' });
        });

        const result1 = await detect();
        const result2 = await detect();

        expect(result1).toBe(result2);
      });

      it('should detect changes after cache invalidation', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === 'package.json'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );
        exec.mockImplementation((cmd, opts, cb) => {
          if (typeof opts === 'function') cb = opts;
          cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' });
        });

        const result1 = await detect();
        expect(result1.projectType).toBe('nodejs');

        invalidateCache();
        fs.promises.access.mockImplementation((path) =>
          path === 'Cargo.toml'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );

        const result2 = await detect();
        expect(result2.projectType).toBe('rust');
        expect(result1).not.toBe(result2);
      });

      it('should re-detect when forceRefresh is true', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === 'package.json'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );
        exec.mockImplementation((cmd, opts, cb) => {
          if (typeof opts === 'function') cb = opts;
          cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' });
        });

        const result1 = await detect();

        fs.promises.access.mockImplementation((path) =>
          path === 'go.mod'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );
        invalidateCache();

        const result2 = await detect(true);

        expect(result1.projectType).toBe('nodejs');
        expect(result2.projectType).toBe('go');
      });
    });

    describe('CI detection precedence', () => {
      it('should detect github-actions first when multiple CI configs exist', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === '.github/workflows' || path === '.gitlab-ci.yml'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );

        expect(await detectCI()).toBe('github-actions');
      });

      it('should fall back to gitlab-ci when github-actions not present', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === '.gitlab-ci.yml' || path === '.circleci/config.yml'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );

        expect(await detectCI()).toBe('gitlab-ci');
      });

      it('should detect circleci when higher priority CI not present', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === '.circleci/config.yml' || path === 'Jenkinsfile'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );

        expect(await detectCI()).toBe('circleci');
      });
    });

    describe('deployment detection precedence', () => {
      it('should detect railway first when multiple deployment configs exist', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === 'railway.json' || path === 'vercel.json'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );

        expect(await detectDeployment()).toBe('railway');
      });

      it('should detect vercel when railway not present', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === 'vercel.json' || path === 'netlify.toml'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );

        expect(await detectDeployment()).toBe('vercel');
      });
    });

    describe('project type detection precedence', () => {
      it('should detect nodejs when package.json and other files exist', async () => {
        fs.promises.access.mockImplementation((path) =>
          path === 'package.json' || path === 'requirements.txt'
            ? Promise.resolve()
            : Promise.reject(new Error('ENOENT'))
        );

        expect(await detectProjectType()).toBe('nodejs');
      });
    });
  });

  describe('detectBranchStrategy', () => {
    it('should return single-branch when git commands fail', async () => {
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(new Error('git error'), { stdout: '', stderr: '' });
      });

      expect(await detectBranchStrategy()).toBe('single-branch');
    });

    it('should return multi-branch when stable branch exists', async () => {
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: '* main\n  stable\n', stderr: '' });
      });
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));

      expect(await detectBranchStrategy()).toBe('multi-branch');
    });

    it('should return single-branch when no stable/production branches', async () => {
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: '* main\n  feature/test\n', stderr: '' });
      });
      fs.promises.access.mockRejectedValue(new Error('ENOENT'));

      expect(await detectBranchStrategy()).toBe('single-branch');
    });
  });

  describe('error handling edge cases', () => {
    it('should handle mixed success/failure in parallel async operations', async () => {
      let callCount = 0;
      fs.promises.access.mockImplementation((path) => {
        callCount++;
        if (path === 'package.json') return Promise.resolve();
        if (callCount % 3 === 0) return Promise.reject(new Error('EPERM'));
        return Promise.reject(new Error('ENOENT'));
      });
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: 'refs/remotes/origin/main\n', stderr: '' });
      });

      const result = await detect();
      expect(result.projectType).toBe('nodejs');
    });

    it('should handle slow operations without hanging', async () => {
      fs.promises.access.mockImplementation((path) =>
        new Promise((resolve, reject) => {
          setTimeout(() => reject(new Error('ENOENT')), 10);
        })
      );
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        setTimeout(() => cb(null, { stdout: 'main\n', stderr: '' }), 10);
      });

      const result = await detect();
      expect(result).toBeDefined();
    }, 10000);

    it('should recover from file read errors in branch strategy detection', async () => {
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: '* main\n', stderr: '' });
      });
      fs.promises.access.mockImplementation((path) =>
        path === 'railway.json'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      fs.promises.readFile.mockRejectedValue(new Error('EACCES'));

      const result = await detectBranchStrategy();
      expect(result).toBe('single-branch');
    });

    it('should handle JSON parse errors in railway.json gracefully', async () => {
      exec.mockImplementation((cmd, opts, cb) => {
        if (typeof opts === 'function') cb = opts;
        cb(null, { stdout: '* main\n', stderr: '' });
      });
      fs.promises.access.mockImplementation((path) =>
        path === 'railway.json'
          ? Promise.resolve()
          : Promise.reject(new Error('ENOENT'))
      );
      fs.promises.readFile.mockResolvedValue('invalid json {{{');

      const result = await detectBranchStrategy();
      expect(result).toBe('single-branch');
    });
  });
});
