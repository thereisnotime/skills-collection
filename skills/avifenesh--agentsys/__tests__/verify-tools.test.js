/**
 * Tests for verify-tools.js
 */

// Mock child_process
jest.mock('child_process', () => ({
  spawn: jest.fn()
}));

const { spawn } = require('child_process');
const { EventEmitter } = require('events');

const {
  checkTool,
  verifyTools,
  TOOL_DEFINITIONS
} = require('../lib/platform/verify-tools');

describe('verify-tools', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  describe('checkTool', () => {
    it('should resolve with available: true when tool exists', async () => {
      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.kill = jest.fn();

      spawn.mockReturnValue(mockChild);

      const promise = checkTool('node');

      mockChild.stdout.emit('data', Buffer.from('v20.0.0\n'));
      mockChild.emit('close', 0);

      const result = await promise;
      expect(result.available).toBe(true);
      expect(result.version).toBe('v20.0.0');
    });

    it('should resolve with available: false when tool errors', async () => {
      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.kill = jest.fn();

      spawn.mockReturnValue(mockChild);

      const promise = checkTool('nonexistent');

      mockChild.emit('error', new Error('spawn ENOENT'));

      const result = await promise;
      expect(result.available).toBe(false);
      expect(result.version).toBeNull();
    });

    it('should resolve with available: false on non-zero exit', async () => {
      const mockChild = new EventEmitter();
      mockChild.stdout = new EventEmitter();
      mockChild.kill = jest.fn();

      spawn.mockReturnValue(mockChild);

      const promise = checkTool('failing-tool');
      mockChild.emit('close', 1);

      const result = await promise;
      expect(result.available).toBe(false);
    });

    it('should reject invalid command characters', async () => {
      const result = await checkTool('rm; cat /etc/passwd');
      expect(result.available).toBe(false);
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should reject commands with invalid characters', async () => {
      const result = await checkTool('rm -rf /');
      expect(result.available).toBe(false);
      expect(result.version).toBeNull();
      expect(spawn).not.toHaveBeenCalled();
    });

    it('should reject version flags with invalid characters', async () => {
      const result = await checkTool('git', '--version; rm -rf /');
      expect(result.available).toBe(false);
      expect(result.version).toBeNull();
      expect(spawn).not.toHaveBeenCalled();
    });

    describe('timeout behavior', () => {
      beforeEach(() => {
        jest.useFakeTimers();
      });

      afterEach(() => {
        jest.useRealTimers();
      });

      it('should timeout and kill process after 5 seconds', async () => {
        const mockChild = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.kill = jest.fn();

        spawn.mockReturnValue(mockChild);

        const promise = checkTool('slow-tool');

        jest.advanceTimersByTime(5001);

        const result = await promise;

        expect(mockChild.kill).toHaveBeenCalled();
        expect(result.available).toBe(false);
        expect(result.version).toBeNull();
      });

      it('should not kill process if it completes before timeout', async () => {
        const mockChild = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.kill = jest.fn();

        spawn.mockReturnValue(mockChild);

        const promise = checkTool('fast-tool');

        mockChild.stdout.emit('data', Buffer.from('v1.0.0\n'));
        mockChild.emit('close', 0);

        const result = await promise;

        jest.advanceTimersByTime(6000);

        expect(mockChild.kill).not.toHaveBeenCalled();
        expect(result.available).toBe(true);
        expect(result.version).toBe('v1.0.0');
      });

      it('should cleanup timeout on error', async () => {
        const mockChild = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.kill = jest.fn();

        spawn.mockReturnValue(mockChild);

        const promise = checkTool('error-tool');

        mockChild.emit('error', new Error('spawn failed'));

        const result = await promise;

        jest.advanceTimersByTime(6000);

        expect(mockChild.kill).not.toHaveBeenCalled();
        expect(result.available).toBe(false);
      });
    });

    describe('comprehensive command injection patterns', () => {
      const dangerousPatterns = [
        { pattern: 'cmd\n', name: 'LF newline' },
        { pattern: 'cmd\r', name: 'CR carriage return' },
        { pattern: 'cmd\r\n', name: 'CRLF Windows newline' },
        { pattern: 'cmd\x00', name: 'null byte' },
        { pattern: '../../../bin/sh', name: 'Unix path traversal' },
        { pattern: '..\\..\\cmd.exe', name: 'Windows path traversal' },
        { pattern: 'cmd`whoami`', name: 'backtick command substitution' },
        { pattern: 'cmd$(ls)', name: 'dollar-paren substitution' },
        { pattern: 'cmd"$(ls)"', name: 'quoted command substitution' },
        { pattern: "cmd'test", name: 'single quote' },
        { pattern: 'cmd"test', name: 'double quote' },
        { pattern: 'cmd|cat', name: 'pipe' },
        { pattern: 'cmd||true', name: 'OR operator' },
        { pattern: 'cmd&&echo', name: 'AND operator' },
        { pattern: 'cmd>file', name: 'output redirection' },
        { pattern: 'cmd<file', name: 'input redirection' },
        { pattern: 'cmd $VAR', name: 'variable expansion' },
        { pattern: 'cmd*', name: 'glob wildcard' },
        { pattern: 'cmd?', name: 'single char glob' },
      ];

      it.each(dangerousPatterns)(
        'should reject $name: $pattern',
        async ({ pattern }) => {
          const result = await checkTool(pattern);
          expect(result.available).toBe(false);
          expect(result.version).toBeNull();
          expect(spawn).not.toHaveBeenCalled();
        }
      );

      it.each(dangerousPatterns)(
        'should reject $name in version flag: $pattern',
        async ({ pattern }) => {
          const result = await checkTool('git', pattern);
          expect(result.available).toBe(false);
          expect(result.version).toBeNull();
          expect(spawn).not.toHaveBeenCalled();
        }
      );
    });
  });

  describe('TOOL_DEFINITIONS', () => {
    it('should be an array of tool definitions', () => {
      expect(Array.isArray(TOOL_DEFINITIONS)).toBe(true);
      expect(TOOL_DEFINITIONS.length).toBeGreaterThan(0);
    });

    it('should have name and flag for each tool', () => {
      TOOL_DEFINITIONS.forEach(tool => {
        expect(tool).toHaveProperty('name');
        expect(tool).toHaveProperty('flag');
        expect(typeof tool.name).toBe('string');
        expect(typeof tool.flag).toBe('string');
      });
    });

    it('should include common tools', () => {
      const toolNames = TOOL_DEFINITIONS.map(t => t.name);
      expect(toolNames).toContain('git');
      expect(toolNames).toContain('node');
      expect(toolNames).toContain('npm');
      expect(toolNames).toContain('docker');
    });
  });

  describe('verifyTools', () => {
    it('should return object with all tool definitions', async () => {
      spawn.mockImplementation(() => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.kill = jest.fn();

        process.nextTick(() => {
          child.stdout.emit('data', Buffer.from('v1.0.0'));
          child.emit('close', 0);
        });

        return child;
      });

      const result = await verifyTools();

      TOOL_DEFINITIONS.forEach(tool => {
        expect(result).toHaveProperty(tool.name);
      });
    });

    it('should handle all tools failing gracefully', async () => {
      spawn.mockImplementation(() => {
        const child = new EventEmitter();
        child.stdout = new EventEmitter();
        child.kill = jest.fn();

        process.nextTick(() => {
          child.emit('error', new Error('spawn failed'));
        });

        return child;
      });

      const result = await verifyTools();

      TOOL_DEFINITIONS.forEach(tool => {
        expect(result).toHaveProperty(tool.name);
        expect(result[tool.name].available).toBe(false);
      });
    });
  });

  describe('platform-specific behavior', () => {
    const isWindows = process.platform === 'win32';

    describe('checkTool execution', () => {
      it('should spawn process with platform-appropriate options', async () => {
        const mockChild = new EventEmitter();
        mockChild.stdout = new EventEmitter();
        mockChild.kill = jest.fn();

        spawn.mockReturnValue(mockChild);

        const promise = checkTool('git');

        mockChild.stdout.emit('data', Buffer.from('git version 2.40.0'));
        mockChild.emit('close', 0);

        const result = await promise;

        expect(spawn).toHaveBeenCalled();
        expect(result.available).toBe(true);

        if (isWindows) {
          expect(spawn).toHaveBeenCalledWith(
            'cmd.exe',
            expect.arrayContaining(['/c', 'git', '--version']),
            expect.any(Object)
          );
        }
      });
    });

    describe('tool path validation', () => {
      it('should accept common tool names without path separators', async () => {
        spawn.mockImplementation(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.kill = jest.fn();

          process.nextTick(() => {
            child.stdout.emit('data', Buffer.from('v1.0.0'));
            child.emit('close', 0);
          });

          return child;
        });

        const validTools = ['git', 'node', 'npm', 'docker', 'python3', 'go'];
        for (const tool of validTools) {
          const result = await checkTool(tool);
          expect(result.available).toBe(true);
        }
      });

      it('should reject paths with platform-specific separators', async () => {
        const invalidPaths = [
          '/usr/bin/git',
          'C:\\Program Files\\git',
          '../bin/node',
          '.\\git'
        ];

        for (const path of invalidPaths) {
          const result = await checkTool(path);
          expect(result.available).toBe(false);
          expect(result.version).toBeNull();
        }

        expect(spawn).not.toHaveBeenCalled();
      });

      it('should accept hyphenated tool names', async () => {
        spawn.mockImplementation(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.kill = jest.fn();

          process.nextTick(() => {
            child.stdout.emit('data', Buffer.from('v1.0.0'));
            child.emit('close', 0);
          });

          return child;
        });

        const hyphenatedTools = ['docker-compose', 'git-lfs', 'pre-commit'];
        for (const tool of hyphenatedTools) {
          const result = await checkTool(tool);
          expect(result.available).toBe(true);
        }
      });

      it('should accept underscored tool names', async () => {
        spawn.mockImplementation(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.kill = jest.fn();

          process.nextTick(() => {
            child.stdout.emit('data', Buffer.from('v1.0.0'));
            child.emit('close', 0);
          });

          return child;
        });

        const result = await checkTool('my_tool');
        expect(result.available).toBe(true);
      });
    });

    describe('version flag validation', () => {
      it('should accept common version flags', async () => {
        spawn.mockImplementation(() => {
          const child = new EventEmitter();
          child.stdout = new EventEmitter();
          child.kill = jest.fn();

          process.nextTick(() => {
            child.stdout.emit('data', Buffer.from('v1.0.0'));
            child.emit('close', 0);
          });

          return child;
        });

        const validFlags = ['--version', '-v', '-V', 'version', '--help'];
        for (const flag of validFlags) {
          jest.clearAllMocks();
          spawn.mockImplementation(() => {
            const child = new EventEmitter();
            child.stdout = new EventEmitter();
            child.kill = jest.fn();

            process.nextTick(() => {
              child.stdout.emit('data', Buffer.from('v1.0.0'));
              child.emit('close', 0);
            });

            return child;
          });
          const result = await checkTool('git', flag);
          expect(result.available).toBe(true);
        }
      });

      it('should reject flags with special characters', async () => {
        const invalidFlags = [
          '--version; rm -rf /',
          '-v && cat /etc/passwd',
          '$(whoami)',
          '`id`'
        ];

        for (const flag of invalidFlags) {
          const result = await checkTool('git', flag);
          expect(result.available).toBe(false);
        }

        expect(spawn).not.toHaveBeenCalled();
      });
    });
  });
});
